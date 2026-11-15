/**
 * Dev-only 3D terrain sculpt page (D-09). This module is the shell: scene,
 * orbit / top-down camera, terrain picking, area list / new / load / save via
 * the `/__terrain/*` middleware, cursor ring and readouts, and the DOM glue
 * for the tool dispatcher (tools, options, shortcuts, undo/redo, validator
 * log, Drive here).
 */
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { type AuthoredCrest, rampLengthM } from "../../src/core/crest-geometry.ts";
import { yawFromTravelDirection } from "../../src/core/heading.ts";
import { buildRoadGeometry } from "../../src/core/road-geometry.ts";
import {
  BUILDING_STYLES,
  BUSH_VARIANTS,
  FENCE_VARIANTS,
  HEDGE_VARIANTS,
  resolveBuildingStyle,
  TREE_VARIANTS,
} from "../../src/core/scenery-catalog.ts";
import { SURFACE_TYPES, type SurfaceType } from "../../src/core/surface-types.ts";
import { maskAverageHeight, stepRadiusCells } from "../../src/core/terrain-brush.ts";
import {
  crestsFromObjects,
  nearestEdgeHeading,
  terrainGridExtent,
} from "../../src/core/terrain-drive-setup.ts";
import {
  encodeTerrainBinary,
  loadTerrainArea,
  MAX_BUILDINGS,
  MAX_CREST_HEIGHT_M,
  MAX_LINE_HEIGHT_M,
  MAX_START_NAME_CHARS,
  serializeTerrainSidecar,
  type TerrainArea,
  type TerrainBuilding,
  type TerrainFeature,
  type TerrainObject,
  type TerrainPointFeature,
  type TerrainStartPoint,
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
import { buildCrestMeshes } from "../../src/render/crest-view.ts";
import {
  buildFeaturePreview,
  createSceneryView,
  estimateSceneryTriangles,
  type SceneryView,
} from "../../src/render/scenery-view.ts";
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
  createToggle,
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
import { menuFace } from "../editor-shell/top-bar.ts";
import { validateGraph } from "../map-compiler/validate/validator.ts";
import { wheelZoomFactor } from "../map-editor/world.ts";
import { orbitAboutPivot, panByPixels, worldPerPixel, zoomTowardPoint } from "./camera-nav.ts";
import { buildDriveUrl, yawToHeadingDeg } from "./drive-url.ts";
import {
  addLineFeature,
  addPointFeature,
  addRampObject,
  BUILDING_TOO_SMALL,
  canPlaceAt,
  canPlaceLine,
  deleteBuilding,
  deleteFeature,
  deleteRamp,
  featureIdSeed,
  footprintCorners,
  LINE_TOO_FEW_POINTS,
  moveFeature,
  pickFeatureByRay,
  RAMP_FOOT_RADIUS_M,
  removeInMask,
  type ScenerySelection,
  scatterPoints,
  seatBuilding,
} from "./features.ts";
import { createEmptyTerrainArea } from "./new-area.ts";
import { createDragGesture, createLineBuilder, DRAG_HEADING_MIN_M } from "./place-tool.ts";
import {
  BRUSH_TOOL_FOR,
  PLACE_MENU,
  type PlaceKind,
  ROAD_BUTTONS,
  ROAD_MENU,
  TERRAIN_BAR,
  TERRAIN_HOTKEYS,
  TOOLBAR_TOOLS,
  type ToolbarId,
} from "./rail-tools.ts";
import { buildRoadProblems, type RoadFix, type RoadProblemRow } from "./road-problems.ts";
import { blockingRoadFailures, saveBlockMessage, staleRoadBlockMessage } from "./save-guard.ts";
import { putTerrainPair } from "./save-pair.ts";
import {
  canPlaceRampAt,
  checkSceneryBudget,
  fitScatterToBudget,
  type MoveResult,
  moveSceneryItem,
  type SceneryArea,
} from "./scenery-guards.ts";
import {
  addStartPoint,
  defaultStartPoint,
  makeDefault,
  moveStartPoint,
  removeStartPoint,
  renameStartPoint,
  startIdSeed,
  turnStartPoint,
} from "./start-points.ts";
import {
  createToolDispatcher,
  type EditArea,
  SLOPE_LIMIT_MAX_DEG,
  SLOPE_LIMIT_MIN_DEG,
  type Tool,
  type ToolResult,
} from "./tool-dispatch.ts";
import {
  resolveHotkey,
  resolveToolbarAction,
  type ToolbarInput,
  toolbarState,
} from "./toolbar-state.ts";

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
    if (buildGesture.active()) {
      // A footprint drag is live: the wheel turns the building 15 degrees, it does not zoom.
      e.preventDefault();
      e.stopImmediatePropagation();
      const raw = e.deltaY || e.deltaX;
      if (raw !== 0) rotateBuildingDrag(raw < 0 ? 1 : -1);
      return;
    }
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
let surfaceReadoutEl: HTMLElement | null = null;
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
  if (deleteSceneryBtn) deleteSceneryBtn.disabled = mask === null;
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

// ---------------------------------------------------------------- start points (07.1.3)

const START_DEFAULT_COLOR = 0x66cc99;
const START_OTHER_COLOR = 0xffb347;
const START_PICK_RADIUS_M = 2;
const START_RING_RADIUS_M = 1.6;
const START_TAG_LIFT_M = 3.6;

/** Never-reused id counter for new start points (D-03); never reset on undo. */
let startSeed = 1;
let selectedStartId: string | null = null;
/** Live preview list while a marker is being dragged or turned (committed on pointer-up). */
let startDraft: readonly TerrainStartPoint[] | null = null;
const startMarkers = new THREE.Group();
scene.add(startMarkers);
const startTags: { el: HTMLElement; pos: THREE.Vector3 }[] = [];
const startTagLayer = el("div");
startTagLayer.style.cssText =
  "position:absolute;inset:0;overflow:hidden;pointer-events:none;z-index:5";
wrap.appendChild(startTagLayer);
const gestureMaterial = new THREE.LineBasicMaterial({
  color: SELECT_ACCENT,
  depthTest: false,
  transparent: true,
});
let gestureLine: THREE.Line | null = null;
const startGesture = createDragGesture();
/** A marker press in progress: move (plain drag) or turn (Shift-drag). */
let startDrag: { id: string; mode: "move" | "turn"; pointerId: number; moved: boolean } | null =
  null;

function currentStarts(): readonly TerrainStartPoint[] {
  return startDraft ?? area?.startPoints ?? [];
}

function setGesturePreview(
  from: { x: number; z: number } | null,
  to: { x: number; z: number } | null,
): void {
  if (gestureLine) {
    scene.remove(gestureLine);
    gestureLine.geometry.dispose();
    gestureLine = null;
  }
  if (!from || !to || !area) return;
  const g = area.grid;
  const arr = new Float32Array([
    from.x,
    sampleTerrainHeight(g, from.x, from.z) + 0.5,
    from.z,
    to.x,
    sampleTerrainHeight(g, to.x, to.z) + 0.5,
    to.z,
  ]);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(arr, 3));
  gestureLine = new THREE.Line(geo, gestureMaterial);
  gestureLine.renderOrder = 998;
  gestureLine.frustumCulled = false;
  scene.add(gestureLine);
}

function arrowGeometry(): THREE.BufferGeometry {
  // 3 m long, 1.2 m wide, pointing along local -Z (forward at yaw 0).
  const v = [
    0, 0, -1.5, -0.6, 0, -0.3, 0.6, 0, -0.3, -0.2, 0, -0.3, -0.2, 0, 1.5, 0.2, 0, 1.5, -0.2, 0,
    -0.3, 0.2, 0, 1.5, 0.2, 0, -0.3,
  ];
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(v), 3));
  return geo;
}

function disposeStartMarkers(): void {
  for (const child of [...startMarkers.children]) {
    startMarkers.remove(child);
    child.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.geometry) m.geometry.dispose();
      const mat = m.material as THREE.Material | undefined;
      if (mat) mat.dispose();
    });
  }
  for (const t of startTags) t.el.remove();
  startTags.length = 0;
}

/** Rebuilds every start-point marker (pole, flag, ground arrow, selection ring) and name tags. */
function rebuildStartMarkers(): void {
  disposeStartMarkers();
  if (!area) return;
  const list = currentStarts();
  const first = defaultStartPoint(list);
  for (const p of list) {
    const isDefault = first !== undefined && p.id === first.id;
    const color = isDefault ? START_DEFAULT_COLOR : START_OTHER_COLOR;
    const y = sampleTerrainHeight(area.grid, p.x, p.z);
    const group = new THREE.Group();
    group.position.set(p.x, y, p.z);
    group.rotation.y = p.headingRad;
    const pole = new THREE.Mesh(
      new THREE.CylinderGeometry(0.08, 0.08, 3, 6),
      new THREE.MeshBasicMaterial({ color }),
    );
    pole.position.y = 1.5;
    const flag = new THREE.Mesh(
      new THREE.PlaneGeometry(1.2, 0.7),
      new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide }),
    );
    // Flag trails behind the facing direction (+Z local), top of the pole.
    flag.rotation.y = Math.PI / 2;
    flag.position.set(0, 2.65, 0.6);
    const arrow = new THREE.Mesh(
      arrowGeometry(),
      new THREE.MeshBasicMaterial({
        color,
        side: THREE.DoubleSide,
        depthTest: false,
        transparent: true,
        opacity: 0.9,
      }),
    );
    arrow.position.y = 0.15;
    arrow.renderOrder = 997;
    group.add(pole, flag, arrow);
    if (p.id === selectedStartId) {
      const pts: number[] = [];
      for (let i = 0; i < 48; i++) {
        const a = (i / 48) * Math.PI * 2;
        pts.push(Math.cos(a) * START_RING_RADIUS_M, 0.2, Math.sin(a) * START_RING_RADIUS_M);
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(pts), 3));
      const ring = new THREE.LineLoop(
        geo,
        new THREE.LineBasicMaterial({ color: SELECT_ACCENT, depthTest: false, transparent: true }),
      );
      ring.renderOrder = 998;
      ring.frustumCulled = false;
      group.add(ring);
    }
    group.userData.startId = p.id;
    startMarkers.add(group);
    if (isDefault || p.id === selectedStartId) {
      const tag = el("div", undefined, p.name);
      tag.style.cssText =
        "position:absolute;font-size:11px;padding:4px;background:var(--panel,#222);color:#fff;border:1px solid #000;white-space:nowrap;transform:translate(-50%,-100%)";
      startTagLayer.appendChild(tag);
      startTags.push({ el: tag, pos: new THREE.Vector3(p.x, y + START_TAG_LIFT_M, p.z) });
    }
  }
}

const tagProbe = new THREE.Vector3();
/** Per-frame: place the DOM name tags over their markers. */
function positionStartTags(): void {
  if (startTags.length === 0) return;
  const w = Math.max(1, wrap.clientWidth);
  const h = Math.max(1, wrap.clientHeight);
  for (const t of startTags) {
    tagProbe.copy(t.pos).project(camera);
    const visible = tagProbe.z > -1 && tagProbe.z < 1;
    t.el.style.display = visible ? "block" : "none";
    t.el.style.left = `${((tagProbe.x + 1) / 2) * w}px`;
    t.el.style.top = `${((1 - tagProbe.y) / 2) * h}px`;
  }
}

function startPointAt(x: number, z: number): TerrainStartPoint | undefined {
  let best: TerrainStartPoint | undefined;
  let bestD = START_PICK_RADIUS_M;
  for (const p of currentStarts()) {
    const d = Math.hypot(p.x - x, p.z - z);
    if (d <= bestD) {
      bestD = d;
      best = p;
    }
  }
  return best;
}

// ---------------------------------------------------------------- scenery view and palette (07.1.3 plan 09)

const ROTATION_STEP_DEG = 15;
/** Shown beside the triangle count; the refusal decision itself lives in scenery-guards.ts. */
const BUDGET_ERROR_COLOUR = "#ff6b6b";

let sceneryView: SceneryView | null = null;

function heightAtArea(x: number, z: number): number {
  return area ? sampleTerrainHeight(area.grid, x, z) : 0;
}

/** Features or buildings changed (edit, undo, redo): only the changed kind rebuilds. */
function sceneryChanged(r: {
  featuresChanged?: boolean;
  buildingsChanged?: boolean;
  objectsChanged?: boolean;
}): void {
  if (r.objectsChanged) rebuildRamps();
  if (!area || !sceneryView) return;
  if (r.featuresChanged) sceneryView.setFeatures(area.features ?? []);
  if (r.buildingsChanged) sceneryView.setBuildings(area.buildings);
  if (r.featuresChanged || r.buildingsChanged) refreshBudgetReadout();
  if (r.featuresChanged || r.buildingsChanged || r.objectsChanged) {
    hoverScenery = null;
    refreshSceneryBoxes(); // a selection that vanished (undo, redo, delete) is cleared here
  }
}

/** Sculpting under scenery re-seats it on the new ground (buildings re-seat inside the stroke diff). */
function reseatScenery(w: CellWindow): void {
  if (area && area.objects.length > 0) rebuildRamps(); // ramps are seated on the ground at build time
  if (!area || !sceneryView) return;
  const g = area.grid;
  const hit = (area.features ?? []).some((f) => {
    const pts: readonly (readonly [number, number])[] = "points" in f ? f.points : [[f.x, f.z]];
    let minC = Number.POSITIVE_INFINITY;
    let maxC = Number.NEGATIVE_INFINITY;
    let minR = Number.POSITIVE_INFINITY;
    let maxR = Number.NEGATIVE_INFINITY;
    for (const p of pts) {
      const col = (p[0] - g.originX) / g.cellSizeM;
      const row = (p[1] - g.originZ) / g.cellSizeM;
      minC = Math.min(minC, col);
      maxC = Math.max(maxC, col);
      minR = Math.min(minR, row);
      maxR = Math.max(maxR, row);
    }
    return (
      maxC >= w.minCol - 1 && minC <= w.maxCol + 1 && maxR >= w.minRow - 1 && minR <= w.maxRow + 1
    );
  });
  if (hit) sceneryView.reseat(heightAtArea);
}

