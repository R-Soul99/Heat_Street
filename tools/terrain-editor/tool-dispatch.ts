/**
 * Pure tool dispatcher for the terrain sculpt page (phase 04.2 plan 13, D-10..D-15).
 *
 * Maps pointer phases + panel options onto the core brush / road / stamp ops.
 * One stroke (pointer down to up) is exactly one undo entry (D-11). No DOM and
 * no three: the editor feeds world-space cursor hits in and rebuilds only the
 * dirty regions that come back out.
 */

import type { RoadGraph, RoadGraphEdge } from "../../src/core/road-graph.ts";
import type { SurfaceType } from "../../src/core/surface-types.ts";
import {
  BLOCK_CELLS_MAX,
  BLOCK_CELLS_MIN,
  BLOCK_STEP_MAX_M,
  BLOCK_STEP_MIN_M,
  type BrushParams,
  type BrushResult,
  type BrushShape,
  blockWindowAt,
  createStrokeRecorder,
  type Falloff,
  flattenBrush,
  flattenMaskToAverage,
  type HeightOpOptions,
  paintMask,
  paintSurface,
  raiseBlock,
  raiseLower,
  SMOOTH_PASSES_MAX,
  type StrokeDiff,
  type StrokeRecorder,
  setMaskFromBase,
  smoothBrush,
  smoothRegion,
  snapshotWindow,
  stampTerrain,
} from "../../src/core/terrain-brush.ts";
import {
  type CellMask,
  cellBoxFromWindow,
  createCellMask,
  type MaskOp,
} from "../../src/core/terrain-cell-mask.ts";
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
import { BRUSH_TOOL_FOR, type Mode, type Operation, type RoadBrush } from "./rail-tools.ts";
import {
  CONNECT_MAX_M,
  type FixKind,
  makeTwoWay,
  mergeEndNodes,
  planCloseLoop,
  planConnectEnds,
  removeDuplicatePoints,
  smoothEdgeHeights,
  twoWayCandidates,
} from "./road-problems.ts";
import { NO_SELECTION_STATUS } from "./toolbar-state.ts";

/** Road preset whose class matches the edge (fix strokes look like the road they extend). */
function presetIdForEdge(edge: RoadGraphEdge | undefined): RoadPresetId {
  if (!edge) return "street";
  const ids = Object.keys(ROAD_PRESETS) as RoadPresetId[];
  return ids.find((id) => ROAD_PRESETS[id].roadClass === edge.roadClass) ?? "street";
}

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
  | "lock"
  | "gridSelect";

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
  KeyM: "smoothBox",
  KeyL: "lock",
  KeyS: "gridSelect",
};

export interface ToolOptions {
  radiusM: number;
  /** Radius brush footprint: round disc or square (radius = half side). */
  brushShape: BrushShape;
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
  /** Block tool direction: 1 raises, -1 lowers (replaces the old Alt modifier). */
  blockDirection: 1 | -1;
  smoothStrength: number;
  smoothPasses: number;
  /** Select-mode raise/lower step in metres (0.25..5, multiples of 0.25). Separate from brush strength (D-12). */
  selectStepM: number;
  /** Select-mode Smooth strength 0..1, one pass per tick. Separate from brush smoothStrength (D-12). */
  selectSmoothStrength: number;
  /** Steepest ground slope (degrees) sculpting may leave. Default MAX_SLOPE_DEG. */
  slopeLimitDeg: number;
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
  /** Signed largest height change the stroke has made so far (metres). */
  heightDeltaM?: number;
  /** Vertices held by roads so far this stroke. */
  heldVertices?: number;
  /** Grid select: Ctrl+pointerDown on a selection; the editor should now drive push/pull. */
  pushPullStarted?: boolean;
  warnings: string[];
  status?: string;
  /** Road tool: polyline to draw while dragging. */
  previewPoints?: { x: number; z: number }[];
}

export interface UndoRedoResult {
  dirtyHeights?: CellWindow;
  dirtyPaint?: CellWindow;
  graphChanged: boolean;
  lockChanged: boolean;
}

export interface Modifiers {
  shift?: boolean;
  ctrl?: boolean;
  /** Alt+drag on a selection in Select mode starts push/pull (D-05); brushes ignore it. */
  alt?: boolean;
}

