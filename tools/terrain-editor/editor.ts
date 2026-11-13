/**
 * Dev-only 3D terrain sculpt page (D-09). This module is the shell: scene,
 * orbit / top-down camera, terrain picking, area list / new / load / save via
 * the `/__terrain/*` middleware, cursor ring and readouts, and the DOM glue
 * for the tool dispatcher (tools, options, shortcuts, undo/redo, validator
 * log, Drive here).
 */
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { buildRoadGeometry } from "../../src/core/road-geometry.ts";
import { SURFACE_TYPES, type SurfaceType } from "../../src/core/surface-types.ts";
import { BLOCK_CELLS_MAX, blockWindowAt, stepRadiusCells } from "../../src/core/terrain-brush.ts";
import {
  encodeTerrainBinary,
  loadTerrainArea,
  serializeTerrainSidecar,
  type TerrainArea,
} from "../../src/core/terrain-format.ts";
import { sampleTerrainHeight } from "../../src/core/terrain-grid.ts";
import { DEFAULT_CELL_SIZE_M, MAX_AREA_SIZE_M } from "../../src/core/terrain-limits.ts";
import {
  cellPixelSize,
  contourIntervalForZoom,
  contourSegments,
  FOOTPRINT_LIFT_M,
  footprintGridSegments,
  footprintOutline,
  gridLineSegments,
  needsZoomHint,
  roadLockSegments,
  stampOutline,
} from "../../src/core/terrain-overlay.ts";
import { surfaceAt } from "../../src/core/terrain-paint.ts";
import { raycastTerrain } from "../../src/core/terrain-pick.ts";
import { ROAD_PRESETS, type RoadPresetId } from "../../src/core/terrain-road.ts";
import { staleUnlockedEdges } from "../../src/core/terrain-road-lock.ts";
import type { CellWindow } from "../../src/core/terrain-slope.ts";
import {
  buildTerrainView,
  TERRAIN_SURFACE_PALETTE,
  type TerrainView,
} from "../../src/render/terrain-view.ts";
import {
  createButton,
  createField,
  createSection,
  createSelect,
  createStepper,
  el,
} from "../editor-shell/controls.ts";
import { confirmDialog, openDialog } from "../editor-shell/dialog.ts";
import { fmt3 } from "../editor-shell/format.ts";
import {
  adjustDirection,
  type Binding,
  isTextEntryFocused,
  resolveShortcut,
  STANDARD_BINDINGS,
} from "../editor-shell/keys.ts";
import { createShell, type ShellTool } from "../editor-shell/shell.ts";
import { type StepperSpec, stepValue } from "../editor-shell/stepper.ts";
import { auditTips } from "../editor-shell/tooltips.ts";
import { validateGraph } from "../map-compiler/validate/validator.ts";
import { createEmptyTerrainArea } from "./new-area.ts";
import { buildRoadProblems, type FixKind, type RoadProblemRow } from "./road-problems.ts";
import { blockingRoadFailures, saveBlockMessage, staleRoadBlockMessage } from "./save-guard.ts";
import { putTerrainPair } from "./save-pair.ts";
import {
  createToolDispatcher,
  type EditArea,
  SLOPE_LIMIT_MAX_DEG,
  SLOPE_LIMIT_MIN_DEG,
  TOOL_KEYS,
  type Tool,
  type ToolResult,
} from "./tool-dispatch.ts";

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const canvas = $<HTMLCanvasElement>("view");
const wrap = $("wrap");

const NAME_RE = /^[a-z0-9-]{1,64}$/;
const DEFAULT_HINT =
  "Left-drag to sculpt. Middle-drag (or right-drag) to tilt and spin, Shift+right-drag or Ctrl+wheel to pan, wheel to zoom, Alt+wheel = brush size in cells.";
const CURSOR_RADIUS_M = 8;
const RING_SEGMENTS = 64;
const ZOOM_HINT = "Zoom in to see single cells.";
const HEIGHT_TOOLS: readonly Tool[] = ["block", "raise", "lower", "smooth", "flatten", "smoothBox"];
/** Contour window size in cells (T-04.3-28 cap) and re-centre threshold. */
const OVERLAY_CELLS = 64;
const CONTOUR_RECENTRE_CELLS = 16;
/** Footprint grid is skipped beyond this many cells per side (T-x00-01 cap). */
const FOOTPRINT_GRID_MAX_CELLS = 160;
/** Radius brushes that draw the standout yellow footprint. */
const FOOTPRINT_TOOLS: readonly Tool[] = ["raise", "lower", "smooth", "flatten", "paint"];
const FOOTPRINT_YELLOW = 0xffd400;
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
let topDown = false;
let savedPose: { pos: THREE.Vector3; target: THREE.Vector3 } | null = null;
let knownAreas: string[] = [];
let saving = false;
let editCounter = 0;
let gridOn = false;
let contoursOn = false;
let contourInterval = 1;
let currentHint = "";
const logLines: string[] = [];
const LOG_MAX = 200;
let activePointerId: number | null = null;
/** Ctrl+drag push/pull in progress (Ctrl is read at pointerdown only). */
let pushPull: {
  startY: number;
  pointerId: number;
  dirtyBefore: boolean;
  lastDeltaM: number;
} | null = null;
const PUSH_PULL_M_PER_PX = 0.05;
const PUSH_PULL_FINE_M_PER_PX = 0.01;
const NO_AREA_MSG = "Load or create an area first (File > Open area or File > New).";
const NO_SELECTION_CLICK_MSG = "Select some cells first (Grid select, S), then Ctrl+drag.";

// ---------------------------------------------------------------- three setup

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
    if (e.altKey) {
      // Alt + wheel: brush radius in whole terrain cells (block size on Block).
      e.preventDefault();
      e.stopImmediatePropagation();
      const raw = e.deltaY || e.deltaX;
      if (raw !== 0) altWheelStep(raw < 0 ? 1 : -1);
      return;
    }
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

// Stamp rise arrow: shaft + two head strokes along the wedge's rising (+X) direction.
const STAMP_ARROW_POINTS = 6;
const stampArrowGeometry = new THREE.BufferGeometry();
stampArrowGeometry.setAttribute(
  "position",
  new THREE.BufferAttribute(new Float32Array(STAMP_ARROW_POINTS * 3), 3),
);
const stampArrow = new THREE.LineSegments(
  stampArrowGeometry,
  new THREE.LineBasicMaterial({ color: FOOTPRINT_YELLOW, depthTest: false, transparent: true }),
);
stampArrow.renderOrder = 999;
stampArrow.frustumCulled = false;
stampArrow.visible = false;
scene.add(stampArrow);

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

/** Terrain-hugging perimeter of a vertex window, lifted above the surface. */
function windowPerimeter(w: CellWindow, lift: number): Float32Array | null {
  if (!area) return null;
  const g = area.grid;
  const pts: number[] = [];
  const put = (x: number, z: number): void => {
    pts.push(x, sampleTerrainHeight(g, x, z) + lift, z);
  };
  const x0 = g.originX + w.minCol * g.cellSizeM;
  const x1 = g.originX + w.maxCol * g.cellSizeM;
  const z0 = g.originZ + w.minRow * g.cellSizeM;
  const z1 = g.originZ + w.maxRow * g.cellSizeM;
  for (let c = w.minCol; c < w.maxCol; c++) put(g.originX + c * g.cellSizeM, z0);
  for (let r = w.minRow; r < w.maxRow; r++) put(x1, g.originZ + r * g.cellSizeM);
  for (let c = w.maxCol; c > w.minCol; c--) put(g.originX + c * g.cellSizeM, z1);
  for (let r = w.maxRow; r > w.minRow; r--) put(x0, g.originZ + r * g.cellSizeM);
  return new Float32Array(pts);
}

function setOutline(line: THREE.LineLoop, w: CellWindow | null, lift: number): void {
  line.geometry.dispose();
  const arr = w ? windowPerimeter(w, lift) : null;
  const geo = new THREE.BufferGeometry();
  if (arr) geo.setAttribute("position", new THREE.BufferAttribute(arr, 3));
  line.geometry = geo;
  line.visible = arr !== null;
}

let selectionReadoutEl: HTMLElement | null = null;

/** Rebuilds the persistent Grid select outline and its flyout read-out (heights move under it). */
function refreshSelectionOutline(): void {
  const sel = area ? dispatcher.getSelection() : null;
  setOutline(selectionOutline, sel, 0.2);
  if (!selectionReadoutEl) return;
  if (!sel || !area) {
    selectionReadoutEl.textContent = "Nothing selected";
    return;
  }
  const cols = sel.maxCol - sel.minCol;
  const rows = sel.maxRow - sel.minRow;
  const c = area.grid.cellSizeM;
  selectionReadoutEl.textContent = `${cols} x ${rows} cells, ${fmt3(cols * c)} x ${fmt3(rows * c)} m`;
}

// Grid select: persistent yellow outline of the selected cells (the cyan box is the live drag).
const selectionOutline = new THREE.LineLoop(
  new THREE.BufferGeometry(),
  new THREE.LineBasicMaterial({ color: BLOCK_YELLOW, depthTest: false, transparent: true }),
);
selectionOutline.renderOrder = 999;
selectionOutline.frustumCulled = false;
selectionOutline.visible = false;
scene.add(selectionOutline);

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

const dispatcher = createToolDispatcher(() => {
  if (!area) throw new Error("no area loaded");
  return area as unknown as EditArea;
});

