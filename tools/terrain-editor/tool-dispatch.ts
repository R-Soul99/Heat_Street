/**
 * Pure tool dispatcher for the terrain sculpt page (phase 04.2 plan 13, D-10..D-15).
 *
 * Maps pointer phases + panel options onto the core brush / road / selection ops.
 * One stroke (pointer down to up) is exactly one undo entry (D-11). No DOM and
 * no three: the editor feeds world-space cursor hits in and rebuilds only the
 * dirty regions that come back out.
 */

import type { RoadGraph, RoadGraphEdge } from "../../src/core/road-graph.ts";
import type { RouteDraft } from "../../src/core/route-draft.ts";
import type { StageDraft } from "../../src/core/stage.ts";
import type { SurfaceType } from "../../src/core/surface-types.ts";
import {
  BLOCK_STEP_MAX_M,
  BLOCK_STEP_MIN_M,
  type BrushParams,
  type BrushResult,
  type BrushShape,
  createStrokeRecorder,
  type Falloff,
  flattenBrush,
  flattenMaskToAverage,
  type HeightOpOptions,
  paintMask,
  paintSurface,
  raiseLower,
  SMOOTH_PASSES_MAX,
  type StrokeDiff,
  type StrokeRecorder,
  setMaskFromBase,
  smoothBrush,
  smoothRegion,
  snapshotWindow,
} from "../../src/core/terrain-brush.ts";
import {
  type CellMask,
  cellBoxFromWindow,
  createCellMask,
  type MaskOp,
} from "../../src/core/terrain-cell-mask.ts";
import type {
  TerrainBuilding,
  TerrainFeature,
  TerrainObject,
  TerrainStartPoint,
} from "../../src/core/terrain-format.ts";
import { sampleTerrainHeight } from "../../src/core/terrain-grid.ts";
import { MAX_SLOPE_DEG } from "../../src/core/terrain-limits.ts";
import {
  applyRoadStroke,
  edgeIdsInMask,
  eraseRoad,
  eraseRoadRegion,
  type RegradeResult,
  ROAD_PRESETS,
  type RoadEditTarget,
  type RoadPresetId,
  regradeRoads,
  roadVertexMask,
  setRoadLock,
} from "../../src/core/terrain-road.ts";
import { unlockedSet } from "../../src/core/terrain-road-lock.ts";
import type { CellWindow } from "../../src/core/terrain-slope.ts";
import { type ApplyResult, createUndoStack, type UndoTarget } from "../../src/core/terrain-undo.ts";
import { heldTickStrength, isHoldTool } from "./hold-brush.ts";
import {
  BRUSH_TOOL_FOR,
  type BrushToolName,
  type Mode,
  type Operation,
  type PlaceKind,
  type RoadAction,
  type RoadBrush,
} from "./rail-tools.ts";
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
import {
  reseatBuildingsAfterSculpt,
  styledBuildingTouchesWindow,
  type WorldWindow,
} from "./scenery-guards.ts";
import { NO_SELECTION_STATUS, SWITCH_TO_SELECT_STATUS } from "./toolbar-state.ts";

/** Road preset whose class matches the edge (fix strokes look like the road they extend). */
function presetIdForEdge(edge: RoadGraphEdge | undefined): RoadPresetId {
  if (!edge) return "street";
  const ids = Object.keys(ROAD_PRESETS) as RoadPresetId[];
  return ids.find((id) => ROAD_PRESETS[id].roadClass === edge.roadClass) ?? "street";
}

/** Internal tool: a brush, or the Select-mode rubber band. */
export type Tool = BrushToolName | "select";

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
  /** Road tool draws a straight line from press to release. */
  roadStraight: boolean;
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
  /** 07.1.3: the start-point list changed (refresh markers and list, mark dirty). */
  startPointsChanged: boolean;
  /** 07.1.3: scenery arrays changed (rebuild scenery meshes, mark dirty). */
  featuresChanged: boolean;
  buildingsChanged: boolean;
  objectsChanged: boolean;
  /** Phase 10: stage / road-route draft lists changed (refresh route markers and lists, mark dirty). */
  stagesChanged: boolean;
  routesChanged: boolean;
  /** The mask selection changed (a Select-mode drag finished). */
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
  startPointsChanged: boolean;
  featuresChanged: boolean;
  buildingsChanged: boolean;
  objectsChanged: boolean;
  stagesChanged: boolean;
  routesChanged: boolean;
}