type PointPlaceKind = "tree" | "bush";
type SceneryPlaceKind = PointPlaceKind | "building";
type LinePlaceKind = "hedge" | "fence";

interface PointPalette {
  variant: string;
  scale: number;
  randomRotation: boolean;
  rotationDeg: number;
  scatter: boolean;
  densityPer100m2: number;
}

/** Remembered per kind for the session (D-15). */
const pointPalette: Record<PointPlaceKind, PointPalette> = {
  tree: {
    variant: TREE_VARIANTS[0]?.id ?? "oak",
    scale: 1,
    randomRotation: true,
    rotationDeg: 0,
    scatter: false,
    densityPer100m2: 5,
  },
  bush: {
    variant: BUSH_VARIANTS[0]?.id ?? "round",
    scale: 1,
    randomRotation: true,
    rotationDeg: 0,
    scatter: false,
    densityPer100m2: 5,
  },
};

const buildingPalette = {
  style: BUILDING_STYLES[0]?.id ?? "shed",
  widthM: BUILDING_STYLES[0]?.defaultWidthM ?? 4,
  depthM: BUILDING_STYLES[0]?.defaultDepthM ?? 3,
  heightM: BUILDING_STYLES[0]?.defaultHeightM ?? 2.5,
  rotationDeg: 0,
};

const SCALE_SPEC: StepperSpec = { step: 0.1, coarse: 0.5, min: 0.5, max: 2, decimals: 1 };
const ROTATION_SPEC: StepperSpec = {
  step: ROTATION_STEP_DEG,
  coarse: 45,
  min: 0,
  max: 359,
  decimals: 0,
};
const DENSITY_SPEC: StepperSpec = { step: 1, coarse: 5, min: 1, max: 20, decimals: 0 };
const BUILDING_SIDE_SPEC: StepperSpec = { step: 0.5, coarse: 2, min: 1, max: 100, decimals: 1 };
const BUILDING_HEIGHT_SPEC: StepperSpec = { step: 0.5, coarse: 2, min: 1, max: 60, decimals: 1 };

let budgetEl: HTMLElement | null = null;
let budgetMsgEl: HTMLElement | null = null;
/** Last budget refusal or scatter-skip text; shown in the sidebar until the next change. */
let budgetMessage = "";
/** Steppers of the armed Building palette, so a dragged footprint can write its size back. */
let buildingBoxes: {
  width: ReturnType<typeof createStepper>;
  depth: ReturnType<typeof createStepper>;
  height: ReturnType<typeof createStepper>;
  rotation: ReturnType<typeof createStepper>;
} | null = null;

/** Writes the triangle count to the info bar (always visible) and the sidebar line when present. */
function showBudgetText(triangles: number): void {
  const text = `${triangles.toLocaleString("en-US")} / 40,000`;
  shell.info.set("scenery", text);
  if (budgetEl) budgetEl.textContent = `Scenery triangles: ${text}`;
}

function refreshBudgetReadout(): void {
  if (!area) return;
  showBudgetText(
    estimateSceneryTriangles(area.features ?? [], area.buildings, {
      drawStyleless: !area.legacyGlbBuildings,
    }),
  );
}

/** Writes the budget message line (error colour, aria-live polite); empty clears it. */
function setBudgetMessage(text: string): void {
  budgetMessage = text;
  if (budgetMsgEl) budgetMsgEl.textContent = text;
}

function sentenceCase(id: string): string {
  const t = id.replace(/-/g, " ");
  return t.charAt(0).toUpperCase() + t.slice(1);
}

function hexColour(n: number): string {
  return `#${n.toString(16).padStart(6, "0")}`;
}

/** Dark or light glyph colour for a flat tile (simple luminance test). */
function glyphColourFor(n: number): string {
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return 0.299 * r + 0.587 * g + 0.114 * b > 140 ? "#1d2026" : "#f2f2f2";
}

/** UI-SPEC rule: 3 columns if the count divides by 3, else 2 if by 2, else 1, so rows are always full. */
function swatchColumns(n: number): number {
  if (n % 3 === 0) return 3;
  if (n % 2 === 0) return 2;
  return 1;
}

interface SwatchItem {
  id: string;
  color: number;
}

/** A role=radiogroup of flat colour tiles with glyph and name (D-15). `list` = 1-column 40px rows. */
function buildSwatchGroup(
  kindWord: string,
  glyph: string,
  items: readonly SwatchItem[],
  selected: string,
  list: boolean,
  onPick: (id: string) => void,
): HTMLElement {
  const group = el("div", "swatch-grid");
  group.setAttribute("role", "radiogroup");
  group.setAttribute("aria-label", `${kindWord} variant`);
  group.style.display = "grid";
  group.style.gridTemplateColumns = `repeat(${list ? 1 : swatchColumns(items.length)}, 1fr)`;
  group.style.gap = "4px";
  group.style.padding = "4px 0";
  const buttons: [string, HTMLButtonElement][] = [];
  const sync = (now: string): void => {
    for (const [id, b] of buttons) {
      b.setAttribute("aria-checked", String(id === now));
      b.style.outline = id === now ? "2px solid #4aa3ff" : "1px solid #555";
      b.style.outlineOffset = id === now ? "1px" : "0";
    }
  };
  for (const it of items) {
    const name = sentenceCase(it.id);
    const b = el("button", "swatch", undefined, `${kindWord}: ${name}`);
    b.type = "button";
    b.setAttribute("role", "radio");
    b.setAttribute("aria-label", `${kindWord} ${it.id}`);
    b.style.padding = "0";
    b.style.cursor = "pointer";
    b.style.display = "flex";
    b.style.flexDirection = list ? "row" : "column";
    b.style.alignItems = "stretch";
    b.style.overflow = "hidden";
    b.style.background = "var(--panel-2,#262a32)";
    b.style.color = "var(--text,#e6e6e6)";
    b.style.height = list ? "40px" : "56px";
    const tile = el("div", undefined, glyph);
    tile.style.cssText = `display:flex;align-items:center;justify-content:center;background:${hexColour(it.color)};color:${glyphColourFor(it.color)};${list ? "width:40px;height:40px;flex:none" : "height:40px;flex:none"}`;
    const label = el("div", undefined, name);
    label.style.cssText = list
      ? "display:flex;align-items:center;padding:0 8px;font-size:11px;flex:1"
      : "height:16px;line-height:16px;font-size:11px;text-align:center";
    b.append(tile, label);
    b.addEventListener("click", () => {
      sync(it.id);
      onPick(it.id);
    });
    buttons.push([it.id, b]);
    group.appendChild(b);
  }
  sync(selected);
  return group;
}

/** Sidebar for an armed Building, Tree or Bush: hint, budget readout, swatches, option values (D-15). */
function buildScenerySidebar(kind: SceneryPlaceKind, f: HTMLElement): void {
  budgetEl = el("div", "muted");
  budgetMsgEl = el("div");
  budgetMsgEl.setAttribute("aria-live", "polite");
  budgetMsgEl.style.color = BUDGET_ERROR_COLOUR;
  budgetMsgEl.textContent = budgetMessage;
  f.append(note(PLACE_HINT[kind]), budgetEl, budgetMsgEl);
  refreshBudgetReadout();
  buildingBoxes = null;

  if (kind === "building") {
    const pal = buildingPalette;
    const swatches = buildSwatchGroup(
      "Building",
      "▣",
      BUILDING_STYLES.map((s) => ({ id: s.id, color: s.wallColor })),
      pal.style,
      true,
      (id) => {
        const st = resolveBuildingStyle(id);
        if (!st) return;
        pal.style = id;
        pal.widthM = st.defaultWidthM;
        pal.depthM = st.defaultDepthM;
        pal.heightM = st.defaultHeightM;
        buildingBoxes?.width.set(pal.widthM);
        buildingBoxes?.depth.set(pal.depthM);
        buildingBoxes?.height.set(pal.heightM);
        onPaletteChanged();
      },
    );
    const width = optStepper(
      "Width",
      "Building width in metres",
      BUILDING_SIDE_SPEC,
      pal.widthM,
      "m",
      (v) => {
        pal.widthM = v;
        onPaletteChanged();
      },
      true,
    );
    const depth = optStepper(
      "Depth",
      "Building depth in metres",
      BUILDING_SIDE_SPEC,
      pal.depthM,
      "m",
      (v) => {
        pal.depthM = v;
        onPaletteChanged();
      },
    );
    const height = optStepper(
      "Height",
      "Building height above the highest ground under it, in metres",
      BUILDING_HEIGHT_SPEC,
      pal.heightM,
      "m",
      (v) => {
        pal.heightM = v;
        onPaletteChanged();
      },
    );
    const rotation = optStepper(
      "Rotation",
      "Building rotation in degrees (the wheel turns it 15 degrees while you drag)",
      ROTATION_SPEC,
      pal.rotationDeg,
      "deg",
      (v) => {
        pal.rotationDeg = v;
        onPaletteChanged();
      },
    );
    buildingBoxes = {
      width: width.stepper,
      depth: depth.stepper,
      height: height.stepper,
      rotation: rotation.stepper,
    };
    f.append(
      createField("Style", swatches, "Building style"),
      width.field,
      depth.field,
      height.field,
      rotation.field,
    );
    return;
  }

  const pal = pointPalette[kind];
  const items: SwatchItem[] =
    kind === "tree"
      ? TREE_VARIANTS.map((v) => ({
          id: v.id,
          color: v.canopy.shape === "none" ? v.trunkColor : v.canopyColor,
        }))
      : BUSH_VARIANTS.map((v) => ({ id: v.id, color: v.color }));
  const kindWord = kind === "tree" ? "Tree" : "Bush";
  const swatches = buildSwatchGroup(
    kindWord,
    kind === "tree" ? "♣" : "✿",
    items,
    pal.variant,
    false,
    (id) => {
      pal.variant = id;
      onPaletteChanged();
    },
  );
  const scale = optStepper(
    "Scale",
    "Size multiplier, 0.5 to 2",
    SCALE_SPEC,
    pal.scale,
    "x",
    (v) => {
      pal.scale = v;
      onPaletteChanged();
    },
    true,
  );
  const scaleActive = activeValue;

  const rotationBox = el("div");
  const rotationField = optStepper(
    "Rotation",
    "Fixed rotation in degrees",
    ROTATION_SPEC,
    pal.rotationDeg,
    "deg",
    (v) => {
      pal.rotationDeg = v;
      onPaletteChanged();
    },
  ).field;
  const renderRotation = (): void => {
    rotationBox.replaceChildren(...(pal.randomRotation ? [] : [rotationField]));
  };
  const randomToggle = createToggle({
    label: "Random rotation",
    checked: pal.randomRotation,
    tip: "Give every placed instance a random rotation",
    onChange: (v) => {
      pal.randomRotation = v;
      renderRotation();
      onPaletteChanged();
    },
  });
  renderRotation();

  // Scatter section, closed by default. Radius shows only while Scatter is on.
  const radiusBox = el("div");
  const renderScatter = (): void => {
    radiusBox.replaceChildren(
      ...(pal.scatter
        ? [
            createField(
              "Radius",
              brushSizeStepper.el,
              "Scatter radius in metres ([ ] also change it)",
            ),
          ]
        : []),
    );
    activeValue = pal.scatter ? radiusActive : scaleActive;
  };
  const scatterToggle = createToggle({
    label: "Scatter",
    checked: pal.scatter,
    tip: "Scatter: drag to paint many at once",
    onChange: (v) => {
      pal.scatter = v;
      renderScatter();
      onPaletteChanged();
    },
  });
  const density = optStepper(
    "Density",
    "Instances per 100 m² of the brush circle",
    DENSITY_SPEC,
    pal.densityPer100m2,
    "per 100 m²",
    (v) => {
      pal.densityPer100m2 = v;
    },
  );
  renderScatter();
  f.append(
    createField("Variant", swatches, `${kindWord} variant`),
    scale.field,
    randomToggle.el,
    rotationBox,
    createSection("Scatter", "Scatter: drag to paint many at once", false, [
      scatterToggle.el,
      density.field,
      radiusBox,
    ]),
  );
}

interface LineVariantInfo {
  readonly id: string;
  readonly color: number;
  readonly minHeightM: number;
  readonly defaultHeightM: number;
}

function lineVariants(kind: LinePlaceKind): readonly LineVariantInfo[] {
  return kind === "hedge" ? HEDGE_VARIANTS : FENCE_VARIANTS;
}

/** Remembered per kind for the session (D-15); height starts at the catalog default. */
const linePalette: Record<LinePlaceKind, { variant: string; heightM: number }> = {
  hedge: {
    variant: HEDGE_VARIANTS[0]?.id ?? "box",
    heightM: HEDGE_VARIANTS[0]?.defaultHeightM ?? 1.5,
  },
  fence: {
    variant: FENCE_VARIANTS[0]?.id ?? "post-rail",
    heightM: FENCE_VARIANTS[0]?.defaultHeightM ?? 1.2,
  },
};

/** Ramp defaults match the authored feel-test ramps (angle 20, width 10); ramp shape constants are unchanged. */
const rampPalette = { heightM: 2, angleDeg: 20, widthM: 10 };
const RAMP_HEIGHT_SPEC: StepperSpec = {
  step: 0.5,
  coarse: 2,
  min: 0.5,
  max: MAX_CREST_HEIGHT_M,
  decimals: 1,
};
const RAMP_ANGLE_SPEC: StepperSpec = { step: 1, coarse: 5, min: 5, max: 80, decimals: 0 };
const RAMP_WIDTH_SPEC: StepperSpec = { step: 0.5, coarse: 2, min: 1, max: 50, decimals: 1 };