function resize(): void {
  const w = Math.max(1, wrap.clientWidth);
  const h = Math.max(1, wrap.clientHeight);
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
new ResizeObserver(resize).observe(wrap);
resize();

// ---------------------------------------------------------------- UI helpers

function log(line: string): void {
  logLines.push(line);
  if (logLines.length > LOG_MAX) logLines.splice(0, logLines.length - LOG_MAX);
}

// WR-06: the info bar writes textContent only. Status text can echo file
// content (sidecar parse errors) and server error bodies, so it is never HTML.
function setStatus(text: string, kind: "info" | "ok" | "error" = "info"): void {
  shell.info.status(text, kind);
}

/** Failures: info-bar error style plus the log. Nothing fails silently (D-03). */
function fail(text: string): void {
  setStatus(text, "error");
  log(text);
}

/** Remembers the current hint; only the zoom hint is worth interrupting the status line for. */
function setHint(text: string): void {
  currentHint = text;
  if (text === ZOOM_HINT) setStatus(text);
}

function setDirty(value: boolean): void {
  dirty = value;
  shell.info.setDirty(value);
  // CR-01: every edit bumps the counter, so a save can tell whether anything
  // changed while its PUTs were in flight (and must then stay dirty).
  if (value) editCounter++;
}

async function confirmDiscard(): Promise<boolean> {
  if (!dirty || !area) return true;
  return confirmDialog(
    "Discard unsaved edits?",
    `You have unsaved changes to ${area.areaId}. Discard them and continue?`,
    "Discard",
  );
}

function refreshInfo(): void {
  if (!area) {
    for (const k of ["area", "size", "cell", "cursor", "surface", "roads", "change"])
      shell.info.set(k, "");
    return;
  }
  const g = area.grid;
  shell.info.set("area", area.areaId);
  shell.info.set("size", `${fmt3(g.cols * g.cellSizeM)} x ${fmt3(g.rows * g.cellSizeM)} m`);
  shell.info.set("cell", `${fmt3(g.cellSizeM)} m`);
  shell.info.set("roads", String(area.graph.edges.length));
  refreshRoadProblems();
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

async function refreshAreaList(): Promise<void> {
  const res = await api("/__terrain/areas");
  knownAreas = (await res.json()) as string[];
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
  shell.refreshMenus();
}

function installArea(next: TerrainArea): void {
  if (terrainView) {
    scene.remove(terrainView.group);
    terrainView.dispose();
  }
  area = next;
  dispatcher.clearHistory();
  pushPull = null; // dialogs cancel a live push/pull before an area is replaced
  dispatcher.clearSelection();
  shell.info.set("change", "");
  setPreview(null);
  stroking = false;
  slopeAmber = false;
  updateHistoryButtons();
  terrainView = buildTerrainView(next.grid, next.paint);
  scene.add(terrainView.group);
  $("empty").style.display = "none";
  frameArea(next);
  cursorRing.visible = false;
  stampArrow.visible = false;
  blockOutline.visible = false;
  clearBoxOutline();
  refreshSelectionOutline();
  overlayCentre = null;
  refreshOverlays();
  syncBlockLabel();
  refreshRoadLockOverlay();
  refreshInfo();
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
    setStatus(`Loaded ${id}. ${DEFAULT_HINT}`, "ok");
    log(`loaded ${id}`);
  } catch (err) {
    fail(loadErrorMessage(`${id}.terrain.bin`, err));
  }
}

async function openAreaDialog(): Promise<void> {
  try {
    await refreshAreaList();
  } catch (err) {
    fail(`Cannot list areas: ${err instanceof Error ? err.message : String(err)}`);
    return;
  }
  if (knownAreas.length === 0) {
    setStatus("There are no saved areas yet. Use File > New to start one.");
    return;
  }
  const initial = area && knownAreas.includes(area.areaId) ? area.areaId : knownAreas[0];
  const sel = createSelect({
    options: knownAreas.map((id) => ({ value: id, label: id })),
    value: initial,
    tip: "Choose which saved terrain area to open",
    onChange: () => {},
  });
  const r = await openDialog<"open" | "close">({
    title: "Open area",
    body: createField("Area", sel.el, "Saved terrain areas"),
    actions: [
      { id: "open", label: "Open", tip: "Open the chosen area", primary: true },
      { id: "close", label: "Cancel", tip: "Close without opening anything" },
    ],
  });
  if (r === "open") await loadArea(sel.get());
}

const SIZE_SPEC: StepperSpec = { step: 10, coarse: 10, min: 3, max: MAX_AREA_SIZE_M, decimals: 0 };
const CELL_SPEC: StepperSpec = { step: 0.5, coarse: 2, min: 1, max: 10, decimals: 1 };

async function newAreaDialog(): Promise<void> {
  try {
    await refreshAreaList();
  } catch (err) {
    log(`Cannot refresh the area list: ${err instanceof Error ? err.message : String(err)}`);
  }
  let n = 1;
  while (knownAreas.includes(`new-area-${n}`)) n++;
  const nameInput = el("input", undefined, undefined, "Name for the new area: a-z, 0-9 and -");
  nameInput.type = "text";
  nameInput.maxLength = 64;
  nameInput.value = `new-area-${n}`;
  const width = createStepper({
    value: 1000,
    spec: SIZE_SPEC,
    tip: "Width of the new area in metres",
    unit: "m",
    onChange: () => {},
  });
  const height = createStepper({
    value: 1000,
    spec: SIZE_SPEC,
    tip: "Height (north-south depth) of the new area in metres",
    unit: "m",
    onChange: () => {},
  });
  const cell = createStepper({
    value: DEFAULT_CELL_SIZE_M,
    spec: CELL_SPEC,
    tip: "Size of one terrain cell in metres. Smaller cells give finer detail and a bigger file.",
    unit: "m",
    onChange: () => {},
  });
  const body = el("div");
  body.append(
    createField("Name", nameInput, "Name of the new area"),
    createField("Width (m)", width.el, "Width in metres"),
    createField("Height (m)", height.el, "Height in metres"),
    createSection("Advanced", "Optional settings", false, [
      createField("Cell size (m)", cell.el, "Size of one terrain cell"),
    ]),
  );
  let created: TerrainArea | null = null;
  const r = await openDialog<"create" | "close">({
    title: "New area",
    body,
    actions: [
      {
        id: "create",
        label: "Create",
        tip: "Create a flat grass area of this size",
        primary: true,
        run: () => {
          const name = nameInput.value.trim();
          if (!NAME_RE.test(name)) return "Name may only use a-z, 0-9 and -, 1-64 characters.";
          if (knownAreas.includes(name)) {
            return `An area called "${name}" already exists. Pick another name.`;
          }
          const widthM = width.get();
          const depthM = height.get();
          const cellSizeM = cell.get();
          for (const [label, v] of [
            ["Width", widthM],
            ["Height", depthM],
          ] as const) {
            if (!(v >= SIZE_SPEC.min && v <= MAX_AREA_SIZE_M)) {
              return `${label} must be between ${SIZE_SPEC.min} and ${MAX_AREA_SIZE_M} m.`;
            }
          }
          if (!(cellSizeM >= CELL_SPEC.min && cellSizeM <= CELL_SPEC.max)) {
            return `Cell size must be between ${CELL_SPEC.min} and ${CELL_SPEC.max} m.`;
          }
          try {
            created = createEmptyTerrainArea({ areaId: name, widthM, depthM, cellSizeM });
          } catch (err) {
            return err instanceof Error ? err.message : String(err);
          }
          return undefined;
        },
      },
      { id: "close", label: "Cancel", tip: "Close without creating anything" },
    ],
  });
  const next = created as TerrainArea | null;
  if (r !== "create" || !next) return;
  if (!(await confirmDiscard())) {
    setStatus("New area cancelled. Your unsaved changes were kept.");
    return;
  }
  installArea(next);
  setDirty(true);
  const g = next.grid;
  setStatus(
    `Created flat grass terrain ${fmt3(g.cols * g.cellSizeM)} x ${fmt3(g.rows * g.cellSizeM)} m. Save (Ctrl+S) to write it.`,
    "ok",
  );
  log(`new ${next.areaId} ${g.cols}x${g.rows} cells`);
}

async function save(): Promise<boolean> {
  // CR-01: one save at a time; a second Ctrl+S / Drive here while a save is
  // in flight is refused instead of racing the first one.
  if (!area || saving) {
    if (saving) setStatus("Save already in progress.", "error");
    return false;
  }
  saving = true;
  let registerWarning = "";
  const target = area;
  const editsAtStart = editCounter;
  try {
    // D-15: refuse to save a road graph with a hard validation failure; no PUT.
    const blockText = saveBlockMessage(blockingRoadFailures(target.graph));
    if (blockText !== null) {
      fail(blockText);
      setRoadProblemsOpen(true);
      return false;
    }
    // Quick 261110-rdx (DD-3): an unlocked road that no longer matches the terrain is not saved.
    const staleText = staleRoadBlockMessage(
      target.grid,
      target.graph,
      (target as unknown as EditArea).unlockedEdgeIds,
    );
    if (staleText !== null) {
      fail(staleText);
      setRoadProblemsOpen(true);
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
      async (kind, body) => {
        const res = await api(`/__terrain/${target.areaId}/${kind}`, { method: "PUT", body });
        const out = (await res.json().catch(() => ({}))) as { warning?: string };
        if (out.warning) registerWarning = out.warning;
        return out;
      },
      bin as BodyInit,
      sidecar,
    );
    const editedDuringSave = editCounter !== editsAtStart || area !== target;
    if (!editedDuringSave) setDirty(false);
    const kb = Math.round(bin.length / 1024);
    setStatus(
      editedDuringSave
        ? `Saved ${target.areaId} v1, ${kb} KB. Edits made during the save are not saved yet.`
        : `Saved ${target.areaId} v1, ${kb} KB`,
      "ok",
    );
    log(`saved ${target.areaId} (${kb} KB)`);
    if (registerWarning !== "") fail(registerWarning);
    await refreshAreaList().catch(() => {});
    return true;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    fail(`Save failed: ${msg}. Your edits are still in memory; fix the problem and save again.`);
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
  shell.refreshMenus();
}

// ---------------------------------------------------------------- tools

function selectTool(next: Tool): void {
  if (pushPull) cancelPushPullDrag("Push/pull cancelled.");
  tool = next;
  dispatcher.setTool(next);
  if (tool !== "block") blockOutline.visible = false;
  if (tool !== "smoothBox") {
    dispatcher.cancelBoxDrag();
    stroking = stroking && dispatcher.isStroking();
    clearBoxOutline();
  }
  buildFlyout(next);
  if (lastHit) paintRing(lastHit);
  updateZoomHint();
}

// ---------------------------------------------------------------- picking + readout

const raycaster = new THREE.Raycaster();
const ndc = new THREE.Vector2();

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

/** Footprint shape of the active tool: the Shape option for the five radius brushes, else round. */
function footprintShape(): "round" | "square" {
  return FOOTPRINT_TOOLS.includes(tool) ? dispatcher.getOptions().brushShape : "round";
}

function ringRadius(): number {
  return tool === "road" || tool === "stamp" || tool === "smoothBox"
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

/** Draws the cursor shapes for the active tool, then refreshes the footprint grid under it. */
function paintRing(hit: { x: number; z: number }): void {
  paintRingShapes(hit);
  updateFootprintGrid(hit);
}

function paintRingShapes(hit: { x: number; z: number }): void {
  if (!area) return;
  if (tool === "gridSelect") {
    cursorRing.visible = false;
    stampArrow.visible = false;
    blockOutline.visible = false;
    const w = pushPull ? null : dispatcher.selectionPreview(hit.x, hit.z);
    if (w) setOutline(boxOutline, w, 0.12);
    else clearBoxOutline();
    return;
  }
  if (tool === "smoothBox") {
    blockOutline.visible = false;
    blockReadoutLine = paintSmoothBox(hit);
    const dragging = dispatcher.smoothBoxWindow(hit.x, hit.z) !== null;
    if (dragging) {
      cursorRing.visible = false;
      stampArrow.visible = false;
      return;
    }
  } else {
    clearBoxOutline();
  }
  if (tool === "block") {
    cursorRing.visible = false;
    stampArrow.visible = false;
    blockReadoutLine = paintBlockOutline(hit);
    return;
  }
  blockOutline.visible = false;
  if (tool !== "smoothBox") blockReadoutLine = null;
  if (tool === "stamp") {
    paintStampOutline(hit);
    return;
  }
  stampArrow.visible = false;
  const radius = ringRadius();
  const outline = footprintOutline(hit.x, hit.z, radius, footprintShape(), RING_SEGMENTS);
  const n = Math.min(RING_SEGMENTS, outline.length / 2);
  const pos = ringGeometry.getAttribute("position") as THREE.BufferAttribute;
  for (let i = 0; i < n; i++) {
    const px = outline[i * 2];
    const pz = outline[i * 2 + 1];
    pos.setXYZ(i, px, sampleTerrainHeight(area.grid, px, pz) + FOOTPRINT_LIFT_M, pz);
  }
  ringGeometry.setDrawRange(0, n);
  pos.needsUpdate = true;
  const base = FOOTPRINT_TOOLS.includes(tool)
    ? FOOTPRINT_YELLOW
    : tool === "smoothBox"
      ? BOX_CYAN
      : RING_GREEN;
  (cursorRing.material as THREE.LineBasicMaterial).color.setHex(slopeAmber ? RING_AMBER : base);
  cursorRing.visible = true;
}

/** Stamp tool: the real rotated footprint plus the rise arrow, in place of the round ring. */
function paintStampOutline(hit: { x: number; z: number }): void {
  if (!area) return;
  const o = dispatcher.getOptions();
  const shape = stampOutline({
    kind: o.stampKind,
    x: hit.x,
    z: hit.z,
    rotationRad: o.stampRotationRad,
    lengthM: o.stampLengthM,
    widthM: o.stampWidthM,
  });
  const n = Math.min(RING_SEGMENTS, shape.outline.length / 2);
  const pos = ringGeometry.getAttribute("position") as THREE.BufferAttribute;
  // Sample along each edge too: a long straight edge over hills should hug the ground.
  const pts: number[] = [];
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const ax = shape.outline[i * 2];
    const az = shape.outline[i * 2 + 1];
    const bx = shape.outline[j * 2];
    const bz = shape.outline[j * 2 + 1];
    const sub = o.stampKind === "wedge" ? Math.max(1, Math.floor(RING_SEGMENTS / n)) : 1;
    for (let k = 0; k < sub; k++) {
      const t = k / sub;
      pts.push(ax + (bx - ax) * t, az + (bz - az) * t);
    }
  }
  const count = Math.min(RING_SEGMENTS, pts.length / 2);
  for (let i = 0; i < count; i++) {
    const px = pts[i * 2];
    const pz = pts[i * 2 + 1];
    pos.setXYZ(i, px, sampleTerrainHeight(area.grid, px, pz) + FOOTPRINT_LIFT_M, pz);
  }
  ringGeometry.setDrawRange(0, count);
  pos.needsUpdate = true;
  (cursorRing.material as THREE.LineBasicMaterial).color.setHex(
    slopeAmber ? RING_AMBER : FOOTPRINT_YELLOW,
  );
  cursorRing.visible = true;

  const apos = stampArrowGeometry.getAttribute("position") as THREE.BufferAttribute;
  const an = Math.min(STAMP_ARROW_POINTS, shape.arrow.length / 2);
  for (let i = 0; i < an; i++) {
    const px = shape.arrow[i * 2];
    const pz = shape.arrow[i * 2 + 1];
    apos.setXYZ(i, px, sampleTerrainHeight(area.grid, px, pz) + FOOTPRINT_LIFT_M * 1.5, pz);
  }
  stampArrowGeometry.setDrawRange(0, an);
  apos.needsUpdate = true;
  stampArrow.visible = an > 0;
}

/** On-screen size (px) of one terrain cell at the cursor hit point (or the orbit target). */
function cellPxAtAnchor(): number {
  if (!area) return Number.NaN;
  const target = lastHit
    ? new THREE.Vector3(lastHit.x, sampleTerrainHeight(area.grid, lastHit.x, lastHit.z), lastHit.z)
    : controls.target;
  const dist = camera.position.distanceTo(target);
  return cellPixelSize(dist, camera.fov, canvas.clientHeight, area.grid.cellSizeM);
}

/** D-22 zoom check: flag cells too small to see, without clobbering other hints. */
function updateZoomHint(): void {
  if (!area) return;
  let show = false;
  if (HEIGHT_TOOLS.includes(tool)) {
    show = needsZoomHint(cellPxAtAnchor());
  }
  // Only swap between the default hint and ours, so other hints (slope clamp) win.
  if (show && currentHint === DEFAULT_HINT) setHint(ZOOM_HINT);
  else if (!show && currentHint === ZOOM_HINT) setHint(DEFAULT_HINT);
}

// ---------------------------------------------------------------- grid / contour overlays (D-22)

const gridLines = new THREE.LineSegments(
  new THREE.BufferGeometry(),
  new THREE.LineBasicMaterial({
    color: 0x88aacc,
    transparent: true,
    opacity: 0.7,
    depthTest: false,
  }),
);
gridLines.renderOrder = 998;
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
/** Cache key of the footprint grid currently built (tool, size, shape, cell window). */
let gridKey = "";
/** Contour interval used by the last contour build (for zoom-driven rebuilds). */
let lastContourInterval = Number.NaN;

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

function contourIntervalM(): number {
  const base = Math.min(CONTOUR_MAX_M, Math.max(CONTOUR_MIN_M, contourInterval));
  return contourIntervalForZoom(cellPxAtAnchor(), base);
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

/** Grid lines for the active tool's footprint only, rebuilt when its cell window changes. */
function updateFootprintGrid(hit: { x: number; z: number } | null): void {
  if (!area || !gridOn || !hit) {
    gridLines.visible = false;
    return;
  }
  const g = area.grid;
  const o = dispatcher.getOptions();
  let w: CellWindow | null;
  let r = 0;
  let shape: "round" | "square" = "round";
  if (tool === "block") {
    w = blockWindowAt(g, hit.x, hit.z, o.blockCells);
  } else {
    r = ringRadius();
    shape = footprintShape();
    const cs = g.cellSizeM;
    w = {
      minCol: Math.max(0, Math.floor((hit.x - r - g.originX) / cs)),
      maxCol: Math.min(g.cols, Math.ceil((hit.x + r - g.originX) / cs)),
      minRow: Math.max(0, Math.floor((hit.z - r - g.originZ) / cs)),
      maxRow: Math.min(g.rows, Math.ceil((hit.z + r - g.originZ) / cs)),
    };
    if (w.minCol >= w.maxCol || w.minRow >= w.maxRow) w = null;
  }
  if (
    !w ||
    needsZoomHint(cellPxAtAnchor()) ||
    w.maxCol - w.minCol > FOOTPRINT_GRID_MAX_CELLS ||
    w.maxRow - w.minRow > FOOTPRINT_GRID_MAX_CELLS
  ) {
    gridLines.visible = false;
    return;
  }
  // A round footprint also depends on the exact cursor spot, so quantise it to half a cell.
  const q = shape === "round" && tool !== "block" ? g.cellSizeM / 2 : 0;
  const qx = q > 0 ? Math.round(hit.x / q) : 0;
  const qz = q > 0 ? Math.round(hit.z / q) : 0;
  const key = `${tool}|${r}|${shape}|${w.minRow},${w.minCol},${w.maxRow},${w.maxCol}|${qx},${qz}`;
  gridLines.visible = true;
  if (key === gridKey) return;
  gridKey = key;
  setLines(
    gridLines,
    tool === "block"
      ? gridLineSegments(g, w, FOOTPRINT_LIFT_M)
      : footprintGridSegments(g, hit.x, hit.z, r, shape, FOOTPRINT_LIFT_M),
  );
}

function rebuildContours(x: number, z: number): void {
  if (!area) return;
  const g = area.grid;
  contourLines.visible = contoursOn;
  if (!contoursOn) return;
  const row = Math.round((z - g.originZ) / g.cellSizeM);
  const col = Math.round((x - g.originX) / g.cellSizeM);
  const w = overlayWindow(row, col);
  if (!w) return;
  overlayCentre = { row, col };
  lastContourInterval = contourIntervalM();
  setLines(contourLines, contourSegments(g, w, lastContourInterval));
}

function overlayAnchor(): { x: number; z: number } {
  return lastHit ?? { x: controls.target.x, z: controls.target.z };
}

function maybeRebuildContours(x: number, z: number): void {
  if (!area || !contoursOn) return;
  const g = area.grid;
  const row = Math.round((z - g.originZ) / g.cellSizeM);
  const col = Math.round((x - g.originX) / g.cellSizeM);
  if (
    overlayCentre === null ||
    Math.abs(row - overlayCentre.row) > CONTOUR_RECENTRE_CELLS ||
    Math.abs(col - overlayCentre.col) > CONTOUR_RECENTRE_CELLS
  ) {
    rebuildContours(x, z);
  }
}

function refreshOverlaysAfterEdit(w: CellWindow | undefined): void {
  if (!w || !area) return;
  if (gridOn) {
    gridKey = "";
    updateFootprintGrid(lastHit);
  }
  if (!overlayCentre || !contoursOn) return;
  const g = area.grid;
  const half = OVERLAY_CELLS / 2;
  const intersects =
    w.maxRow >= overlayCentre.row - half &&
    w.minRow <= overlayCentre.row + half &&
    w.maxCol >= overlayCentre.col - half &&
    w.minCol <= overlayCentre.col + half;
  if (intersects) {
    rebuildContours(
      g.originX + overlayCentre.col * g.cellSizeM,
      g.originZ + overlayCentre.row * g.cellSizeM,
    );
  }
}

function refreshOverlays(): void {
  const a = overlayAnchor();
  gridKey = "";
  updateFootprintGrid(lastHit);
  rebuildContours(a.x, a.z);
}

/** Camera moved: rebuild contours only when the zoom-scaled interval changed. */
function onCameraChange(): void {
  if (!area || !contoursOn) return;
  if (contourIntervalM() === lastContourInterval) return;
  const a = overlayAnchor();
  rebuildContours(a.x, a.z);
  setStatus(`Contours every ${lastContourInterval} m`);
}
controls.addEventListener("change", onCameraChange);

function toggleOverlay(which: "grid" | "contours"): void {
  if (which === "grid") gridOn = !gridOn;
  else contoursOn = !contoursOn;
  refreshOverlays();
  shell.refreshMenus();
}

/** Alt + wheel: step the brush radius by whole cells (Block: its size by one cell). */
function altWheelStep(dir: 1 | -1): void {
  if (!area) return;
  const o = dispatcher.getOptions();
  if (tool === "block") {
    const n = Math.min(BLOCK_CELLS_MAX, Math.max(1, o.blockCells + dir));
    if (activeValue) activeValue.set(n);
    else dispatcher.setOptions({ blockCells: n });
  } else if (activeValue && activeValue.spec === RADIUS_SPEC) {
    activeValue.set(stepRadiusCells(o.radiusM, area.grid.cellSizeM, dir));
  } else {
    return;
  }
  if (lastHit) paintRing(lastHit);
}

function updateCursor(clientX: number, clientY: number): void {
  if (!area) return;
  const hit = pickTerrain(clientX, clientY);
  if (!hit) {
    cursorRing.visible = false;
    stampArrow.visible = false;
    blockOutline.visible = false;
    gridLines.visible = false;
    if (!stroking) clearBoxOutline();
    lastHit = null;
    shell.info.set("cursor", "off the terrain");
    shell.info.set("surface", "");
    return;
  }
  lastHit = { x: hit.x, z: hit.z };
  paintRing(hit);
  maybeRebuildContours(hit.x, hit.z);
  shell.info.set(
    "cursor",
    `x ${fmt3(hit.x)}  z ${fmt3(hit.z)}  h ${fmt3(sampleTerrainHeight(area.grid, hit.x, hit.z))} m`,
  );
  shell.info.set("surface", surfaceAt(area.paint, hit.x, hit.z));
  if (flyoutReadout) {
    flyoutReadout.textContent =
      (tool === "block" || tool === "smoothBox") && blockReadoutLine ? blockReadoutLine : "";
  }
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
      log(`info: ${reach.length} disconnected road piece(s); fine while the map is mid-build.`);
    }
    if (selfX.length > 0) {
      log(`info: ${selfX.length} self-intersection(s) ignored on terrain maps (no ribbon mesh).`);
    }
    const text = saveBlockMessage(blockingRoadFailures(area.graph));
    if (text !== null) fail(text);
  } catch (err) {
    log(`Road graph check failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

// ---------------------------------------------------------------- road problems panel

const rpPanel = $("road-problems");
const rpList = $("rp-list");
const rpTitle = $("rp-title");
let rpTimer: number | undefined;
let rpHighlight: THREE.Group | null = null;
let rpHighlightTimer: number | undefined;
const RP_HIGHLIGHT_MS = 4000;
const RP_HIGHLIGHT_RED = 0xff5555;

const roadProblemsOpen = (): boolean => !rpPanel.hidden;

function setRoadProblemsOpen(open: boolean): void {
  rpPanel.hidden = !open;
  if (open) refreshRoadProblemsNow();
  else clearRoadProblemHighlight();
  shell.refreshMenus();
}

/** Re-lists problems shortly after an edit (one pass per burst of edits). */
function refreshRoadProblems(): void {
  if (!roadProblemsOpen()) return;
  window.clearTimeout(rpTimer);
  rpTimer = window.setTimeout(refreshRoadProblemsNow, 120);
}

function refreshRoadProblemsNow(): void {
  window.clearTimeout(rpTimer);
  rpList.replaceChildren();
  if (!area) {
    rpTitle.textContent = "Road problems";
    rpList.appendChild(el("div", "rp-empty", "No area loaded."));
    return;
  }
  let rows: RoadProblemRow[];
  try {
    const target = area as unknown as EditArea;
    const failures = validateGraph(area.graph, buildRoadGeometry(area.graph));
    const stale = staleUnlockedEdges(area.grid, area.graph, target.unlockedEdgeIds);
    rows = buildRoadProblems(area.graph, failures, stale, target.unlockedEdgeIds ?? []);
  } catch (err) {
    rpTitle.textContent = "Road problems";
    rpList.appendChild(
      el("div", "rp-hint", `The road check failed: ${err instanceof Error ? err.message : err}`),
    );
    return;
  }
  const blocking = rows.filter((r) => r.blocking).length;
  rpTitle.textContent =
    rows.length === 0
      ? "Road problems"
      : `Road problems (${rows.length}${blocking > 0 ? `, ${blocking} stop saving` : ""})`;
  if (rows.length === 0) {
    rpList.appendChild(el("div", "rp-empty", "No road problems found."));
    return;
  }
  for (const row of rows) rpList.appendChild(roadProblemRow(row));
  auditTips(rpPanel);
}

function roadProblemRow(row: RoadProblemRow): HTMLElement {
  const box = el(
    "div",
    row.blocking ? "rp-row blocking" : "rp-row",
    undefined,
    `${row.tip} Click to look at it on the map.`,
  );
  box.appendChild(el("div", "rp-tag", row.blocking ? "Stops saving" : "Does not stop saving"));
  box.appendChild(el("div", undefined, row.text));
  if (row.fixKind === undefined && row.hint) box.appendChild(el("div", "rp-hint", row.hint));
  const fixKind = row.fixKind;
  if (fixKind !== undefined) {
    const actions = el("div", "rp-actions");
    actions.appendChild(
      createButton({
        label: row.fixLabel ?? "Fix",
        tip: "Fix this automatically. Ctrl+Z undoes it.",
        onClick: () => applyRoadProblemFix(fixKind, row.target.id),
      }),
    );
    box.appendChild(actions);
  }
  box.addEventListener("click", (e) => {
    if ((e.target as HTMLElement).closest("button")) return;
    showRoadProblem(row);
  });
  return box;
}

function clearRoadProblemHighlight(): void {
  window.clearTimeout(rpHighlightTimer);
  if (!rpHighlight) return;
  scene.remove(rpHighlight);
  rpHighlight.traverse((o) => {
    if (o instanceof THREE.Line) {
      o.geometry.dispose();
      (o.material as THREE.Material).dispose();
    }
  });
  rpHighlight = null;
}

/** Flies the camera to the problem and marks it for a few seconds. */
function showRoadProblem(row: RoadProblemRow): void {
  if (!area) return;
  const { x, z } = row.at;
  const y = sampleTerrainHeight(area.grid, x, z);
  const off = camera.position.clone().sub(controls.target);
  off.setLength(Math.min(120, Math.max(40, off.length())));
  controls.target.set(x, y, z);
  camera.position.copy(controls.target).add(off);
  controls.update();

  clearRoadProblemHighlight();
  const group = new THREE.Group();
  const mat = (): THREE.LineBasicMaterial =>
    new THREE.LineBasicMaterial({ color: RP_HIGHLIGHT_RED, depthTest: false, transparent: true });
  const ring: THREE.Vector3[] = [];
  for (let i = 0; i < 48; i++) {
    const a = (i / 48) * Math.PI * 2;
    ring.push(new THREE.Vector3(x + Math.cos(a) * 10, y + 1, z + Math.sin(a) * 10));
  }
  group.add(new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(ring), mat()));
  group.add(
    new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(x, y, z),
        new THREE.Vector3(x, y + 60, z),
      ]),
      mat(),
    ),
  );
  if (row.target.kind === "edge") {
    const edge = area.graph.edges.find((e) => e.id === row.target.id);
    if (edge) {
      const grid = area.grid;
      const pts = edge.points.map(
        (p) => new THREE.Vector3(p[0], sampleTerrainHeight(grid, p[0], p[2]) + 1.5, p[2]),
      );
      if (pts.length >= 2)
        group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), mat()));
    }
  }
  group.renderOrder = 999;
  scene.add(group);
  rpHighlight = group;
  rpHighlightTimer = window.setTimeout(clearRoadProblemHighlight, RP_HIGHLIGHT_MS);
  setStatus(`Looking at: ${row.text}`);
}

function applyRoadProblemFix(kind: FixKind, edgeId: number): void {
  if (!area || stroking || pushPull) return;
  clearRoadProblemHighlight();
  applyResult(dispatcher.applyRoadFix(kind, edgeId), 0);
  updateHistoryButtons();
  refreshRoadProblemsNow();
}

function applyResult(res: ToolResult, _ms: number): void {
  rebuild(res.dirtyHeights, { heights: true });
  rebuild(res.dirtyPaint, { paint: true });
  refreshOverlaysAfterEdit(res.dirtyHeights);
  const delta = res.heightDeltaM;
  const held = res.heldVertices ?? 0;
  // A height op that moved nothing (all held by roads, or clamped to zero) is not an edit.
  const noopHeights =
    delta === 0 && res.dirtyPaint === undefined && !res.graphChanged && !res.lockChanged;
  const edited =
    !noopHeights &&
    (res.dirtyHeights !== undefined ||
      res.dirtyPaint !== undefined ||
      res.graphChanged ||
      res.lockChanged);
  if (res.graphChanged || res.lockChanged || res.selectionChanged) refreshRoadLockOverlay();
  refreshSelectionOutline();
  if (edited) setDirty(true);
  slopeAmber = res.slopeClamped;
  if (res.previewPoints !== undefined) setPreview(res.previewPoints);
  for (const w of res.warnings) log(w);
  if (delta !== undefined) {
    const sign = delta > 0 ? "+" : "";
    shell.info.set(
      "change",
      `last ${sign}${fmt3(delta)} m${held > 0 ? ` (${held} held by roads)` : ""}`,
    );
  }
  const heldNoChange = delta === 0 && held > 0;
  if (res.status !== undefined) {
    setStatus(res.status, res.slopeClamped || heldNoChange ? "error" : "info");
    if (res.slopeClamped && res.status.startsWith("Slope limit reached")) setHint(res.status);
  } else if (edited) {
    if (delta !== undefined) {
      const sign = delta > 0 ? "+" : "";
      setStatus(
        held > 0
          ? `Changed ${sign}${fmt3(delta)} m; ${held} vertices held by roads did not move. Unlock the road (Lock tool, L) to sculpt under it.`
          : `Changed ${sign}${fmt3(delta)} m.`,
      );
    } else {
      setStatus("Edited.");
    }
  }
  if (res.graphChanged) {
    validateRoads();
    refreshInfo();
  }
  if (edited || res.graphChanged || res.lockChanged) refreshRoadProblems();
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
    res = dispatcher.pointerDown(hit.x, hit.z, { shift: e.shiftKey, ctrl: e.ctrlKey || e.metaKey });
  } else if (phase === "move") {
    if (!hit) return;
    res = dispatcher.pointerMove(hit.x, hit.z, { shift: e.shiftKey, ctrl: e.ctrlKey || e.metaKey });
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

function pushPullText(deltaM: number): string {
  return `${deltaM > 0 ? "+" : ""}${fmt3(deltaM)} m`;
}

/** Restores the pre-drag heights; no undo entry, and the unsaved marker returns to its old state. */
function cancelPushPullDrag(message: string): void {
  const pp = pushPull;
  if (!pp) return;
  pushPull = null;
  if (!area) return;
  const r = dispatcher.cancelPushPull();
  rebuild(r.dirtyHeights, { heights: true });
  refreshOverlaysAfterEdit(r.dirtyHeights);
  refreshSelectionOutline();
  if (!pp.dirtyBefore) setDirty(false);
  shell.info.set("change", "");
  setStatus(message);
  if (canvas.hasPointerCapture(pp.pointerId)) canvas.releasePointerCapture(pp.pointerId);
}

canvas.addEventListener("pointerdown", (e) => {
  if (e.button !== 0) return;
  if (!area) {
    setStatus(NO_AREA_MSG, "error");
    return;
  }
  if (tool === "gridSelect" && (e.ctrlKey || e.metaKey)) {
    e.preventDefault(); // no text selection while dragging
    if (pushPull) return;
    if (!dispatcher.getSelection() || !dispatcher.beginPushPull()) {
      setStatus(NO_SELECTION_CLICK_MSG, "error");
      return;
    }
    pushPull = { startY: e.clientY, pointerId: e.pointerId, dirtyBefore: dirty, lastDeltaM: 0 };
    canvas.setPointerCapture(e.pointerId);
    setStatus("Push/pull the selection: drag up or down. Shift = fine, Esc cancels.");
    return;
  }
  canvas.setPointerCapture(e.pointerId);
  activePointerId = e.pointerId;
  strokeEvent(e, "down");
});
canvas.addEventListener("pointermove", (e) => {
  updateCursor(e.clientX, e.clientY);
  if (pushPull && e.pointerId === pushPull.pointerId && area) {
    const perPx = e.shiftKey ? PUSH_PULL_FINE_M_PER_PX : PUSH_PULL_M_PER_PX;
    const delta = -(e.clientY - pushPull.startY) * perPx;
    const res = dispatcher.pushPullTo(delta);
    pushPull.lastDeltaM = res.heightDeltaM ?? pushPull.lastDeltaM;
    applyResult(res, 0);
    if (res.status === undefined) setStatus(`Push/pull ${pushPullText(pushPull.lastDeltaM)}`);
    return;
  }
  if (stroking) strokeEvent(e, "move");
});
canvas.addEventListener("pointerup", (e) => {
  if (pushPull && e.pointerId === pushPull.pointerId && e.button === 0) {
    const pp = pushPull;
    pushPull = null;
    const res = dispatcher.endPushPull();
    applyResult(res, 0);
    updateHistoryButtons();
    setStatus(
      res.dirtyHeights
        ? `Push/pull ${pushPullText(pp.lastDeltaM)} applied. Ctrl+Z undoes it.`
        : "Push/pull made no change.",
      res.dirtyHeights ? "ok" : "info",
    );
    if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
    return;
  }
  if (e.button !== 0 || !stroking) return;
  strokeEvent(e, "up");
  activePointerId = null;
  if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
});
canvas.addEventListener("pointercancel", (e) => {
  if (pushPull) cancelPushPullDrag("Push/pull cancelled.");
  if (stroking) strokeEvent(e, "up");
  activePointerId = null;
});
canvas.addEventListener("pointerleave", () => {
  if (!stroking) {
    cursorRing.visible = false;
    stampArrow.visible = false;
    blockOutline.visible = false;
    clearBoxOutline();
  }
});

function undoRedo(kind: "undo" | "redo"): void {
  if (!area || stroking || pushPull) return;
  const r = kind === "undo" ? dispatcher.undo() : dispatcher.redo();
  if (!r) return;
  rebuild(r.dirtyHeights, { heights: true });
  rebuild(r.dirtyPaint, { paint: true });
  refreshOverlaysAfterEdit(r.dirtyHeights);
  refreshSelectionOutline();
  setDirty(true);
  setStatus(kind === "undo" ? "Undid last stroke." : "Redid stroke.", "ok");
  updateHistoryButtons();
  if (r.graphChanged || r.lockChanged) refreshRoadLockOverlay();
  if (r.graphChanged) {
    validateRoads();
    refreshInfo();
  }
  refreshRoadProblems();
}

// ---------------------------------------------------------------- tool options

const RAIL_TOOLS: (ShellTool & { id: Tool })[] = [
  {
    id: "raise",
    label: "Raise",
    icon: "▲",
    dock: "top",
    keyLabel: "H",
    tip: "Click or drag to raise terrain by up to Strength metres per dab at the centre. Zoom in to see small changes; the info bar shows the change.",
  },
  {
    id: "lower",
    label: "Lower",
    icon: "▼",
    dock: "top",
    keyLabel: "J",
    tip: "Click or drag to lower terrain by up to Strength metres per dab at the centre. Zoom in to see small changes; the info bar shows the change.",
  },
  {
    id: "smooth",
    label: "Smooth",
    icon: "≈",
    keyLabel: "G",
    tip: "Smooth bumps out of the terrain under the brush.",
  },
  {
    id: "flatten",
    label: "Flatten",
    icon: "▬",
    keyLabel: "F",
    tip: "Flatten the terrain to the height where you started the stroke.",
  },
  {
    id: "paint",
    label: "Surface paint",
    icon: "◐",
    keyLabel: "P",
    tip: "Paint a surface type (tarmac, gravel, grass...) onto the terrain.",
  },
  {
    id: "road",
    label: "Road brush",
    icon: "═",
    keyLabel: "R",
    tip: "Drag a road across the terrain. The ground is graded flat under it.",
  },
  {
    id: "stamp",
    label: "Stamp",
    icon: "◭",
    keyLabel: "W",
    tip: "Stamp a wedge (ramp) or mound onto the terrain. Drag to set its length.",
  },
  {
    id: "erase",
    label: "Erase road",
    icon: "✕",
    keyLabel: "E",
    tip: "Erase road segments under the brush.",
  },
  {
    id: "block",
    label: "Block",
    icon: "▦",
    keyLabel: "B",
    tip: "Raise or lower a square block of cells. Click steps it; drag paints blocks.",
  },
  {
    id: "smoothBox",
    label: "Smooth area",
    icon: "▒",
    keyLabel: "M",
    tip: "Drag a box to smooth that whole area. Roads never move.",
  },
  {
    id: "gridSelect",
    label: "Grid select",
    icon: "▦",
    keyLabel: "S",
    tip: "Drag a rectangle of cells. Then raise/lower it with the ▲/▼ buttons, or Ctrl+drag up/down to push or pull it by hand.",
  },
  {
    id: "lock",
    label: "Lock/unlock road",
    icon: "⚿",
    keyLabel: "L",
    tip: "Click a road to lock or unlock it. Shift+click selects it without toggling.",
  },
];
const RAIL_TOOL_IDS = new Set<string>(RAIL_TOOLS.map((t) => t.id));

interface ActiveValue {
  get(): number;
  set(v: number): void;
  spec: StepperSpec;
}
/** The active tool's main value, adjusted by [ ] and the arrow keys (D-09). */
let activeValue: ActiveValue | null = null;
let flyoutReadout: HTMLElement | null = null;
let blockLabelEl: HTMLElement | null = null;
let rotationEl: HTMLElement | null = null;

const RADIUS_SPEC: StepperSpec = { step: 0.5, coarse: 10, min: 0.5, max: 200, decimals: 1 };
const STRENGTH_SPEC: StepperSpec = { step: 0.05, coarse: 5, min: 0, max: 1, decimals: 2 };
const ROAD_WIDTH_SPEC: StepperSpec = { step: 0.5, coarse: 2, min: 3, max: 20, decimals: 1 };
const STAMP_HEIGHT_SPEC: StepperSpec = { step: 0.5, coarse: 4, min: -50, max: 50, decimals: 1 };
const STAMP_WIDTH_SPEC: StepperSpec = { step: 1, coarse: 5, min: 1, max: 200, decimals: 0 };
const BLOCK_CELLS_SPEC: StepperSpec = {
  step: 1,
  coarse: 4,
  min: 1,
  max: BLOCK_CELLS_MAX,
  decimals: 0,
};
const BLOCK_STEP_SPEC: StepperSpec = { step: 0.25, coarse: 4, min: 0.25, max: 5, decimals: 2 };
const SELECT_STEP_SPEC: StepperSpec = { step: 0.25, coarse: 4, min: 0.25, max: 5, decimals: 2 };
const SLOPE_LIMIT_SPEC: StepperSpec = {
  step: 1,
  coarse: 5,
  min: SLOPE_LIMIT_MIN_DEG,
  max: SLOPE_LIMIT_MAX_DEG,
  decimals: 0,
};
const PASSES_SPEC: StepperSpec = { step: 1, coarse: 3, min: 1, max: 10, decimals: 0 };

function optStepper(
  label: string,
  tip: string,
  spec: StepperSpec,
  value: number,
  unit: string | undefined,
  apply: (v: number) => void,
  main = false,
): { field: HTMLElement; stepper: ReturnType<typeof createStepper> } {
  const stepper = createStepper({ value, spec, tip, unit, onChange: apply });
  if (main) {
    activeValue = {
      get: () => stepper.get(),
      set: (v) => {
        stepper.set(v);
        apply(v);
      },
      spec,
    };
  }
  return { field: createField(label, stepper.el, tip), stepper };
}

/** D-18: the block size label shows metres (N x cell size) for the loaded area. */
function syncBlockLabel(): void {
  if (!blockLabelEl) return;
  const n = dispatcher.getOptions().blockCells;
  const cell = area ? area.grid.cellSizeM : DEFAULT_CELL_SIZE_M;
  blockLabelEl.textContent = `${n} x ${n} (${fmt3(n * cell)} m)`;
}

function syncRotationLabel(): void {
  if (!rotationEl) return;
  const deg = Math.round((dispatcher.getOptions().stampRotationRad * 180) / Math.PI);
  rotationEl.textContent = `Rotation ${deg} deg ([ ] rotate, Shift = 45)`;
}

function note(text: string): HTMLElement {
  return el("div", "muted", text);
}

function runLockAction(fn: () => ToolResult): void {
  if (!area || stroking) return;
  const t0 = performance.now();
  applyResult(fn(), performance.now() - t0);
  updateHistoryButtons();
}

function buildFlyout(t: Tool): void {
  activeValue = null;
  flyoutReadout = null;
  blockLabelEl = null;
  rotationEl = null;
  selectionReadoutEl = null;
  const o = dispatcher.getOptions();
  const f = shell.flyout;
  f.replaceChildren();
  f.appendChild(el("div", "field-label", RAIL_TOOLS.find((x) => x.id === t)?.label ?? t));

  const radius = (main: boolean): HTMLElement =>
    optStepper(
      "Radius",
      "Brush radius in metres",
      RADIUS_SPEC,
      o.radiusM,
      "m",
      (v) => {
        dispatcher.setOptions({ radiusM: v });
        if (lastHit) paintRing(lastHit);
      },
      main,
    ).field;
  const strength = (): HTMLElement =>
    optStepper(
      "Strength",
      "How strongly the brush acts, 0 to 1",
      STRENGTH_SPEC,
      o.strength,
      "",
      (v) => dispatcher.setOptions({ strength: v }),
    ).field;
  const falloff = (): HTMLElement =>
    createField(
      "Falloff",
      createSelect({
        options: [
          { value: "smooth", label: "Smooth" },
          { value: "linear", label: "Linear" },
        ],
        value: o.falloff,
        tip: "How the brush fades towards its edge",
        onChange: (v) => dispatcher.setOptions({ falloff: v === "linear" ? "linear" : "smooth" }),
      }).el,
      "Brush edge falloff",
    );
  const slope = (): HTMLElement =>
    optStepper(
      "Slope limit",
      "Steepest ground slope sculpting may leave, in degrees. Default 35. Roads keep their own grade limit.",
      SLOPE_LIMIT_SPEC,
      o.slopeLimitDeg,
      "deg",
      (v) => dispatcher.setOptions({ slopeLimitDeg: v }),
    ).field;
  const shapeSel = (): HTMLElement =>
    createField(
      "Shape",
      createSelect({
        options: [
          { value: "round", label: "Round" },
          { value: "square", label: "Square" },
        ],
        value: o.brushShape,
        tip: "Brush footprint shape; the brush acts on exactly the outlined area",
        onChange: (v) => {
          dispatcher.setOptions({ brushShape: v === "square" ? "square" : "round" });
          if (lastHit) paintRing(lastHit);
        },
      }).el,
      "Brush footprint shape",
    );
  const surface = (): HTMLElement =>
    createField(
      "Surface",
      createSelect<SurfaceType>({
        options: SURFACE_TYPES.map((s) => ({ value: s, label: s })),
        value: o.surface,
        tip: "Surface type that is painted (affects grip)",
        onChange: (v) => dispatcher.setOptions({ surface: v }),
      }).el,
      "Surface type",
    );

  switch (t) {
    case "raise":
    case "lower":
    case "smooth":
    case "flatten":
      f.append(radius(true), strength(), falloff(), shapeSel(), slope());
      break;
    case "paint": {
      f.append(radius(true), strength(), falloff(), shapeSel(), surface());
      const key = el("div", "legend");
      for (const s of SURFACE_TYPES) {
        const span = el("span");
        const sw = el("i", "sw");
        sw.style.background = `#${TERRAIN_SURFACE_PALETTE[s].toString(16).padStart(6, "0")}`;
        span.append(sw, s);
        key.appendChild(span);
      }
      f.append(createField("Colour key", key, "Colours used for each surface type"));
      break;
    }
    case "erase":
      f.append(radius(true));
      break;
    case "lock":
      f.append(
        radius(true),
        createButton({
          label: "Lock all",
          tip: "Lock every road so terrain edits cannot move it",
          onClick: () => runLockAction(() => dispatcher.lockAll(true)),
        }),
        createButton({
          label: "Unlock all",
          tip: "Unlock every road so terrain edits can reshape the ground under it",
          onClick: () => runLockAction(() => dispatcher.lockAll(false)),
        }),
        createButton({
          label: "Re-grade selected",
          tip: "Re-grade the ground under the selected road so it fits the terrain again",
          onClick: () => runLockAction(() => dispatcher.regradeSelected()),
        }),
        createButton({
          label: "Re-grade all unlocked",
          tip: "Re-grade every unlocked road so it fits the terrain again",
          onClick: () => runLockAction(() => dispatcher.regradeAllUnlocked()),
        }),
        note(
          "Grey = locked, orange = unlocked, cyan = selected. Unlocked roads must be re-graded or locked before saving.",
        ),
      );
      break;
    case "road": {
      const width = optStepper(
        "Width",
        "Road width in metres",
        ROAD_WIDTH_SPEC,
        o.widthM,
        "m",
        (v) => dispatcher.setOptions({ widthM: v }),
        true,
      );
      const presetLabels: Record<string, string> = {
        street: "Street",
        highway: "Highway",
        track: "Track",
        dirt: "Dirt road",
      };
      f.append(
        createField(
          "Road class",
          createSelect<RoadPresetId>({
            options: (Object.keys(ROAD_PRESETS) as RoadPresetId[]).map((id) => ({
              value: id,
              label: presetLabels[id] ?? id,
            })),
            value: o.roadPreset,
            tip: "Road class sets the default width and bank limit",
            onChange: (v) => {
              dispatcher.setOptions({ roadPreset: v });
              width.stepper.set(dispatcher.getOptions().widthM);
            },
          }).el,
          "Road class",
        ),
        surface(),
        width.field,
      );
      break;
    }
    case "stamp": {
      rotationEl = el("div", "muted");
      syncRotationLabel();
      f.append(
        createField(
          "Stamp",
          createSelect({
            options: [
              { value: "wedge", label: "Wedge" },
              { value: "mound", label: "Mound" },
            ],
            value: o.stampKind,
            tip: "Wedge makes a ramp; mound makes a hill",
            onChange: (v) =>
              dispatcher.setOptions({ stampKind: v === "mound" ? "mound" : "wedge" }),
          }).el,
          "Stamp shape",
        ),
        optStepper(
          "Height",
          "Stamp height in metres",
          STAMP_HEIGHT_SPEC,
          o.stampHeightM,
          "m",
          (v) => dispatcher.setOptions({ stampHeightM: v }),
          true,
        ).field,
        optStepper("Width", "Stamp width in metres", STAMP_WIDTH_SPEC, o.stampWidthM, "m", (v) =>
          dispatcher.setOptions({ stampWidthM: v }),
        ).field,
        rotationEl,
        slope(),
        note("Drag to set the stamp length."),
      );
      break;
    }
    case "block": {
      blockLabelEl = el("div", "muted");
      flyoutReadout = el("div", "muted");
      const row = el("div", "seg");
      const raiseBtn = createButton({
        label: "Raise",
        tip: "Each click raises the block by the step",
        onClick: () => setDir(1),
      });
      const lowerBtn = createButton({
        label: "Lower",
        tip: "Each click lowers the block by the step",
        onClick: () => setDir(-1),
      });
      const setDir = (d: 1 | -1): void => {
        dispatcher.setOptions({ blockDirection: d });
        raiseBtn.setAttribute("aria-pressed", String(d === 1));
        lowerBtn.setAttribute("aria-pressed", String(d === -1));
      };
      setDir(o.blockDirection);
      row.append(raiseBtn, lowerBtn);
      f.append(
        optStepper(
          "Size (cells)",
          "Block edge length in cells",
          BLOCK_CELLS_SPEC,
          o.blockCells,
          undefined,
          (v) => {
            dispatcher.setOptions({ blockCells: v });
            syncBlockLabel();
            if (lastHit) paintRing(lastHit);
          },
          true,
        ).field,
        blockLabelEl,
        optStepper(
          "Step",
          "Height change per click in metres",
          BLOCK_STEP_SPEC,
          o.blockStepM,
          "m",
          (v) => dispatcher.setOptions({ blockStepM: v }),
        ).field,
        createField("Direction", row, "Whether a click raises or lowers the block"),
        slope(),
        flyoutReadout,
        note("Click steps the block in the chosen direction. Drag paints blocks."),
      );
      syncBlockLabel();
      break;
    }
    case "gridSelect": {
      selectionReadoutEl = el("div", "muted");
      const bigButton = (label: string, tip: string, sign: 1 | -1): HTMLButtonElement => {
        const b = createButton({
          label,
          tip,
          onClick: () => runLockAction(() => dispatcher.raiseSelection(sign)),
        });
        b.style.fontSize = "1.1em";
        b.style.padding = "10px 12px";
        b.style.width = "100%";
        return b;
      };
      const range = el("input", undefined, undefined, "Step size in metres, 0.25 to 5");
      range.type = "range";
      range.min = String(SELECT_STEP_SPEC.min);
      range.max = String(SELECT_STEP_SPEC.max);
      range.step = String(SELECT_STEP_SPEC.step);
      range.value = String(o.selectStepM);
      const rangeLabel = el("div", "muted", `Step ${fmt3(o.selectStepM)} m`);
      const applyStep = (v: number): void => {
        dispatcher.setOptions({ selectStepM: v });
        const real = dispatcher.getOptions().selectStepM;
        range.value = String(real);
        rangeLabel.textContent = `Step ${fmt3(real)} m`;
      };
      const stepField = optStepper(
        "Step size",
        "Height change per raise/lower press in metres",
        SELECT_STEP_SPEC,
        o.selectStepM,
        "m",
        applyStep,
        true,
      );
      range.addEventListener("input", () => {
        const v = Number(range.value);
        stepField.stepper.set(v);
        applyStep(v);
      });
      f.append(
        selectionReadoutEl,
        bigButton(
          "▲ Raise selection",
          "Raise the selected cells by the Step amount (one undo step)",
          1,
        ),
        bigButton(
          "▼ Lower selection",
          "Lower the selected cells by the Step amount (one undo step)",
          -1,
        ),
        createSection("Step", "Set how far each raise/lower press moves the selection", false, [
          range,
          rangeLabel,
          stepField.field,
        ]),
        slope(),
        note("Ctrl+drag up/down pushes or pulls the selection. Esc cancels."),
      );
      refreshSelectionOutline();
      break;
    }
    case "smoothBox":
      flyoutReadout = el("div", "muted");
      f.append(
        optStepper(
          "Strength",
          "Smoothing strength, 0 to 1",
          STRENGTH_SPEC,
          o.smoothStrength,
          "",
          (v) => dispatcher.setOptions({ smoothStrength: v }),
          true,
        ).field,
        optStepper(
          "Passes",
          "How many smoothing passes to run, 1 to 10",
          PASSES_SPEC,
          o.smoothPasses,
          undefined,
          (v) => dispatcher.setOptions({ smoothPasses: v }),
        ).field,
        slope(),
        flyoutReadout,
        note("Drag a box to smooth it. Roads never move."),
        createButton({
          label: "Smooth whole map",
          tip: "Smooth the entire map (Ctrl+Z undoes it)",
          onClick: () => void smoothWholeMap(),
        }),
      );
      break;
    default:
      break;
  }
}

