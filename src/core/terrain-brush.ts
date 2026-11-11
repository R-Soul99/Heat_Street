/**
 * Sculpt brushes for the terrain editor (phase 04.2, D-10 minus the road
 * brush): raise/lower, smooth, flatten, wedge/mound stamps, surface paint and
 * paint erase, plus the stroke recorder that produces changed-cell diffs for
 * undo (D-11).
 *
 * Every height op: computes the new heights for its footprint, records the
 * first-touch values of the (slope-expanded) window, writes, gently relaxes the
 * changed vertices, then runs `limitSlope` on the expanded window so no pair
 * exceeds MAX_SLOPE_DEG (D-03). Ops mutate in place and report the dirty window
 * plus `slopeClamped` (drives the editor's slope-clamp ring).
 *
 * Params are sanitised (T-04.2-18): radius clamped to 0.5..200 m, strength to
 * 0..1, non-finite input is a no-op.
 *
 * Layering: pure core, no three/rapier/DOM.
 */
import { SURFACE_TYPES, type SurfaceType } from "./surface-types.ts";
import { sampleTerrainHeight, type TerrainGrid } from "./terrain-grid.ts";
import { MAX_SLOPE_DEG } from "./terrain-limits.ts";
import { encodePaintValue, PAINT_ROAD_FLAG, type PaintMap } from "./terrain-paint.ts";
import { type CellWindow, expandWindow, limitSlope } from "./terrain-slope.ts";

export type Falloff = "linear" | "smooth";

export interface BrushParams {
  x: number;
  z: number;
  radiusM: number;
  strength: number;
  falloff: Falloff;
}

export interface PaintRect {
  minPx: number;
  minPz: number;
  maxPx: number;
  maxPz: number;
}

export interface StrokeDiff {
  readonly heights?: { indices: Uint32Array; before: Float32Array; after: Float32Array };
  readonly paint?: { indices: Uint32Array; before: Uint8Array; after: Uint8Array };
  /** Serialized road-graph JSON snapshots (plan 09 road strokes). */
  readonly graph?: {
    before: string;
    after: string;
    nextEdgeIdBefore: number;
    nextEdgeIdAfter: number;
  };
  /** Quick 261110-rdx: unlocked-edge-id list snapshots (DD-5), sorted ascending. */
  readonly lock?: { before: readonly number[]; after: readonly number[] };
}

export interface StrokeRecorder {
  beforeHeightsWrite(window: CellWindow): void;
  beforePaintWrite(rect: PaintRect): void;
  recordGraph(
    before: string,
    after: string,
    nextEdgeIdBefore: number,
    nextEdgeIdAfter: number,
  ): void;
  /** First `before` wins, latest `after` wins (same rule as recordGraph). */
  recordLock(before: readonly number[], after: readonly number[]): void;
  commit(): StrokeDiff | undefined;
}

export interface BrushResult {
  /** Dirty vertex window (undefined when the op changed nothing). */
  window?: CellWindow;
  /** True when the slope limiter had to move vertices. */
  slopeClamped: boolean;
  /** Signed change of largest magnitude actually written (after the slope limiter). */
  maxDeltaM: number;
  /** Vertices in the touched window skipped because a road holds them. */
  heldCount: number;
}

export interface PaintResult {
  rect?: PaintRect;
  pixelsChanged: number;
}

/** Options shared by every height op. */
export interface HeightOpOptions {
  /**
   * Builds the road mask (grid.heights indexing, non-zero = road vertex) for
   * the slope-limiter window. Masked vertices are never moved by the limiter
   * (WR-02 / plan 07 truth 4), so roads keep their graph y (D-16). Also queried
   * for the op's own window: masked vertices are held by every height op (WR-03).
   */
  roadMask?: (win: CellWindow) => Uint8Array;
}

export const MIN_RADIUS_M = 0.5;
export const MAX_RADIUS_M = 200;
const RELAX = 0.25;
/** A pair only counts as pre-existing over-cap beyond this (Float32 / 0.01 m save quantisation noise). */
const PREEXISTING_TOL_M = 0.02;

const noOp = (heldCount = 0): BrushResult => ({ slopeClamped: false, maxDeltaM: 0, heldCount });

function falloffAt(kind: Falloff, d: number, r: number): number {
  const t = d / r;
  if (t >= 1) return 0;
  return kind === "linear" ? 1 - t : 1 - t * t * (3 - 2 * t);
}

