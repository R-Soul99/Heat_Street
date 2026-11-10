/**
 * Dev-only top-down map editor. Loads/saves the compiler's raw-OSM files via the
 * `/__editor/*` dev middleware (`vite-plugin.ts`), so it edits imported and
 * synthetic areas alike. Slice 1: view, pick, edit tags (highway / surface /
 * width / name / oneway / building height), delete, undo, save, save & compile.
 *
 * NOTE: re-running an importer or generator overwrites the raw files and loses
 * hand edits made here.
 */
import {
  appendImportedRoads,
  COARSE_M_PER_PX,
  DEFAULT_IMPORT_ROAD,
  footprintWarnings,
  type ImportRoadOptions,
  type ImportScale,
  importScale,
  pixelToWorld,
} from "./image-import.ts";
import {
  DEFAULT_TRACE_OPTIONS,
  imageToRoadGraph,
  type RoadGraphPx,
  type TraceOptions,
} from "./image-trace.ts";
import {
  addBuildingRect,
  addRoad,
  effectiveSurface,
  HIGHWAY_CLASSES,
  moveNode,
  type Projector,
  pickBuilding,
  pickNode,
  pickRoad,
  type RawEnvelope,
  type RawWay,
  type Snap,
  SURFACES,
  type Surface,
  setSurface,
  setTag,
  snapPoint,
} from "./model.ts";
import {
  DEFAULT_TILE_M,
  fitView,
  gridStep,
  scaleBar,
  TILE_SIZES_M,
  tileLines,
  type View,
  visibleRect,
  type World,
  worldFromBbox,
  zoomAt,
} from "./world.ts";

const SURFACE_COLOUR: Record<Surface, string> = {
  tarmac: "#8d939c",
  gravel: "#c9b27a",
  dirt_road: "#a8743f",
  grass: "#5da04a",
  sand: "#e6d58a",
  mud: "#5b4330",
};
const DEFAULT_WIDTH_M = 7;

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const canvas = $<HTMLCanvasElement>("map");
const ctx = canvas.getContext("2d") as CanvasRenderingContext2D;

let area = "";
let roads: RawEnvelope;
let buildings: RawEnvelope;
let proj: Projector;
let world: World;
let tileM: number = DEFAULT_TILE_M;
let showGrid = true;
let showTiles = true;
let dirty = false;
let selected: { kind: "road" | "building"; way: RawWay } | undefined;
const undoStack: string[] = [];

type Tool = "select" | "road" | "move" | "building";
let tool: Tool = "select";
let roadPoints: Snap[] = [];
let hover: { x: number; y: number } | undefined;
let movingNode: number | undefined;
let rectStart: { x: number; y: number } | undefined;
let drawHighway = "residential";
let drawSurface = "";
let drawWidth = 5;
let buildingHeight = 8;
const HINTS: Record<Tool, string> = {
  select: "Click a road or building to edit it. Drag to pan. F fits the world, arrows pan.",
  road: "Click to add points; double-click or Enter to finish, Esc to cancel. Clicking on an existing road or node connects to it.",
  move: "Drag a road node to move it (shared by every road that meets there).",
  building: "Click and drag a rectangle to add a building.",
};

// view: world metres -> screen px (scale = px per metre; screen y down, world y up)
let scale = 0.25;
let panX = 0;
let panY = 0;
let fitScale = 0.25;
const MAX_SCALE = 20;
const currentView = (): View => ({ scale, panX, panY });
function setView(v: View): void {
  scale = v.scale;
  panX = v.panX;
  panY = v.panY;
}
function fitWorld(): void {
  const v = fitView(world.widthM, world.heightM, canvas.width, canvas.height, 40);
  fitScale = v.scale;
  setView(v);
}

// Projected-point cache for culling; invalidated by bumping geometryVersion.
interface LocalWay {
  pts: { x: number; y: number }[];
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}
let geometryVersion = 0;
let cacheVersion = -1;
let localCache = new WeakMap<RawWay, LocalWay>();
function localWay(way: RawWay): LocalWay {
  if (cacheVersion !== geometryVersion) {
    localCache = new WeakMap();
    cacheVersion = geometryVersion;
  }
  let lw = localCache.get(way);
  if (lw === undefined) {
    const pts = way.geometry.map((g) => proj.toLocal(g));
    lw = {
      pts,
      minX: Math.min(...pts.map((p) => p.x)),
      maxX: Math.max(...pts.map((p) => p.x)),
      minY: Math.min(...pts.map((p) => p.y)),
      maxY: Math.max(...pts.map((p) => p.y)),
    };
    localCache.set(way, lw);
  }
  return lw;
}

let drawQueued = false;
function requestDraw(): void {
  if (drawQueued) return;
  drawQueued = true;
  requestAnimationFrame(() => {
    drawQueued = false;
    if (roads !== undefined) draw();
  });
}

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) throw new Error(`${url}: ${res.status} ${await res.text()}`);
  return (await res.json()) as T;
}