/** Sidebar for an armed Hedge or Fence: hint, budget lines, variant swatches, Height, running length (D-15). */
function buildLineSidebar(kind: LinePlaceKind, f: HTMLElement): void {
  budgetEl = el("div", "muted");
  budgetMsgEl = el("div");
  budgetMsgEl.setAttribute("aria-live", "polite");
  budgetMsgEl.style.color = BUDGET_ERROR_COLOUR;
  budgetMsgEl.textContent = budgetMessage;
  const list = lineVariants(kind);
  const pal = linePalette[kind];
  const info = list.find((v) => v.id === pal.variant) ?? list[0];
  const minH = info?.minHeightM ?? 1;
  pal.heightM = Math.min(MAX_LINE_HEIGHT_M, Math.max(minH, pal.heightM));
  const kindWord = kind === "hedge" ? "Hedge" : "Fence";
  const swatches = buildSwatchGroup(
    kindWord,
    kind === "hedge" ? "▤" : "╫",
    list.map((v) => ({ id: v.id, color: v.color })),
    pal.variant,
    false,
    (id) => {
      pal.variant = id;
      const picked = list.find((v) => v.id === id);
      if (picked) pal.heightM = picked.defaultHeightM;
      buildSidebar(); // the Height minimum and default follow the variant
      updatePlaceGhost();
    },
  );
  const height = optStepper(
    "Height",
    "Height in metres",
    { step: 0.1, coarse: 0.5, min: minH, max: MAX_LINE_HEIGHT_M, decimals: 1 },
    pal.heightM,
    "m",
    (v) => {
      pal.heightM = v;
    },
    true,
  );
  lineLengthEl = el("div", "muted");
  refreshLineReadout();
  f.append(
    note(PLACE_HINT[kind]),
    budgetEl,
    budgetMsgEl,
    createField("Variant", swatches, `${kindWord} variant`),
    height.field,
    lineLengthEl,
  );
  refreshBudgetReadout();
}

/** Sidebar for an armed Ramp: hint, Height, Angle, Width, direction readout (D-14). */
function buildRampSidebar(f: HTMLElement): void {
  const height = optStepper(
    "Height",
    "Ramp lip height in metres",
    RAMP_HEIGHT_SPEC,
    rampPalette.heightM,
    "m",
    (v) => {
      rampPalette.heightM = v;
      updatePlaceGhost();
    },
    true,
  );
  const angle = optStepper(
    "Angle",
    "Launch angle in degrees",
    RAMP_ANGLE_SPEC,
    rampPalette.angleDeg,
    "°",
    (v) => {
      rampPalette.angleDeg = v;
      updatePlaceGhost();
    },
  );
  const width = optStepper(
    "Width",
    "Ramp width in metres",
    RAMP_WIDTH_SPEC,
    rampPalette.widthM,
    "m",
    (v) => {
      rampPalette.widthM = v;
      updatePlaceGhost();
    },
  );
  rampDirEl = el("div", "muted");
  rampDirEl.textContent = "Direction: drag to set";
  f.append(note(PLACE_HINT.ramp), height.field, angle.field, width.field, rampDirEl);
}

// ---------------------------------------------------------------- scenery placement (07.1.3 plan 09)

const DEG = Math.PI / 180;
const GHOST_OPACITY = 0.5;
const GHOST_REFUSED = 0xff6b6b;
/** Scatter stamps are spaced 1.5 radii apart so overlapping stamps keep the density near the set value. */
const SCATTER_STAMP_FACTOR = 1.5;
const BUILDING_FILL_CELLS = 12;
const BUILDING_OUTLINE_STEPS = 16;

/** Never-reused feature id counter (undo does not reset it). */
let featureSeed = 1;
/** Session random source for random rotation and scatter seeds (LCG, never Math.random). */
let rngState = 0x2f6e2b1;
function nextRand(): number {
  rngState = (Math.imul(rngState, 1664525) + 1013904223) >>> 0;
  return rngState / 4294967296;
}

function sceneryAreaWith(features?: readonly TerrainFeature[]): SceneryArea | null {
  if (!area) return null;
  return {
    grid: area.grid,
    paint: area.paint,
    features: features ?? area.features ?? [],
    buildings: area.buildings,
    legacyGlbBuildings: area.legacyGlbBuildings,
  };
}

function currentFeatureSeed(): number {
  return Math.max(featureSeed, featureIdSeed(area?.features ?? []));
}

/** A refused edit: the reason goes to the sidebar budget line and the info bar. */
function refuseBudget(reason: string): void {
  setBudgetMessage(reason);
  setStatus(reason, "error");
}

function disposeObject(o: THREE.Object3D): void {
  o.traverse((c) => {
    const m = c as THREE.Mesh;
    if (m.geometry) m.geometry.dispose();
    const mat = m.material as THREE.Material | undefined;
    if (mat) mat.dispose();
  });
}

interface BuildingPlan {
  x: number;
  z: number;
  widthM: number;
  depthM: number;
  rotationY: number;
  dragged: boolean;
}

const buildGesture = createDragGesture();
let scatterDrag: {
  kind: PointPlaceKind;
  pointerId: number;
  base: number;
  moves: number;
  work: TerrainFeature[];
  skipped: number;
  last: { x: number; z: number } | null;
  limitMsg: string;
} | null = null;
let ghost: THREE.Object3D | null = null;
let ghostRefused = false;
let lastGhostReason = "";

const rampGesture = createDragGesture();
const lineBuilder = createLineBuilder();

/** A selected placed item being dragged in Select mode (plan 11). */
interface SceneryMoveDrag {
  sel: ScenerySelection;
  pointerId: number;
  startX: number;
  startZ: number;
  dx: number;
  dz: number;
  moved: boolean;
  result: MoveResult | null;
}
let moveDrag: SceneryMoveDrag | null = null;
/** The Select sidebar button for bulk scenery removal (enabled while a box selection exists). */
let deleteSceneryBtn: HTMLButtonElement | null = null;

function sceneryGestureActive(): boolean {
  return scatterDrag !== null || buildGesture.active() || rampGesture.active() || moveDrag !== null;
}

// Building footprint overlay: terrain-hugging accent outline plus a 0.25 fill (same as Select).
const rectLine = new THREE.LineLoop(
  new THREE.BufferGeometry(),
  new THREE.LineBasicMaterial({ color: SELECT_ACCENT, depthTest: false, transparent: true }),
);
const rectFill = new THREE.Mesh(
  new THREE.BufferGeometry(),
  new THREE.MeshBasicMaterial({
    color: SELECT_ACCENT,
    opacity: 0.25,
    depthTest: false,
    depthWrite: false,
    transparent: true,
    side: THREE.DoubleSide,
  }),
);
for (const o of [rectLine, rectFill]) {
  o.renderOrder = 998;
  o.frustumCulled = false;
  o.visible = false;
  scene.add(o);
}

/** World (x, z) of a footprint point; u and v run 0..1 across the rotated rectangle. */
function rectPoint(plan: BuildingPlan, u: number, v: number): [number, number] {
  const lx = -plan.widthM / 2 + plan.widthM * u;
  const lz = -plan.depthM / 2 + plan.depthM * v;
  const c = Math.cos(plan.rotationY);
  const s = Math.sin(plan.rotationY);
  return [plan.x + lx * c + lz * s, plan.z - lx * s + lz * c];
}

function setRect(plan: BuildingPlan | null): void {
  rectLine.geometry.dispose();
  rectFill.geometry.dispose();
  rectLine.geometry = new THREE.BufferGeometry();
  rectFill.geometry = new THREE.BufferGeometry();
  rectLine.visible = false;
  rectFill.visible = false;
  if (!plan || !area) return;
  const line: number[] = [];
  const put = (arr: number[], u: number, v: number, lift: number): void => {
    const [x, z] = rectPoint(plan, u, v);
    arr.push(x, heightAtArea(x, z) + lift, z);
  };
  const n = BUILDING_OUTLINE_STEPS;
  for (let i = 0; i < n; i++) put(line, i / n, 0, 0.25);
  for (let i = 0; i < n; i++) put(line, 1, i / n, 0.25);
  for (let i = 0; i < n; i++) put(line, 1 - i / n, 1, 0.25);
  for (let i = 0; i < n; i++) put(line, 0, 1 - i / n, 0.25);
  rectLine.geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(line), 3));
  const fill: number[] = [];
  const m = BUILDING_FILL_CELLS;
  for (let i = 0; i < m; i++) {
    for (let j = 0; j < m; j++) {
      const u0 = i / m;
      const u1 = (i + 1) / m;
      const v0 = j / m;
      const v1 = (j + 1) / m;
      put(fill, u0, v0, 0.2);
      put(fill, u1, v0, 0.2);
      put(fill, u1, v1, 0.2);
      put(fill, u0, v0, 0.2);
      put(fill, u1, v1, 0.2);
      put(fill, u0, v1, 0.2);
    }
  }
  rectFill.geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(fill), 3));
  rectLine.visible = true;
  rectFill.visible = true;
}

/** Plan for the building under the cursor: a dragged footprint, else the sidebar size at the cursor. */
function buildingPlanAt(hit: { x: number; z: number }): BuildingPlan {
  const rot = buildingPalette.rotationDeg * DEG;
  const pv = buildGesture.preview();
  if (pv) {
    const dx = pv.to.x - pv.from.x;
    const dz = pv.to.z - pv.from.z;
    if (Math.hypot(dx, dz) >= DRAG_HEADING_MIN_M) {
      const c = Math.cos(rot);
      const s = Math.sin(rot);
      return {
        x: (pv.from.x + pv.to.x) / 2,
        z: (pv.from.z + pv.to.z) / 2,
        widthM: Math.min(BUILDING_SIDE_SPEC.max, Math.abs(dx * c - dz * s)),
        depthM: Math.min(BUILDING_SIDE_SPEC.max, Math.abs(dx * s + dz * c)),
        rotationY: rot,
        dragged: true,
      };
    }
  }
  const from = pv?.from ?? hit;
  return {
    x: from.x,
    z: from.z,
    widthM: buildingPalette.widthM,
    depthM: buildingPalette.depthM,
    rotationY: rot,
    dragged: false,
  };
}

/** D-12 for a footprint: too small, or the centre or a corner on road paint or outside the area. */
function checkBuildingPlan(plan: BuildingPlan): { ok: true } | { ok: false; reason: string } {
  if (!area) return { ok: false, reason: NO_AREA_MSG };
  if (plan.widthM < 1 || plan.depthM < 1) return { ok: false, reason: BUILDING_TOO_SMALL };
  const pts: [number, number][] = [
    [plan.x, plan.z],
    ...footprintCorners(plan.x, plan.z, plan.widthM / 2, plan.depthM / 2, plan.rotationY),
  ];
  for (const [x, z] of pts) {
    const c = canPlaceAt(area, x, z);
    if (!c.ok) return c;
  }
  return { ok: true };
}

/** Ghost reason copy: show a refusal once, and restore the hint when it clears (D-12). */
function setGhostState(refused: boolean, reason: string, kind: PlaceKind): void {
  ghostRefused = refused;
  if (refused) {
    if (reason !== lastGhostReason) setStatus(reason, "error");
    lastGhostReason = reason;
  } else if (lastGhostReason !== "") {
    lastGhostReason = "";
    setStatus(PLACE_HINT[kind]);
  }
}

function paintScatterRing(hit: { x: number; z: number }): void {
  if (!area) return;
  const outline = footprintOutline(
    hit.x,
    hit.z,
    dispatcher.getOptions().radiusM,
    "round",
    RING_SEGMENTS,
  );
  const n = Math.min(RING_SEGMENTS, outline.length / 2);
  const pos = ringGeometry.getAttribute("position") as THREE.BufferAttribute;
  for (let i = 0; i < n; i++) {
    const px = outline[i * 2];
    const pz = outline[i * 2 + 1];
    pos.setXYZ(i, px, heightAtArea(px, pz) + FOOTPRINT_LIFT_M, pz);
  }
  ringGeometry.setDrawRange(0, n);
  pos.needsUpdate = true;
  const mat = cursorRing.material as THREE.LineBasicMaterial;
  mat.color.setHex(SELECT_ACCENT);
  mat.opacity = 0.5;
  cursorRing.visible = true;
}

function buildingGhostMesh(
  b: {
    center: { x: number; y: number; z: number };
    halfExtents: { x: number; y: number; z: number };
    rotationY: number;
  },
  tint: number | undefined,
): THREE.Mesh {
  const style = resolveBuildingStyle(buildingPalette.style);
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(2 * b.halfExtents.x, 2 * b.halfExtents.y, 2 * b.halfExtents.z),
    new THREE.MeshBasicMaterial({
      color: tint ?? style?.wallColor ?? 0x9a9a98,
      transparent: true,
      opacity: GHOST_OPACITY,
      depthWrite: false,
    }),
  );
  mesh.position.set(b.center.x, b.center.y, b.center.z);
  mesh.rotation.y = b.rotationY;
  mesh.renderOrder = 1;
  return mesh;
}

/**
 * The cursor ghost for the armed Tree, Bush or Building (D-12): translucent copy of the real mesh,
 * tinted red and refused on road paint or outside the area. Hidden when nothing is armed or the
 * pointer is off the terrain. Scatter shows the brush ring instead of a single ghost.
 */
