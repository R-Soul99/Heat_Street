/**
 * Dev-only 3D terrain sculpt page (D-09). This module is the shell: scene,
 * orbit / top-down camera, terrain picking, area list / new / load / save via
 * the `/__terrain/*` middleware, cursor ring and readouts, and the DOM glue
 * for the tool dispatcher (tools, options, shortcuts, undo/redo, validator
 * log, Drive here).
 */
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { KNOWN_MAP_IDS, MAP_FORMATS, type MapId } from "../../src/core/map-select.ts";
import { buildRoadGeometry } from "../../src/core/road-geometry.ts";
import { SURFACE_TYPES, type SurfaceType } from "../../src/core/surface-types.ts";
import { BLOCK_CELLS_MAX, blockWindowAt } from "../../src/core/terrain-brush.ts";
import {
  encodeTerrainBinary,
  loadTerrainArea,
  serializeTerrainSidecar,
  type TerrainArea,
} from "../../src/core/terrain-format.ts";
import { sampleTerrainHeight, terrainTriangleNormal } from "../../src/core/terrain-grid.ts";
import { DEFAULT_CELL_SIZE_M, MAX_AREA_SIZE_M } from "../../src/core/terrain-limits.ts";
import {
  cellPixelSize,
  contourSegments,
  gridLineSegments,
  needsZoomHint,
  roadLockSegments,
} from "../../src/core/terrain-overlay.ts";
import { surfaceAt } from "../../src/core/terrain-paint.ts";
import { raycastTerrain } from "../../src/core/terrain-pick.ts";
import { ROAD_PRESETS, type RoadPresetId } from "../../src/core/terrain-road.ts";
import type { CellWindow } from "../../src/core/terrain-slope.ts";
import {
  buildTerrainView,
  TERRAIN_SURFACE_PALETTE,
  type TerrainView,
} from "../../src/render/terrain-view.ts";
import { createButton, hintText, labelled, readout } from "../editor-shell/fields.ts";
import { fmtMetres } from "../editor-shell/format.ts";
import {
  type Binding,
  installShortcuts,
  shortcutLabel,
  shortcutsDialogBody,
} from "../editor-shell/keys.ts";
import { createMessageLog, logDialogBody } from "../editor-shell/log.ts";
import { createSelect } from "../editor-shell/select.ts";
import { createShell } from "../editor-shell/shell.ts";
import { createStepper, type StepperHandle } from "../editor-shell/stepper.ts";
import { reportMissingTips } from "../editor-shell/tooltips.ts";
import type { ShellHandle, StatusKind } from "../editor-shell/types.ts";
import { validateGraph } from "../map-compiler/validate/validator.ts";
import { createEmptyTerrainArea, suggestAreaName, validateNewTerrainArea } from "./new-area.ts";
import { blockingRoadFailures, saveBlockMessage, staleRoadBlockMessage } from "./save-guard.ts";
import { putTerrainPair } from "./save-pair.ts";
import {
  createToolDispatcher,
  type EditArea,
  SLOPE_CLAMP_HINT,
  TOOL_KEYS,
  type Tool,
  type ToolOptions,
  type ToolResult,
} from "./tool-dispatch.ts";

const DEFAULT_HINT =
  "Left-drag to sculpt. Middle-drag (or right-drag) to tilt and spin, Shift+right-drag or Ctrl+wheel to pan, wheel to zoom.";
const CURSOR_RADIUS_M = 8;
const RING_SEGMENTS = 64;
const ZOOM_HINT = "Zoom in to see single cells.";
const HEIGHT_TOOLS: readonly Tool[] = ["block", "raise", "lower", "smooth", "flatten", "smoothBox"];
/** Overlay window size in cells (T-04.3-28 cap) and re-centre threshold. */
const OVERLAY_CELLS = 64;
const OVERLAY_RECENTRE_CELLS = 16;
const CONTOUR_MIN_M = 0.25;
const CONTOUR_MAX_M = 10;
const BLOCK_YELLOW = 0xffee66;
const BOX_CYAN = 0x44ddff;

// ---------------------------------------------------------------- state

let area: TerrainArea | null = null;
let terrainView: TerrainView | null = null;
let dirty = false;
let tool: Tool = "raise";
let lastHit: { x: number; z: number } | null = null;
let slopeAmber = false;
let stroking = false;
let lastEditMs: number | null = null;
let topDown = false;
let savedPose: { pos: THREE.Vector3; target: THREE.Vector3 } | null = null;
let knownAreas: string[] = [];
let saving = false;
let editCounter = 0;
let showGrid = false;
let showContours = false;
let contourInterval = 1;
let currentHint = DEFAULT_HINT;
let blockLabel: ReturnType<typeof readout> | null = null;
let rotationLabel: ReturnType<typeof readout> | null = null;

// ---------------------------------------------------------------- shell (D-01, D-02)

const messageLog = createMessageLog();
let shell: ShellHandle;

const dispatcher = createToolDispatcher(() => {
  if (!area) throw new Error("no area loaded");
  return area as unknown as EditArea;
});

/** Status line (info bar) plus the Help > Show log history. Text only, never markup (WR-06). */
function say(text: string, kind: StatusKind = "info"): void {
  shell.info.status(text, kind);
  messageLog.add(text, kind);
}

function setHint(text: string): void {
  currentHint = text;
  shell.info.set("hint", text);
}

function setDirty(value: boolean): void {
  dirty = value;
  shell.info.setDirty(value);
  // CR-01: every edit bumps the counter, so a save can tell whether anything
  // changed while its PUTs were in flight (and must then stay dirty).
  if (value) editCounter++;
}

type NumKey = {
  [K in keyof ToolOptions]: ToolOptions[K] extends number ? K : never;
}[keyof ToolOptions];

interface NumStepperSpec {
  label: string;
  tip: string;
  key: NumKey;
  min: number;
  max: number;
  step: number;
  coarse: number;
  decimals: number;
  unit?: string;
  slider?: "none" | "open" | "collapsed";
  after?: () => void;
}

/** A stepper bound to one dispatcher option. Reads the live value each time the flyout renders. */
function numStepper(s: NumStepperSpec): StepperHandle {
  return createStepper({
    label: s.label,
    tip: s.tip,
    value: dispatcher.getOptions()[s.key],
    min: s.min,
    max: s.max,
    step: s.step,
    coarse: s.coarse,
    decimals: s.decimals,
    unit: s.unit,
    slider: s.slider ?? "none",
    onChange: (v) => {
      dispatcher.setOptions({ [s.key]: v } as Partial<ToolOptions>);
      s.after?.();
    },
  });
}

const SURFACE_OPTIONS = SURFACE_TYPES.map((s) => ({ value: s, label: s }));

function surfaceSelect(tip: string) {
  return createSelect<SurfaceType>({
    label: "Surface",
    tip,
    options: SURFACE_OPTIONS,
    value: dispatcher.getOptions().surface,
    onChange: (v) => dispatcher.setOptions({ surface: v }),
  });
}

function radiusStepper(): StepperHandle {
  return numStepper({
    label: "Radius",
    tip: "How wide the brush is, in metres. The ring on the terrain shows it.",
    key: "radiusM",
    min: 0.5,
    max: 200,
    step: 0.5,
    coarse: 5,
    decimals: 1,
    unit: "m",
    slider: "collapsed",
    after: () => {
      if (lastHit) paintRing(lastHit);
    },
  });
}

function strengthStepper(): StepperHandle {
  return numStepper({
    label: "Strength",
    tip: "How hard the brush works, 0 to 1. Higher changes the ground faster.",
    key: "strength",
    min: 0,
    max: 1,
    step: 0.05,
    coarse: 0.25,
    decimals: 2,
    slider: "collapsed",
  });
}

function falloffSelect() {
  return createSelect<"smooth" | "linear">({
    label: "Falloff",
    tip: "How the brush fades toward its edge: Smooth is soft, Linear is a straight ramp.",
    options: [
      { value: "smooth", label: "Smooth" },
      { value: "linear", label: "Linear" },
    ],
    value: dispatcher.getOptions().falloff,
    onChange: (v) => dispatcher.setOptions({ falloff: v }),
  });
}

/** Raise, Lower, Smooth, Flatten and Surface paint share radius + strength + falloff. */
function brushOptions(hint: string, withSurface: boolean): (host: HTMLElement) => void {
  return (host) => {
    host.append(hintText(hint), radiusStepper().el, strengthStepper().el, falloffSelect().el);
    if (withSurface) {
      host.append(surfaceSelect("Which surface the brush paints onto the ground.").el);
    }
  };
}

