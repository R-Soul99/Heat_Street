/**
 * Pure tool dispatcher for the terrain sculpt page (phase 04.2 plan 13, D-10..D-15).
 *
 * Maps pointer phases + panel options onto the core brush / road / stamp ops.
 * One stroke (pointer down to up) is exactly one undo entry (D-11). No DOM and
 * no three: the editor feeds world-space cursor hits in and rebuilds only the
 * dirty regions that come back out.
 */
import type { SurfaceType } from "../../src/core/surface-types.ts";
import {
  BLOCK_CELLS_MAX,
  BLOCK_CELLS_MIN,
  BLOCK_STEP_MAX_M,
  BLOCK_STEP_MIN_M,
  type BrushParams,
  blockWindowAt,
  createStrokeRecorder,
  type Falloff,
  flattenBrush,
  type HeightOpOptions,
  offsetWindowFrom,
  paintSurface,
  raiseBlock,
  raiseLower,
  raiseWindow,
  SMOOTH_PASSES_MAX,
  type StrokeDiff,
  type StrokeRecorder,
  smoothBrush,
  smoothRegion,
  stampTerrain,
} from "../../src/core/terrain-brush.ts";
import { sampleTerrainHeight } from "../../src/core/terrain-grid.ts";
import { MAX_SLOPE_DEG } from "../../src/core/terrain-limits.ts";
import {
  applyRoadStroke,
  eraseRoad,
  type RegradeResult,
  ROAD_PRESETS,
  type RoadEditTarget,
  type RoadPresetId,
  regradeRoads,
  roadVertexMask,
  setRoadLock,
} from "../../src/core/terrain-road.ts";
import { isUnlocked, nearestEdgeWithin, unlockedSet } from "../../src/core/terrain-road-lock.ts";
import type { CellWindow } from "../../src/core/terrain-slope.ts";
import { type ApplyResult, createUndoStack, type UndoTarget } from "../../src/core/terrain-undo.ts";

export type Tool =
  | "raise"
  | "lower"
  | "smooth"
  | "flatten"
  | "paint"
  | "road"
  | "stamp"
  | "erase"
  | "block"
  | "smoothBox"
  | "gridSelect"
  | "lock";

export const TOOL_KEYS: Readonly<Record<string, Tool>> = {
  KeyH: "raise",
  KeyJ: "lower",
  KeyG: "smooth",
  KeyF: "flatten",
  KeyP: "paint",
  KeyR: "road",
  KeyW: "stamp",
  KeyE: "erase",
  KeyB: "block",
  KeyA: "smoothBox",
  KeyV: "gridSelect",
  KeyL: "lock",
};

export interface ToolOptions {
  radiusM: number;
  strength: number;
  falloff: Falloff;
  surface: SurfaceType;
  roadPreset: RoadPresetId;
  widthM: number;
  maxBankDeg: number;
  stampKind: "wedge" | "mound";
  stampRotationRad: number;
  stampLengthM: number;
  stampWidthM: number;
  stampHeightM: number;
  /** Block tool edge length in cells (integer 1..8). */
  blockCells: number;
  /** Block tool step in metres (0.25..5, multiples of 0.25). */
  blockStepM: number;
  /** Block tool direction: 1 raises, -1 lowers (replaces Alt+click). */
  blockDirection: 1 | -1;
  /** Grid select step in metres (0.25..5, multiples of 0.25). */
  gridStepM: number;
  /** Grid select Ctrl+drag sensitivity, metres per pixel (0.005..1); used by the page. */
  pushPullMPerPx: number;
  smoothStrength: number;
  smoothPasses: number;
}

export interface ToolResult {
  /** Vertex window whose heights changed (rebuild these chunks). */
  dirtyHeights?: CellWindow;
  /** Cell window whose paint changed. */
  dirtyPaint?: CellWindow;
  graphChanged: boolean;
  /** Quick 261110-rdx: the unlocked-road list changed (repaint the lock overlay, mark dirty). */
  lockChanged: boolean;
  /** Quick 261110-rdx: the selected road changed (Lock tool click). */
  selectionChanged: boolean;
  slopeClamped: boolean;
  warnings: string[];
  status?: string;
  /** Road tool: polyline to draw while dragging. */
  previewPoints?: { x: number; z: number }[];
  /** How far a finished height stroke moved the ground (metres). */
  heightChange?: { maxUpM: number; maxDownM: number };
  /** Vertices in the brush footprint that belong to a (locked) road and were held. */
  heldVertices?: number;
  /** The grid selection was set or cleared. */
  gridSelectionChanged?: boolean;
}

export interface UndoRedoResult {
  dirtyHeights?: CellWindow;
  dirtyPaint?: CellWindow;
  graphChanged: boolean;
  lockChanged: boolean;
}

export interface Modifiers {
  /** Kept so older callers compile; Raise/Lower/Block ignore it. Lock treats it as Shift. */
  alt?: boolean;
  ctrl?: boolean;
  shift?: boolean;
}