/**
 * Asks commitScenery to fold this edit into the previous one when that was the newest undo
 * entry, carried the same key and was made no more than windowMs before nowMs. A held
 * arrow key or stepper button is then one undo step, not one per repeat tick.
 */
export interface SceneryMerge {
  readonly key: string;
  readonly nowMs: number;
  readonly windowMs: number;
}

export interface Modifiers {
  shift?: boolean;
  ctrl?: boolean;
  /** Alt+drag on a selection in Select mode starts push/pull (D-05); brushes ignore it. */
  alt?: boolean;
}

export type EditArea = RoadEditTarget & UndoTarget;

export const SLOPE_LIMIT_MIN_DEG = 5;
export const SLOPE_LIMIT_MAX_DEG = 80;
const PUSH_PULL_MAX_M = 50;
const NO_SELECTION_MSG = NO_SELECTION_STATUS;
const ERASE_MSG = "Road erased. Ctrl+Z to undo.";

export const heldStatus = (n: number): string =>
  `Cells beside locked roads were left untouched (${n} vertices held). Select the road and press Unlock (U) to sculpt it.`;

const NO_ROADS_IN_SELECTION = "No roads in the selection";

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
    startPointsChanged: false,
    featuresChanged: false,
    buildingsChanged: false,
    objectsChanged: false,
    stagesChanged: false,
    routesChanged: false,
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
  into.startPointsChanged ||= r.startPointsChanged;
  into.featuresChanged ||= r.featuresChanged;
  into.buildingsChanged ||= r.buildingsChanged;
  into.objectsChanged ||= r.objectsChanged;
  into.stagesChanged ||= r.stagesChanged;
  into.routesChanged ||= r.routesChanged;
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

interface DiffWindows {
  heights?: CellWindow;
  paint?: CellWindow;
  graph: boolean;
  lock: boolean;
  startPoints: boolean;
  features: boolean;
  buildings: boolean;
  objects: boolean;
  stages: boolean;
  routes: boolean;
}