function runAction(fn: () => ToolResult): void {
  if (!area) {
    say("Load an area first (pick one at the top and press Load, or File > New...).", "error");
    return;
  }
  if (stroking) return;
  const t0 = performance.now();
  applyResult(fn(), performance.now() - t0);
  updateHistoryButtons();
}

function renderRoadOptions(host: HTMLElement): void {
  const o = dispatcher.getOptions();
  const preset = ROAD_PRESETS[o.roadPreset];
  const presetSel = createSelect<RoadPresetId>({
    label: "Road class",
    tip: "Street, highway, track or dirt road. The class sets the default width, surface and banking.",
    options: [
      { value: "street", label: "Street" },
      { value: "highway", label: "Highway" },
      { value: "track", label: "Track" },
      { value: "dirt", label: "Dirt road" },
    ],
    value: o.roadPreset,
    onChange: (v) => {
      dispatcher.setOptions({ roadPreset: v });
      // The class changes width and the bank limit, so rebuild the flyout from the dispatcher.
      shell.refreshToolOptions();
    },
  });
  const bank = numStepper({
    label: "Bank max",
    tip: "Largest sideways tilt of the road in corners, in degrees. Streets do not bank.",
    key: "maxBankDeg",
    min: 0,
    max: preset.maxBankDeg,
    step: 1,
    coarse: 5,
    decimals: 0,
    unit: "deg",
  });
  bank.setDisabled(!(preset.maxBankDeg > 0));
  host.append(
    hintText("Drag along the ground to lay a road. It is graded into the terrain."),
    surfaceSelect("Which surface the new road is made of.").el,
    presetSel.el,
    numStepper({
      label: "Width",
      tip: "Road width in metres.",
      key: "widthM",
      min: 3,
      max: 20,
      step: 0.5,
      coarse: 2,
      decimals: 1,
      unit: "m",
    }).el,
    bank.el,
  );
}

function renderBlockOptions(host: HTMLElement): void {
  const row = document.createElement("div");
  row.className = "es-row";
  const buttons: [HTMLButtonElement, 1 | -1][] = [];
  const mark = (): void => {
    const cur = dispatcher.getOptions().blockDirection;
    for (const [b, d] of buttons) {
      b.setAttribute("aria-pressed", String(d === cur));
      b.classList.toggle("active", d === cur);
    }
  };
  for (const [label, d] of [
    ["Raise", 1],
    ["Lower", -1],
  ] as const) {
    const b = createButton({
      label,
      tip: `Which way a click moves the block: ${label.toLowerCase()}. No modifier key needed.`,
      onClick: () => {
        dispatcher.setOptions({ blockDirection: d });
        mark();
      },
    });
    buttons.push([b, d]);
    row.append(b);
  }
  mark();
  blockLabel = readout("");
  syncBlockLabel();
  host.append(
    hintText("Click or drag to move whole blocks of cells. Drag paints blocks."),
    labelled("Direction", "Which way a click moves the block. No modifier key needed.", row),
    numStepper({
      label: "Block size",
      tip: "Edge length of the block in cells.",
      key: "blockCells",
      min: 1,
      max: BLOCK_CELLS_MAX,
      step: 1,
      coarse: 8,
      decimals: 0,
      unit: "cells",
      after: syncBlockLabel,
    }).el,
    blockLabel.el,
    numStepper({
      label: "Step",
      tip: "How far one click moves the block, in metres.",
      key: "blockStepM",
      min: 0.25,
      max: 5,
      step: 0.25,
      coarse: 1,
      decimals: 2,
      unit: "m",
    }).el,
  );
}

function renderSmoothBoxOptions(host: HTMLElement): void {
  host.append(
    hintText("Drag a box to smooth it. Roads never move. Esc cancels."),
    numStepper({
      label: "Smooth strength",
      tip: "How much each pass relaxes the ground, 0 to 1.",
      key: "smoothStrength",
      min: 0,
      max: 1,
      step: 0.05,
      coarse: 0.25,
      decimals: 2,
    }).el,
    numStepper({
      label: "Passes",
      tip: "How many smoothing passes to run, 1 to 10.",
      key: "smoothPasses",
      min: 1,
      max: 10,
      step: 1,
      coarse: 3,
      decimals: 0,
    }).el,
    createButton({
      label: "Smooth whole map",
      tip: "Smooth the entire map with the strength and passes above. Roads never move. Ctrl+Z undoes it.",
      onClick: () => void smoothWholeMap(),
    }),
  );
}

function renderLockOptions(host: HTMLElement): void {
  host.append(
    hintText("Click a road to lock or unlock it. Shift+click selects it without toggling."),
    radiusStepper().el,
    createButton({
      label: "Lock all",
      tip: "Lock every road so sculpting cannot move it.",
      onClick: () => runAction(() => dispatcher.lockAll(true)),
    }),
    createButton({
      label: "Unlock all",
      tip: "Unlock every road so sculpting can change the ground under it.",
      onClick: () => runAction(() => dispatcher.lockAll(false)),
    }),
    createButton({
      label: "Re-grade selected",
      tip: "Re-fit the selected road to the terrain under it.",
      onClick: () => runAction(() => dispatcher.regradeSelected()),
    }),
    createButton({
      label: "Re-grade all unlocked",
      tip: "Re-fit every unlocked road to the terrain under it.",
      onClick: () => runAction(() => dispatcher.regradeAllUnlocked()),
    }),
    hintText(
      "Grey = locked, orange = unlocked, cyan = selected. Unlocked roads must be re-graded or locked before saving.",
    ),
  );
}

function stampRotationText(): string {
  const deg = Math.round((dispatcher.getOptions().stampRotationRad * 180) / Math.PI);
  return `Rotation ${deg} deg ([ ] rotate 15 deg). Drag to set length.`;
}

function renderStampOptions(host: HTMLElement): void {
  rotationLabel = readout(stampRotationText());
  host.append(
    createSelect<"wedge" | "mound">({
      label: "Stamp",
      tip: "Wedge makes a ramp, Mound makes a hill.",
      options: [
        { value: "wedge", label: "Wedge" },
        { value: "mound", label: "Mound" },
      ],
      value: dispatcher.getOptions().stampKind,
      onChange: (v) => dispatcher.setOptions({ stampKind: v }),
    }).el,
    numStepper({
      label: "Height",
      tip: "How tall the stamp is, in metres. Negative digs.",
      key: "stampHeightM",
      min: -50,
      max: 50,
      step: 0.5,
      coarse: 2,
      decimals: 1,
      unit: "m",
    }).el,
    numStepper({
      label: "Width",
      tip: "How wide the stamp is, in metres.",
      key: "stampWidthM",
      min: 1,
      max: 200,
      step: 1,
      coarse: 5,
      decimals: 0,
      unit: "m",
    }).el,
    rotationLabel.el,
  );
}

function renderEraseOptions(host: HTMLElement): void {
  host.append(hintText("Drag over a road to erase it."), radiusStepper().el);
}

/** Rail order. ids are the dispatcher Tool ids; shortcut letters come from TOOL_KEYS. */
const TOOL_LIST: { id: Tool; label: string; icon: string; tip: string }[] = [
  { id: "raise", label: "Raise", icon: "▲", tip: "Raise the ground" },
  { id: "lower", label: "Lower", icon: "▼", tip: "Lower the ground" },
  { id: "smooth", label: "Smooth", icon: "≈", tip: "Smooth bumps out of the ground" },
  { id: "flatten", label: "Flatten", icon: "▬", tip: "Flatten the ground" },
  { id: "paint", label: "Surface paint", icon: "🖌", tip: "Paint a surface onto the ground" },
  { id: "road", label: "Road brush", icon: "═", tip: "Draw a road and grade the terrain to it" },
  { id: "stamp", label: "Stamp", icon: "◭", tip: "Drop a ramp or mound" },
  { id: "erase", label: "Erase road", icon: "✕", tip: "Erase roads" },
  { id: "block", label: "Block", icon: "▦", tip: "Raise or lower whole blocks of cells" },
  {
    id: "smoothBox",
    label: "Smooth area",
    icon: "⬚",
    tip: "Drag a box and smooth everything in it",
  },
  { id: "lock", label: "Lock/unlock road", icon: "🔒", tip: "Lock or unlock roads, re-grade them" },
  { id: "gridSelect", label: "Grid select", icon: "⊞", tip: "Select a rectangle of cells" },
];

function shortcutOf(id: Tool): string | undefined {
  const code = Object.keys(TOOL_KEYS).find((c) => TOOL_KEYS[c] === id);
  return code ? shortcutLabel({ code }) : undefined;
}

