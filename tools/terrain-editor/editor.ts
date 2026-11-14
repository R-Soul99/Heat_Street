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
import { maskAverageHeight, stepRadiusCells } from "../../src/core/terrain-brush.ts";
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
  GRID_SPACING_PRESETS_CELLS,
  gridLineSegments,
  needsZoomHint,
  roadLockCounts,
  roadLockSegments,
} from "../../src/core/terrain-overlay.ts";
import { surfaceAt } from "../../src/core/terrain-paint.ts";
import { raycastTerrain } from "../../src/core/terrain-pick.ts";
import { ROAD_PRESETS, type RoadPresetId } from "../../src/core/terrain-road.ts";
import {
  isUnlocked,
  nearestEdgeWithin,
  staleUnlockedEdges,
} from "../../src/core/terrain-road-lock.ts";
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
import { createRepeater, OP_REPEAT_MS, REPEAT_DELAY_MS } from "../editor-shell/repeat.ts";
import { createShell } from "../editor-shell/shell.ts";
import { type StepperSpec, stepValue } from "../editor-shell/stepper.ts";
import { auditTips } from "../editor-shell/tooltips.ts";
import type { BarGroup } from "../editor-shell/top-bar.ts";
import { validateGraph } from "../map-compiler/validate/validator.ts";
import { wheelZoomFactor } from "../map-editor/world.ts";
import { orbitAboutPivot, panByPixels, worldPerPixel, zoomTowardPoint } from "./camera-nav.ts";
import { createEmptyTerrainArea } from "./new-area.ts";
import {
  BRUSH_TOOL_FOR,
  MODES,
  OPERATIONS,
  ROAD_BUTTONS,
  TERRAIN_HOTKEYS,
  TOOLBAR_TOOLS,
  type ToolbarId,
  VIEW_TOGGLES,
} from "./rail-tools.ts";
import { buildRoadProblems, type RoadFix, type RoadProblemRow } from "./road-problems.ts";
import { blockingRoadFailures, saveBlockMessage, staleRoadBlockMessage } from "./save-guard.ts";
import { putTerrainPair } from "./save-pair.ts";
import {
  createToolDispatcher,
  type EditArea,
  SLOPE_LIMIT_MAX_DEG,
  SLOPE_LIMIT_MIN_DEG,
  type Tool,
  type ToolResult,
} from "./tool-dispatch.ts";
import { resolveToolbarAction, type ToolbarInput, toolbarState } from "./toolbar-state.ts";

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const canvas = $<HTMLCanvasElement>("view");
const wrap = $("wrap");

const NAME_RE = /^[a-z0-9-]{1,64}$/;
const DEFAULT_HINT =
  "Left-drag to sculpt. Middle-drag (or right-drag) to tilt and spin, Shift+middle-drag (or Shift+right-drag) to pan, wheel to zoom to the cursor, Alt+wheel = brush size in cells.";
const CURSOR_RADIUS_M = 8;
/** Select-mode road hover reach in metres. */
const LOCK_HOVER_RADIUS_M = 4;
const RING_SEGMENTS = 64;
const ZOOM_HINT = "Zoom in to see single cells.";
const HEIGHT_TOOLS: readonly Tool[] = ["raise", "lower", "smooth", "flatten"];
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
const BOX_CYAN = 0x44ddff;
/** Selection accent (UI-SPEC Color) and the subtract rubber-band colour. */
const SELECT_ACCENT = 0x4aa3ff;
const SUBTRACT_ORANGE = 0xffb347;
/** Selection fill is skipped above this many cells (T-07.1.2-18); the outline still draws. */
const SELECTION_FILL_MAX_CELLS = 250000;
const SELECT_HINT = "Shift: add, Ctrl: subtract, Alt: push/pull";

// ---------------------------------------------------------------- state

let area: TerrainArea | null = null;
let terrainView: TerrainView | null = null;
let dirty = false;
let tool: Tool = "select";
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
/** Grid line spacing in cells (D-20). */
let gridSpacing = 1;
let currentHint = "";
const logLines: string[] = [];
const LOG_MAX = 200;
let activePointerId: number | null = null;
/** Alt+drag push/pull in progress (Alt is read at pointerdown only). */
let pushPull: {
  startY: number;
  pointerId: number;
  dirtyBefore: boolean;
  lastDeltaM: number;
} | null = null;
const PUSH_PULL_M_PER_PX = 0.05;
const PUSH_PULL_FINE_M_PER_PX = 0.01;
const NO_AREA_MSG = "Load or create an area first (File > Open area or File > New).";
const NO_SELECTION_CLICK_MSG = "Select some cells first (Select mode, S), then Alt+drag.";

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
// MIDDLE is handled below: drag orbits about the ground point under the cursor at
// button-down (horizontal spins, vertical tilts); Shift + middle-drag pans.
// Wheel (with or without Ctrl/Meta) zooms toward the cursor; Alt + wheel is brush size.
controls.mouseButtons = {
  LEFT: null,
  MIDDLE: null,
  RIGHT: THREE.MOUSE.ROTATE,
} as unknown as typeof controls.mouseButtons;
controls.enableDamping = false;
controls.maxPolarAngle = Math.PI / 2 - 0.02;
const NAV_MIN_DIST_M = 2;
const NAV_MAX_DIST_M = camera.far * 0.5;
controls.enableZoom = false; // wheel zooms toward the cursor, handled below
controls.minDistance = NAV_MIN_DIST_M;
controls.maxDistance = NAV_MAX_DIST_M;
canvas.addEventListener("contextmenu", (e) => e.preventDefault());

