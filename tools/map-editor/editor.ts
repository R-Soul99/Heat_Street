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
import { createSnapshotHistory } from "../editor-shell/history.ts";
import { resolveShortcut, STANDARD_BINDINGS } from "../editor-shell/keys.ts";
import {
  adjustDirection,
  createShell,
  isTextEntryFocused,
  type Shell,
} from "../editor-shell/shell.ts";
import type { StepperSpec } from "../editor-shell/stepper.ts";
import { auditTips } from "../editor-shell/tooltips.ts";
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
const history = createSnapshotHistory<string>(100);
let shell: Shell;
const ROAD_WIDTH_SPEC: StepperSpec = { step: 0.5, coarse: 4, min: 2, max: 40, decimals: 1 };
const BUILDING_HEIGHT_SPEC: StepperSpec = { step: 1, coarse: 5, min: 2, max: 200, decimals: 0 };

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
  select: "Click a road or building to edit it. Drag to pan; arrows pan; F fits the world.",
  road: "Click centre-line points; double-click or Enter to finish; Esc cancels. Clicking a road or node connects to it. [ ] change the width.",
  move: "Drag a road node to move it (shared by every road that meets there).",
  building: "Click and drag a rectangle to add a building. [ ] change the height.",
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
  if (!res.ok) {
    const text = await res.text();
    try {
      const json = JSON.parse(text) as { error?: unknown };
      if (typeof json.error === "string") throw new Error(json.error);
    } catch (e) {
      if (e instanceof Error && e.message !== "" && !(e instanceof SyntaxError)) throw e;
    }
    throw new Error(`${url}: ${res.status} ${text}`);
  }
  return (await res.json()) as T;
}

const errText = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/** Refreshes the info-bar fields that depend on the loaded area. */
function updateInfo(): void {
  shell.info.set("area", area);
  if (roads === undefined) return;
  shell.info.set("world", `${fmt3(world.widthM / 1000)} x ${fmt3(world.heightM / 1000)} km`);
  shell.info.set("tile", `${tileM} m`);
  shell.info.set(
    "counts",
    `${roads.response.elements.length} roads, ${buildings.response.elements.length} buildings`,
  );
}

function setStatus(text: string, kind: "info" | "ok" | "error" = "info"): void {
  if (shell === undefined) return;
  updateInfo();
  shell.info.setDirty(dirty);
  if (text !== "" || kind === "error") shell.info.status(text, kind);
}

const stateJson = (): string => JSON.stringify([roads, buildings]);
const syncHistory = (): void => shell?.setHistoryState(history.canUndo(), history.canRedo());

function snapshot(): void {
  history.push(stateJson());
  dirty = true;
  geometryVersion++;
  syncHistory();
}

function restore(json: string): void {
  [roads, buildings] = JSON.parse(json) as [RawEnvelope, RawEnvelope];
  selected = undefined;
  dirty = true;
  geometryVersion++;
}

function undo(): void {
  const prev = history.undo(stateJson());
  if (prev === undefined) return;
  restore(prev);
  syncHistory();
  refresh("undone");
}

function redo(): void {
  const next = history.redo(stateJson());
  if (next === undefined) return;
  restore(next);
  syncHistory();
  refresh("redone");
}

async function loadArea(id: string): Promise<boolean> {
  try {
    const r = await api<RawEnvelope>(`/__editor/raw/${id}/roads`);
    const b = await api<RawEnvelope>(`/__editor/raw/${id}/buildings`);
    area = id;
    roads = r;
    buildings = b;
    world = worldFromBbox(roads.bbox);
    proj = world.projector;
    history.clear();
    syncHistory();
    dirty = false;
    selected = undefined;
    geometryVersion++;
    clearImport();
    fitWorld();
    refresh(`Loaded ${id}.`);
    return true;
  } catch (err) {
    setStatus(`Could not load "${id}": ${errText(err)}`, "error");
    return false;
  }
}