async function smoothWholeMap(): Promise<void> {
  if (!area || stroking) return;
  const passes = dispatcher.getOptions().smoothPasses;
  setStatus("Smoothing whole map...");
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
  const spot = lastHit ?? { x: controls.target.x, z: controls.target.z };
  if (!(await save())) return;
  let drivable = false;
  try {
    const res = await fetch(`/__terrain/drivable/${id}`);
    drivable = res.ok && ((await res.json()) as { drivable?: boolean }).drivable === true;
  } catch {
    drivable = false;
  }
  if (!drivable) {
    const text = "Drive here: this area is not registered yet. Save it once, then try again.";
    fail(text);
    return;
  }
  const url = `/?map=${id}&at=${spot.x.toFixed(1)},${spot.z.toFixed(1)}&debug`;
  const w = window.open(url, "_blank");
  if (!w) log(`Pop-up blocked. Open ${url} manually.`);
}

// ---------------------------------------------------------------- wiring

function dolly(factor: number): void {
  const off = camera.position.clone().sub(controls.target);
  off.setLength(Math.min(20000, Math.max(5, off.length() * factor)));
  camera.position.copy(controls.target).add(off);
  controls.update();
}

function panView(dx: number, dy: number): void {
  const dir = new THREE.Vector3();
  camera.getWorldDirection(dir);
  const fwd = new THREE.Vector3(dir.x, 0, dir.z);
  if (fwd.lengthSq() < 1e-8) fwd.set(0, 0, -1);
  fwd.normalize();
  const right = new THREE.Vector3(-fwd.z, 0, fwd.x);
  const dist = camera.position.distanceTo(controls.target);
  const move = right
    .multiplyScalar(dx)
    .addScaledVector(fwd, -dy)
    .multiplyScalar(dist * 0.15);
  camera.position.add(move);
  controls.target.add(move);
  controls.update();
}