function updatePlaceGhost(): void {
  if (ghost) {
    scene.remove(ghost);
    disposeObject(ghost);
    ghost = null;
  }
  setRect(null);
  const kind = dispatcher.placing();
  const lineKind = kind === "hedge" || kind === "fence" ? kind : null;
  updateLineOverlay(lineKind);
  if (lineKind !== null) {
    cursorRing.visible = false;
    return;
  }
  if (kind === "ramp") {
    updateRampPreview();
    return;
  }
  const scenery = kind === "tree" || kind === "bush" || kind === "building";
  if (!scenery) {
    ghostRefused = false;
    lastGhostReason = "";
    return;
  }
  const hit = lastHit;
  if (!area || !hit) {
    ghostRefused = false;
    cursorRing.visible = false;
    return;
  }
  if (kind === "building") {
    cursorRing.visible = false;
    const plan = buildingPlanAt(hit);
    const check = checkBuildingPlan(plan);
    const tint = check.ok ? undefined : GHOST_REFUSED;
    const seated = seatBuilding(heightAtArea, {
      x: plan.x,
      z: plan.z,
      widthM: plan.widthM,
      depthM: plan.depthM,
      heightM: buildingPalette.heightM,
      rotationY: plan.rotationY,
      style: buildingPalette.style,
    });
    if (plan.dragged) setRect(plan);
    if (seated.building) {
      ghost = buildingGhostMesh(seated.building, tint);
      scene.add(ghost);
    }
    setGhostState(!check.ok, check.ok ? "" : check.reason, kind);
    return;
  }
  const p = pointPalette[kind];
  if (p.scatter) {
    paintScatterRing(hit);
    setGhostState(false, "", kind);
    return;
  }
  cursorRing.visible = false;
  const check = canPlaceAt(area, hit.x, hit.z);
  const feature: TerrainPointFeature = {
    id: "ghost",
    kind,
    variant: p.variant,
    x: hit.x,
    z: hit.z,
    rotationY: p.randomRotation ? 0 : p.rotationDeg * DEG,
    scale: p.scale,
  };
  ghost = buildFeaturePreview(feature, heightAtArea, {
    opacity: GHOST_OPACITY,
    ...(check.ok ? {} : { tint: GHOST_REFUSED }),
  });
  scene.add(ghost);
  setGhostState(!check.ok, check.ok ? "" : check.reason, kind);
}

/** A palette value changed (variant, size, rotation, scatter): the cursor ghost follows it. */
function onPaletteChanged(): void {
  updatePlaceGhost();
}

/** Click placement of one tree or bush (D-16: one undo step). */
function placePointAt(kind: PointPlaceKind, x: number, z: number): void {
  if (!area) return;
  const check = canPlaceAt(area, x, z);
  if (!check.ok) {
    setStatus(check.reason, "error");
    return;
  }
  const p = pointPalette[kind];
  const add = addPointFeature(area.features ?? [], currentFeatureSeed(), {
    kind,
    variant: p.variant,
    x,
    z,
    rotationY: p.randomRotation ? nextRand() * Math.PI * 2 : p.rotationDeg * DEG,
    scale: p.scale,
  });
  if (add.error !== undefined) {
    setStatus(add.error, "error");
    return;
  }
  const guard = sceneryAreaWith();
  if (guard) {
    const budget = checkSceneryBudget(guard, { features: add.features });
    if (!budget.ok) {
      refuseBudget(budget.reason);
      return;
    }
  }
  featureSeed = add.nextSeed;
  applyResult(dispatcher.commitScenery({ features: add.features }), 0);
  updateHistoryButtons();
  setBudgetMessage("");
  setStatus(`Placed ${kind}. Ctrl+Z undoes it.`, "ok");
}

/** One scatter stamp inside the brush circle, fitted to the triangle budget (D-09). */
function scatterStamp(d: NonNullable<typeof scatterDrag>, x: number, z: number): void {
  if (!area) return;
  const p = pointPalette[d.kind];
  d.last = { x, z };
  d.moves++;
  const seed = (Math.imul(d.moves, 2654435761) + d.base) >>> 0;
  const pts = scatterPoints({
    cx: x,
    cz: z,
    radiusM: dispatcher.getOptions().radiusM,
    densityPer100m2: p.densityPer100m2,
    seed,
  });
  let running: readonly TerrainFeature[] = [...(area.features ?? []), ...d.work];
  let idSeed = currentFeatureSeed();
  const candidates: TerrainFeature[] = [];
  for (const pt of pts) {
    if (!canPlaceAt(area, pt.x, pt.z).ok) continue;
    const add = addPointFeature(running, idSeed, {
      kind: d.kind,
      variant: p.variant,
      x: pt.x,
      z: pt.z,
      rotationY: p.randomRotation ? nextRand() * Math.PI * 2 : p.rotationDeg * DEG,
      scale: p.scale,
    });
    if (add.error !== undefined) {
      d.limitMsg = add.error;
      break;
    }
    running = add.features;
    idSeed = add.nextSeed;
    const made = running[running.length - 1];
    if (made) candidates.push(made);
  }
  featureSeed = idSeed;
  const guard = sceneryAreaWith(running.slice(0, running.length - candidates.length));
  if (!guard) return;
  const fit = fitScatterToBudget(guard, candidates);
  d.work.push(...fit.accepted);
  d.skipped += fit.skipped;
  sceneryView?.setFeatures([...(area.features ?? []), ...d.work]);
  refreshBudgetReadoutWith([...(area.features ?? []), ...d.work]);
}

/** The budget readout for a working copy that is not committed yet. */
function refreshBudgetReadoutWith(features: readonly TerrainFeature[]): void {
  if (!area) return;
  showBudgetText(
    estimateSceneryTriangles(features, area.buildings, {
      drawStyleless: !area.legacyGlbBuildings,
    }),
  );
}

function finishScatter(): void {
  const d = scatterDrag;
  scatterDrag = null;
  if (!d || !area) return;
  const placed = d.work.length;
  if (placed > 0) {
    applyResult(dispatcher.commitScenery({ features: [...(area.features ?? []), ...d.work] }), 0);
    updateHistoryButtons();
  } else {
    sceneryView?.setFeatures(area.features ?? []);
    refreshBudgetReadout();
  }
  let msg: string;
  if (d.skipped > 0) {
    msg = `Placed ${placed}, skipped ${d.skipped}: scenery triangle limit (40,000)`;
    refuseBudget(msg);
  } else if (d.limitMsg !== "") {
    msg = `Placed ${placed}. ${d.limitMsg}`;
    setBudgetMessage("");
    setStatus(msg, "error");
  } else if (placed === 0) {
    setBudgetMessage("");
    setStatus("Nothing placed: those spots are on a road or outside the area", "error");
  } else {
    setBudgetMessage("");
    setStatus(`Placed ${placed}. Ctrl+Z undoes it.`, "ok");
  }
  updatePlaceGhost();
}

function commitBuildingPlan(plan: BuildingPlan): void {
  if (!area) return;
  if (area.buildings.length >= MAX_BUILDINGS) {
    setStatus(
      `Limit reached: ${MAX_BUILDINGS} buildings per map. Delete some to place more`,
      "error",
    );
    return;
  }
  const check = checkBuildingPlan(plan);
  if (!check.ok) {
    setStatus(check.reason, "error");
    return;
  }
  const seated = seatBuilding(heightAtArea, {
    x: plan.x,
    z: plan.z,
    widthM: plan.widthM,
    depthM: plan.depthM,
    heightM: buildingPalette.heightM,
    rotationY: plan.rotationY,
    style: buildingPalette.style,
  });
  if (seated.error !== undefined) {
    setStatus(seated.error, "error");
    return;
  }
  const next = [...area.buildings, seated.building];
  const guard = sceneryAreaWith();
  if (guard) {
    const budget = checkSceneryBudget(guard, { buildings: next });
    if (!budget.ok) {
      refuseBudget(budget.reason);
      return;
    }
  }
  if (plan.dragged) {
    const w = Math.round(plan.widthM * 10) / 10;
    const dd = Math.round(plan.depthM * 10) / 10;
    buildingPalette.widthM = w;
    buildingPalette.depthM = dd;
    buildingBoxes?.width.set(w);
    buildingBoxes?.depth.set(dd);
  }
  applyResult(dispatcher.commitScenery({ buildings: next }), 0);
  updateHistoryButtons();
  setBudgetMessage("");
  setStatus("Placed building. Ctrl+Z undoes it.", "ok");
}

function sceneryPointerDown(e: PointerEvent, kind: SceneryPlaceKind): void {
  if (!area) return;
  const hit = pickTerrain(e.clientX, e.clientY);
  if (!hit) {
    setStatus("That spot is outside the map area", "error");
    return;
  }
  lastHit = { x: hit.x, z: hit.z };
  if (kind === "building") {
    canvas.setPointerCapture(e.pointerId);
    activePointerId = e.pointerId;
    buildGesture.down(hit.x, hit.z);
    updatePlaceGhost();
    return;
  }
  if (pointPalette[kind].scatter) {
    canvas.setPointerCapture(e.pointerId);
    activePointerId = e.pointerId;
    scatterDrag = {
      kind,
      pointerId: e.pointerId,
      base: (Math.floor(nextRand() * 4294967296) ^ currentFeatureSeed()) >>> 0,
      moves: 0,
      work: [],
      skipped: 0,
      last: null,
      limitMsg: "",
    };
    scatterStamp(scatterDrag, hit.x, hit.z);
    updatePlaceGhost();
    return;
  }
  placePointAt(kind, hit.x, hit.z);
}

function sceneryPointerMove(e: PointerEvent): void {
  if (!area) return;
  if (moveDrag) {
    moveDragTo(e);
    return;
  }
  const hit = pickTerrain(e.clientX, e.clientY);
  if (!hit) return;
  lastHit = { x: hit.x, z: hit.z };
  const d = scatterDrag;
  if (d) {
    const gap = dispatcher.getOptions().radiusM * SCATTER_STAMP_FACTOR;
    if (d.last === null || Math.hypot(hit.x - d.last.x, hit.z - d.last.z) >= gap) {
      scatterStamp(d, hit.x, hit.z);
    }
    updatePlaceGhost();
    return;
  }
  if (rampGesture.active()) {
    rampGesture.move(hit.x, hit.z);
    updatePlaceGhost();
    return;
  }
  buildGesture.move(hit.x, hit.z);
  const plan = buildingPlanAt(lastHit);
  if (plan.dragged) {
    setStatus(`${fmt3(plan.widthM)} x ${fmt3(plan.depthM)} m, ${buildingPalette.rotationDeg}°`);
  }
  updatePlaceGhost();
}

function sceneryPointerUp(e: PointerEvent): void {
  if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
  activePointerId = null;
  if (moveDrag) {
    finishMoveDrag(e);
    return;
  }
  if (scatterDrag) {
    finishScatter();
    return;
  }
  if (rampGesture.active()) {
    rampPointerUp(e);
    return;
  }
  if (!buildGesture.active() || !area) return;
  const hit = pickTerrain(e.clientX, e.clientY);
  if (hit) {
    buildGesture.move(hit.x, hit.z);
    lastHit = { x: hit.x, z: hit.z };
  }
  const at = lastHit;
  const plan = at ? buildingPlanAt(at) : null;
  buildGesture.up();
  setRect(null);
  if (ghost) {
    scene.remove(ghost);
    disposeObject(ghost);
    ghost = null;
  }
  if (plan) commitBuildingPlan(plan);
  updatePlaceGhost();
}

// ---------------------------------------------------------------- hedge, fence and ramp placement (07.1.3 plan 10)

/** A click closer than this to the previous point is ignored (a double-click must not add a twin point). */
const LINE_DUP_RADIUS_M = 0.5;
const LINE_SAMPLE_M = 2;
const LINE_DOT_PX = 6;
const ARROW_LIFT_M = 0.4;

let lineKindActive: LinePlaceKind | null = null;
let lineOverlay: THREE.Group | null = null;
let lineLengthEl: HTMLElement | null = null;
let rampDirEl: HTMLElement | null = null;
let rampsGroup: THREE.Group | null = null;
/** Direction of the last ramp, used by the hover ghost before a drag sets a new one. */
let lastRampHeading = 0;

function lineReadoutText(): string {
  const n = lineBuilder.points().length;
  return `${fmt3(lineBuilder.lengthM())} m, ${n} ${n === 1 ? "point" : "points"}`;
}

function refreshLineReadout(): void {
  if (lineLengthEl) lineLengthEl.textContent = lineReadoutText();
}

/** Terrain-hugging vertices from a to b (inclusive), about LINE_SAMPLE_M apart. */
function hugPositions(
  out: number[],
  a: readonly [number, number],
  b: readonly [number, number],
  lift: number,
  first: boolean,
): void {
  const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / LINE_SAMPLE_M));
  for (let i = first ? 0 : 1; i <= n; i++) {
    const t = i / n;
    const x = a[0] + (b[0] - a[0]) * t;
    const z = a[1] + (b[1] - a[1]) * t;
    out.push(x, heightAtArea(x, z) + lift, z);
  }
}

function makeOverlayLine(positions: number[], colour: number): THREE.Line {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(positions), 3));
  const line = new THREE.Line(
    geo,
    new THREE.LineBasicMaterial({ color: colour, depthTest: false, transparent: true }),
  );
  line.renderOrder = 998;
  line.frustumCulled = false;
  return line;
}

/**
 * Hedge and fence preview (UI-SPEC line preview): accent dots at the points, an accent polyline,
 * and a ghost segment to the cursor, red when that segment would cross road paint or leave the area.
 * Refusal decisions come from canPlaceLine; this only draws them. WebGL lines are 1 px wide.
 */
