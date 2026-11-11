/**
 * Dev-only top-down map editor. Loads/saves the compiler's raw-OSM files via the
 * `/__editor/*` dev middleware (`vite-plugin.ts`), so it edits imported and
 * synthetic areas alike. Built on the shared editor shell (tools/editor-shell):
 * the DOM half lives in createShell options and the flyout builders below, the
 * canvas drawing and interaction are unchanged.
 *
 * NOTE: re-running an importer or generator overwrites the raw files and loses
 * hand edits made here.
 */
import { apiJson, apiText } from "../editor-shell/api.ts";
import {
  createButton,
  createCheckbox,
  hintText,
  labelled,
  readout,
} from "../editor-shell/fields.ts";
import { fmt3, fmtXY } from "../editor-shell/format.ts";
import { createSnapshotHistory } from "../editor-shell/history.ts";
import { type Binding, installShortcuts, shortcutsDialogBody } from "../editor-shell/keys.ts";
import { createMessageLog, logDialogBody } from "../editor-shell/log.ts";
import { createSelect } from "../editor-shell/select.ts";
import { createShell } from "../editor-shell/shell.ts";
import { createStepper, type StepperHandle } from "../editor-shell/stepper.ts";
import { reportMissingTips } from "../editor-shell/tooltips.ts";
import type { ShellHandle, StatusKind } from "../editor-shell/types.ts";
import {
  appendImportedRoads,
  DEFAULT_IMPORT_ROAD,
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
import { type ImportPlan, planImportWorld, suggestMapId, validateNewMapInput } from "./new-map.ts";
import { compileOutcome, countsText, worldSizeText } from "./ui-text.ts";
import {
  DEFAULT_TILE_M,
  fitView,
  gridStep,
  MAX_WORLD_KM,
  MIN_WORLD_KM,
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

const canvas = document.createElement("canvas");
canvas.style.cursor = "crosshair";
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
const messageLog = createMessageLog();

type Tool = "select" | "road" | "move" | "building" | "import";
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
  import:
    "Trace roads from the image you chose in File > New... > Import image. Set the threshold, preview, then import into the new map.",
};

let shell: ShellHandle;

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

/** Status line + message log. Empty text is ignored. */
function say(text: string, kind: StatusKind = "info", log = true): void {
  if (text === "") return;
  shell.info.status(text, kind);
  if (log) messageLog.add(text, kind);
}

function updateInfo(): void {
  shell.info.set("area", area === "" ? "-" : area);
  if (world !== undefined) shell.info.set("world", worldSizeText(world.widthM, world.heightM));
  shell.info.set("tile", `${tileM} m`);
  if (roads !== undefined) {
    shell.info.set(
      "counts",
      countsText(roads.response.elements.length, buildings.response.elements.length),
    );
  }
  shell.info.setDirty(dirty);
}

const syncHistory = (): void => shell.setHistoryState(history.canUndo(), history.canRedo());
const currentJson = (): string => JSON.stringify([roads, buildings]);

function snapshot(): void {
  history.record(currentJson());
  dirty = true;
  geometryVersion++;
  syncHistory();
}

function restore(json: string, message: string): void {
  [roads, buildings] = JSON.parse(json) as [RawEnvelope, RawEnvelope];
  selected = undefined;
  dirty = true;
  geometryVersion++;
  syncHistory();
  refresh(message);
}

function undo(): void {
  const prev = history.undo(currentJson());
  if (prev !== undefined) restore(prev, "undone");
}

function redo(): void {
  const next = history.redo(currentJson());
  if (next !== undefined) restore(next, "redone");
}

async function loadArea(id: string): Promise<void> {
  const r = await apiJson<RawEnvelope>(`/__editor/raw/${id}/roads`);
  const b = await apiJson<RawEnvelope>(`/__editor/raw/${id}/buildings`);
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
  refresh("loaded");
}

/** Resolves true when both files were written; failures show in the info bar. */
async function save(): Promise<boolean> {
  try {
    const put = (kind: string, body: RawEnvelope) =>
      apiText(`/__editor/raw/${area}/${kind}`, { method: "PUT", body: JSON.stringify(body) });
    await put("roads", roads);
    await put("buildings", buildings);
    dirty = false;
    refresh("saved");
    return true;
  } catch (err) {
    say(`Save failed: ${errText(err)}`, "error");
    return false;
  }
}

async function compile(): Promise<boolean> {
  if (!(await save())) return false;
  say("Compiling...", "info", false);
  try {
    const log = await apiText(`/__editor/compile/${area}`, { method: "POST" });
    const out = compileOutcome(log);
    messageLog.add(log, out.ok ? "info" : "error");
    if (out.ok) say("Compiled. Reload the game tab to see it.", "ok");
    else say(out.summary, "error", false);
    return out.ok;
  } catch (err) {
    const msg = errText(err);
    const out = compileOutcome(msg);
    say(out.ok ? `Compile failed: ${msg}` : out.summary, "error");
    return false;
  }
}

const errText = (err: unknown): string => (err instanceof Error ? err.message : String(err));

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

/** Scale bar only; the text readouts live in the shell info bar. */
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

function onToolChange(next: string): void {
  tool = next as Tool;
  roadPoints = [];
  rectStart = undefined;
  movingNode = undefined;
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

const strOptions = (vals: readonly string[]) => vals.map((v) => ({ value: v, label: v }));

function renderRoadOptions(host: HTMLElement): void {
  const hw = createSelect<string>({
    label: "Highway",
    tip: "Road class for new roads (sets the default look and traffic rules).",
    options: strOptions(HIGHWAY_CLASSES),
    value: drawHighway,
    onChange: (v) => {
      drawHighway = v;
    },
  });
  const surf = createSelect<string>({
    label: "Surface",
    tip: "Surface for new roads. Auto picks one from the highway class.",
    options: [{ value: "", label: "(auto)" }, ...strOptions(SURFACES)],
    value: drawSurface,
    onChange: (v) => {
      drawSurface = v;
    },
  });
  const width = createStepper({
    label: "Width (m)",
    tip: "Width of new roads in metres.",
    value: drawWidth,
    min: 2,
    max: 40,
    step: 0.5,
    coarse: 4,
    decimals: 1,
    onChange: (v) => {
      drawWidth = v;
    },
  });
  host.append(hintText(HINTS.road), hw.el, surf.el, width.el);
}

function renderBuildingOptions(host: HTMLElement): void {
  const height = createStepper({
    label: "Height (m)",
    tip: "Height of new buildings in metres.",
    value: buildingHeight,
    min: 2,
    max: 200,
    step: 1,
    coarse: 5,
    decimals: 0,
    onChange: (v) => {
      buildingHeight = v;
    },
  });
  host.append(hintText(HINTS.building), height.el);
}

/** Select tool flyout: hint plus the tag editor for the current selection. No markup strings. */
function renderSelectOptions(host: HTMLElement): void {
  host.append(hintText(HINTS.select));
  if (selected === undefined) {
    host.append(hintText("Nothing selected."));
    return;
  }
  const { kind, way } = selected;
  const t = way.tags ?? {};
  const heading = document.createElement("div");
  heading.className = "es-subhead";
  const edit = (fn: () => void) => {
    snapshot();
    fn();
    refresh("edited", false);
  };
  if (kind === "road") {
    heading.textContent = `Road way ${way.id} (${way.geometry.length} pts)`;
    const hw = createSelect<string>({
      label: "Highway",
      tip: "Road class of this road.",
      options: strOptions(HIGHWAY_CLASSES),
      value: t.highway ?? "",
      onChange: (v) => edit(() => setTag(way, "highway", v)),
    });
    const surf = createSelect<string>({
      label: "Surface",
      tip: "Surface of this road. Auto derives it from the highway class.",
      options: [{ value: "", label: "(auto from highway)" }, ...strOptions(SURFACES)],
      value: t.surface !== undefined ? effectiveSurface(t) : "",
      onChange: (v) => edit(() => setSurface(way, v === "" ? null : (v as Surface))),
    });
    const hasWidth = t.width !== undefined && t.width !== "";
    const note = readout(hasWidth ? "" : `(default ${DEFAULT_WIDTH_M} m)`);
    const width = createStepper({
      label: "Width (m)",
      tip: "Width of this road in metres.",
      value: Number.parseFloat(t.width ?? "") || DEFAULT_WIDTH_M,
      min: 2,
      max: 40,
      step: 0.5,
      coarse: 4,
      decimals: 1,
      onChange: (v) => {
        edit(() => setTag(way, "width", String(v)));
        note.set("");
      },
    });
    const name = document.createElement("input");
    name.type = "text";
    name.value = t.name ?? "";
    name.dataset.tip = "Street name of this road. Press Enter or click away to apply.";
    name.addEventListener("change", () => edit(() => setTag(way, "name", name.value)));
    const oneway = createCheckbox({
      label: "One-way",
      tip: "Traffic only flows in the direction the road was drawn.",
      checked: t.oneway === "yes",
      onChange: (b) => edit(() => setTag(way, "oneway", b ? "yes" : null)),
    });
    host.append(
      heading,
      hw.el,
      surf.el,
      width.el,
      note.el,
      labelled("Name", "Street name of this road.", name),
      oneway.el,
      createButton({
        label: "Delete road (Del)",
        tip: "Remove this road from the map. Undo brings it back.",
        kind: "danger",
        onClick: deleteSelected,
      }),
    );
  } else {
    heading.textContent = `Building ${way.id}`;
    const height = createStepper({
      label: "Height (m)",
      tip: "Height of this building in metres.",
      value: Number.parseFloat(t.height ?? "") || buildingHeight,
      min: 1,
      max: 200,
      step: 0.5,
      coarse: 5,
      decimals: 1,
      onChange: (v) => edit(() => setTag(way, "height", String(v))),
    });
    host.append(
      heading,
      height.el,
      createButton({
        label: "Delete building (Del)",
        tip: "Remove this building from the map. Undo brings it back.",
        kind: "danger",
        onClick: deleteSelected,
      }),
    );
  }
}

function deleteSelected(): void {
  if (selected === undefined) return;
  snapshot();
  const env = selected.kind === "road" ? roads : buildings;
  env.response.elements = env.response.elements.filter((w) => w !== selected?.way);
  selected = undefined;
  refresh("deleted");
}

/** Redraws, updates the info bar and (unless told not to) rebuilds the Select flyout. */
function refresh(message: string, rebuildPanel = true): void {
  requestDraw();
  updateInfo();
  if (rebuildPanel && tool === "select") shell.refreshToolOptions();
  say(message, "info", message !== "selected" && message !== "nothing here");
}

// --- interaction ---
let dragging: { x: number; y: number; moved: boolean; pan: boolean } | undefined;
const worldOf = (e: MouseEvent) => {
  const rect = canvas.getBoundingClientRect();
  return toWorld(e.clientX - rect.left, e.clientY - rect.top);
};
const snapTol = () => Math.max(3, 10 / scale);

canvas.addEventListener("contextmenu", (e) => e.preventDefault());
canvas.addEventListener("mouseleave", () => {
  hover = undefined;
  shell.info.set("cursor", "-");
  requestDraw();
});
canvas.addEventListener("mousedown", (e) => {
  const wantsPan = e.button !== 0 || tool === "select" || tool === "import";
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
    shell.info.set("cursor", fmtXY(hover.x, hover.y));
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

// --- image import (pure maths lives in image-trace.ts / image-import.ts / new-map.ts) ---
// Import is the second stage of File > New... > Import image: the New popup creates a
// FRESH map sized from the image, then this tool traces roads into it (D-06).
const MAX_IMPORT_PIXELS = 25_000_000;
interface ImportImage {
  w: number;
  h: number;
  lum: Uint8Array;
}
let impImage: ImportImage | undefined;
/** Locked scale from the New popup. The world was created to fit exactly. */
let impMPerPx: number | undefined;
let impMask: HTMLCanvasElement | undefined;
let impGraph: RoadGraphPx | undefined;
// Raw (full precision) import parameters; the flyout steppers only DISPLAY them.
let impThreshold = 128;
let impRoadWidth = DEFAULT_IMPORT_ROAD.widthM;
let impHighway = "residential";
let impSurface = "tarmac";
let impSpur = DEFAULT_TRACE_OPTIONS.minSpurPx;
let impSimp = DEFAULT_TRACE_OPTIONS.simplifyPx;
let impSmooth = DEFAULT_TRACE_OPTIONS.smoothIterations;
// Live flyout handles (null while the Image trace flyout is not shown).
let impDerived: { set(t: string): void } | null = null;
let impWarnEl: HTMLElement | null = null;

/** Import always starts at the SW corner of a world made to fit the image. */
const IMPORT_OFFSET = { x: 0, y: 0 } as const;

function impScaleNow(): ImportScale | undefined {
  if (impImage === undefined || impMPerPx === undefined) return undefined;
  try {
    return importScale({ imageW: impImage.w, imageH: impImage.h, mPerPx: impMPerPx });
  } catch {
    return undefined;
  }
}

function impOptions(): Partial<TraceOptions> {
  return {
    threshold: impThreshold,
    minSpurPx: impSpur,
    simplifyPx: impSimp,
    smoothIterations: impSmooth,
  };
}

/** Refreshes the scale readout and warnings in the flyout, then redraws. */
function updateImportUi(): void {
  const scaleNow = impScaleNow();
  if (impImage !== undefined && scaleNow !== undefined) {
    impDerived?.set(
      `${impImage.w} x ${impImage.h} px; ${fmt3(scaleNow.widthM / 1000)} x ${fmt3(scaleNow.heightM / 1000)} km; ${fmt3(scaleNow.mPerPx)} m/px`,
    );
    impWarnEl?.replaceChildren(
      ...scaleNow.warnings.map((w) => {
        const d = document.createElement("div");
        d.className = "es-warn";
        d.textContent = w;
        return d;
      }),
    );
  }
  requestDraw();
}

function rebuildImportMask(): void {
  if (impImage === undefined) {
    impMask = undefined;
    return;
  }
  const { w, h, lum } = impImage;
  const level = impThreshold;
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
  impMPerPx = undefined;
  impMask = undefined;
  impGraph = undefined;
  shell.refreshToolOptions();
  requestDraw();
}

/** Decodes a PNG/JPEG into luminance. Throws an Error with a readable message. */
async function decodeImportFile(file: File): Promise<ImportImage> {
  const bmp = await createImageBitmap(file);
  if (bmp.width * bmp.height > MAX_IMPORT_PIXELS) {
    throw new Error(`Image is ${bmp.width}x${bmp.height}; refusing more than 25 megapixels.`);
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
  return { w: c.width, h: c.height, lum };
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
  const o = IMPORT_OFFSET;
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
  const imageH = impImage.h;
  const toS = (p: { x: number; y: number }) =>
    toScreen(pixelToWorld(p, imageH, s.mPerPx, IMPORT_OFFSET));
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

function previewImport(): void {
  if (impImage === undefined) {
    say("Start with File > New... > Import image.", "error");
    return;
  }
  say("Tracing...", "info", false);
  setTimeout(() => {
    const g = traceImport();
    if (g !== undefined) say(`Preview: ${importCounts(g)} (not imported yet)`);
    requestDraw();
  }, 0);
}

function runImport(): void {
  const s = impScaleNow();
  if (impImage === undefined || s === undefined) {
    say("Start with File > New... > Import image.", "error");
    return;
  }
  // The overlay fix (D-06): traced roads are never added on top of existing roads.
  if (roads.response.elements.length > 0) {
    say(
      "This map already has roads, so the image was not imported on top of them. Undo the earlier import (Ctrl+Z) or start a New map.",
      "error",
    );
    return;
  }
  say("Tracing...", "info", false);
  const image = impImage;
  setTimeout(() => {
    const g = impGraph ?? traceImport();
    if (g === undefined) return;
    snapshot();
    const opts: ImportRoadOptions = {
      widthM: impRoadWidth || DEFAULT_IMPORT_ROAD.widthM,
      highway: impHighway,
      surface: impSurface as Surface,
    };
    const ways = appendImportedRoads(
      roads,
      proj,
      g,
      { imageH: image.h, mPerPx: s.mPerPx, offset: { ...IMPORT_OFFSET } },
      opts,
    );
    const junctions = g.nodes.filter((n) => n.degree >= 3).length;
    impImage = undefined;
    impMPerPx = undefined;
    impMask = undefined;
    impGraph = undefined;
    shell.refreshToolOptions();
    refresh("");
    say(`Imported ${ways.length} roads (${junctions} junctions). Ctrl+S to save.`, "ok");
  }, 0);
}

/**
 * Image trace flyout: the trace stage of a fresh-map import. State is module-level
 * so a tool switch does not lose the loaded image.
 */
function renderImportOptions(host: HTMLElement): void {
  impDerived = null;
  impWarnEl = null;
  if (impImage === undefined || impMPerPx === undefined) {
    host.append(hintText(HINTS.import), hintText("Start with File > New... > Import image."));
    return;
  }

  const thr = createStepper({
    label: "Threshold",
    tip: "Pixels darker than this count as road (0 to 255).",
    value: impThreshold,
    min: 0,
    max: 255,
    step: 1,
    coarse: 16,
    decimals: 0,
    slider: "open",
    onChange: (v) => {
      impThreshold = v;
      impGraph = undefined;
      rebuildImportMask();
      requestDraw();
    },
  });
  const derived = readout("");
  impDerived = derived;
  const rw = createStepper({
    label: "Road width (m)",
    tip: "Width given to every imported road.",
    value: impRoadWidth,
    min: 2,
    max: 40,
    step: 0.5,
    coarse: 4,
    decimals: 1,
    onChange: (v) => {
      impRoadWidth = v;
    },
  });
  const hw = createSelect<string>({
    label: "Highway class",
    tip: "Road class given to every imported road.",
    options: strOptions(HIGHWAY_CLASSES),
    value: impHighway,
    onChange: (v) => {
      impHighway = v;
    },
  });
  const surf = createSelect<string>({
    label: "Surface",
    tip: "Surface given to every imported road.",
    options: strOptions(SURFACES),
    value: impSurface,
    onChange: (v) => {
      impSurface = v;
    },
  });

  const retrace = (): void => {
    impGraph = undefined;
    requestDraw();
  };
  const spur = createStepper({
    label: "Prune spurs shorter than (px)",
    tip: "Dead-end stubs shorter than this are removed from the trace.",
    value: impSpur,
    min: 0,
    max: 1000,
    step: 1,
    coarse: 10,
    decimals: 0,
    onChange: (v) => {
      impSpur = v;
      retrace();
    },
  });
  const simp = createStepper({
    label: "Simplify tolerance (px)",
    tip: "Higher values give fewer, straighter road points.",
    value: impSimp,
    min: 0,
    max: 50,
    step: 0.1,
    coarse: 10,
    decimals: 1,
    onChange: (v) => {
      impSimp = v;
      retrace();
    },
  });
  const smooth = createStepper({
    label: "Smoothing passes",
    tip: "How many times corners are smoothed (0 to 5).",
    value: impSmooth,
    min: 0,
    max: 5,
    step: 1,
    coarse: 1,
    decimals: 0,
    onChange: (v) => {
      impSmooth = v;
      retrace();
    },
  });
  const adv = document.createElement("details");
  const sum = document.createElement("summary");
  sum.textContent = "Advanced tracing (pixels)";
  sum.dataset.tip = "Fine controls for how the traced lines are cleaned up.";
  adv.append(sum, spur.el, simp.el, smooth.el);

  const warn = document.createElement("div");
  impWarnEl = warn;

  host.append(
    hintText(HINTS.import),
    derived.el,
    thr.el,
    rw.el,
    hw.el,
    surf.el,
    adv,
    warn,
    createButton({
      label: "Preview",
      tip: "Trace the image and show the result as dashed lines without changing the map.",
      onClick: previewImport,
    }),
    createButton({
      label: "Import roads",
      tip: "Add the traced roads to this new map. Undo removes them.",
      kind: "primary",
      onClick: runImport,
    }),
    createButton({
      label: "Discard image",
      tip: "Forget the loaded image. The map keeps whatever it already has.",
      onClick: () => {
        clearImport();
        say("Image discarded.", "info");
      },
    }),
  );
  updateImportUi();
}

// --- view helpers ---
function zoomBy(factor: number): void {
  setView(
    zoomAt(currentView(), factor, canvas.width / 2, canvas.height / 2, fitScale / 4, MAX_SCALE),
  );
  requestDraw();
}
function panBy(dx: number, dy: number): void {
  panX -= (dx * canvas.width) / 4;
  panY -= (dy * canvas.height) / 4;
  requestDraw();
}
function fit(): void {
  if (world === undefined) return;
  fitWorld();
  requestDraw();
}

window.addEventListener("beforeunload", (e) => {
  if (dirty) e.preventDefault();
});

function resize(): void {
  canvas.width = canvas.clientWidth;
  canvas.height = canvas.clientHeight;
  if (roads !== undefined) requestDraw();
}

// --- areas + New map popup ---
let knownAreas: string[] = [];
const areaSelect = createSelect<string>({
  tip: "Which map you are editing. Switching asks before discarding unsaved changes.",
  options: [],
  value: "",
  onChange: (v) => void changeArea(v),
});

async function refreshAreas(selectId: string): Promise<void> {
  const areas = await apiJson<string[]>("/__editor/areas");
  knownAreas = areas;
  areaSelect.setOptions(strOptions(areas));
  areaSelect.set(selectId);
}

async function changeArea(id: string): Promise<void> {
  if (id === area) return;
  if (dirty) {
    const ok = await shell.confirm({
      title: "Discard changes?",
      message: `Discard unsaved changes to ${area}?`,
      okLabel: "Discard",
    });
    if (!ok) {
      areaSelect.set(area);
      return;
    }
  }
  try {
    await loadArea(id);
  } catch (err) {
    areaSelect.set(area);
    say(`Could not load ${id}: ${errText(err)}`, "error");
  }
}

/**
 * Creates the files on the server and opens the new map. Returns an error string
 * (shown inside the popup) or null. Discards unsaved work only after a confirm.
 */
async function createWorldOnServer(
  id: string,
  widthKm: number,
  heightKm: number,
): Promise<string | null> {
  if (dirty) {
    const ok = await shell.confirm({
      title: "Discard changes?",
      message: `Discard unsaved changes to ${area}?`,
      okLabel: "Discard",
    });
    if (!ok) return "Not created: you kept your unsaved changes.";
  }
  let register: string[];
  try {
    const out = await apiJson<{ register: string[] }>("/__editor/new-world", {
      method: "POST",
      body: JSON.stringify({ id, widthKm, heightKm }),
    });
    register = out.register;
  } catch (err) {
    return errText(err);
  }
  messageLog.add(`Register "${id}" in tools/map-compiler/cli.ts:\n${register.join("\n")}`);
  try {
    await refreshAreas(id);
    await loadArea(id);
  } catch (err) {
    return `Map files for "${id}" were created, but loading failed: ${errText(err)}. Pick it from the area list.`;
  }
  return null;
}

/** The single New popup: a blank map, or a fresh map sized from an image (D-06). */
function openNewMap(): void {
  const nameInput = document.createElement("input");
  nameInput.type = "text";
  nameInput.placeholder = "my-map";
  nameInput.value = suggestMapId(knownAreas);
  nameInput.dataset.tip = "Name for the new map: lowercase letters, digits and dashes only.";
  let nameTouched = false;
  nameInput.addEventListener("input", () => {
    nameTouched = true;
  });
  const mk = (label: string, tip: string): StepperHandle =>
    createStepper({
      label,
      tip,
      value: 6,
      min: MIN_WORLD_KM,
      max: MAX_WORLD_KM,
      step: 0.5,
      coarse: 2,
      decimals: 3,
      unit: "km",
      onChange: () => {},
    });
  const w = mk("Width", "How wide the new map is, 0.5 to 10 km.");
  const h = mk("Height", "How tall the new map is, 0.5 to 10 km.");

  // Image section (hidden until "Import image..." is pressed).
  let image: ImportImage | undefined;
  let mode: "km" | "mpp" = "km";
  let imgKm = 6;
  let imgMpp = 1;
  const imgBox = document.createElement("div");
  imgBox.hidden = true;
  const fileInput = document.createElement("input");
  fileInput.type = "file";
  fileInput.accept = "image/png,image/jpeg";
  fileInput.dataset.tip = "Pick a PNG or JPEG road map. Dark pixels are treated as road.";
  const readoutLine = readout("no image chosen");
  const warnBox = document.createElement("div");
  let kmStepper: StepperHandle | undefined;
  let mppStepper: StepperHandle | undefined;

  const planNow = (): ImportPlan | undefined =>
    image === undefined
      ? undefined
      : planImportWorld(
          mode === "km"
            ? { imageW: image.w, imageH: image.h, widthKm: imgKm }
            : { imageW: image.w, imageH: image.h, mPerPx: imgMpp },
        );

  const updatePlanUi = (): void => {
    warnBox.replaceChildren();
    if (image === undefined) {
      readoutLine.set("no image chosen");
      return;
    }
    let s: ImportScale | undefined;
    try {
      s =
        mode === "km"
          ? importScale({ imageW: image.w, imageH: image.h, widthKm: imgKm })
          : importScale({ imageW: image.w, imageH: image.h, mPerPx: imgMpp });
    } catch {
      s = undefined;
    }
    if (s === undefined) {
      readoutLine.set("enter a width or metres per pixel");
      return;
    }
    if (mode === "km") mppStepper?.set(s.mPerPx);
    else kmStepper?.set(s.widthM / 1000);
    readoutLine.set(
      `${image.w} x ${image.h} px -> ${fmt3(s.widthM / 1000)} x ${fmt3(s.heightM / 1000)} km at ${fmt3(s.mPerPx)} m/px`,
    );
    const plan = planNow();
    const lines = plan === undefined ? [] : plan.ok ? plan.warnings : [plan.error];
    for (const t of lines) {
      const d = document.createElement("div");
      d.className = "es-warn";
      d.textContent = t;
      warnBox.append(d);
    }
  };

  kmStepper = createStepper({
    label: "Image width",
    tip: "How wide the image is in the real world. The height follows the image shape.",
    unit: "km",
    value: imgKm,
    min: MIN_WORLD_KM,
    max: MAX_WORLD_KM,
    step: 0.1,
    coarse: 1,
    decimals: 3,
    onChange: (v) => {
      imgKm = v;
      mode = "km";
      updatePlanUi();
    },
  });
  mppStepper = createStepper({
    label: "Metres per pixel",
    tip: "Alternative to Image width: how many metres one image pixel covers.",
    value: imgMpp,
    min: 0.01,
    max: 100,
    step: 0.05,
    coarse: 10,
    decimals: 3,
    onChange: (v) => {
      imgMpp = v;
      mode = "mpp";
      updatePlanUi();
    },
  });
  fileInput.addEventListener("change", () => {
    const f = fileInput.files?.[0];
    if (f === undefined) return;
    void decodeImportFile(f).then(
      (img) => {
        image = img;
        if (!nameTouched) nameInput.value = suggestMapId(knownAreas, f.name);
        imgKm = Math.min(MAX_WORLD_KM, Math.max(MIN_WORLD_KM, img.w / 1000));
        mode = "km";
        kmStepper?.set(imgKm);
        updatePlanUi();
      },
      (err: unknown) => {
        image = undefined;
        updatePlanUi();
        warnBox.replaceChildren();
        const d = document.createElement("div");
        d.className = "es-warn";
        d.textContent = `Could not read image: ${errText(err)}`;
        warnBox.append(d);
      },
    );
  });
  imgBox.append(fileInput, kmStepper.el, mppStepper.el, readoutLine.el, warnBox);
  const importBtn = createButton({
    label: "Import image...",
    tip: "Make the new map from a road-map picture instead of a blank size",
    onClick: () => {
      imgBox.hidden = false;
      importBtn.hidden = true;
    },
  });

  const body = document.createElement("div");
  body.append(
    labelled("Name (a-z, 0-9, -)", nameInput.dataset.tip ?? "", nameInput),
    w.el,
    h.el,
    importBtn,
    imgBox,
  );
  void shell.dialog({
    title: "New map",
    body,
    actions: [
      { id: "cancel", label: "Cancel", tip: "Close without creating anything" },
      {
        id: "blank",
        label: "Create blank map",
        tip: "Create an empty map of the Width and Height above and open it",
        primary: true,
        run: async () => {
          const id = nameInput.value.trim();
          const wk = w.get();
          const hk = h.get();
          const bad = validateNewMapInput({ id, widthKm: wk, heightKm: hk }, knownAreas);
          if (bad !== null) return bad;
          const err = await createWorldOnServer(id, wk, hk);
          if (err !== null) return err;
          say(
            `Created "${id}" (${fmt3(wk)} x ${fmt3(hk)} km). Saving works now; to compile or drive it, add its two lines to tools/map-compiler/cli.ts (Help > Show log).`,
            "ok",
          );
          return null;
        },
      },
      {
        id: "image",
        label: "Create from image",
        tip: "Create a new map sized from the image, then trace its roads",
        run: async () => {
          if (image === undefined) return "Choose an image first.";
          const plan = planNow();
          if (plan === undefined) return "Choose an image first.";
          if (!plan.ok) return plan.error;
          const id = nameInput.value.trim();
          const bad = validateNewMapInput(
            { id, widthKm: plan.widthKm, heightKm: plan.heightKm },
            knownAreas,
          );
          if (bad !== null) return bad;
          const err = await createWorldOnServer(id, plan.widthKm, plan.heightKm);
          if (err !== null) return err;
          // loadArea cleared any pending import; set the image after the fresh map loads.
          impImage = image;
          impMPerPx = plan.mPerPx;
          impGraph = undefined;
          rebuildImportMask();
          shell.setTool("import");
          shell.refreshToolOptions();
          say(
            `New map "${id}" created from the image. Adjust the threshold, Preview, then Import roads.`,
            "ok",
          );
          return null;
        },
      },
    ],
  });
}

// --- dialogs ---
const closeAction = [{ id: "close", label: "Close", tip: "Close this window" }];

function showSurfaceColours(): void {
  const body = document.createElement("div");
  body.className = "es-legend";
  for (const s of SURFACES) {
    const row = document.createElement("div");
    const sw = document.createElement("span");
    sw.className = "es-swatch";
    sw.style.background = SURFACE_COLOUR[s];
    row.append(sw, document.createTextNode(` ${s}`));
    body.append(row);
  }
  void shell.dialog({ title: "Surface colours", body, actions: closeAction });
}

// --- shortcuts ---
const bindings: Binding[] = [
  {
    code: "KeyS",
    ctrl: true,
    label: "Ctrl+S",
    description: "Save",
    allowInTextEntry: true,
    run: () => void save(),
  },
  { code: "KeyZ", ctrl: true, label: "Ctrl+Z", description: "Undo", run: undo },
  { code: "KeyZ", ctrl: true, shift: true, label: "Ctrl+Shift+Z", description: "Redo", run: redo },
  { code: "KeyY", ctrl: true, label: "Ctrl+Y", description: "Redo", run: redo },
  { code: "KeyV", label: "V", description: "Select tool", run: () => shell.setTool("select") },
  { code: "KeyR", label: "R", description: "Draw road tool", run: () => shell.setTool("road") },
  { code: "KeyM", label: "M", description: "Move node tool", run: () => shell.setTool("move") },
  { code: "KeyB", label: "B", description: "Building tool", run: () => shell.setTool("building") },
  { code: "KeyI", label: "I", description: "Image trace tool", run: () => shell.setTool("import") },
  { code: "KeyF", label: "F", description: "Fit the whole world", run: fit },
  { code: "Delete", label: "Delete", description: "Delete the selection", run: deleteSelected },
  {
    code: "Backspace",
    label: "Backspace",
    description: "Delete the selection",
    run: deleteSelected,
  },
  {
    code: "Enter",
    label: "Enter",
    description: "Finish the road being drawn",
    enabled: () => tool === "road",
    run: finishRoad,
  },
  {
    code: "Escape",
    label: "Esc",
    description: "Cancel the road or rectangle being drawn",
    run: () => {
      roadPoints = [];
      rectStart = undefined;
      requestDraw();
    },
  },
  { code: "ArrowLeft", label: "Arrow keys", description: "Pan the view", run: () => panBy(-1, 0) },
  { code: "ArrowRight", label: "Right", description: "Pan right", run: () => panBy(1, 0) },
  { code: "ArrowUp", label: "Up", description: "Pan up", run: () => panBy(0, -1) },
  { code: "ArrowDown", label: "Down", description: "Pan down", run: () => panBy(0, 1) },
];

// --- shell ---
function driveCompile(): void {
  const tab = window.open("about:blank", "_blank");
  void compile().then((ok) => {
    if (tab === null) return;
    if (ok) tab.location.href = `/?map=${encodeURIComponent(area)}`;
    else tab.close();
  });
}

const newButton = createButton({
  label: "New",
  tip: "Create a blank map, or a map from an image",
  onClick: openNewMap,
});

shell = createShell({
  root: document.getElementById("app") as HTMLElement,
  title: "Map editor",
  topbarExtras: [newButton, areaSelect.el],
  initialTool: "select",
  onToolChange,
  tools: [
    {
      id: "select",
      label: "Select",
      icon: "▭",
      tip: "Click a road or building to edit it",
      shortcut: "V",
      renderOptions: renderSelectOptions,
    },
    {
      id: "road",
      label: "Draw road",
      icon: "╱",
      tip: "Click points to draw a road",
      shortcut: "R",
      renderOptions: renderRoadOptions,
    },
    {
      id: "move",
      label: "Move node",
      icon: "✥",
      tip: "Drag a road node to move it",
      shortcut: "M",
      renderOptions: (host) => host.append(hintText(HINTS.move)),
    },
    {
      id: "building",
      label: "Building",
      icon: "▣",
      tip: "Drag a rectangle to add a building",
      shortcut: "B",
      renderOptions: renderBuildingOptions,
    },
    {
      id: "import",
      label: "Image trace",
      icon: "▦",
      tip: "Trace roads from an image",
      shortcut: "I",
      renderOptions: renderImportOptions,
    },
  ],
  menus: [
    {
      label: "File",
      tip: "Create, save and compile maps",
      items: [
        { label: "New...", tip: "Create a blank map, or a map from an image", run: openNewMap },
        {
          label: "Save",
          tip: "Write the roads and buildings to disk",
          shortcut: "Ctrl+S",
          run: () => void save(),
        },
        {
          label: "Save & compile",
          tip: "Save, then rebuild the game map",
          run: () => void compile(),
        },
        {
          label: "Compile & drive",
          tip: "Save, compile and open the map in the game",
          run: driveCompile,
        },
      ],
    },
    {
      label: "View",
      tip: "Grid, tile and zoom options",
      items: [
        {
          label: "Show grid",
          tip: "Show or hide the metre grid",
          checked: () => showGrid,
          run: () => {
            showGrid = !showGrid;
            requestDraw();
          },
        },
        {
          label: "Show tiles",
          tip: "Show or hide the game tile boundaries",
          checked: () => showTiles,
          run: () => {
            showTiles = !showTiles;
            requestDraw();
          },
        },
        "separator",
        ...TILE_SIZES_M.map((m) => ({
          label: `Tile size ${m} m`,
          tip: `Draw tile boundaries every ${m} m`,
          checked: () => tileM === m,
          run: () => {
            tileM = m;
            updateInfo();
            requestDraw();
          },
        })),
        "separator" as const,
        { label: "Fit world", tip: "Zoom to show the whole map", shortcut: "F", run: fit },
      ],
    },
    {
      label: "Import",
      tip: "Bring in outside data",
      items: [
        {
          label: "Image trace...",
          tip: "Open the image trace tool (start with File > New... > Import image)",
          run: () => shell.setTool("import"),
        },
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
          tip: "What each road colour means",
          run: showSurfaceColours,
        },
        {
          label: "Show log...",
          tip: "Every message and the full compile output",
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
  history: { onUndo: undo, onRedo: redo },
  view: {
    onZoomIn: () => zoomBy(1.25),
    onZoomOut: () => zoomBy(0.8),
    onFit: fit,
    onPan: panBy,
  },
  infoFields: [
    { key: "area", label: "Area", tip: "The map being edited" },
    { key: "world", label: "World", tip: "Width x height of the map in km" },
    { key: "tile", label: "Tile", tip: "Tile size used for the tile overlay" },
    { key: "cursor", label: "Cursor", tip: "Mouse position in metres from the south-west corner" },
    { key: "counts", label: "Contents", tip: "How many roads and buildings the map has" },
  ],
});
shell.canvasHost.append(canvas);
new ResizeObserver(resize).observe(shell.canvasHost);
installShortcuts(bindings, shell.isDialogOpen);

async function main(): Promise<void> {
  resize();
  const areas = await apiJson<string[]>("/__editor/areas");
  knownAreas = areas;
  areaSelect.setOptions(strOptions(areas));
  const initial = areas.includes("my-map") ? "my-map" : (areas[0] ?? "");
  areaSelect.set(initial);
  await loadArea(initial);
  shell.setTool("select");
  reportMissingTips(document.body);
}

main().catch((err: unknown) => {
  say(`Could not start the editor: ${errText(err)}`, "error");
});