function showLogDialog(): void {
  const box = el("div", "log-box");
  box.textContent = logLines.length > 0 ? logLines.join("\n") : "(nothing logged yet)";
  void openDialog({
    title: "Log",
    body: box,
    actions: [{ id: "close", label: "Close", tip: "Close the log", primary: true }],
  });
}

async function contourIntervalDialog(): Promise<void> {
  const st = createStepper({
    value: contourInterval,
    spec: { step: 0.25, coarse: 4, min: CONTOUR_MIN_M, max: CONTOUR_MAX_M, decimals: 2 },
    tip: "Contour spacing at normal zoom; zooming out makes it coarser, zooming in finer",
    unit: "m",
    onChange: () => {},
  });
  const r = await openDialog<"apply" | "close">({
    title: "Contour interval",
    body: createField(
      "Base interval (m)",
      st.el,
      "Contour spacing at normal zoom; zooming out makes it coarser, zooming in finer",
    ),
    actions: [
      { id: "apply", label: "Apply", tip: "Use this interval", primary: true },
      { id: "close", label: "Cancel", tip: "Close without changing it" },
    ],
  });
  if (r === "apply") {
    contourInterval = st.get();
    refreshOverlays();
  }
}

function cancelActiveStroke(): void {
  if (pushPull) cancelPushPullDrag("Push/pull cancelled.");
  if (!stroking) return;
  stroking = false;
  setPreview(null);
  const end = lastHit;
  applyResult(dispatcher.pointerUp(end ? end.x : Number.NaN, end ? end.z : Number.NaN), 0);
  slopeAmber = false;
  updateHistoryButtons();
  if (activePointerId !== null && canvas.hasPointerCapture(activePointerId)) {
    canvas.releasePointerCapture(activePointerId);
  }
  activePointerId = null;
}