let middleDrag: {
  id: number;
  x: number;
  y: number;
  mode: "orbit" | "pan";
  pivot: THREE.Vector3;
  panDist: number;
} | null = null;
canvas.addEventListener("pointerdown", (e) => {
  if (e.button !== 1) return;
  e.preventDefault(); // suppress browser middle-click autoscroll
  const pivot = pickPivot(e.clientX, e.clientY) ?? controls.target.clone();
  middleDrag = {
    id: e.pointerId,
    x: e.clientX,
    y: e.clientY,
    mode: e.shiftKey ? "pan" : "orbit",
    pivot,
    panDist: camera.position.distanceTo(pivot),
  };
  canvas.setPointerCapture(e.pointerId);
});
canvas.addEventListener("pointermove", (e) => {
  if (!middleDrag || e.pointerId !== middleDrag.id) return;
  const dx = e.clientX - middleDrag.x;
  const dy = e.clientY - middleDrag.y;
  middleDrag.x = e.clientX;
  middleDrag.y = e.clientY;
  const h = canvas.clientHeight || 1;
  if (middleDrag.mode === "orbit") {
    // Same sense as OrbitControls: horizontal drag spins, vertical drag tilts.
    const r = orbitAboutPivot(
      camera.position,
      controls.target,
      middleDrag.pivot,
      -(2 * Math.PI * dx) / h,
      -(2 * Math.PI * dy) / h,
      0.01,
      controls.maxPolarAngle,
    );
    camera.position.copy(r.position);
    controls.target.copy(r.target);
    camera.lookAt(controls.target);
  } else {
    const wpp = worldPerPixel(middleDrag.panDist, camera.fov, h);
    const right = new THREE.Vector3().setFromMatrixColumn(camera.matrix, 0);
    const up = new THREE.Vector3().setFromMatrixColumn(camera.matrix, 1);
    const offset = panByPixels(right, up, dx, dy, wpp);
    camera.position.add(offset);
    controls.target.add(offset);
  }
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
    e.preventDefault(); // wheel and Ctrl+wheel zoom; Ctrl+wheel must not page-zoom
    e.stopImmediatePropagation();
    const factor = wheelZoomFactor(e, canvas.clientHeight);
    if (factor === null) return;
    const point = pickPivot(e.clientX, e.clientY) ?? controls.target.clone();
    const r = zoomTowardPoint(
      camera.position,
      controls.target,
      point,
      factor,
      NAV_MIN_DIST_M,
      NAV_MAX_DIST_M,
    );
    camera.position.copy(r.position);
    controls.target.copy(r.target);
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

// Rubber-band box: terrain-hugging rectangle, rebuilt per drag move (size is unbounded).
const boxCyanMaterial = new THREE.LineBasicMaterial({
  color: BOX_CYAN,
  depthTest: false,
  transparent: true,
});
// Select-mode rubber bands (UI-SPEC Color): replace solid accent, add dashed accent,
// subtract dashed orange.
const bandMaterials = {
  replace: new THREE.LineBasicMaterial({
    color: SELECT_ACCENT,
    depthTest: false,
    transparent: true,
  }),
  add: new THREE.LineDashedMaterial({
    color: SELECT_ACCENT,
    dashSize: 1.5,
    gapSize: 1,
    depthTest: false,
    transparent: true,
  }),
  subtract: new THREE.LineDashedMaterial({
    color: SUBTRACT_ORANGE,
    dashSize: 1.5,
    gapSize: 1,
    depthTest: false,
    transparent: true,
  }),
};
const boxOutline = new THREE.LineLoop(new THREE.BufferGeometry(), boxCyanMaterial);
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
let selectionAvgEl: HTMLElement | null = null;
let roadsCountEl: HTMLElement | null = null;
/** Mode and armed brush the sidebar was last built for (rebuilt only when it changes). */
let sidebarKey = "";

// Mask selection (D-04, D-06): boundary outline plus a translucent fill. Select mode is solid,
// Brush mode is faint (UI-SPEC 6).
const selectionLines = new THREE.LineSegments(
  new THREE.BufferGeometry(),
  new THREE.LineBasicMaterial({ color: SELECT_ACCENT, depthTest: false, transparent: true }),
);
const selectionFill = new THREE.Mesh(
  new THREE.BufferGeometry(),
  new THREE.MeshBasicMaterial({
    color: SELECT_ACCENT,
    depthTest: false,
    depthWrite: false,
    transparent: true,
    side: THREE.DoubleSide,
  }),
);
for (const o of [selectionLines, selectionFill]) {
  o.renderOrder = 999;
  o.frustumCulled = false;
  o.visible = false;
  scene.add(o);
}

/** Select mode: fill 0.25, outline 1. Brush mode (faint): fill 0.10, outline 0.5. */
function applySelectionOpacity(): void {
  const select = dispatcher.getMode() === "select";
  (selectionFill.material as THREE.MeshBasicMaterial).opacity = select ? 0.25 : 0.1;
  (selectionLines.material as THREE.LineBasicMaterial).opacity = select ? 1 : 0.5;
}

/** Rebuilds the persistent selection outline + fill and read-out (heights move under it). */
function refreshSelectionOutline(): void {
  const mask = area ? dispatcher.getSelectionMask() : null;
  selectionLines.geometry.dispose();
  selectionFill.geometry.dispose();
  selectionLines.geometry = new THREE.BufferGeometry();
  selectionFill.geometry = new THREE.BufferGeometry();
  selectionLines.visible = false;
  selectionFill.visible = false;
  if (!mask || !area) {
    if (selectionReadoutEl) selectionReadoutEl.textContent = "Nothing selected";
    if (selectionAvgEl) selectionAvgEl.textContent = "-";
    refreshSelectionGrid();
    return;
  }
  const lines = mask.boundarySegments(area.grid, 0.2);
  selectionLines.geometry.setAttribute("position", new THREE.BufferAttribute(lines, 3));
  selectionLines.visible = lines.length > 0;
  const cells = mask.cellCount();
  if (cells <= SELECTION_FILL_MAX_CELLS) {
    const tris = mask.fillTriangles(area.grid, 0.18);
    selectionFill.geometry.setAttribute("position", new THREE.BufferAttribute(tris, 3));
    selectionFill.visible = tris.length > 0;
  }
  applySelectionOpacity();
  if (selectionReadoutEl) {
    const c = area.grid.cellSizeM;
    selectionReadoutEl.textContent = `${cells} cells, ${fmt3(cells * c * c)} m2`;
  }
  if (selectionAvgEl) {
    const avg = maskAverageHeight(area.grid, mask);
    selectionAvgEl.textContent = avg === null ? "-" : `${fmt3(avg)} m`;
  }
  refreshSelectionGrid();
}

/** Selection changed: a Select-mode grid follows the selection bounds. */
function refreshSelectionGrid(): void {
  if (!gridOn) return;
  gridKey = "";
  updateFootprintGrid(lastHit);
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
  shell.info.set(
    "roads",
    roadsInfoText(roadLockCounts(area.graph, (area as unknown as EditArea).unlockedEdgeIds)),
  );
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
  stopOpHold();
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
  clearBoxOutline();
  refreshSelectionOutline();
  overlayCentre = null;
  refreshOverlays();
  refreshRoadLockOverlay();
  refreshInfo();
  syncToolbar();
}

/** Loads a saved area. Resolves to the error text on failure, null on success or cancel. */
async function loadArea(id: string): Promise<string | null> {
  if (!(await confirmDiscard())) return null;
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
    return null;
  } catch (err) {
    const text = loadErrorMessage(`${id}.terrain.bin`, err);
    fail(text);
    return text;
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
  if (tool !== "select") {
    dispatcher.cancelSelectDrag();
    stroking = stroking && dispatcher.isStroking();
    clearBoxOutline();
  }
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

/** Ground point under the cursor (terrain, else the horizontal plane through the orbit target). */
function pickPivot(clientX: number, clientY: number): THREE.Vector3 | null {
  const hit = pickTerrain(clientX, clientY);
  if (hit) return new THREE.Vector3(hit.x, hit.y, hit.z);
  if (!area) {
    const rect = canvas.getBoundingClientRect();
    ndc.set(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    );
    raycaster.setFromCamera(ndc, camera);
  }
  const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -controls.target.y);
  return raycaster.ray.intersectPlane(plane, new THREE.Vector3());
}

/** Footprint shape of the active tool: the Shape option for the five radius brushes, else round. */
function footprintShape(): "round" | "square" {
  return FOOTPRINT_TOOLS.includes(tool) ? dispatcher.getOptions().brushShape : "round";
}

function ringRadius(): number {
  return tool === "road" ? CURSOR_RADIUS_M : dispatcher.getOptions().radiusM;
}

/** Draws the cursor shapes for the active tool, then refreshes the footprint grid under it. */
function paintRing(hit: { x: number; z: number }): void {
  paintRingShapes(hit);
  updateFootprintGrid(hit);
}

function paintRingShapes(hit: { x: number; z: number }): void {
  if (!area) return;
  if (tool === "select") {
    cursorRing.visible = false;
    const w = pushPull ? null : dispatcher.selectionPreview(hit.x, hit.z);
    if (w) {
      const op = dispatcher.selectionDragOp() ?? "replace";
      boxOutline.material = bandMaterials[op];
      setOutline(boxOutline, w, 0.12);
      if (op !== "replace") boxOutline.computeLineDistances();
    } else clearBoxOutline();
    return;
  }
  clearBoxOutline();
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
  const base = FOOTPRINT_TOOLS.includes(tool) ? FOOTPRINT_YELLOW : RING_GREEN;
  (cursorRing.material as THREE.LineBasicMaterial).color.setHex(slopeAmber ? RING_AMBER : base);
  cursorRing.visible = true;
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

// Quick 261110-rdx: road lock overlay (grey = locked, orange dashed = unlocked).
const ROAD_LOCK_LIFT_M = 0.4;
const lockedLines = new THREE.LineSegments(
  new THREE.BufferGeometry(),
  new THREE.LineBasicMaterial({ color: 0xcfd4da, depthTest: false }),
);
// Dashed so unlocked reads differently from locked even without colour.
const unlockedLines = new THREE.LineSegments(
  new THREE.BufferGeometry(),
  new THREE.LineDashedMaterial({
    color: 0xff8a1f,
    dashSize: 3,
    gapSize: 2,
    depthTest: false,
  }),
);
for (const l of [lockedLines, unlockedLines]) {
  l.frustumCulled = false;
  l.renderOrder = 997;
  scene.add(l);
}

function refreshRoadLockOverlay(): void {
  if (!area) {
    for (const l of [lockedLines, unlockedLines]) l.visible = false;
    return;
  }
  const segs = roadLockSegments(
    area.graph,
    (area as unknown as EditArea).unlockedEdgeIds,
    null,
    ROAD_LOCK_LIFT_M,
  );
  const set = (target: THREE.LineSegments, data: Float32Array): void => {
    target.geometry.dispose();
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(data, 3));
    target.geometry = g;
    if (target === unlockedLines) target.computeLineDistances();
    target.visible = data.length > 0;
  };
  set(lockedLines, segs.locked);
  set(unlockedLines, segs.unlocked);
  const counts = roadLockCounts(area.graph, (area as unknown as EditArea).unlockedEdgeIds);
  shell.info.set("roads", roadsInfoText(counts));
  updateRoadsCountEl();
}

function roadsInfoText(c: { locked: number; unlocked: number }): string {
  return `${c.locked + c.unlocked} roads: ${c.locked} locked, ${c.unlocked} unlocked`;
}

/** Select-mode hover: names the lock state of the road under the cursor. */
let lockHoverShown = false;
function updateLockHover(x: number, z: number): void {
  if (!area) return;
  if (tool !== "select" || stroking || pushPull) {
    if (lockHoverShown) {
      lockHoverShown = false;
      setStatus(currentHint);
    }
    return;
  }
  const near = nearestEdgeWithin(area.graph, x, z, LOCK_HOVER_RADIUS_M);
  if (!near) {
    if (lockHoverShown) {
      lockHoverShown = false;
      setStatus(currentHint);
    }
    return;
  }
  lockHoverShown = true;
  const free = isUnlocked(area as unknown as EditArea, near.edgeId);
  setStatus(
    free
      ? `Road ${near.edgeId} is UNLOCKED (terrain edits can move it).`
      : `Road ${near.edgeId} is LOCKED (terrain edits cannot move it).`,
  );
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

/**
 * Grid lines: over the selection bounds in Select mode with a selection (A4), otherwise for the
 * active tool's footprint under the cursor. Rebuilt when its cell window, spacing or tool changes.
 */
function updateFootprintGrid(hit: { x: number; z: number } | null): void {
  const sel = area && dispatcher.getMode() === "select" ? dispatcher.getSelectionMask() : null;
  if (!area || !gridOn || (!hit && !sel)) {
    gridLines.visible = false;
    return;
  }
  const g = area.grid;
  const sp = gridSpacing;
  if (sel) {
    const sw = sel.bounds();
    if (
      !sw ||
      needsZoomHint(cellPxAtAnchor()) ||
      sw.maxCol - sw.minCol > FOOTPRINT_GRID_MAX_CELLS ||
      sw.maxRow - sw.minRow > FOOTPRINT_GRID_MAX_CELLS
    ) {
      gridLines.visible = false;
      return;
    }
    const skey = `sel|${sp}|${sw.minRow},${sw.minCol},${sw.maxRow},${sw.maxCol}`;
    gridLines.visible = true;
    if (skey === gridKey) return;
    gridKey = skey;
    setLines(gridLines, gridLineSegments(g, sw, FOOTPRINT_LIFT_M, sp));
    return;
  }
  if (!hit) {
    gridLines.visible = false;
    return;
  }
  let w: CellWindow | null;
  let r = 0;
  let shape: "round" | "square" = "round";
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
  const q = shape === "round" ? g.cellSizeM / 2 : 0;
  const qx = q > 0 ? Math.round(hit.x / q) : 0;
  const qz = q > 0 ? Math.round(hit.z / q) : 0;
  const key = `${tool}|${r}|${shape}|${sp}|${w.minRow},${w.minCol},${w.maxRow},${w.maxCol}|${qx},${qz}`;
  gridLines.visible = true;
  if (key === gridKey) return;
  gridKey = key;
  setLines(gridLines, footprintGridSegments(g, hit.x, hit.z, r, shape, FOOTPRINT_LIFT_M, sp));
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
  syncToolbar();
}

/** Alt + wheel: step the brush radius by whole cells (Brush mode). */
function altWheelStep(dir: 1 | -1): void {
  if (!area || activeValue !== radiusActive) return;
  radiusActive.set(stepRadiusCells(dispatcher.getOptions().radiusM, area.grid.cellSizeM, dir));
  if (lastHit) paintRing(lastHit);
}

function updateCursor(clientX: number, clientY: number): void {
  if (!area) return;
  const hit = pickTerrain(clientX, clientY);
  if (!hit) {
    cursorRing.visible = false;
    if (!stroking) clearBoxOutline();
    lastHit = null;
    updateFootprintGrid(null);
    applyCanvasCursor();
    shell.info.set("cursor", "off the terrain");
    shell.info.set("surface", "");
    return;
  }
  lastHit = { x: hit.x, z: hit.z };
  paintRing(hit);
  updateLockHover(hit.x, hit.z);
  maybeRebuildContours(hit.x, hit.z);
  shell.info.set(
    "cursor",
    `x ${fmt3(hit.x)}  z ${fmt3(hit.z)}  h ${fmt3(sampleTerrainHeight(area.grid, hit.x, hit.z))} m`,
  );
  shell.info.set("surface", surfaceAt(area.paint, hit.x, hit.z));
  applyCanvasCursor();
}

/** Crosshair over terrain in Select mode; ns-resize while push/pulling (UI-SPEC). */
function applyCanvasCursor(): void {
  canvas.style.cursor = pushPull
    ? "ns-resize"
    : tool === "select" && lastHit !== null
      ? "crosshair"
      : "";
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
    const selfX = failures.filter((f) => f.category === "GEOMETRY_SELF_INTERSECTION");
    // Count warnings the way the panel lists them: one per cut-off piece / trapped junction.
    const warnings = buildRoadProblems(area.graph, failures).filter(
      (r) => !r.blocking && /(UNDIRECTED_REACHABILITY|DIRECTED_PATHABILITY)/.test(r.tip),
    ).length;
    if (warnings > 0) {
      log(
        `info: ${warnings} road warning(s): cut-off pieces or one-way traps. Saving still works; see View > Road problems.`,
      );
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
  rpTitle.textContent = `Road problems: ${rows.length} (${blocking} block saving)`;
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
  box.appendChild(
    el(
      "div",
      row.blocking ? "rp-tag rp-badge-block" : "rp-tag rp-badge-warn",
      row.blocking ? "blocks saving" : "warning",
    ),
  );
  box.appendChild(el("div", undefined, row.text));
  const fixes = row.fixes ?? [];
  if (fixes.length === 0 && row.hint) box.appendChild(el("div", "rp-hint", row.hint));
  if (fixes.length > 0) {
    const actions = el("div", "rp-actions");
    for (const f of fixes) {
      actions.appendChild(
        createButton({
          label: f.label,
          tip: `${f.tip} One click is one undo step (Ctrl+Z).`,
          onClick: () => applyRoadProblemFix(f),
        }),
      );
    }
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

function applyRoadProblemFix(f: RoadFix): void {
  if (!area || stroking || pushPull) return;
  clearRoadProblemHighlight();
  applyResult(dispatcher.applyRoadFix(f.kind, f.edgeId, f.nodeId), 0);
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
  if (res.selectionChanged) syncToolbar();
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
          ? `Changed ${sign}${fmt3(delta)} m; ${held} vertices held by roads did not move. Select the road and press Unlock (U) to sculpt it.`
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

function modsOf(e: PointerEvent): { shift: boolean; ctrl: boolean; alt: boolean } {
  return { shift: e.shiftKey, ctrl: e.ctrlKey || e.metaKey, alt: e.altKey };
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
    res = dispatcher.pointerDown(hit.x, hit.z, modsOf(e));
  } else if (phase === "move") {
    if (!hit) return;
    res = dispatcher.pointerMove(hit.x, hit.z, modsOf(e));
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
  applyCanvasCursor();
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
  if (e.altKey && dispatcher.getMode() === "select") {
    e.preventDefault(); // no browser Alt menu or text selection while dragging
    if (pushPull) return;
    stopOpHold(); // a key/pointer hold-repeat must commit before push/pull records
    if (!dispatcher.getSelectionMask() || !dispatcher.beginPushPull()) {
      setStatus(NO_SELECTION_CLICK_MSG, "error");
      return;
    }
    pushPull = { startY: e.clientY, pointerId: e.pointerId, dirtyBefore: dirty, lastDeltaM: 0 };
    canvas.setPointerCapture(e.pointerId);
    applyCanvasCursor();
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
    applyCanvasCursor();
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
    clearBoxOutline();
  }
});

function undoRedo(kind: "undo" | "redo"): void {
  if (!area || stroking || pushPull || opHold) return;
  const r = kind === "undo" ? dispatcher.undo() : dispatcher.redo();
  if (!r) return;
  rebuild(r.dirtyHeights, { heights: true });
  rebuild(r.dirtyPaint, { paint: true });
  refreshOverlaysAfterEdit(r.dirtyHeights);
  refreshSelectionOutline();
  syncToolbar();
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

interface ActiveValue {
  get(): number;
  set(v: number): void;
  spec: StepperSpec;
}
/** The active tool's main value, adjusted by [ ] and the arrow keys (D-09). */
let activeValue: ActiveValue | null = null;

const RADIUS_SPEC: StepperSpec = { step: 0.5, coarse: 10, min: 0.5, max: 200, decimals: 1 };
const STRENGTH_SPEC: StepperSpec = { step: 0.05, coarse: 5, min: 0, max: 1, decimals: 2 };
const ROAD_WIDTH_SPEC: StepperSpec = { step: 0.5, coarse: 2, min: 3, max: 20, decimals: 1 };
const SELECT_STEP_SPEC: StepperSpec = { step: 0.25, coarse: 4, min: 0.25, max: 5, decimals: 2 };
const SLOPE_LIMIT_SPEC: StepperSpec = {
  step: 1,
  coarse: 5,
  min: SLOPE_LIMIT_MIN_DEG,
  max: SLOPE_LIMIT_MAX_DEG,
  decimals: 0,
};
const ROAD_BANK_SPEC: StepperSpec = { step: 1, coarse: 5, min: 0, max: 20, decimals: 0 };
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

function note(text: string): HTMLElement {
  return el("div", "muted", text);
}

function runLockAction(fn: () => ToolResult): void {
  if (!area || stroking) return;
  const t0 = performance.now();
  applyResult(fn(), performance.now() - t0);
  updateHistoryButtons();
}

/** Shared Surface picker (D-11): one value feeds the Terrain fill and the Terrain brush. */
function surfaceSwatches(): HTMLElement {
  const group = el("div", "swatch-grid");
  group.setAttribute("role", "radiogroup");
  group.setAttribute("aria-label", "Surface");
  group.style.display = "grid";
  group.style.gridTemplateColumns = "repeat(4, 32px)";
  group.style.gap = "4px";
  const current = dispatcher.getOptions().surface;
  const buttons: [SurfaceType, HTMLButtonElement][] = [];
  const sync = (): void => {
    const now = dispatcher.getOptions().surface;
    for (const [s, b] of buttons) {
      b.setAttribute("aria-checked", String(s === now));
      b.style.outline = s === now ? "2px solid #4aa3ff" : "1px solid #555";
    }
  };
  for (const s of SURFACE_TYPES) {
    const b = el("button", "swatch", undefined, s);
    b.type = "button";
    b.setAttribute("role", "radio");
    b.setAttribute("aria-label", s);
    b.setAttribute("aria-checked", String(s === current));
    b.dataset.tip = s;
    b.style.width = "32px";
    b.style.height = "32px";
    b.style.padding = "0";
    b.style.cursor = "pointer";
    b.style.background = `#${TERRAIN_SURFACE_PALETTE[s].toString(16).padStart(6, "0")}`;
    b.addEventListener("click", () => {
      dispatcher.setOptions({ surface: s });
      sync();
    });
    buttons.push([s, b]);
    group.appendChild(b);
  }
  sync();
  return createField("Surface", group, "Surface type that is filled or painted (affects grip)");
}

function updateRoadsCountEl(): void {
  if (!roadsCountEl) return;
  roadsCountEl.textContent = area
    ? roadsInfoText(roadLockCounts(area.graph, (area as unknown as EditArea).unlockedEdgeIds))
    : "No area loaded";
}

/** Sidebar content for the current mode and armed brush (D-12, D-18, D-27). */
function buildSidebar(): void {
  activeValue = null;
  selectionReadoutEl = null;
  selectionAvgEl = null;
  roadsCountEl = null;
  const o = dispatcher.getOptions();
  const f = shell.flyout;
  f.replaceChildren();
  const mode = dispatcher.getMode();
  const armed = dispatcher.getArmed();

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

  if (mode === "select") {
    selectionReadoutEl = el("div", "muted");
    selectionAvgEl = el("div", "muted");
    roadsCountEl = el("div", "muted");
    const fullWidth = (label: string, tip: string, run: () => ToolResult): HTMLButtonElement => {
      const b = createButton({ label, tip, onClick: () => runLockAction(run) });
      b.style.width = "100%";
      return b;
    };
    const step = optStepper(
      "Step",
      "Height change per Raise or Lower tick in metres",
      SELECT_STEP_SPEC,
      o.selectStepM,
      "m",
      (v) => dispatcher.setOptions({ selectStepM: v }),
      true,
    );
    f.append(
      note("Drag on the map to select an area."),
      note(SELECT_HINT),
      step.field,
      optStepper(
        "Smooth strength",
        "How strongly Smooth acts on the selection each tick, 0 to 1",
        STRENGTH_SPEC,
        o.selectSmoothStrength,
        "",
        (v) => dispatcher.setOptions({ selectSmoothStrength: v }),
      ).field,
      slope(),
      surfaceSwatches(),
      createField("Selection size", selectionReadoutEl, "Cells and area of the selection"),
      createField("Average height", selectionAvgEl, "Average terrain height of the selection"),
      createSection("Roads", "Road actions for the selection and the whole map", true, [
        fullWidth(
          "Re-grade selection",
          "Re-grade the unlocked roads touching the selection so they fit the terrain again",
          () => dispatcher.regradeSelection(),
        ),
        fullWidth(
          "Re-grade all unlocked",
          "Re-grade every unlocked road so it fits the terrain again",
          () => dispatcher.regradeAllUnlocked(),
        ),
        fullWidth("Lock all", "Lock every road so terrain edits cannot move it", () =>
          dispatcher.lockAll(true),
        ),
        fullWidth(
          "Unlock all",
          "Unlock every road so terrain edits can reshape the ground under it",
          () => dispatcher.lockAll(false),
        ),
        roadsCountEl,
      ]),
    );
    updateRoadsCountEl();
    refreshSelectionOutline();
    return;
  }

  activeValue = radiusActive;
  switch (armed) {
    case "raise":
    case "lower":
    case "flatten":
      f.append(strength(), falloff(), slope());
      break;
    case "smooth":
      f.append(
        strength(),
        falloff(),
        slope(),
        optStepper(
          "Smooth strength",
          "Strength used by Smooth whole map, 0 to 1",
          STRENGTH_SPEC,
          o.smoothStrength,
          "",
          (v) => dispatcher.setOptions({ smoothStrength: v }),
        ).field,
        optStepper(
          "Passes",
          "How many smoothing passes Smooth whole map runs, 1 to 10",
          PASSES_SPEC,
          o.smoothPasses,
          undefined,
          (v) => dispatcher.setOptions({ smoothPasses: v }),
        ).field,
        createButton({
          label: "Smooth whole map",
          tip: "Smooth the entire map (Ctrl+Z undoes it)",
          onClick: () => void smoothWholeMap(),
        }),
      );
      break;
    case "terrain":
      f.append(strength(), falloff(), slope(), surfaceSwatches());
      break;
    case "roadPaint": {
      const width = optStepper(
        "Width",
        "Road width in metres",
        ROAD_WIDTH_SPEC,
        o.widthM,
        "m",
        (v) => dispatcher.setOptions({ widthM: v }),
      );
      const bank = optStepper(
        "Max bank",
        "Steepest sideways tilt of the road in degrees",
        ROAD_BANK_SPEC,
        o.maxBankDeg,
        "deg",
        (v) => dispatcher.setOptions({ maxBankDeg: v }),
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
              bank.stepper.set(dispatcher.getOptions().maxBankDeg);
            },
          }).el,
          "Road class",
        ),
        width.field,
        bank.field,
      );
      break;
    }
    case "roadErase":
      f.append(note("Drag over roads to erase them."));
      break;
    default:
      f.append(note("Pick an operation."));
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
    contourStepper.set(contourInterval);
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

// ---------------------------------------------------------------- floating toolbar (07.1.2)

const brushShapeButtons = new Map<"square" | "round", HTMLButtonElement>();

function pick<T extends { id: string }>(list: readonly T[], id: string): T {
  const found = list.find((t) => t.id === id);
  if (!found) throw new Error(`toolbar tool missing: ${id}`);
  return found;
}

function makeBrushShapeSlot(): HTMLElement {
  const box = el("div", "float-slot");
  box.setAttribute("role", "group");
  box.setAttribute("aria-label", "Brush shape");
  const mk = (shape: "square" | "round", glyph: string, label: string): HTMLButtonElement => {
    const b = el("button", "tool-btn", glyph, `${label} brush`);
    b.type = "button";
    b.setAttribute("aria-label", label);
    b.setAttribute("aria-pressed", "false");
    b.style.width = "32px";
    b.style.height = "32px";
    b.addEventListener("click", () => {
      dispatcher.setOptions({ brushShape: shape });
      syncToolbar();
      if (lastHit) paintRing(lastHit);
    });
    brushShapeButtons.set(shape, b);
    return b;
  };
  box.append(mk("square", "■", "Square"), mk("round", "●", "Circle"));
  return box;
}

const brushSizeStepper = createStepper({
  value: dispatcher.getOptions().radiusM,
  spec: RADIUS_SPEC,
  tip: "Brush size",
  unit: "m",
  onChange: (v) => {
    dispatcher.setOptions({ radiusM: v });
    if (lastHit) paintRing(lastHit);
  },
});
/** [ ] / arrow keys and Alt+wheel adjust the floating brush size in Brush mode. */
const radiusActive: ActiveValue = {
  get: () => brushSizeStepper.get(),
  set: (v) => {
    brushSizeStepper.set(v);
    dispatcher.setOptions({ radiusM: v });
    brushSizeStepper.set(dispatcher.getOptions().radiusM);
  },
  spec: RADIUS_SPEC,
};
const gridSpacingStepper = createStepper({
  value: gridSpacing,
  spec: { step: 1, coarse: 5, min: 1, max: 50, decimals: 0, presets: GRID_SPACING_PRESETS_CELLS },
  tip: "Grid spacing in cells",
  unit: "cells",
  onChange: (v) => {
    gridSpacing = v;
    gridKey = "";
    updateFootprintGrid(lastHit);
  },
});
const contourStepper = createStepper({
  value: contourInterval,
  spec: { step: 0.25, coarse: 4, min: CONTOUR_MIN_M, max: CONTOUR_MAX_M, decimals: 2 },
  tip: "Contour interval in metres",
  unit: "m",
  onChange: (v) => {
    contourInterval = v;
    refreshOverlays();
  },
});
const brushShapeSlot = makeBrushShapeSlot();
/** Slots that belong to the Brush chip: dimmed in Select mode (UI-SPEC opacity 0.4). */
const brushSlotEls: HTMLElement[] = [brushSizeStepper.el, brushShapeSlot];

const FLOAT_GROUPS: BarGroup[] = [
  {
    id: "modes",
    label: "Mode",
    items: MODES.map((t) => ({ kind: "tool" as const, tool: t })),
  },
  {
    id: "brush",
    label: "Brush options",
    items: [
      { kind: "slot", id: "brushSize" },
      { kind: "slot", id: "brushShape" },
    ],
  },
  {
    id: "grid",
    label: "Grid",
    items: [
      { kind: "tool", tool: pick(VIEW_TOGGLES, "grid") },
      { kind: "slot", id: "gridSpacing" },
    ],
  },
  {
    id: "contours",
    label: "Contours",
    items: [
      { kind: "tool", tool: pick(VIEW_TOGGLES, "contours") },
      { kind: "slot", id: "contourInterval" },
    ],
  },
  {
    id: "ops",
    label: "Operations",
    items: ["smooth", "flatten", "terrain"].map((id) => ({
      kind: "tool" as const,
      tool: pick(OPERATIONS, id),
    })),
  },
  {
    id: "raiseLower",
    label: "Raise and lower",
    items: [{ kind: "stack", tools: [pick(OPERATIONS, "raise"), pick(OPERATIONS, "lower")] }],
  },
  {
    id: "roads",
    label: "Roads",
    items: [
      { kind: "tool", tool: pick(ROAD_BUTTONS, "roadPaint") },
      { kind: "tool", tool: pick(ROAD_BUTTONS, "roadErase") },
      { kind: "divider" },
      { kind: "tool", tool: pick(ROAD_BUTTONS, "lock") },
      { kind: "tool", tool: pick(ROAD_BUTTONS, "unlock") },
      { kind: "tool", tool: pick(ROAD_BUTTONS, "deleteRoad") },
    ],
  },
];

function toolbarInput(): ToolbarInput {
  return {
    mode: dispatcher.getMode(),
    selectionCells: dispatcher.selectionCellCount(),
    cellSizeM: area?.grid.cellSizeM ?? 1,
    armed: dispatcher.getArmed(),
  };
}

/** The single place a toolbar id is resolved to an action (clicks and hotkeys both land here). */
function routeToolbar(id: ToolbarId): ReturnType<typeof resolveToolbarAction> {
  return resolveToolbarAction(toolbarInput(), id);
}

let lastSyncedMode = dispatcher.getMode();

/** The editor's legacy `tool` follows the dispatcher mode and armed brush. */
function syncToolFromDispatcher(): void {
  const mode = dispatcher.getMode();
  const armed = dispatcher.getArmed();
  const next: Tool = mode === "select" ? "select" : armed ? BRUSH_TOOL_FOR[armed] : "raise";
  if (next !== tool) selectTool(next);
  applySelectionOpacity();
  if (mode !== lastSyncedMode) {
    lastSyncedMode = mode;
    refreshSelectionGrid();
    if (mode === "select") setStatus(SELECT_HINT);
  }
  applyCanvasCursor();
}

/** Pressed, enabled and tooltip state of every toolbar control, plus the sidebar title. */
function syncToolbar(): void {
  const input = toolbarInput();
  const st = toolbarState(input);
  const key = `${input.mode}|${input.armed ?? ""}`;
  if (key !== sidebarKey) {
    sidebarKey = key;
    buildSidebar();
  }
  const f = shell.bar;
  if (f) {
    for (const t of TOOLBAR_TOOLS) {
      f.setEnabled(t.id, st.enabled[t.id], st.disabledTip[t.id]);
      const pressed =
        t.id === "grid" ? gridOn : t.id === "contours" ? contoursOn : st.pressed[t.id];
      f.setPressed(t.id, pressed);
    }
  }
  const shape = dispatcher.getOptions().brushShape;
  for (const [k, b] of brushShapeButtons) b.setAttribute("aria-pressed", String(k === shape));
  for (const slot of brushSlotEls) {
    slot.style.opacity = st.brushControlsEnabled ? "" : "0.4";
    slot.style.pointerEvents = st.brushControlsEnabled ? "" : "none";
  }
  shell.setSidebarTitle(st.title, st.subtitle);
  shell.setClearSelectionEnabled(input.selectionCells > 0);
  if (opHold && input.selectionCells === 0) stopOpHold();
}

// Hold-to-repeat for Raise, Lower and Smooth (D-08, D-10): one undo step per press-hold-release.
type HoldOp = "raise" | "lower" | "smooth";
const HOLD_OPS: readonly HoldOp[] = ["raise", "lower", "smooth"];
const isHoldOp = (id: string): id is HoldOp => (HOLD_OPS as readonly string[]).includes(id);
let opHold: { op: HoldOp; repeater: ReturnType<typeof createRepeater>; key?: string } | null = null;
/** The click that follows a pointer hold must not apply a second step. */
let clickSuppress: ToolbarId | null = null;

function startOpHold(op: HoldOp, key?: string): boolean {
  if (!area || opHold || stroking || pushPull) return false;
  if (routeToolbar(op).kind !== "apply") return false;
  let first = true;
  const repeater = createRepeater({
    delayMs: REPEAT_DELAY_MS,
    intervalMs: OP_REPEAT_MS,
    tick: () => {
      const res = first ? dispatcher.beginOpRepeat(op) : dispatcher.opRepeatTick();
      first = false;
      applyResult(res, 0);
    },
  });
  opHold = { op, repeater, key };
  repeater.start();
  if (!dispatcher.isRepeating()) {
    stopOpHold();
    return false;
  }
  return true;
}

function stopOpHold(): void {
  const h = opHold;
  if (!h) return;
  opHold = null;
  h.repeater.stop();
  if (area) {
    // The ticks already refreshed the view; the end only commits the single undo entry.
    dispatcher.endOpRepeat();
    updateHistoryButtons();
    refreshRoadProblems();
  }
  syncToolbar();
}

function endPointerHold(id: HoldOp): void {
  if (!opHold || opHold.key !== undefined || opHold.op !== id) return;
  stopOpHold();
  window.setTimeout(() => {
    clickSuppress = null;
  }, 0);
}

function runToolbarAction(id: ToolbarId): void {
  if (clickSuppress === id) {
    clickSuppress = null;
    syncToolbar();
    return;
  }
  const act = routeToolbar(id);
  switch (act.kind) {
    case "mode":
    case "arm":
      stopOpHold();
      cancelActiveStroke();
      if (act.kind === "mode") dispatcher.setMode(act.mode);
      else dispatcher.armBrush(act.op);
      stroking = stroking && dispatcher.isStroking();
      syncToolFromDispatcher();
      break;
    case "apply":
      stopOpHold(); // keep the editor's hold and the dispatcher's repeat session in step
      runLockAction(() => dispatcher.applyOperation(act.op));
      shell.bar?.flash(id);
      break;
    case "roadAction":
      runLockAction(() => dispatcher.applyRoadAction(act.action));
      break;
    case "toggle":
      toggleOverlay(act.which);
      break;
    case "blocked":
      setStatus(act.status);
      break;
  }
  syncToolbar();
}

function clearSelectionNow(): void {
  stopOpHold();
  dispatcher.cancelSelectDrag();
  dispatcher.clearSelection();
  clearBoxOutline();
  refreshSelectionOutline();
  syncToolbar();
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
  tools: TOOLBAR_TOOLS,
  onToolChange: () => {},
  bar: {
    groups: FLOAT_GROUPS,
    slots: {
      brushSize: brushSizeStepper.el,
      brushShape: brushShapeSlot,
      gridSpacing: gridSpacingStepper.el,
      contourInterval: contourStepper.el,
    },
  },
  onToolbarClick: (id) => runToolbarAction(id as ToolbarId),
  history: {
    undo: () => undoRedo("undo"),
    redo: () => undoRedo("redo"),
    clearSelection: {
      run: clearSelectionNow,
      tip: "Clear selection: deselect everything (Esc)",
    },
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
      if (dialogOpen) return;
      if (opHold) {
        stopOpHold();
        return;
      }
      if (pushPull) {
        cancelPushPullDrag("Push/pull cancelled.");
        return;
      }
      if (tool === "select" && stroking) {
        // Abandon a rubber-band drag without changing the selection.
        dispatcher.cancelSelectDrag();
        stroking = false;
        clearBoxOutline();
        refreshSelectionOutline();
        setStatus("Selection drag cancelled.");
        return;
      }
      if (dispatcher.selectionCellCount() > 0) {
        clearSelectionNow();
        setStatus("Selection cleared.");
      }
      return;
    case "topdown":
      setTopDown(!topDown);
      return;
    case "drive":
      void driveHere();
      return;
    default:
      break;
  }
  if (textFocused || dialogOpen || e.altKey || e.ctrlKey || e.metaKey) return;
  const tid = TERRAIN_HOTKEYS[e.code];
  if (tid) {
    e.preventDefault();
    if (e.repeat) return; // OS key repeat never re-fires a toolbar action
    if (isHoldOp(tid) && startOpHold(tid, e.code)) return;
    runToolbarAction(tid);
    return;
  }
  if (e.code === "Escape") return;
  const adj = adjustDirection(e);
  if (adj && activeValue && !(active instanceof HTMLSelectElement)) {
    e.preventDefault();
    activeValue.set(stepValue(activeValue.get(), adj.dir, activeValue.spec, adj.coarse));
    if (lastHit) paintRing(lastHit);
  }
});

window.addEventListener("keyup", (e) => {
  if (opHold?.key === e.code) stopOpHold();
});
window.addEventListener("blur", () => stopOpHold());

// D-05 (assumption A1): a bare Alt press must not open the browser menu while Alt+drag push/pull
// is in use. Text fields and dialogs keep the default.
const suppressAltMenu = (e: KeyboardEvent): void => {
  if (e.key === "Alt" && !isTextEntryFocused(document.activeElement) && !shell.isDialogOpen()) {
    e.preventDefault();
  }
};
window.addEventListener("keydown", suppressAltMenu);
window.addEventListener("keyup", suppressAltMenu);

// Hold-to-repeat on the Raise, Lower and Smooth buttons (D-08, D-10).
for (const id of HOLD_OPS) {
  const b = shell.bar?.button(id);
  if (!b) continue;
  b.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    if (!startOpHold(id)) return;
    clickSuppress = id;
    try {
      b.setPointerCapture(e.pointerId);
    } catch {
      // capture is best-effort; pointerleave still ends the hold
    }
  });
  for (const ev of ["pointerup", "pointerleave", "pointercancel", "lostpointercapture"]) {
    b.addEventListener(ev, () => endPointerHold(id));
  }
}

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

syncToolbar();
applySelectionOpacity();
updateHistoryButtons();
setHint(DEFAULT_HINT);
setStatus("No area loaded. Use File > Open area or File > New.");
auditTips(document);
const MAP_EDITOR_URL = "/tools/map-editor/index.html";
const SAFE_AREA_ID = /^[a-z0-9-]{1,64}$/;

/** Area id as shown to the user: only names the server could have saved, else "(invalid name)". */
function displayAreaId(raw: string): string {
  return SAFE_AREA_ID.test(raw) ? raw : "(invalid name)";
}

const errText = (err: unknown): string => (err instanceof Error ? err.message : String(err));

/** Lists saved areas, retrying (0.5 s, 1 s, 2 s) so a dev-server restart racing the navigation recovers. */
async function refreshAreaListWithRetry(): Promise<void> {
  const delays = [500, 1000, 2000];
  for (let attempt = 0; ; attempt++) {
    try {
      await refreshAreaList();
      return;
    } catch (err) {
      if (attempt >= delays.length) throw err;
      log(`Cannot list areas yet (${errText(err)}); retrying.`);
      await new Promise((r) => window.setTimeout(r, delays[attempt]));
    }
  }
}

/** GD-SCOPE-2: a failed ?area handoff is always explained on screen with a way back. */
async function showAreaOpenFailure(rawId: string, reason: string): Promise<void> {
  const id = displayAreaId(rawId);
  const message = `Could not open ${id}: ${reason}`;
  setStatus(message, "error");
  log(message);
  const body = el("div");
  body.appendChild(el("p", undefined, reason));
  body.appendChild(
    el(
      "p",
      undefined,
      "Your drawing is safe in the map editor: nothing there was changed or lost.",
    ),
  );
  body.appendChild(
    el(
      "p",
      undefined,
      "Next step: go back to the map editor and use Open in terrain editor again.",
    ),
  );
  const r = await openDialog<"back" | "stay">({
    title: `Could not open ${id}`,
    body,
    actions: [
      {
        id: "back",
        label: "Back to map editor",
        tip: "Return to the map editor to try the handoff again",
        primary: true,
      },
      { id: "stay", label: "Stay here", tip: "Close this message and stay in the terrain editor" },
    ],
  });
  if (r === "back") location.href = MAP_EDITOR_URL;
}

async function startupOpen(): Promise<void> {
  // ?area=<id> (from the map editor's "Open in terrain editor"): exact match against the saved list only.
  const wanted = new URLSearchParams(location.search).get("area");
  if (wanted === null) {
    try {
      await refreshAreaList();
    } catch (err) {
      log(`Cannot list areas: ${errText(err)}`);
    }
    return;
  }
  try {
    await refreshAreaListWithRetry();
  } catch (err) {
    await showAreaOpenFailure(
      wanted,
      `The editor could not reach the dev server to list saved terrain maps (${errText(err)}).`,
    );
    return;
  }
  const match = knownAreas.find((id) => id === wanted);
  if (match === undefined) {
    const id = displayAreaId(wanted);
    await showAreaOpenFailure(
      wanted,
      `There is no saved terrain map called ${id}${id === wanted ? ` (expected public/maps/${id}.terrain.json)` : ""}.`,
    );
    return;
  }
  const error = await loadArea(match);
  if (error !== null || area?.areaId !== match) {
    await showAreaOpenFailure(wanted, error ?? "The saved terrain map did not load.");
  }
}

void startupOpen();
requestAnimationFrame(frame);
