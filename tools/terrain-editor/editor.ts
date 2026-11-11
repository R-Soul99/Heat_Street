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
import { validateGraph } from "../map-compiler/validate/validator.ts";
import { createEmptyTerrainArea } from "./new-area.ts";
import { blockingRoadFailures, saveBlockMessage, staleRoadBlockMessage } from "./save-guard.ts";
import { putTerrainPair } from "./save-pair.ts";
import {
  createToolDispatcher,
  type EditArea,
  SLOPE_CLAMP_HINT,
  TOOL_KEYS,
  type Tool,
  type ToolResult,
} from "./tool-dispatch.ts";

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const canvas = $<HTMLCanvasElement>("view");
const wrap = $("wrap");

const NAME_RE = /^[a-z0-9-]{1,64}$/;
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
  const el = $("log");
  el.textContent = `${el.textContent ?? ""}${line}\n`;
  el.scrollTop = el.scrollHeight;
}

// WR-06: built from DOM nodes / textContent only. Status text can echo file
// content (sidecar parse errors) and server error bodies, so it must never be
// parsed as HTML.
function setStatus(text: string): void {
  const el = $("status");
  el.replaceChildren(area ? area.areaId : "no area");
  if (dirty) {
    const marker = document.createElement("span");
    marker.className = "dirty";
    marker.textContent = "unsaved";
    el.append(" ", marker);
  }
  el.append(document.createElement("br"), text);
}

function setHint(text: string): void {
  $("hint").textContent = text;
}

function setDirty(value: boolean): void {
  dirty = value;
  // CR-01: every edit bumps the counter, so a save can tell whether anything
  // changed while its PUTs were in flight (and must then stay dirty).
  if (value) editCounter++;
}

function confirmDiscard(): boolean {
  if (!dirty || !area) return true;
  return confirm(
    `Discard unsaved edits?: You have unsaved changes to ${area.areaId}. Discard them and continue?`,
  );
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
  const select = $<HTMLSelectElement>("area");
  select.innerHTML = "";
  for (const id of knownAreas) {
    const opt = document.createElement("option");
    opt.value = id;
    opt.textContent = id;
    select.appendChild(opt);
  }
  if (selectId !== undefined && knownAreas.includes(selectId)) select.value = selectId;
  $<HTMLButtonElement>("load").disabled = knownAreas.length === 0;
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
  $("topdown").setAttribute("aria-pressed", "false");
  $("topdown").classList.remove("active");
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
  terrainView = buildTerrainView(next.grid, next.paint);
  scene.add(terrainView.group);
  $("empty").style.display = "none";
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
  if (!confirmDiscard()) return;
  try {
    const [bin, json] = await Promise.all([
      api(`/__terrain/${id}/bin`).then((r) => r.arrayBuffer()),
      api(`/__terrain/${id}/json`).then((r) => r.text()),
    ]);
    const loaded = await loadTerrainArea(bin, json, id, id);
    installArea(loaded);
    setDirty(false);
    lastEditMs = null;
    setStatus("Loaded.");
    log(`loaded ${id}`);
  } catch (err) {
    const text = loadErrorMessage(`${id}.terrain.bin`, err);
    setStatus(text);
    log(text);
  }
}

async function createArea(): Promise<void> {
  const name = $<HTMLInputElement>("new-name").value.trim();
  const widthM = Number($<HTMLInputElement>("new-w").value);
  const depthM = Number($<HTMLInputElement>("new-d").value);
  const cellSizeM = Number($<HTMLInputElement>("new-cell").value) || DEFAULT_CELL_SIZE_M;
  if (!NAME_RE.test(name)) {
    setStatus("Name must be 1-64 characters: a-z, 0-9 and -.");
    return;
  }
  if (!(widthM > 0 && widthM <= MAX_AREA_SIZE_M) || !(depthM > 0 && depthM <= MAX_AREA_SIZE_M)) {
    setStatus(`Width and depth must be between 0 and ${MAX_AREA_SIZE_M} m.`);
    return;
  }
  if (!confirmDiscard()) return;
  if (knownAreas.includes(name) && !confirm(`Area ${name} already exists: Overwrite it?`)) return;
  try {
    const created = createEmptyTerrainArea({ areaId: name, widthM, depthM, cellSizeM });
    installArea(created);
    setDirty(true);
    $("new-form").classList.remove("open");
    setStatus("Created flat grass terrain. Press Save terrain to write it.");
    log(`new ${name} ${created.grid.cols}x${created.grid.rows} cells`);
  } catch (err) {
    setStatus(err instanceof Error ? err.message : String(err));
  }
}

