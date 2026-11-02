/**
 * Windowed slope limiter for the terrain sculpt tool (phase 04.2, D-03).
 *
 * After any height edit the touched window (grown by `expandWindow`) is run
 * through a two-pass raster sweep (forward: W, N, NW, NE; backward: E, S, SE,
 * SW) so no axis or diagonal neighbour pair is steeper than the cap. This is a
 * chamfer-distance style relaxation: one forward and one backward pass make a
 * one-sided (Lipschitz envelope) constraint exact.
 *
 * Which side moves: a pure "clamp towards neighbours" pass would raise a whole
 * cone around a spike. The limiter instead evaluates both one-sided envelopes
 * (lower the high cells / raise the low cells) and keeps the one that changes
 * less height in total, so a spike loses its peak (Populous-style) and a pit
 * is filled. A final two-sided pass then reconciles non-road cells against
 * road-masked cells, which are NEVER written: they only act as sources.
 * Violations that remain around road cells are reported, not forced.
 *
 * Layering: pure core, no three/rapier/DOM. Never touches vertices outside the
 * window (no global pass per stroke).
 */

import type { TerrainGrid } from "./terrain-grid.ts";
import { MAX_SLOPE_DEG } from "./terrain-limits.ts";

/** Inclusive vertex index range. */
export interface CellWindow {
  minRow: number;
  minCol: number;
  maxRow: number;
  maxCol: number;
}

export interface LimitSlopeOptions {
  /** Defaults to MAX_SLOPE_DEG. */
  maxSlopeDeg?: number;
  /** Same indexing as `grid.heights`; non-zero marks a road vertex that must not move. */
  mask?: Uint8Array;
  /** Sweep repetitions (default 4); stops early when nothing changes. */
  iterations?: number;
}

export interface LimitSlopeResult {
  /** Indices (grid.heights indexing) whose value differs from before the call. */
  changed: Uint32Array;
  /** Neighbour pairs involving a road vertex still steeper than the cap. */
  roadViolations: number;
}

/** Absolute safety margin (m) so Float32 rounding never lands a pair above the cap. */
const EPS_M = 1e-5;
const SQRT2 = Math.SQRT2;

function clampWindow(w: CellWindow, grid: TerrainGrid): CellWindow {
  return {
    minRow: Math.max(0, w.minRow),
    minCol: Math.max(0, w.minCol),
    maxRow: Math.min(grid.rows, w.maxRow),
    maxCol: Math.min(grid.cols, w.maxCol),
  };
}

/** Grows `window` by enough cells for a `maxDeltaM` height change to fade out at the slope cap. */
export function expandWindow(
  win: CellWindow,
  grid: TerrainGrid,
  maxDeltaM: number,
  maxSlopeDeg: number = MAX_SLOPE_DEG,
): CellWindow {
  const perCell = Math.tan((maxSlopeDeg * Math.PI) / 180) * grid.cellSizeM;
  const n =
    Number.isFinite(maxDeltaM) && perCell > 0 ? Math.ceil(Math.abs(maxDeltaM) / perCell) : 0;
  return clampWindow(
    {
      minRow: win.minRow - n,
      minCol: win.minCol - n,
      maxRow: win.maxRow + n,
      maxCol: win.maxCol + n,
    },
    grid,
  );
}

/** Steepest axis-neighbour slope (degrees) among vertex pairs inside the window. */
export function maxSlopeDegIn(grid: TerrainGrid, win: CellWindow): number {
  const w = clampWindow(win, grid);
  const stride = grid.rows + 1;
  const h = grid.heights;
  let maxD = 0;
  for (let c = w.minCol; c <= w.maxCol; c++) {
    for (let r = w.minRow; r <= w.maxRow; r++) {
      const i = r + c * stride;
      if (r < w.maxRow) maxD = Math.max(maxD, Math.abs(h[i + 1] - h[i]));
      if (c < w.maxCol) maxD = Math.max(maxD, Math.abs(h[i + stride] - h[i]));
    }
  }
  return (Math.atan2(maxD, grid.cellSizeM) * 180) / Math.PI;
}

type Mode = "down" | "up" | "both";

/** Forward + backward chamfer sweeps; returns true if any vertex changed. */
function sweep(
  grid: TerrainGrid,
  w: CellWindow,
  d: number,
  mode: Mode,
  mask: Uint8Array | undefined,
): boolean {
  const stride = grid.rows + 1;
  const h = grid.heights;
  const dd = d * SQRT2;
  let any = false;

  const relax = (i: number, ni: number, lim: number): void => {
    if (mask && mask[i]) return;
    const hn = h[ni];
    let v = h[i];
    const hi = hn + lim;
    const lo = hn - lim;
    if (mode !== "up" && v > hi) v = hi;
    if (mode !== "down" && v < lo) v = lo;
    if (v !== h[i]) {
      const f = Math.fround(v);
      if (f !== h[i]) {
        h[i] = f;
        any = true;
      }
    }
  };

  for (let c = w.minCol; c <= w.maxCol; c++) {
    for (let r = w.minRow; r <= w.maxRow; r++) {
      const i = r + c * stride;
      if (c > w.minCol) relax(i, i - stride, d);
      if (r > w.minRow) {
        relax(i, i - 1, d);
        if (c > w.minCol) relax(i, i - 1 - stride, dd);
        if (c < w.maxCol) relax(i, i - 1 + stride, dd);
      }
    }
  }
  for (let c = w.maxCol; c >= w.minCol; c--) {
    for (let r = w.maxRow; r >= w.minRow; r--) {
      const i = r + c * stride;
      if (c < w.maxCol) relax(i, i + stride, d);
      if (r < w.maxRow) {
        relax(i, i + 1, d);
        if (c < w.maxCol) relax(i, i + 1 + stride, dd);
        if (c > w.minCol) relax(i, i + 1 - stride, dd);
      }
    }
  }
  return any;
}