function setStatus(text: string): void {
  $("status").innerHTML = `${area}: ${roads.response.elements.length} roads, ${
    buildings.response.elements.length
  } buildings ${dirty ? '<span class="dirty">● unsaved</span>' : ""}<br>${text}`;
}

function snapshot(): void {
  undoStack.push(JSON.stringify([roads, buildings]));
  if (undoStack.length > 100) undoStack.shift();
  dirty = true;
  geometryVersion++;
}

function undo(): void {
  const prev = undoStack.pop();
  if (prev === undefined) return;
  [roads, buildings] = JSON.parse(prev) as [RawEnvelope, RawEnvelope];
  selected = undefined;
  dirty = true;
  geometryVersion++;
  refresh("undone");
}

async function loadArea(id: string): Promise<void> {
  area = id;
  roads = await api<RawEnvelope>(`/__editor/raw/${id}/roads`);
  buildings = await api<RawEnvelope>(`/__editor/raw/${id}/buildings`);
  world = worldFromBbox(roads.bbox);
  proj = world.projector;
  undoStack.length = 0;
  dirty = false;
  selected = undefined;
  geometryVersion++;
  clearImport();
  fitWorld();
  refresh("loaded");
}

async function save(): Promise<void> {
  const put = (kind: string, body: RawEnvelope) =>
    api(`/__editor/raw/${area}/${kind}`, { method: "PUT", body: JSON.stringify(body) });
  await put("roads", roads);
  await put("buildings", buildings);
  dirty = false;
  refresh("saved");
}

async function compile(): Promise<void> {
  await save();
  $("log").textContent = "compiling…";
  const res = await fetch(`/__editor/compile/${area}`, { method: "POST" });
  $("log").textContent = await res.text();
  setStatus("compile finished — reload the game tab to see it");
}

const toScreen = (p: { x: number; y: number }) => ({
  x: panX + p.x * scale,
  y: panY - p.y * scale,
});
const toWorld = (sx: number, sy: number) => ({ x: (sx - panX) / scale, y: (panY - sy) / scale });

function line(x1: number, y1: number, x2: number, y2: number): void {
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
}

function drawGrid(vis: ReturnType<typeof visibleRect>): void {
  const minor = gridStep(scale, 24);
  const major = gridStep(scale, minor * scale * 2.5);
  const x0 = Math.max(0, vis.minX);
  const x1 = Math.min(world.widthM, vis.maxX);
  const y0 = Math.max(0, vis.minY);
  const y1 = Math.min(world.heightM, vis.maxY);
  const a = toScreen({ x: x0, y: y1 });
  const b = toScreen({ x: x1, y: y0 });
  for (const [step, colour] of [
    [minor, "rgba(255,255,255,0.05)"],
    [major, "rgba(255,255,255,0.12)"],
  ] as const) {
    ctx.beginPath();
    for (let x = Math.ceil(x0 / step) * step; x <= x1; x += step) {
      const sx = toScreen({ x, y: 0 }).x;
      line(sx, a.y, sx, b.y);
    }
    for (let y = Math.ceil(y0 / step) * step; y <= y1; y += step) {
      const sy = toScreen({ x: 0, y }).y;
      line(a.x, sy, b.x, sy);
    }
    ctx.strokeStyle = colour;
    ctx.lineWidth = 1;
    ctx.stroke();
  }
}

function drawTiles(vis: ReturnType<typeof visibleRect>): void {
  const { xs, ys } = tileLines(world.widthM, world.heightM, tileM);
  const top = toScreen({ x: 0, y: world.heightM }).y;
  const bottom = toScreen({ x: 0, y: 0 }).y;
  const left = toScreen({ x: 0, y: 0 }).x;
  const right = toScreen({ x: world.widthM, y: 0 }).x;
  ctx.beginPath();
  for (const x of xs) {
    if (x < vis.minX || x > vis.maxX) continue;
    const sx = toScreen({ x, y: 0 }).x;
    line(sx, top, sx, bottom);
  }
  for (const y of ys) {
    if (y < vis.minY || y > vis.maxY) continue;
    const sy = toScreen({ x: 0, y }).y;
    line(left, sy, right, sy);
  }
  ctx.setLineDash([8, 6]);
  ctx.strokeStyle = "rgba(240,170,40,0.7)";
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.setLineDash([]);
  if (tileM * scale < 60) return;
  ctx.fillStyle = "rgba(240,170,40,0.8)";
  ctx.font = "11px system-ui, sans-serif";
  ctx.textBaseline = "top";
  ctx.textAlign = "left";
  const rows = ys.length - 1;
  for (let c = 0; c + 1 < xs.length; c++) {
    for (let r = 0; r < rows; r++) {
      // Row 0 is the northernmost row; the label sits at the tile's top-left.
      const x = xs[c] as number;
      const y = ys[rows - r] as number;
      if (x > vis.maxX || y < vis.minY || x + tileM < vis.minX || y - tileM > vis.maxY) continue;
      const sp = toScreen({ x, y });
      ctx.fillText(`${c},${r}`, sp.x + 4, sp.y + 4);
    }
  }
}