export type EditArea = RoadEditTarget & UndoTarget;

const MIN_STAMP_LENGTH_M = 4;
const STAMP_ROTATE_STEP_RAD = (15 * Math.PI) / 180;
const ERASE_MSG = "Road erased. Ctrl+Z to undo.";

export const SLOPE_CLAMP_HINT = `Slope limit reached (${MAX_SLOPE_DEG} degrees). Lower the radius or flatten the area first.`;

/**
 * WR-02: sculpt height ops hand the slope limiter every existing road vertex
 * (road paint + the graph's levelled radius) so the limiter never moves road
 * terrain and graph y stays equal to the terrain (D-16).
 */
function heightOpOptions(area: EditArea): HeightOpOptions {
  // Quick 261110-rdx: unlocked roads are not held; undefined when none, so the old path runs.
  const free = unlockedSet(area.unlockedEdgeIds);
  return { roadMask: (win) => roadVertexMask(area.grid, area.paint, area.graph, win, free) };
}

function emptyResult(): ToolResult {
  return {
    graphChanged: false,
    lockChanged: false,
    selectionChanged: false,
    slopeClamped: false,
    warnings: [],
  };
}

function unionWindow(a: CellWindow | undefined, b: CellWindow | undefined): CellWindow | undefined {
  if (!a) return b;
  if (!b) return a;
  return {
    minRow: Math.min(a.minRow, b.minRow),
    minCol: Math.min(a.minCol, b.minCol),
    maxRow: Math.max(a.maxRow, b.maxRow),
    maxCol: Math.max(a.maxCol, b.maxCol),
  };
}

function mergeInto(into: ToolResult, r: ToolResult): void {
  into.dirtyHeights = unionWindow(into.dirtyHeights, r.dirtyHeights);
  into.dirtyPaint = unionWindow(into.dirtyPaint, r.dirtyPaint);
  into.graphChanged ||= r.graphChanged;
  into.lockChanged ||= r.lockChanged;
  into.selectionChanged ||= r.selectionChanged;
  into.slopeClamped ||= r.slopeClamped;
  into.warnings.push(...r.warnings);
  if (r.status !== undefined) into.status = r.status;
  if (r.previewPoints !== undefined) into.previewPoints = r.previewPoints;
  if (r.heldVertices !== undefined) into.heldVertices = (into.heldVertices ?? 0) + r.heldVertices;
  if (r.gridSelectionChanged) into.gridSelectionChanged = true;
}

const NO_SELECTION_MSG = "Drag a selection first (Grid select, V).";
const fmtM = (v: number): string => v.toFixed(2);

/** Largest rise and fall in a committed diff (metres). */
function heightChangeOf(
  diff: StrokeDiff | undefined,
): { maxUpM: number; maxDownM: number } | undefined {
  if (!diff?.heights) return undefined;
  let up = 0;
  let down = 0;
  const { before, after } = diff.heights;
  for (let i = 0; i < before.length; i++) {
    const d = after[i] - before[i];
    if (d > up) up = d;
    if (-d > down) down = -d;
  }
  return { maxUpM: up, maxDownM: down };
}

/** Cell window covering a paint pixel rectangle. */
function paintRectToCells(
  area: EditArea,
  rect: { minPx: number; minPz: number; maxPx: number; maxPz: number },
): CellWindow {
  const m = area.paint.metresPerPixel;
  const g = area.grid;
  return {
    minCol: Math.max(
      0,
      Math.floor((area.paint.originX + rect.minPx * m - g.originX) / g.cellSizeM),
    ),
    maxCol: Math.min(
      g.cols,
      Math.ceil((area.paint.originX + (rect.maxPx + 1) * m - g.originX) / g.cellSizeM),
    ),
    minRow: Math.max(
      0,
      Math.floor((area.paint.originZ + rect.minPz * m - g.originZ) / g.cellSizeM),
    ),
    maxRow: Math.min(
      g.rows,
      Math.ceil((area.paint.originZ + (rect.maxPz + 1) * m - g.originZ) / g.cellSizeM),
    ),
  };
}

function windowsOfDiff(
  area: EditArea,
  diff: StrokeDiff | undefined,
): { heights?: CellWindow; paint?: CellWindow; graph: boolean; lock: boolean } {
  const out: { heights?: CellWindow; paint?: CellWindow; graph: boolean; lock: boolean } = {
    graph: false,
    lock: false,
  };
  if (!diff) return out;
  if (diff.heights) {
    const stride = area.grid.rows + 1;
    let w: CellWindow | undefined;
    for (const i of diff.heights.indices) {
      const row = i % stride;
      const col = (i - row) / stride;
      w = unionWindow(w, { minRow: row, maxRow: row, minCol: col, maxCol: col });
    }
    out.heights = w;
  }
  if (diff.paint) {
    const pw = area.paint.width;
    let minPx = Number.POSITIVE_INFINITY;
    let maxPx = -1;
    let minPz = Number.POSITIVE_INFINITY;
    let maxPz = -1;
    for (const i of diff.paint.indices) {
      const px = i % pw;
      const pz = (i - px) / pw;
      minPx = Math.min(minPx, px);
      maxPx = Math.max(maxPx, px);
      minPz = Math.min(minPz, pz);
      maxPz = Math.max(maxPz, pz);
    }
    if (maxPx >= 0) out.paint = paintRectToCells(area, { minPx, minPz, maxPx, maxPz });
  }
  out.graph = diff.graph !== undefined;
  out.lock = diff.lock !== undefined;
  return out;
}

