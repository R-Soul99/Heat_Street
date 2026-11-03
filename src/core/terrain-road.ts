/**
 * Road brush for the terrain editor (phase 04.2, plan 09; D-13..D-16).
 *
 * One road stroke paints the surface, levels and smooths the heights along it
 * (with optional automatic banking) and records the centreline as road-graph
 * edges, as ONE undoable `StrokeDiff`. Erasing a road removes its paint and its
 * graph edge but leaves the levelled terrain (D-15).
 *
 * Pipeline of `applyRoadStroke`:
 *   prepareStrokePolyline -> findStrokeCrossings (pin heights at junctions) ->
 *   roadHeightProfile -> roadBankAngles -> levelRoadBand -> paint ->
 *   limitSlope (road vertices fixed) -> addRoadStroke with y read back from the
 *   levelled terrain (graph y == terrain y, D-16).
 *
 * Coarse cells (D-06): the levelled radius is `max(halfWidth, cell * sqrt2)`,
 * so every vertex of every triangle the centreline passes through is levelled
 * and the road surface reads exactly the planned height even when the cell size
 * exceeds the road half-width.
 *
 * Vertical curves (gate finding, 04.2-GATE.md): a grade change needs roughly
 * 2.4 s of travel at design speed to ride smoothly. The height profile is a
 * moving average whose window is that length (clamped 15..80 m), which turns
 * every grade step into a parabolic vertical curve of the same length.
 *
 * Layering: pure core, no three/rapier/DOM.
 */

import type { RoadGraph } from "./road-graph.ts";
import type { SurfaceType } from "./surface-types.ts";
import {
  createStrokeRecorder,
  MAX_RADIUS_M,
  MIN_RADIUS_M,
  type PaintRect,
  type StrokeDiff,
} from "./terrain-brush.ts";
import {
  addRoadStroke,
  ensureDefaultSpawn,
  eraseGraphDisc,
  findStrokeCrossings,
  type GraphEditState,
} from "./terrain-graph.ts";
import { sampleTerrainHeight, type TerrainGrid } from "./terrain-grid.ts";
import { DEFAULT_MAX_BANK_DEG, MAX_SLOPE_DEG } from "./terrain-limits.ts";
import { encodePaintValue, PAINT_ROAD_FLAG, type PaintMap, paintIndexAt } from "./terrain-paint.ts";
import { type CellWindow, expandWindow, limitSlope } from "./terrain-slope.ts";
import { applyStrokeDiff } from "./terrain-undo.ts";

// ---------------------------------------------------------------- presets

export type RoadPresetId = "street" | "highway" | "track" | "dirt";

export interface RoadPreset {
  readonly label: string;
  readonly roadClass: string;
  readonly lanes: number;
  readonly widthM: number;
  readonly surface: SurfaceType;
  readonly speedLimitKph: number;
  readonly designSpeedKph: number;
  /** 0 = banking off for this class (D-14). */
  readonly maxBankDeg: number;
}

/**
 * D-14 discretion values from the UI-SPEC ASSUMPTION table (not user-signed
 * numbers): tune freely, tests pin only the shape of the table.
 */
export const ROAD_PRESETS: Readonly<Record<RoadPresetId, RoadPreset>> = {
  street: {
    label: "Street",
    roadClass: "residential",
    lanes: 2,
    widthM: 10,
    surface: "tarmac",
    speedLimitKph: 40,
    designSpeedKph: 40,
    maxBankDeg: 0,
  },
  highway: {
    label: "Highway",
    roadClass: "primary",
    lanes: 2,
    widthM: 14,
    surface: "tarmac",
    speedLimitKph: 100,
    designSpeedKph: 100,
    maxBankDeg: DEFAULT_MAX_BANK_DEG,
  },
  track: {
    label: "Track",
    roadClass: "track",
    lanes: 1,
    widthM: 8,
    surface: "gravel",
    speedLimitKph: 60,
    designSpeedKph: 60,
    maxBankDeg: 6,
  },
  dirt: {
    label: "Dirt road",
    roadClass: "unclassified",
    lanes: 1,
    widthM: 7,
    surface: "dirt_road",
    speedLimitKph: 50,
    designSpeedKph: 50,
    maxBankDeg: 0,
  },
};

export const MIN_ROAD_WIDTH_M = 3;
export const MAX_ROAD_WIDTH_M = 20;
/** Longitudinal grade ceiling the road profile is clamped to (validator MAX_GRADIENT is 0.5). */
const MAX_PROFILE_GRADE = 0.5;
/** Margin under the validator ceiling for the grade applyRoadStroke asks for. */
const STROKE_GRADE = 0.45;
const GRAVITY = 9.81;
const BANK_SMOOTH_M = 20;
const RDP_TOLERANCE_M = 0.25;
const MAX_RESAMPLE_POINTS = 20000;

interface XZ {
  x: number;
  z: number;
}

// ---------------------------------------------------------------- stroke prep