function drawHud(): void {
  const bar = scaleBar(scale, 160);
  const bx = 16;
  const by = canvas.height - 20;
  ctx.strokeStyle = "#fff";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(bx, by - 5);
  ctx.lineTo(bx, by);
  ctx.lineTo(bx + bar.px, by);
  ctx.lineTo(bx + bar.px, by - 5);
  ctx.stroke();
  ctx.fillStyle = "#fff";
  ctx.font = "12px system-ui, sans-serif";
  ctx.textAlign = "left";
  ctx.textBaseline = "bottom";
  ctx.fillText(bar.label, bx, by - 8);
  const lines = [
    hover === undefined ? "x -, y -" : `x ${Math.round(hover.x)} m, y ${Math.round(hover.y)} m`,
    `${(world.widthM / 1000).toFixed(2)} x ${(world.heightM / 1000).toFixed(2)} km`,
    `tile ${tileM} m`,
  ];
  ctx.textAlign = "right";
  lines.forEach((t, i) => {
    ctx.fillText(t, canvas.width - 12, canvas.height - 10 - (lines.length - 1 - i) * 15);
  });
}

function draw(): void {
  const vis = visibleRect(currentView(), canvas.width, canvas.height);
  ctx.fillStyle = "#0b0c0f";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const wTL = toScreen({ x: 0, y: world.heightM });
  const wBR = toScreen({ x: world.widthM, y: 0 });
  ctx.fillStyle = "#14161a";
  ctx.fillRect(wTL.x, wTL.y, wBR.x - wTL.x, wBR.y - wTL.y);
  if (showGrid) drawGrid(vis);
  ctx.strokeStyle = "#667";
  ctx.lineWidth = 1.5;
  ctx.strokeRect(wTL.x, wTL.y, wBR.x - wTL.x, wBR.y - wTL.y);
  if (showTiles) drawTiles(vis);
  drawImportOverlay();
  const visible = (lw: LocalWay, padM: number) =>
    lw.maxX + padM >= vis.minX &&
    lw.minX - padM <= vis.maxX &&
    lw.maxY + padM >= vis.minY &&
    lw.minY - padM <= vis.maxY;
  const trace = (lw: LocalWay) => {
    ctx.beginPath();
    lw.pts.forEach((p, i) => {
      const s = toScreen(p);
      if (i === 0) ctx.moveTo(s.x, s.y);
      else ctx.lineTo(s.x, s.y);
    });
  };
  for (const b of buildings.response.elements) {
    const lw = localWay(b);
    if (!visible(lw, 0)) continue;
    trace(lw);
    ctx.closePath();
    ctx.fillStyle = b === selected?.way ? "#ff6" : "#4a3f3a";
    ctx.fill();
  }
  const drawRoad = (way: RawWay, lw: LocalWay, colour: string, extra: number) => {
    const w = Number.parseFloat(way.tags?.width ?? "") || DEFAULT_WIDTH_M;
    trace(lw);
    ctx.strokeStyle = colour;
    ctx.lineWidth = Math.max(1.5, w * scale) + extra;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.stroke();
  };
  for (const way of roads.response.elements) {
    const lw = localWay(way);
    if (!visible(lw, DEFAULT_WIDTH_M + 20)) continue;
    if (way === selected?.way) drawRoad(way, lw, "#ff6", 4);
    drawRoad(way, lw, SURFACE_COLOUR[effectiveSurface(way.tags)], 0);
  }
  if (tool === "road" || tool === "move") {
    ctx.fillStyle = "#fff";
    for (const way of roads.response.elements) {
      const lw = localWay(way);
      if (!visible(lw, 0)) continue;
      lw.pts.forEach((p, i) => {
        const end = i === 0 || i === lw.pts.length - 1;
        if (!end && tool !== "move") return;
        const sp = toScreen(p);
        ctx.fillRect(sp.x - 2, sp.y - 2, 4, 4);
      });
    }
  }
  drawImportPreview();
  if (tool === "road" && roadPoints.length > 0) {
    ctx.beginPath();
    roadPoints.forEach((pt, i) => {
      const sp = toScreen(proj.toLocal(pt.at));
      if (i === 0) ctx.moveTo(sp.x, sp.y);
      else ctx.lineTo(sp.x, sp.y);
    });
    if (hover !== undefined) {
      const sp = toScreen(hover);
      ctx.lineTo(sp.x, sp.y);
    }
    ctx.strokeStyle = "#4df";
    ctx.lineWidth = Math.max(2, drawWidth * scale);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.stroke();
  }
  if (tool === "building" && rectStart !== undefined && hover !== undefined) {
    const a = toScreen(rectStart);
    const b = toScreen(hover);
    ctx.fillStyle = "rgba(255,220,120,0.5)";
    ctx.fillRect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(a.x - b.x), Math.abs(a.y - b.y));
  }
  drawHud();
}