/** Merge consecutive diffs of one stroke: earliest before and latest after win. */
function mergeDiffs(diffs: readonly StrokeDiff[]): StrokeDiff | undefined {
  if (diffs.length === 0) return undefined;
  const pBefore = new Map<number, number>();
  const pAfter = new Map<number, number>();
  const hBefore = new Map<number, number>();
  const hAfter = new Map<number, number>();
  let graph: StrokeDiff["graph"];
  let lock: StrokeDiff["lock"];
  for (const d of diffs) {
    if (d.lock) lock = lock ? { before: lock.before, after: d.lock.after } : d.lock;
    if (d.paint) {
      d.paint.indices.forEach((idx, k) => {
        if (!pBefore.has(idx)) pBefore.set(idx, d.paint?.before[k] as number);
        pAfter.set(idx, d.paint?.after[k] as number);
      });
    }
    if (d.heights) {
      d.heights.indices.forEach((idx, k) => {
        if (!hBefore.has(idx)) hBefore.set(idx, d.heights?.before[k] as number);
        hAfter.set(idx, d.heights?.after[k] as number);
      });
    }
    if (d.graph) {
      graph = graph
        ? {
            before: graph.before,
            nextEdgeIdBefore: graph.nextEdgeIdBefore,
            after: d.graph.after,
            nextEdgeIdAfter: d.graph.nextEdgeIdAfter,
          }
        : d.graph;
    }
  }
  const idxP = [...pBefore.keys()].sort((a, b) => a - b);
  const idxH = [...hBefore.keys()].sort((a, b) => a - b);
  return {
    paint:
      idxP.length > 0
        ? {
            indices: Uint32Array.from(idxP),
            before: Uint8Array.from(idxP, (i) => pBefore.get(i) as number),
            after: Uint8Array.from(idxP, (i) => pAfter.get(i) as number),
          }
        : undefined,
    heights:
      idxH.length > 0
        ? {
            indices: Uint32Array.from(idxH),
            before: Float32Array.from(idxH, (i) => hBefore.get(i) as number),
            after: Float32Array.from(idxH, (i) => hAfter.get(i) as number),
          }
        : undefined,
    graph,
    ...(lock ? { lock } : {}),
  };
}

interface Stroke {
  tool: Tool;
  recorder: StrokeRecorder;
  mode: "paint" | "select" | "pushpull";
  /** Push/pull: full-grid snapshot taken at stroke start. */
  base?: Float32Array;
  /** Push/pull: window already rewritten by earlier pushPullTo calls. */
  pushDirty?: CellWindow;
  last: { x: number; z: number };
  start: { x: number; z: number };
  flattenTarget: number;
  points: { x: number; z: number }[];
  diffs: StrokeDiff[];
  removedAny: boolean;
  steppedBlocks: Set<number>;
  /** Block tool: vertices already stepped this stroke (shared block edges step once). */
  steppedVerts?: Uint8Array;
}