function sanitize(p: BrushParams): BrushParams | null {
  if (
    !Number.isFinite(p.x) ||
    !Number.isFinite(p.z) ||
    !Number.isFinite(p.radiusM) ||
    !Number.isFinite(p.strength)
  ) {
    return null;
  }
  return {
    x: p.x,
    z: p.z,
    radiusM: Math.min(MAX_RADIUS_M, Math.max(MIN_RADIUS_M, p.radiusM)),
    strength: Math.min(1, Math.max(0, p.strength)),
    falloff: p.falloff === "linear" ? "linear" : "smooth",
  };
}

function circleWindow(grid: TerrainGrid, x: number, z: number, r: number): CellWindow | null {
  const c0 = Math.ceil((x - r - grid.originX) / grid.cellSizeM);
  const c1 = Math.floor((x + r - grid.originX) / grid.cellSizeM);
  const r0 = Math.ceil((z - r - grid.originZ) / grid.cellSizeM);
  const r1 = Math.floor((z + r - grid.originZ) / grid.cellSizeM);
  const w = {
    minRow: Math.max(0, r0),
    minCol: Math.max(0, c0),
    maxRow: Math.min(grid.rows, r1),
    maxCol: Math.min(grid.cols, c1),
  };
  return w.minRow > w.maxRow || w.minCol > w.maxCol ? null : w;
}

/**
 * WR-03: the limiter must only undo steepness the op itself created. Every
 * vertex in `win` that the op does not change and that already sits in an
 * over-cap pair (converted DEM terrain, old road shoulders) is frozen as a
 * fixed source, so a 1 cm dab never reshapes pre-existing cliffs across the
 * expanded window. Must run while `grid.heights` is still the pre-op state.
 * Returns `into` (or a new grid-sized mask when something was frozen).
 */
function freezePreexistingSteep(
  grid: TerrainGrid,
  win: CellWindow,
  opChanged: (r: number, c: number) => boolean,
  into: Uint8Array | undefined,
): Uint8Array | undefined {
  const stride = grid.rows + 1;
  const h = grid.heights;
  const axis = Math.tan((MAX_SLOPE_DEG * Math.PI) / 180) * grid.cellSizeM;
  const d = axis + PREEXISTING_TOL_M;
  const dd = axis * Math.SQRT2 + PREEXISTING_TOL_M;
  let mask = into;
  for (let c = win.minCol; c <= win.maxCol; c++) {
    for (let r = win.minRow; r <= win.maxRow; r++) {
      const i = r + c * stride;
      if (mask?.[i] || opChanged(r, c)) continue;
      let steep = false;
      for (let dc = -1; dc <= 1 && !steep; dc++) {
        const nc = c + dc;
        if (nc < 0 || nc > grid.cols) continue;
        for (let dr = -1; dr <= 1; dr++) {
          const nr = r + dr;
          if ((dr === 0 && dc === 0) || nr < 0 || nr > grid.rows) continue;
          if (Math.abs(h[i] - h[nr + nc * stride]) > (dr !== 0 && dc !== 0 ? dd : d)) {
            steep = true;
            break;
          }
        }
      }
      if (steep) {
        mask ??= new Uint8Array(h.length);
        mask[i] = 1;
      }
    }
  }
  return mask;
}