const TOOL_RENDERERS: Record<Tool, (host: HTMLElement) => void> = {
  raise: brushOptions("Click or drag to raise the ground. No modifier key needed.", false),
  lower: brushOptions("Click or drag to lower the ground. No modifier key needed.", false),
  smooth: brushOptions("Drag to smooth bumps out of the ground.", false),
  flatten: brushOptions("Drag to flatten the ground toward one height.", false),
  paint: brushOptions("Drag to paint the chosen surface onto the ground.", true),
  road: renderRoadOptions,
  stamp: renderStampOptions,
  erase: renderEraseOptions,
  block: renderBlockOptions,
  smoothBox: renderSmoothBoxOptions,
  lock: renderLockOptions,
  gridSelect: (host) => host.append(hintText("Drag a rectangle of cells to select them.")),
};

const CONTOUR_INTERVALS_M = [0.25, 0.5, 1, 2, 5, 10];
const closeAction = [{ id: "close", label: "Close", tip: "Close this window" }];

function showSurfaceColours(): void {
  const body = document.createElement("div");
  body.className = "es-legend";
  const rows: HTMLElement[] = [];
  for (const s of SURFACE_TYPES) {
    const row = document.createElement("div");
    const sw = document.createElement("span");
    sw.style.display = "inline-block";
    sw.style.width = "12px";
    sw.style.height = "12px";
    sw.style.verticalAlign = "middle";
    sw.style.background = `#${TERRAIN_SURFACE_PALETTE[s].toString(16).padStart(6, "0")}`;
    row.append(sw, document.createTextNode(` ${s}`));
    rows.push(row);
  }
  body.replaceChildren(...rows);
  void shell.dialog({ title: "Surface colours", body, actions: closeAction });
}

function showAreaDetails(): void {
  const body = document.createElement("div");
  const lines: string[] = [];
  if (!area) {
    lines.push("No area loaded.");
  } else {
    const g = area.grid;
    lines.push(
      `Vertices: ${((g.rows + 1) * (g.cols + 1)).toLocaleString()}`,
      `Chunks: ${terrainView?.chunkMeshes.length ?? 0}`,
      `Last edit: ${lastEditMs === null ? "-" : `${lastEditMs.toFixed(1)} ms`}`,
    );
  }
  body.replaceChildren(
    ...lines.map((l) => {
      const d = document.createElement("div");
      d.textContent = l;
      return d;
    }),
  );
  void shell.dialog({ title: "Area details", body, actions: closeAction });
}

function updateAreaInfo(): void {
  if (!area) {
    shell.info.set("area", "none");
    shell.info.set("size", "-");
    shell.info.set("cell", "-");
    return;
  }
  const g = area.grid;
  shell.info.set("area", area.areaId);
  shell.info.set(
    "size",
    `${Math.round(g.scaleX)} x ${Math.round(g.scaleZ)} m (${g.cols} x ${g.rows} cells)`,
  );
  shell.info.set("cell", `${g.cellSizeM} m`);
}

/** New popup (D-06): validation errors show inside the popup. */
function openNewDialog(): void {
  const nameInput = document.createElement("input");
  nameInput.type = "text";
  nameInput.value = suggestAreaName(knownAreas);
  nameInput.dataset.tip =
    "Name of the new area: 1-64 characters, a-z, 0-9 and - only. It becomes the file name.";
  const cells = readout("");
  const update = (): void => {
    const cell = cellStepper.get();
    if (!(cell > 0)) return;
    const cols = Math.max(1, Math.round(widthStepper.get() / cell));
    const rows = Math.max(1, Math.round(depthStepper.get() / cell));
    const r = (v: number): number => Math.round(v * 100) / 100;
    cells.set(
      `${cols} x ${rows} cells (= ${r(cols * cell)} x ${r(rows * cell)} m after snapping to whole cells)`,
    );
  };
  const sizeStepper = (label: string, tip: string): StepperHandle =>
    createStepper({
      label,
      tip,
      value: 1000,
      min: 1,
      max: MAX_AREA_SIZE_M,
      step: 50,
      coarse: 5,
      decimals: 0,
      unit: "m",
      onChange: update,
    });
  const widthStepper = sizeStepper("Width", "East-west size of the new area in metres.");
  const depthStepper = sizeStepper(
    "Height (north-south)",
    "North-south size of the new area in metres.",
  );
  const cellStepper = createStepper({
    label: "Cell size",
    tip: "Size of one terrain cell in metres. Smaller cells are more detailed but use more memory.",
    value: DEFAULT_CELL_SIZE_M,
    min: 0.5,
    max: 20,
    step: 0.5,
    coarse: 2,
    decimals: 1,
    unit: "m",
    onChange: update,
  });
  const advanced = document.createElement("details");
  const summary = document.createElement("summary");
  summary.textContent = "Advanced";
  summary.dataset.tip = "Show or hide the cell size setting.";
  advanced.append(summary, cellStepper.el, cells.el);
  update();

  const body = document.createElement("div");
  body.append(
    labelled("Name (a-z, 0-9, -)", nameInput.dataset.tip ?? "", nameInput),
    widthStepper.el,
    depthStepper.el,
    advanced,
  );
  void shell.dialog({
    title: "New terrain area",
    body,
    actions: [
      { id: "cancel", label: "Cancel", tip: "Close without creating anything" },
      {
        id: "create",
        label: "Create",
        tip: "Create a flat grass area of this size and open it",
        primary: true,
        run: async () => {
          const input = {
            name: nameInput.value.trim(),
            widthM: widthStepper.get(),
            depthM: depthStepper.get(),
            cellSizeM: cellStepper.get(),
          };
          const bad = validateNewTerrainArea(input, knownAreas);
          if (bad !== null) return bad;
          if (!(await confirmDiscard())) return "Not created: you kept your unsaved changes.";
          const created = createEmptyTerrainArea({
            areaId: input.name,
            widthM: input.widthM,
            depthM: input.depthM,
            cellSizeM: input.cellSizeM,
          });
          installArea(created);
          setDirty(true);
          say(`Created flat grass terrain "${input.name}". Press Save (Ctrl+S) to write it.`, "ok");
          return null;
        },
      },
    ],
  });
}

const newButton = createButton({
  label: "New",
  tip: "Create a new flat terrain area",
  onClick: openNewDialog,
});
const areaSelect = createSelect<string>({
  tip: "Pick a saved terrain area, then press Load.",
  options: [],
  value: "",
  onChange: () => {},
});
const loadButton = createButton({
  label: "Load",
  tip: "Open the area chosen in the list",
  onClick: () => loadSelected(),
});
loadButton.disabled = true;

function loadSelected(): void {
  const id = areaSelect.get();
  if (id) void loadArea(id);
  else say("No saved area to load. Use File > New... to create one.", "error");
}

const bindings: Binding[] = [
  {
    code: "KeyS",
    ctrl: true,
    label: "Ctrl+S",
    description: "Save terrain",
    allowInTextEntry: true,
    run: () => void save(),
  },
  { code: "KeyZ", ctrl: true, label: "Ctrl+Z", description: "Undo", run: () => undoRedo("undo") },
  {
    code: "KeyZ",
    ctrl: true,
    shift: true,
    label: "Ctrl+Shift+Z",
    description: "Redo",
    run: () => undoRedo("redo"),
  },
  { code: "KeyY", ctrl: true, label: "Ctrl+Y", description: "Redo", run: () => undoRedo("redo") },
  {
    code: "Escape",
    label: "Esc",
    description: "Cancel the smooth-area drag",
    run: () => {
      if (!dispatcher.cancelBoxDrag()) return;
      stroking = false;
      clearBoxOutline();
      if (lastHit) paintRing(lastHit);
      say("Smooth area cancelled.");
    },
  },
  { code: "KeyT", label: "T", description: "Top-down camera on/off", run: toggleTopDown },
  {
    code: "KeyX",
    label: "X",
    description: "Cell grid on/off",
    run: () => {
      showGrid = !showGrid;
      refreshOverlays();
    },
  },
  {
    code: "KeyC",
    label: "C",
    description: "Contours on/off",
    run: () => {
      showContours = !showContours;
      refreshOverlays();
    },
  },
  { code: "KeyD", label: "D", description: "Drive here", run: () => void driveHere() },
  {
    code: "BracketLeft",
    label: "[",
    description: "Rotate the stamp back 15 degrees",
    run: () => rotateStampBy(-1),
  },
  {
    code: "BracketRight",
    label: "]",
    description: "Rotate the stamp forward 15 degrees",
    run: () => rotateStampBy(1),
  },
  { code: "ArrowUp", label: "Up", description: "Pan the view up", run: () => panView(0, -1) },
  { code: "ArrowDown", label: "Down", description: "Pan the view down", run: () => panView(0, 1) },
  { code: "ArrowLeft", label: "Left", description: "Pan the view left", run: () => panView(-1, 0) },
  {
    code: "ArrowRight",
    label: "Right",
    description: "Pan the view right",
    run: () => panView(1, 0),
  },
  ...Object.entries(TOOL_KEYS).map(
    ([code, id]): Binding => ({
      code,
      label: shortcutLabel({ code }),
      description: `${TOOL_LIST.find((t) => t.id === id)?.label ?? id} tool`,
      run: () => shell.setTool(id),
    }),
  ),
];