function ramerDouglasPeucker(pts: readonly XZ[], tol: number): XZ[] {
  const n = pts.length;
  if (n < 3) return pts.slice();
  const keep = new Uint8Array(n);
  keep[0] = 1;
  keep[n - 1] = 1;
  const stack: [number, number][] = [[0, n - 1]];
  while (stack.length > 0) {
    const [a, b] = stack.pop() as [number, number];
    let worst = -1;
    let worstD = tol;
    const dx = pts[b].x - pts[a].x;
    const dz = pts[b].z - pts[a].z;
    const len = Math.hypot(dx, dz);
    for (let i = a + 1; i < b; i++) {
      const d =
        len > 0
          ? Math.abs((pts[i].x - pts[a].x) * dz - (pts[i].z - pts[a].z) * dx) / len
          : Math.hypot(pts[i].x - pts[a].x, pts[i].z - pts[a].z);
      if (d > worstD) {
        worstD = d;
        worst = i;
      }
    }
    if (worst >= 0) {
      keep[worst] = 1;
      stack.push([a, worst], [worst, b]);
    }
  }
  return pts.filter((_, i) => keep[i] === 1);
}

function chaikin(pts: readonly XZ[]): XZ[] {
  if (pts.length < 3) return pts.slice();
  const out: XZ[] = [pts[0]];
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    out.push({ x: 0.75 * a.x + 0.25 * b.x, z: 0.75 * a.z + 0.25 * b.z });
    out.push({ x: 0.25 * a.x + 0.75 * b.x, z: 0.25 * a.z + 0.75 * b.z });
  }
  out.push(pts[pts.length - 1]);
  return out;
}

function resample(pts: readonly XZ[], spacing: number): XZ[] {
  const out: XZ[] = [{ x: pts[0].x, z: pts[0].z }];
  let carry = 0;
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    let at = spacing - carry;
    while (at < len) {
      const t = at / len;
      out.push({ x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t });
      at += spacing;
    }
    carry = len - (at - spacing);
  }
  const last = pts[pts.length - 1];
  const tail = out[out.length - 1];
  if (Math.hypot(last.x - tail.x, last.z - tail.z) > 1e-6) out.push({ x: last.x, z: last.z });
  return out;
}

/**
 * Cursor samples -> a clean centreline: duplicates and non-finite points
 * dropped, resampled at cellSizeM / 2, smoothed with 2 Chaikin iterations and
 * simplified with Ramer-Douglas-Peucker at 0.25 m. Returns [] for fewer than 2
 * distinct points.
 */
export function prepareStrokePolyline(
  raw: readonly { x: number; z: number }[],
  cellSizeM: number,
): { x: number; z: number }[] {
  const clean: XZ[] = [];
  for (const p of raw) {
    if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.z)) continue;
    const last = clean[clean.length - 1];
    if (last !== undefined && Math.hypot(p.x - last.x, p.z - last.z) < 1e-3) continue;
    clean.push({ x: p.x, z: p.z });
  }
  if (clean.length < 2) return [];
  let total = 0;
  for (let i = 1; i < clean.length; i++) {
    total += Math.hypot(clean[i].x - clean[i - 1].x, clean[i].z - clean[i - 1].z);
  }
  let spacing = Math.max(0.25, (Number.isFinite(cellSizeM) && cellSizeM > 0 ? cellSizeM : 1) / 2);
  spacing = Math.max(spacing, total / MAX_RESAMPLE_POINTS);
  let pts = resample(clean, spacing);
  if (pts.length < 2) return [];
  pts = chaikin(chaikin(pts));
  pts = ramerDouglasPeucker(pts, RDP_TOLERANCE_M);
  return pts.length >= 2 ? pts : [];
}

// ---------------------------------------------------------------- profile

function cumulativeLength(pts: readonly XZ[]): Float64Array {
  const s = new Float64Array(pts.length);
  for (let i = 1; i < pts.length; i++) {
    s[i] = s[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z);
  }
  return s;
}

/**
 * Weighted moving average over arclength with a window of `windowM`, shrunk
 * symmetrically near the ends so end values are not biased inward.
 */
function movingAverage(s: Float64Array, values: Float64Array, windowM: number): Float64Array {
  const n = s.length;
  const out = new Float64Array(n);
  const w = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const before = i > 0 ? s[i] - s[i - 1] : 0;
    const after = i + 1 < n ? s[i + 1] - s[i] : 0;
    w[i] = (before + after) / 2 || 1;
  }
  const cw = new Float64Array(n + 1);
  const cv = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) {
    cw[i + 1] = cw[i] + w[i];
    cv[i + 1] = cv[i] + w[i] * values[i];
  }
  const total = s[n - 1];
  const lower = (target: number): number => {
    let lo = 0;
    let hi = n;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (s[mid] < target - 1e-9) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  };
  for (let i = 0; i < n; i++) {
    const hw = Math.min(windowM / 2, s[i], total - s[i]);
    const a = lower(s[i] - hw);
    const b = lower(s[i] + hw + 1e-9); // exclusive end
    const wsum = cw[b] - cw[a];
    out[i] = wsum > 0 ? (cv[b] - cv[a]) / wsum : values[i];
  }
  return out;
}

function smoothstep01(x: number): number {
  const t = Math.min(1, Math.max(0, x));
  return t * t * (3 - 2 * t);
}

