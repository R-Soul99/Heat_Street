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
  DEFAULT_IMPORT_ROAD,
  type ImportRoadOptions,
  planImportWorld,
} from "./image-import.ts";
import { DEFAULT_TRACE_OPTIONS, imageToRoadGraph, type TraceOptions } from "./image-trace.ts";
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
import { checkRoads } from "./road-check.ts";
import {
  type Box,
  buildingsInBox,
  disableRoad,
  enableRoad,
  isDisabledRoad,
  waysInBox,
} from "./select-box.ts";
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

type Tool = "select" | "road" | "move" | "building" | "eraser";
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
  select:
    "Click a road or building to edit it. Drag a box to select many roads and buildings, then press Delete. Right- or middle-drag pans; Ctrl+arrows pan; F fits the world.",
  road: "Click centre-line points; double-click or Enter to finish; Esc cancels. Clicking a road or node connects to it. [ ] change the width.",
  move: "Drag a road node to move it (shared by every road that meets there).",
  building: "Click and drag a rectangle to add a building. [ ] change the height.",
  eraser:
    "Click or drag over roads and buildings to delete them. One drag = one Undo. [ ] change the size.",
};
const ERASER_SIZE_SPEC: StepperSpec = { step: 1, coarse: 5, min: 1, max: 50, decimals: 0 };
let eraserSize = 5;
let eraseRoads = true;
let eraseBuildings = true;
let erasing = false;
let erasedThisDrag = 0;
let sizeStepper: ReturnType<typeof createStepper> | undefined;
// Box select state: the finished box, what is inside it, and the ticked types.
let boxRect: Box | undefined;
let boxStart: { x: number; y: number } | undefined;
let boxHit: { roads: RawWay[]; buildings: RawWay[] } = { roads: [], buildings: [] };
let tickRoads = true;
let tickBuildings = true;

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
    fitWorld();
    refresh(`Loaded ${id}.`);
    return true;
  } catch (err) {
    setStatus(`Could not load "${id}": ${errText(err)}`, "error");
    return false;
  }
}

const DRAWING_PATH = (id: string): string => `tools/map-compiler/areas/${id}.*`;
const PLAYABLE_PATH = (id: string): string => `public/maps/${id}.*`;
const TERRAIN_EDITOR_URL = "/tools/terrain-editor/index.html";

/** True when a map is open; otherwise points the user at the start screen. */
function requireMap(): boolean {
  if (roads !== undefined) return true;
  setStatus("Open or create a map first (File > Start screen).", "error");
  return false;
}

async function save(): Promise<boolean> {
  if (!requireMap()) return false;
  try {
    const put = (kind: string, body: RawEnvelope) =>
      api(`/__editor/raw/${area}/${kind}`, { method: "PUT", body: JSON.stringify(body) });
    await put("roads", roads);
    await put("buildings", buildings);
    dirty = false;
    const msg = `Saved drawing to ${DRAWING_PATH(area)} (roads and buildings).`;
    refresh(msg);
    shell.info.status(msg, "ok");
    return true;
  } catch (err) {
    setStatus(`Save failed: ${errText(err)}`, "error");
    return false;
  }
}

/**
 * Runs the compiler's road check here and only REPORTS (it never changes or
 * deletes anything). Returns true when the roads will pass the compiler's
 * validation. A problem selects the first offending road and explains it in
 * the info bar.
 */
function checkRoadsReport(): boolean {
  const { problems } = checkRoads(area, roads);
  if (problems.length === 0) {
    refresh("Roads OK - ready to compile.");
    shell.info.status("Roads OK - ready to compile.", "ok");
    return true;
  }
  const first = problems[0];
  const way = roads.response.elements.find((w) => w.id === first.wayId);
  if (way !== undefined) selected = { kind: "road", way };
  refresh("");
  const more = problems.length > 1 ? ` (+${problems.length - 1} more)` : "";
  setStatus(
    `${first.text}${way !== undefined ? " It is selected." : ""}${more} Fix it by hand, then try again.`,
    "error",
  );
  $("log-text").textContent = problems
    .map((p) => `- ${p.text}${p.wayId ? ` (road ${p.wayId})` : ""}`)
    .join("\n");
  return false;
}