function rotateStampBy(sign: 1 | -1): void {
  dispatcher.rotateStamp(sign);
  rotationLabel?.set(stampRotationText());
  const deg = Math.round((dispatcher.getOptions().stampRotationRad * 180) / Math.PI);
  say(`Stamp rotation ${deg} degrees.`);
}

shell = createShell({
  root: document.getElementById("app") as HTMLElement,
  title: "Terrain editor",
  topbarExtras: [newButton, areaSelect.el, loadButton],
  initialTool: tool,
  onToolChange: (id) => selectTool(id as Tool),
  tools: TOOL_LIST.map((t) => ({
    id: t.id,
    label: t.label,
    icon: t.icon,
    tip: t.tip,
    shortcut: shortcutOf(t.id),
    renderOptions: TOOL_RENDERERS[t.id],
  })),
  menus: [
    {
      label: "File",
      tip: "Create, load and save terrain areas",
      items: [
        { label: "New...", tip: "Create a new flat terrain area", run: openNewDialog },
        { label: "Load selected", tip: "Open the area chosen in the top bar", run: loadSelected },
        {
          label: "Save terrain",
          tip: "Write the terrain and its roads to disk",
          shortcut: "Ctrl+S",
          run: () => void save(),
        },
        {
          label: "Drive here",
          tip: "Save, then open the game at the cursor (registered terrain maps only)",
          shortcut: "D",
          run: () => void driveHere(),
        },
      ],
    },
    {
      label: "View",
      tip: "Grid, contours and camera",
      items: [
        {
          label: "Grid (cells)",
          tip: "Show the terrain cell grid around the cursor",
          shortcut: "X",
          checked: () => showGrid,
          run: () => {
            showGrid = !showGrid;
            refreshOverlays();
          },
        },
        {
          label: "Contours",
          tip: "Show height contour lines around the cursor",
          shortcut: "C",
          checked: () => showContours,
          run: () => {
            showContours = !showContours;
            refreshOverlays();
          },
        },
        "separator",
        ...CONTOUR_INTERVALS_M.map((m) => ({
          label: `Contour interval ${m} m`,
          tip: `Draw a contour line every ${m} m of height`,
          checked: () => contourInterval === m,
          run: () => {
            contourInterval = m;
            refreshOverlays();
          },
        })),
        "separator" as const,
        {
          label: "Top-down camera",
          tip: "Look straight down at the area",
          shortcut: "T",
          checked: () => topDown,
          run: toggleTopDown,
        },
        { label: "Frame area", tip: "Zoom to show the whole area", run: fitView },
      ],
    },
    {
      label: "Help",
      tip: "Shortcuts, colours and the message log",
      items: [
        {
          label: "Keyboard shortcuts...",
          tip: "List every keyboard shortcut",
          run: () =>
            void shell.dialog({
              title: "Keyboard shortcuts",
              body: shortcutsDialogBody(bindings),
              actions: closeAction,
            }),
        },
        {
          label: "Surface colours...",
          tip: "What each ground surface colour means",
          run: showSurfaceColours,
        },
        {
          label: "Area details...",
          tip: "Vertex and chunk counts and the time of the last edit",
          run: showAreaDetails,
        },
        {
          label: "Show log...",
          tip: "Every message since the page opened",
          run: () =>
            void shell.dialog({
              title: "Log",
              body: logDialogBody(messageLog.lines()),
              actions: closeAction,
            }),
        },
      ],
    },
  ],
  history: {
    onUndo: () => undoRedo("undo"),
    onRedo: () => undoRedo("redo"),
  },
  view: {
    onZoomIn: () => zoomBy(0.8),
    onZoomOut: () => zoomBy(1.25),
    onFit: fitView,
    onPan: panView,
    extra: [{ label: "Top", tip: "Top-down camera on or off (T)", run: toggleTopDown }],
  },
  infoFields: [
    { key: "area", label: "Area", tip: "The terrain area being edited" },
    { key: "size", label: "Size", tip: "Width x depth of the area, and how many cells that is" },
    { key: "cell", label: "Cell", tip: "Size of one terrain cell" },
    { key: "cursor", label: "Cursor", tip: "Position of the cursor on the terrain, in metres" },
    { key: "height", label: "Height", tip: "Ground height under the cursor" },
    { key: "slope", label: "Slope", tip: "Ground steepness under the cursor" },
    { key: "surface", label: "Surface", tip: "Painted surface under the cursor" },
    { key: "road", label: "Nearest road", tip: "Nearest road id and its distance from the cursor" },
    { key: "brush", label: "Brush", tip: "Size of the block or smooth-area box under the cursor" },
    { key: "hint", label: "Tip", tip: "A hint about the current tool or view" },
  ],
});

// ---------------------------------------------------------------- three setup

const canvas = document.createElement("canvas");
canvas.style.cursor = "crosshair";
shell.canvasHost.append(canvas);

// Overlay shown until an area is loaded; it ignores the pointer.
const emptyOverlay = document.createElement("div");
emptyOverlay.textContent =
  "No area loaded. Pick one at the top and press Load, or use File > New...";
emptyOverlay.style.cssText =
  "position:absolute;inset:0;display:flex;align-items:center;justify-content:center;text-align:center;padding:24px;pointer-events:none;color:#9aa;";
shell.canvasHost.append(emptyOverlay);

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setClearColor(0x14161a);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

const scene = new THREE.Scene();
scene.add(new THREE.HemisphereLight(0xdde6ff, 0x4a4030, 1.1));
const sun = new THREE.DirectionalLight(0xffffff, 1.6);
sun.position.set(300, 500, 200);
scene.add(sun);

const camera = new THREE.PerspectiveCamera(50, 1, 1, 20000);
camera.position.set(200, 250, 200);

const controls = new OrbitControls(camera, canvas);
// LEFT is reserved for brushes. Shift + right-drag pans (OrbitControls default).
// MIDDLE is handled below: vertical drag tilts, horizontal drag spins.
// Ctrl + wheel pans the view up/down on screen (plain wheel still zooms).
controls.mouseButtons = {
  LEFT: null,
  MIDDLE: null,
  RIGHT: THREE.MOUSE.ROTATE,
} as unknown as typeof controls.mouseButtons;
controls.enableDamping = false;
controls.maxPolarAngle = Math.PI / 2 - 0.02;
canvas.addEventListener("contextmenu", (e) => e.preventDefault());

let middleDrag: { id: number; x: number; y: number } | null = null;
canvas.addEventListener("pointerdown", (e) => {
  if (e.button !== 1) return;
  e.preventDefault(); // suppress browser middle-click autoscroll
  middleDrag = { id: e.pointerId, x: e.clientX, y: e.clientY };
  canvas.setPointerCapture(e.pointerId);
});
canvas.addEventListener("pointermove", (e) => {
  if (!middleDrag || e.pointerId !== middleDrag.id) return;
  const dx = e.clientX - middleDrag.x;
  const dy = e.clientY - middleDrag.y;
  middleDrag.x = e.clientX;
  middleDrag.y = e.clientY;
  const h = canvas.clientHeight || 1;
  // Same sense as OrbitControls: horizontal drag spins, vertical drag tilts.
  const sph = new THREE.Spherical().setFromVector3(camera.position.clone().sub(controls.target));
  sph.theta -= (2 * Math.PI * dx) / h;
  sph.phi = Math.min(controls.maxPolarAngle, Math.max(0.01, sph.phi - (2 * Math.PI * dy) / h));
  camera.position.copy(controls.target).add(new THREE.Vector3().setFromSpherical(sph));
  camera.lookAt(controls.target);
  controls.update();
});
canvas.addEventListener(
  "wheel",
  (e) => {
    if (!e.ctrlKey) return;
    e.preventDefault(); // also stops browser page-zoom
    e.stopImmediatePropagation(); // keep OrbitControls from zooming
    const dist = camera.position.distanceTo(controls.target);
    const worldPerPx =
      (2 * dist * Math.tan((camera.fov * Math.PI) / 360)) / (canvas.clientHeight || 1);
    const move = new THREE.Vector3()
      .setFromMatrixColumn(camera.matrix, 1)
      .multiplyScalar(-Math.sign(e.deltaY) * Math.min(Math.abs(e.deltaY), 100) * worldPerPx);
    camera.position.add(move);
    controls.target.add(move);
    controls.update();
  },
  { capture: true, passive: false },
);
const endMiddleDrag = (e: PointerEvent): void => {
  if (!middleDrag || e.pointerId !== middleDrag.id) return;
  middleDrag = null;
  if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
};
canvas.addEventListener("pointerup", endMiddleDrag);
canvas.addEventListener("pointercancel", endMiddleDrag);