export interface HeightProfileOptions {
  /** Max longitudinal grade; default min(0.5, tan(MAX_SLOPE_DEG)). */
  maxGrade?: number;
  /** Points whose height is fixed (crossings, T joins, reused nodes). */
  pins?: readonly { index: number; heightM: number }[];
  /** Low-pass window / vertical-curve length in metres (default 15). */
  smoothM?: number;
}

/**
 * Centreline heights: terrain sampled along the stroke, low-passed
 * (default 15 m moving average), pins blended in, then grade-clamped forward
 * and backward. Pinned points keep their exact heights.
 */
export function roadHeightProfile(
  grid: TerrainGrid,
  pts: readonly XZ[],
  opts: HeightProfileOptions = {},
): Float64Array {
  const n = pts.length;
  const raw = new Float64Array(n);
  for (let i = 0; i < n; i++) raw[i] = sampleTerrainHeight(grid, pts[i].x, pts[i].z);
  if (n < 2) return raw;
  const s = cumulativeLength(pts);
  const smoothM = Math.max(0, opts.smoothM ?? 15);
  const h = smoothM > 0 ? movingAverage(s, raw, smoothM) : raw.slice();

  const pins = (opts.pins ?? []).filter(
    (p) => Number.isInteger(p.index) && p.index >= 0 && p.index < n && Number.isFinite(p.heightM),
  );
  const pinned = new Uint8Array(n);
  if (pins.length > 0) {
    const taperM = Math.max(smoothM, 15);
    const deltas = pins.map((p) => p.heightM - h[p.index]);
    for (let k = 0; k < pins.length; k++) {
      const s0 = s[pins[k].index];
      for (let i = 0; i < n; i++) {
        const t = Math.abs(s[i] - s0) / taperM;
        if (t < 1) h[i] += deltas[k] * smoothstep01(1 - t);
      }
    }
    for (const p of pins) {
      h[p.index] = p.heightM;
      pinned[p.index] = 1;
    }
  }

  const g = Math.min(opts.maxGrade ?? MAX_PROFILE_GRADE, Math.tan((MAX_SLOPE_DEG * Math.PI) / 180));
  for (let i = 1; i < n; i++) {
    if (pinned[i]) continue;
    const lim = g * (s[i] - s[i - 1]) * (1 - 1e-9);
    h[i] = Math.min(h[i - 1] + lim, Math.max(h[i - 1] - lim, h[i]));
  }
  for (let i = n - 2; i >= 0; i--) {
    if (pinned[i]) continue;
    const lim = g * (s[i + 1] - s[i]) * (1 - 1e-9);
    h[i] = Math.min(h[i + 1] + lim, Math.max(h[i + 1] - lim, h[i]));
  }
  return h;
}

// ---------------------------------------------------------------- banking

/**
 * Signed bank angle per centreline point (radians). Convention: the surface
 * height offset at signed lateral offset `lat` (positive toward the left normal
 * `(-dz, dx)`) is `lat * tan(bank)`; a turn whose centre lies on the +lat side
 * gets a NEGATIVE bank, i.e. the surface falls toward the centre of the turn
 * and the outside is higher. Magnitude is atan(v^2 / (g R)) from the
 * three-point circumradius at the preset's design speed, capped at
 * `maxBankDeg`, then smoothed over 20 m so it ramps in and out (D-14).
 */
export function roadBankAngles(
  pts: readonly XZ[],
  preset: RoadPreset,
  maxBankDeg: number,
): Float64Array {
  const n = pts.length;
  const out = new Float64Array(n);
  if (n < 3 || !(preset.maxBankDeg > 0) || !(maxBankDeg > 0)) return out;
  const cap = (maxBankDeg * Math.PI) / 180;
  const v = preset.designSpeedKph / 3.6;
  const s = cumulativeLength(pts);
  const reach = 6;
  const raw = new Float64Array(n);
  let a = 0;
  let b = 0;
  for (let i = 0; i < n; i++) {
    while (a + 1 < i && s[i] - s[a + 1] >= reach) a++;
    if (b < i) b = i;
    while (b < n - 1 && s[b] - s[i] < reach) b++;
    if (s[i] - s[a] < reach - 1e-9 || s[b] - s[i] < reach - 1e-9) continue;
    const ax = pts[a].x;
    const az = pts[a].z;
    const bx = pts[i].x;
    const bz = pts[i].z;
    const cx = pts[b].x;
    const cz = pts[b].z;
    const d0x = bx - ax;
    const d0z = bz - az;
    const d1x = cx - bx;
    const d1z = cz - bz;
    const cross = d0x * d1z - d0z * d1x;
    const area2 = Math.abs(cross);
    if (area2 < 1e-9) continue;
    const R =
      (Math.hypot(d0x, d0z) * Math.hypot(d1x, d1z) * Math.hypot(cx - ax, cz - az)) / (2 * area2);
    if (!(R < 1500)) continue;
    const mag = Math.min(cap, Math.atan((v * v) / (GRAVITY * R)));
    raw[i] = cross > 0 ? -mag : mag;
  }
  // Pad both ends with zero-bank samples so the bank ramps in and out instead of
  // the averaging window shrinking to nothing at the stroke ends.
  const padN = Math.ceil(BANK_SMOOTH_M / 2 / Math.max(0.25, s[1] - s[0])) + 1;
  const total = s[n - 1];
  const dEnd = Math.max(0.25, s[n - 1] - s[n - 2]);
  const dStart = Math.max(0.25, s[1] - s[0]);
  const ps = new Float64Array(n + 2 * padN);
  const pv = new Float64Array(n + 2 * padN);
  for (let k = 0; k < padN; k++) ps[k] = -(padN - k) * dStart;
  for (let i = 0; i < n; i++) {
    ps[padN + i] = s[i];
    pv[padN + i] = raw[i];
  }
  for (let k = 0; k < padN; k++) ps[padN + n + k] = total + (k + 1) * dEnd;
  const smooth = movingAverage(ps, pv, BANK_SMOOTH_M);
  for (let i = 0; i < n; i++) out[i] = Math.max(-cap, Math.min(cap, smooth[padN + i]));
  return out;
}