function updateLineOverlay(kind: LinePlaceKind | null): void {
  if (lineOverlay) {
    scene.remove(lineOverlay);
    disposeObject(lineOverlay);
    lineOverlay = null;
  }
  if (!area || kind === null) return;
  const pts = lineBuilder.points();
  const hit = lastHit;
  let refused = false;
  let reason = "";
  if (hit) {
    const last = pts[pts.length - 1];
    const check = last
      ? canPlaceLine(area, [last, [hit.x, hit.z]])
      : canPlaceAt(area, hit.x, hit.z);
    if (!check.ok) {
      refused = true;
      reason = check.reason;
    }
  }
  setGhostState(refused, reason, kind);
  const group = new THREE.Group();
  if (pts.length > 0) {
    const dots: number[] = [];
    const path: number[] = [];
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i] as readonly [number, number];
      dots.push(p[0], heightAtArea(p[0], p[1]) + FOOTPRINT_LIFT_M, p[1]);
      const prev = pts[i - 1];
      if (prev) hugPositions(path, prev, p, FOOTPRINT_LIFT_M, false);
      else path.push(p[0], heightAtArea(p[0], p[1]) + FOOTPRINT_LIFT_M, p[1]);
    }
    if (pts.length > 1) group.add(makeOverlayLine(path, SELECT_ACCENT));
    const dotGeo = new THREE.BufferGeometry();
    dotGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(dots), 3));
    const dotPoints = new THREE.Points(
      dotGeo,
      new THREE.PointsMaterial({
        color: SELECT_ACCENT,
        size: LINE_DOT_PX,
        sizeAttenuation: false,
        depthTest: false,
        transparent: true,
      }),
    );
    dotPoints.renderOrder = 999;
    dotPoints.frustumCulled = false;
    group.add(dotPoints);
    const last = pts[pts.length - 1] as readonly [number, number];
    if (hit) {
      const seg: number[] = [];
      hugPositions(seg, last, [hit.x, hit.z], FOOTPRINT_LIFT_M, true);
      group.add(makeOverlayLine(seg, refused ? GHOST_REFUSED : SELECT_ACCENT));
    }
  }
  if (group.children.length > 0) {
    scene.add(group);
    lineOverlay = group;
  }
}

/** Esc, a kind switch or a new area abandons the line in progress (nothing committed). */
function cancelLine(): void {
  const had = lineBuilder.active();
  lineBuilder.cancel();
  lineKindActive = null;
  if (!had) return;
  refreshLineReadout();
  updatePlaceGhost();
}

function linePointerDown(e: PointerEvent, kind: LinePlaceKind): void {
  if (!area) return;
  const hit = pickTerrain(e.clientX, e.clientY);
  if (!hit) {
    setStatus("That spot is outside the map area", "error");
    return;
  }
  lastHit = { x: hit.x, z: hit.z };
  if (lineKindActive !== kind) {
    lineBuilder.cancel();
    lineKindActive = kind;
  }
  const last = lineBuilder.points()[lineBuilder.points().length - 1];
  if (last && Math.hypot(hit.x - last[0], hit.z - last[1]) < LINE_DUP_RADIUS_M) return;
  const check = last ? canPlaceLine(area, [last, [hit.x, hit.z]]) : canPlaceAt(area, hit.x, hit.z);
  if (!check.ok) {
    setStatus(check.reason, "error"); // a refused click adds nothing (D-12)
    return;
  }
  const add = lineBuilder.add(hit.x, hit.z);
  if (add.error !== undefined) {
    setStatus(add.error, "error");
    return;
  }
  setBudgetMessage("");
  refreshLineReadout();
  updatePlaceGhost();
  setStatus(`${lineReadoutText()}. Enter finishes, Backspace removes the last point.`);
}

function lineRemoveLast(): void {
  lineBuilder.removeLast();
  if (!lineBuilder.active()) lineKindActive = null;
  setBudgetMessage("");
  refreshLineReadout();
  updatePlaceGhost();
  setStatus(lineBuilder.active() ? lineReadoutText() : "Line cleared.");
}

/** Enter or double-click: commit the line as one undo step, unless the 40,000-triangle limit refuses it (D-09). */
function finishLine(): void {
  const kind = lineKindActive;
  if (!area || kind === null) return;
  const pts = lineBuilder.points();
  if (pts.length < 2) {
    setStatus(LINE_TOO_FEW_POINTS, "error");
    return;
  }
  const whole = canPlaceLine(area, pts);
  if (!whole.ok) {
    setStatus(whole.reason, "error");
    return;
  }
  const pal = linePalette[kind];
  const add = addLineFeature(area.features ?? [], currentFeatureSeed(), {
    kind,
    variant: pal.variant,
    points: pts,
    heightM: pal.heightM,
  });
  if (add.error !== undefined) {
    setStatus(add.error, "error");
    return;
  }
  const guard = sceneryAreaWith();
  if (guard) {
    const budget = checkSceneryBudget(guard, { features: add.features });
    if (!budget.ok) {
      // Stay in progress so Backspace can shorten the line.
      refuseBudget(budget.reason);
      return;
    }
  }
  lineBuilder.finish();
  lineKindActive = null;
  featureSeed = add.nextSeed;
  applyResult(dispatcher.commitScenery({ features: add.features }), 0);
  updateHistoryButtons();
  setBudgetMessage("");
  refreshLineReadout();
  updatePlaceGhost();
  setStatus(`Placed ${kind}. Ctrl+Z undoes it.`, "ok");
}

// Ramps are crest objects drawn with the game's crest builder (not the scenery view).

/** Draws every ramp and crest of the area; rebuilt on install, edit, undo, redo and sculpting. */
function rebuildRamps(): void {
  if (rampsGroup) {
    scene.remove(rampsGroup);
    disposeObject(rampsGroup);
    rampsGroup = null;
  }
  if (!area) return;
  const crests = crestsFromObjects(area.objects);
  if (crests.length === 0) return;
  const group = new THREE.Group();
  group.add(...buildCrestMeshes(crests, heightAtArea, TERRAIN_SURFACE_PALETTE));
  scene.add(group);
  rampsGroup = group;
}

function rampSpecAt(x: number, z: number, headingRad: number): AuthoredCrest {
  return {
    id: "ghost",
    centerX: x,
    centerZ: z,
    radiusM: 0,
    heightM: rampPalette.heightM,
    ramp: {
      headingRad,
      widthM: rampPalette.widthM,
      angleDeg: rampPalette.angleDeg,
      footRadiusM: RAMP_FOOT_RADIUS_M,
    },
  };
}

/** Ghost ramp (game builder, translucent) at the press point plus a direction arrow to the cursor. */
function updateRampPreview(): void {
  cursorRing.visible = false;
  const hit = lastHit;
  if (!area || !hit) {
    ghostRefused = false;
    return;
  }
  const pv = rampGesture.preview();
  let x = hit.x;
  let z = hit.z;
  let heading = lastRampHeading;
  let dragging = false;
  if (pv) {
    x = pv.from.x;
    z = pv.from.z;
    const dx = pv.to.x - pv.from.x;
    const dz = pv.to.z - pv.from.z;
    if (Math.hypot(dx, dz) >= DRAG_HEADING_MIN_M) {
      heading = Math.atan2(dz, dx); // crest headings: 0 = +x, +pi/2 = +z
      dragging = true;
    }
  }
  const check = canPlaceRampAt(area, x, z);
  const group = new THREE.Group();
  for (const mesh of buildCrestMeshes(
    [rampSpecAt(x, z, heading)],
    heightAtArea,
    TERRAIN_SURFACE_PALETTE,
  )) {
    const mat = mesh.material as THREE.MeshStandardMaterial;
    mat.transparent = true;
    mat.opacity = GHOST_OPACITY;
    mat.depthWrite = false;
    if (!check.ok) mat.color.setHex(GHOST_REFUSED);
    group.add(mesh);
  }
  if (pv && dragging) {
    const dx = pv.to.x - pv.from.x;
    const dz = pv.to.z - pv.from.z;
    const len = Math.hypot(dx, dz);
    const head = Math.min(4, len * 0.25);
    const ux = dx / len;
    const uz = dz / len;
    const tip: [number, number] = [pv.to.x, pv.to.z];
    const wing = (side: number): [number, number] => [
      tip[0] - ux * head - uz * head * 0.5 * side,
      tip[1] - uz * head + ux * head * 0.5 * side,
    ];
    const pos: number[] = [];
    const at = (p: readonly [number, number]): void => {
      pos.push(p[0], heightAtArea(p[0], p[1]) + ARROW_LIFT_M, p[1]);
    };
    at([pv.from.x, pv.from.z]);
    at(tip);
    at(wing(1));
    at(tip);
    at(wing(-1));
    group.add(makeOverlayLine(pos, SELECT_ACCENT));
    const deg = Math.round(yawToHeadingDeg(yawFromTravelDirection(dx, dz)));
    if (rampDirEl) rampDirEl.textContent = `Direction: ${deg}°`;
    setStatus(`Direction ${deg}°. Release to place the ramp.`);
  }
  ghost = group;
  scene.add(group);
  setGhostState(!check.ok, check.ok ? "" : check.reason, "ramp");
}

function rampPointerDown(e: PointerEvent): void {
  if (!area) return;
  const hit = pickTerrain(e.clientX, e.clientY);
  if (!hit) {
    setStatus("That spot is outside the map area", "error");
    return;
  }
  lastHit = { x: hit.x, z: hit.z };
  const check = canPlaceRampAt(area, hit.x, hit.z);
  if (!check.ok) {
    setStatus(check.reason, "error");
    return;
  }
  canvas.setPointerCapture(e.pointerId);
  activePointerId = e.pointerId;
  rampGesture.down(hit.x, hit.z);
  updatePlaceGhost();
}

/** Release commits one ramp as one undo step, or refuses (no direction, too long, outside the area). */
function rampPointerUp(e: PointerEvent): void {
  const hit = pickTerrain(e.clientX, e.clientY);
  if (hit) {
    rampGesture.move(hit.x, hit.z);
    lastHit = { x: hit.x, z: hit.z };
  }
  const pv = rampGesture.preview();
  rampGesture.up();
  if (!area || !pv) {
    updatePlaceGhost();
    return;
  }
  const dx = pv.to.x - pv.from.x;
  const dz = pv.to.z - pv.from.z;
  const fail = (msg: string): void => {
    setStatus(msg, "error");
    updatePlaceGhost();
  };
  if (Math.hypot(dx, dz) < DRAG_HEADING_MIN_M) {
    fail("Drag toward the way the ramp should face");
    return;
  }
  const check = canPlaceRampAt(area, pv.from.x, pv.from.z);
  if (!check.ok) {
    fail(check.reason);
    return;
  }
  const heading = Math.atan2(dz, dx);
  const spec = rampSpecAt(pv.from.x, pv.from.z, heading);
  if (spec.ramp && rampLengthM(spec.heightM, spec.ramp) > MAX_AREA_SIZE_M) {
    fail("That ramp is too long. Raise the angle or lower the height");
    return;
  }
  const next = addRampObject(area.objects, pv.from.x, pv.from.z, heading, {
    heightM: rampPalette.heightM,
    angleDeg: rampPalette.angleDeg,
    widthM: rampPalette.widthM,
  });
  lastRampHeading = heading;
  applyResult(dispatcher.commitScenery({ objects: next }), 0);
  updateHistoryButtons();
  updatePlaceGhost();
  setStatus("Placed ramp. Ctrl+Z undoes it.", "ok");
}

/** Wheel while a footprint drag is live: 15 degrees per notch (outside a drag the wheel zooms). */
function rotateBuildingDrag(dir: 1 | -1): void {
  const deg = (buildingPalette.rotationDeg + dir * ROTATION_STEP_DEG + 360) % 360;
  buildingPalette.rotationDeg = deg;
  buildingBoxes?.rotation.set(deg);
  setStatus(`${deg}°`);
  updatePlaceGhost();
}

/** Esc, pointer cancel, leave and dialogs abandon a live scatter or footprint drag (nothing committed). */
function cancelSceneryGesture(): void {
  const had = sceneryGestureActive();
  if (!had) return;
  scatterDrag = null;
  buildGesture.cancel();
  rampGesture.cancel();
  if (moveDrag) {
    moveDrag = null;
    clearMoveGhost();
    refreshSceneryBoxes();
  }
  if (area) {
    sceneryView?.setFeatures(area.features ?? []);
    refreshBudgetReadout();
  }
  if (activePointerId !== null && canvas.hasPointerCapture(activePointerId)) {
    canvas.releasePointerCapture(activePointerId);
  }
  activePointerId = null;
  updatePlaceGhost();
}

// ---------------------------------------------------------------- select, move, delete scenery (07.1.3 plan 11)

const SCENERY_PICK_RADIUS_M = 1.5;
/** A press that travels less than this is a plain select, not a move. */
const MOVE_MIN_M = 0.3;
/** Bulk removals above this many items ask first (T-07.1.3-25). */
const BULK_DELETE_CONFIRM_ABOVE = 20;

let selectedScenery: ScenerySelection | null = null;
let hoverScenery: ScenerySelection | null = null;
let moveGhost: THREE.Object3D | null = null;
let lastMoveReason = "";
function makeBoxHelper(opacity: number): THREE.Box3Helper {
  const h = new THREE.Box3Helper(new THREE.Box3(), SELECT_ACCENT);
  const m = h.material as THREE.LineBasicMaterial;
  m.depthTest = false;
  m.transparent = true;
  m.opacity = opacity;
  h.renderOrder = 998;
  h.visible = false;
  return h;
}
const selectedBox = makeBoxHelper(1);
const hoverBox = makeBoxHelper(0.5);
scene.add(selectedBox, hoverBox);

function sceneryAreaFull(): SceneryArea | null {
  const a = sceneryAreaWith();
  if (!a || !area) return null;
  return { ...a, objects: area.objects };
}

function sceneryExists(sel: ScenerySelection): boolean {
  if (!area) return false;
  if (sel.kind === "feature") return (area.features ?? []).some((f) => f.id === sel.id);
  if (sel.kind === "building") return sel.index >= 0 && sel.index < area.buildings.length;
  return area.objects.some((o) => o.crest.id === sel.id && o.crest.ramp !== undefined);
}

