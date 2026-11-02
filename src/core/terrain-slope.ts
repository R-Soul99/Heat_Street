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
 * window (no global pass per stroke); the one-vertex ring just outside it is
 * read as fixed sources so the window border never steps away from its
 * unchanged neighbours (WR-03).
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

/**
 * Forward + backward chamfer sweeps over `w` (which may include a read-only
 * source ring around the write window `ww`); returns true if any vertex changed.
 * Only vertices inside `ww` and not masked are ever written.
 */
function sweep(
  grid: TerrainGrid,
  w: CellWindow,
  ww: CellWindow,
  d: number,
  mode: Mode,
  mask: Uint8Array | undefined,
): boolean {
  const stride = grid.rows + 1;
  const h = grid.heights;
  const dd = d * SQRT2;
  let any = false;

  const relax = (i: number, ni: number, lim: number): void => {
    if (mask?.[i]) return;
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

  // Only vertices of the write window are visited (relax writes the visited
  // vertex only); neighbours are read from the wider sweep window `w`.
  for (let c = ww.minCol; c <= ww.maxCol; c++) {
    for (let r = ww.minRow; r <= ww.maxRow; r++) {
      const i = r + c * stride;
      if (c > w.minCol) relax(i, i - stride, d);
      if (r > w.minRow) {
        relax(i, i - 1, d);
        if (c > w.minCol) relax(i, i - 1 - stride, dd);
        if (c < w.maxCol) relax(i, i - 1 + stride, dd);
      }
    }
  }
  for (let c = ww.maxCol; c >= ww.minCol; c--) {
    for (let r = ww.maxRow; r >= ww.minRow; r--) {
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
  ww: CellWindow,
  d: number,
  mode: Mode,
  mask: Uint8Array | undefined,
  iterations: number,
): void {
  for (let k = 0; k < iterations; k++) {
    if (!sweep(grid, w, ww, d, mode, mask)) break;
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

/** Over-cap pairs inside `w`; only pairs touching a masked vertex when `mask` is given. */
function countViolations(
  grid: TerrainGrid,
  w: CellWindow,
  d: number,
  mask: Uint8Array | undefined,
): number {
  const stride = grid.rows + 1;
  const h = grid.heights;
  const tol = 1e-4;
  let n = 0;
  const check = (i: number, j: number, lim: number): void => {
    if ((!mask || mask[i] || mask[j]) && Math.abs(h[i] - h[j]) > lim + tol) n++;
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

  // WR-03: the one-vertex ring just outside the window is read as fixed
  // sources, so border vertices stay within the cap of their (unchanged)
  // outside neighbours instead of stepping away from them.
  const ring = clampWindow(
    { minRow: w.minRow - 1, minCol: w.minCol - 1, maxRow: w.maxRow + 1, maxCol: w.maxCol + 1 },
    grid,
  );
  const hasRing =
    ring.minRow < w.minRow ||
    ring.minCol < w.minCol ||
    ring.maxRow > w.maxRow ||
    ring.maxCol > w.maxCol;

  const original = snapshot(grid, w);

  // Try lowering the high cells, then raising the low cells; keep the cheaper.
  // With a fixed ring, one direction may be unable to satisfy the ring (e.g. a
  // block above its surroundings cannot be fixed by raising), so the result
  // that leaves fewer violations wins first, then the cheaper one.
  runMode(grid, ring, w, d, "down", mask, iterations);
  const downCost = totalDifference(grid, w, original);
  if (downCost > 0) {
    const downResult = snapshot(grid, w);
    const downBad = hasRing ? countViolations(grid, ring, d, undefined) : 0;
    restore(grid, w, original);
    runMode(grid, ring, w, d, "up", mask, iterations);
    const upCost = totalDifference(grid, w, original);
    const upBad = hasRing ? countViolations(grid, ring, d, undefined) : 0;
    const preferDown = downBad !== upBad ? downBad < upBad : downCost <= upCost;
    if (preferDown) restore(grid, w, downResult);
  } else {
    // Nothing needed lowering; check for pits.
    runMode(grid, ring, w, d, "up", mask, iterations);
  }
  // Reconcile around fixed sources (road cells and the outside ring); a no-op
  // without either once one side is done.
  if (mask || hasRing) runMode(grid, ring, w, d, "both", mask, iterations);

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
    roadViolations: mask ? countViolations(grid, w, d, mask) : 0,
  };
}