// ---------------------------------------------------------------- band levelling

/** Radius within which every vertex is levelled: whole triangles under the centreline (D-06). */
export function roadLevelRadiusM(halfWidthM: number, cellSizeM: number): number {
  return Math.max(halfWidthM, cellSizeM * Math.SQRT2);
}

function vertexRange(grid: TerrainGrid, lo: number, hi: number, origin: number, max: number) {
  return {
    a: Math.max(0, Math.ceil((lo - origin) / grid.cellSizeM)),
    b: Math.min(max, Math.floor((hi - origin) / grid.cellSizeM)),
  };
}

function reachWindow(grid: TerrainGrid, pts: readonly XZ[], reach: number): CellWindow | undefined {
  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minZ = Number.POSITIVE_INFINITY;
  let maxZ = Number.NEGATIVE_INFINITY;
  for (const p of pts) {
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x);
    minZ = Math.min(minZ, p.z);
    maxZ = Math.max(maxZ, p.z);
  }
  const cols = vertexRange(grid, minX - reach, maxX + reach, grid.originX, grid.cols);
  const rows = vertexRange(grid, minZ - reach, maxZ + reach, grid.originZ, grid.rows);
  if (cols.a > cols.b || rows.a > rows.b) return undefined;
  return { minRow: rows.a, maxRow: rows.b, minCol: cols.a, maxCol: cols.b };
}

/** 1 where the paint pixel containing the vertex has PAINT_ROAD_FLAG. Grid-sized, heights indexing. */
export function roadVertexMaskFromPaint(
  grid: TerrainGrid,
  paint: PaintMap,
  area?: CellWindow,
): Uint8Array {
  const stride = grid.rows + 1;
  const mask = new Uint8Array(grid.heights.length);
  const w = area ?? { minRow: 0, minCol: 0, maxRow: grid.rows, maxCol: grid.cols };
  for (let c = Math.max(0, w.minCol); c <= Math.min(grid.cols, w.maxCol); c++) {
    const x = grid.originX + c * grid.cellSizeM;
    for (let r = Math.max(0, w.minRow); r <= Math.min(grid.rows, w.maxRow); r++) {
      const i = paintIndexAt(paint, x, grid.originZ + r * grid.cellSizeM);
      if (i >= 0 && (paint.data[i] & PAINT_ROAD_FLAG) !== 0) mask[r + c * stride] = 1;
    }
  }
  return mask;
}

/** Marks vertices inside the levelled radius of every existing graph edge (inside `area`). */
function roadVertexMaskFromGraph(
  grid: TerrainGrid,
  graph: RoadGraph,
  area: CellWindow,
  into: Uint8Array,
): void {
  const stride = grid.rows + 1;
  for (const e of graph.edges) {
    const R = roadLevelRadiusM(e.widthM / 2, grid.cellSizeM);
    for (let k = 0; k + 1 < e.points.length; k++) {
      const p = e.points[k];
      const q = e.points[k + 1];
      const cols = vertexRange(
        grid,
        Math.min(p[0], q[0]) - R,
        Math.max(p[0], q[0]) + R,
        grid.originX,
        grid.cols,
      );
      const rows = vertexRange(
        grid,
        Math.min(p[2], q[2]) - R,
        Math.max(p[2], q[2]) + R,
        grid.originZ,
        grid.rows,
      );
      const dx = q[0] - p[0];
      const dz = q[2] - p[2];
      const len2 = dx * dx + dz * dz;
      for (let c = Math.max(cols.a, area.minCol); c <= Math.min(cols.b, area.maxCol); c++) {
        const x = grid.originX + c * grid.cellSizeM;
        for (let r = Math.max(rows.a, area.minRow); r <= Math.min(rows.b, area.maxRow); r++) {
          const z = grid.originZ + r * grid.cellSizeM;
          const t =
            len2 > 0 ? Math.min(1, Math.max(0, ((x - p[0]) * dx + (z - p[2]) * dz) / len2)) : 0;
          if (Math.hypot(x - (p[0] + dx * t), z - (p[2] + dz * t)) <= R) into[r + c * stride] = 1;
        }
      }
    }
  }
}