/** Rough world bounds of one placed item for the selection box (display only). */
function sceneryBounds(sel: ScenerySelection): THREE.Box3 | null {
  if (!area) return null;
  const box = new THREE.Box3();
  const grow = (x: number, z: number, r: number, h: number): void => {
    const y = heightAtArea(x, z);
    box.expandByPoint(new THREE.Vector3(x - r, y - 0.2, z - r));
    box.expandByPoint(new THREE.Vector3(x + r, y + h, z + r));
  };
  if (sel.kind === "feature") {
    const f = (area.features ?? []).find((v) => v.id === sel.id);
    if (!f) return null;
    if ("points" in f) for (const p of f.points) grow(p[0], p[1], 0.6, f.heightM);
    else grow(f.x, f.z, 1.5 * f.scale, 5 * f.scale);
    return box;
  }
  if (sel.kind === "building") {
    const b = area.buildings[sel.index];
    if (!b) return null;
    const r = Math.hypot(b.halfExtents.x, b.halfExtents.z);
    box.expandByPoint(
      new THREE.Vector3(b.center.x - r, b.center.y - b.halfExtents.y, b.center.z - r),
    );
    box.expandByPoint(
      new THREE.Vector3(b.center.x + r, b.center.y + b.halfExtents.y, b.center.z + r),
    );
    return box;
  }
  const o = area.objects.find((v) => v.crest.id === sel.id && v.crest.ramp !== undefined);
  const ramp = o?.crest.ramp;
  if (!o || !ramp) return null;
  const r = rampLengthM(o.crest.heightM, ramp) + ramp.widthM / 2;
  grow(o.crest.centerX, o.crest.centerZ, r, o.crest.heightM + 0.5);
  return box;
}

function selectableNow(): boolean {
  return dispatcher.getMode() === "select" && dispatcher.placing() === null;
}

/** Shows or hides the accent selection box and the 50% hover box. */
function refreshSceneryBoxes(): void {
  const ok = selectableNow() && area !== null;
  if (selectedScenery && !(ok && sceneryExists(selectedScenery))) selectedScenery = null;
  const sb = ok && selectedScenery ? sceneryBounds(selectedScenery) : null;
  if (sb) selectedBox.box.copy(sb);
  selectedBox.visible = sb !== null;
  const hb = ok && hoverScenery && !moveDrag ? sceneryBounds(hoverScenery) : null;
  if (hb) hoverBox.box.copy(hb);
  hoverBox.visible = hb !== null;
  if (deleteSceneryBtn) deleteSceneryBtn.disabled = !(area && dispatcher.getSelectionMask());
}

function selectScenery(sel: ScenerySelection | null): void {
  selectedScenery = sel;
  refreshSceneryBoxes();
}

/** What is under the cursor: the first scenery mesh box the view ray hits, else the ground test. */
function pickSceneryAt(clientX: number, clientY: number): ScenerySelection | undefined {
  if (!area) return undefined;
  const hit = pickTerrain(clientX, clientY); // also aims the shared raycaster
  const r = raycaster.ray;
  return pickFeatureByRay(
    area.features ?? [],
    area.buildings,
    area.objects,
    heightAtArea,
    {
      ox: r.origin.x,
      oy: r.origin.y,
      oz: r.origin.z,
      dx: r.direction.x,
      dy: r.direction.y,
      dz: r.direction.z,
    },
    hit ? { x: hit.x, z: hit.z } : null,
    SCENERY_PICK_RADIUS_M,
  );
}

function updateSceneryHover(at: { x: number; y: number } | null): void {
  let next: ScenerySelection | null = null;
  if (at && area && selectableNow() && !moveDrag && !stroking) {
    next = pickSceneryAt(at.x, at.y) ?? null;
  }
  const same =
    next === hoverScenery ||
    (next !== null &&
      hoverScenery !== null &&
      JSON.stringify(next) === JSON.stringify(hoverScenery));
  if (same) return;
  hoverScenery = next;
  refreshSceneryBoxes();
}

function clearMoveGhost(): void {
  if (moveGhost) {
    scene.remove(moveGhost);
    disposeObject(moveGhost);
    moveGhost = null;
  }
  lastMoveReason = "";
  ghostRefused = false;
  applyCanvasCursor();
}

/** Forgets any selection and drag (area replaced). */
function resetSceneryMove(): void {
  moveDrag = null;
  selectedScenery = null;
  hoverScenery = null;
  clearMoveGhost();
  refreshSceneryBoxes();
}

/** Press in Select mode: a hit selects the item and starts a move drag. Returns false on a miss. */
function scenerySelectDown(e: PointerEvent): boolean {
  if (!area) return false;
  const hit = pickTerrain(e.clientX, e.clientY);
  if (!hit) return false;
  const sel = pickSceneryAt(e.clientX, e.clientY);
  if (!sel) {
    if (selectedScenery) selectScenery(null);
    return false;
  }
  lastHit = { x: hit.x, z: hit.z };
  selectedStartId = null;
  canvas.setPointerCapture(e.pointerId);
  activePointerId = e.pointerId;
  moveDrag = {
    sel,
    pointerId: e.pointerId,
    startX: hit.x,
    startZ: hit.z,
    dx: 0,
    dz: 0,
    moved: false,
    result: null,
  };
  selectScenery(sel);
  setStatus("Drag to move, Delete removes it, Esc cancels.");
  return true;
}

/** The moved item as a translucent ghost (red when refused, D-12). */
function showMoveGhost(d: SceneryMoveDrag, refused: boolean): void {
  if (!area) return;
  if (moveGhost) {
    scene.remove(moveGhost);
    disposeObject(moveGhost);
    moveGhost = null;
  }
  const tint = refused ? GHOST_REFUSED : undefined;
  const sel = d.sel;
  if (sel.kind === "feature") {
    const moved = moveFeature(area.features ?? [], sel.id, d.dx, d.dz).find((f) => f.id === sel.id);
    if (!moved) return;
    moveGhost = buildFeaturePreview(moved, heightAtArea, {
      opacity: GHOST_OPACITY,
      ...(tint !== undefined ? { tint } : {}),
    });
  } else if (sel.kind === "building") {
    const b = area.buildings[sel.index];
    if (!b) return;
    const res = d.result;
    const placed = res?.ok && res.buildings ? res.buildings[sel.index] : undefined;
    moveGhost = buildingGhostMesh(
      placed ?? { ...b, center: { x: b.center.x + d.dx, y: b.center.y, z: b.center.z + d.dz } },
      tint,
    );
  } else {
    const o = area.objects.find((v) => v.crest.id === sel.id && v.crest.ramp !== undefined);
    if (!o) return;
    const group = new THREE.Group();
    const crest: AuthoredCrest = {
      ...o.crest,
      centerX: o.crest.centerX + d.dx,
      centerZ: o.crest.centerZ + d.dz,
    };
    for (const mesh of buildCrestMeshes([crest], heightAtArea, TERRAIN_SURFACE_PALETTE)) {
      const mat = mesh.material as THREE.MeshStandardMaterial;
      mat.transparent = true;
      mat.opacity = GHOST_OPACITY;
      mat.depthWrite = false;
      if (refused) mat.color.setHex(GHOST_REFUSED);
      group.add(mesh);
    }
    moveGhost = group;
  }
  scene.add(moveGhost);
}

function moveDragTo(e: PointerEvent): void {
  const d = moveDrag;
  if (!d || !area) return;
  const hit = pickTerrain(e.clientX, e.clientY);
  if (!hit) return;
  lastHit = { x: hit.x, z: hit.z };
  d.dx = hit.x - d.startX;
  d.dz = hit.z - d.startZ;
  if (!d.moved && Math.hypot(d.dx, d.dz) < MOVE_MIN_M) return;
  d.moved = true;
  const guard = sceneryAreaFull();
  if (!guard) return;
  const res = moveSceneryItem(guard, d.sel, d.dx, d.dz);
  d.result = res;
  showMoveGhost(d, !res.ok);
  ghostRefused = !res.ok;
  const reason = res.ok ? "" : res.reason;
  if (reason !== lastMoveReason) {
    lastMoveReason = reason;
    setStatus(
      reason === "" ? "Drag to move, release to drop." : reason,
      reason === "" ? "info" : "error",
    );
  }
  applyCanvasCursor();
}

/** Release: one undo step when the move is allowed; a refused move snaps back and pushes nothing. */
function finishMoveDrag(e: PointerEvent): void {
  const d = moveDrag;
  if (!d) return;
  if (area) moveDragTo(e);
  moveDrag = null;
  const res = d.result;
  const moved = d.moved;
  clearMoveGhost();
  if (!area || !moved || res === null) {
    refreshSceneryBoxes();
    return;
  }
  if (!res.ok) {
    setStatus(`${res.reason}. The item snapped back.`, "error");
    refreshSceneryBoxes();
    return;
  }
  const parts: {
    features?: readonly TerrainFeature[];
    buildings?: readonly TerrainBuilding[];
    objects?: readonly TerrainObject[];
  } = {};
  if (res.features) parts.features = res.features;
  if (res.buildings) parts.buildings = res.buildings;
  if (res.objects) parts.objects = res.objects;
  applyResult(dispatcher.commitScenery(parts), 0);
  updateHistoryButtons();
  refreshSceneryBoxes();
  setStatus("Moved. Ctrl+Z undoes it.", "ok");
}

/** Delete with a selected placed item removes it as one undo step. False when nothing applies. */
function deleteSelectedScenery(): boolean {
  if (!area || moveDrag || !selectedScenery || !selectableNow()) return false;
  const sel = selectedScenery;
  if (!sceneryExists(sel)) return false;
  let res: ToolResult;
  let what: string;
  if (sel.kind === "feature") {
    const f = (area.features ?? []).find((v) => v.id === sel.id);
    what = f ? sentenceCase(f.kind) : "Item";
    res = dispatcher.commitScenery({ features: deleteFeature(area.features ?? [], sel.id) });
  } else if (sel.kind === "building") {
    what = "Building";
    res = dispatcher.commitScenery({ buildings: deleteBuilding(area.buildings, sel.index) });
  } else {
    what = "Ramp";
    res = dispatcher.commitScenery({ objects: deleteRamp(area.objects, sel.id) });
  }
  applyResult(res, 0);
  selectScenery(null);
  hoverScenery = null;
  updateHistoryButtons();
  setStatus(`${what} deleted. Ctrl+Z undoes it.`, "ok");
  return true;
}

/** Sidebar button: removes the scenery inside the box selection, one undo step (confirm above 20). */
async function deleteSceneryInSelection(): Promise<void> {
  if (!area) return;
  const mask = dispatcher.getSelectionMask();
  if (!mask) {
    setStatus("Nothing selected", "error");
    return;
  }
  const g = area.grid;
  const r = removeInMask(area.features ?? [], area.buildings, (x, z) => mask.cellAtXZ(g, x, z));
  const n = r.removedFeatures + r.removedBuildings;
  if (n === 0) {
    setStatus("No scenery in the selection");
    return;
  }
  if (n > BULK_DELETE_CONFIRM_ABOVE) {
    const body = document.createElement("p");
    body.textContent = "They are removed from this map. Undo brings them back.";
    // Keep features comes first so the dialog's initial focus lands on the safe choice.
    const choice = await openDialog<"keep" | "delete">({
      title: `Delete ${n} features?`,
      body,
      actions: [
        { id: "keep", label: "Keep features", tip: "Close this dialog and keep everything" },
        {
          id: "delete",
          label: `Delete ${n} features`,
          tip: "Remove them from the map (Ctrl+Z brings them back)",
        },
      ],
    });
    if (choice !== "delete") return;
  }
  const parts: { features?: readonly TerrainFeature[]; buildings?: readonly TerrainBuilding[] } =
    {};
  if (r.removedFeatures > 0) parts.features = r.features;
  if (r.removedBuildings > 0) parts.buildings = r.buildings;
  applyResult(dispatcher.commitScenery(parts), 0);
  updateHistoryButtons();
  refreshSceneryBoxes();
  setStatus(`Deleted ${n} item${n === 1 ? "" : "s"}. Ctrl+Z undoes it.`, "ok");
}

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
    for (const k of ["area", "size", "cell", "cursor", "surface", "roads", "scenery", "change"])
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
  if (sceneryView) {
    scene.remove(sceneryView.group);
    sceneryView.dispose();
  }
  stopOpHold();
  shell.bar?.closeMenus();
  area = next;
  dispatcher.clearHistory();
  budgetMessage = "";
  sceneryView = createSceneryView(
    next.features ?? [],
    next.buildings,
    (x, z) => sampleTerrainHeight(next.grid, x, z),
    { drawStyleless: true },
  );
  scene.add(sceneryView.group);
  pushPull = null; // dialogs cancel a live push/pull before an area is replaced
  dispatcher.clearSelection();
  shell.info.set("change", "");
  setPreview(null);
  setGesturePreview(null, null);
  startGesture.cancel();
  scatterDrag = null;
  buildGesture.cancel();
  featureSeed = featureIdSeed(next.features ?? []);
  startDrag = null;
  startDraft = null;
  selectedStartId = null;
  startSeed = startIdSeed(next.startPoints ?? []);
  stroking = false;
  slopeAmber = false;
  updateHistoryButtons();
  terrainView = buildTerrainView(next.grid, next.paint);
  scene.add(terrainView.group);
  rampGesture.cancel();
  cancelLine();
  resetSceneryMove();
  rebuildRamps();
  $("empty").style.display = "none";
  frameArea(next);
  cursorRing.visible = false;
  clearBoxOutline();
  refreshSelectionOutline();
  overlayCentre = null;
  refreshOverlays();
  refreshRoadLockOverlay();
  refreshInfo();
  refreshBudgetReadout();
  rebuildStartMarkers();
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
  if (dispatcher.placing() !== null) updatePlaceGhost();
}

