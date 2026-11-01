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
  addBuildingRect,
  addRoad,
  effectiveSurface,
  HIGHWAY_CLASSES,
  makeProjector,
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
  select: "Click a road or building to edit it. Drag to pan.",
  road: "Click to add points; double-click or Enter to finish, Esc to cancel. Clicking on an existing road or node connects to it.",
  move: "Drag a road node to move it (shared by every road that meets there).",
  building: "Click and drag a rectangle to add a building.",
};

// view: world metres -> screen px
let scale = 0.25;
let panX = 0;
let panY = 0;

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
}

function undo(): void {
  const prev = undoStack.pop();
  if (prev === undefined) return;
  [roads, buildings] = JSON.parse(prev) as [RawEnvelope, RawEnvelope];
  selected = undefined;
  dirty = true;
  refresh("undone");
}

async function loadArea(id: string): Promise<void> {
  area = id;
  roads = await api<RawEnvelope>(`/__editor/raw/${id}/roads`);
  buildings = await api<RawEnvelope>(`/__editor/raw/${id}/buildings`);
  proj = makeProjector(roads.bbox);
  undoStack.length = 0;
  dirty = false;
  selected = undefined;
  panX = canvas.width / 2;
  panY = canvas.height / 2;
  const span = Math.max(
    (roads.bbox.east - roads.bbox.west) * 111_320 * Math.cos((roads.bbox.south * Math.PI) / 180),
    (roads.bbox.north - roads.bbox.south) * 110_540,
  );
  scale = Math.min(canvas.width, canvas.height) / span;
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

function draw(): void {
  ctx.fillStyle = "#14161a";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  for (const b of buildings.response.elements) {
    ctx.beginPath();
    b.geometry.forEach((g, i) => {
      const s = toScreen(proj.toLocal(g));
      if (i === 0) ctx.moveTo(s.x, s.y);
      else ctx.lineTo(s.x, s.y);
    });
    ctx.closePath();
    ctx.fillStyle = b === selected?.way ? "#ff6" : "#4a3f3a";
    ctx.fill();
  }
  const drawRoad = (way: RawWay, colour: string, extra: number) => {
    const w = Number.parseFloat(way.tags?.width ?? "") || DEFAULT_WIDTH_M;
    ctx.beginPath();
    way.geometry.forEach((g, i) => {
      const s = toScreen(proj.toLocal(g));
      if (i === 0) ctx.moveTo(s.x, s.y);
      else ctx.lineTo(s.x, s.y);
    });
    ctx.strokeStyle = colour;
    ctx.lineWidth = Math.max(1.5, w * scale) + extra;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.stroke();
  };
  for (const way of roads.response.elements) {
    if (way === selected?.way) drawRoad(way, "#ff6", 4);
    drawRoad(way, SURFACE_COLOUR[effectiveSurface(way.tags)], 0);
  }
  if (tool === "road" || tool === "move") {
    ctx.fillStyle = "#fff";
    for (const way of roads.response.elements) {
      way.geometry.forEach((g, i) => {
        const end = i === 0 || i === way.geometry.length - 1;
        if (!end && tool !== "move") return;
        const sp = toScreen(proj.toLocal(g));
        ctx.fillRect(sp.x - 2, sp.y - 2, 4, 4);
      });
    }
  }
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
  if (roads !== undefined) draw();
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
  draw();
}

function field(label: string, control: string): string {
  return `<label>${label}</label>${control}`;
}

function renderSelection(): void {
  const box = $("sel");
  if (selected === undefined) {
    box.textContent = "Click a road or building. Drag to pan, wheel to zoom.";
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
  draw();
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
    if (tool === "road" && roadPoints.length > 0) draw();
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
  }
  draw();
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
    } else draw();
    return;
  }
  if (d.moved || e.target !== canvas) return;
  const p = worldOf(e);
  if (tool === "road") {
    roadPoints.push(snapPoint(p, roads, proj, snapTol()));
    draw();
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
    const before = toWorld(sx, sy);
    scale *= e.deltaY < 0 ? 1.15 : 1 / 1.15;
    panX = sx - before.x * scale;
    panY = sy + before.y * scale;
    draw();
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
    draw();
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
  if (roads !== undefined) draw();
}
window.addEventListener("resize", resize);

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