/** The shared height-op pipeline. `compute` returns the new height for a vertex (or `h` to leave it). */
function runHeightOp(
  grid: TerrainGrid,
  touched: CellWindow,
  compute: (x: number, z: number, h: number, snap: (r: number, c: number) => number) => number,
  rec: StrokeRecorder | undefined,
  relax: boolean,
  opts: HeightOpOptions = {},
): BrushResult {
  const stride = grid.rows + 1;
  const rowsN = touched.maxRow - touched.minRow + 1;
  const colsN = touched.maxCol - touched.minCol + 1;
  const old = new Float32Array(rowsN * colsN);
  const next = new Float64Array(rowsN * colsN);
  let k = 0;
  for (let c = touched.minCol; c <= touched.maxCol; c++) {
    for (let r = touched.minRow; r <= touched.maxRow; r++) {
      old[k++] = grid.heights[r + c * stride];
    }
  }
  // Snapshot lookup clamped into the touched window (for smoothing kernels).
  const snap = (r: number, c: number): number => {
    const rr = Math.min(touched.maxRow, Math.max(touched.minRow, r)) - touched.minRow;
    const cc = Math.min(touched.maxCol, Math.max(touched.minCol, c)) - touched.minCol;
    return old[rr + cc * rowsN];
  };
  // WR-03 (D-16): every op holds road-masked vertices, not just the limiter, so
  // sculpting over a road never moves road terrain away from its graph y.
  const hold = opts.roadMask?.(touched);
  let maxDelta = 0;
  let heldCount = 0;
  k = 0;
  for (let c = touched.minCol; c <= touched.maxCol; c++) {
    for (let r = touched.minRow; r <= touched.maxRow; r++, k++) {
      const x = grid.originX + c * grid.cellSizeM;
      const z = grid.originZ + r * grid.cellSizeM;
      const isHeld = !!hold?.[r + c * stride];
      if (isHeld) heldCount++;
      const v = isHeld ? old[k] : compute(x, z, old[k], (rr, cc) => snap(rr, cc));
      next[k] = Number.isFinite(v) ? v : old[k];
      maxDelta = Math.max(maxDelta, Math.abs(Math.fround(next[k]) - old[k]));
    }
  }
  if (maxDelta === 0) return noOp(heldCount);

  const dirty = expandWindow(
    {
      minRow: touched.minRow - 1,
      minCol: touched.minCol - 1,
      maxRow: touched.maxRow + 1,
      maxCol: touched.maxCol + 1,
    },
    grid,
    maxDelta,
    MAX_SLOPE_DEG,
  );
  rec?.beforeHeightsWrite(dirty);

  // WR-03: computed before the write, while `grid.heights` is still pre-op.
  const opChanged = (r: number, c: number): boolean => {
    if (r < touched.minRow || r > touched.maxRow || c < touched.minCol || c > touched.maxCol) {
      return false;
    }
    const kk = r - touched.minRow + (c - touched.minCol) * rowsN;
    return Math.fround(next[kk]) !== old[kk];
  };
  const limiterMask = freezePreexistingSteep(grid, dirty, opChanged, opts.roadMask?.(dirty));

  k = 0;
  for (let c = touched.minCol; c <= touched.maxCol; c++) {
    for (let r = touched.minRow; r <= touched.maxRow; r++, k++) {
      grid.heights[r + c * stride] = next[k];
    }
  }

  if (relax) {
    // 1-2-1 kernel on vertices this op moved (keeps the radius contract).
    const moved = new Uint8Array(rowsN * colsN);
    for (let i = 0; i < moved.length; i++) moved[i] = Math.fround(next[i]) !== old[i] ? 1 : 0;
    const cur = new Float32Array(rowsN * colsN);
    k = 0;
    for (let c = touched.minCol; c <= touched.maxCol; c++) {
      for (let r = touched.minRow; r <= touched.maxRow; r++)
        cur[k++] = grid.heights[r + c * stride];
    }
    const at = (r: number, c: number): number => {
      const rr = Math.min(rowsN - 1, Math.max(0, r));
      const cc = Math.min(colsN - 1, Math.max(0, c));
      return cur[rr + cc * rowsN];
    };
    for (let cc = 0; cc < colsN; cc++) {
      for (let rr = 0; rr < rowsN; rr++) {
        if (!moved[rr + cc * rowsN]) continue;
        let sum = 0;
        for (let dc = -1; dc <= 1; dc++) {
          for (let dr = -1; dr <= 1; dr++) {
            const wgt = (dc === 0 ? 2 : 1) * (dr === 0 ? 2 : 1);
            sum += wgt * at(rr + dr, cc + dc);
          }
        }
        const here = cur[rr + cc * rowsN];
        const v = here + RELAX * (sum / 16 - here);
        grid.heights[touched.minRow + rr + (touched.minCol + cc) * stride] = v;
      }
    }
  }

  const res = limitSlope(grid, dirty, { maxSlopeDeg: MAX_SLOPE_DEG, mask: limiterMask });
  let signed = 0;
  k = 0;
  for (let c = touched.minCol; c <= touched.maxCol; c++) {
    for (let r = touched.minRow; r <= touched.maxRow; r++, k++) {
      const d = grid.heights[r + c * stride] - old[k];
      if (Math.abs(d) > Math.abs(signed)) signed = d;
    }
  }
  return { window: dirty, slopeClamped: res.changed.length > 0, maxDeltaM: signed, heldCount };
}