function setTool(next: Tool): void {
  tool = next;
  roadPoints = [];
  rectStart = undefined;
  movingNode = undefined;
  for (const b of document.querySelectorAll<HTMLElement>(".tool")) {
    b.classList.toggle("active", b.dataset.tool === next);
  }
  $("hint").textContent = HINTS[next];
  const opts = $("tool-opts");
  if (next === "road") {
    opts.innerHTML =
      field(
        "highway",
        `<select id="o-highway">${HIGHWAY_CLASSES.map((h) => `<option ${h === drawHighway ? "selected" : ""}>${h}</option>`).join("")}</select>`,
      ) +
      field(
        "surface",
        `<select id="o-surface"><option value="">(auto)</option>${SURFACES.map((x) => `<option ${x === drawSurface ? "selected" : ""}>${x}</option>`).join("")}</select>`,
      ) +
      field(
        "width (m)",
        `<input type="number" id="o-width" min="2" step="0.5" value="${drawWidth}">`,
      );
    $<HTMLSelectElement>("o-highway").onchange = (e) =>
      (drawHighway = (e.target as HTMLSelectElement).value);
    $<HTMLSelectElement>("o-surface").onchange = (e) =>
      (drawSurface = (e.target as HTMLSelectElement).value);
    $<HTMLInputElement>("o-width").onchange = (e) =>
      (drawWidth = Number((e.target as HTMLInputElement).value) || 5);
  } else if (next === "building") {
    opts.innerHTML = field(
      "height (m)",
      `<input type="number" id="o-height" min="2" step="1" value="${buildingHeight}">`,
    );
    $<HTMLInputElement>("o-height").onchange = (e) =>
      (buildingHeight = Number((e.target as HTMLInputElement).value) || 8);
  } else opts.innerHTML = "";
  if (roads !== undefined) requestDraw();
}

function finishRoad(): void {
  if (roadPoints.length >= 2) {
    snapshot();
    const tags: Record<string, string> = { highway: drawHighway, width: String(drawWidth) };
    const way = addRoad(roads, proj, roadPoints, tags);
    if (way !== undefined && drawSurface !== "") setSurface(way, drawSurface as Surface);
    selected = way ? { kind: "road", way } : undefined;
    refresh("road added");
  }
  roadPoints = [];
  requestDraw();
}

function field(label: string, control: string): string {
  return `<label>${label}</label>${control}`;
}

function renderSelection(): void {
  const box = $("sel");
  if (selected === undefined) {
    box.textContent = "Click a road or building. Drag to pan, wheel to zoom, F to fit the world.";
    return;
  }
  const { kind, way } = selected;
  const t = way.tags ?? {};
  if (kind === "road") {
    const opts = (vals: readonly string[], cur: string) =>
      vals.map((v) => `<option ${v === cur ? "selected" : ""}>${v}</option>`).join("");
    const surfaceOpts =
      `<option value="">(auto from highway)</option>` +
      SURFACES.map(
        (s) =>
          `<option value="${s}" ${t.surface !== undefined && effectiveSurface(t) === s ? "selected" : ""}>${s}</option>`,
      ).join("");
    box.innerHTML =
      `<b>Road</b> way ${way.id} (${way.geometry.length} pts)` +
      field(
        "highway",
        `<select id="f-highway">${opts(HIGHWAY_CLASSES, t.highway ?? "")}</select>`,
      ) +
      field("surface", `<select id="f-surface">${surfaceOpts}</select>`) +
      field(
        "width (m)",
        `<input type="number" step="0.5" min="2" id="f-width" value="${t.width ?? ""}">`,
      ) +
      field("name", `<input type="text" id="f-name" value="${t.name ?? ""}">`) +
      field(
        "one-way",
        `<input type="checkbox" id="f-oneway" ${t.oneway === "yes" ? "checked" : ""}>`,
      ) +
      `<button class="danger" id="f-delete">Delete road (Del)</button>`;
    const edit = (fn: () => void) => {
      snapshot();
      fn();
      refresh("edited");
    };
    $<HTMLSelectElement>("f-highway").onchange = (e) =>
      edit(() => setTag(way, "highway", (e.target as HTMLSelectElement).value));
    $<HTMLSelectElement>("f-surface").onchange = (e) =>
      edit(() => {
        const v = (e.target as HTMLSelectElement).value;
        setSurface(way, v === "" ? null : (v as Surface));
      });
    $<HTMLInputElement>("f-width").onchange = (e) =>
      edit(() => setTag(way, "width", (e.target as HTMLInputElement).value));
    $<HTMLInputElement>("f-name").onchange = (e) =>
      edit(() => setTag(way, "name", (e.target as HTMLInputElement).value));
    $<HTMLInputElement>("f-oneway").onchange = (e) =>
      edit(() => setTag(way, "oneway", (e.target as HTMLInputElement).checked ? "yes" : null));
  } else {
    box.innerHTML =
      `<b>Building</b> ${way.id}` +
      field(
        "height (m)",
        `<input type="number" step="0.5" min="1" id="f-height" value="${t.height ?? ""}">`,
      ) +
      `<button class="danger" id="f-delete">Delete building (Del)</button>`;
    $<HTMLInputElement>("f-height").onchange = (e) => {
      snapshot();
      setTag(way, "height", (e.target as HTMLInputElement).value);
      refresh("edited");
    };
  }
  $("f-delete").onclick = deleteSelected;
}