function paintRingShapes(hit: { x: number; z: number }): void {
  if (!area) return;
  if (dispatcher.placing() !== null) {
    // Place kinds draw their own ghost or scatter ring (updatePlaceGhost).
    cursorRing.visible = false;
    clearBoxOutline();
    return;
  }
  (cursorRing.material as THREE.LineBasicMaterial).opacity = 1;
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
  reseatScenery(w);
  reseatStartMarkers(w);
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

/** Sculpting under a start marker re-seats it on the new ground. */
function reseatStartMarkers(w: CellWindow): void {
  if (!area) return;
  const g = area.grid;
  const hit = currentStarts().some((p) => {
    const col = (p.x - g.originX) / g.cellSizeM;
    const row = (p.z - g.originZ) / g.cellSizeM;
    return col >= w.minCol - 1 && col <= w.maxCol + 1 && row >= w.minRow - 1 && row <= w.maxRow + 1;
  });
  if (hit) rebuildStartMarkers();
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
    updateSceneryHover(null);
    updateFootprintGrid(null);
    updatePlaceGhost();
    applyCanvasCursor();
    shell.info.set("cursor", "off the terrain");
    shell.info.set("surface", "");
    return;
  }
  lastHit = { x: hit.x, z: hit.z };
  updateSceneryHover({ x: clientX, y: clientY });
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
    : ghostRefused && lastHit !== null
      ? "not-allowed"
      : (tool === "select" || dispatcher.placing() !== null) && lastHit !== null
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
      res.lockChanged ||
      res.startPointsChanged ||
      res.featuresChanged ||
      res.buildingsChanged ||
      res.objectsChanged);
  if (res.startPointsChanged) startPointsEdited();
  sceneryChanged(res);
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
  sceneryChanged(r);
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
  const placing = dispatcher.placing();
  if (placing === "start") {
    if (!stroking && !pushPull && !opHold) startPointerDown(e);
    return;
  }
  if (placing === "building" || placing === "tree" || placing === "bush") {
    if (!stroking && !pushPull && !opHold && !sceneryGestureActive())
      sceneryPointerDown(e, placing);
    return;
  }
  if (placing === "hedge" || placing === "fence") {
    if (!stroking && !pushPull && !opHold) linePointerDown(e, placing);
    return;
  }
  if (placing === "ramp") {
    if (!stroking && !pushPull && !opHold && !sceneryGestureActive()) rampPointerDown(e);
    return;
  }
  if (
    placing === null &&
    dispatcher.getMode() === "select" &&
    !e.shiftKey &&
    !e.ctrlKey &&
    !e.metaKey &&
    !stroking &&
    !pushPull &&
    !opHold &&
    !sceneryGestureActive() &&
    scenerySelectDown(e)
  ) {
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
  if (startGesture.active() || startDrag) {
    startPointerMove(e);
    return;
  }
  if (sceneryGestureActive()) {
    sceneryPointerMove(e);
    return;
  }
  if (stroking) strokeEvent(e, "move");
});
canvas.addEventListener("pointerup", (e) => {
  if (e.button === 0 && (startGesture.active() || startDrag)) {
    startPointerUp(e);
    return;
  }
  if (e.button === 0 && sceneryGestureActive()) {
    sceneryPointerUp(e);
    return;
  }
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
  cancelStartGesture();
  cancelSceneryGesture();
  if (pushPull) cancelPushPullDrag("Push/pull cancelled.");
  if (stroking) strokeEvent(e, "up");
  activePointerId = null;
});
// Double-click finishes a hedge or fence; the two clicks add one point (a twin point is ignored).
canvas.addEventListener("dblclick", (e) => {
  if (lineBuilder.active() && lineKindActive !== null && dispatcher.placing() === lineKindActive) {
    e.preventDefault();
    finishLine();
  }
});
canvas.addEventListener("pointerleave", () => {
  cancelStartGesture();
  cancelSceneryGesture();
  if (!stroking) {
    cursorRing.visible = false;
    clearBoxOutline();
    lastHit = null; // Drive here must never use a stale cursor position (D-06)
    updatePlaceGhost();
  }
});

// ---------------------------------------------------------------- start point gestures (D-05)

function selectStart(id: string): void {
  if (!area || !(area.startPoints ?? []).some((p) => p.id === id)) return;
  selectedStartId = id;
  rebuildStartMarkers();
  highlightStartRows();
  updateDriveButton();
}

function startPointerDown(e: PointerEvent): void {
  if (!area) return;
  const hit = pickTerrain(e.clientX, e.clientY);
  if (!hit) {
    setStatus("Start points must be inside the map area", "error");
    return;
  }
  lastHit = { x: hit.x, z: hit.z };
  canvas.setPointerCapture(e.pointerId);
  activePointerId = e.pointerId;
  const marker = startPointAt(hit.x, hit.z);
  if (marker) {
    selectStart(marker.id);
    startDrag = {
      id: marker.id,
      mode: e.shiftKey ? "turn" : "move",
      pointerId: e.pointerId,
      moved: false,
    };
    return;
  }
  startGesture.down(hit.x, hit.z);
}

function startPointerMove(e: PointerEvent): void {
  if (!area) return;
  const hit = pickTerrain(e.clientX, e.clientY);
  if (!hit) return;
  if (startDrag) {
    const list = area.startPoints ?? [];
    const p = list.find((q) => q.id === startDrag?.id);
    if (!p) return;
    if (startDrag.mode === "move") {
      startDraft = moveStartPoint(list, p.id, hit.x, hit.z);
    } else {
      const dx = hit.x - p.x;
      const dz = hit.z - p.z;
      if (Math.hypot(dx, dz) < DRAG_HEADING_MIN_M) return;
      startDraft = turnStartPoint(list, p.id, yawFromTravelDirection(dx, dz));
    }
    startDrag.moved = true;
    rebuildStartMarkers();
    return;
  }
  startGesture.move(hit.x, hit.z);
  const pv = startGesture.preview();
  setGesturePreview(pv?.from ?? null, pv?.to ?? null);
}

function startPointerUp(e: PointerEvent): void {
  if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
  activePointerId = null;
  if (!area) return;
  if (startDrag) {
    const d = startDrag;
    const draft = startDraft;
    startDrag = null;
    startDraft = null;
    if (draft && d.moved) {
      applyResult(dispatcher.commitStartPoints(draft), 0);
      updateHistoryButtons();
      setStatus(d.mode === "move" ? "Moved start point." : "Turned start point.", "ok");
    } else {
      rebuildStartMarkers();
    }
    return;
  }
  const r = startGesture.up();
  setGesturePreview(null, null);
  if (!r) return;
  const ext = terrainGridExtent(area.grid);
  if (r.x < ext.minX || r.x > ext.maxX || r.z < ext.minZ || r.z > ext.maxZ) {
    setStatus("Start points must be inside the map area", "error");
    return;
  }
  const heading = r.headingRad ?? nearestEdgeHeading(area.graph, r.x, r.z) ?? 0;
  const res = addStartPoint(area.startPoints ?? [], startSeed, r.x, r.z, heading);
  if (res.error !== undefined) {
    setStatus(res.error, "error");
    return;
  }
  startSeed = res.nextSeed;
  const added = res.list[res.list.length - 1];
  if (!added) return;
  selectedStartId = added.id;
  applyResult(dispatcher.commitStartPoints(res.list), 0);
  updateHistoryButtons();
  setStatus(`Placed ${added.name}. Ctrl+Z undoes it.`, "ok");
}

function cancelStartGesture(): void {
  const had = startGesture.active() || startDrag !== null;
  startGesture.cancel();
  setGesturePreview(null, null);
  if (startDrag) {
    startDrag = null;
    startDraft = null;
    rebuildStartMarkers();
  }
  if (had && activePointerId !== null && canvas.hasPointerCapture(activePointerId)) {
    canvas.releasePointerCapture(activePointerId);
  }
  if (had) activePointerId = null;
}

/** One undo step for a list edit from the sidebar or the keyboard. */
function commitStarts(next: readonly TerrainStartPoint[]): void {
  if (!area || stroking || pushPull || opHold) return;
  applyResult(dispatcher.commitStartPoints(next), 0);
  updateHistoryButtons();
}

/** Start-point list changed (edit, undo or redo): markers, list and selection follow. */
function startPointsEdited(): void {
  const ids = new Set((area?.startPoints ?? []).map((q) => q.id));
  if (selectedStartId !== null && !ids.has(selectedStartId)) selectedStartId = null;
  rebuildStartMarkers();
  refreshStartList();
  syncToolbar();
}

function deleteSelectedStart(): boolean {
  if (!area || selectedStartId === null) return false;
  const placing = dispatcher.placing() === "start";
  const selectMode = dispatcher.getMode() === "select" && dispatcher.placing() === null;
  if (!placing && !(selectMode && dispatcher.selectionCellCount() === 0)) return false;
  const list = area.startPoints ?? [];
  if (!list.some((q) => q.id === selectedStartId)) return false;
  commitStarts(removeStartPoint(list, selectedStartId));
  setStatus("Deleted start point. Ctrl+Z undoes it.", "ok");
  return true;
}

function undoRedo(kind: "undo" | "redo"): void {
  if (!area || stroking || pushPull || opHold || sceneryGestureActive() || lineBuilder.active()) {
    return;
  }
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
  if (r.startPointsChanged) startPointsEdited();
  sceneryChanged(r);
  setBudgetMessage("");
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

/** Terrain drop-down content (D-34): one swatch grid feeding the Terrain fill and the Terrain brush. */
function buildSurfaceMenu(): HTMLElement {
  const group = el("div", "swatch-grid");
  group.setAttribute("role", "radiogroup");
  group.setAttribute("aria-label", "Surface");
  group.style.display = "grid";
  // Two even rows (6 surfaces = 3 x 2), so no ragged last row.
  group.style.gridTemplateColumns = `repeat(${Math.ceil(SURFACE_TYPES.length / 2)}, 32px)`;
  group.style.gap = "4px";
  group.style.padding = "4px";
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
    b.dataset.tip = s;
    b.style.width = "32px";
    b.style.height = "32px";
    b.style.padding = "0";
    b.style.cursor = "pointer";
    b.style.background = surfaceColour(s);
    b.addEventListener("click", () => {
      dispatcher.setOptions({ surface: s });
      sync();
      shell.bar?.closeMenus();
      runToolbarAction("terrain");
    });
    buttons.push([s, b]);
    group.appendChild(b);
  }
  sync();
  return group;
}

function surfaceColour(s: SurfaceType): string {
  return `#${TERRAIN_SURFACE_PALETTE[s].toString(16).padStart(6, "0")}`;
}

/** Current-surface readout shown in the sidebar while the Terrain brush is armed (D-34). */
function surfaceField(): HTMLElement {
  surfaceReadoutEl = el("div");
  updateSurfaceReadout();
  return createField(
    "Surface",
    surfaceReadoutEl,
    "Surface the Terrain brush paints (affects grip)",
  );
}

function updateSurfaceReadout(): void {
  if (!surfaceReadoutEl) return;
  const now = dispatcher.getOptions().surface;
  const row = el("div");
  row.style.display = "flex";
  row.style.alignItems = "center";
  row.style.gap = "6px";
  const chip = el("span");
  chip.style.display = "inline-block";
  chip.style.width = "16px";
  chip.style.height = "16px";
  chip.style.border = "1px solid #555";
  chip.style.background = surfaceColour(now);
  const name = el("span");
  name.textContent = now;
  row.append(chip, name);
  surfaceReadoutEl.replaceChildren(row, note("Change it from Terrain \u25BE in the top bar."));
}

function updateRoadsCountEl(): void {
  if (!roadsCountEl) return;
  roadsCountEl.textContent = area
    ? roadsInfoText(roadLockCounts(area.graph, (area as unknown as EditArea).unlockedEdgeIds))
    : "No area loaded";
}

/** Sidebar content for the current mode and armed brush (D-12, D-18, D-27). */
const PLACE_HINT: Record<PlaceKind, string> = {
  start: "Click and drag: where the car starts, and which way it faces.",
  building: "Drag a footprint. Wheel rotates 15 degrees.",
  tree: "Click to place. Scatter paints many.",
  bush: "Click to place. Scatter paints many.",
  hedge: "Click points. Enter or double-click finishes, Esc cancels.",
  fence: "Click points. Enter or double-click finishes, Esc cancels.",
  ramp: "Press, then drag toward the way it should face.",
};

let startListBox: HTMLElement | null = null;
let driveFromBtn: HTMLButtonElement | null = null;

function selectedOrDefaultStart(): TerrainStartPoint | undefined {
  const list = area?.startPoints ?? [];
  return list.find((q) => q.id === selectedStartId) ?? defaultStartPoint(list);
}

function updateDriveButton(): void {
  if (!driveFromBtn) return;
  const sp = selectedOrDefaultStart();
  driveFromBtn.textContent = `Drive from: ${sp ? sp.name : "(none)"}`;
  driveFromBtn.setAttribute("aria-disabled", String(!sp));
  driveFromBtn.style.opacity = sp ? "" : "0.55";
}

function highlightStartRows(): void {
  if (!startListBox) return;
  for (const row of Array.from(startListBox.children) as HTMLElement[]) {
    if (row.dataset.startId === undefined) continue;
    row.style.borderLeftColor = row.dataset.startId === selectedStartId ? "#4aa3ff" : "transparent";
  }
}