function windowsOfDiff(area: EditArea, diff: StrokeDiff | undefined): DiffWindows {
  const out: DiffWindows = {
    graph: false,
    lock: false,
    startPoints: false,
    features: false,
    buildings: false,
    objects: false,
    stages: false,
    routes: false,
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
  out.startPoints = diff.startPoints !== undefined;
  out.features = diff.features !== undefined;
  out.buildings = diff.buildings !== undefined;
  out.objects = diff.objects !== undefined;
  out.stages = diff.stages !== undefined;
  out.routes = diff.routes !== undefined;
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
  let startPoints: StrokeDiff["startPoints"];
  let features: StrokeDiff["features"];
  let buildings: StrokeDiff["buildings"];
  let objects: StrokeDiff["objects"];
  let stages: StrokeDiff["stages"];
  let routes: StrokeDiff["routes"];
  for (const d of diffs) {
    if (d.stages) stages = stages ? { before: stages.before, after: d.stages.after } : d.stages;
    if (d.routes) routes = routes ? { before: routes.before, after: d.routes.after } : d.routes;
    if (d.features) {
      features = features ? { before: features.before, after: d.features.after } : d.features;
    }
    if (d.buildings) {
      buildings = buildings ? { before: buildings.before, after: d.buildings.after } : d.buildings;
    }
    if (d.objects) {
      objects = objects ? { before: objects.before, after: d.objects.after } : d.objects;
    }
    if (d.startPoints) {
      startPoints = startPoints
        ? { before: startPoints.before, after: d.startPoints.after }
        : d.startPoints;
    }
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
    ...(startPoints ? { startPoints } : {}),
    ...(features ? { features } : {}),
    ...(buildings ? { buildings } : {}),
    ...(objects ? { objects } : {}),
    ...(stages ? { stages } : {}),
    ...(routes ? { routes } : {}),
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
  /** Road stroke draws a dead-straight start-to-end line (Shift or the Straight option). */
  straight: boolean;
}

export function createToolDispatcher(getArea: () => EditArea) {
  const stack = createUndoStack(50);
  // Authority rule: `mode` is authoritative for where pointer input goes. In "select" mode
  // pointer drags edit the selection; in "brush" mode they run the armed brush.
  // No code path reads `brushTool` without going through `mode` (see activeTool).
  let mode: Mode = "select";
  let armed: Operation | RoadBrush | null = null;
  let brushTool: Tool | null = null;
  // 07.1.3: an armed Place kind. While set the editor routes pointer input to the place
  // tool and the dispatcher refuses strokes. Mode is unchanged (select | brush).
  let placing: PlaceKind | null = null;
  const activeTool = (): Tool | null => (mode === "select" ? "select" : brushTool);
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
    roadStraight: false,
    slopeLimitDeg: MAX_SLOPE_DEG,
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

  /**
   * One brush application. `heldTickS` marks a held (stationary) tick: raise and lower then add
   * `strength` metres per SECOND (rate = tick length), smooth and flatten blend by the per-tick
   * share of `strength` per second. A moving stroke leaves it undefined and is unchanged.
   */
  function dab(s: Stroke, x: number, z: number, heldTickS?: number): ToolResult {
    const area = getArea();
    const res = emptyResult();
    const p = params(x, z);
    if (heldTickS !== undefined && (s.tool === "smooth" || s.tool === "flatten")) {
      p.strength = heldTickStrength(options.strength, heldTickS);
    }
    if (s.tool === "paint") {
      const r = paintSurface(area.paint, p, options.surface, { road: false }, s.recorder);
      if (r.rect) res.dirtyPaint = paintRectToCells(area, r.rect);
      return res;
    }
    let r: BrushResult;
    const hop = heightOpOptions(area, options);
    if (s.tool === "raise" || s.tool === "lower") {
      r = raiseLower(
        area.grid,
        p,
        s.tool === "lower" ? -1 : 1,
        heldTickS ?? 1,
        s.recorder,
        hop,
        heldTickS === undefined,
      );
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
    const spacing = Math.max(0.25, options.radiusM / 4);
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

  /**
   * Ends the stroke and pushes its diff. Returns true when the pushed entry re-seated
   * buildings, so every caller can report buildingsChanged and the view redraws them.
   */
  function finish(diff: StrokeDiff | undefined): boolean {
    const pushed = diff ? pushDiff(getArea(), diff) : undefined;
    stroke = null;
    return pushed?.buildings !== undefined;
  }

  /** World rectangle (one cell of margin) covering the vertices a heights part wrote. */
  function worldWindowOfHeights(area: EditArea, indices: Uint32Array): WorldWindow {
    const g = area.grid;
    const stride = g.rows + 1;
    let minRow = Number.POSITIVE_INFINITY;
    let maxRow = -1;
    let minCol = Number.POSITIVE_INFINITY;
    let maxCol = -1;
    for (const i of indices) {
      const row = i % stride;
      const col = (i - row) / stride;
      if (row < minRow) minRow = row;
      if (row > maxRow) maxRow = row;
      if (col < minCol) minCol = col;
      if (col > maxCol) maxCol = col;
    }
    return {
      minX: g.originX + (minCol - 1) * g.cellSizeM,
      maxX: g.originX + (maxCol + 1) * g.cellSizeM,
      minZ: g.originZ + (minRow - 1) * g.cellSizeM,
      maxZ: g.originZ + (maxRow + 1) * g.cellSizeM,
    };
  }

  /**
   * 07.1.3: styled buildings under a sculpt rise and fall with the terrain. The re-seat
   * rides in the SAME diff (a buildings part), so the stroke stays one undo step and undo
   * restores the stored box exactly. The grid is already sculpted when this runs, so the
   * BEFORE heights come from a copy with the diff's before values written back. The copy
   * is only made when a styled building touches the window. Style-less buildings never move.
   */
  function withBuildingReseat(area: EditArea, diff: StrokeDiff): StrokeDiff {
    const heights = diff.heights;
    const live = area.buildings;
    if (!heights || diff.buildings || !live || live.length === 0) return diff;
    const win = worldWindowOfHeights(area, heights.indices);
    if (!styledBuildingTouchesWindow(live, win)) return diff;
    const g = area.grid;
    const beforeHeights = Float32Array.from(g.heights);
    heights.indices.forEach((idx, k) => {
      if (idx < beforeHeights.length) beforeHeights[idx] = heights.before[k] as number;
    });
    const beforeGrid = { ...g, heights: beforeHeights };
    const next = reseatBuildingsAfterSculpt(
      live,
      (x, z) => sampleTerrainHeight(beforeGrid, x, z),
      (x, z) => sampleTerrainHeight(g, x, z),
      win,
    );
    if (next === live) return diff;
    const before = [...live];
    const after = [...next];
    area.buildings = after;
    return { ...diff, buildings: { before, after } };
  }

  /**
   * The newest undo entry when a merging commitScenery made it (see SceneryMerge). Any other
   * push, undo, redo or history clear forgets it, so a merge can only ever extend the top entry.
   */
  let mergeable: { key: string; atMs: number; entry: StrokeDiff } | null = null;

  /** Pushes one diff as ONE undo entry, folding in the building re-seat for sculpt diffs. */
  function pushDiff(area: EditArea, diff: StrokeDiff): StrokeDiff {
    const out = withBuildingReseat(area, diff);
    stack.push(out);
    mergeable = null;
    return out;
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
      startPointsChanged: r.startPointsChanged,
      featuresChanged: r.featuresChanged,
      buildingsChanged: r.buildingsChanged,
      objectsChanged: r.objectsChanged,
      stagesChanged: r.stagesChanged,
      routesChanged: r.routesChanged,
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
    brushTool = op ? BRUSH_TOOL_FOR[op] : null;
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

  const fmtChange = (r: { maxHeightChangeM: number; maxGradePct: number }): string =>
    `max height change ${r.maxHeightChangeM.toFixed(2)} m, max grade ${r.maxGradePct.toFixed(1)}%`;

  /**
   * Pushes a diff as ONE undo entry on the single stack (D-16) and reports what changed.
   * Reused by lock / re-grade and by scenery edits (start points, later features).
   */
  function commitSceneryDiff(area: EditArea, diff: StrokeDiff | undefined): ToolResult {
    const res = emptyResult();
    if (!diff) return res;
    const pushed = pushDiff(area, diff);
    const w = windowsOfDiff(area, pushed);
    res.dirtyHeights = w.heights;
    res.dirtyPaint = w.paint;
    res.graphChanged = w.graph;
    res.lockChanged = w.lock;
    res.startPointsChanged = w.startPoints;
    res.featuresChanged = w.features;
    res.buildingsChanged = w.buildings;
    res.objectsChanged = w.objects;
    res.stagesChanged = w.stages;
    res.routesChanged = w.routes;
    return res;
  }

  /** Pushes a lock / re-grade diff as ONE undo entry and reports what changed. */
  function commitLockDiff(area: EditArea, diff: StrokeDiff | undefined): ToolResult {
    return commitSceneryDiff(area, diff);
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

  return {
    getTool: (): Tool => activeTool() ?? "raise",
    getOptions: (): Readonly<ToolOptions> => options,
    getMode: (): Mode => mode,
    /** Switching mode never touches the selection (D-06). */
    setMode(next: Mode): void {
      if (stroke?.tool === "select")
        stroke = null; // drop the unreleased rubber band
      else if (stroke) this.pointerUp(Number.NaN, Number.NaN);
      placing = null;
      mode = next;
    },
    getArmed: (): Operation | RoadBrush | null => armed,
    /** Arms a brush and switches to Brush mode (D-16). */
    armBrush(op: Operation | RoadBrush): void {
      if (stroke?.tool === "select")
        stroke = null; // drop the unreleased rubber band
      else if (stroke) this.pointerUp(Number.NaN, Number.NaN);
      selectBrushTool(op);
      placing = null;
      mode = "brush";
    },
    placing: (): PlaceKind | null => placing,
    /** Arms (or with null clears) a Place kind; drops any unreleased stroke first. */
    setPlacing(kind: PlaceKind | null): void {
      if (stroke?.tool === "select") stroke = null;
      else if (stroke) this.pointerUp(Number.NaN, Number.NaN);
      placing = kind;
    },
    /**
     * Leaves a Place tool (Esc) and lands in Select mode, never back in a brush that was armed
     * before Place was opened: the next click should pick the item just placed, not sculpt.
     */
    stopPlacing(): void {
      this.setMode("select");
    },
    /** One undo step for a start-point list edit; a deep-equal list pushes nothing. */
    commitStartPoints(next: readonly TerrainStartPoint[]): ToolResult {
      const area = getArea();
      const before = area.startPoints ?? [];
      if (JSON.stringify(before) === JSON.stringify(next)) return emptyResult();
      area.startPoints = [...next];
      return commitSceneryDiff(area, { startPoints: { before, after: next } });
    },
    /** One undo step for a stage-draft list edit; a deep-equal list pushes nothing. */
    commitStages(next: readonly StageDraft[]): ToolResult {
      const area = getArea();
      const before = area.stages ?? [];
      if (JSON.stringify(before) === JSON.stringify(next)) return emptyResult();
      area.stages = [...next];
      return commitSceneryDiff(area, { stages: { before, after: next } });
    },
    /** One undo step for a road-route draft list edit; a deep-equal list pushes nothing. */
    commitRoutes(next: readonly RouteDraft[]): ToolResult {
      const area = getArea();
      const before = area.routes ?? [];
      if (JSON.stringify(before) === JSON.stringify(next)) return emptyResult();
      area.routes = [...next];
      return commitSceneryDiff(area, { routes: { before, after: next } });
    },
    /**
     * One undo step for any mix of feature, building and ramp-object edits (D-16). Only
     * the parts that differ from the live area are recorded; nothing differing pushes
     * nothing. Together with applyStrokeDiff this is the only write path for these arrays.
     * With `merge`, a run of edits sharing a key becomes one undo step (see SceneryMerge).
     */
    commitScenery(
      next: {
        features?: readonly TerrainFeature[];
        buildings?: readonly TerrainBuilding[];
        objects?: readonly TerrainObject[];
      },
      merge?: SceneryMerge,
    ): ToolResult {
      const area = getArea();
      const differs = <T>(a: readonly T[], b: readonly T[] | undefined): b is readonly T[] =>
        b !== undefined && JSON.stringify(a) !== JSON.stringify(b);
      const curF = area.features ?? [];
      const curB = area.buildings ?? [];
      const curO = area.objects ?? [];
      const diff: {
        features?: { before: readonly TerrainFeature[]; after: readonly TerrainFeature[] };
        buildings?: { before: readonly TerrainBuilding[]; after: readonly TerrainBuilding[] };
        objects?: { before: readonly TerrainObject[]; after: readonly TerrainObject[] };
      } = {};
      if (differs(curF, next.features)) {
        diff.features = { before: [...curF], after: [...next.features] };
        area.features = [...next.features];
      }
      if (differs(curB, next.buildings)) {
        diff.buildings = { before: [...curB], after: [...next.buildings] };
        area.buildings = [...next.buildings];
      }
      if (differs(curO, next.objects)) {
        diff.objects = { before: [...curO], after: [...next.objects] };
        area.objects = [...next.objects];
      }
      if (!diff.features && !diff.buildings && !diff.objects) return emptyResult();
      if (merge === undefined) return commitSceneryDiff(area, diff);
      const prev = mergeable;
      const folded =
        prev !== null && prev.key === merge.key && merge.nowMs - prev.atMs <= merge.windowMs
          ? mergeDiffs([prev.entry, diff])
          : undefined;
      let entry: StrokeDiff;
      if (folded !== undefined && stack.amendTop(folded)) entry = folded;
      else entry = pushDiff(area, diff);
      mergeable = { key: merge.key, atMs: merge.nowMs, entry };
      const res = emptyResult();
      res.featuresChanged = diff.features !== undefined;
      res.buildingsChanged = diff.buildings !== undefined;
      res.objectsChanged = diff.objects !== undefined;
      return res;
    },
    getSelectionMask: (): CellMask | null => liveSelection(),
    selectionCellCount: (): number => liveSelection()?.cellCount() ?? 0,
    /** Adapter onto setMode/armBrush by internal tool name (the editor uses setMode/armBrush). */
    setTool(next: Tool): void {
      if (stroke?.tool === "select")
        stroke = null; // drop the unreleased rubber band
      else if (stroke) this.pointerUp(Number.NaN, Number.NaN);
      if (next === "select") {
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
    /** True while the live stroke is a raise, lower, smooth or flatten brush (can be held still). */
    isHoldStroke: (): boolean => stroke !== null && isHoldTool(stroke.tool),
    /**
     * One held tick of the live brush at (x, z): same stroke recorder, so the whole press (held
     * and moved) stays ONE undo step. Paint, road and erase strokes ignore it.
     */
    holdTick(x: number, z: number, tickS: number): ToolResult {
      const s = stroke;
      if (!s || placing !== null || !isHoldTool(s.tool)) return emptyResult();
      if (!Number.isFinite(x) || !Number.isFinite(z) || !(tickS > 0)) return emptyResult();
      return dab(s, x, z, tickS);
    },
    isRepeating: (): boolean => repeat !== null,

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

    /**
     * Lock / Unlock / Delete road on the mask selection (D-14, D-15, D-25, D-26): whole
     * edges for lock/unlock, cut at the selection edge for delete; ONE undo step each.
     */
    applyRoadAction(action: RoadAction): ToolResult {
      if (stroke) this.pointerUp(Number.NaN, Number.NaN);
      const res = emptyResult();
      if (mode !== "select") {
        res.status = SWITCH_TO_SELECT_STATUS;
        return res;
      }
      const sel = liveSelection();
      if (!sel) {
        res.status = NO_SELECTION_MSG;
        return res;
      }
      const area = getArea();
      if (action === "deleteRoad") {
        const r = eraseRoadRegion(area, sel);
        if (!r.diff) {
          res.status = NO_ROADS_IN_SELECTION;
          res.warnings.push(...r.warnings);
          return res;
        }
        const out = commitLockDiff(area, r.diff);
        out.warnings.push(...r.warnings);
        out.status = "Road deleted in the selection. Ctrl+Z to undo.";
        return out;
      }
      const ids = edgeIdsInMask(area.graph, area.grid, sel);
      if (ids.length === 0) {
        res.status = NO_ROADS_IN_SELECTION;
        return res;
      }
      const locked = action === "lock";
      const r = setRoadLock(area, ids, locked);
      const out = commitLockDiff(area, r.diff);
      out.warnings.push(...r.warnings);
      out.status = `${locked ? "Locked" : "Unlocked"} ${r.changedEdgeIds.length} road(s)`;
      return out;
    },

    /** Re-grades only the unlocked roads touching the selection (D-27): one undo step. */
    regradeSelection(): ToolResult {
      if (stroke) this.pointerUp(Number.NaN, Number.NaN);
      const res = emptyResult();
      if (mode !== "select") {
        res.status = SWITCH_TO_SELECT_STATUS;
        return res;
      }
      const sel = liveSelection();
      if (!sel) {
        res.status = NO_SELECTION_MSG;
        return res;
      }
      const area = getArea();
      const unlocked = unlockedSet(area.unlockedEdgeIds);
      const ids = edgeIdsInMask(area.graph, area.grid, sel).filter((id) => unlocked?.has(id));
      if (ids.length === 0) {
        res.status = "No unlocked roads in the selection";
        return res;
      }
      return regradeResult(area, regradeRoads(area, ids));
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

    clearSelection(): void {
      selection = null;
    },

    /** Live selection rubber-band window from the drag start to (x, z); null when not dragging. */
    selectionPreview(x: number, z: number): CellWindow | null {
      const s = stroke;
      if (s?.tool !== "select" || !Number.isFinite(x) || !Number.isFinite(z)) return null;
      return windowBetween(getArea(), s.start, { x, z });
    },

    /** How the active selection drag will combine with the selection (for rubber-band styling). */
    selectionDragOp(): MaskOp | null {
      const s = stroke;
      if (s?.tool !== "select") return null;
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
        const res = heightResult(r);
        if (diff) res.buildingsChanged = pushDiff(area, diff).buildings !== undefined;
        return res;
      }
      const r = paintMask(area.paint, area.grid, sel, options.surface, rec);
      const diff = rec.commit();
      if (diff) pushDiff(area, diff);
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
        const pushed = pushDiff(getArea(), diff);
        res.dirtyHeights = windowsOfDiff(getArea(), pushed).heights;
        res.buildingsChanged = pushed.buildings !== undefined;
      }
      return res;
    },

    /** Starts a push/pull on the selection (snapshot taken now). False with no selection. */
    beginPushPull(): boolean {
      if (stroke) this.pointerUp(Number.NaN, Number.NaN);
      if (repeat) this.endOpRepeat(); // never two recorders on the same vertices
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
        const pushed = pushDiff(getArea(), diff);
        res.dirtyHeights = windowsOfDiff(getArea(), pushed).heights;
        res.buildingsChanged = pushed.buildings !== undefined;
      }
      return res;
    },

    /**
     * Reverts every vertex the drag touched (including slope-limiter-moved
     * neighbours outside the selection) by applying the recorder's own inverse
     * diff; no undo entry is left behind.
     */
    cancelPushPull(): ToolResult {
      const pp = pushPull;
      if (!pp) return emptyResult();
      pushPull = null;
      const res = emptyResult();
      const diff = pp.recorder.commit();
      if (!diff) return res;
      const area = getArea();
      const scratch = createUndoStack(1);
      scratch.push(diff);
      const r = scratch.undo(area);
      if (r) res.dirtyHeights = r.heightsWindow;
      return res;
    },

    /** Drops an in-progress selection drag without editing anything (Escape). */
    cancelSelectDrag(): boolean {
      if (stroke?.tool !== "select") return false;
      stroke = null;
      return true;
    },

    pointerDown(x: number, z: number, mods: Modifiers): ToolResult {
      if (!Number.isFinite(x) || !Number.isFinite(z)) return emptyResult();
      if (placing !== null) return emptyResult();
      if (stroke) this.pointerUp(x, z);
      const tool = activeTool();
      if (tool === null) {
        const res = emptyResult();
        res.status = "Pick an operation";
        return res;
      }
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
        straight: tool === "road" && (options.roadStraight || !!mods.shift),
      };
      stroke = s;
      const res = emptyResult();
      if (
        tool === "raise" ||
        tool === "lower" ||
        tool === "smooth" ||
        tool === "flatten" ||
        tool === "paint"
      ) {
        mergeInto(res, dab(s, x, z));
      } else if (tool === "erase") {
        mergeInto(res, doErase(s, x, z));
      } else if (tool === "road") {
        res.previewPoints = [...s.points];
      }
      return res;
    },

    pointerMove(x: number, z: number, mods?: Modifiers): ToolResult {
      const s = stroke;
      if (placing !== null) return emptyResult();
      if (!s || !Number.isFinite(x) || !Number.isFinite(z)) return emptyResult();
      const res = emptyResult();
      if (s.tool === "road") {
        const last = s.points[s.points.length - 1];
        if (Math.hypot(x - last.x, z - last.z) >= 0.5) s.points.push({ x, z });
        s.last = { x, z };
        s.straight = options.roadStraight || !!mods?.shift;
        res.previewPoints = s.straight ? [s.start, { x, z }] : [...s.points];
      } else if (s.tool === "erase") {
        mergeInto(
          res,
          dabAlong(s, x, z, (px, pz) => doErase(s, px, pz)),
        );
      } else if (s.tool === "select") {
        s.last = { x, z };
      } else {
        mergeInto(
          res,
          dabAlong(s, x, z, (px, pz) => dab(s, px, pz)),
        );
      }
      return res;
    },

    pointerUp(x: number, z: number): ToolResult {
      const s = stroke;
      if (!s || placing !== null) return emptyResult();
      const area = getArea();
      const res = emptyResult();
      const finite = Number.isFinite(x) && Number.isFinite(z);
      if (s.tool === "road") {
        let pts = s.points;
        const end = finite ? { x, z } : s.last;
        if (s.straight && Math.hypot(end.x - s.start.x, end.z - s.start.z) >= 0.5) {
          pts = [s.start, end];
        } else if (finite) {
          const last = s.points[s.points.length - 1];
          if (Math.hypot(x - last.x, z - last.z) >= 0.5) s.points.push({ x, z });
        }
        if (pts.length >= 2) {
          const r = applyRoadStroke(area, pts, options.roadPreset, {
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
            res.buildingsChanged = finish(r.diff);
            return res;
          }
        }
        finish(undefined);
        return res;
      }
      if (s.tool === "select") {
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
      if (s.tool === "erase") {
        res.buildingsChanged = finish(mergeDiffs(s.diffs));
        return res;
      }
      res.buildingsChanged = finish(s.recorder.commit());
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
      res.buildingsChanged = finish(rec.commit());
      return res;
    },
    undo(): UndoRedoResult | false {
      const area = getArea();
      mergeable = null;
      return toUndoResult(area, stack.undo(area));
    },
    redo(): UndoRedoResult | false {
      const area = getArea();
      mergeable = null;
      return toUndoResult(area, stack.redo(area));
    },
    canUndo: (): boolean => stack.canUndo(),
    canRedo: (): boolean => stack.canRedo(),
    clearHistory(): void {
      stack.clear();
      mergeable = null;
      stroke = null;
      selection = null;
      pushPull = null;
      repeat = null;
    },
  };
}

export type ToolDispatcher = ReturnType<typeof createToolDispatcher>;