// ---------------------------------------------------------------- shell

const shell = createShell({
  root: $("app"),
  layout: "dock",
  menus: [
    {
      label: "File",
      tip: "Open, create, save and drive the terrain area",
      items: [
        {
          id: "open",
          label: "Open area...",
          tip: "Open a saved terrain area",
          run: () => void openAreaDialog(),
        },
        {
          id: "new",
          label: "New...",
          tip: "Create a new flat terrain area of a chosen size",
          run: () => void newAreaDialog(),
        },
        {
          id: "save",
          label: "Save",
          tip: "Write the terrain to disk",
          shortcut: "Ctrl+S",
          run: () => void save(),
          enabled: () => area !== null,
        },
        {
          id: "drive",
          label: "Drive here",
          tip: "Save, then open the game at the cursor position",
          shortcut: "D",
          run: () => void driveHere(),
          enabled: () => area !== null,
        },
        { separator: true },
        { id: "log", label: "Show log", tip: "Show the last 200 log lines", run: showLogDialog },
      ],
    },
    {
      label: "Import",
      tip: "Import data into the terrain",
      items: [
        {
          id: "import-heightmap",
          label: "Heightmap import - not available yet",
          tip: "Importing a heightmap image is planned for a later release",
          run: () => {},
          enabled: () => false,
        },
      ],
    },
    {
      label: "View",
      tip: "Overlays and camera",
      items: [
        {
          id: "grid",
          label: "Grid",
          tip: "Show the cell grid under the brush",
          shortcut: "X",
          run: () => toggleOverlay("grid"),
          checked: () => gridOn,
        },
        {
          id: "contours",
          label: "Contours",
          tip: "Show height contour lines around the cursor",
          shortcut: "C",
          run: () => toggleOverlay("contours"),
          checked: () => contoursOn,
        },
        {
          id: "contour-interval",
          label: "Contour interval...",
          tip: "Set the height between contour lines",
          run: () => void contourIntervalDialog(),
        },
        { separator: true },
        {
          id: "road-problems",
          label: "Road problems",
          tip: "List every road problem, jump to it on the map, and fix it",
          run: () => setRoadProblemsOpen(!roadProblemsOpen()),
          checked: () => roadProblemsOpen(),
        },
        {
          id: "topdown",
          label: "Top-down",
          tip: "Look straight down at the map",
          shortcut: "T",
          run: () => setTopDown(!topDown),
          checked: () => topDown,
        },
      ],
    },
    { label: "Help", tip: "Help and preferences", items: [] },
  ],
  tools: RAIL_TOOLS,
  onToolChange: (id) => selectTool(id as Tool),
  history: {
    undo: () => undoRedo("undo"),
    redo: () => undoRedo("redo"),
    clear: () => {
      dispatcher.cancelBoxDrag();
      dispatcher.clearSelection();
      clearBoxOutline();
      refreshSelectionOutline();
    },
    clearLabel: "Clear selection",
    clearTip: "Clear the Grid selection or cancel a box drag (does not change terrain)",
  },
  view: {
    zoomIn: () => dolly(0.8),
    zoomOut: () => dolly(1.25),
    fit: () => {
      if (area) frameArea(area);
    },
    pan: (dx, dy) => panView(dx, dy),
    extra: [
      {
        id: "grid",
        label: "Grid",
        tip: "Show the terrain cell grid under the brush (X)",
        run: () => toggleOverlay("grid"),
        pressed: () => gridOn,
      },
      {
        id: "contours",
        label: "Contours",
        tip: "Show lines of equal height around the cursor; spacing follows zoom (C)",
        run: () => toggleOverlay("contours"),
        pressed: () => contoursOn,
      },
      {
        id: "topdown",
        label: "Top-down",
        tip: "Look straight down at the map (T)",
        run: () => setTopDown(!topDown),
        pressed: () => topDown,
      },
    ],
  },
  infoFields: [
    { key: "area", label: "Area", tip: "Name of the open area" },
    { key: "size", label: "Size", tip: "World size of the area" },
    { key: "cell", label: "Cell", tip: "Size of one terrain cell" },
    { key: "cursor", label: "Cursor", tip: "Cursor position and terrain height under it" },
    { key: "surface", label: "Surface", tip: "Surface type under the cursor" },
    { key: "roads", label: "Roads", tip: "Number of road segments in the area" },
    { key: "change", label: "Change", tip: "Size of the last height edit" },
  ],
});