/**
 * Every vertex an existing road owns inside `area`: road-flagged paint plus the
 * full levelled radius around every graph edge. The slope limiter must treat
 * these as fixed, or earlier roads drift away from their graph y (D-16).
 */
export function roadVertexMask(
  grid: TerrainGrid,
  paint: PaintMap,
  graph: RoadGraph,
  area: CellWindow,
): Uint8Array {
  const mask = roadVertexMaskFromPaint(grid, paint, area);
  roadVertexMaskFromGraph(grid, graph, area, mask);
  return mask;
}

export interface LevelBandOptions {
  recorder?: { beforeHeightsWrite(window: CellWindow): void };
  /** Vertices (heights indexing) the shoulder blend must never write. */
  protect?: Uint8Array;
}

export interface LevelBandResult {
  /** 1 = levelled road vertex (heights indexing, grid sized). */
  mask: Uint8Array;
  /** Vertex window that may have been written (undefined when nothing was in reach). */
  window: CellWindow | undefined;
  /** Largest absolute height change applied. */
  maxDeltaM: number;
}

/**
 * Sets every vertex within `roadLevelRadiusM` of the centreline to the
 * centreline height plus signed lateral offset * tan(bank), and blends the
 * `shoulderM` beyond that radius to the existing terrain with smoothstep.
 * Protected vertices are never written by the blend. Independent of presets so
 * the converter (plan 11) can reuse it.
 */
export function levelRoadBand(
  grid: TerrainGrid,
  pts: readonly XZ[],
  heights: ArrayLike<number>,
  banks: ArrayLike<number>,
  halfWidthM: number,
  shoulderM?: number,
  opts: LevelBandOptions = {},
): LevelBandResult {
  const mask = new Uint8Array(grid.heights.length);
  const cell = grid.cellSizeM;
  const shoulder = Math.max(0.001, shoulderM ?? Math.max(2 * cell, 4));
  const R = roadLevelRadiusM(halfWidthM, cell);
  const reach = R + shoulder;
  if (pts.length < 2) return { mask, window: undefined, maxDeltaM: 0 };
  const win = reachWindow(grid, pts, reach);
  if (!win) return { mask, window: undefined, maxDeltaM: 0 };
  opts.recorder?.beforeHeightsWrite(win);

  const stride = grid.rows + 1;
  const rowsN = win.maxRow - win.minRow + 1;
  const colsN = win.maxCol - win.minCol + 1;
  const bestD = new Float64Array(rowsN * colsN).fill(Number.POSITIVE_INFINITY);
  const bestH = new Float64Array(rowsN * colsN);
  const bestLat = new Float64Array(rowsN * colsN);
  const bestBank = new Float64Array(rowsN * colsN);

  for (let k = 0; k + 1 < pts.length; k++) {
    const p = pts[k];
    const q = pts[k + 1];
    const dx = q.x - p.x;
    const dz = q.z - p.z;
    const len2 = dx * dx + dz * dz;
    if (len2 <= 0) continue;
    const len = Math.sqrt(len2);
    const cols = vertexRange(
      grid,
      Math.min(p.x, q.x) - reach,
      Math.max(p.x, q.x) + reach,
      grid.originX,
      grid.cols,
    );
    const rows = vertexRange(
      grid,
      Math.min(p.z, q.z) - reach,
      Math.max(p.z, q.z) + reach,
      grid.originZ,
      grid.rows,
    );
    for (let c = Math.max(cols.a, win.minCol); c <= Math.min(cols.b, win.maxCol); c++) {
      const x = grid.originX + c * cell;
      for (let r = Math.max(rows.a, win.minRow); r <= Math.min(rows.b, win.maxRow); r++) {
        const z = grid.originZ + r * cell;
        const t = Math.min(1, Math.max(0, ((x - p.x) * dx + (z - p.z) * dz) / len2));
        const cx = p.x + dx * t;
        const cz = p.z + dz * t;
        const d = Math.hypot(x - cx, z - cz);
        const li = r - win.minRow + (c - win.minCol) * rowsN;
        if (d < bestD[li] - 1e-9) {
          bestD[li] = d;
          bestH[li] = heights[k] + (heights[k + 1] - heights[k]) * t;
          bestBank[li] = banks[k] + (banks[k + 1] - banks[k]) * t;
          bestLat[li] = ((x - cx) * -dz + (z - cz) * dx) / len;
        }
      }
    }
  }

  let maxDelta = 0;
  for (let c = win.minCol; c <= win.maxCol; c++) {
    for (let r = win.minRow; r <= win.maxRow; r++) {
      const li = r - win.minRow + (c - win.minCol) * rowsN;
      const d = bestD[li];
      if (!(d <= reach)) continue;
      const gi = r + c * stride;
      const old = grid.heights[gi];
      const tanBank = Math.tan(bestBank[li]);
      let next: number;
      if (d <= R) {
        next = bestH[li] + bestLat[li] * tanBank;
        mask[gi] = 1;
      } else {
        if (opts.protect?.[gi]) continue;
        const lat = Math.max(-R, Math.min(R, bestLat[li]));
        const edgeH = bestH[li] + lat * tanBank;
        const t = smoothstep01((d - R) / shoulder);
        next = edgeH * (1 - t) + old * t;
      }
      grid.heights[gi] = next;
      maxDelta = Math.max(maxDelta, Math.abs(grid.heights[gi] - old));
    }
  }
  return { mask, window: win, maxDeltaM: maxDelta };
}