export function raiseLower(
  grid: TerrainGrid,
  params: BrushParams,
  sign: 1 | -1,
  rateM = 1,
  rec?: StrokeRecorder,
  opts?: HeightOpOptions,
): BrushResult {
  const p = sanitize(params);
  if (!p || !Number.isFinite(rateM)) return noOp();
  const w = circleWindow(grid, p.x, p.z, p.radiusM);
  if (!w) return noOp();
  return runHeightOp(
    grid,
    w,
    (x, z, h) => {
      const f = falloffAt(p.falloff, Math.hypot(x - p.x, z - p.z), p.radiusM);
      return f > 0 ? h + sign * rateM * p.strength * f : h;
    },
    rec,
    true,
    opts,
  );
}

export function smoothBrush(
  grid: TerrainGrid,
  params: BrushParams,
  rec?: StrokeRecorder,
  opts?: HeightOpOptions,
): BrushResult {
  const p = sanitize(params);
  if (!p) return noOp();
  const cw = circleWindow(grid, p.x, p.z, p.radiusM);
  if (!cw) return noOp();
  // Widen by one so the kernel reads real neighbours at the footprint edge.
  const w = {
    minRow: Math.max(0, cw.minRow - 1),
    minCol: Math.max(0, cw.minCol - 1),
    maxRow: Math.min(grid.rows, cw.maxRow + 1),
    maxCol: Math.min(grid.cols, cw.maxCol + 1),
  };
  const stride = grid.rows + 1;
  const c0 = w.minCol;
  const r0 = w.minRow;
  return runHeightOp(
    grid,
    w,
    (x, z, h, snap) => {
      const f = falloffAt(p.falloff, Math.hypot(x - p.x, z - p.z), p.radiusM);
      if (f <= 0) return h;
      const col = Math.round((x - grid.originX) / grid.cellSizeM);
      const row = Math.round((z - grid.originZ) / grid.cellSizeM);
      let sum = 0;
      for (let dc = -1; dc <= 1; dc++) {
        for (let dr = -1; dr <= 1; dr++) {
          const rr = Math.min(grid.rows, Math.max(0, row + dr));
          const cc = Math.min(grid.cols, Math.max(0, col + dc));
          const wgt = (dc === 0 ? 2 : 1) * (dr === 0 ? 2 : 1);
          // Neighbours outside the op window are unchanged, so read live there.
          const inside = rr >= r0 && rr <= w.maxRow && cc >= c0 && cc <= w.maxCol;
          sum += wgt * (inside ? snap(rr, cc) : grid.heights[rr + cc * stride]);
        }
      }
      return h + p.strength * f * (sum / 16 - h);
    },
    rec,
    false,
    opts,
  );
}

export const BLOCK_CELLS_MIN = 1;
export const BLOCK_CELLS_MAX = 64;
export const BLOCK_STEP_MIN_M = 0.25;
export const BLOCK_STEP_MAX_M = 5;
export const SMOOTH_PASSES_MAX = 10;

/**
 * D-18 / D-22: the vertex window of the exact N x N cell block anchored at the
 * cell containing (x, z) (anchor cell = row - floor((N-1)/2), same for columns),
 * clipped inside the grid. Null when (x, z) is off the grid or any input is
 * non-finite. Also used by the editor's block preview so it matches the op.
 */
export function blockWindowAt(
  grid: TerrainGrid,
  x: number,
  z: number,
  blockCells: number,
): CellWindow | null {
  if (!Number.isFinite(x) || !Number.isFinite(z) || !Number.isFinite(blockCells)) return null;
  const n = Math.min(BLOCK_CELLS_MAX, Math.max(BLOCK_CELLS_MIN, Math.round(blockCells)));
  const col = Math.floor((x - grid.originX) / grid.cellSizeM);
  const row = Math.floor((z - grid.originZ) / grid.cellSizeM);
  if (row < 0 || row >= grid.rows || col < 0 || col >= grid.cols) return null;
  const off = Math.floor((n - 1) / 2);
  const r0 = Math.max(0, row - off);
  const c0 = Math.max(0, col - off);
  const r1 = Math.min(grid.rows - 1, row - off + n - 1);
  const c1 = Math.min(grid.cols - 1, col - off + n - 1);
  return { minRow: r0, minCol: c0, maxRow: r1 + 1, maxCol: c1 + 1 };
}