const ringGeometry = new THREE.BufferGeometry();
ringGeometry.setAttribute(
  "position",
  new THREE.BufferAttribute(new Float32Array(RING_SEGMENTS * 3), 3),
);
const RING_GREEN = 0x66cc99;
const RING_AMBER = 0xffbb44;
const cursorRing = new THREE.LineLoop(
  ringGeometry,
  new THREE.LineBasicMaterial({ color: RING_GREEN, depthTest: false, transparent: true }),
);
cursorRing.renderOrder = 999;
cursorRing.frustumCulled = false;
cursorRing.visible = false;
scene.add(cursorRing);

// D-22 block preview: closed rectangle on the exact cells the next click changes.
// BLOCK_CELLS_MAX cells per side x 4 sides, with headroom.
const BLOCK_OUTLINE_POINTS_MAX = BLOCK_CELLS_MAX * 4 + 8;
const blockOutlineGeometry = new THREE.BufferGeometry();
blockOutlineGeometry.setAttribute(
  "position",
  new THREE.BufferAttribute(new Float32Array(BLOCK_OUTLINE_POINTS_MAX * 3), 3),
);
const blockOutline = new THREE.LineLoop(
  blockOutlineGeometry,
  new THREE.LineBasicMaterial({ color: BLOCK_YELLOW, depthTest: false, transparent: true }),
);
blockOutline.renderOrder = 999;
blockOutline.frustumCulled = false;
blockOutline.visible = false;
scene.add(blockOutline);

// Smooth-area drag box: cyan terrain-hugging rectangle, rebuilt per drag move (size is unbounded).
const boxOutline = new THREE.LineLoop(
  new THREE.BufferGeometry(),
  new THREE.LineBasicMaterial({ color: BOX_CYAN, depthTest: false, transparent: true }),
);
boxOutline.renderOrder = 999;
boxOutline.frustumCulled = false;
boxOutline.visible = false;
scene.add(boxOutline);

function clearBoxOutline(): void {
  boxOutline.visible = false;
  boxOutline.geometry.dispose();
  boxOutline.geometry = new THREE.BufferGeometry();
}

const previewMaterial = new THREE.LineBasicMaterial({
  color: RING_GREEN,
  depthTest: false,
  transparent: true,
});
let previewLine: THREE.Line | null = null;

function setPreview(points: readonly { x: number; z: number }[] | null): void {
  if (previewLine) {
    scene.remove(previewLine);
    previewLine.geometry.dispose();
    previewLine = null;
  }
  if (!points || points.length < 2 || !area) return;
  const grid = area.grid;
  const arr = new Float32Array(points.length * 3);
  points.forEach((p, i) => {
    arr[i * 3] = p.x;
    arr[i * 3 + 1] = sampleTerrainHeight(grid, p.x, p.z) + 0.4;
    arr[i * 3 + 2] = p.z;
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(arr, 3));
  previewLine = new THREE.Line(g, previewMaterial);
  previewLine.renderOrder = 998;
  previewLine.frustumCulled = false;
  scene.add(previewLine);
}

function resize(): void {
  const w = Math.max(1, shell.canvasHost.clientWidth);
  const h = Math.max(1, shell.canvasHost.clientHeight);
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
new ResizeObserver(resize).observe(shell.canvasHost);
resize();

// ---------------------------------------------------------------- UI helpers

async function confirmDiscard(): Promise<boolean> {
  if (!dirty || !area) return true;
  return shell.confirm({
    title: "Discard changes?",
    message: `Discard unsaved changes to ${area.areaId}?`,
    okLabel: "Discard",
  });
}

async function api(url: string, init?: RequestInit): Promise<Response> {
  const res = await fetch(url, init);
  if (!res.ok) {
    let message = `${res.status}`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body.error) message = body.error;
    } catch {
      // keep the status code
    }
    throw new Error(message);
  }
  return res;
}

function loadErrorMessage(file: string, err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  const m = /unknown format version (\d+)/.exec(msg);
  if (m) {
    return `Cannot load ${file}: unknown format version ${m[1]}. Open it with a newer build or restore the previous file.`;
  }
  return `Cannot load ${file}: ${msg}`;
}

// ---------------------------------------------------------------- area I/O

async function refreshAreaList(selectId?: string): Promise<void> {
  const res = await api("/__terrain/areas");
  knownAreas = (await res.json()) as string[];
  areaSelect.setOptions(knownAreas.map((id) => ({ value: id, label: id })));
  if (selectId !== undefined && knownAreas.includes(selectId)) areaSelect.set(selectId);
  loadButton.disabled = knownAreas.length === 0;
}

function frameArea(a: TerrainArea): void {
  const g = a.grid;
  const cx = g.originX + g.scaleX / 2;
  const cz = g.originZ + g.scaleZ / 2;
  const size = Math.max(g.scaleX, g.scaleZ);
  const cy = sampleTerrainHeight(g, cx, cz);
  controls.target.set(cx, cy, cz);
  camera.position.set(cx + size * 0.5, cy + size * 0.6, cz + size * 0.5);
  camera.far = Math.max(2000, size * 10);
  camera.updateProjectionMatrix();
  controls.update();
  topDown = false;
  savedPose = null;
}

function installArea(next: TerrainArea): void {
  if (terrainView) {
    scene.remove(terrainView.group);
    terrainView.dispose();
  }
  area = next;
  dispatcher.clearHistory();
  setPreview(null);
  stroking = false;
  slopeAmber = false;
  updateHistoryButtons();
  updateAreaInfo();
  terrainView = buildTerrainView(next.grid, next.paint);
  scene.add(terrainView.group);
  emptyOverlay.style.display = "none";
  frameArea(next);
  cursorRing.visible = false;
  blockOutline.visible = false;
  clearBoxOutline();
  overlayCentre = null;
  refreshOverlays();
  syncBlockLabel();
  refreshRoadLockOverlay();
}

async function loadArea(id: string): Promise<void> {
  if (!(await confirmDiscard())) return;
  try {
    const [bin, json] = await Promise.all([
      api(`/__terrain/${id}/bin`).then((r) => r.arrayBuffer()),
      api(`/__terrain/${id}/json`).then((r) => r.text()),
    ]);
    const loaded = await loadTerrainArea(bin, json, id, id);
    installArea(loaded);
    setDirty(false);
    lastEditMs = null;
    say(`Loaded ${id}.`, "ok");
  } catch (err) {
    const text = loadErrorMessage(`${id}.terrain.bin`, err);
    say(text, "error");
  }
}

async function save(): Promise<boolean> {
  // CR-01: one save at a time; a second Ctrl+S / Drive here while a save is
  // in flight is refused instead of racing the first one.
  if (!area || saving) {
    if (saving) say("Save already in progress.", "error");
    return false;
  }
  saving = true;
  const target = area;
  const editsAtStart = editCounter;
  try {
    // D-15: refuse to save a road graph with a hard validation failure; no PUT.
    const blockText = saveBlockMessage(blockingRoadFailures(target.graph));
    if (blockText !== null) {
      say(blockText, "error");
      return false;
    }
    // Quick 261110-rdx (DD-3): an unlocked road that no longer matches the terrain is not saved.
    const staleText = staleRoadBlockMessage(
      target.grid,
      target.graph,
      (target as unknown as EditArea).unlockedEdgeIds,
    );
    if (staleText !== null) {
      say(staleText, "error");
      return false;
    }
    // Snapshot synchronously: the sidecar text is serialised and the binary
    // quantised (inside encodeTerrainBinary, before its first await) at the
    // same instant, so the pair describes one consistent state.
    const sidecar = serializeTerrainSidecar(target);
    const bin = await encodeTerrainBinary(target);
    // WR-07 / WR-06: both halves are fully encoded before anything is written;
    // bin first, then sidecar, with a half-written pair reported by name. The
    // graph was already validated client-side above (D-15), so the sidecar is
    // the half least likely to be rejected.
    await putTerrainPair(
      (kind, body) => api(`/__terrain/${target.areaId}/${kind}`, { method: "PUT", body }),
      bin as BodyInit,
      sidecar,
    );
    const editedDuringSave = editCounter !== editsAtStart || area !== target;
    if (!editedDuringSave) setDirty(false);
    const kb = Math.round(bin.length / 1024);
    say(
      editedDuringSave
        ? `Saved ${target.areaId} v1, ${kb} KB. Edits made during the save are not saved yet.`
        : `Saved ${target.areaId} v1, ${kb} KB`,
      "ok",
    );
    await refreshAreaList(target.areaId);
    return true;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const text = `Save failed: ${msg}. Your edits are still in memory; fix the problem and press Save terrain again.`;
    say(text, "error");
    return false;
  } finally {
    saving = false;
  }
}