// ---------------------------------------------------------------- paint

function paintRoadBand(
  paint: PaintMap,
  pts: readonly XZ[],
  halfWidthM: number,
  value: number,
  rec: { beforePaintWrite(rect: PaintRect): void },
): void {
  const m = paint.metresPerPixel;
  for (let k = 0; k + 1 < pts.length; k++) {
    const p = pts[k];
    const q = pts[k + 1];
    const rect: PaintRect = {
      minPx: Math.max(0, Math.floor((Math.min(p.x, q.x) - halfWidthM - paint.originX) / m)),
      maxPx: Math.min(
        paint.width - 1,
        Math.ceil((Math.max(p.x, q.x) + halfWidthM - paint.originX) / m),
      ),
      minPz: Math.max(0, Math.floor((Math.min(p.z, q.z) - halfWidthM - paint.originZ) / m)),
      maxPz: Math.min(
        paint.height - 1,
        Math.ceil((Math.max(p.z, q.z) + halfWidthM - paint.originZ) / m),
      ),
    };
    if (rect.minPx > rect.maxPx || rect.minPz > rect.maxPz) continue;
    rec.beforePaintWrite(rect);
    const dx = q.x - p.x;
    const dz = q.z - p.z;
    const len2 = dx * dx + dz * dz;
    for (let pz = rect.minPz; pz <= rect.maxPz; pz++) {
      const z = paint.originZ + (pz + 0.5) * m;
      for (let px = rect.minPx; px <= rect.maxPx; px++) {
        const x = paint.originX + (px + 0.5) * m;
        const t = len2 > 0 ? Math.min(1, Math.max(0, ((x - p.x) * dx + (z - p.z) * dz) / len2)) : 0;
        if (Math.hypot(x - (p.x + dx * t), z - (p.z + dz * t)) <= halfWidthM) {
          paint.data[pz * paint.width + px] = value;
        }
      }
    }
  }
}

// ---------------------------------------------------------------- stroke

/** The mutable slice of a TerrainArea the road tools edit in place (graph + counter are replaced). */
export interface RoadEditTarget {
  grid: TerrainGrid;
  paint: PaintMap;
  groundSurface: SurfaceType;
  graph: RoadGraph;
  nextEdgeId: number;
}

export interface ApplyRoadOptions {
  widthM?: number;
  maxBankDeg?: number;
  /** D-15: existing roads lying under the stroke are replaced (default true). */
  replace?: boolean;
}

export interface ApplyRoadResult {
  diff: StrokeDiff | undefined;
  newEdgeIds: number[];
  warnings: string[];
}

interface Entry extends XZ {
  pin?: number;
}

const JOIN_MERGE_M = 0.25;

function nearestSegment(
  entries: readonly Entry[],
  x: number,
  z: number,
): { seg: number; d: number } {
  let best = { seg: 0, d: Number.POSITIVE_INFINITY };
  for (let i = 0; i + 1 < entries.length; i++) {
    const a = entries[i];
    const b = entries[i + 1];
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const len2 = dx * dx + dz * dz;
    const t = len2 > 0 ? Math.min(1, Math.max(0, ((x - a.x) * dx + (z - a.z) * dz) / len2)) : 0;
    const d = Math.hypot(x - (a.x + dx * t), z - (a.z + dz * t));
    if (d < best.d) best = { seg: i, d };
  }
  return best;
}

function densify(entries: readonly Entry[], spacing: number): Entry[] {
  const out: Entry[] = [entries[0]];
  for (let i = 0; i + 1 < entries.length; i++) {
    const a = entries[i];
    const b = entries[i + 1];
    const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / spacing));
    for (let k = 1; k < n; k++) {
      out.push({ x: a.x + ((b.x - a.x) * k) / n, z: a.z + ((b.z - a.z) * k) / n });
    }
    out.push(b);
  }
  return out;
}

function slopeWarning(): string {
  return `Slope limit reached (${MAX_SLOPE_DEG} degrees). Lower the radius or flatten the area first.`;
}

/**
 * Paints, levels, banks and records one road stroke as a single undoable diff.
 * Mutates `area.grid`, `area.paint`, `area.graph` and `area.nextEdgeId`.
 */