function deleteSelected(): void {
  if (selected === undefined) return;
  snapshot();
  const env = selected.kind === "road" ? roads : buildings;
  env.response.elements = env.response.elements.filter((w) => w !== selected?.way);
  selected = undefined;
  refresh("deleted");
}

function refresh(message: string): void {
  requestDraw();
  renderSelection();
  setStatus(message);
}

// --- interaction ---
let dragging: { x: number; y: number; moved: boolean; pan: boolean } | undefined;
const worldOf = (e: MouseEvent) => {
  const rect = canvas.getBoundingClientRect();
  return toWorld(e.clientX - rect.left, e.clientY - rect.top);
};
const snapTol = () => Math.max(3, 10 / scale);

canvas.addEventListener("contextmenu", (e) => e.preventDefault());
canvas.addEventListener("mousedown", (e) => {
  const wantsPan = e.button !== 0 || tool === "select";
  dragging = { x: e.clientX, y: e.clientY, moved: false, pan: wantsPan };
  if (e.button === 0 && tool === "move") {
    const n = pickNode(worldOf(e), roads, proj, snapTol());
    if (n !== undefined) {
      snapshot();
      movingNode = n.nodeId;
      dragging.pan = false;
    } else dragging.pan = true;
  } else if (e.button === 0 && tool === "building") rectStart = worldOf(e);
});
window.addEventListener("mousemove", (e) => {
  if (e.target === canvas) {
    hover = worldOf(e);
    requestDraw();
  }
  if (dragging === undefined) return;
  const dx = e.clientX - dragging.x;
  const dy = e.clientY - dragging.y;
  if (Math.abs(dx) + Math.abs(dy) > 3) dragging.moved = true;
  if (!dragging.moved) return;
  if (dragging.pan) {
    panX += dx;
    panY += dy;
    dragging.x = e.clientX;
    dragging.y = e.clientY;
  } else if (movingNode !== undefined) {
    moveNode(roads, movingNode, proj.toLatLon(worldOf(e)));
    geometryVersion++;
  }
  requestDraw();
});
window.addEventListener("mouseup", (e) => {
  const d = dragging;
  dragging = undefined;
  if (d === undefined || e.button !== 0) return;
  if (movingNode !== undefined) {
    movingNode = undefined;
    dirty = true;
    refresh(d.moved ? "node moved" : "");
    return;
  }
  if (tool === "building" && rectStart !== undefined) {
    const a = rectStart;
    const b = worldOf(e);
    rectStart = undefined;
    if (Math.abs(a.x - b.x) > 3 && Math.abs(a.y - b.y) > 3) {
      snapshot();
      const way = addBuildingRect(buildings, proj.toLatLon(a), proj.toLatLon(b), buildingHeight);
      selected = { kind: "building", way };
      refresh("building added");
    } else requestDraw();
    return;
  }
  if (d.moved || e.target !== canvas) return;
  const p = worldOf(e);
  if (tool === "road") {
    roadPoints.push(snapPoint(p, roads, proj, snapTol()));
    requestDraw();
    return;
  }
  if (tool !== "select") return;
  const road = pickRoad(p, roads.response.elements, proj, Math.max(3, 8 / scale));
  const building = road ? undefined : pickBuilding(p, buildings.response.elements, proj);
  selected = road
    ? { kind: "road", way: road }
    : building
      ? { kind: "building", way: building }
      : undefined;
  refresh(selected ? "selected" : "nothing here");
});
canvas.addEventListener("dblclick", () => {
  if (tool !== "road") return;
  // The two clicks of the double-click each added a point; drop the duplicate.
  roadPoints.pop();
  finishRoad();
});
canvas.addEventListener(
  "wheel",
  (e) => {
    e.preventDefault();
    const rect = canvas.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? canvas.height : 1;
    const factor = Math.exp(-e.deltaY * unit * 0.0015);
    setView(zoomAt(currentView(), factor, sx, sy, fitScale / 4, MAX_SCALE));
    requestDraw();
  },
  { passive: false },
);
window.addEventListener("keydown", (e) => {
  const typing =
    (e.target as HTMLElement).tagName === "INPUT" || (e.target as HTMLElement).tagName === "SELECT";
  if (typing) return;
  if (e.key === "Delete" || e.key === "Backspace") deleteSelected();
  else if (e.key === "Enter" && tool === "road") finishRoad();
  else if (e.key === "Escape") {
    roadPoints = [];
    rectStart = undefined;
    requestDraw();
  } else if (e.key === "f" || e.key === "F") {
    fitWorld();
    requestDraw();
  } else if (e.key.startsWith("Arrow")) {
    e.preventDefault();
    if (e.key === "ArrowLeft") panX += canvas.width / 4;
    else if (e.key === "ArrowRight") panX -= canvas.width / 4;
    else if (e.key === "ArrowUp") panY += canvas.height / 4;
    else panY -= canvas.height / 4;
    requestDraw();
  } else if (e.key === "v" || e.key === "V") setTool("select");
  else if (e.key === "r" || e.key === "R") setTool("road");
  else if (e.key === "m" || e.key === "M") setTool("move");
  else if (e.key === "b" || e.key === "B") setTool("building");
  else if (e.key === "z" || e.key === "Z") undo();
  else if (e.key === "s" || e.key === "S") void save();
});
window.addEventListener("beforeunload", (e) => {
  if (dirty) e.preventDefault();
});