// ---------------------------------------------------------------- camera

function setTopDown(on: boolean): void {
  if (!area || on === topDown) return;
  if (on) {
    savedPose = { pos: camera.position.clone(), target: controls.target.clone() };
    const height = Math.max(area.grid.scaleX, area.grid.scaleZ) * 0.9;
    camera.position.set(controls.target.x, controls.target.y + height, controls.target.z + 0.01);
  } else if (savedPose) {
    camera.position.copy(savedPose.pos);
    controls.target.copy(savedPose.target);
  }
  topDown = on;
  controls.update();
}

function toggleTopDown(): void {
  if (!area) {
    say("Load an area first to use the top-down camera.", "error");
    return;
  }
  setTopDown(!topDown);
}

/** View pad: dolly toward / away from the orbit target. */
function zoomBy(factor: number): void {
  const offset = camera.position.clone().sub(controls.target);
  const dist = Math.min(camera.far / 2, Math.max(5, offset.length() * factor));
  camera.position.copy(controls.target).add(offset.setLength(dist));
  controls.update();
}

function fitView(): void {
  if (!area) {
    say("No area loaded to fit.", "error");
    return;
  }
  frameArea(area);
}

/** View pad / arrow keys: move camera and target together by 10 % of the camera distance. */
function panView(dx: -1 | 0 | 1, dy: -1 | 0 | 1): void {
  const step = camera.position.distanceTo(controls.target) * 0.1;
  const right = new THREE.Vector3().setFromMatrixColumn(camera.matrix, 0);
  right.y = 0;
  const up = new THREE.Vector3().setFromMatrixColumn(camera.matrix, 1);
  up.y = 0;
  if (right.lengthSq() < 1e-8 || up.lengthSq() < 1e-8) return;
  right.normalize();
  up.normalize();
  const move = right.multiplyScalar(dx * step).add(up.multiplyScalar(-dy * step));
  camera.position.add(move);
  controls.target.add(move);
  controls.update();
}

// ---------------------------------------------------------------- tools

function selectTool(next: Tool): void {
  tool = next;
  dispatcher.setTool(next);
  if (tool !== "block") blockOutline.visible = false;
  if (tool !== "smoothBox") {
    dispatcher.cancelBoxDrag();
    stroking = stroking && dispatcher.isStroking();
    clearBoxOutline();
  }
  blockReadoutLine = null;
  shell.info.set("brush", "-");
  if (lastHit) paintRing(lastHit);
  updateZoomHint();
}

// ---------------------------------------------------------------- picking + readout

const raycaster = new THREE.Raycaster();
const ndc = new THREE.Vector2();
const normalScratch = { x: 0, y: 1, z: 0 };

function nearestEdgeId(a: TerrainArea, x: number, z: number): string {
  let best = Number.POSITIVE_INFINITY;
  let id = -1;
  for (const e of a.graph.edges) {
    const pts = e.points;
    for (let i = 0; i + 1 < pts.length; i++) {
      const [ax, , az] = pts[i];
      const [bx, , bz] = pts[i + 1];
      const abx = bx - ax;
      const abz = bz - az;
      const len2 = abx * abx + abz * abz;
      const t = len2 > 0 ? Math.min(1, Math.max(0, ((x - ax) * abx + (z - az) * abz) / len2)) : 0;
      const d = Math.hypot(x - (ax + abx * t), z - (az + abz * t));
      if (d < best) {
        best = d;
        id = e.id;
      }
    }
  }
  return id < 0 ? "none" : `${id} (${best.toFixed(1)} m)`;
}

function pickTerrain(clientX: number, clientY: number) {
  if (!area) return null;
  const rect = canvas.getBoundingClientRect();
  ndc.set(
    ((clientX - rect.left) / rect.width) * 2 - 1,
    -((clientY - rect.top) / rect.height) * 2 + 1,
  );
  raycaster.setFromCamera(ndc, camera);
  const r = raycaster.ray;
  return raycastTerrain(area.grid, r.origin, r.direction, camera.far * 2);
}

function ringRadius(): number {
  return tool === "road" || tool === "stamp" || tool === "smoothBox" || tool === "gridSelect"
    ? CURSOR_RADIUS_M
    : dispatcher.getOptions().radiusM;
}

/** Draws the block preview; returns the readout line, or null when off-grid. */
function paintBlockOutline(hit: { x: number; z: number }): string | null {
  if (!area) return null;
  const g = area.grid;
  const w = blockWindowAt(g, hit.x, hit.z, dispatcher.getOptions().blockCells);
  if (!w) {
    blockOutline.visible = false;
    return null;
  }
  const pos = blockOutlineGeometry.getAttribute("position") as THREE.BufferAttribute;
  const x0 = g.originX + w.minCol * g.cellSizeM;
  const x1 = g.originX + w.maxCol * g.cellSizeM;
  const z0 = g.originZ + w.minRow * g.cellSizeM;
  const z1 = g.originZ + w.maxRow * g.cellSizeM;
  let k = 0;
  const put = (x: number, z: number): void => {
    if (k >= BLOCK_OUTLINE_POINTS_MAX) return;
    pos.setXYZ(k++, x, sampleTerrainHeight(g, x, z) + 0.05, z);
  };
  // Walk the perimeter vertex by vertex so every edge hugs the terrain.
  for (let c = w.minCol; c < w.maxCol; c++) put(g.originX + c * g.cellSizeM, z0);
  for (let r = w.minRow; r < w.maxRow; r++) put(x1, g.originZ + r * g.cellSizeM);
  for (let c = w.maxCol; c > w.minCol; c--) put(g.originX + c * g.cellSizeM, z1);
  for (let r = w.maxRow; r > w.minRow; r--) put(x0, g.originZ + r * g.cellSizeM);
  blockOutlineGeometry.setDrawRange(0, k);
  pos.needsUpdate = true;
  (blockOutline.material as THREE.LineBasicMaterial).color.setHex(
    slopeAmber ? RING_AMBER : BLOCK_YELLOW,
  );
  blockOutline.visible = true;
  const stride = g.rows + 1;
  const h = g.heights[w.minRow + w.minCol * stride];
  const cols = w.maxCol - w.minCol;
  const rows = w.maxRow - w.minRow;
  const metres = Math.round(cols * g.cellSizeM * 100) / 100;
  return `Block ${cols} x ${rows} (${metres} m) at height ${h.toFixed(2)} m`;
}

let blockReadoutLine: string | null = null;

/** Draws the smooth-area box from the drag start to the cursor; returns the readout line. */
function paintSmoothBox(hit: { x: number; z: number }): string | null {
  if (!area) return null;
  const g = area.grid;
  const o = dispatcher.getOptions();
  const w = dispatcher.smoothBoxWindow(hit.x, hit.z);
  if (!w) {
    clearBoxOutline();
    return `Smooth area: press and drag a box (${o.smoothPasses} passes, strength ${o.smoothStrength})`;
  }
  const pts: number[] = [];
  const put = (x: number, z: number): void => {
    pts.push(x, sampleTerrainHeight(g, x, z) + 0.12, z);
  };
  const x0 = g.originX + w.minCol * g.cellSizeM;
  const x1 = g.originX + w.maxCol * g.cellSizeM;
  const z0 = g.originZ + w.minRow * g.cellSizeM;
  const z1 = g.originZ + w.maxRow * g.cellSizeM;
  for (let c = w.minCol; c < w.maxCol; c++) put(g.originX + c * g.cellSizeM, z0);
  for (let r = w.minRow; r < w.maxRow; r++) put(x1, g.originZ + r * g.cellSizeM);
  for (let c = w.maxCol; c > w.minCol; c--) put(g.originX + c * g.cellSizeM, z1);
  for (let r = w.maxRow; r > w.minRow; r--) put(x0, g.originZ + r * g.cellSizeM);
  boxOutline.geometry.dispose();
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(pts), 3));
  boxOutline.geometry = geo;
  boxOutline.visible = true;
  const cols = w.maxCol - w.minCol;
  const rows = w.maxRow - w.minRow;
  const round = (v: number) => Math.round(v * 100) / 100;
  return `Smooth area ${cols} x ${rows} cells (${round(cols * g.cellSizeM)} x ${round(rows * g.cellSizeM)} m), ${o.smoothPasses} passes`;
}