async function save(): Promise<boolean> {
  // CR-01: one save at a time; a second Ctrl+S / Drive here while a save is
  // in flight is refused instead of racing the first one.
  if (!area || saving) {
    if (saving) setStatus("Save already in progress.");
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
      setStatus(blockText);
      log(blockText);
      return false;
    }
    // Quick 261110-rdx (DD-3): an unlocked road that no longer matches the terrain is not saved.
    const staleText = staleRoadBlockMessage(
      target.grid,
      target.graph,
      (target as unknown as EditArea).unlockedEdgeIds,
    );
    if (staleText !== null) {
      setStatus(staleText);
      log(staleText);
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
    );
    log(`saved ${target.areaId} (${kb} KB)`);
    if (registerWarning !== "") {
      setStatus(registerWarning);
      log(registerWarning);
    }
    await refreshAreaList(target.areaId);
    return true;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const text = `Save failed: ${msg}. Your edits are still in memory; fix the problem and press Save terrain again.`;
    setStatus(text);
    log(text);
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
  $("topdown").setAttribute("aria-pressed", String(on));
  $("topdown").classList.toggle("active", on);
}

// ---------------------------------------------------------------- tools

function updateOptionVisibility(): void {
  for (const el of document.querySelectorAll<HTMLElement>("#tool-opts [data-for]")) {
    const tools = (el.dataset.for ?? "").split(" ");
    el.classList.toggle("hidden", !tools.includes(tool));
  }
}

function selectTool(next: Tool): void {
  tool = next;
  dispatcher.setTool(next);
  updateOptionVisibility();
  if (tool !== "block") blockOutline.visible = false;
  if (tool !== "smoothBox") {
    dispatcher.cancelBoxDrag();
    stroking = stroking && dispatcher.isStroking();
    clearBoxOutline();
  }
  if (lastHit) paintRing(lastHit);
  updateZoomHint();
  for (const b of document.querySelectorAll<HTMLButtonElement>("#tools .tool")) {
    const on = b.dataset.tool === next;
    b.classList.toggle("active", on);
    b.setAttribute("aria-pressed", String(on));
  }
}

for (const b of document.querySelectorAll<HTMLButtonElement>("#tools .tool")) {
  b.addEventListener("click", () => selectTool(b.dataset.tool as Tool));
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
  const current = $("hint").textContent;
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
  return $<HTMLInputElement>("opt-grid").checked || $<HTMLInputElement>("opt-contours").checked;
}