async function compile(): Promise<boolean> {
  try {
    if (!requireMap() || !checkRoadsReport()) return false;
    if (!(await save())) return false;
    const logText = $("log-text");
    logText.textContent = "compiling...";
    setStatus(`Compiling ${area}...`);
    const res = await fetch(`/__editor/compile/${area}`, { method: "POST" });
    logText.textContent = await res.text();
    if (res.ok && res.headers.get("X-Compile-Ok") === "1") {
      setStatus(
        `Saved drawing to ${DRAWING_PATH(area)}; playable map to ${PLAYABLE_PATH(area)}. Reload the game tab to see it.`,
        "ok",
      );
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
  if (!requireMap()) return;
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
  const boxedRoads = new Set(boxHit.roads);
  const boxedBuildings = new Set(boxHit.buildings);
  for (const b of buildings.response.elements) {
    const lw = localWay(b);
    if (!visible(lw, 0)) continue;
    trace(lw);
    ctx.closePath();
    ctx.fillStyle = b === selected?.way || boxedBuildings.has(b) ? "#ff6" : "#4a3f3a";
    ctx.fill();
  }
  const drawRoad = (way: RawWay, lw: LocalWay, colour: string, extra: number) => {
    const w = Number.parseFloat(way.tags?.width ?? "") || DEFAULT_WIDTH_M;
    trace(lw);
    ctx.strokeStyle = colour;
    ctx.lineWidth = Math.max(1.5, w * scale) + extra;
    ctx.lineCap = isDisabledRoad(way) ? "butt" : "round";
    ctx.lineJoin = "round";
    ctx.setLineDash(isDisabledRoad(way) ? [6, 4] : []);
    ctx.stroke();
    ctx.setLineDash([]);
  };
  for (const way of roads.response.elements) {
    const lw = localWay(way);
    if (!visible(lw, DEFAULT_WIDTH_M + 20)) continue;
    if (way === selected?.way || boxedRoads.has(way)) drawRoad(way, lw, "#ff6", 4);
    drawRoad(way, lw, isDisabledRoad(way) ? "#777" : SURFACE_COLOUR[effectiveSurface(way.tags)], 0);
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
  const liveBox: Box | undefined =
    boxStart !== undefined && hover !== undefined ? { a: boxStart, b: hover } : boxRect;
  if (tool === "select" && liveBox !== undefined) {
    const a = toScreen(liveBox.a);
    const b = toScreen(liveBox.b);
    ctx.fillStyle = "rgba(80,170,255,0.12)";
    ctx.fillRect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(a.x - b.x), Math.abs(a.y - b.y));
    ctx.setLineDash([6, 4]);
    ctx.strokeStyle = "#5af";
    ctx.lineWidth = 1.5;
    ctx.strokeRect(
      Math.min(a.x, b.x),
      Math.min(a.y, b.y),
      Math.abs(a.x - b.x),
      Math.abs(a.y - b.y),
    );
    ctx.setLineDash([]);
  }
  if (tool === "eraser" && hover !== undefined) {
    const c = toScreen(hover);
    ctx.beginPath();
    ctx.arc(c.x, c.y, eraserTol() * scale, 0, Math.PI * 2);
    ctx.strokeStyle = erasing ? "#f55" : "#fa8";
    ctx.lineWidth = 1.5;
    ctx.stroke();
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
  sizeStepper = undefined;
  boxRect = undefined;
  boxStart = undefined;
  boxHit = { roads: [], buildings: [] };
  erasing = false;
  const fly = shell.flyout;
  // The tool's help goes to the info bar, not the flyout, so an empty flyout
  // (Select with nothing selected, Move) hides instead of covering the map.
  fly.replaceChildren();
  fly.hidden = false;
  setStatus(HINTS[next]);
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
  } else if (next === "eraser") {
    sizeStepper = createStepper({
      value: eraserSize,
      spec: ERASER_SIZE_SPEC,
      unit: "m",
      tip: "Eraser size in metres ([ ] also change it)",
      onChange: (v) => {
        eraserSize = v;
        requestDraw();
      },
    });
    fly.append(
      createField("Size", sizeStepper.el),
      createToggle({
        label: "Roads",
        checked: eraseRoads,
        tip: "Erase roads",
        onChange: (v) => {
          eraseRoads = v;
        },
      }).el,
      createToggle({
        label: "Buildings",
        checked: eraseBuildings,
        tip: "Erase buildings",
        onChange: (v) => {
          eraseBuildings = v;
        },
      }).el,
    );
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
  if (boxRect === undefined && selected === undefined) {
    box.replaceChildren();
    shell.flyout.hidden = true;
    return;
  }
  shell.flyout.hidden = false;
  if (boxRect !== undefined) {
    renderBoxPanel(box);
    return;
  }
  if (selected === undefined) return;
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
    const disabledNow = isDisabledRoad(way);
    const toggleBtn = createButton({
      label: disabledNow ? "Enable road" : "Disable road",
      tip: disabledNow
        ? "Put this road back in the compiled map"
        : "Keep this road in the file but leave it out when compiling (Undo or Enable brings it back)",
      onClick: () => {
        snapshot();
        if (disabledNow) enableRoad(way);
        else disableRoad(way);
        refresh(disabledNow ? "road enabled" : "road disabled");
      },
    });
    parts.push(
      createField("Name", name),
      createField("Road class", highway.el),
      createField("Surface", surface.el),
      createField("Width", width.el),
      oneway.el,
      toggleBtn,
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

/** Recomputes what is inside the box (after an edit or undo). */
function recomputeBox(): void {
  if (boxRect === undefined) {
    boxHit = { roads: [], buildings: [] };
    return;
  }
  boxHit = {
    roads: waysInBox(roads, proj, boxRect),
    buildings: buildingsInBox(buildings, proj, boxRect),
  };
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

function removeWays(env: RawEnvelope, ways: readonly RawWay[]): void {
  const gone = new Set(ways);
  env.response.elements = env.response.elements.filter((w) => !gone.has(w));
}

function boxAction(kind: "delete" | "disable" | "enable" | "all"): void {
  const roadsToDelete = kind === "all" || (kind === "delete" && tickRoads) ? boxHit.roads : [];
  const buildingsToDelete =
    kind === "all" || (kind === "delete" && tickBuildings) ? boxHit.buildings : [];
  const toDisable =
    kind === "disable" && tickRoads ? boxHit.roads.filter((w) => !isDisabledRoad(w)) : [];
  const toEnable = kind === "enable" && tickRoads ? boxHit.roads.filter(isDisabledRoad) : [];
  const total =
    roadsToDelete.length + buildingsToDelete.length + toDisable.length + toEnable.length;
  if (total === 0) {
    setStatus("Nothing ticked inside the box.", "error");
    return;
  }
  snapshot();
  removeWays(roads, roadsToDelete);
  removeWays(buildings, buildingsToDelete);
  for (const w of toDisable) disableRoad(w);
  for (const w of toEnable) enableRoad(w);
  const parts: string[] = [];
  if (roadsToDelete.length + buildingsToDelete.length > 0) {
    parts.push(
      `deleted ${plural(roadsToDelete.length, "road")}, ${plural(buildingsToDelete.length, "building")}`,
    );
  }
  if (toDisable.length > 0) parts.push(`disabled ${plural(toDisable.length, "road")}`);
  if (toEnable.length > 0) parts.push(`enabled ${plural(toEnable.length, "road")}`);
  refresh(parts.join("; "));
}

function clearBox(): void {
  boxRect = undefined;
  boxStart = undefined;
  boxHit = { roads: [], buildings: [] };
  refresh("");
}

function renderBoxPanel(host: HTMLElement): void {
  recomputeBox();
  const nR = boxHit.roads.length;
  const nB = boxHit.buildings.length;
  const nDisabled = boxHit.roads.filter(isDisabledRoad).length;
  const roadsTicked = tickRoads && nR > 0;
  const buildingsTicked = tickBuildings && nB > 0;
  const tRoads = createToggle({
    label: `Roads (${nR})`,
    checked: roadsTicked,
    tip: "Include the roads inside the box",
    onChange: (v) => {
      tickRoads = v;
      renderSelection();
    },
  });
  const tBuild = createToggle({
    label: `Buildings (${nB})`,
    checked: buildingsTicked,
    tip: "Include the buildings inside the box",
    onChange: (v) => {
      tickBuildings = v;
      renderSelection();
    },
  });
  const tObj = createToggle({
    label: "Objects (0)",
    checked: false,
    tip: "Placeable objects (trees, hedges, fences) arrive in a later phase.",
    onChange: () => {},
  });
  (tObj.el.querySelector("input") as HTMLInputElement).disabled = true;
  const delBtn = createButton({
    label: "Delete ticked",
    tip: "Delete the ticked types inside the box (one Undo step)",
    kind: "danger",
    onClick: () => boxAction("delete"),
  });
  delBtn.disabled = !(roadsTicked || buildingsTicked);
  const disBtn = createButton({
    label: "Disable ticked roads",
    tip: "Keep the roads in the file but leave them out when compiling. Buildings cannot be disabled, only deleted.",
    onClick: () => boxAction("disable"),
  });
  disBtn.disabled = !roadsTicked || nR - nDisabled === 0;
  const parts: HTMLElement[] = [
    el("b", undefined, "Inside the box:"),
    tRoads.el,
    tBuild.el,
    tObj.el,
    delBtn,
    disBtn,
  ];
  if (nDisabled > 0) {
    parts.push(
      createButton({
        label: "Enable ticked roads",
        tip: "Put the disabled roads in the box back into the compiled map",
        onClick: () => boxAction("enable"),
      }),
    );
  }
  parts.push(
    createButton({
      label: "Delete all inside",
      tip: "Delete every road and building inside the box, ignoring the tickboxes",
      kind: "danger",
      onClick: () => boxAction("all"),
    }),
    createButton({
      label: "Clear box",
      tip: "Forget the box without changing anything (Esc)",
      onClick: clearBox,
    }),
  );
  host.replaceChildren(...parts);
}

function deleteSelected(): void {
  if (boxRect !== undefined) {
    boxAction("delete");
    return;
  }
  if (selected === undefined) return;
  snapshot();
  const env = selected.kind === "road" ? roads : buildings;
  env.response.elements = env.response.elements.filter((w) => w !== selected?.way);
  selected = undefined;
  refresh("deleted");
}

function refresh(message: string): void {
  if (boxRect !== undefined) recomputeBox();
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
const eraserTol = () => Math.max(eraserSize, 8 / scale);

/** Deletes the road and/or building under `p`; the first deletion of a drag takes the one snapshot. */
function eraseAt(p: { x: number; y: number }): void {
  const tol = eraserTol();
  const road = eraseRoads ? pickRoad(p, roads.response.elements, proj, tol) : undefined;
  const building = eraseBuildings ? pickBuilding(p, buildings.response.elements, proj) : undefined;
  if (road === undefined && building === undefined) return;
  if (erasedThisDrag === 0) snapshot();
  if (road !== undefined) removeWays(roads, [road]);
  if (building !== undefined) removeWays(buildings, [building]);
  erasedThisDrag += (road ? 1 : 0) + (building ? 1 : 0);
  selected = undefined;
  geometryVersion++;
  requestDraw();
  updateInfo();
}

canvas.addEventListener("contextmenu", (e) => e.preventDefault());
canvas.addEventListener("mousedown", (e) => {
  if (roads === undefined) return;
  const wantsPan = e.button !== 0;
  dragging = { x: e.clientX, y: e.clientY, moved: false, pan: wantsPan };
  if (e.button === 0 && tool === "select") boxStart = worldOf(e);
  else if (e.button === 0 && tool === "eraser") {
    erasing = true;
    erasedThisDrag = 0;
    eraseAt(worldOf(e));
  } else if (e.button === 0 && tool === "move") {
    const n = pickNode(worldOf(e), roads, proj, snapTol());
    if (n !== undefined) {
      snapshot();
      movingNode = n.nodeId;
      dragging.pan = false;
    } else dragging.pan = true;
  } else if (e.button === 0 && tool === "building") rectStart = worldOf(e);
});
window.addEventListener("mousemove", (e) => {
  if (roads === undefined) return;
  if (e.target === canvas) {
    hover = worldOf(e);
    shell.info.set("cursor", `x ${fmt3(Math.round(hover.x))}, y ${fmt3(Math.round(hover.y))} m`);
    if (roadPoints.length > 0 || rectStart !== undefined || tool === "eraser" || boxStart)
      requestDraw();
  }
  if (dragging === undefined) return;
  if (erasing) {
    eraseAt(worldOf(e));
    return;
  }
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
  if (roads === undefined) return;
  const d = dragging;
  dragging = undefined;
  if (d === undefined || e.button !== 0) return;
  if (erasing) {
    erasing = false;
    const n = erasedThisDrag;
    erasedThisDrag = 0;
    refresh(n > 0 ? `erased ${n} item${n === 1 ? "" : "s"}` : "");
    return;
  }
  if (tool === "select" && boxStart !== undefined) {
    const a = boxStart;
    boxStart = undefined;
    if (d.moved) {
      boxRect = { a, b: worldOf(e) };
      selected = undefined;
      recomputeBox();
      tickRoads = boxHit.roads.length > 0;
      tickBuildings = boxHit.buildings.length > 0;
      refresh(
        `${plural(boxHit.roads.length, "road")}, ${plural(boxHit.buildings.length, "building")} inside the box`,
      );
      return;
    }
    boxRect = undefined;
    boxHit = { roads: [], buildings: [] };
  }
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
  if (roads === undefined) return;
  if (tool !== "road") return;
  // The two clicks of the double-click each added a point; drop the duplicate.
  roadPoints.pop();
  finishRoad();
});
canvas.addEventListener(
  "wheel",
  (e) => {
    e.preventDefault();
    if (roads === undefined) return;
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
  if (roads === undefined) return;
  fitWorld();
  requestDraw();
}
function cancelDrawing(): void {
  roadPoints = [];
  rectStart = undefined;
  boxStart = undefined;
  if (boxRect !== undefined) clearBox();
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
  if (tool === "eraser" && sizeStepper !== undefined) {
    eraserSize = apply(eraserSize, ERASER_SIZE_SPEC);
    sizeStepper.set(eraserSize);
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
  KeyE: "eraser",
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
  if (typing || dialogOpen || roads === undefined) return;
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
  if (!requireMap()) return;
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

interface MapStatus {
  registered: boolean;
  format: "legacy" | "terrain" | null;
  hasTerrain: boolean;
  hasCompiled: boolean;
}

const para = (text: string): HTMLElement => {
  const p = el("p", undefined, text);
  p.style.margin = "6px 0";
  return p;
};

/**
 * The first thing the editor shows (nothing is loaded automatically): start a
 * new map, import an image, or open one of your existing maps.
 */
async function openStartScreen(): Promise<void> {
  let areas: string[] = [];
  try {
    areas = await api<string[]>("/__editor/areas");
  } catch (err) {
    setStatus(`Could not list maps: ${errText(err)}`, "error");
  }
  const pick = createSelect({
    options: areas.map((a) => ({ value: a, label: a })),
    value: areas.includes(area) ? area : (areas[0] ?? ""),
    tip: "Choose which existing map to open",
    onChange: () => {},
  });
  const body = el("div");
  body.append(
    para(
      "Draw or import a road layout here. When it looks right, press Open in terrain editor to shape the ground and drive it.",
    ),
    para("Drag a box to select many roads and buildings, then press Delete (use the Select tool)."),
    para("Nothing is opened automatically. Pick one:"),
    createField("Open an existing map", pick.el),
  );
  const r = await openDialog({
    title: "Heat Street map editor",
    body,
    actions: [
      {
        id: "open",
        label: "Open existing map",
        tip: "Open the map chosen above for editing",
        primary: areas.length > 0,
      },
      { id: "new", label: "New map...", tip: "Create a new blank map" },
      {
        id: "import",
        label: "Import image...",
        tip: "Trace roads from a black-and-white road image into a new map",
      },
      {
        id: "cancel",
        label: "Close",
        tip: "Close this screen without opening anything (File > Start screen brings it back)",
      },
    ],
  });
  if (r === "new") await openNewMapDialog("blank");
  else if (r === "import") await openNewMapDialog("image");
  else if (r === "open" && pick.get() !== "") {
    if (await confirmDiscard()) await loadArea(pick.get());
  } else if (roads === undefined) {
    setStatus("No map open. Use File > Start screen to open or create one.");
  }
}

/**
 * Save, compile, convert to the terrain format and open the terrain editor.
 * Reports in plain English what was written and where.
 */
async function openInTerrainEditor(): Promise<void> {
  if (!requireMap()) return;
  const id = area;
  const go = (): void => {
    window.location.href = `${TERRAIN_EDITOR_URL}?area=${encodeURIComponent(id)}`;
  };
  let status: MapStatus;
  try {
    status = await api<MapStatus>(`/__editor/status/${id}`);
  } catch (err) {
    setStatus(`Could not check ${id}: ${errText(err)}`, "error");
    return;
  }
  if (!status.registered) {
    setStatus(
      `${id} is a built-in or imported map that cannot be converted here. Make a map with File > Start screen instead.`,
      "error",
    );
    return;
  }
  if (status.hasTerrain) {
    const choice = await openDialog({
      title: "A terrain version already exists",
      body: para(
        "Opening it keeps every terrain edit you made. Replacing it converts this drawing again and throws those terrain edits away.",
      ),
      actions: [
        {
          id: "open",
          label: "Open existing terrain map",
          tip: "Keep the terrain version as it is (with all your terrain edits) and open it in the terrain editor",
          primary: true,
        },
        {
          id: "replace",
          label: "Replace it from this drawing",
          tip: "Convert this drawing again. This REPLACES the terrain version and throws away every terrain edit you made there.",
        },
        { id: "cancel", label: "Cancel", tip: "Do nothing" },
      ],
    });
    if (choice === "cancel") return;
    if (choice === "open") {
      if (dirty && !(await save())) return;
      go();
      return;
    }
  }
  if (!checkRoadsReport()) return;
  if (!(await save())) return;
  setStatus(`Compiling and converting ${id}... this can take a little while.`);
  const logText = $("log-text");
  logText.textContent = "compiling and converting...";
  let out: {
    ok: boolean;
    log?: string;
    error?: string;
    summary?: { cols: number; rows: number; cellSizeM: number; vertices: number };
  };
  try {
    const res = await fetch(`/__editor/to-terrain/${id}`, { method: "POST" });
    out = (await res.json()) as typeof out;
  } catch (err) {
    setStatus(`Could not convert ${id}: ${errText(err)}`, "error");
    return;
  }
  if (out.log !== undefined) logText.textContent = out.log;
  if (!out.ok || out.summary === undefined) {
    setStatus(`${out.error ?? "Conversion failed."} See File > Show compile log.`, "error");
    return;
  }
  const g = out.summary;
  const done = `Saved drawing to ${DRAWING_PATH(id)}; playable map to ${PLAYABLE_PATH(id)}; terrain map to public/maps/${id}.terrain.*`;
  setStatus(done, "ok");
  const body = el("div");
  body.append(
    para(`${done}.`),
    para(
      `The ground is a ${g.cols} x ${g.rows} grid of ${g.cellSizeM} m squares (${g.vertices.toLocaleString("en-GB")} points). Shape it in the terrain editor, then drive it in the game with ?map=${id}.`,
    ),
  );
  const r = await openDialog({
    title: "Ready for the terrain editor",
    body,
    actions: [
      {
        id: "go",
        label: "Open terrain editor",
        tip: "Go to the terrain editor with this map loaded",
        primary: true,
      },
      { id: "stay", label: "Stay here", tip: "Keep editing the drawing in this editor" },
    ],
  });
  if (r === "go") go();
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
            id: "start",
            label: "Start screen...",
            tip: "Go back to the start screen: new map, import an image or open an existing map",
            run: () => run(openStartScreen()),
          },
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
            id: "fix-roads",
            label: "Check roads",
            tip: "Run the compiler's road check now and report any problem. It never changes your roads.",
            run: () => void (requireMap() && checkRoadsReport()),
          },
          {
            id: "compile",
            label: "Save & compile",
            tip: "Save, then run the map compiler so the game sees your edits",
            run: () => run(compile()),
          },
          {
            id: "to-terrain",
            label: "Open in terrain editor",
            tip: "Save, compile, turn this map into a terrain map and open it in the terrain editor, where you shape the ground and drive it",
            run: () => run(openInTerrainEditor()),
          },
          {
            id: "drive",
            label: "Test drive (compile first)",
            tip: "Save, compile, then drive the compiled map in the game in a new tab. Once a map has been opened in the terrain editor the game uses its terrain version.",
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
            run: () => openNewMapDialog("blank"),
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
            run: () => openNewMapDialog("image"),
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
        tip: "Select: click a road or building to edit it. Drag a box to select many roads and buildings, then press Delete.",
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
      {
        id: "eraser",
        label: "Eraser",
        icon: "⌫",
        keyLabel: "E",
        tip: "Eraser: click or drag over roads and buildings to delete them. One drag = one Undo.",
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

// --- New map popup: blank map or fresh map traced from an image (D-06) ---
// Pure maths lives in image-trace.ts / image-import.ts. Importing never touches
// the currently open map: it always creates a new one and traces into it at 0,0.
const MAX_IMPORT_PIXELS = 25_000_000;
const NAME_RE = /^[a-z0-9-]{1,64}$/;
const WORLD_KM_SPEC: StepperSpec = { step: 0.1, coarse: 10, min: 0.5, max: 10, decimals: 3 };
// Wider than the legal range so a typed 12 reaches validation instead of being clamped silently.
const IMPORT_KM_SPEC: StepperSpec = { step: 0.1, coarse: 10, min: 0.01, max: 100, decimals: 3 };
const THUMB_MAX_PX = 240;

interface ImportImage {
  w: number;
  h: number;
  lum: Uint8Array;
}

async function readImageFile(file: File): Promise<ImportImage> {
  const bmp = await createImageBitmap(file);
  if (bmp.width * bmp.height > MAX_IMPORT_PIXELS) {
    const mp = fmt3((bmp.width * bmp.height) / 1_000_000);
    throw new Error(`Image is ${mp} MP; the limit is 25 MP.`);
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

/** Draws the thresholded mask (dark = road) into a small canvas. */
function drawMaskThumb(target: HTMLCanvasElement, img: ImportImage, level: number): void {
  const k = Math.min(1, THUMB_MAX_PX / img.w);
  const tw = Math.max(1, Math.round(img.w * k));
  const th = Math.max(1, Math.round(img.h * k));
  target.width = tw;
  target.height = th;
  const g = target.getContext("2d") as CanvasRenderingContext2D;
  const data = g.createImageData(tw, th);
  for (let y = 0; y < th; y++) {
    const sy = Math.min(img.h - 1, Math.floor(y / k));
    for (let x = 0; x < tw; x++) {
      const sx = Math.min(img.w - 1, Math.floor(x / k));
      const road = (img.lum[sy * img.w + sx] as number) < level;
      const o = (y * tw + x) * 4;
      data.data[o] = road ? 255 : 24;
      data.data[o + 1] = road ? 170 : 26;
      data.data[o + 2] = road ? 40 : 30;
      data.data[o + 3] = 255;
    }
  }
  g.putImageData(data, 0, 0);
}

function firstFreeMapName(areas: string[]): string {
  for (let n = 1; ; n++) if (!areas.includes(`map-${n}`)) return `map-${n}`;
}

async function openNewMapDialog(mode: "blank" | "image"): Promise<void> {
  let areas: string[];
  try {
    areas = await api<string[]>("/__editor/areas");
  } catch (err) {
    setStatus(`Could not list areas: ${errText(err)}`, "error");
    return;
  }
  let image: ImportImage | undefined;
  let imageError = "";

  const nameInput = el(
    "input",
    undefined,
    undefined,
    "Name of the new map: lowercase letters, digits and dashes",
  );
  nameInput.type = "text";
  nameInput.value = firstFreeMapName(areas);
  const nameHint = el("div", "flyout-hint", "a-z, 0-9 and -");

  // Blank map group
  const blankW = createStepper({
    value: 2,
    spec: WORLD_KM_SPEC,
    unit: "km",
    tip: "Width of the new blank map in kilometres (0.5 to 10)",
    onChange: () => {},
  });
  const blankH = createStepper({
    value: 2,
    spec: WORLD_KM_SPEC,
    unit: "km",
    tip: "Height of the new blank map in kilometres (0.5 to 10)",
    onChange: () => {},
  });
  const blankSection = createSection(
    "Blank map",
    "Create an empty map of a chosen size",
    mode === "blank",
    [createField("Width", blankW.el), createField("Height", blankH.el)],
  );

  // Image group
  const fileInput = el("input", undefined, undefined, "Choose a black-and-white road image");
  fileInput.type = "file";
  fileInput.accept = "image/png,image/jpeg,image/webp";
  fileInput.style.display = "none";
  const readout = el("div", "ro", "No image chosen yet.");
  const warnBox = el("div", "warn");
  const thumb = el("canvas", undefined, undefined, "Roads that will be traced (orange)");
  thumb.style.display = "none";
  thumb.style.maxWidth = `${THUMB_MAX_PX}px`;
  const update = (): void => {
    if (image === undefined) {
      readout.textContent = imageError || "No image chosen yet.";
      readout.className = imageError ? "warn" : "ro";
      warnBox.replaceChildren();
      thumb.style.display = "none";
      return;
    }
    readout.className = "ro";
    const plan = planImportWorld(image.w, image.h, imgW.get());
    readout.textContent =
      plan.errors.length > 0
        ? `Image ${image.w} x ${image.h} px`
        : `Image ${image.w} x ${image.h} px -> ${fmt3(plan.widthKm)} x ${fmt3(plan.heightKm)} km, ${fmt3(plan.mPerPx)} m/px`;
    warnBox.replaceChildren(
      ...[...plan.errors, ...plan.warnings].map((w) => el("div", undefined, w)),
    );
    thumb.style.display = "block";
    drawMaskThumb(thumb, image, thr.get());
  };
  const imgW = createStepper({
    value: 2,
    spec: IMPORT_KM_SPEC,
    unit: "km",
    tip: "Real-world width of the image in kilometres; height follows the image shape",
    onChange: () => update(),
  });
  const thr = createStepper({
    value: 128,
    spec: { step: 1, coarse: 10, min: 0, max: 255, decimals: 0 },
    tip: "Threshold: pixels darker than this count as road",
    onChange: () => update(),
  });
  const spur = createStepper({
    value: DEFAULT_TRACE_OPTIONS.minSpurPx,
    spec: { step: 1, coarse: 5, min: 0, max: 1000, decimals: 0 },
    unit: "px",
    tip: "Prune dead-end spurs shorter than this many pixels",
    onChange: () => {},
  });
  const simp = createStepper({
    value: DEFAULT_TRACE_OPTIONS.simplifyPx,
    spec: { step: 0.1, coarse: 5, min: 0, max: 50, decimals: 1 },
    unit: "px",
    tip: "Simplify tolerance: higher gives fewer road points",
    onChange: () => {},
  });
  const smooth = createStepper({
    value: DEFAULT_TRACE_OPTIONS.smoothIterations,
    spec: { step: 1, coarse: 1, min: 0, max: 5, decimals: 0 },
    tip: "Smoothing passes applied to traced roads",
    onChange: () => {},
  });
  const roadWidth = createStepper({
    value: DEFAULT_IMPORT_ROAD.widthM,
    spec: ROAD_WIDTH_SPEC,
    unit: "m",
    tip: "Width given to every imported road in metres",
    onChange: () => {},
  });
  const surface = createSelect({
    options: SURFACES.map((s) => ({ value: s, label: s })),
    value: DEFAULT_IMPORT_ROAD.surface,
    tip: "Surface given to every imported road",
    onChange: () => {},
  });
  const highway = createSelect({
    options: HIGHWAY_CLASSES.map((s) => ({ value: s, label: s })),
    value: DEFAULT_IMPORT_ROAD.highway,
    tip: "Road class given to every imported road",
    onChange: () => {},
  });

  const chooseBtn = createButton({
    label: "Import image",
    tip: "Choose a black-and-white road image (PNG, JPEG or WebP). Photoshop .psd files must be exported to PNG first.",
    onClick: () => fileInput.click(),
  });
  fileInput.addEventListener("change", async () => {
    const f = fileInput.files?.[0];
    if (f === undefined) return;
    try {
      image = await readImageFile(f);
      imageError = "";
      // Default width: the image at about 1 m/px, kept inside the legal range.
      imgW.set(Math.min(10, Math.max(0.5, image.w / 1000)));
    } catch (err) {
      image = undefined;
      imageError = `Could not read image: ${errText(err)}`;
    }
    update();
  });
  const advanced = createSection("Advanced", "Road class and tracing tuning", false, [
    createField("Road class", highway.el),
    createField("Threshold", thr.el),
    createField("Spur prune", spur.el),
    createField("Simplify", simp.el),
    createField("Smoothing", smooth.el),
  ]);
  const imageSection = createSection(
    "From image",
    "Trace roads from a picture into a brand new map",
    mode === "image",
    [
      chooseBtn,
      fileInput,
      createField("Width", imgW.el),
      readout,
      warnBox,
      thumb,
      createField("Road width", roadWidth.el),
      createField("Surface", surface.el),
      advanced,
    ],
  );

  const body = el("div");
  body.append(createField("Name", nameInput), nameHint, blankSection, imageSection);

  /** Name check shared by both actions; returns an error string or undefined. */
  const checkName = (): string | undefined => {
    const id = nameInput.value.trim();
    if (!NAME_RE.test(id)) return "Name must be 1 to 64 characters: a-z, 0-9 and -.";
    if (areas.includes(id)) return `A map called "${id}" already exists. Pick another name.`;
    return undefined;
  };
  const discardOk = async (): Promise<boolean> =>
    !dirty ||
    (await confirmDialog(
      "Discard changes?",
      `${area} has unsaved changes. Creating a new map closes it.`,
      "Discard",
    ));

  const createBlank = async (): Promise<string | undefined> => {
    const bad = checkName();
    if (bad !== undefined) return bad;
    const widthKm = blankW.get();
    const heightKm = blankH.get();
    if (!(widthKm >= MIN_WORLD_KM && widthKm <= MAX_WORLD_KM))
      return `Width must be between ${MIN_WORLD_KM} and ${MAX_WORLD_KM} km.`;
    if (!(heightKm >= MIN_WORLD_KM && heightKm <= MAX_WORLD_KM))
      return `Height must be between ${MIN_WORLD_KM} and ${MAX_WORLD_KM} km.`;
    if (!(await discardOk())) return "Cancelled - your unsaved edits are still open.";
    const id = nameInput.value.trim();
    const out = await api<{ registered: boolean; warning?: string }>("/__editor/new-world", {
      method: "POST",
      body: JSON.stringify({ id, widthKm, heightKm }),
    });
    if (await loadArea(id)) {
      if (out.registered) {
        setStatus(
          `Created ${id} (${fmt3(widthKm)} x ${fmt3(heightKm)} km) and registered it for compiling.`,
          "ok",
        );
      } else {
        setStatus(out.warning ?? `Created ${id} but it is not registered for compiling.`, "error");
      }
    }
    return undefined;
  };

  const createFromImage = async (): Promise<string | undefined> => {
    const bad = checkName();
    if (bad !== undefined) return bad;
    if (image === undefined) return imageError || "Choose an image first.";
    const img = image;
    if (img.w * img.h > MAX_IMPORT_PIXELS)
      return `Image is ${fmt3((img.w * img.h) / 1_000_000)} MP; the limit is 25 MP.`;
    const plan = planImportWorld(img.w, img.h, imgW.get());
    if (plan.errors.length > 0) return plan.errors.join(" ");
    if (!(await discardOk())) return "Cancelled - your unsaved edits are still open.";
    const id = nameInput.value.trim();
    const opts: Partial<TraceOptions> = {
      threshold: thr.get(),
      minSpurPx: spur.get(),
      simplifyPx: simp.get(),
      smoothIterations: smooth.get(),
    };
    const roadOpts: ImportRoadOptions = {
      widthM: roadWidth.get(),
      highway: highway.get(),
      surface: surface.get() as Surface,
    };
    // Step 1: the new world. Failure here stays inline in the popup.
    const made = await api<{ registered: boolean; warning?: string }>("/__editor/new-world", {
      method: "POST",
      body: JSON.stringify({ id, widthKm: plan.widthKm, heightKm: plan.heightKm }),
    });
    try {
      // Step 2: open the fresh, empty map.
      if (!(await loadArea(id))) throw new Error(`could not open the new map ${id}`);
      setStatus("Tracing roads...");
      // Step 3: trace (yield first so the status paints), then add at offset 0,0.
      await new Promise<void>((r) => setTimeout(r, 0));
      const g = imageToRoadGraph(img.lum, img.w, img.h, opts);
      snapshot(); // Undo returns to the empty map
      const ways = appendImportedRoads(
        roads,
        proj,
        g,
        { imageH: img.h, mPerPx: plan.mPerPx, offset: { x: 0, y: 0 } },
        roadOpts,
      );
      const junctions = g.nodes.filter((n) => n.degree >= 3).length;
      if (!(await save())) throw new Error("saving failed");
      const notes = [...plan.warnings, ...(made.registered ? [] : [made.warning ?? ""])].filter(
        (s) => s !== "",
      );
      setStatus(
        `Imported ${ways.length} roads (${junctions} junctions) into new map ${id}, ${fmt3(plan.widthKm)} x ${fmt3(plan.heightKm)} km.${
          notes.length > 0 ? ` ${notes.join(" ")}` : ""
        }`,
        made.registered ? "ok" : "error",
      );
    } catch (err) {
      setStatus(
        `Map ${id} was created (empty) but importing failed: ${errText(err)}. Open it from File > Open area and try Import again.`,
        "error",
      );
    }
    return undefined;
  };

  update();
  const done = openDialog({
    title: mode === "image" ? "New map from image" : "New map",
    body,
    actions: [
      {
        id: "create",
        label: "Create",
        tip: "Create an empty map with the name and size above",
        primary: mode === "blank",
        run: createBlank,
      },
      {
        id: "import",
        label: "Create from image",
        tip: "Create a new map and trace the chosen image into it",
        primary: mode === "image",
        run: createFromImage,
      },
      { id: "cancel", label: "Cancel", tip: "Close without creating anything" },
    ],
  });
  if (mode === "image") setTimeout(() => chooseBtn.focus(), 0);
  await done;
}

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
  const toTerrain = createButton({
    label: "Open in terrain editor",
    tip: "Save, compile, turn this map into a terrain map and open it in the terrain editor, where you shape the ground and drive it",
    kind: "primary",
    onClick: () => void openInTerrainEditor(),
  });
  toTerrain.id = "to-terrain-btn";
  $("app").appendChild(toTerrain);
  setStatus(HINTS.select);
  auditTips(document);
  // Nothing is loaded automatically: the start screen decides what opens.
  await openStartScreen();
}

main().catch((err: unknown) => {
  const msg = `Editor failed to start: ${errText(err)}`;
  if (shell !== undefined) setStatus(msg, "error");
  else document.body.textContent = msg;
});