// ---------------------------------------------------------------- keyboard

const BINDINGS: Binding[] = [
  ...STANDARD_BINDINGS,
  { id: "topdown", code: "KeyT", label: "T" },
  { id: "grid", code: "KeyX", label: "X" },
  { id: "contours", code: "KeyC", label: "C" },
  { id: "drive", code: "KeyD", label: "D" },
];

window.addEventListener("shell:dialog-open", () => cancelActiveStroke());

window.addEventListener("keydown", (e) => {
  const active = document.activeElement;
  const textFocused = isTextEntryFocused(active);
  const dialogOpen = shell.isDialogOpen();
  if ((e.ctrlKey || e.metaKey) && e.code === "KeyS" && !e.altKey) {
    e.preventDefault();
    if (!dialogOpen) void save();
    return;
  }
  const id = resolveShortcut(e, BINDINGS, { textFocused, dialogOpen });
  switch (id) {
    case "undo":
      e.preventDefault();
      undoRedo("undo");
      return;
    case "redo":
      e.preventDefault();
      undoRedo("redo");
      return;
    case "escape":
      if (!dialogOpen && pushPull) {
        cancelPushPullDrag("Push/pull cancelled.");
        return;
      }
      if (!dialogOpen && tool === "gridSelect" && stroking) {
        // Abandon a rubber-band drag without selecting anything.
        const prev = dispatcher.getSelection();
        dispatcher.pointerUp(Number.NaN, Number.NaN);
        dispatcher.setSelection(prev);
        stroking = false;
        clearBoxOutline();
        refreshSelectionOutline();
        setStatus("Selection drag cancelled.");
        return;
      }
      if (!dialogOpen && dispatcher.cancelBoxDrag()) {
        stroking = false;
        clearBoxOutline();
        if (lastHit) paintRing(lastHit);
        setStatus("Smooth area cancelled.");
      }
      return;
    case "topdown":
      setTopDown(!topDown);
      return;
    case "grid":
      toggleOverlay("grid");
      return;
    case "contours":
      toggleOverlay("contours");
      return;
    case "drive":
      void driveHere();
      return;
    default:
      break;
  }
  if (textFocused || dialogOpen || e.altKey || e.ctrlKey || e.metaKey) return;
  const next = TOOL_KEYS[e.code];
  if (next && RAIL_TOOL_IDS.has(next)) {
    shell.setActiveTool(next);
    return;
  }
  if (e.code === "Escape") return;
  if (tool === "stamp" && (e.code === "BracketLeft" || e.code === "BracketRight")) {
    dispatcher.rotateStamp(e.code === "BracketRight" ? 1 : -1, e.shiftKey);
    syncRotationLabel();
    if (lastHit) paintRing(lastHit);
    const deg = Math.round((dispatcher.getOptions().stampRotationRad * 180) / Math.PI);
    setStatus(`Stamp rotation ${deg} degrees.`);
    return;
  }
  const adj = adjustDirection(e);
  if (adj && activeValue && !(active instanceof HTMLSelectElement)) {
    e.preventDefault();
    activeValue.set(stepValue(activeValue.get(), adj.dir, activeValue.spec, adj.coarse));
    if (lastHit) paintRing(lastHit);
  }
});

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

shell.setActiveTool(tool);
updateHistoryButtons();
setHint(DEFAULT_HINT);
setStatus("No area loaded. Use File > Open area or File > New.");
auditTips(document);
refreshAreaList()
  .then(() => {
    // ?area=<id> (from the map editor's "Open in terrain editor"): exact match against the saved list only.
    const wanted = new URLSearchParams(location.search).get("area");
    const match = knownAreas.find((id) => id === wanted);
    if (match !== undefined) return loadArea(match);
    if (wanted !== null)
      setStatus(`There is no saved terrain map called "${wanted.slice(0, 64)}".`);
    return undefined;
  })
  .catch((err) => {
    log(`Cannot list areas: ${err instanceof Error ? err.message : String(err)}`);
  });
requestAnimationFrame(frame);