function runMode(
  grid: TerrainGrid,
  w: CellWindow,
  d: number,
  mode: Mode,
  mask: Uint8Array | undefined,
  iterations: number,
): void {
  for (let k = 0; k < iterations; k++) {
    if (!sweep(grid, w, d, mode, mask)) break;
  }
}

function totalDifference(grid: TerrainGrid, w: CellWindow, snap: Float32Array): number {
  const stride = grid.rows + 1;
  const rowsN = w.maxRow - w.minRow + 1;
  let sum = 0;
  let k = 0;
  for (let c = w.minCol; c <= w.maxCol; c++) {
    const base = w.minRow + c * stride;
    for (let r = 0; r < rowsN; r++, k++) sum += Math.abs(grid.heights[base + r] - snap[k]);
  }
  return sum;
}

function snapshot(grid: TerrainGrid, w: CellWindow): Float32Array {
  const stride = grid.rows + 1;
  const rowsN = w.maxRow - w.minRow + 1;
  const out = new Float32Array(rowsN * (w.maxCol - w.minCol + 1));
  let k = 0;
  for (let c = w.minCol; c <= w.maxCol; c++) {
    const base = w.minRow + c * stride;
    for (let r = 0; r < rowsN; r++) out[k++] = grid.heights[base + r];
  }
  return out;
}

function restore(grid: TerrainGrid, w: CellWindow, snap: Float32Array): void {
  const stride = grid.rows + 1;
  const rowsN = w.maxRow - w.minRow + 1;
  let k = 0;
  for (let c = w.minCol; c <= w.maxCol; c++) {
    const base = w.minRow + c * stride;
    for (let r = 0; r < rowsN; r++) grid.heights[base + r] = snap[k++];
  }
}

function countRoadViolations(
  grid: TerrainGrid,
  w: CellWindow,
  d: number,
  mask: Uint8Array,
): number {
  const stride = grid.rows + 1;
  const h = grid.heights;
  const tol = 1e-4;
  let n = 0;
  const check = (i: number, j: number, lim: number): void => {
    if ((mask[i] || mask[j]) && Math.abs(h[i] - h[j]) > lim + tol) n++;
  };
  for (let c = w.minCol; c <= w.maxCol; c++) {
    for (let r = w.minRow; r <= w.maxRow; r++) {
      const i = r + c * stride;
      if (r < w.maxRow) check(i, i + 1, d);
      if (c < w.maxCol) {
        check(i, i + stride, d);
        if (r < w.maxRow) check(i, i + 1 + stride, d * SQRT2);
        if (r > w.minRow) check(i, i - 1 + stride, d * SQRT2);
      }
    }
  }
  return n;
}

export function limitSlope(
  grid: TerrainGrid,
  win: CellWindow,
  opts: LimitSlopeOptions = {},
): LimitSlopeResult {
  const w = clampWindow(win, grid);
  if (w.minRow > w.maxRow || w.minCol > w.maxCol) {
    return { changed: new Uint32Array(0), roadViolations: 0 };
  }
  const slopeDeg = opts.maxSlopeDeg ?? MAX_SLOPE_DEG;
  const iterations = Math.max(1, opts.iterations ?? 4);
  const mask = opts.mask;
  const d = Math.max(0, Math.tan((slopeDeg * Math.PI) / 180) * grid.cellSizeM - EPS_M);

  const original = snapshot(grid, w);

  // Try lowering the high cells, then raising the low cells; keep the cheaper.
  runMode(grid, w, d, "down", mask, iterations);
  const downCost = totalDifference(grid, w, original);
  if (downCost > 0) {
    const downResult = snapshot(grid, w);
    restore(grid, w, original);
    runMode(grid, w, d, "up", mask, iterations);
    const upCost = totalDifference(grid, w, original);
    if (downCost <= upCost) restore(grid, w, downResult);
  } else {
    // Nothing needed lowering; check for pits.
    runMode(grid, w, d, "up", mask, iterations);
  }
  // Reconcile around road sources (a no-op without a mask once one side is done).
  if (mask) runMode(grid, w, d, "both", mask, iterations);

  const stride = grid.rows + 1;
  const rowsN = w.maxRow - w.minRow + 1;
  const changed: number[] = [];
  let k = 0;
  for (let c = w.minCol; c <= w.maxCol; c++) {
    const base = w.minRow + c * stride;
    for (let r = 0; r < rowsN; r++, k++) {
      if (grid.heights[base + r] !== original[k]) changed.push(base + r);
    }
  }
  return {
    changed: Uint32Array.from(changed),
    roadViolations: mask ? countRoadViolations(grid, w, d, mask) : 0,
  };
}