/**
 * D-18..D-20: raise (sign 1) or lower (sign -1) an exact N x N cell block by a
 * fixed step. Goes through runHeightOp so the 35 degree slope limiter and the
 * stroke recorder apply; road-masked vertices inside the block keep their
 * height (roadMask alone only protects the limiter). Sharp edges are intended
 * so relax is off. Inputs are clamped (T-04.3-04); non-finite is a no-op.
 */
export function raiseBlock(
  grid: TerrainGrid,
  params: { x: number; z: number; blockCells: number; stepM: number },
  sign: 1 | -1,
  rec?: StrokeRecorder,
  opts?: HeightOpOptions,
): BrushResult {
  if (!Number.isFinite(params.stepM) || !Number.isFinite(params.blockCells)) return noOp();
  const stepM = Math.min(BLOCK_STEP_MAX_M, Math.max(BLOCK_STEP_MIN_M, params.stepM));
  const win = blockWindowAt(grid, params.x, params.z, params.blockCells);
  if (!win) return noOp();
  return raiseWindow(grid, win, sign * stepM, rec, opts);
}

/**
 * Raise (or lower, negative) every vertex of `win` by exactly `deltaM`. Sharp
 * edges (no relax); the slope limiter, road holds and recorder still apply.
 */
export function raiseWindow(
  grid: TerrainGrid,
  win: CellWindow,
  deltaM: number,
  rec?: StrokeRecorder,
  opts?: HeightOpOptions,
): BrushResult {
  if (!Number.isFinite(deltaM)) return noOp();
  const w = clipWindow(grid, win);
  if (!w) return noOp();
  return runHeightOp(grid, w, (_x, _z, h) => h + deltaM, rec, false, opts);
}

function clipWindow(grid: TerrainGrid, win: CellWindow): CellWindow | null {
  const w = {
    minRow: Math.max(0, Math.floor(win.minRow)),
    minCol: Math.max(0, Math.floor(win.minCol)),
    maxRow: Math.min(grid.rows, Math.ceil(win.maxRow)),
    maxCol: Math.min(grid.cols, Math.ceil(win.maxCol)),
  };
  return w.minRow <= w.maxRow && w.minCol <= w.maxCol ? w : null;
}

/** Copy of the window's heights in the column-major order runHeightOp uses. */
export function snapshotWindow(grid: TerrainGrid, win: CellWindow): Float32Array {
  const w = clipWindow(grid, win);
  if (!w) return new Float32Array(0);
  const stride = grid.rows + 1;
  const out = new Float32Array((w.maxRow - w.minRow + 1) * (w.maxCol - w.minCol + 1));
  let k = 0;
  for (let c = w.minCol; c <= w.maxCol; c++) {
    for (let r = w.minRow; r <= w.maxRow; r++) out[k++] = grid.heights[r + c * stride];
  }
  return out;
}

/**
 * Absolute push/pull: sets each window vertex to `base[k] + deltaM` (base from
 * snapshotWindow). Incremental `h + step` would ratchet under the slope limiter.
 */
export function setWindowFromBase(
  grid: TerrainGrid,
  win: CellWindow,
  base: Float32Array,
  deltaM: number,
  rec?: StrokeRecorder,
  opts?: HeightOpOptions,
): BrushResult {
  if (!Number.isFinite(deltaM)) return noOp();
  const w = clipWindow(grid, win);
  if (!w) return noOp();
  const rowsN = w.maxRow - w.minRow + 1;
  if (base.length !== rowsN * (w.maxCol - w.minCol + 1)) return noOp();
  return runHeightOp(
    grid,
    w,
    (x, z, _h) => {
      const col = Math.round((x - grid.originX) / grid.cellSizeM) - w.minCol;
      const row = Math.round((z - grid.originZ) / grid.cellSizeM) - w.minRow;
      return base[row + col * rowsN] + deltaM;
    },
    rec,
    false,
    opts,
  );
}

/**
 * D-21: multi-pass 1-2-1 smoothing over a window (or the whole grid). All
 * passes are computed in a scratch buffer (heights outside the window are fixed
 * boundary values, road-masked vertices are held every pass), then written by a
 * single runHeightOp so one recorder diff covers the whole op = one undo step.
 * Strength clamps 0..1, passes to integers 1..SMOOTH_PASSES_MAX (T-04.3-05).
 */