export type EditArea = RoadEditTarget & UndoTarget;

const MIN_STAMP_LENGTH_M = 4;
const STAMP_ROTATE_STEP_RAD = (15 * Math.PI) / 180;
const STAMP_ROTATE_COARSE_RAD = (45 * Math.PI) / 180;
export const SLOPE_LIMIT_MIN_DEG = 5;
export const SLOPE_LIMIT_MAX_DEG = 80;
const PUSH_PULL_MAX_M = 50;
const NO_SELECTION_MSG = NO_SELECTION_STATUS;
const ERASE_MSG = "Road erased. Ctrl+Z to undo.";

export const heldStatus = (n: number): string =>
  `Held by roads: ${n} vertices did not move. Unlock the road (Lock tool, L) to sculpt under it.`;

export const slopeClampHint = (deg: number): string =>
  `Slope limit reached (${deg} degrees). Lower the radius or flatten the area first.`;

/** Hint at the default slope limit. */
export const SLOPE_CLAMP_HINT = slopeClampHint(MAX_SLOPE_DEG);

/**
 * WR-02: sculpt height ops hand the slope limiter every existing road vertex
 * (road paint + the graph's levelled radius) so the limiter never moves road
 * terrain and graph y stays equal to the terrain (D-16).
 *
 * D-23/D-30: the mask is padded by cell*sqrt2, so a ring about one cell wide beside
 * each locked road is untouchable by sculpting while the road is locked.
 */
