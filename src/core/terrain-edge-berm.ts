/**
 * Terrain-edge berm: a low solid wall around a terrain grid's bounds (04.3 D-06..D-10).
 *
 * One pure builder feeds BOTH the Rapier cuboid colliders (src/physics/terrain-scene.ts)
 * and the visible merged mesh (src/render/terrain-view.ts), so physics and visuals
 * cannot disagree. Nothing is authored or saved: it is derived from the grid at load.
 *
 * Each edge is split into runs of axis-aligned boxes. A box's top is the local
 * maximum edge height plus the berm height (the collider is only as tall as the
 * visible berm, D-09); its bottom is 1 m under the local minimum so it never
 * floats above sloped ground. Runs are capped in length and height spread, but
 * never shorter than BERM_RUN_MIN_M so a jagged edge cannot explode the box count.
 *
 * Layering: pure data transform, no three/rapier/DOM.
 */
import type { TerrainGrid } from "./terrain-grid.ts";

export interface BermBox {
  readonly cx: number;
  readonly cy: number;
  readonly cz: number;
  readonly hx: number;
  readonly hy: number;
  readonly hz: number;
}

/** Visible and collidable berm height above the local terrain (m). */
export const BERM_HEIGHT_M = 1.5;
/** Berm thickness (m). Thick cuboids are tunnelling-safe at about 1 m per tick. */
export const BERM_THICKNESS_M = 3;
/** How far the berm's inner face sits inside the grid edge (m). */
export const BERM_INSET_M = 1;
/** Max edge-height spread within one run (m), once the run is at least BERM_RUN_MIN_M long. */
export const BERM_RUN_MAX_DROP_M = 1.0;
/** Max run length (m). */
export const BERM_RUN_MAX_M = 128;
/** Min run length (m): bounds the box count on a jagged edge. */
export const BERM_RUN_MIN_M = 8;
/** How far below the lowest edge height a box reaches (m). */
const BERM_FOOT_M = 1;

interface Run {
  readonly a: number; // start offset along the edge (m)
  readonly b: number; // end offset along the edge (m)
  readonly min: number;
  readonly max: number;
}

function buildRuns(h: readonly number[], cell: number): Run[] {
  const n = h.length - 1;
  const runs: Run[] = [];
  let i0 = 0;
  while (i0 < n) {
    let j = i0 + 1;
    let mn = Math.min(h[i0], h[j]);
    let mx = Math.max(h[i0], h[j]);
    while (j < n) {
      const next = j + 1;
      const len = (next - i0) * cell;
      const so = (j - i0) * cell;
      const nmn = Math.min(mn, h[next]);
      const nmx = Math.max(mx, h[next]);
      if (len > BERM_RUN_MAX_M && so >= BERM_RUN_MIN_M) break;
      if (so >= BERM_RUN_MIN_M && nmx - nmn > BERM_RUN_MAX_DROP_M) break;
      if (len > BERM_RUN_MAX_M) break;
      mn = nmn;
      mx = nmx;
      j = next;
    }
    runs.push({ a: i0 * cell, b: j * cell, min: mn, max: mx });
    i0 = j;
  }
  return runs;
}

export function buildEdgeBerm(
  grid: TerrainGrid,
  opts: Partial<{ heightM: number; thicknessM: number; insetM: number }> = {},
): BermBox[] {
  const heightM = opts.heightM ?? BERM_HEIGHT_M;
  const thicknessM = opts.thicknessM ?? BERM_THICKNESS_M;
  const insetM = opts.insetM ?? BERM_INSET_M;
  const out = thicknessM - insetM; // how far the berm extends past the grid edge
  const stride = grid.rows + 1;
  const cell = grid.cellSizeM;
  const x0 = grid.originX;
  const z0 = grid.originZ;
  const x1 = x0 + grid.scaleX;
  const z1 = z0 + grid.scaleZ;
  const boxes: BermBox[] = [];

  const vertical = (min: number, max: number): { cy: number; hy: number } => {
    const bottom = min - BERM_FOOT_M;
    const top = max + heightM;
    return { cy: (top + bottom) / 2, hy: (top - bottom) / 2 };
  };

  // x-edges (rows 0 and rows): run along X, extended over the outer corner squares.
  for (const row of [0, grid.rows]) {
    const h: number[] = [];
    for (let c = 0; c <= grid.cols; c++) h.push(grid.heights[row + c * stride]);
    const runs = buildRuns(h, cell);
    const lastIdx = runs.length - 1;
    const zLo = row === 0 ? z0 - out : z1 - insetM;
    const zHi = row === 0 ? z0 + insetM : z1 + out;
    runs.forEach((r, k) => {
      const xa = x0 + r.a - (k === 0 ? out : 0);
      const xb = x0 + r.b + (k === lastIdx ? out : 0);
      const { cy, hy } = vertical(r.min, r.max);
      boxes.push({
        cx: (xa + xb) / 2,
        cy,
        cz: (zLo + zHi) / 2,
        hx: (xb - xa) / 2,
        hy,
        hz: (zHi - zLo) / 2,
      });
    });
  }

  // z-edges (cols 0 and cols): run along Z between the x-edge boxes.
  for (const col of [0, grid.cols]) {
    const h: number[] = [];
    for (let r = 0; r <= grid.rows; r++) h.push(grid.heights[r + col * stride]);
    const runs = buildRuns(h, cell);
    const xLo = col === 0 ? x0 - out : x1 - insetM;
    const xHi = col === 0 ? x0 + insetM : x1 + out;
    for (const r of runs) {
      const za = z0 + r.a;
      const zb = z0 + r.b;
      const { cy, hy } = vertical(r.min, r.max);
      boxes.push({
        cx: (xLo + xHi) / 2,
        cy,
        cz: (za + zb) / 2,
        hx: (xHi - xLo) / 2,
        hy,
        hz: (zb - za) / 2,
      });
    }
  }
  return boxes;
}
