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
import type { RoadGraph } from "./road-graph.ts";
import { type BrushShape, brushDistance } from "./terrain-brush.ts";
import type { TerrainGrid } from "./terrain-grid.ts";
import type { CellWindow } from "./terrain-slope.ts";

/** Below this on-screen cell size (px) the editor shows a "zoom in" hint instead of the grid. */
export const ZOOM_HINT_MIN_CELL_PX = 8;
/** Lift of grid lines above the terrain surface so they do not z-fight. */
const GRID_LIFT_M = 0.05;
/** On-screen cell size (px) at which the contour interval equals the user's base interval. */
export const CONTOUR_REF_CELL_PX = 16;
/** Allowed contour intervals (m), finest to coarsest. */
export const CONTOUR_LADDER_M: readonly number[] = [0.25, 0.5, 1, 2, 5, 10];
/** Lift of the brush footprint (outline and grid) above the surface. */
export const FOOTPRINT_LIFT_M = 0.15;
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
export function gridLineSegments(
  grid: TerrainGrid,
  window: CellWindow,
  liftM: number = GRID_LIFT_M,
): Float32Array {
  const w = clipWindow(grid, window);
  if (!w) return new Float32Array(0);
  const stride = grid.rows + 1;
  const rowsN = w.maxRow - w.minRow;
  const colsN = w.maxCol - w.minCol;
  const out = new Float32Array(((rowsN + 1) * colsN + (colsN + 1) * rowsN) * 6);
  let k = 0;
  const put = (r: number, c: number): void => {
    out[k++] = grid.originX + c * grid.cellSizeM;
    out[k++] = grid.heights[r + c * stride] + liftM;
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
 * Cells overlapped by the brush footprint's bounding square [x-r, x+r] x [z-r, z+r],
 * as a vertex window clipped to the grid. Centred on the true cursor point (not on a
 * rounded cell), so the drawn grid cannot drift off the cursor. Null when off the grid.
 */
export function brushFootprintWindow(
  grid: TerrainGrid,
  x: number,
  z: number,
  r: number,
  _shape: BrushShape = "round",
): CellWindow | null {
  if (![x, z, r].every(Number.isFinite) || !(grid.cellSizeM > 0)) return null;
  const cs = grid.cellSizeM;
  return clipWindow(grid, {
    minCol: Math.floor((x - r - grid.originX) / cs),
    maxCol: Math.ceil((x + r - grid.originX) / cs),
    minRow: Math.floor((z - r - grid.originZ) / cs),
    maxRow: Math.ceil((z + r - grid.originZ) / cs),
  });
}

/**
 * Cell edges under the brush footprint, y = vertex height + liftM. Square: every edge of
 * the cells the square touches. Round: only edges whose midpoint lies inside the disc.
 * Edges use the same vertex indexing as the rendered mesh so they sit exactly on it.
 */
export function footprintGridSegments(
  grid: TerrainGrid,
  x: number,
  z: number,
  r: number,
  shape: BrushShape = "round",
  liftM: number = FOOTPRINT_LIFT_M,
): Float32Array {
  const w = brushFootprintWindow(grid, x, z, r, shape);
  if (!w) return new Float32Array(0);
  const stride = grid.rows + 1;
  const cs = grid.cellSizeM;
  const out: number[] = [];
  const inside = (row: number, col: number): boolean =>
    brushDistance(shape, grid.originX + col * cs - x, grid.originZ + row * cs - z) <= r;
  const put = (row: number, col: number): void => {
    out.push(
      grid.originX + col * cs,
      grid.heights[row + col * stride] + liftM,
      grid.originZ + row * cs,
    );
  };
  const edge = (r0: number, c0: number, r1: number, c1: number): void => {
    if (shape !== "square") {
      const mr = (r0 + r1) / 2;
      const mc = (c0 + c1) / 2;
      if (!inside(mr, mc)) return;
    }
    put(r0, c0);
    put(r1, c1);
  };
  for (let row = w.minRow; row <= w.maxRow; row++) {
    for (let col = w.minCol; col < w.maxCol; col++) edge(row, col, row, col + 1);
  }
  for (let col = w.minCol; col <= w.maxCol; col++) {
    for (let row = w.minRow; row < w.maxRow; row++) edge(row, col, row + 1, col);
  }
  return Float32Array.from(out);
}

/** Closed outline of the footprint as flat XZ pairs [x0,z0,x1,z1,...] centred exactly on (x, z). */
export function footprintOutline(
  x: number,
  z: number,
  r: number,
  shape: BrushShape,
  segments: number,
): Float32Array {
  const n = Math.max(3, Math.floor(segments));
  if (shape === "square") {
    const per = Math.max(1, Math.round(n / 4));
    const pts: number[] = [];
    const side = (ax: number, az: number, bx: number, bz: number): void => {
      for (let i = 0; i < per; i++) {
        const t = i / per;
        pts.push(ax + (bx - ax) * t, az + (bz - az) * t);
      }
    };
    side(x - r, z - r, x + r, z - r);
    side(x + r, z - r, x + r, z + r);
    side(x + r, z + r, x - r, z + r);
    side(x - r, z + r, x - r, z - r);
    return Float32Array.from(pts);
  }
  const out = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    out[i * 2] = x + Math.cos(a) * r;
    out[i * 2 + 1] = z + Math.sin(a) * r;
  }
  return out;
}

/**
 * Contour interval that follows zoom: equals the (ladder-snapped) base at
 * CONTOUR_REF_CELL_PX, coarser when cells are smaller on screen, finer when larger.
 */
export function contourIntervalForZoom(cellPx: number, baseM: number): number {
  const snap = (v: number): number => {
    let best = CONTOUR_LADDER_M[0];
    let bestD = Number.POSITIVE_INFINITY;
    for (const l of CONTOUR_LADDER_M) {
      const d = Math.abs(Math.log(l) - Math.log(v));
      if (d < bestD) {
        bestD = d;
        best = l;
      }
    }
    return best;
  };
  const base = Number.isFinite(baseM) && baseM > 0 ? baseM : 1;
  if (!Number.isFinite(cellPx) || cellPx <= 0) return snap(base);
  return snap((base * CONTOUR_REF_CELL_PX) / cellPx);
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

/**
 * Quick 261110-rdx: road centreline segments split by lock state for the editor
 * overlay. `selectedEdgeId` goes only into `selected`; unlocked edges into
 * `unlocked`; everything else into `locked`. y = point y + liftM.
 */
export function roadLockSegments(
  graph: RoadGraph,
  unlocked: readonly number[] | undefined,
  selectedEdgeId: number | null,
  liftM: number,
): { locked: Float32Array; unlocked: Float32Array; selected: Float32Array } {
  const free = new Set(unlocked ?? []);
  const lists: Record<"locked" | "unlocked" | "selected", number[]> = {
    locked: [],
    unlocked: [],
    selected: [],
  };
  for (const e of graph.edges) {
    const bucket =
      e.id === selectedEdgeId ? lists.selected : free.has(e.id) ? lists.unlocked : lists.locked;
    for (let k = 0; k + 1 < e.points.length; k++) {
      const a = e.points[k];
      const b = e.points[k + 1];
      bucket.push(a[0], a[1] + liftM, a[2], b[0], b[1] + liftM, b[2]);
    }
  }
  return {
    locked: Float32Array.from(lists.locked),
    unlocked: Float32Array.from(lists.unlocked),
    selected: Float32Array.from(lists.selected),
  };
}