export function createToolDispatcher(getArea: () => EditArea) {
  const stack = createUndoStack(50);
  let tool: Tool = "raise";
  let stroke: Stroke | null = null;
  const presetDefaults = ROAD_PRESETS.street;
  const options: ToolOptions = {
    radiusM: 12,
    strength: 0.5,
    falloff: "smooth",
    surface: "grass",
    roadPreset: "street",
    widthM: presetDefaults.widthM,
    maxBankDeg: presetDefaults.maxBankDeg,
    stampKind: "wedge",
    stampRotationRad: 0,
    stampLengthM: 20,
    stampWidthM: 12,
    stampHeightM: 4,
    blockCells: 2,
    blockStepM: 1,
    blockDirection: 1,
    gridStepM: 1,
    pushPullMPerPx: 0.05,
    smoothStrength: 0.5,
    smoothPasses: 3,
  };

  function params(x: number, z: number): BrushParams {
    return {
      x,
      z,
      radiusM: options.radiusM,
      strength: options.strength,
      falloff: options.falloff,
    };
  }

  function dab(s: Stroke, x: number, z: number): ToolResult {
    const area = getArea();
    const res = emptyResult();
    const p = params(x, z);
    if (s.tool === "paint") {
      const r = paintSurface(area.paint, p, options.surface, { road: false }, s.recorder);
      if (r.rect) res.dirtyPaint = paintRectToCells(area, r.rect);
      return res;
    }
    let r: { window?: CellWindow; slopeClamped: boolean };
    const hop = heightOpOptions(area);
    if (s.tool === "block") {
      const win = blockWindowAt(area.grid, x, z, options.blockCells);
      if (!win) return res;
      const key = win.minRow * 65536 + win.minCol;
      if (s.steppedBlocks.has(key)) return res;
      s.steppedBlocks.add(key);
      if (!s.steppedVerts) s.steppedVerts = new Uint8Array(area.grid.heights.length);
      const stepped = s.steppedVerts;
      const blockOpts: HeightOpOptions = {
        roadMask: (w) => {
          const m = hop.roadMask ? hop.roadMask(w) : new Uint8Array(stepped.length);
          for (let i = 0; i < m.length; i++) if (stepped[i]) m[i] = 1;
          return m;
        },
      };
      r = raiseBlock(
        area.grid,
        { x, z, blockCells: options.blockCells, stepM: options.blockStepM },
        options.blockDirection,
        s.recorder,
        blockOpts,
      );
      const stride = area.grid.rows + 1;
      for (let c = win.minCol; c <= win.maxCol; c++) {
        for (let rr = win.minRow; rr <= win.maxRow; rr++) stepped[rr + c * stride] = 1;
      }
    } else if (s.tool === "raise") r = raiseLower(area.grid, p, 1, 1, s.recorder, hop);
    else if (s.tool === "lower") r = raiseLower(area.grid, p, -1, 1, s.recorder, hop);
    else if (s.tool === "smooth") r = smoothBrush(area.grid, p, s.recorder, hop);
    else r = flattenBrush(area.grid, p, s.flattenTarget, s.recorder, hop);
    res.dirtyHeights = r.window;
    res.slopeClamped = r.slopeClamped;
    if (r.slopeClamped) res.status = SLOPE_CLAMP_HINT;
    return res;
  }

  /** Road-held vertices inside the brush footprint (0 when the area has no roads). */
  function countHeld(s: Stroke, x: number, z: number): number {
    const area = getArea();
    const mask = heightOpOptions(area).roadMask;
    if (!mask) return 0;
    const win =
      s.tool === "block"
        ? blockWindowAt(area.grid, x, z, options.blockCells)
        : windowBetween(
            area,
            { x: x - options.radiusM, z: z - options.radiusM },
            { x: x + options.radiusM, z: z + options.radiusM },
          );
    if (!win) return 0;
    const m = mask(win);
    const stride = area.grid.rows + 1;
    let n = 0;
    for (let c = win.minCol; c <= win.maxCol; c++) {
      for (let r = win.minRow; r <= win.maxRow; r++) if (m[r + c * stride]) n++;
    }
    return n;
  }

  function doErase(s: Stroke, x: number, z: number): ToolResult {
    const area = getArea();
    const res = emptyResult();
    const r = eraseRoad(area, x, z, options.radiusM);
    res.warnings.push(...r.warnings);
    if (r.diff) {
      s.diffs.push(r.diff);
      const w = windowsOfDiff(area, r.diff);
      res.dirtyHeights = w.heights;
      res.dirtyPaint = w.paint;
      res.graphChanged = w.graph;
      res.lockChanged = w.lock;
    }
    if (r.removedEdgeIds.length > 0 || r.diff?.graph !== undefined) {
      s.removedAny = true;
      res.status = ERASE_MSG;
    }
    return res;
  }

  function dabAlong(s: Stroke, x: number, z: number, fn: (px: number, pz: number) => ToolResult) {
    const res = emptyResult();
    // Block strokes must not skip a block: sample at half a cell.
    const spacing =
      s.tool === "block"
        ? Math.max(0.1, getArea().grid.cellSizeM / 2)
        : Math.max(0.25, options.radiusM / 4);
    const dx = x - s.last.x;
    const dz = z - s.last.z;
    const dist = Math.hypot(dx, dz);
    const n = Math.floor(dist / spacing);
    for (let i = 1; i <= n; i++) {
      const t = (i * spacing) / dist;
      mergeInto(res, fn(s.last.x + dx * t, s.last.z + dz * t));
    }
    if (n > 0) {
      const t = (n * spacing) / dist;
      s.last = { x: s.last.x + dx * t, z: s.last.z + dz * t };
    }
    return res;
  }

  function finish(diff: StrokeDiff | undefined): void {
    if (diff) stack.push(diff);
    stroke = null;
  }

  /** Vertex window spanned by two world points, at least one cell, clipped to the grid. */
  function windowBetween(
    area: EditArea,
    a: { x: number; z: number },
    b: { x: number; z: number },
  ): CellWindow {
    const g = area.grid;
    const toCol = (x: number) => (x - g.originX) / g.cellSizeM;
    const toRow = (z: number) => (z - g.originZ) / g.cellSizeM;
    let minCol = Math.floor(Math.min(toCol(a.x), toCol(b.x)));
    let maxCol = Math.ceil(Math.max(toCol(a.x), toCol(b.x)));
    let minRow = Math.floor(Math.min(toRow(a.z), toRow(b.z)));
    let maxRow = Math.ceil(Math.max(toRow(a.z), toRow(b.z)));
    if (maxCol === minCol) maxCol += 1;
    if (maxRow === minRow) maxRow += 1;
    minCol = Math.max(0, minCol);
    minRow = Math.max(0, minRow);
    maxCol = Math.min(g.cols, maxCol);
    maxRow = Math.min(g.rows, maxRow);
    return { minRow, minCol, maxRow, maxCol };
  }

  function toUndoResult(area: EditArea, r: ApplyResult | false): UndoRedoResult | false {
    if (!r) return false;
    return {
      dirtyHeights: r.heightsWindow,
      dirtyPaint: r.paintRect ? paintRectToCells(area, r.paintRect) : undefined,
      graphChanged: r.graphChanged,
      lockChanged: r.lockChanged,
    };
  }

  /** Quick 261110-rdx: selected road (Lock tool); null once the edge is gone. */
  let selectedEdgeId: number | null = null;
  /** 07.1-06: persistent grid-select rectangle (vertex window). */
  let gridSelection: CellWindow | null = null;

  function currentSelection(): number | null {
    if (selectedEdgeId === null) return null;
    return getArea().graph.edges.some((e) => e.id === selectedEdgeId) ? selectedEdgeId : null;
  }

  const fmtChange = (r: { maxHeightChangeM: number; maxGradePct: number }): string =>
    `max height change ${r.maxHeightChangeM.toFixed(2)} m, max grade ${r.maxGradePct.toFixed(1)}%`;

  /** Pushes a lock / re-grade diff as ONE undo entry and reports what changed. */
  function commitLockDiff(area: EditArea, diff: StrokeDiff | undefined): ToolResult {
    const res = emptyResult();
    if (!diff) return res;
    stack.push(diff);
    const w = windowsOfDiff(area, diff);
    res.dirtyHeights = w.heights;
    res.dirtyPaint = w.paint;
    res.graphChanged = w.graph;
    res.lockChanged = w.lock;
    return res;
  }

  function regradeResult(area: EditArea, r: RegradeResult): ToolResult {
    const res = commitLockDiff(area, r.diff);
    res.warnings.push(...r.warnings);
    if (r.diff && r.regradedEdgeIds.length > 0) {
      res.status = `Re-graded ${r.regradedEdgeIds.length} road(s): ${fmtChange(r)}.`;
    }
    return res;
  }

  function lockClick(x: number, z: number, mods: Modifiers): ToolResult {
    const area = getArea();
    const res = emptyResult();
    const hit = nearestEdgeWithin(area.graph, x, z, options.radiusM);
    if (!hit) {
      res.status = "No road under the cursor.";
      return res;
    }
    const id = hit.edgeId;
    if (selectedEdgeId !== id) res.selectionChanged = true;
    selectedEdgeId = id;
    if (mods.shift || mods.alt) {
      res.selectionChanged = true;
      res.status = `Selected road ${id}.`;
      return res;
    }
    const wasUnlocked = isUnlocked(area, id);
    const r = setRoadLock(area, [id], wasUnlocked);
    mergeInto(res, commitLockDiff(area, r.diff));
    res.warnings.push(...r.warnings);
    if (!wasUnlocked) {
      res.status = `Unlocked road ${id}. Sculpt freely, then Re-grade or Lock it before saving.`;
    } else if (r.regradedEdgeIds.length > 0) {
      res.status = `Locked road ${id} (re-graded first: ${fmtChange(r)}).`;
    } else {
      res.status = `Locked road ${id}.`;
    }
    return res;
  }

  return {
    getTool: (): Tool => tool,
    getOptions: (): Readonly<ToolOptions> => options,
    setTool(next: Tool): void {
      tool = next;
    },
    setOptions(patch: Partial<ToolOptions>): void {
      for (const key of Object.keys(patch) as (keyof ToolOptions)[]) {
        const v = patch[key];
        if (v === undefined) continue;
        if (typeof v === "number" && !Number.isFinite(v)) continue;
        (options as unknown as Record<string, unknown>)[key] = v;
      }
      if (patch.roadPreset !== undefined && ROAD_PRESETS[patch.roadPreset] === undefined) {
        options.roadPreset = "street";
      }
      if (patch.roadPreset !== undefined) {
        const preset = ROAD_PRESETS[options.roadPreset];
        if (patch.widthM === undefined) options.widthM = preset.widthM;
        if (patch.maxBankDeg === undefined) options.maxBankDeg = preset.maxBankDeg;
      }
      const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
      if (patch.blockCells !== undefined) {
        options.blockCells = clamp(
          Math.round(options.blockCells),
          BLOCK_CELLS_MIN,
          BLOCK_CELLS_MAX,
        );
      }
      if (patch.blockStepM !== undefined) {
        options.blockStepM = clamp(
          Math.round(options.blockStepM * 4) / 4,
          BLOCK_STEP_MIN_M,
          BLOCK_STEP_MAX_M,
        );
      }
      if (patch.gridStepM !== undefined) {
        options.gridStepM = clamp(
          Math.round(options.gridStepM * 4) / 4,
          BLOCK_STEP_MIN_M,
          BLOCK_STEP_MAX_M,
        );
      }
      if (patch.pushPullMPerPx !== undefined) {
        options.pushPullMPerPx = clamp(options.pushPullMPerPx, 0.005, 1);
      }
      if (patch.blockDirection !== undefined) {
        options.blockDirection = patch.blockDirection < 0 ? -1 : 1;
      }
      if (patch.smoothStrength !== undefined) {
        options.smoothStrength = clamp(options.smoothStrength, 0, 1);
      }
      if (patch.smoothPasses !== undefined) {
        options.smoothPasses = clamp(Math.round(options.smoothPasses), 1, SMOOTH_PASSES_MAX);
      }
    },
    isStroking: (): boolean => stroke !== null,

    getSelectedEdgeId: (): number | null => currentSelection(),

    /** Lock (re-grading stale roads first) or unlock every road: one undo step. */
    lockAll(locked: boolean): ToolResult {
      if (stroke) this.pointerUp(Number.NaN, Number.NaN);
      const area = getArea();
      const ids = locked ? [...(area.unlockedEdgeIds ?? [])] : area.graph.edges.map((e) => e.id);
      const r = setRoadLock(area, ids, locked);
      const res = commitLockDiff(area, r.diff);
      res.warnings.push(...r.warnings);
      if (r.changedEdgeIds.length === 0) {
        res.status = locked ? "No unlocked roads." : "No roads to unlock.";
      } else if (locked) {
        res.status =
          r.regradedEdgeIds.length > 0
            ? `Locked all roads (re-graded ${r.regradedEdgeIds.length} first: ${fmtChange(r)}).`
            : "Locked all roads.";
      } else {
        res.status = "Unlocked all roads. Re-grade or Lock them before saving.";
      }
      return res;
    },

    /** Re-grades the selected road onto the terrain: one undo step. */
    regradeSelected(): ToolResult {
      if (stroke) this.pointerUp(Number.NaN, Number.NaN);
      const area = getArea();
      const id = currentSelection();
      if (id === null) {
        const res = emptyResult();
        res.status = "Select a road first (Lock tool, Shift+click).";
        return res;
      }
      return regradeResult(area, regradeRoads(area, [id]));
    },

    /** Re-grades every unlocked road onto the terrain: one undo step. */
    regradeAllUnlocked(): ToolResult {
      if (stroke) this.pointerUp(Number.NaN, Number.NaN);
      const area = getArea();
      const r = regradeRoads(area, "all-unlocked");
      const res = regradeResult(area, r);
      if (!r.diff) res.status = "No unlocked roads to re-grade.";
      return res;
    },

    /**
     * Smooth-area box for the active drag: the exact cell window pointerUp will smooth
     * (same windowBetween math), from the drag start corner to (x, z). Null when no
     * smoothBox drag is in progress.
     */
    smoothBoxWindow(x: number, z: number): CellWindow | null {
      const s = stroke;
      if (s?.tool !== "smoothBox" || !Number.isFinite(x) || !Number.isFinite(z)) return null;
      return windowBetween(getArea(), s.start, { x, z });
    },

    /** Drops an in-progress smoothBox drag without editing anything (Escape). */
    cancelBoxDrag(): boolean {
      if (stroke?.tool !== "smoothBox") return false;
      stroke = null;
      return true;
    },

    getGridSelection: (): CellWindow | null => gridSelection,

    clearGridSelection(): ToolResult {
      const res = emptyResult();
      if (stroke?.mode === "pushpull") this.pointerUp(Number.NaN, Number.NaN);
      res.gridSelectionChanged = gridSelection !== null;
      gridSelection = null;
      return res;
    },

    /** Live selection window for the active grid-select drag (null otherwise). */
    gridSelectDragWindow(x: number, z: number): CellWindow | null {
      const s = stroke;
      if (s?.tool !== "gridSelect" || s.mode !== "select") return null;
      if (!Number.isFinite(x) || !Number.isFinite(z)) return null;
      return windowBetween(getArea(), s.start, { x, z });
    },

    /** Raises (1) or lowers (-1) the selection by gridStepM: ONE undo entry. */
    raiseSelection(sign: 1 | -1): ToolResult {
      if (stroke) this.pointerUp(Number.NaN, Number.NaN);
      const res = emptyResult();
      if (!gridSelection) {
        res.status = NO_SELECTION_MSG;
        return res;
      }
      const area = getArea();
      const rec = createStrokeRecorder(area.grid, area.paint);
      const r = raiseWindow(
        area.grid,
        gridSelection,
        sign * options.gridStepM,
        rec,
        heightOpOptions(area),
      );
      res.dirtyHeights = r.window;
      res.slopeClamped = r.slopeClamped;
      const diff = rec.commit();
      if (diff) stack.push(diff);
      res.heightChange = heightChangeOf(diff);
      if (!diff) {
        res.status =
          "Nothing changed: the selection is held by roads. Unlock the road with the Lock tool (L) to sculpt it.";
      } else if (r.slopeClamped) {
        res.status = SLOPE_CLAMP_HINT;
      } else {
        res.status = `${sign > 0 ? "Raised" : "Lowered"} selection ${fmtM(options.gridStepM)} m`;
      }
      return res;
    },

    /** Absolute push/pull of the selection from where the Ctrl-drag started. */
    pushPullTo(deltaM: number): ToolResult {
      const s = stroke;
      const res = emptyResult();
      if (s?.mode !== "pushpull" || !s.base || !gridSelection || !Number.isFinite(deltaM)) {
        return res;
      }
      const area = getArea();
      const g = area.grid;
      const prev = s.pushDirty;
      if (prev) {
        // Restore the previous result first (indices are already recorded, so the
        // recorder's earliest-before stays correct), then re-apply from the base.
        const stride = g.rows + 1;
        for (let c = prev.minCol; c <= prev.maxCol; c++) {
          for (let r = prev.minRow; r <= prev.maxRow; r++) {
            g.heights[r + c * stride] = s.base[r + c * stride];
          }
        }
      }
      const r = offsetWindowFrom(
        g,
        gridSelection,
        s.base,
        deltaM,
        s.recorder,
        heightOpOptions(area),
      );
      s.pushDirty = unionWindow(prev, r.window);
      res.dirtyHeights = unionWindow(prev, r.window);
      res.slopeClamped = r.slopeClamped;
      if (r.slopeClamped) res.status = SLOPE_CLAMP_HINT;
      return res;
    },

    pointerDown(x: number, z: number, mods: Modifiers): ToolResult {
      if (!Number.isFinite(x) || !Number.isFinite(z)) return emptyResult();
      if (stroke) this.pointerUp(x, z);
      if (tool === "lock") return lockClick(x, z, mods);
      const area = getArea();
      if (tool === "gridSelect" && mods.ctrl && !gridSelection) {
        const res = emptyResult();
        res.status = NO_SELECTION_MSG;
        return res;
      }
      const s: Stroke = {
        tool,
        recorder: createStrokeRecorder(area.grid, area.paint),
        mode: tool === "gridSelect" ? (mods.ctrl ? "pushpull" : "select") : "paint",
        base: tool === "gridSelect" && mods.ctrl ? Float32Array.from(area.grid.heights) : undefined,
        last: { x, z },
        start: { x, z },
        flattenTarget: sampleTerrainHeight(area.grid, x, z),
        points: [{ x, z }],
        diffs: [],
        removedAny: false,
        steppedBlocks: new Set<number>(),
      };
      stroke = s;
      const res = emptyResult();
      if (
        tool === "raise" ||
        tool === "lower" ||
        tool === "smooth" ||
        tool === "flatten" ||
        tool === "paint" ||
        tool === "block"
      ) {
        mergeInto(res, dab(s, x, z));
        if (tool !== "paint") {
          const held = countHeld(s, x, z);
          if (held > 0) {
            res.heldVertices = held;
            if (!res.dirtyHeights) {
              res.status = `Nothing changed: ${held} vertices here belong to a road. Unlock the road with the Lock tool (L) to sculpt it, or move off the road.`;
            }
          }
        }
      } else if (tool === "erase") {
        mergeInto(res, doErase(s, x, z));
      } else if (tool === "road") {
        res.previewPoints = [...s.points];
      }
      return res;
    },

    pointerMove(x: number, z: number, _mods?: Modifiers): ToolResult {
      const s = stroke;
      if (!s || !Number.isFinite(x) || !Number.isFinite(z)) return emptyResult();
      const res = emptyResult();
      if (s.tool === "road") {
        const last = s.points[s.points.length - 1];
        if (Math.hypot(x - last.x, z - last.z) >= 0.5) s.points.push({ x, z });
        res.previewPoints = [...s.points];
      } else if (s.tool === "erase") {
        mergeInto(
          res,
          dabAlong(s, x, z, (px, pz) => doErase(s, px, pz)),
        );
      } else if (s.tool !== "stamp" && s.tool !== "smoothBox" && s.tool !== "gridSelect") {
        mergeInto(
          res,
          dabAlong(s, x, z, (px, pz) => dab(s, px, pz)),
        );
      }
      return res;
    },

    pointerUp(x: number, z: number): ToolResult {
      const s = stroke;
      if (!s) return emptyResult();
      const area = getArea();
      const res = emptyResult();
      const finite = Number.isFinite(x) && Number.isFinite(z);
      if (s.tool === "road") {
        if (finite) {
          const last = s.points[s.points.length - 1];
          if (Math.hypot(x - last.x, z - last.z) >= 0.5) s.points.push({ x, z });
        }
        if (s.points.length >= 2) {
          const r = applyRoadStroke(area, s.points, options.roadPreset, {
            widthM: options.widthM,
            maxBankDeg: options.maxBankDeg,
            replace: true,
          });
          res.warnings.push(...r.warnings);
          if (r.diff) {
            const w = windowsOfDiff(area, r.diff);
            res.dirtyHeights = w.heights;
            res.dirtyPaint = w.paint;
            res.graphChanged = w.graph;
            res.lockChanged = w.lock;
            finish(r.diff);
            return res;
          }
        }
        finish(undefined);
        return res;
      }
      if (s.tool === "stamp") {
        let length = options.stampLengthM;
        let width = options.stampWidthM;
        if (finite) {
          const drag = Math.hypot(x - s.start.x, z - s.start.z);
          if (drag >= 1) {
            length = Math.max(MIN_STAMP_LENGTH_M, drag);
            options.stampLengthM = length;
            if (options.stampKind === "mound") {
              width = Math.max(MIN_STAMP_LENGTH_M, drag);
              options.stampWidthM = width;
            }
          }
        }
        const r = stampTerrain(
          area.grid,
          {
            kind: options.stampKind,
            x: s.start.x,
            z: s.start.z,
            rotationRad: options.stampRotationRad,
            lengthM: length,
            widthM: width,
            heightM: options.stampHeightM,
          },
          s.recorder,
          heightOpOptions(area),
        );
        res.dirtyHeights = r.window;
        res.slopeClamped = r.slopeClamped;
        if (r.slopeClamped) res.status = SLOPE_CLAMP_HINT;
        finish(s.recorder.commit());
        return res;
      }
      if (s.tool === "smoothBox") {
        const end = finite ? { x, z } : s.start;
        const r = smoothRegion(
          area.grid,
          windowBetween(area, s.start, end),
          { strength: options.smoothStrength, passes: options.smoothPasses },
          s.recorder,
          heightOpOptions(area),
        );
        res.dirtyHeights = r.window;
        res.slopeClamped = r.slopeClamped;
        if (r.slopeClamped) res.status = SLOPE_CLAMP_HINT;
        finish(s.recorder.commit());
        return res;
      }
      if (s.tool === "erase") {
        finish(mergeDiffs(s.diffs));
        return res;
      }
      if (s.tool === "gridSelect") {
        if (s.mode === "select") {
          const end = finite ? { x, z } : s.start;
          gridSelection = windowBetween(area, s.start, end);
          res.gridSelectionChanged = true;
          finish(undefined);
          return res;
        }
        const diff = s.recorder.commit();
        res.heightChange = heightChangeOf(diff);
        finish(diff);
        return res;
      }
      const diff = s.recorder.commit();
      if (s.tool !== "paint") res.heightChange = heightChangeOf(diff);
      finish(diff);
      return res;
    },

    /** D-21: smooth the whole grid as exactly one undo step. */
    smoothAll(): ToolResult {
      const area = getArea();
      const res = emptyResult();
      if (stroke) this.pointerUp(Number.NaN, Number.NaN);
      const rec = createStrokeRecorder(area.grid, area.paint);
      const r = smoothRegion(
        area.grid,
        { minRow: 0, minCol: 0, maxRow: area.grid.rows, maxCol: area.grid.cols },
        { strength: options.smoothStrength, passes: options.smoothPasses },
        rec,
        heightOpOptions(area),
      );
      res.dirtyHeights = r.window;
      res.slopeClamped = r.slopeClamped;
      if (r.slopeClamped) res.status = SLOPE_CLAMP_HINT;
      finish(rec.commit());
      return res;
    },
    rotateStamp(sign: 1 | -1): void {
      options.stampRotationRad += sign * STAMP_ROTATE_STEP_RAD;
    },
    undo(): UndoRedoResult | false {
      const area = getArea();
      return toUndoResult(area, stack.undo(area));
    },
    redo(): UndoRedoResult | false {
      const area = getArea();
      return toUndoResult(area, stack.redo(area));
    },
    canUndo: (): boolean => stack.canUndo(),
    canRedo: (): boolean => stack.canRedo(),
    clearHistory(): void {
      stack.clear();
      stroke = null;
      selectedEdgeId = null;
      gridSelection = null;
    },
  };
}

export type ToolDispatcher = ReturnType<typeof createToolDispatcher>;