function heightOpOptions(area: EditArea, options: ToolOptions): HeightOpOptions {
  // Quick 261110-rdx: unlocked roads are not held; undefined when none, so the old path runs.
  const free = unlockedSet(area.unlockedEdgeIds);
  return {
    roadMask: (win) =>
      roadVertexMask(
        area.grid,
        area.paint,
        area.graph,
        win,
        free,
        area.grid.cellSizeM * Math.SQRT2,
      ),
    maxSlopeDeg: options.slopeLimitDeg,
  };
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
  if (r.heightDeltaM !== undefined) into.heightDeltaM = r.heightDeltaM;
  if (r.heldVertices !== undefined) into.heldVertices = r.heldVertices;
  if (r.pushPullStarted) into.pushPullStarted = true;
  into.warnings.push(...r.warnings);
  if (r.status !== undefined) into.status = r.status;
  if (r.previewPoints !== undefined) into.previewPoints = r.previewPoints;
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
  mods: Modifiers;
  /** Largest signed height change so far this stroke. */
  maxDeltaM: number;
  heldTotal: number;
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
  // Authority rule: `mode` is authoritative for where pointer input goes. In "select" mode
  // pointer drags edit the selection; in "brush" mode they run the armed brush. The legacy
  // `setTool` is only a thin adapter onto setMode/armBrush until plan 11 removes the old
  // tools (block, smoothBox, stamp, lock keep their legacy stroke path in brush mode).
  // No code path reads `brushTool` without going through `mode` (see activeTool).
  let mode: Mode = "select";
  let armed: Operation | RoadBrush | null = null;
  let brushTool: Tool | null = null;
  const activeTool = (): Tool | null => (mode === "select" ? "gridSelect" : brushTool);
  let stroke: Stroke | null = null;
  const presetDefaults = ROAD_PRESETS.street;
  const options: ToolOptions = {
    radiusM: 12,
    brushShape: "round",
    strength: 1,
    falloff: "smooth",
    surface: "grass",
    roadPreset: "street",
    widthM: presetDefaults.widthM,
    maxBankDeg: presetDefaults.maxBankDeg,
    stampKind: "wedge",
    stampRotationRad: 0,
    slopeLimitDeg: MAX_SLOPE_DEG,
    stampLengthM: 20,
    stampWidthM: 12,
    stampHeightM: 4,
    blockCells: 2,
    blockStepM: 1,
    blockDirection: 1,
    smoothStrength: 0.5,
    smoothPasses: 3,
    selectStepM: 1,
    selectSmoothStrength: 0.5,
  };

  function params(x: number, z: number): BrushParams {
    return {
      x,
      z,
      radiusM: options.radiusM,
      strength: options.strength,
      falloff: options.falloff,
      shape: options.brushShape,
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
    let r: BrushResult;
    const hop = heightOpOptions(area, options);
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
    } else if (s.tool === "raise" || s.tool === "lower") {
      r = raiseLower(area.grid, p, s.tool === "lower" ? -1 : 1, 1, s.recorder, hop);
    } else if (s.tool === "smooth") r = smoothBrush(area.grid, p, s.recorder, hop);
    else r = flattenBrush(area.grid, p, s.flattenTarget, s.recorder, hop);
    res.dirtyHeights = r.window;
    res.slopeClamped = r.slopeClamped;
    if (r.slopeClamped) res.status = slopeClampHint(options.slopeLimitDeg);
    if (Math.abs(r.maxDeltaM) > Math.abs(s.maxDeltaM)) s.maxDeltaM = r.maxDeltaM;
    s.heldTotal += r.heldCount;
    res.heightDeltaM = s.maxDeltaM;
    res.heldVertices = s.heldTotal;
    if (r.maxDeltaM === 0 && r.heldCount > 0) res.status = heldStatus(r.heldCount);
    return res;
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

  /** Persistent cell-mask selection (D-02, D-06): survives mode switches, never an undo step (D-07). */
  let selection: CellMask | null = null;
  let pushPull: {
    base: Float32Array;
    win: CellWindow;
    mask: CellMask;
    recorder: StrokeRecorder;
    lastDelta: number;
  } | null = null;
  /** Hold-to-repeat session (D-08, D-10): one recorder, one undo entry for the whole hold. */
  let repeat: {
    op: "raise" | "lower" | "smooth";
    base?: Float32Array;
    win?: CellWindow;
    mask: CellMask;
    recorder: StrokeRecorder;
    delta: number;
  } | null = null;

  /** The selection, dropped if the area's grid no longer matches its size. */
  function liveSelection(): CellMask | null {
    if (!selection) return null;
    const g = getArea().grid;
    if (selection.rows !== g.rows || selection.cols !== g.cols) selection = null;
    return selection;
  }

  function selectBrushTool(op: Operation | RoadBrush | null): void {
    armed = op;
    brushTool = op ? (BRUSH_TOOL_FOR[op] as Tool) : null;
  }

  function heightResult(r: BrushResult): ToolResult {
    const res = emptyResult();
    res.dirtyHeights = r.window;
    res.slopeClamped = r.slopeClamped;
    res.heightDeltaM = r.maxDeltaM;
    res.heldVertices = r.heldCount;
    if (r.slopeClamped) res.status = slopeClampHint(options.slopeLimitDeg);
    if (r.maxDeltaM === 0 && r.heldCount > 0) res.status = heldStatus(r.heldCount);
    return res;
  }

  /** Quick 261110-rdx: selected road (Lock tool); null once the edge is gone. */
  let selectedEdgeId: number | null = null;

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

  /**
   * Records a pure graph change (no heights or paint) as ONE undo entry. A null
   * `next` pushes nothing and reports graphChanged false.
   */
  function commitGraphChange(area: EditArea, next: RoadGraph | null): ToolResult {
    if (!next) return emptyResult();
    const before = area.graph;
    const rec = createStrokeRecorder(area.grid, area.paint);
    area.graph = next;
    rec.recordGraph(JSON.stringify(before), JSON.stringify(next), area.nextEdgeId, area.nextEdgeId);
    return commitLockDiff(area, rec.commit());
  }

  /**
   * Draws a fix road from `from` to `to` through the Road tool pipeline (paint,
   * level, join onto existing junctions/roads) as ONE undo entry. Never replaces
   * roads it crosses. On failure pushes nothing and reports why in status.
   */
  function fixStroke(
    area: EditArea,
    edge: RoadGraphEdge | undefined,
    from: { x: number; z: number },
    to: { x: number; z: number },
  ): ToolResult {
    const r = applyRoadStroke(
      area,
      [
        { x: from.x, z: from.z },
        { x: to.x, z: to.z },
      ],
      presetIdForEdge(edge),
      { ...(edge ? { widthM: edge.widthM } : {}), replace: false },
    );
    if (!r.diff) {
      const res = emptyResult();
      res.warnings.push(...r.warnings);
      res.status = `Could not draw the joining road: ${r.warnings.join(" ") || "no change"}`;
      return res;
    }
    const res = commitLockDiff(area, r.diff);
    res.warnings.push(...r.warnings);
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
    if (mods.shift) {
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
    getTool: (): Tool => activeTool() ?? "raise",
    getOptions: (): Readonly<ToolOptions> => options,
    getMode: (): Mode => mode,
    /** Switching mode never touches the selection (D-06). */
    setMode(next: Mode): void {
      if (stroke) this.pointerUp(Number.NaN, Number.NaN);
      mode = next;
    },
    getArmed: (): Operation | RoadBrush | null => armed,
    /** Arms a brush and switches to Brush mode (D-16). */
    armBrush(op: Operation | RoadBrush): void {
      if (stroke) this.pointerUp(Number.NaN, Number.NaN);
      selectBrushTool(op);
      mode = "brush";
    },
    getSelectionMask: (): CellMask | null => liveSelection(),
    selectionCellCount: (): number => liveSelection()?.cellCount() ?? 0,
    /** @deprecated Thin adapter onto setMode/armBrush; plan 11 removes it. */
    setTool(next: Tool): void {
      if (stroke) this.pointerUp(Number.NaN, Number.NaN);
      if (next === "gridSelect") {
        mode = "select";
        return;
      }
      const op = (Object.keys(BRUSH_TOOL_FOR) as (Operation | RoadBrush)[]).find(
        (k) => BRUSH_TOOL_FOR[k] === next,
      );
      if (op) {
        this.armBrush(op);
        return;
      }
      armed = null;
      brushTool = next;
      mode = "brush";
    },
    setOptions(patch: Partial<ToolOptions>): void {
      for (const key of Object.keys(patch) as (keyof ToolOptions)[]) {
        const v = patch[key];
        if (v === undefined) continue;
        if (typeof v === "number" && !Number.isFinite(v)) continue;
        (options as unknown as Record<string, unknown>)[key] = v;
      }
      if (patch.brushShape !== undefined) {
        options.brushShape = patch.brushShape === "square" ? "square" : "round";
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
      if (patch.slopeLimitDeg !== undefined) {
        options.slopeLimitDeg = clamp(
          Math.round(options.slopeLimitDeg),
          SLOPE_LIMIT_MIN_DEG,
          SLOPE_LIMIT_MAX_DEG,
        );
      }
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
      if (patch.blockDirection !== undefined) {
        options.blockDirection = options.blockDirection < 0 ? -1 : 1;
      }
      if (patch.selectStepM !== undefined) {
        options.selectStepM = clamp(
          Math.round(options.selectStepM * 4) / 4,
          BLOCK_STEP_MIN_M,
          BLOCK_STEP_MAX_M,
        );
      }
      if (patch.selectSmoothStrength !== undefined) {
        options.selectSmoothStrength = clamp(options.selectSmoothStrength, 0, 1);
      }
      if (patch.smoothStrength !== undefined) {
        options.smoothStrength = clamp(options.smoothStrength, 0, 1);
      }
      if (patch.smoothPasses !== undefined) {
        options.smoothPasses = clamp(Math.round(options.smoothPasses), 1, SMOOTH_PASSES_MAX);
      }
    },
    isStroking: (): boolean => stroke !== null,
    isRepeating: (): boolean => repeat !== null,

    getSelectedEdgeId: (): number | null => currentSelection(),

    /**
     * Road problems panel: one automatic repair as ONE undo step (07.1-15, 07.1-21).
     * `nodeId` names the trapped junction for make-two-way.
     */
    applyRoadFix(kind: FixKind, edgeId: number, nodeId?: number): ToolResult {
      if (stroke) this.pointerUp(Number.NaN, Number.NaN);
      const area = getArea();
      const graph = area.graph;
      const edge = graph.edges.find((e) => e.id === edgeId);
      const noFix = (why: string): ToolResult => {
        const res = emptyResult();
        res.status = `Road ${edgeId}: ${why}`;
        return res;
      };
      switch (kind) {
        case "regrade":
          return regradeResult(area, regradeRoads(area, [edgeId]));
        case "remove-duplicate-points": {
          const res = commitGraphChange(area, removeDuplicatePoints(graph, edgeId));
          res.status = res.graphChanged
            ? `Removed duplicate points on road ${edgeId}.`
            : `Road ${edgeId}: no safe automatic fix; fix it by hand.`;
          return res;
        }
        case "smooth-heights": {
          const res = commitGraphChange(area, smoothEdgeHeights(graph, edgeId));
          res.status = res.graphChanged
            ? `Smoothed the heights of road ${edgeId}.`
            : `Road ${edgeId}: no safe automatic fix; fix it by hand.`;
          return res;
        }
        case "make-two-way": {
          const ids = twoWayCandidates(graph, nodeId ?? edge?.from ?? -1);
          const next = ids.length > 0 ? makeTwoWay(graph, ids) : null;
          if (!next) return noFix("no one-way roads here to make two-way.");
          const res = commitGraphChange(area, next);
          res.status = `Made ${ids.length} road(s) two-way: ${ids.map((id) => `Road ${id}`).join(", ")}.`;
          return res;
        }
        case "connect-ends": {
          const plan = planConnectEnds(graph, edgeId);
          if (!plan) {
            return noFix(
              `nothing within ${CONNECT_MAX_M} m to connect to; draw a road to it by hand.`,
            );
          }
          const res = fixStroke(area, edge, plan.from, plan.to);
          if (res.graphChanged) {
            res.status = `Connected Road ${edgeId} to the road network (${Math.round(plan.distanceM)} m).`;
          }
          return res;
        }
        case "close-loop": {
          const plan = planCloseLoop(graph, edgeId);
          if (!plan) {
            return noFix("its two open ends are not close enough to join; draw the gap by hand.");
          }
          const res =
            plan.gapM < 2 * area.grid.cellSizeM
              ? commitGraphChange(area, mergeEndNodes(graph, plan.a, plan.b))
              : fixStroke(area, edge, plan.from, plan.to);
          if (res.graphChanged) res.status = `Closed the loop on Road ${edgeId}.`;
          else if (!res.status)
            res.status = `Road ${edgeId}: could not close the loop; draw the gap by hand.`;
          return res;
        }
      }
    },

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

    /** @deprecated Vertex bounds of the selection mask; plan 11 removes it. */
    getSelection: (): CellWindow | null => liveSelection()?.bounds() ?? null,
    /** @deprecated Replaces the mask with one window; plan 11 removes it. */
    setSelection(win: CellWindow | null): void {
      if (!win) {
        selection = null;
        return;
      }
      const g = getArea().grid;
      const m = createCellMask(g.rows, g.cols);
      m.apply(cellBoxFromWindow(win), "replace");
      selection = m.isEmpty() ? null : m;
    },
    clearSelection(): void {
      selection = null;
    },

    /** Live selection rubber-band window from the drag start to (x, z); null when not dragging. */
    selectionPreview(x: number, z: number): CellWindow | null {
      const s = stroke;
      if (s?.tool !== "gridSelect" || !Number.isFinite(x) || !Number.isFinite(z)) return null;
      return windowBetween(getArea(), s.start, { x, z });
    },

    /** How the active selection drag will combine with the selection (for rubber-band styling). */
    selectionDragOp(): MaskOp | null {
      const s = stroke;
      if (s?.tool !== "gridSelect") return null;
      return s.mods.ctrl ? "subtract" : s.mods.shift ? "add" : "replace";
    },

    /** One operation on the selection, committed as ONE undo entry. */
    applyOperation(op: Operation): ToolResult {
      if (stroke) this.pointerUp(Number.NaN, Number.NaN);
      if (repeat) this.endOpRepeat();
      const sel = liveSelection();
      const area = getArea();
      if (!sel) {
        const res = emptyResult();
        res.status = NO_SELECTION_MSG;
        return res;
      }
      if (op === "raise" || op === "lower" || op === "smooth") {
        const res = this.beginOpRepeat(op);
        mergeInto(res, this.endOpRepeat());
        return res;
      }
      const rec = createStrokeRecorder(area.grid, area.paint);
      if (op === "flatten") {
        const r = flattenMaskToAverage(area.grid, sel, rec, heightOpOptions(area, options));
        const diff = rec.commit();
        if (diff) stack.push(diff);
        return heightResult(r);
      }
      const r = paintMask(area.paint, area.grid, sel, options.surface, rec);
      const diff = rec.commit();
      if (diff) stack.push(diff);
      const res = emptyResult();
      if (r.rect) res.dirtyPaint = paintRectToCells(area, r.rect);
      return res;
    },

    /** Starts a hold-to-repeat raise/lower/smooth and applies the first tick. */
    beginOpRepeat(op: "raise" | "lower" | "smooth"): ToolResult {
      if (stroke) this.pointerUp(Number.NaN, Number.NaN);
      if (repeat) this.endOpRepeat();
      const sel = liveSelection();
      const res = emptyResult();
      const win = sel?.bounds();
      if (!sel || !win) {
        res.status = NO_SELECTION_MSG;
        return res;
      }
      const area = getArea();
      repeat = {
        op,
        mask: sel.clone(),
        recorder: createStrokeRecorder(area.grid, area.paint),
        delta: 0,
        ...(op === "smooth" ? {} : { base: snapshotWindow(area.grid, win), win }),
      };
      return this.opRepeatTick();
    },

    /** One more step of the active hold. */
    opRepeatTick(): ToolResult {
      const rp = repeat;
      if (!rp) return emptyResult();
      const area = getArea();
      const hop = heightOpOptions(area, options);
      if (rp.op === "smooth") {
        const win = rp.mask.bounds();
        if (!win) return emptyResult();
        const r = smoothRegion(
          area.grid,
          win,
          {
            strength: options.selectSmoothStrength,
            passes: 1,
            selected: rp.mask.vertexMask(area.grid),
          },
          rp.recorder,
          hop,
        );
        return heightResult(r);
      }
      const sign = rp.op === "lower" ? -1 : 1;
      rp.delta = Math.min(
        PUSH_PULL_MAX_M,
        Math.max(-PUSH_PULL_MAX_M, rp.delta + sign * options.selectStepM),
      );
      const r = setMaskFromBase(
        area.grid,
        rp.mask,
        rp.base as Float32Array,
        rp.win as CellWindow,
        rp.delta,
        rp.recorder,
        hop,
      );
      return heightResult(r);
    },

    /** Commits the hold as ONE undo entry. */
    endOpRepeat(): ToolResult {
      const rp = repeat;
      if (!rp) return emptyResult();
      repeat = null;
      const res = emptyResult();
      const diff = rp.recorder.commit();
      if (diff) {
        stack.push(diff);
        res.dirtyHeights = windowsOfDiff(getArea(), diff).heights;
      }
      return res;
    },

    /** @deprecated Delegates to applyOperation; plan 11 removes it. */
    raiseSelection(sign: 1 | -1): ToolResult {
      return this.applyOperation(sign > 0 ? "raise" : "lower");
    },

    /** Starts a push/pull on the selection (snapshot taken now). False with no selection. */
    beginPushPull(): boolean {
      if (stroke) this.pointerUp(Number.NaN, Number.NaN);
      const sel = liveSelection();
      const win = sel?.bounds();
      if (!sel || !win) return false;
      const area = getArea();
      pushPull = {
        base: snapshotWindow(area.grid, win),
        win: { ...win },
        mask: sel.clone(),
        recorder: createStrokeRecorder(area.grid, area.paint),
        lastDelta: 0,
      };
      return true;
    },

    /** Absolute push/pull: heights = snapshot + deltaM (clamped to 50 m). */
    pushPullTo(deltaM: number): ToolResult {
      const pp = pushPull;
      if (!pp || !Number.isFinite(deltaM)) return emptyResult();
      const area = getArea();
      const delta = Math.min(PUSH_PULL_MAX_M, Math.max(-PUSH_PULL_MAX_M, deltaM));
      pp.lastDelta = delta;
      const r = setMaskFromBase(
        area.grid,
        pp.mask,
        pp.base,
        pp.win,
        delta,
        pp.recorder,
        heightOpOptions(area, options),
      );
      return heightResult(r);
    },

    /** Commits the push/pull as ONE undo entry. */
    endPushPull(): ToolResult {
      const pp = pushPull;
      if (!pp) return emptyResult();
      pushPull = null;
      const res = emptyResult();
      const diff = pp.recorder.commit();
      if (diff) {
        stack.push(diff);
        res.dirtyHeights = windowsOfDiff(getArea(), diff).heights;
      }
      return res;
    },

    /** Restores the snapshot heights; no undo entry. */
    cancelPushPull(): ToolResult {
      const pp = pushPull;
      if (!pp) return emptyResult();
      const area = getArea();
      const r = setMaskFromBase(
        area.grid,
        pp.mask,
        pp.base,
        pp.win,
        0,
        undefined,
        heightOpOptions(area, options),
      );
      pushPull = null;
      const res = emptyResult();
      res.dirtyHeights = r.window;
      return res;
    },

    /** Drops an in-progress smoothBox drag without editing anything (Escape). */
    cancelBoxDrag(): boolean {
      if (stroke?.tool !== "smoothBox") return false;
      stroke = null;
      return true;
    },

    pointerDown(x: number, z: number, mods: Modifiers): ToolResult {
      if (!Number.isFinite(x) || !Number.isFinite(z)) return emptyResult();
      if (stroke) this.pointerUp(x, z);
      const tool = activeTool();
      if (tool === null) {
        const res = emptyResult();
        res.status = "Pick an operation";
        return res;
      }
      if (tool === "lock") return lockClick(x, z, mods);
      if (mode === "select" && mods.alt && liveSelection()) {
        const res = emptyResult();
        res.pushPullStarted = true;
        res.status = "Push/pull the selection: drag up or down.";
        return res;
      }
      const area = getArea();
      const s: Stroke = {
        tool,
        recorder: createStrokeRecorder(area.grid, area.paint),
        mods: { shift: mods.shift, ctrl: mods.ctrl, alt: mods.alt },
        maxDeltaM: 0,
        heldTotal: 0,
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
      } else if (s.tool === "gridSelect") {
        s.last = { x, z };
      } else if (s.tool !== "stamp" && s.tool !== "smoothBox") {
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
          heightOpOptions(area, options),
        );
        res.dirtyHeights = r.window;
        res.slopeClamped = r.slopeClamped;
        if (r.slopeClamped) res.status = slopeClampHint(options.slopeLimitDeg);
        finish(s.recorder.commit());
        return res;
      }
      if (s.tool === "gridSelect") {
        const end = finite ? { x, z } : s.last;
        const op: MaskOp = s.mods.ctrl ? "subtract" : s.mods.shift ? "add" : "replace";
        const g = area.grid;
        const mask =
          liveSelection() && op !== "replace"
            ? (selection as CellMask)
            : createCellMask(g.rows, g.cols);
        mask.apply(cellBoxFromWindow(windowBetween(area, s.start, end)), op);
        selection = mask.isEmpty() ? null : mask;
        res.selectionChanged = true;
        res.status = selection
          ? `Selected ${mask.cellCount()} cells. Pick an operation, or Alt+drag to push/pull.`
          : "Selection cleared.";
        finish(undefined);
        return res;
      }
      if (s.tool === "smoothBox") {
        const end = finite ? { x, z } : s.start;
        const r = smoothRegion(
          area.grid,
          windowBetween(area, s.start, end),
          { strength: options.smoothStrength, passes: options.smoothPasses },
          s.recorder,
          heightOpOptions(area, options),
        );
        res.dirtyHeights = r.window;
        res.slopeClamped = r.slopeClamped;
        if (r.slopeClamped) res.status = slopeClampHint(options.slopeLimitDeg);
        finish(s.recorder.commit());
        return res;
      }
      if (s.tool === "erase") {
        finish(mergeDiffs(s.diffs));
        return res;
      }
      finish(s.recorder.commit());
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
        heightOpOptions(area, options),
      );
      res.dirtyHeights = r.window;
      res.slopeClamped = r.slopeClamped;
      if (r.slopeClamped) res.status = slopeClampHint(options.slopeLimitDeg);
      finish(rec.commit());
      return res;
    },
    rotateStamp(sign: 1 | -1, coarse = false): void {
      options.stampRotationRad += sign * (coarse ? STAMP_ROTATE_COARSE_RAD : STAMP_ROTATE_STEP_RAD);
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
      selection = null;
      pushPull = null;
      repeat = null;
    },
  };
}

export type ToolDispatcher = ReturnType<typeof createToolDispatcher>;