export function smoothRegion(
  grid: TerrainGrid,
  region: CellWindow,
  params: { strength: number; passes: number },
  rec?: StrokeRecorder,
  opts?: HeightOpOptions,
): BrushResult {
  if (!Number.isFinite(params.strength) || !Number.isFinite(params.passes)) return noOp();
  const strength = Math.min(1, Math.max(0, params.strength));
  const passes = Math.min(SMOOTH_PASSES_MAX, Math.max(1, Math.round(params.passes)));
  const win: CellWindow = {
    minRow: Math.max(0, Math.floor(region.minRow)),
    minCol: Math.max(0, Math.floor(region.minCol)),
    maxRow: Math.min(grid.rows, Math.ceil(region.maxRow)),
    maxCol: Math.min(grid.cols, Math.ceil(region.maxCol)),
  };
  if (!(win.minRow <= win.maxRow && win.minCol <= win.maxCol) || strength === 0) return noOp();
  const stride = grid.rows + 1;
  const rowsN = win.maxRow - win.minRow + 1;
  const colsN = win.maxCol - win.minCol + 1;
  const mask = opts?.roadMask?.(win);
  let cur = new Float64Array(rowsN * colsN);
  let nxt = new Float64Array(rowsN * colsN);
  for (let c = 0; c < colsN; c++) {
    for (let r = 0; r < rowsN; r++) {
      cur[r + c * rowsN] = grid.heights[win.minRow + r + (win.minCol + c) * stride];
    }
  }
  const read = (src: Float64Array, row: number, col: number): number => {
    const rr = Math.min(grid.rows, Math.max(0, row));
    const cc = Math.min(grid.cols, Math.max(0, col));
    if (rr >= win.minRow && rr <= win.maxRow && cc >= win.minCol && cc <= win.maxCol) {
      return src[rr - win.minRow + (cc - win.minCol) * rowsN];
    }
    return grid.heights[rr + cc * stride];
  };
  for (let p = 0; p < passes; p++) {
    for (let c = 0; c < colsN; c++) {
      for (let r = 0; r < rowsN; r++) {
        const row = win.minRow + r;
        const col = win.minCol + c;
        const h = cur[r + c * rowsN];
        if (mask?.[row + col * stride]) {
          nxt[r + c * rowsN] = h;
          continue;
        }
        let sum = 0;
        for (let dc = -1; dc <= 1; dc++) {
          for (let dr = -1; dr <= 1; dr++) {
            sum += (dc === 0 ? 2 : 1) * (dr === 0 ? 2 : 1) * read(cur, row + dr, col + dc);
          }
        }
        nxt[r + c * rowsN] = h + strength * (sum / 16 - h);
      }
    }
    [cur, nxt] = [nxt, cur];
  }
  const result = cur;
  return runHeightOp(
    grid,
    win,
    (x, z, h) => {
      const col = Math.round((x - grid.originX) / grid.cellSizeM);
      const row = Math.round((z - grid.originZ) / grid.cellSizeM);
      if (mask?.[row + col * stride]) return h;
      return result[row - win.minRow + (col - win.minCol) * rowsN];
    },
    rec,
    false,
    opts,
  );
}

export function flattenBrush(
  grid: TerrainGrid,
  params: BrushParams,
  targetM: number,
  rec?: StrokeRecorder,
  opts?: HeightOpOptions,
): BrushResult {
  const p = sanitize(params);
  if (!p || !Number.isFinite(targetM)) return noOp();
  const w = circleWindow(grid, p.x, p.z, p.radiusM);
  if (!w) return noOp();
  return runHeightOp(
    grid,
    w,
    (x, z, h) => {
      const f = falloffAt(p.falloff, Math.hypot(x - p.x, z - p.z), p.radiusM);
      return f > 0 ? h + (targetM - h) * p.strength * f : h;
    },
    rec,
    false,
    opts,
  );
}

export interface StampParams {
  kind: "wedge" | "mound";
  x: number;
  z: number;
  rotationRad: number;
  lengthM: number;
  widthM: number;
  heightM: number;
}