function paintRing(hit: { x: number; z: number }): void {
  if (!area) return;
  if (tool === "smoothBox") {
    blockOutline.visible = false;
    blockReadoutLine = paintSmoothBox(hit);
    const dragging = dispatcher.smoothBoxWindow(hit.x, hit.z) !== null;
    if (dragging) {
      cursorRing.visible = false;
      return;
    }
  } else {
    clearBoxOutline();
  }
  if (tool === "block") {
    cursorRing.visible = false;
    blockReadoutLine = paintBlockOutline(hit);
    return;
  }
  blockOutline.visible = false;
  if (tool !== "smoothBox") blockReadoutLine = null;
  const radius = ringRadius();
  const pos = ringGeometry.getAttribute("position") as THREE.BufferAttribute;
  for (let i = 0; i < RING_SEGMENTS; i++) {
    const ang = (i / RING_SEGMENTS) * Math.PI * 2;
    const px = hit.x + Math.cos(ang) * radius;
    const pz = hit.z + Math.sin(ang) * radius;
    pos.setXYZ(i, px, sampleTerrainHeight(area.grid, px, pz) + 0.15, pz);
  }
  pos.needsUpdate = true;
  (cursorRing.material as THREE.LineBasicMaterial).color.setHex(
    slopeAmber ? RING_AMBER : tool === "smoothBox" ? BOX_CYAN : RING_GREEN,
  );
  cursorRing.visible = true;
}

/** D-22 zoom check: flag cells too small to see, without clobbering other hints. */
function updateZoomHint(): void {
  if (!area) return;
  let show = false;
  if (HEIGHT_TOOLS.includes(tool)) {
    const target = lastHit
      ? new THREE.Vector3(
          lastHit.x,
          sampleTerrainHeight(area.grid, lastHit.x, lastHit.z),
          lastHit.z,
        )
      : controls.target;
    const dist = camera.position.distanceTo(target);
    const px = cellPixelSize(dist, camera.fov, canvas.clientHeight, area.grid.cellSizeM);
    show = needsZoomHint(px);
  }
  // Only swap between the default hint and ours, so other hints (slope clamp) win.
  const current = currentHint;
  if (show && current === DEFAULT_HINT) setHint(ZOOM_HINT);
  else if (!show && current === ZOOM_HINT) setHint(DEFAULT_HINT);
}

// ---------------------------------------------------------------- grid / contour overlays (D-22)

const gridLines = new THREE.LineSegments(
  new THREE.BufferGeometry(),
  new THREE.LineBasicMaterial({ color: 0x88aacc, transparent: true, opacity: 0.55 }),
);
const contourLines = new THREE.LineSegments(
  new THREE.BufferGeometry(),
  new THREE.LineBasicMaterial({ color: 0xff8855 }),
);
for (const l of [gridLines, contourLines]) {
  l.frustumCulled = false;
  l.visible = false;
  scene.add(l);
}
let overlayCentre: { row: number; col: number } | null = null;

// Quick 261110-rdx: road lock overlay (grey = locked, orange = unlocked, cyan = selected).
const ROAD_LOCK_LIFT_M = 0.4;
const lockedLines = new THREE.LineSegments(
  new THREE.BufferGeometry(),
  new THREE.LineBasicMaterial({ color: 0xcfd4da, depthTest: false }),
);
const unlockedLines = new THREE.LineSegments(
  new THREE.BufferGeometry(),
  new THREE.LineBasicMaterial({ color: 0xff8a1f, depthTest: false }),
);
const selectedLines = new THREE.LineSegments(
  new THREE.BufferGeometry(),
  new THREE.LineBasicMaterial({ color: 0x44ddff, depthTest: false }),
);
for (const l of [lockedLines, unlockedLines, selectedLines]) {
  l.frustumCulled = false;
  l.renderOrder = 997;
  scene.add(l);
}

function refreshRoadLockOverlay(): void {
  if (!area) {
    for (const l of [lockedLines, unlockedLines, selectedLines]) l.visible = false;
    return;
  }
  const segs = roadLockSegments(
    area.graph,
    (area as unknown as EditArea).unlockedEdgeIds,
    dispatcher.getSelectedEdgeId(),
    ROAD_LOCK_LIFT_M,
  );
  const set = (target: THREE.LineSegments, data: Float32Array): void => {
    target.geometry.dispose();
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(data, 3));
    target.geometry = g;
    target.visible = data.length > 0;
  };
  set(lockedLines, segs.locked);
  set(unlockedLines, segs.unlocked);
  set(selectedLines, segs.selected);
}

function overlayOn(): boolean {
  return showGrid || showContours;
}

function contourIntervalM(): number {
  return Math.min(CONTOUR_MAX_M, Math.max(CONTOUR_MIN_M, contourInterval));
}

function overlayWindow(row: number, col: number): CellWindow | null {
  if (!area) return null;
  const g = area.grid;
  const half = OVERLAY_CELLS / 2;
  const w = {
    minRow: Math.max(0, row - half),
    minCol: Math.max(0, col - half),
    maxRow: Math.min(g.rows, row + half),
    maxCol: Math.min(g.cols, col + half),
  };
  return w.minRow < w.maxRow && w.minCol < w.maxCol ? w : null;
}

function setLines(target: THREE.LineSegments, data: Float32Array): void {
  target.geometry.dispose();
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(data, 3));
  target.geometry = g;
}

function rebuildOverlays(x: number, z: number): void {
  if (!area) return;
  const g = area.grid;
  gridLines.visible = showGrid;
  contourLines.visible = showContours;
  const row = Math.round((z - g.originZ) / g.cellSizeM);
  const col = Math.round((x - g.originX) / g.cellSizeM);
  const w = overlayWindow(row, col);
  if (!w) return;
  overlayCentre = { row, col };
  if (showGrid) setLines(gridLines, gridLineSegments(g, w));
  if (showContours) setLines(contourLines, contourSegments(g, w, contourIntervalM()));
}

function overlayAnchor(): { x: number; z: number } {
  return lastHit ?? { x: controls.target.x, z: controls.target.z };
}

function maybeRebuildOverlays(x: number, z: number): void {
  if (!area || !overlayOn()) return;
  const g = area.grid;
  const row = Math.round((z - g.originZ) / g.cellSizeM);
  const col = Math.round((x - g.originX) / g.cellSizeM);
  if (
    overlayCentre === null ||
    Math.abs(row - overlayCentre.row) > OVERLAY_RECENTRE_CELLS ||
    Math.abs(col - overlayCentre.col) > OVERLAY_RECENTRE_CELLS
  ) {
    rebuildOverlays(x, z);
  }
}

function refreshOverlaysAfterEdit(w: CellWindow | undefined): void {
  if (!w || !overlayCentre || !area || !overlayOn()) return;
  const g = area.grid;
  const half = OVERLAY_CELLS / 2;
  const intersects =
    w.maxRow >= overlayCentre.row - half &&
    w.minRow <= overlayCentre.row + half &&
    w.maxCol >= overlayCentre.col - half &&
    w.minCol <= overlayCentre.col + half;
  if (intersects) {
    rebuildOverlays(
      g.originX + overlayCentre.col * g.cellSizeM,
      g.originZ + overlayCentre.row * g.cellSizeM,
    );
  }
}

function refreshOverlays(): void {
  const a = overlayAnchor();
  rebuildOverlays(a.x, a.z);
}

