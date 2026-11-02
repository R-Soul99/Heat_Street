/**
 * Dev-only 3D terrain sculpt page (D-09). This module is the shell: scene,
 * orbit / top-down camera, terrain picking, area list / new / load / save via
 * the `/__terrain/*` middleware, cursor ring and readouts. Brush behaviour is
 * wired in a later plan; here the tool buttons only track the active tool.
 */
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { SURFACE_TYPES } from "../../src/core/surface-types.ts";
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
import {
  buildTerrainView,
  TERRAIN_SURFACE_PALETTE,
  type TerrainView,
} from "../../src/render/terrain-view.ts";
import { createEmptyTerrainArea } from "./new-area.ts";

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const canvas = $<HTMLCanvasElement>("view");
const wrap = $("wrap");

const NAME_RE = /^[a-z0-9-]{1,64}$/;
const DEFAULT_HINT = "Left-drag to sculpt. Right-drag to orbit, middle-drag to pan, wheel to zoom.";
const CURSOR_RADIUS_M = 8;
const RING_SEGMENTS = 64;

type Tool = "raise" | "smooth" | "flatten" | "paint" | "road" | "stamp" | "erase";
const TOOL_KEYS: Record<string, Tool> = {
  h: "raise",
  g: "smooth",
  f: "flatten",
  p: "paint",
  r: "road",
  w: "stamp",
  e: "erase",
};

// ---------------------------------------------------------------- state

let area: TerrainArea | null = null;
let terrainView: TerrainView | null = null;
let dirty = false;
let tool: Tool = "raise";
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
const cursorRing = new THREE.LineLoop(
  ringGeometry,
  new THREE.LineBasicMaterial({ color: 0x66cc99, depthTest: false, transparent: true }),
);
cursorRing.renderOrder = 999;
cursorRing.frustumCulled = false;
cursorRing.visible = false;
scene.add(cursorRing);

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

async function save(): Promise<void> {
  if (!area) return;
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
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const text = `Save failed: ${msg}. Your edits are still in memory; fix the problem and press Save terrain again.`;
    setStatus(text);
    log(text);
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

function selectTool(next: Tool): void {
  tool = next;
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

function updateCursor(clientX: number, clientY: number): void {
  if (!area) return;
  const rect = canvas.getBoundingClientRect();
  ndc.set(
    ((clientX - rect.left) / rect.width) * 2 - 1,
    -((clientY - rect.top) / rect.height) * 2 + 1,
  );
  raycaster.setFromCamera(ndc, camera);
  const r = raycaster.ray;
  const hit = raycastTerrain(area.grid, r.origin, r.direction, camera.far * 2);
  if (!hit) {
    cursorRing.visible = false;
    $("sel").textContent = "Cursor is off the terrain.";
    return;
  }
  const pos = ringGeometry.getAttribute("position") as THREE.BufferAttribute;
  for (let i = 0; i < RING_SEGMENTS; i++) {
    const ang = (i / RING_SEGMENTS) * Math.PI * 2;
    const px = hit.x + Math.cos(ang) * CURSOR_RADIUS_M;
    const pz = hit.z + Math.sin(ang) * CURSOR_RADIUS_M;
    pos.setXYZ(i, px, sampleTerrainHeight(area.grid, px, pz) + 0.15, pz);
  }
  pos.needsUpdate = true;
  cursorRing.visible = true;

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

canvas.addEventListener("pointermove", (e) => updateCursor(e.clientX, e.clientY));
canvas.addEventListener("pointerleave", () => {
  cursorRing.visible = false;
});

// ---------------------------------------------------------------- wiring

$("load").addEventListener("click", () => {
  const id = $<HTMLSelectElement>("area").value;
  if (id) void loadArea(id);
});
$("new").addEventListener("click", () => $("new-form").classList.toggle("open"));
$("create").addEventListener("click", () => void createArea());
$("save").addEventListener("click", () => void save());
$("topdown").addEventListener("click", () => setTopDown(!topDown));

window.addEventListener("keydown", (e) => {
  const el = document.activeElement;
  const typing =
    el instanceof HTMLInputElement ||
    el instanceof HTMLSelectElement ||
    el instanceof HTMLTextAreaElement;
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
    e.preventDefault();
    void save();
    return;
  }
  if (typing || e.ctrlKey || e.metaKey || e.altKey) return;
  const key = e.key.toLowerCase();
  if (key === "t") {
    setTopDown(!topDown);
    return;
  }
  const next = TOOL_KEYS[key];
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
setHint(DEFAULT_HINT);
setStatus("Pick an area or press New...");
refreshAreaList().catch((err) => {
  log(`Cannot list areas: ${err instanceof Error ? err.message : String(err)}`);
});
requestAnimationFrame(frame);