/** Wedge: ramp rising along local +X over lengthM then dropping. Mound: cosine dome of radius widthM/2. Max-blended onto existing terrain. */
export function stampTerrain(
  grid: TerrainGrid,
  s: StampParams,
  rec?: StrokeRecorder,
  opts?: HeightOpOptions,
): BrushResult {
  if (
    !Number.isFinite(s.x) ||
    !Number.isFinite(s.z) ||
    !Number.isFinite(s.rotationRad) ||
    !Number.isFinite(s.lengthM) ||
    !Number.isFinite(s.widthM) ||
    !Number.isFinite(s.heightM)
  ) {
    return noOp();
  }
  const clampSize = (v: number): number => Math.min(MAX_RADIUS_M * 2, Math.max(1, v));
  const length = clampSize(s.lengthM);
  const width = clampSize(s.widthM);
  const height = Math.min(200, Math.max(-200, s.heightM));
  const reach = s.kind === "wedge" ? Math.hypot(length / 2, width / 2) : width / 2;
  const w = circleWindow(grid, s.x, s.z, reach);
  if (!w) return noOp();
  const cos = Math.cos(s.rotationRad);
  const sin = Math.sin(s.rotationRad);
  const base = sampleTerrainHeight(grid, s.x, s.z);
  return runHeightOp(
    grid,
    w,
    (x, z, h) => {
      const dx = x - s.x;
      const dz = z - s.z;
      const lx = dx * cos + dz * sin;
      const lz = -dx * sin + dz * cos;
      let offset = 0;
      if (s.kind === "wedge") {
        if (Math.abs(lx) <= length / 2 && Math.abs(lz) <= width / 2) {
          offset = (height * (lx + length / 2)) / length;
        }
      } else {
        const R = width / 2;
        const d = Math.hypot(lx, lz);
        if (d < R) offset = height * 0.5 * (1 + Math.cos((Math.PI * d) / R));
      }
      if (offset === 0) return h;
      const target = base + offset;
      return height >= 0 ? Math.max(h, target) : Math.min(h, target);
    },
    rec,
    true,
    opts,
  );
}

function paintDiscRect(paint: PaintMap, p: BrushParams): PaintRect | null {
  const m = paint.metresPerPixel;
  const rect = {
    minPx: Math.max(0, Math.floor((p.x - p.radiusM - paint.originX) / m)),
    maxPx: Math.min(paint.width - 1, Math.ceil((p.x + p.radiusM - paint.originX) / m)),
    minPz: Math.max(0, Math.floor((p.z - p.radiusM - paint.originZ) / m)),
    maxPz: Math.min(paint.height - 1, Math.ceil((p.z + p.radiusM - paint.originZ) / m)),
  };
  return rect.minPx > rect.maxPx || rect.minPz > rect.maxPz ? null : rect;
}

function paintDisc(
  paint: PaintMap,
  params: BrushParams,
  rec: StrokeRecorder | undefined,
  write: (old: number) => number,
): PaintResult {
  const p = sanitize(params);
  if (!p) return { pixelsChanged: 0 };
  const rect = paintDiscRect(paint, p);
  if (!rect) return { pixelsChanged: 0 };
  rec?.beforePaintWrite(rect);
  const m = paint.metresPerPixel;
  const r2 = p.radiusM * p.radiusM;
  let changed = 0;
  for (let pz = rect.minPz; pz <= rect.maxPz; pz++) {
    const cz = paint.originZ + (pz + 0.5) * m;
    for (let px: number = rect.minPx; px <= rect.maxPx; px++) {
      const cx = paint.originX + (px + 0.5) * m;
      const dx = cx - p.x;
      const dz = cz - p.z;
      if (dx * dx + dz * dz > r2) continue;
      const i = pz * paint.width + px;
      const v = write(paint.data[i]);
      if (v !== paint.data[i]) {
        paint.data[i] = v;
        changed++;
      }
    }
  }
  return { rect, pixelsChanged: changed };
}

/** Paints `surface` on every pixel centre within the radius; road-flagged pixels are kept unless `overRoads`. */
export function paintSurface(
  paint: PaintMap,
  params: BrushParams,
  surface: SurfaceType,
  opts: { road?: boolean; overRoads?: boolean } = {},
  rec?: StrokeRecorder,
): PaintResult {
  if (!SURFACE_TYPES.includes(surface)) return { pixelsChanged: 0 };
  const value = encodePaintValue(surface, opts.road === true);
  return paintDisc(paint, params, rec, (old) =>
    (old & PAINT_ROAD_FLAG) !== 0 && opts.overRoads !== true ? old : value,
  );
}