function startRow(p: TerrainStartPoint, index: number, isDefault: boolean): HTMLElement {
  const row = el("div");
  row.dataset.startId = p.id;
  row.style.cssText =
    "display:flex;gap:4px;height:32px;align-items:center;border-left:2px solid transparent;padding-left:2px";
  row.addEventListener("click", () => selectStart(p.id));
  const squareBtn = (b: HTMLButtonElement, aria: string): HTMLButtonElement => {
    b.style.cssText = "width:32px;height:32px;padding:0;flex:none";
    b.setAttribute("aria-label", aria);
    return b;
  };
  const star = squareBtn(
    createButton({
      label: isDefault ? "★" : "☆",
      tip: "Make default: use this start in the game",
      onClick: () => commitStarts(makeDefault(area?.startPoints ?? [], p.id)),
    }),
    isDefault ? `${p.name} is the default start` : `Make ${p.name} the default start`,
  );
  star.disabled = isDefault;
  const input = el(
    "input",
    undefined,
    undefined,
    "Rename this start point (Enter keeps it, Esc reverts)",
  );
  input.type = "text";
  input.maxLength = MAX_START_NAME_CHARS;
  input.value = p.name;
  input.setAttribute("aria-label", `Name of start point ${index + 1}`);
  input.style.cssText = "flex:1;min-width:0;height:28px";
  input.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter") {
      ev.stopPropagation();
      input.blur();
    } else if (ev.key === "Escape") {
      ev.stopPropagation();
      input.value = p.name;
      input.blur();
    }
  });
  input.addEventListener("blur", () => {
    if (input.value.trim() === p.name) {
      input.value = p.name;
      return;
    }
    const list = area?.startPoints ?? [];
    const next = renameStartPoint(list, p.id, input.value);
    if (next === list) {
      input.value = p.name;
      setStatus(`Start point names are 1 to ${MAX_START_NAME_CHARS} characters`, "error");
      return;
    }
    commitStarts(next);
  });
  const goTo = squareBtn(
    createButton({
      label: "⌖",
      tip: "Go to: centre the view on this start point",
      onClick: () => {
        if (!area) return;
        const t = (area.startPoints ?? []).find((q) => q.id === p.id);
        if (!t) return;
        const off = camera.position.clone().sub(controls.target);
        controls.target.set(t.x, sampleTerrainHeight(area.grid, t.x, t.z), t.z);
        camera.position.copy(controls.target).add(off);
        controls.update();
        selectStart(p.id);
      },
    }),
    `Go to ${p.name}`,
  );
  const del = squareBtn(
    createButton({
      label: "✕",
      tip: "Delete this start point (Ctrl+Z undoes it)",
      onClick: () => commitStarts(removeStartPoint(area?.startPoints ?? [], p.id)),
    }),
    `Delete ${p.name}`,
  );
  row.append(star, input, goTo, del);
  return row;
}

/** Rebuilds the Start points rows from area.startPoints (names come from files: textContent / value only). */
function refreshStartList(): void {
  if (!startListBox) return;
  startListBox.replaceChildren();
  const list = area?.startPoints ?? [];
  if (list.length === 0) {
    startListBox.append(
      el("div", "muted", "No start points"),
      el(
        "div",
        "muted",
        "Pick Place > Start point, then click and drag on the map to set where and which way.",
      ),
    );
  }
  list.forEach((p, i) => {
    startListBox?.appendChild(startRow(p, i, i === 0));
  });
  highlightStartRows();
  updateDriveButton();
}

function buildStartPointsSection(open: boolean): HTMLDetailsElement {
  startListBox = el("div");
  startListBox.style.cssText =
    "display:flex;flex-direction:column;gap:4px;max-height:260px;overflow-y:auto;margin:4px 0";
  driveFromBtn = createButton({
    label: "Drive from: (none)",
    tip: "Save, then open the game on the selected start point (D)",
    onClick: () => void driveFrom(),
  });
  driveFromBtn.style.width = "100%";
  const section = createSection("Start points", "Where the car starts in the game", open, [
    startListBox,
    driveFromBtn,
  ]);
  refreshStartList();
  return section;
}

function buildSidebar(): void {
  startListBox = null;
  driveFromBtn = null;
  activeValue = null;
  selectionReadoutEl = null;
  surfaceReadoutEl = null;
  selectionAvgEl = null;
  roadsCountEl = null;
  budgetEl = null;
  budgetMsgEl = null;
  buildingBoxes = null;
  lineLengthEl = null;
  rampDirEl = null;
  const o = dispatcher.getOptions();
  const f = shell.flyout;
  f.replaceChildren();
  const mode = dispatcher.getMode();
  const armed = dispatcher.getArmed();
  const placingKind = dispatcher.placing();
  if (lineKindActive !== null && lineKindActive !== placingKind) cancelLine();
  if (placingKind === "hedge" || placingKind === "fence") {
    buildLineSidebar(placingKind, f);
    return;
  }
  if (placingKind === "ramp") {
    buildRampSidebar(f);
    return;
  }
  if (placingKind === "building" || placingKind === "tree" || placingKind === "bush") {
    buildScenerySidebar(placingKind, f);
    return;
  }
  if (placingKind !== null) {
    f.append(note(PLACE_HINT[placingKind]));
    if (placingKind === "start") f.append(buildStartPointsSection(true));
    return;
  }

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
  const shape = (): HTMLElement =>
    createField("Shape", brushShapeSlot, "Brush footprint: circle or square");
  const size = (): HTMLElement =>
    createField("Size", brushSizeStepper.el, "Brush size in metres ([ ] also change it)");
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
    deleteSceneryBtn = createButton({
      label: "Delete scenery in selection",
      tip: "Remove every tree, bush, hedge, fence and building inside the box selection (Ctrl+Z undoes it)",
      onClick: () => void deleteSceneryInSelection(),
    });
    deleteSceneryBtn.style.width = "100%";
    deleteSceneryBtn.disabled = dispatcher.getSelectionMask() === null;
    f.append(deleteSceneryBtn);
    if ((area?.startPoints?.length ?? 0) > 0) f.append(buildStartPointsSection(false));
    updateRoadsCountEl();
    refreshSelectionOutline();
    return;
  }

  activeValue = radiusActive;
  switch (armed) {
    case "raise":
    case "lower":
    case "flatten":
      f.append(shape(), size(), strength(), falloff(), slope());
      break;
    case "smooth":
      f.append(
        shape(),
        size(),
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
      f.append(shape(), size(), strength(), falloff(), slope(), surfaceField());
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
      f.append(size(), note("Drag over roads to erase them."));
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

async function isDrivable(id: string): Promise<boolean> {
  try {
    const res = await fetch(`/__terrain/drivable/${id}`);
    return res.ok && ((await res.json()) as { drivable?: boolean }).drivable === true;
  } catch {
    return false;
  }
}

function openDriveUrl(url: string): void {
  const w = window.open(url, "_blank");
  if (!w) log(`Pop-up blocked. Open ${url} manually.`);
}

/** Drive from the selected start point, else the default one (D-06). */
async function driveFrom(): Promise<void> {
  if (!area) return;
  const sp = selectedOrDefaultStart();
  if (!sp) {
    setStatus("Place a start point first, or use Drive here.", "error");
    return;
  }
  const id = area.areaId;
  const startId = sp.id;
  if (!(await save())) return;
  if (!(await isDrivable(id))) {
    fail("Drive from: this area is not registered yet. Save it once, then try again.");
    return;
  }
  openDriveUrl(buildDriveUrl(id, { start: startId }));
}

/**
 * Drive from a spot. The keyboard path passes the cursor point captured at keydown; the
 * menu path passes nothing and uses the view centre. The spot and the facing are read BEFORE
 * the awaited save, so a moving cursor or camera never changes them (D-06).
 */
async function driveHere(spot?: { x: number; z: number }): Promise<void> {
  if (!area) return;
  const id = area.areaId;
  const fromMenu = spot === undefined;
  const at = spot ?? { x: controls.target.x, z: controls.target.z };
  const dir = new THREE.Vector3();
  camera.getWorldDirection(dir);
  const headingDeg =
    Math.hypot(dir.x, dir.z) > 1e-4
      ? yawToHeadingDeg(yawFromTravelDirection(dir.x, dir.z))
      : undefined;
  if (!(await save())) return;
  if (!(await isDrivable(id))) {
    fail("Drive here: this area is not registered yet. Save it once, then try again.");
    return;
  }
  if (fromMenu) setStatus("Driving from the centre of the view");
  openDriveUrl(buildDriveUrl(id, { at, ...(headingDeg !== undefined ? { headingDeg } : {}) }));
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
  cancelStartGesture();
  cancelSceneryGesture();
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

function makeBrushShapeSlot(): HTMLElement {
  const box = el("div", "brush-shape");
  box.style.display = "flex";
  box.style.gap = "4px";
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
  box.append(mk("round", "●", "Circle"), mk("square", "■", "Square"));
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

const surfaceMenu = buildSurfaceMenu();

function toolbarInput(): ToolbarInput {
  return {
    mode: dispatcher.getMode(),
    selectionCells: dispatcher.selectionCellCount(),
    cellSizeM: area?.grid.cellSizeM ?? 1,
    armed: dispatcher.getArmed(),
    placing: dispatcher.placing(),
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
  const hasStarts = (area?.startPoints?.length ?? 0) > 0 ? 1 : 0;
  const key = `${input.mode}|${input.armed ?? ""}|${input.placing ?? ""}|${hasStarts}`;
  if (key !== sidebarKey) {
    sidebarKey = key;
    buildSidebar();
  }
  const f = shell.bar;
  if (f) {
    for (const t of [...TOOLBAR_TOOLS, ROAD_MENU, PLACE_MENU]) {
      f.setEnabled(t.id, st.enabled[t.id], st.disabledTip[t.id]);
      const pressed =
        t.id === "grid" ? gridOn : t.id === "contours" ? contoursOn : st.pressed[t.id];
      f.setPressed(t.id, pressed);
    }
    f.setMenuFace("road", menuFace(ROAD_MENU, ROAD_BUTTONS, st.roadFace));
    const terrainTool = TOOLBAR_TOOLS.find((t) => t.id === "terrain");
    if (terrainTool) {
      f.setMenuFace("terrain", {
        ...menuFace(terrainTool, [], null),
        active: st.pressed.terrain,
        swatch: surfaceColour(dispatcher.getOptions().surface),
      });
    }
  }
  updateSurfaceReadout();
  updatePlaceGhost();
  refreshSceneryBoxes();
  const shape = dispatcher.getOptions().brushShape;
  for (const [k, b] of brushShapeButtons) b.setAttribute("aria-pressed", String(k === shape));
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
    case "place":
      stopOpHold();
      cancelActiveStroke();
      dispatcher.setPlacing(act.place);
      stroking = stroking && dispatcher.isStroking();
      syncToolFromDispatcher();
      setStatus(PLACE_HINT[act.place]);
      break;
    case "apply":
      if (dispatcher.placing() !== null) {
        setStatus("Switch to Select mode (S) to use this");
        break;
      }
      stopOpHold(); // keep the editor's hold and the dispatcher's repeat session in step
      runLockAction(() => dispatcher.applyOperation(act.op));
      shell.bar?.flash(id);
      break;
    case "roadAction":
      if (dispatcher.placing() !== null) {
        setStatus("Switch to Select mode (S) to use this");
        break;
      }
      runLockAction(() => dispatcher.applyRoadAction(act.action));
      break;
    case "toggle":
      toggleOverlay(act.which);
      break;
    case "menu":
      shell.bar?.openMenu(act.id);
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
          label: "Drive from start point",
          tip: "Save, then open the game on the selected start point, else the default one",
          shortcut: "D",
          run: () => void driveFrom(),
          enabled: () => area !== null,
        },
        {
          id: "drive-here",
          label: "Drive here",
          tip: "Save, then open the game at the centre of the view, facing the way the camera looks",
          shortcut: "Shift+D",
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
    groups: TERRAIN_BAR,
    slots: { surfaces: surfaceMenu },
  },
  sidebarView: [
    createField("Grid spacing", gridSpacingStepper.el, "Grid line spacing in cells (display only)"),
    createField("Contour interval", contourStepper.el, "Height between contour lines in metres"),
  ],
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
    {
      key: "scenery",
      label: "Scenery",
      tip: "Scenery triangles used out of the 40,000 limit",
    },
    { key: "change", label: "Change", tip: "Size of the last height edit" },
  ],
});

// ---------------------------------------------------------------- keyboard

const BINDINGS: Binding[] = [
  ...STANDARD_BINDINGS,
  { id: "topdown", code: "KeyT", label: "T" },
  { id: "drive", code: "KeyD", label: "D" },
  { id: "driveHere", code: "KeyD", shift: true, label: "Shift+D" },
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
      if (shell.bar?.closeMenus()) return;
      if (opHold) {
        stopOpHold();
        return;
      }
      if (pushPull) {
        cancelPushPullDrag("Push/pull cancelled.");
        return;
      }
      if (startGesture.active() || startDrag) {
        cancelStartGesture();
        setStatus("Placement cancelled.");
        return;
      }
      if (sceneryGestureActive()) {
        cancelSceneryGesture();
        setStatus("Placement cancelled.");
        return;
      }
      if (lineBuilder.active()) {
        cancelLine();
        setStatus("Line cancelled.");
        return;
      }
      if (selectedScenery) {
        selectScenery(null);
        return;
      }
      if (dispatcher.placing() !== null) {
        stopOpHold();
        dispatcher.setPlacing(null);
        syncToolFromDispatcher();
        syncToolbar();
        setStatus("Stopped placing.");
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
      void driveFrom();
      return;
    case "driveHere": {
      // Captured synchronously: the cursor point at keypress, never a stale one (D-06).
      const spot = lastHit ? { x: lastHit.x, z: lastHit.z } : undefined;
      void driveHere(spot);
      return;
    }
    default:
      break;
  }
  if (textFocused || dialogOpen || e.altKey || e.ctrlKey || e.metaKey) return;
  if (lineBuilder.active() && lineKindActive !== null && dispatcher.placing() === lineKindActive) {
    // Line in progress: Enter finishes, Backspace drops the last point (never in TERRAIN_HOTKEYS).
    if ((e.code === "Enter" || e.code === "NumpadEnter") && !e.repeat) {
      e.preventDefault();
      finishLine();
      return;
    }
    if (e.code === "Backspace") {
      e.preventDefault();
      lineRemoveLast();
      return;
    }
  }
  if (e.code === "Delete" && (deleteSelectedScenery() || deleteSelectedStart())) {
    e.preventDefault();
    return;
  }
  const tid = TERRAIN_HOTKEYS[e.code];
  if (tid) {
    e.preventDefault();
    if (e.repeat) return; // OS key repeat never re-fires a toolbar action
    if (isHoldOp(tid) && startOpHold(tid, e.code)) return;
    const hk = resolveHotkey(toolbarInput(), tid);
    if (hk.openMenu) shell.bar?.openMenu(hk.openMenu);
    if (hk.action) runToolbarAction(tid);
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
  positionStartTags();
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