export function applyRoadStroke(
  area: RoadEditTarget,
  rawPoints: readonly { x: number; z: number }[],
  presetId: RoadPresetId,
  opts: ApplyRoadOptions = {},
): ApplyRoadResult {
  const preset = ROAD_PRESETS[presetId];
  if (preset === undefined) throw new RangeError(`unknown road preset ${String(presetId)}`);
  const { grid, paint } = area;
  const cell = grid.cellSizeM;
  const warnings: string[] = [];
  const widthRaw = Number.isFinite(opts.widthM) ? (opts.widthM as number) : preset.widthM;
  const widthM = Math.min(MAX_ROAD_WIDTH_M, Math.max(MIN_ROAD_WIDTH_M, widthRaw));
  const half = widthM / 2;
  const replace = opts.replace ?? true;
  const bankCap = Number.isFinite(opts.maxBankDeg)
    ? (opts.maxBankDeg as number)
    : preset.maxBankDeg;

  const prepared = prepareStrokePolyline(rawPoints, cell);
  if (prepared.length < 2) {
    return { diff: undefined, newEdgeIds: [], warnings: ["Stroke too short to make a road."] };
  }

  const graphBefore = JSON.stringify(area.graph);
  const nextIdBefore = area.nextEdgeId;
  const state0: GraphEditState = { graph: area.graph, nextEdgeId: area.nextEdgeId };

  // 1. Joins with the existing graph: move endpoints, insert crossing vertices, pin heights.
  const entries: Entry[] = prepared.map((p) => ({ x: p.x, z: p.z }));
  const joins = findStrokeCrossings(
    state0,
    prepared.map((p) => [p.x, 0, p.z] as const),
    half,
    { replace },
  );
  for (const j of joins) {
    const pin =
      j.kind === "snap-node"
        ? (area.graph.nodes.find((n) => n.id === j.nodeId)?.y ??
          sampleTerrainHeight(grid, j.x, j.z))
        : sampleTerrainHeight(grid, j.x, j.z);
    const endpoint = "endpoint" in j ? j.endpoint : "through";
    if (endpoint === "start" || endpoint === "end") {
      const e = entries[endpoint === "start" ? 0 : entries.length - 1];
      e.x = j.x;
      e.z = j.z;
      e.pin = pin;
      continue;
    }
    const { seg } = nearestSegment(entries, j.x, j.z);
    const a = entries[seg];
    const b = entries[seg + 1];
    const da = Math.hypot(a.x - j.x, a.z - j.z);
    const db = Math.hypot(b.x - j.x, b.z - j.z);
    if (da <= JOIN_MERGE_M && seg > 0) {
      a.x = j.x;
      a.z = j.z;
      a.pin = pin;
    } else if (db <= JOIN_MERGE_M && seg + 1 < entries.length - 1) {
      b.x = j.x;
      b.z = j.z;
      b.pin = pin;
    } else {
      entries.splice(seg + 1, 0, { x: j.x, z: j.z, pin });
    }
  }
  const dense = densify(entries, Math.min(4, Math.max(1, cell / 2)));
  const xz: XZ[] = dense.map((e) => ({ x: e.x, z: e.z }));
  const pins = dense.flatMap((e, index) =>
    e.pin === undefined ? [] : [{ index, heightM: e.pin }],
  );

  // 2. Protect every earlier road: paint plus the levelled radius around graph edges.
  const shoulder = Math.max(2 * cell, 4);
  const reach = roadLevelRadiusM(half, cell) + shoulder;
  const reachWin = reachWindow(grid, xz, reach);
  if (!reachWin) {
    return { diff: undefined, newEdgeIds: [], warnings: ["Stroke is outside the terrain area."] };
  }
  const protect = roadVertexMaskFromPaint(grid, paint, reachWin);
  roadVertexMaskFromGraph(grid, area.graph, reachWin, protect);

  // 3. Profile and banking.
  const curveM = Math.min(80, Math.max(15, 2.4 * (preset.designSpeedKph / 3.6)));
  const heights = roadHeightProfile(grid, xz, { maxGrade: STROKE_GRADE, pins, smoothM: curveM });
  const banks = roadBankAngles(xz, preset, bankCap);
  if (pins.length > 0) {
    const s = cumulativeLength(xz);
    for (let i = 0; i < banks.length; i++) {
      let nearest = Number.POSITIVE_INFINITY;
      for (const p of pins) nearest = Math.min(nearest, Math.abs(s[i] - s[p.index]));
      banks[i] *= Math.min(1, nearest / BANK_SMOOTH_M);
    }
  }

  // 4. Level, paint, limit slope with all road vertices fixed.
  const rec = createStrokeRecorder(grid, paint);
  const band = levelRoadBand(grid, xz, heights, banks, half, shoulder, { recorder: rec, protect });
  paintRoadBand(paint, xz, half, encodePaintValue(preset.surface, true), rec);
  if (band.window) {
    const win = expandWindow(band.window, grid, band.maxDeltaM, MAX_SLOPE_DEG);
    rec.beforeHeightsWrite(win);
    // WR-01: fix every earlier road's vertices (paint AND the full levelled
    // radius from the graph, over the whole limiter window), not just paint.
    // `area.graph` is still the pre-stroke graph here.
    const mask = band.mask;
    const existing = roadVertexMask(grid, paint, area.graph, win);
    for (let i = 0; i < mask.length; i++) if (existing[i]) mask[i] = 1;
    const res = limitSlope(grid, win, { mask });
    if (res.roadViolations > 0) warnings.push(slopeWarning());
  }

  // 5. Graph edges from the levelled centreline (y read back from terrain, D-16).
  const centreline = xz.map((p) => [p.x, sampleTerrainHeight(grid, p.x, p.z), p.z] as const);
  const added = addRoadStroke(
    state0,
    centreline,
    {
      roadClass: preset.roadClass,
      lanes: preset.lanes,
      widthM,
      surface: preset.surface,
      speedLimitKph: preset.speedLimitKph,
      oneway: false,
    },
    { replace },
  );
  if (added.reason !== undefined) {
    const undo = rec.commit();
    if (undo) applyStrokeDiff(area, undo, "before");
    return { diff: undefined, newEdgeIds: [], warnings: [added.reason] };
  }
  const withSpawn = ensureDefaultSpawn(added.state);
  const synced = syncNodeHeights(grid, withSpawn.graph, reachWin);
  area.graph = synced;
  area.nextEdgeId = withSpawn.nextEdgeId;
  rec.recordGraph(graphBefore, JSON.stringify(synced), nextIdBefore, withSpawn.nextEdgeId);
  return { diff: rec.commit(), newEdgeIds: added.newEdgeIds, warnings };
}