/** Clears the road flag and resets to the area's ground surface inside the radius. */
export function erasePaintDisc(
  paint: PaintMap,
  params: BrushParams,
  groundSurface: SurfaceType,
  rec?: StrokeRecorder,
): PaintResult {
  const value = encodePaintValue(groundSurface, false);
  return paintDisc(paint, params, rec, () => value);
}

function asc(a: number, b: number): number {
  return a - b;
}

export function createStrokeRecorder(grid: TerrainGrid, paint: PaintMap): StrokeRecorder {
  const heightBefore = new Map<number, number>();
  const paintBefore = new Map<number, number>();
  let graph: StrokeDiff["graph"];
  let lock: StrokeDiff["lock"];
  const stride = grid.rows + 1;
  return {
    beforeHeightsWrite(w) {
      const minRow = Math.max(0, w.minRow);
      const maxRow = Math.min(grid.rows, w.maxRow);
      const minCol = Math.max(0, w.minCol);
      const maxCol = Math.min(grid.cols, w.maxCol);
      for (let c = minCol; c <= maxCol; c++) {
        for (let r = minRow; r <= maxRow; r++) {
          const i = r + c * stride;
          if (!heightBefore.has(i)) heightBefore.set(i, grid.heights[i]);
        }
      }
    },
    beforePaintWrite(rect) {
      const minPx = Math.max(0, rect.minPx);
      const maxPx = Math.min(paint.width - 1, rect.maxPx);
      const minPz = Math.max(0, rect.minPz);
      const maxPz = Math.min(paint.height - 1, rect.maxPz);
      for (let pz = minPz; pz <= maxPz; pz++) {
        for (let px = minPx; px <= maxPx; px++) {
          const i = pz * paint.width + px;
          if (!paintBefore.has(i)) paintBefore.set(i, paint.data[i]);
        }
      }
    },
    recordGraph(before, after, nextEdgeIdBefore, nextEdgeIdAfter) {
      // First snapshot's "before" wins; the latest "after" wins.
      graph = {
        before: graph ? graph.before : before,
        after,
        nextEdgeIdBefore: graph ? graph.nextEdgeIdBefore : nextEdgeIdBefore,
        nextEdgeIdAfter,
      };
    },
    recordLock(before, after) {
      lock = { before: lock ? lock.before : before, after };
    },
    commit() {
      let heights: StrokeDiff["heights"];
      const hIdx: number[] = [];
      for (const [i, v] of heightBefore) if (grid.heights[i] !== v) hIdx.push(i);
      if (hIdx.length > 0) {
        hIdx.sort((a, b) => a - b);
        heights = {
          indices: Uint32Array.from(hIdx),
          before: Float32Array.from(hIdx, (i) => heightBefore.get(i) as number),
          after: Float32Array.from(hIdx, (i) => grid.heights[i]),
        };
      }
      let paintDiff: StrokeDiff["paint"];
      const pIdx: number[] = [];
      for (const [i, v] of paintBefore) if (paint.data[i] !== v) pIdx.push(i);
      if (pIdx.length > 0) {
        pIdx.sort((a, b) => a - b);
        paintDiff = {
          indices: Uint32Array.from(pIdx),
          before: Uint8Array.from(pIdx, (i) => paintBefore.get(i) as number),
          after: Uint8Array.from(pIdx, (i) => paint.data[i]),
        };
      }
      const g = graph && graph.before !== graph.after ? graph : undefined;
      heightBefore.clear();
      paintBefore.clear();
      graph = undefined;
      const sameIds = (a: readonly number[], b: readonly number[]): boolean =>
        a.length === b.length && a.every((v, i) => v === b[i]);
      const l =
        lock && !sameIds([...lock.before].sort(asc), [...lock.after].sort(asc))
          ? { before: [...lock.before].sort(asc), after: [...lock.after].sort(asc) }
          : undefined;
      lock = undefined;
      if (!heights && !paintDiff && !g && !l) return undefined;
      return l
        ? { heights, paint: paintDiff, graph: g, lock: l }
        : { heights, paint: paintDiff, graph: g };
    },
  };
}
