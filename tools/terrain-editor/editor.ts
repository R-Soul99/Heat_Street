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
import {
  encodeTerrainBinary,
  loadTerrainArea,
  serializeTerrainSidecar,
  type TerrainArea,
} from "../../src/core/terrain-format.ts";
import { sampleTerrainHeight, terrainTriangleNormal } from "../../src/core/terrain-grid.ts";
import { DEFAULT_CELL_SIZE_M, MAX_AREA_SIZE_M } from "../../src/core/terrain-limits.ts";
import { surfaceAt } from "../../src/core/terrain-paint.ts";
import { raycastTerrain } from "../../src/core/terrain-pick.ts";
import { ROAD_PRESETS, type RoadPresetId } from "../../src/core/terrain-road.ts";
import type { CellWindow } from "../../src/core/terrain-slope.ts";
import {
  buildTerrainView,
  TERRAIN_SURFACE_PALETTE,
  type TerrainView,
} from "../../src/render/terrain-view.ts";
import { formatValidationFailures, validateGraph } from "../map-compiler/validate/validator.ts";
import { createEmptyTerrainArea } from "./new-area.ts";
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
const DEFAULT_HINT = "Left-drag to sculpt. Right-drag to orbit, middle-drag to pan, wheel to zoom.";
const CURSOR_RADIUS_M = 8;
const RING_SEGMENTS = 64;

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
controls.mouseButtons = {
  LEFT: null,
  MIDDLE: THREE.MOUSE.PAN,
  RIGHT: THREE.MOUSE.ROTATE,
} as unknown as typeof controls.mouseButtons;
controls.enableDamping = false;
controls.maxPolarAngle = Math.PI / 2 - 0.02;
canvas.addEventListener("contextmenu", (e) => e.preventDefault());

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

function setStatus(text: string): void {
  const name = area ? area.areaId : "no area";
  const marker = dirty ? ' <span class="dirty">unsaved</span>' : "";
  $("status").innerHTML = `${name}${marker}<br>${text}`;
}

function setHint(text: string): void {
  $("hint").textContent = text;
}

function setDirty(value: boolean): void {
  dirty = value;
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
  if (!area) return false;
  try {
    const bin = await encodeTerrainBinary(area);
    await api(`/__terrain/${area.areaId}/bin`, { method: "PUT", body: bin as BodyInit });
    await api(`/__terrain/${area.areaId}/json`, {
      method: "PUT",
      body: serializeTerrainSidecar(area),
    });
    setDirty(false);
    const kb = Math.round(bin.length / 1024);
    setStatus(`Saved ${area.areaId} v1, ${kb} KB`);
    log(`saved ${area.areaId} (${kb} KB)`);
    await refreshAreaList(area.areaId);
    return true;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const text = `Save failed: ${msg}. Your edits are still in memory; fix the problem and press Save terrain again.`;
    setStatus(text);
    log(text);
    return false;
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
  return tool === "road" || tool === "stamp" ? CURSOR_RADIUS_M : dispatcher.getOptions().radiusM;
}

function paintRing(hit: { x: number; z: number }): void {
  if (!area) return;
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
    slopeAmber ? RING_AMBER : RING_GREEN,
  );
  cursorRing.visible = true;
}

function updateCursor(clientX: number, clientY: number): void {
  if (!area) return;
  const hit = pickTerrain(clientX, clientY);
  if (!hit) {
    cursorRing.visible = false;
    lastHit = null;
    $("sel").textContent = "Cursor is off the terrain.";
    return;
  }
  lastHit = { x: hit.x, z: hit.z };
  paintRing(hit);

  terrainTriangleNormal(area.grid, hit.x, hit.z, normalScratch);
  const slopeDeg = (Math.acos(Math.min(1, normalScratch.y)) * 180) / Math.PI;
  const g = area.grid;
  $("sel").textContent = [
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
    const hard = failures.filter((f) => f.category !== "UNDIRECTED_REACHABILITY");
    if (reach.length > 0) {
      log(`info: ${reach.length} disconnected road piece(s); fine while the map is mid-build.`);
    }
    if (hard.length > 0) {
      const text = `Road graph invalid: ${formatValidationFailures(hard)}. Undo the last stroke or erase the road and repaint.`;
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
  const edited = res.dirtyHeights !== undefined || res.dirtyPaint !== undefined || res.graphChanged;
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
    res = dispatcher.pointerDown(hit.x, hit.z, { alt: e.altKey });
  } else if (phase === "move") {
    if (!hit) return;
    res = dispatcher.pointerMove(hit.x, hit.z, { alt: e.altKey });
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
  if (!stroking) cursorRing.visible = false;
});

function undoRedo(kind: "undo" | "redo"): void {
  if (!area || stroking) return;
  const t0 = performance.now();
  const r = kind === "undo" ? dispatcher.undo() : dispatcher.redo();
  if (!r) return;
  rebuild(r.dirtyHeights, { heights: true });
  rebuild(r.dirtyPaint, { paint: true });
  setDirty(true);
  lastEditMs = performance.now() - t0;
  setStatus(kind === "undo" ? "Undid last stroke." : "Redid stroke.");
  updateHistoryButtons();
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
  syncRoadControls();
}
wireOptions();

// ---------------------------------------------------------------- drive here

async function driveHere(): Promise<void> {
  if (!area) return;
  const id = area.areaId;
  const terrainIds = (KNOWN_MAP_IDS as readonly string[]).filter(
    (m) => MAP_FORMATS[m as MapId] === "terrain",
  );
  if (!terrainIds.includes(id)) {
    const text = `Drive here needs a registered terrain map id (${terrainIds.join(", ")}).`;
    setStatus(text);
    log(text);
    return;
  }
  const spot = lastHit ?? { x: controls.target.x, z: controls.target.z };
  if (!(await save())) return;
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
  if (e.code === "KeyT") {
    setTopDown(!topDown);
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