function updateCursor(clientX: number, clientY: number): void {
  if (!area) return;
  const hit = pickTerrain(clientX, clientY);
  if (!hit) {
    cursorRing.visible = false;
    blockOutline.visible = false;
    if (!stroking) clearBoxOutline();
    lastHit = null;
    for (const k of ["cursor", "height", "slope", "surface", "road"]) shell.info.set(k, "-");
    return;
  }
  lastHit = { x: hit.x, z: hit.z };
  paintRing(hit);
  maybeRebuildOverlays(hit.x, hit.z);

  terrainTriangleNormal(area.grid, hit.x, hit.z, normalScratch);
  const slopeDeg = (Math.acos(Math.min(1, normalScratch.y)) * 180) / Math.PI;
  const info = shell.info;
  info.set("cursor", `x ${hit.x.toFixed(1)}  z ${hit.z.toFixed(1)}`);
  info.set("height", fmtMetres(hit.y, 2));
  info.set("slope", `${slopeDeg.toFixed(1)} deg`);
  info.set("surface", surfaceAt(area.paint, hit.x, hit.z));
  info.set("road", nearestEdgeId(area, hit.x, hit.z));
  info.set(
    "brush",
    (tool === "block" || tool === "smoothBox") && blockReadoutLine ? blockReadoutLine : "-",
  );
}

// ---------------------------------------------------------------- stroke application

function updateHistoryButtons(): void {
  shell.setHistoryState(dispatcher.canUndo(), dispatcher.canRedo());
}

function rebuild(w: CellWindow | undefined, what: { heights?: boolean; paint?: boolean }): void {
  if (!w || !terrainView) return;
  terrainView.rebuildRegion(w.minRow, w.minCol, w.maxRow, w.maxCol, what);
}

function validateRoads(): void {
  if (!area) return;
  try {
    const failures = validateGraph(area.graph, buildRoadGeometry(area.graph));
    const reach = failures.filter((f) => f.category === "UNDIRECTED_REACHABILITY");
    const selfX = failures.filter((f) => f.category === "GEOMETRY_SELF_INTERSECTION");
    if (reach.length > 0) {
      messageLog.add(
        `${reach.length} disconnected road piece(s); fine while the map is mid-build.`,
      );
    }
    if (selfX.length > 0) {
      messageLog.add(
        `${selfX.length} self-intersection(s) ignored on terrain maps (no ribbon mesh).`,
      );
    }
    const text = saveBlockMessage(blockingRoadFailures(area.graph));
    if (text !== null) {
      say(text, "error");
    }
  } catch (err) {
    messageLog.add(
      `Road graph check failed: ${err instanceof Error ? err.message : String(err)}`,
      "error",
    );
  }
}

function applyResult(res: ToolResult, ms: number): void {
  rebuild(res.dirtyHeights, { heights: true });
  rebuild(res.dirtyPaint, { paint: true });
  refreshOverlaysAfterEdit(res.dirtyHeights);
  const edited =
    res.dirtyHeights !== undefined ||
    res.dirtyPaint !== undefined ||
    res.graphChanged ||
    res.lockChanged;
  if (res.graphChanged || res.lockChanged || res.selectionChanged) refreshRoadLockOverlay();
  if (edited) {
    setDirty(true);
    lastEditMs = ms;
  }
  slopeAmber = res.slopeClamped;
  if (res.previewPoints !== undefined) setPreview(res.previewPoints);
  for (const w of res.warnings) messageLog.add(w);
  if (res.status !== undefined) {
    say(res.status);
    if (res.status === SLOPE_CLAMP_HINT) setHint(SLOPE_CLAMP_HINT);
  } else if (edited) {
    say(`Edited (${ms.toFixed(1)} ms).`);
  }
  if (res.graphChanged) validateRoads();
}

function strokeEvent(e: PointerEvent, phase: "down" | "move" | "up"): void {
  if (!area) return;
  const hit = pickTerrain(e.clientX, e.clientY);
  if (hit) lastHit = { x: hit.x, z: hit.z };
  const t0 = performance.now();
  let res: ToolResult;
  if (phase === "down") {
    if (!hit) return;
    stroking = true;
    res = dispatcher.pointerDown(hit.x, hit.z, { ctrl: e.ctrlKey || e.metaKey, shift: e.shiftKey });
  } else if (phase === "move") {
    if (!hit) return;
    res = dispatcher.pointerMove(hit.x, hit.z, { ctrl: e.ctrlKey || e.metaKey, shift: e.shiftKey });
  } else {
    stroking = false;
    setPreview(null);
    const end = hit ?? lastHit;
    res = dispatcher.pointerUp(end ? end.x : Number.NaN, end ? end.z : Number.NaN);
  }
  applyResult(res, performance.now() - t0);
  if (phase === "up") {
    slopeAmber = false;
    setHint(DEFAULT_HINT);
    updateHistoryButtons();
  }
  if (hit) paintRing(hit);
}

canvas.addEventListener("pointerdown", (e) => {
  if (e.button !== 0 || !area) return;
  canvas.setPointerCapture(e.pointerId);
  strokeEvent(e, "down");
});
canvas.addEventListener("pointermove", (e) => {
  // A dialog opening mid-stroke ends the stroke through the normal pointer-up path.
  if (stroking && shell.isDialogOpen()) {
    strokeEvent(e, "up");
    if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
    return;
  }
  updateCursor(e.clientX, e.clientY);
  if (stroking) strokeEvent(e, "move");
});
canvas.addEventListener("pointerup", (e) => {
  if (e.button !== 0 || !stroking) return;
  strokeEvent(e, "up");
  if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
});
canvas.addEventListener("pointercancel", (e) => {
  if (stroking) strokeEvent(e, "up");
});
canvas.addEventListener("pointerleave", () => {
  if (!stroking) {
    cursorRing.visible = false;
    blockOutline.visible = false;
    clearBoxOutline();
  }
});

function undoRedo(kind: "undo" | "redo"): void {
  if (!area || stroking) return;
  const t0 = performance.now();
  const r = kind === "undo" ? dispatcher.undo() : dispatcher.redo();
  if (!r) return;
  rebuild(r.dirtyHeights, { heights: true });
  rebuild(r.dirtyPaint, { paint: true });
  refreshOverlaysAfterEdit(r.dirtyHeights);
  setDirty(true);
  lastEditMs = performance.now() - t0;
  say(kind === "undo" ? "Undid last stroke." : "Redid stroke.");
  updateHistoryButtons();
  if (r.graphChanged || r.lockChanged) refreshRoadLockOverlay();
  if (r.graphChanged) validateRoads();
}

/** D-18: the block size label shows metres (N x cell size) for the loaded area. */
function syncBlockLabel(): void {
  const n = dispatcher.getOptions().blockCells;
  const cell = area ? area.grid.cellSizeM : DEFAULT_CELL_SIZE_M;
  const metres = Math.round(n * cell * 100) / 100;
  blockLabel?.set(`${n} x ${n} (${metres} m)`);
}

async function smoothWholeMap(): Promise<void> {
  if (!area || stroking) return;
  const passes = dispatcher.getOptions().smoothPasses;
  say("Smoothing whole map...");
  // Yield one frame so the status paints before the synchronous smooth runs.
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  if (!area) return;
  const t0 = performance.now();
  const res = dispatcher.smoothAll();
  res.status = `Smoothed whole map (${passes} passes). Ctrl+Z undoes it.`;
  applyResult(res, performance.now() - t0);
  updateHistoryButtons();
}

// ---------------------------------------------------------------- drive here

async function driveHere(): Promise<void> {
  if (!area) return;
  const id = area.areaId;
  const terrainIds = (KNOWN_MAP_IDS as readonly string[]).filter(
    (m) => MAP_FORMATS[m as MapId] === "terrain",
  );
  if (!terrainIds.includes(id)) {
    const text = `Drive here needs a registered terrain map id (${terrainIds.join(", ")}).`;
    say(text, "error");
    return;
  }
  const spot = lastHit ?? { x: controls.target.x, z: controls.target.z };
  if (!(await save())) return;
  const url = `/?map=${id}&at=${spot.x.toFixed(1)},${spot.z.toFixed(1)}&debug`;
  const w = window.open(url, "_blank");
  if (!w) say(`Pop-up blocked. Open ${url} manually.`, "error");
}

// ---------------------------------------------------------------- wiring

installShortcuts(bindings, shell.isDialogOpen);

window.addEventListener("beforeunload", (e) => {
  if (dirty) e.preventDefault();
});

// ---------------------------------------------------------------- frame loop

function frame(): void {
  controls.update();
  updateZoomHint();
  terrainView?.updateTextures(controls.target.x, controls.target.z);
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}

selectTool(tool);
updateHistoryButtons();
updateAreaInfo();
setHint(DEFAULT_HINT);
say("Pick an area at the top and press Load, or use File > New...");
refreshAreaList()
  .catch((err) => {
    say(`Cannot list areas: ${err instanceof Error ? err.message : String(err)}`, "error");
  })
  .finally(() => reportMissingTips(document.body));
requestAnimationFrame(frame);