function resize(): void {
  canvas.width = canvas.clientWidth;
  canvas.height = canvas.clientHeight;
  if (roads !== undefined) requestDraw();
}
window.addEventListener("resize", resize);

const tileSelect = $<HTMLSelectElement>("tile-size");
tileSelect.innerHTML = TILE_SIZES_M.map(
  (m) => `<option value="${m}" ${m === tileM ? "selected" : ""}>${m} m</option>`,
).join("");
tileSelect.onchange = () => {
  tileM = Number(tileSelect.value) || DEFAULT_TILE_M;
  requestDraw();
};
$<HTMLInputElement>("show-grid").onchange = (e) => {
  showGrid = (e.target as HTMLInputElement).checked;
  requestDraw();
};
$<HTMLInputElement>("show-tiles").onchange = (e) => {
  showTiles = (e.target as HTMLInputElement).checked;
  requestDraw();
};
$("save").onclick = () => void save();
$("compile").onclick = () => void compile();
$("undo").onclick = undo;
$("drive").onclick = () => {
  const tab = window.open("about:blank", "_blank");
  void compile().then(() => {
    if (tab !== null) tab.location.href = `/?map=${encodeURIComponent(area)}`;
  });
};
for (const b of document.querySelectorAll<HTMLElement>(".tool")) {
  b.onclick = () => setTool(b.dataset.tool as Tool);
}
$("legend").innerHTML = SURFACES.map(
  (s) => `<span><i class="sw" style="background:${SURFACE_COLOUR[s]}"></i>${s}</span>`,
).join("");

async function refreshAreas(selectId: string): Promise<void> {
  const areas = await api<string[]>("/__editor/areas");
  const select = $<HTMLSelectElement>("area");
  select.innerHTML = areas.map((a) => `<option>${a}</option>`).join("");
  select.value = selectId;
}

$("nw-create").onclick = async () => {
  if (dirty && !confirm("Discard unsaved edits?")) return;
  const id = $<HTMLInputElement>("nw-id").value.trim();
  const widthKm = Number($<HTMLInputElement>("nw-w").value);
  const heightKm = Number($<HTMLInputElement>("nw-h").value);
  try {
    const out = await api<{ register: string[] }>("/__editor/new-world", {
      method: "POST",
      body: JSON.stringify({ id, widthKm, heightKm }),
    });
    await refreshAreas(id);
    await loadArea(id);
    $("log").textContent =
      `Created "${id}". To compile it, add to tools/map-compiler/cli.ts:\n${out.register.join("\n")}`;
  } catch (err) {
    $("log").textContent = String(err);
  }
};

// --- image import (pure maths lives in image-trace.ts / image-import.ts) ---
const MAX_IMPORT_PIXELS = 25_000_000;
interface ImportImage {
  w: number;
  h: number;
  lum: Uint8Array;
}
let impImage: ImportImage | undefined;
let impMask: HTMLCanvasElement | undefined;
let impGraph: RoadGraphPx | undefined;
let impMode: "km" | "mpp" = "km";

const impInput = (id: string) => $<HTMLInputElement>(id);

function impOffset(): { x: number; y: number } {
  return { x: Number(impInput("im-ox").value) || 0, y: Number(impInput("im-oy").value) || 0 };
}

function impScaleNow(): ImportScale | undefined {
  if (impImage === undefined) return undefined;
  try {
    return impMode === "km"
      ? importScale({
          imageW: impImage.w,
          imageH: impImage.h,
          widthKm: Number(impInput("im-km").value),
        })
      : importScale({
          imageW: impImage.w,
          imageH: impImage.h,
          mPerPx: Number(impInput("im-mpp").value),
        });
  } catch {
    return undefined;
  }
}

