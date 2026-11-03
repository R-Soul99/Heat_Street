/**
 * Pure overlay math for the terrain editor (D-22): grid line segments for a
 * window, marching-squares contour segments at a height interval, and the
 * zoom check that decides when cells are too small to be worth drawing.
 *
 * Outputs are flat Float32Array [x0,y0,z0,x1,y1,z1,...] in world metres so the
 * editor can feed them straight into a BufferGeometry.
 *
 * Layering: pure core, no three/rapier/DOM.
 */
import type { TerrainGrid } from "./terrain-grid.ts";
import type { CellWindow } from "./terrain-slope.ts";

/** Below this on-screen cell size (px) the editor shows a "zoom in" hint instead of the grid. */
export const ZOOM_HINT_MIN_CELL_PX = 8;
/** Lift of grid lines above the terrain surface so they do not z-fight. */
const GRID_LIFT_M = 0.05;
/** Safety cap on contour levels a single cell can emit. */
const MAX_LEVELS_PER_CELL = 64;

function clipWindow(grid: TerrainGrid, w: CellWindow): CellWindow | null {
  const out = {
    minRow: Math.max(0, Math.floor(w.minRow)),
    minCol: Math.max(0, Math.floor(w.minCol)),
    maxRow: Math.min(grid.rows, Math.ceil(w.maxRow)),
    maxCol: Math.min(grid.cols, Math.ceil(w.maxCol)),
  };
  return out.minRow < out.maxRow && out.minCol < out.maxCol ? out : null;
}

/**
 * Grid lines for a vertex window: every row line and column line, split per
 * cell so each piece follows the terrain at height + 0.05 m. A window of
 * N x M cells yields (N+1)*M + (M+1)*N segments.
 */
export function gridLineSegments(grid: TerrainGrid, window: CellWindow): Float32Array {
  const w = clipWindow(grid, window);
  if (!w) return new Float32Array(0);
  const stride = grid.rows + 1;
  const rowsN = w.maxRow - w.minRow;
  const colsN = w.maxCol - w.minCol;
  const out = new Float32Array(((rowsN + 1) * colsN + (colsN + 1) * rowsN) * 6);
  let k = 0;
  const put = (r: number, c: number): void => {
    out[k++] = grid.originX + c * grid.cellSizeM;
    out[k++] = grid.heights[r + c * stride] + GRID_LIFT_M;
    out[k++] = grid.originZ + r * grid.cellSizeM;
  };
  for (let r = w.minRow; r <= w.maxRow; r++) {
    for (let c = w.minCol; c < w.maxCol; c++) {
      put(r, c);
      put(r, c + 1);
    }
  }
  for (let c = w.minCol; c <= w.maxCol; c++) {
    for (let r = w.minRow; r < w.maxRow; r++) {
      put(r, c);
      put(r + 1, c);
    }
  }
  return out;
}

/**
 * Contour lines at every multiple of `intervalM` (marching squares over the
 * window's cells). Points sit at y = the contour level. A vertex exactly on a
 * level counts as above it. Saddle cells are resolved by the cell-centre average.
 * Interval <= 0 or non-finite returns an empty array.
 */
export function contourSegments(
  grid: TerrainGrid,
  window: CellWindow,
  intervalM: number,
): Float32Array {
  if (!Number.isFinite(intervalM) || intervalM <= 0) return new Float32Array(0);
  const w = clipWindow(grid, window);
  if (!w) return new Float32Array(0);
  const stride = grid.rows + 1;
  const out: number[] = [];
  const cs = grid.cellSizeM;
  // Corners: 0 (r,c), 1 (r,c+1), 2 (r+1,c+1), 3 (r+1,c). Edges: e0 0-1, e1 1-2, e2 2-3, e3 3-0.
  const dr = [0, 0, 1, 1];
  const dc = [0, 1, 1, 0];
  const hs = [0, 0, 0, 0];
  for (let r = w.minRow; r < w.maxRow; r++) {
    for (let c = w.minCol; c < w.maxCol; c++) {
      let lo = Number.POSITIVE_INFINITY;
      let hi = Number.NEGATIVE_INFINITY;
      for (let i = 0; i < 4; i++) {
        const h = grid.heights[r + dr[i] + (c + dc[i]) * stride];
        hs[i] = h;
        if (h < lo) lo = h;
        if (h > hi) hi = h;
      }
      if (!(hi > lo)) continue;
      const k0 = Math.ceil(lo / intervalM);
      const k1 = Math.floor(hi / intervalM);
      for (let k = k0; k <= k1 && k - k0 < MAX_LEVELS_PER_CELL; k++) {
        const level = k * intervalM;
        const above = hs.map((h) => h >= level);
        const edgePoint = (e: number): [number, number] => {
          const a = e;
          const b = (e + 1) % 4;
          const t = (level - hs[a]) / (hs[b] - hs[a]);
          const col = c + dc[a] + (dc[b] - dc[a]) * t;
          const row = r + dr[a] + (dr[b] - dr[a]) * t;
          return [grid.originX + col * cs, grid.originZ + row * cs];
        };
        const crossing: number[] = [];
        for (let e = 0; e < 4; e++) if (above[e] !== above[(e + 1) % 4]) crossing.push(e);
        const emit = (ea: number, eb: number): void => {
          const [ax, az] = edgePoint(ea);
          const [bx, bz] = edgePoint(eb);
          out.push(ax, level, az, bx, level, bz);
        };
        if (crossing.length === 2) {
          emit(crossing[0], crossing[1]);
        } else if (crossing.length === 4) {
          const centreAbove = (hs[0] + hs[1] + hs[2] + hs[3]) / 4 >= level;
          if (centreAbove === above[0]) {
            emit(0, 1);
            emit(2, 3);
          } else {
            emit(3, 0);
            emit(1, 2);
          }
        }
      }
    }
  }
  return Float32Array.from(out);
}

/** On-screen size in pixels of one terrain cell for a perspective camera looking at it from `cameraDistM`. */
export function cellPixelSize(
  cameraDistM: number,
  fovDeg: number,
  viewportHeightPx: number,
  cellSizeM: number,
): number {
  return (
    (cellSizeM * viewportHeightPx) / (2 * cameraDistM * Math.tan((fovDeg * Math.PI) / 180 / 2))
  );
}

/** True when cells are too small on screen for the grid overlay to be useful (also true for non-finite input). */
export function needsZoomHint(cellPx: number): boolean {
  return !(cellPx >= ZOOM_HINT_MIN_CELL_PX);
}