async function save(): Promise<boolean> {
  try {
    const put = (kind: string, body: RawEnvelope) =>
      api(`/__editor/raw/${area}/${kind}`, { method: "PUT", body: JSON.stringify(body) });
    await put("roads", roads);
    await put("buildings", buildings);
    dirty = false;
    refresh(`Saved ${area}.`);
    shell.info.status(`Saved ${area}.`, "ok");
    return true;
  } catch (err) {
    setStatus(`Save failed: ${errText(err)}`, "error");
    return false;
  }
}

async function compile(): Promise<boolean> {
  try {
    if (!(await save())) return false;
    const logText = $("log-text");
    logText.textContent = "compiling...";
    setStatus(`Compiling ${area}...`);
    const res = await fetch(`/__editor/compile/${area}`, { method: "POST" });
    logText.textContent = await res.text();
    if (res.ok && res.headers.get("X-Compile-Ok") === "1") {
      setStatus(`Compiled ${area}. Reload the game tab to see it.`, "ok");
      return true;
    }
    setStatus("Compile failed - see File > Show compile log.", "error");
    return false;
  } catch (err) {
    setStatus(`Compile failed: ${errText(err)}`, "error");
    return false;
  }
}

async function compileAndDrive(): Promise<void> {
  const tab = window.open("about:blank", "_blank");
  const ok = await compile();
  if (ok && tab !== null) tab.location.href = `/?map=${encodeURIComponent(area)}`;
  else tab?.close();
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

let widthStepper: ReturnType<typeof createStepper> | undefined;
let heightStepper: ReturnType<typeof createStepper> | undefined;
let selBox: HTMLElement | undefined;

const hintEl = (text: string): HTMLElement => el("div", "flyout-hint", text);

function setTool(next: Tool): void {
  tool = next;
  roadPoints = [];
  rectStart = undefined;
  movingNode = undefined;
  widthStepper = undefined;
  heightStepper = undefined;
  selBox = undefined;
  const fly = shell.flyout;
  fly.replaceChildren(hintEl(HINTS[next]));
  if (next === "road") {
    widthStepper = createStepper({
      value: drawWidth,
      spec: ROAD_WIDTH_SPEC,
      unit: "m",
      tip: "Width of the road you draw, in metres ([ ] also change it)",
      onChange: (v) => {
        drawWidth = v;
        requestDraw();
      },
    });
    const surface = createSelect({
      options: [
        { value: "", label: "(auto from road class)" },
        ...SURFACES.map((x) => ({ value: x as string, label: x })),
      ],
      value: drawSurface,
      tip: "Surface of the road you draw; auto picks it from the road class",
      onChange: (v) => {
        drawSurface = v;
      },
    });
    const highway = createSelect({
      options: HIGHWAY_CLASSES.map((h) => ({ value: h as string, label: h })),
      value: drawHighway,
      tip: "Road class of the road you draw (affects default surface and AI)",
      onChange: (v) => {
        drawHighway = v;
      },
    });
    fly.append(
      createField("Width", widthStepper.el),
      createField("Surface", surface.el),
      createSection("More", "Extra road options", false, [createField("Road class", highway.el)]),
    );
  } else if (next === "building") {
    heightStepper = createStepper({
      value: buildingHeight,
      spec: BUILDING_HEIGHT_SPEC,
      unit: "m",
      tip: "Height of the building you draw, in metres ([ ] also change it)",
      onChange: (v) => {
        buildingHeight = v;
      },
    });
    fly.appendChild(createField("Height", heightStepper.el));
  } else if (next === "select") {
    selBox = el("div", "selection");
    fly.appendChild(selBox);
    renderSelection();
  }
  if (roads !== undefined) requestDraw();
}

/** Switches tool through the shell so the rail highlight follows. */
const switchTool = (next: Tool): void => shell.setActiveTool(next);

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

/** Edits made while a stepper is held or arrow-keyed merge into one undo step. */
let lastEdit: { way: RawWay; key: string; at: number } | undefined;
function editTag(way: RawWay, key: string, fn: () => void, rebuild: boolean): void {
  const now = Date.now();
  if (
    lastEdit === undefined ||
    lastEdit.way !== way ||
    lastEdit.key !== key ||
    now - lastEdit.at > 800
  ) {
    snapshot();
  }
  lastEdit = { way, key, at: now };
  fn();
  geometryVersion++;
  if (rebuild) refresh("Edited.");
  else {
    requestDraw();
    setStatus("Edited.");
  }
}

function renderSelection(): void {
  const box = selBox;
  if (box === undefined) return;
  if (selected === undefined) {
    box.replaceChildren(
      hintEl("Nothing selected. Click a road or building; drag to pan, wheel to zoom."),
    );
    return;
  }
  const { kind, way } = selected;
  const t = way.tags ?? {};
  const parts: HTMLElement[] = [];
  const del = createButton({
    label: kind === "road" ? "Delete road" : "Delete building",
    tip: "Delete the selected item (Del; Undo brings it back)",
    kind: "danger",
    onClick: deleteSelected,
  });
  if (kind === "road") {
    parts.push(el("b", undefined, `Road ${way.id} (${way.geometry.length} pts)`));
    const name = el("input", undefined, undefined, "Road name (optional)");
    name.type = "text";
    name.value = t.name ?? "";
    name.addEventListener("change", () =>
      editTag(way, "name", () => setTag(way, "name", name.value), false),
    );
    const highway = createSelect({
      options: HIGHWAY_CLASSES.map((h) => ({ value: h as string, label: h })),
      value: t.highway ?? "",
      tip: "Road class of the selected road",
      onChange: (v) => editTag(way, "highway", () => setTag(way, "highway", v), true),
    });
    const surface = createSelect({
      options: [
        { value: "", label: "(auto from road class)" },
        ...SURFACES.map((x) => ({ value: x as string, label: x })),
      ],
      value: t.surface !== undefined ? effectiveSurface(t) : "",
      tip: "Surface of the selected road",
      onChange: (v) =>
        editTag(way, "surface", () => setSurface(way, v === "" ? null : (v as Surface)), true),
    });
    const width = createStepper({
      value: Number.parseFloat(t.width ?? "") || DEFAULT_WIDTH_M,
      spec: ROAD_WIDTH_SPEC,
      unit: "m",
      tip: "Width of the selected road, in metres",
      onChange: (v) => editTag(way, "width", () => setTag(way, "width", String(v)), false),
    });
    const oneway = createToggle({
      label: "One-way",
      checked: t.oneway === "yes",
      tip: "Traffic only flows in the drawn direction",
      onChange: (v) => editTag(way, "oneway", () => setTag(way, "oneway", v ? "yes" : null), true),
    });
    parts.push(
      createField("Name", name),
      createField("Road class", highway.el),
      createField("Surface", surface.el),
      createField("Width", width.el),
      oneway.el,
      del,
    );
  } else {
    parts.push(el("b", undefined, `Building ${way.id}`));
    const height = createStepper({
      value: Number.parseFloat(t.height ?? "") || buildingHeight,
      spec: BUILDING_HEIGHT_SPEC,
      unit: "m",
      tip: "Height of the selected building, in metres",
      onChange: (v) => editTag(way, "height", () => setTag(way, "height", String(v)), false),
    });
    parts.push(createField("Height", height.el), del);
  }
  box.replaceChildren(...parts);
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
    shell.info.set("cursor", `x ${fmt3(Math.round(hover.x))}, y ${fmt3(Math.round(hover.y))} m`);
    if (roadPoints.length > 0 || rectStart !== undefined) requestDraw();
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
function panBy(dx: -1 | 0 | 1, dy: -1 | 0 | 1): void {
  panX -= (dx * canvas.width) / 4;
  panY -= (dy * canvas.height) / 4;
  requestDraw();
}
function doFit(): void {
  fitWorld();
  requestDraw();
}
function cancelDrawing(): void {
  roadPoints = [];
  rectStart = undefined;
  requestDraw();
}

/** Applies [ ] / arrow adjustment to the active tool's value; false if it has none. */
function adjustActive(dir: 1 | -1, coarse: boolean): boolean {
  const apply = (v: number, spec: StepperSpec): number => {
    const delta = spec.step * (coarse ? spec.coarse : 1) * dir;
    const c = Math.min(spec.max, Math.max(spec.min, v + delta));
    return Math.round(c * 10 ** spec.decimals) / 10 ** spec.decimals;
  };
  if (tool === "road" && widthStepper !== undefined) {
    drawWidth = apply(drawWidth, ROAD_WIDTH_SPEC);
    widthStepper.set(drawWidth);
    requestDraw();
    return true;
  }
  if (tool === "building" && heightStepper !== undefined) {
    buildingHeight = apply(buildingHeight, BUILDING_HEIGHT_SPEC);
    heightStepper.set(buildingHeight);
    return true;
  }
  return false;
}

const TOOL_KEYS: Record<string, Tool> = {
  KeyV: "select",
  KeyR: "road",
  KeyM: "move",
  KeyB: "building",
};
const ARROW_PAN: Record<string, [-1 | 0 | 1, -1 | 0 | 1]> = {
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
};

window.addEventListener("keydown", (e) => {
  if (e.altKey || shell === undefined) return;
  const typing = isTextEntryFocused(document.activeElement);
  const dialogOpen = shell.isDialogOpen();
  const ctrl = e.ctrlKey || e.metaKey;
  if (ctrl && e.code === "KeyS") e.preventDefault(); // never the browser's save-page
  const action = resolveShortcut(e, STANDARD_BINDINGS, { textFocused: typing, dialogOpen });
  if (action === "undo") {
    e.preventDefault();
    undo();
    return;
  }
  if (action === "redo") {
    e.preventDefault();
    redo();
    return;
  }
  if (action === "save") {
    void save();
    return;
  }
  if (action === "escape") {
    cancelDrawing();
    return;
  }
  if (typing || dialogOpen) return;
  if (ctrl) {
    const pan = ARROW_PAN[e.code];
    if (pan !== undefined) {
      e.preventDefault();
      panBy(pan[0], pan[1]);
    }
    return;
  }
  const next = TOOL_KEYS[e.code];
  if (next !== undefined) switchTool(next);
  else if (e.code === "KeyF") doFit();
  else if (e.key === "Delete" || e.key === "Backspace") deleteSelected();
  else if (e.key === "Enter" && tool === "road") finishRoad();
  else {
    const adj = adjustDirection(e);
    if (adj === undefined) return;
    if (adjustActive(adj.dir, adj.coarse)) e.preventDefault();
    else {
      const pan = ARROW_PAN[e.code];
      if (pan !== undefined) {
        e.preventDefault();
        panBy(pan[0], pan[1]);
      }
    }
  }
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

let legendEl: HTMLElement;

function openDialogEl(id: string): void {
  ($(id) as HTMLDialogElement).showModal();
}

async function confirmDiscard(): Promise<boolean> {
  return (
    !dirty || (await confirmDialog("Discard changes?", `${area} has unsaved changes.`, "Discard"))
  );
}

async function openAreaDialog(): Promise<void> {
  try {
    const areas = await api<string[]>("/__editor/areas");
    const pick = createSelect({
      options: areas.map((a) => ({ value: a, label: a })),
      value: areas.includes(area) ? area : (areas[0] ?? ""),
      tip: "Choose which area to edit",
      onChange: () => {},
    });
    const body = el("div");
    body.appendChild(createField("Area", pick.el));
    const r = await openDialog({
      title: "Open area",
      body,
      actions: [
        { id: "open", label: "Open", tip: "Open the chosen area", primary: true },
        { id: "cancel", label: "Cancel", tip: "Close without opening anything" },
      ],
    });
    if (r !== "open" || pick.get() === "") return;
    if (!(await confirmDiscard())) return;
    await loadArea(pick.get());
  } catch (err) {
    setStatus(`Could not list areas: ${errText(err)}`, "error");
  }
}

async function clearAll(): Promise<void> {
  const n = roads.response.elements.length;
  const m = buildings.response.elements.length;
  if (n + m === 0) {
    setStatus("Nothing to clear.");
    return;
  }
  const ok = await confirmDialog(
    "Clear all",
    `Delete all ${n} roads and ${m} buildings in ${area}?`,
    "Clear all",
  );
  if (!ok) return;
  snapshot();
  roads.response.elements = [];
  buildings.response.elements = [];
  selected = undefined;
  refresh("Cleared all roads and buildings (Undo brings them back).");
}

function zoomCentre(factor: number): void {
  setView(
    zoomAt(currentView(), factor, canvas.width / 2, canvas.height / 2, fitScale / 4, MAX_SCALE),
  );
  requestDraw();
}

function buildShell(): Shell {
  const run = (p: Promise<unknown>): void => void p;
  return createShell({
    root: $("app"),
    menus: [
      {
        label: "File/Area",
        tip: "Open, save and compile areas",
        items: [
          {
            id: "open",
            label: "Open area...",
            tip: "Pick another area to edit (asks first if you have unsaved changes)",
            run: () => run(openAreaDialog()),
          },
          { separator: true },
          {
            id: "save",
            label: "Save",
            shortcut: "Ctrl+S",
            tip: "Write the raw road and building files for this area",
            run: () => run(save()),
          },
          {
            id: "compile",
            label: "Save & compile",
            tip: "Save, then run the map compiler so the game sees your edits",
            run: () => run(compile()),
          },
          {
            id: "drive",
            label: "Compile & drive",
            tip: "Save, compile, then open the game on this map in a new tab",
            run: () => run(compileAndDrive()),
          },
          {
            id: "log",
            label: "Show compile log",
            tip: "Show the output of the last compile",
            run: () => openDialogEl("log-dialog"),
          },
          { separator: true },
          {
            id: "new",
            label: "New...",
            tip: "Create a new blank world",
            run: () => openDialogEl("legacy-new"),
          },
        ],
      },
      {
        label: "Import",
        tip: "Bring in roads from outside",
        items: [
          {
            id: "import",
            label: "Import image...",
            tip: "Trace roads from a black-and-white road image",
            run: () => openDialogEl("legacy-import"),
          },
        ],
      },
      {
        label: "View",
        tip: "What the map shows",
        items: [
          {
            id: "fit",
            label: "Fit",
            shortcut: "F",
            tip: "Fit the whole world in view",
            run: doFit,
          },
          { separator: true },
          ...TILE_SIZES_M.map((m) => ({
            id: `tile-${m}`,
            label: `Tile size ${m} m`,
            tip: `Draw the game's streaming tiles at ${m} m`,
            checked: () => tileM === m,
            run: () => {
              tileM = m;
              setStatus("");
              requestDraw();
            },
          })),
          { separator: true },
          {
            id: "grid",
            label: "Show grid",
            tip: "Show or hide the metre grid",
            checked: () => showGrid,
            run: () => {
              showGrid = !showGrid;
              requestDraw();
            },
          },
          {
            id: "tiles",
            label: "Show tiles",
            tip: "Show or hide the tile boundaries and labels",
            checked: () => showTiles,
            run: () => {
              showTiles = !showTiles;
              requestDraw();
            },
          },
          {
            id: "legend",
            label: "Surface legend",
            tip: "Show or hide the colour key for road surfaces",
            checked: () => legendEl.style.display === "block",
            run: () => {
              legendEl.style.display = legendEl.style.display === "block" ? "none" : "block";
            },
          },
        ],
      },
      { label: "Help", tip: "Tooltips and keyboard shortcuts", items: [] },
    ],
    tools: [
      {
        id: "select",
        label: "Select",
        icon: "↖",
        keyLabel: "V",
        tip: "Select: click a road or building to edit its properties",
      },
      {
        id: "road",
        label: "Draw road",
        icon: "╱",
        keyLabel: "R",
        tip: "Draw road: click centre-line points; double-click or Enter to finish; Esc cancels",
      },
      {
        id: "move",
        label: "Move node",
        icon: "✥",
        keyLabel: "M",
        tip: "Move node: drag a road node; roads that share it follow",
      },
      {
        id: "building",
        label: "Building",
        icon: "▭",
        keyLabel: "B",
        tip: "Building: drag a rectangle to add a building",
      },
    ],
    onToolChange: (id) => setTool(id as Tool),
    history: {
      undo,
      redo,
      clear: () => run(clearAll()),
      clearLabel: "Clear all",
      clearTip: "Delete every road and building in this area (asks first; Undo brings them back)",
    },
    view: {
      zoomIn: () => zoomCentre(1.25),
      zoomOut: () => zoomCentre(0.8),
      fit: doFit,
      pan: panBy,
    },
    infoFields: [
      { key: "area", label: "Area", tip: "The area being edited" },
      { key: "world", label: "World", tip: "World size in kilometres" },
      { key: "tile", label: "Tile", tip: "Streaming tile size in metres" },
      {
        key: "cursor",
        label: "Cursor",
        tip: "Mouse position in metres from the south-west corner",
      },
      { key: "counts", label: "", tip: "How many roads and buildings this area has" },
    ],
  });
}

$("nw-create").onclick = async () => {
  if (!(await confirmDiscard())) return;
  const id = $<HTMLInputElement>("nw-id").value.trim();
  const widthKm = Number($<HTMLInputElement>("nw-w").value);
  const heightKm = Number($<HTMLInputElement>("nw-h").value);
  try {
    const out = await api<{ registered: boolean; warning?: string }>("/__editor/new-world", {
      method: "POST",
      body: JSON.stringify({ id, widthKm, heightKm }),
    });
    ($("legacy-new") as HTMLDialogElement).close();
    if (await loadArea(id)) {
      setStatus(
        out.registered ? `Created and registered "${id}".` : (out.warning ?? `Created "${id}".`),
        out.registered ? "ok" : "info",
      );
    }
  } catch (err) {
    setStatus(`Could not create "${id}": ${errText(err)}`, "error");
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
    warn.replaceChildren();
    requestDraw();
    return;
  }
  if (impMode === "km") impInput("im-mpp").value = fmt3(scaleNow.mPerPx);
  else impInput("im-km").value = fmt3(scaleNow.widthM / 1000);
  readout.textContent = `${impImage.w} x ${impImage.h} px; height ${fmt3(scaleNow.heightM / 1000)} km; ${fmt3(scaleNow.mPerPx)} m/px`;
  const warnings = [...scaleNow.warnings, ...footprintWarnings(scaleNow, impOffset(), world)];
  warn.replaceChildren(...warnings.map((w) => el("div", undefined, w)));
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
      setStatus(`Image is ${bmp.width}x${bmp.height}; refusing more than 25 megapixels.`, "error");
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
    const initialKm = (worldKm * 1000) / c.width <= COARSE_M_PER_PX ? worldKm : c.width / 1000;
    impInput("im-km").value = fmt3(initialKm);
    impMode = "km";
    rebuildImportMask();
    updateImportUi();
    setStatus(`image loaded: ${c.width} x ${c.height} px`);
  } catch (err) {
    setStatus(`Could not read image: ${errText(err)}`, "error");
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

impInput("im-spur").value = `${DEFAULT_TRACE_OPTIONS.minSpurPx}`;
impInput("im-simp").value = `${DEFAULT_TRACE_OPTIONS.simplifyPx}`;
impInput("im-smooth").value = `${DEFAULT_TRACE_OPTIONS.smoothIterations}`;
function fillOptions(id: string, values: readonly string[], selectedValue: string): void {
  const sel = $<HTMLSelectElement>(id);
  sel.replaceChildren(...values.map((v) => el("option", undefined, v)));
  sel.value = selectedValue;
}
fillOptions("im-hw", HIGHWAY_CLASSES, "residential");
fillOptions("im-surf", SURFACES, "tarmac");
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
    setStatus("Load an image first.", "error");
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
    setStatus("Load an image and give a valid width first.", "error");
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
  shell = buildShell();
  legendEl = $("legend");
  legendEl.replaceChildren(
    ...SURFACES.map((surf) => {
      const row = el("span");
      const sw = el("i", "sw");
      sw.style.background = SURFACE_COLOUR[surf];
      row.append(sw, surf);
      return row;
    }),
  );
  resize();
  switchTool("select");
  const areas = await api<string[]>("/__editor/areas");
  const initial = areas.includes("my-map") ? "my-map" : (areas[0] ?? "");
  if (initial === "") {
    setStatus("No areas found. Use File > New to create one.", "error");
  } else {
    await loadArea(initial);
  }
  auditTips(document);
}

main().catch((err: unknown) => {
  const msg = `Editor failed to start: ${errText(err)}`;
  if (shell !== undefined) setStatus(msg, "error");
  else document.body.textContent = msg;
});