/** Snaps node y (and the matching edge endpoint y) to the terrain for nodes near the stroke (D-16). */
function syncNodeHeights(grid: TerrainGrid, graph: RoadGraph, win: CellWindow): RoadGraph {
  const x0 = grid.originX + win.minCol * grid.cellSizeM;
  const x1 = grid.originX + win.maxCol * grid.cellSizeM;
  const z0 = grid.originZ + win.minRow * grid.cellSizeM;
  const z1 = grid.originZ + win.maxRow * grid.cellSizeM;
  const fixed = new Map<number, number>();
  for (const n of graph.nodes) {
    if (n.x < x0 || n.x > x1 || n.z < z0 || n.z > z1) continue;
    const y = sampleTerrainHeight(grid, n.x, n.z);
    if (Math.abs(y - n.y) > 1e-9) fixed.set(n.id, y);
  }
  if (fixed.size === 0) return graph;
  const nodes = graph.nodes.map((n) =>
    fixed.has(n.id) ? { ...n, y: fixed.get(n.id) as number } : n,
  );
  const edges = graph.edges.map((e) => {
    const yFrom = fixed.get(e.from);
    const yTo = fixed.get(e.to);
    if (yFrom === undefined && yTo === undefined) return e;
    const points = e.points.map((p) => [p[0], p[1], p[2]] as [number, number, number]);
    if (yFrom !== undefined) points[0][1] = yFrom;
    if (yTo !== undefined) points[points.length - 1][1] = yTo;
    return { ...e, points };
  });
  return { ...graph, nodes, edges };
}

// ---------------------------------------------------------------- erase

/**
 * Clears road-flagged paint inside the disc back to the area's ground surface
 * and removes the graph edges inside it. Heights are never touched (D-15).
 */
export function eraseRoad(
  area: RoadEditTarget,
  x: number,
  z: number,
  radiusM: number,
): { diff: StrokeDiff | undefined; removedEdgeIds: number[]; warnings: string[] } {
  if (![x, z, radiusM].every(Number.isFinite)) {
    return { diff: undefined, removedEdgeIds: [], warnings: [] };
  }
  const r = Math.min(MAX_RADIUS_M, Math.max(MIN_RADIUS_M, radiusM));
  const { grid, paint } = area;
  const rec = createStrokeRecorder(grid, paint);
  const m = paint.metresPerPixel;
  const rect: PaintRect = {
    minPx: Math.max(0, Math.floor((x - r - paint.originX) / m)),
    maxPx: Math.min(paint.width - 1, Math.ceil((x + r - paint.originX) / m)),
    minPz: Math.max(0, Math.floor((z - r - paint.originZ) / m)),
    maxPz: Math.min(paint.height - 1, Math.ceil((z + r - paint.originZ) / m)),
  };
  if (rect.minPx <= rect.maxPx && rect.minPz <= rect.maxPz) {
    rec.beforePaintWrite(rect);
    const ground = encodePaintValue(area.groundSurface, false);
    for (let pz = rect.minPz; pz <= rect.maxPz; pz++) {
      const cz = paint.originZ + (pz + 0.5) * m;
      for (let px = rect.minPx; px <= rect.maxPx; px++) {
        const cx = paint.originX + (px + 0.5) * m;
        const i = pz * paint.width + px;
        if ((paint.data[i] & PAINT_ROAD_FLAG) === 0) continue;
        if ((cx - x) ** 2 + (cz - z) ** 2 <= r * r) paint.data[i] = ground;
      }
    }
  }
  const warnings: string[] = [];
  const before = { graph: area.graph, nextEdgeId: area.nextEdgeId };
  const erased = eraseGraphDisc(before, x, z, r);
  let removedEdgeIds: number[] = [];
  if (erased.state !== before) {
    const next = ensureDefaultSpawn(erased.state);
    area.graph = next.graph;
    area.nextEdgeId = next.nextEdgeId;
    removedEdgeIds = erased.removedEdgeIds;
    rec.recordGraph(
      JSON.stringify(before.graph),
      JSON.stringify(next.graph),
      before.nextEdgeId,
      next.nextEdgeId,
    );
  }
  return { diff: rec.commit(), removedEdgeIds, warnings };
}