function impOptions(): Partial<TraceOptions> {
  return {
    threshold: Number(impInput("im-thr").value),
    minSpurPx: Number(impInput("im-spur").value),
    simplifyPx: Number(impInput("im-simp").value),
    smoothIterations: Number(impInput("im-smooth").value),
  };
}

/** Recomputes the linked km / m-per-px fields, the readout and warnings. */
function updateImportUi(): void {
  const readout = $("im-derived");
  const warn = $("im-warn");
  const scaleNow = impScaleNow();
  if (impImage === undefined || scaleNow === undefined) {
    readout.textContent = impImage === undefined ? "no image loaded" : "enter a width or m/px";
    warn.textContent = "";
    requestDraw();
    return;
  }
  if (impMode === "km") impInput("im-mpp").value = scaleNow.mPerPx.toFixed(3);
  else impInput("im-km").value = (scaleNow.widthM / 1000).toFixed(3);
  readout.textContent = `${impImage.w} x ${impImage.h} px; height ${(scaleNow.heightM / 1000).toFixed(3)} km; ${scaleNow.mPerPx.toFixed(3)} m/px`;
  const warnings = [...scaleNow.warnings, ...footprintWarnings(scaleNow, impOffset(), world)];
  warn.innerHTML = warnings.map((w) => `<div>${w}</div>`).join("");
  requestDraw();
}

function rebuildImportMask(): void {
  if (impImage === undefined) {
    impMask = undefined;
    return;
  }
  const { w, h, lum } = impImage;
  const level = Number(impInput("im-thr").value);
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const g = c.getContext("2d") as CanvasRenderingContext2D;
  const data = g.createImageData(w, h);
  for (let i = 0; i < w * h; i++) {
    if ((lum[i] as number) < level) {
      data.data[i * 4] = 255;
      data.data[i * 4 + 1] = 170;
      data.data[i * 4 + 2] = 40;
      data.data[i * 4 + 3] = 150;
    }
  }
  g.putImageData(data, 0, 0);
  impMask = c;
}

function clearImport(): void {
  impImage = undefined;
  impMask = undefined;
  impGraph = undefined;
  impInput("im-file").value = "";
  updateImportUi();
}

async function onImportFile(file: File): Promise<void> {
  try {
    const bmp = await createImageBitmap(file);
    if (bmp.width * bmp.height > MAX_IMPORT_PIXELS) {
      setStatus(`image is ${bmp.width}x${bmp.height}; refusing more than 25 megapixels`);
      return;
    }
    const c = document.createElement("canvas");
    c.width = bmp.width;
    c.height = bmp.height;
    const g = c.getContext("2d", { willReadFrequently: true }) as CanvasRenderingContext2D;
    g.fillStyle = "#fff"; // transparent = white = no road
    g.fillRect(0, 0, c.width, c.height);
    g.drawImage(bmp, 0, 0);
    const px = g.getImageData(0, 0, c.width, c.height).data;
    const lum = new Uint8Array(c.width * c.height);
    for (let i = 0; i < lum.length; i++) {
      lum[i] = Math.round(
        0.299 * (px[i * 4] as number) +
          0.587 * (px[i * 4 + 1] as number) +
          0.114 * (px[i * 4 + 2] as number),
      );
    }
    impImage = { w: c.width, h: c.height, lum };
    impGraph = undefined;
    const worldKm = world.widthM / 1000;
    impInput("im-km").value = String(
      (worldKm * 1000) / c.width <= COARSE_M_PER_PX ? worldKm : c.width / 1000,
    );
    impMode = "km";
    rebuildImportMask();
    updateImportUi();
    setStatus(`image loaded: ${c.width} x ${c.height} px`);
  } catch (err) {
    setStatus(`could not read image: ${String(err)}`);
  }
}

function traceImport(): RoadGraphPx | undefined {
  if (impImage === undefined) return undefined;
  impGraph = imageToRoadGraph(impImage.lum, impImage.w, impImage.h, impOptions());
  return impGraph;
}

function importCounts(g: RoadGraphPx): string {
  const junctions = g.nodes.filter((n) => n.degree >= 3).length;
  const deadEnds = g.nodes.filter((n) => n.degree === 1).length;
  return `${g.paths.length} roads, ${junctions} junctions, ${deadEnds} dead ends`;
}

function drawImportOverlay(): void {
  const s = impScaleNow();
  if (impMask === undefined || s === undefined) return;
  const o = impOffset();
  const tl = toScreen({ x: o.x, y: o.y + s.heightM });
  const br = toScreen({ x: o.x + s.widthM, y: o.y });
  ctx.drawImage(impMask, tl.x, tl.y, br.x - tl.x, br.y - tl.y);
  ctx.strokeStyle = "rgba(255,170,40,0.6)";
  ctx.lineWidth = 1;
  ctx.strokeRect(tl.x, tl.y, br.x - tl.x, br.y - tl.y);
}