function contourIntervalM(): number {
  return Math.min(CONTOUR_MAX_M, Math.max(CONTOUR_MIN_M, readNum("opt-contour-interval", 1)));
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
  const gridOn = $<HTMLInputElement>("opt-grid").checked;
  const contoursOn = $<HTMLInputElement>("opt-contours").checked;
  gridLines.visible = gridOn;
  contourLines.visible = contoursOn;
  const row = Math.round((z - g.originZ) / g.cellSizeM);
  const col = Math.round((x - g.originX) / g.cellSizeM);
  const w = overlayWindow(row, col);
  if (!w) return;
  overlayCentre = { row, col };
  if (gridOn) setLines(gridLines, gridLineSegments(g, w));
  if (contoursOn) setLines(contourLines, contourSegments(g, w, contourIntervalM()));
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

function toggleOverlay(id: "opt-grid" | "opt-contours"): void {
  const el = $<HTMLInputElement>(id);
  el.checked = !el.checked;
  refreshOverlays();
}

function wireOverlays(): void {
  for (const id of ["opt-grid", "opt-contours"] as const) {
    $<HTMLInputElement>(id).addEventListener("change", refreshOverlays);
  }
  $<HTMLInputElement>("opt-contour-interval").addEventListener("input", refreshOverlays);
}

function updateCursor(clientX: number, clientY: number): void {
  if (!area) return;
  const hit = pickTerrain(clientX, clientY);
  if (!hit) {
    cursorRing.visible = false;
    blockOutline.visible = false;
    if (!stroking) clearBoxOutline();
    lastHit = null;
    $("sel").textContent = "Cursor is off the terrain.";
    return;
  }
  lastHit = { x: hit.x, z: hit.z };
  paintRing(hit);
  maybeRebuildOverlays(hit.x, hit.z);

  terrainTriangleNormal(area.grid, hit.x, hit.z, normalScratch);
  const slopeDeg = (Math.acos(Math.min(1, normalScratch.y)) * 180) / Math.PI;
  const g = area.grid;
  $("sel").textContent = [
    ...((tool === "block" || tool === "smoothBox") && blockReadoutLine ? [blockReadoutLine] : []),
    `x ${hit.x.toFixed(1)}  z ${hit.z.toFixed(1)}`,
    `height ${hit.y.toFixed(2)} m`,
    `slope ${slopeDeg.toFixed(1)} deg`,
    `surface ${surfaceAt(area.paint, hit.x, hit.z)}`,
    `nearest edge ${nearestEdgeId(area, hit.x, hit.z)}`,
    `vertices ${((g.rows + 1) * (g.cols + 1)).toLocaleString()}  chunks ${terrainView?.chunkMeshes.length ?? 0}`,
    `last edit ${lastEditMs === null ? "-" : `${lastEditMs.toFixed(1)} ms`}`,
  ].join("\n");
}

// ---------------------------------------------------------------- stroke application

function updateHistoryButtons(): void {
  $<HTMLButtonElement>("undo").disabled = !dispatcher.canUndo();
  $<HTMLButtonElement>("redo").disabled = !dispatcher.canRedo();
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
    if (text !== null) {
      log(text);
      setStatus(text);
    }
  } catch (err) {
    log(`Road graph check failed: ${err instanceof Error ? err.message : String(err)}`);
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
  for (const w of res.warnings) log(w);
  if (res.status !== undefined) {
    setStatus(res.status);
    if (res.status === SLOPE_CLAMP_HINT) setHint(SLOPE_CLAMP_HINT);
  } else if (edited) {
    setStatus("Edited.");
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

canvas.addEventListener("pointerdown", (e) => {
  if (e.button !== 0 || !area) return;
  canvas.setPointerCapture(e.pointerId);
  strokeEvent(e, "down");
});
canvas.addEventListener("pointermove", (e) => {
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
  setStatus(kind === "undo" ? "Undid last stroke." : "Redid stroke.");
  updateHistoryButtons();
  if (r.graphChanged || r.lockChanged) refreshRoadLockOverlay();
  if (r.graphChanged) validateRoads();
}

// ---------------------------------------------------------------- tool options

function readNum(id: string, fallback: number): number {
  const v = Number($<HTMLInputElement>(id).value);
  return Number.isFinite(v) ? v : fallback;
}

function syncRoadControls(): void {
  const o = dispatcher.getOptions();
  const preset = ROAD_PRESETS[o.roadPreset];
  $<HTMLInputElement>("opt-width").value = String(o.widthM);
  $("opt-width-v").textContent = `${o.widthM} m`;
  const bank = $<HTMLInputElement>("opt-bank");
  bank.disabled = !(preset.maxBankDeg > 0);
  bank.max = String(preset.maxBankDeg);
  bank.value = String(o.maxBankDeg);
}

function linkNumberAndRange(numId: string, rangeId: string, apply: (v: number) => void): void {
  const num = $<HTMLInputElement>(numId);
  const range = $<HTMLInputElement>(rangeId);
  num.addEventListener("input", () => {
    range.value = num.value;
    apply(readNum(numId, 0));
  });
  range.addEventListener("input", () => {
    num.value = range.value;
    apply(readNum(rangeId, 0));
  });
}

function wireOptions(): void {
  const surf = $<HTMLSelectElement>("opt-surface");
  surf.innerHTML = SURFACE_TYPES.map((s) => `<option value="${s}">${s}</option>`).join("");
  surf.value = dispatcher.getOptions().surface;
  surf.addEventListener("change", () => {
    dispatcher.setOptions({ surface: surf.value as SurfaceType });
    surf.blur();
  });
  linkNumberAndRange("opt-radius", "opt-radius-r", (v) => {
    dispatcher.setOptions({ radiusM: v });
    if (lastHit) paintRing(lastHit);
  });
  linkNumberAndRange("opt-strength", "opt-strength-r", (v) =>
    dispatcher.setOptions({ strength: v }),
  );
  const falloff = $<HTMLSelectElement>("opt-falloff");
  falloff.addEventListener("change", () => {
    dispatcher.setOptions({ falloff: falloff.value === "linear" ? "linear" : "smooth" });
    falloff.blur();
  });
  const preset = $<HTMLSelectElement>("opt-preset");
  preset.addEventListener("change", () => {
    dispatcher.setOptions({ roadPreset: preset.value as RoadPresetId });
    syncRoadControls();
    preset.blur();
  });
  $<HTMLInputElement>("opt-width").addEventListener("input", () => {
    dispatcher.setOptions({ widthM: readNum("opt-width", 8) });
    $("opt-width-v").textContent = `${dispatcher.getOptions().widthM} m`;
  });
  $<HTMLInputElement>("opt-bank").addEventListener("input", () => {
    dispatcher.setOptions({ maxBankDeg: readNum("opt-bank", 0) });
  });
  const kind = $<HTMLSelectElement>("opt-stamp-kind");
  kind.addEventListener("change", () => {
    dispatcher.setOptions({ stampKind: kind.value === "mound" ? "mound" : "wedge" });
    kind.blur();
  });
  $<HTMLInputElement>("opt-stamp-height").addEventListener("input", () =>
    dispatcher.setOptions({ stampHeightM: readNum("opt-stamp-height", 4) }),
  );
  $<HTMLInputElement>("opt-stamp-width").addEventListener("input", () =>
    dispatcher.setOptions({ stampWidthM: readNum("opt-stamp-width", 12) }),
  );
  wireBlockAndSmooth();
  syncRoadControls();
}

/** D-18: the block size label shows metres (N x cell size) for the loaded area. */
function syncBlockLabel(): void {
  const n = dispatcher.getOptions().blockCells;
  const cell = area ? area.grid.cellSizeM : DEFAULT_CELL_SIZE_M;
  const metres = Math.round(n * cell * 100) / 100;
  $("opt-block-cells-v").textContent = `${n} x ${n} (${metres} m)`;
}

function wireBlockAndSmooth(): void {
  const bind = (id: string, apply: (v: number) => void, label: () => void) => {
    $<HTMLInputElement>(id).addEventListener("input", () => {
      apply(readNum(id, 0));
      label();
    });
  };
  bind(
    "opt-block-cells",
    (v) => dispatcher.setOptions({ blockCells: v }),
    () => syncBlockLabel(),
  );
  $<HTMLSelectElement>("opt-block-dir").addEventListener("change", () => {
    dispatcher.setOptions({
      blockDirection: $<HTMLSelectElement>("opt-block-dir").value === "-1" ? -1 : 1,
    });
  });
  bind(
    "opt-block-step",
    (v) => dispatcher.setOptions({ blockStepM: v }),
    () => {
      $("opt-block-step-v").textContent = `${dispatcher.getOptions().blockStepM} m`;
    },
  );
  bind(
    "opt-smooth-strength",
    (v) => dispatcher.setOptions({ smoothStrength: v }),
    () => {
      $("opt-smooth-strength-v").textContent = String(dispatcher.getOptions().smoothStrength);
    },
  );
  bind(
    "opt-smooth-passes",
    (v) => dispatcher.setOptions({ smoothPasses: v }),
    () => {
      $("opt-smooth-passes-v").textContent = String(dispatcher.getOptions().smoothPasses);
    },
  );
  $("smooth-all").addEventListener("click", () => void smoothWholeMap());
  syncBlockLabel();
  wireLockButtons();
}

/** Quick 261110-rdx: Lock tool buttons. Logic lives in the dispatcher; this only wires. */
function wireLockButtons(): void {
  const run = (fn: () => ToolResult): void => {
    if (!area || stroking) return;
    const t0 = performance.now();
    applyResult(fn(), performance.now() - t0);
    updateHistoryButtons();
  };
  $("lock-all").addEventListener("click", () => run(() => dispatcher.lockAll(true)));
  $("unlock-all").addEventListener("click", () => run(() => dispatcher.lockAll(false)));
  $("regrade-selected").addEventListener("click", () => run(() => dispatcher.regradeSelected()));
  $("regrade-all").addEventListener("click", () => run(() => dispatcher.regradeAllUnlocked()));
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
wireOptions();
wireOverlays();

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
    setStatus(text);
    log(text);
    return;
  }
  const url = `/?map=${id}&at=${spot.x.toFixed(1)},${spot.z.toFixed(1)}&debug`;
  const w = window.open(url, "_blank");
  if (!w) log(`Pop-up blocked. Open ${url} manually.`);
}

// ---------------------------------------------------------------- wiring

$("load").addEventListener("click", () => {
  const id = $<HTMLSelectElement>("area").value;
  if (id) void loadArea(id);
});
$("new").addEventListener("click", () => $("new-form").classList.toggle("open"));
$("create").addEventListener("click", () => void createArea());
$("save").addEventListener("click", () => void save());
$("topdown").addEventListener("click", () => setTopDown(!topDown));

$("undo").addEventListener("click", () => undoRedo("undo"));
$("redo").addEventListener("click", () => undoRedo("redo"));
$("drive").addEventListener("click", () => void driveHere());

window.addEventListener("keydown", (e) => {
  const el = document.activeElement;
  const typing =
    (el instanceof HTMLInputElement && (el.type === "text" || el.type === "number")) ||
    el instanceof HTMLTextAreaElement;
  const mod = e.ctrlKey || e.metaKey;
  if (mod && e.code === "KeyS") {
    e.preventDefault();
    void save();
    return;
  }
  if (typing) return;
  if (mod && e.code === "KeyZ") {
    e.preventDefault();
    undoRedo(e.shiftKey ? "redo" : "undo");
    return;
  }
  if (mod && e.code === "KeyY") {
    e.preventDefault();
    undoRedo("redo");
    return;
  }
  if (mod || e.altKey) return;
  if (e.code === "Escape" && dispatcher.cancelBoxDrag()) {
    stroking = false;
    clearBoxOutline();
    if (lastHit) paintRing(lastHit);
    setStatus("Smooth area cancelled.");
    return;
  }
  if (e.code === "KeyT") {
    setTopDown(!topDown);
    return;
  }
  if (e.code === "KeyX") {
    toggleOverlay("opt-grid");
    return;
  }
  if (e.code === "KeyC") {
    toggleOverlay("opt-contours");
    return;
  }
  if (e.code === "KeyD") {
    void driveHere();
    return;
  }
  if (e.code === "BracketLeft" || e.code === "BracketRight") {
    dispatcher.rotateStamp(e.code === "BracketRight" ? 1 : -1);
    const deg = Math.round((dispatcher.getOptions().stampRotationRad * 180) / Math.PI);
    setStatus(`Stamp rotation ${deg} degrees.`);
    return;
  }
  const next = TOOL_KEYS[e.code];
  if (next) selectTool(next);
});

window.addEventListener("beforeunload", (e) => {
  if (dirty) e.preventDefault();
});

// Legend
$("legend").innerHTML = SURFACE_TYPES.map(
  (s) =>
    `<span><i class="sw" style="background:#${TERRAIN_SURFACE_PALETTE[s].toString(16).padStart(6, "0")}"></i>${s}</span>`,
).join("");

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
setHint(DEFAULT_HINT);
setStatus("Pick an area or press New...");
refreshAreaList().catch((err) => {
  log(`Cannot list areas: ${err instanceof Error ? err.message : String(err)}`);
});
requestAnimationFrame(frame);