function drawImportPreview(): void {
  const s = impScaleNow();
  if (impGraph === undefined || impImage === undefined || s === undefined) return;
  const o = impOffset();
  const imageH = impImage.h;
  const toS = (p: { x: number; y: number }) => toScreen(pixelToWorld(p, imageH, s.mPerPx, o));
  ctx.save();
  ctx.setLineDash([6, 4]);
  ctx.strokeStyle = "#4df";
  ctx.lineWidth = 2;
  for (const path of impGraph.paths) {
    ctx.beginPath();
    path.points.forEach((p, i) => {
      const sp = toS(p);
      if (i === 0) ctx.moveTo(sp.x, sp.y);
      else ctx.lineTo(sp.x, sp.y);
    });
    ctx.stroke();
  }
  ctx.restore();
  for (const n of impGraph.nodes) {
    if (n.degree < 3) continue;
    const sp = toS(n);
    ctx.fillStyle = "#4df";
    ctx.beginPath();
    ctx.arc(sp.x, sp.y, 4, 0, Math.PI * 2);
    ctx.fill();
  }
}

impInput("im-spur").value = String(DEFAULT_TRACE_OPTIONS.minSpurPx);
impInput("im-simp").value = String(DEFAULT_TRACE_OPTIONS.simplifyPx);
impInput("im-smooth").value = String(DEFAULT_TRACE_OPTIONS.smoothIterations);
$<HTMLSelectElement>("im-hw").innerHTML = HIGHWAY_CLASSES.map(
  (h) => `<option ${h === "residential" ? "selected" : ""}>${h}</option>`,
).join("");
$<HTMLSelectElement>("im-surf").innerHTML = SURFACES.map(
  (s) => `<option ${s === "tarmac" ? "selected" : ""}>${s}</option>`,
).join("");
impInput("im-file").onchange = () => {
  const f = impInput("im-file").files?.[0];
  if (f !== undefined) void onImportFile(f);
};
impInput("im-thr").oninput = () => {
  $("im-thr-v").textContent = impInput("im-thr").value;
  impGraph = undefined;
  rebuildImportMask();
  requestDraw();
};
impInput("im-km").oninput = () => {
  impMode = "km";
  updateImportUi();
};
impInput("im-mpp").oninput = () => {
  impMode = "mpp";
  updateImportUi();
};
for (const id of ["im-ox", "im-oy"]) impInput(id).oninput = updateImportUi;
for (const id of ["im-spur", "im-simp", "im-smooth"]) {
  impInput(id).oninput = () => {
    impGraph = undefined;
    requestDraw();
  };
}
$("im-preview").onclick = () => {
  if (impImage === undefined) {
    setStatus("load an image first");
    return;
  }
  setStatus("tracing...");
  setTimeout(() => {
    const g = traceImport();
    if (g !== undefined) setStatus(`preview: ${importCounts(g)} (not imported yet)`);
    requestDraw();
  }, 0);
};
$("im-go").onclick = () => {
  const s = impScaleNow();
  if (impImage === undefined || s === undefined) {
    setStatus("load an image and give a valid width first");
    return;
  }
  setStatus("tracing...");
  const image = impImage;
  setTimeout(() => {
    const g = impGraph ?? traceImport();
    if (g === undefined) return;
    snapshot();
    const opts: ImportRoadOptions = {
      widthM: Number(impInput("im-width").value) || DEFAULT_IMPORT_ROAD.widthM,
      highway: $<HTMLSelectElement>("im-hw").value,
      surface: $<HTMLSelectElement>("im-surf").value as Surface,
    };
    const ways = appendImportedRoads(
      roads,
      proj,
      g,
      { imageH: image.h, mPerPx: s.mPerPx, offset: impOffset() },
      opts,
    );
    const warnings = footprintWarnings(s, impOffset(), world);
    impGraph = undefined;
    refresh(
      `imported ${ways.length} roads (${g.nodes.filter((n) => n.degree >= 3).length} junctions)${
        warnings.length > 0 ? `; WARNING: ${warnings.join("; ")}` : ""
      }`,
    );
  }, 0);
};

async function main(): Promise<void> {
  resize();
  const areas = await api<string[]>("/__editor/areas");
  const select = $<HTMLSelectElement>("area");
  select.innerHTML = areas.map((a) => `<option>${a}</option>`).join("");
  select.onchange = () => {
    if (dirty && !confirm("Discard unsaved edits?")) {
      select.value = area;
      return;
    }
    void loadArea(select.value);
  };
  const initial = areas.includes("my-map") ? "my-map" : (areas[0] ?? "");
  select.value = initial;
  await loadArea(initial);
  setTool("select");
}

main().catch((err: unknown) => {
  $("status").textContent = String(err);
});
