/**
 * Terrain height grid with a TRIANGLE-consistent sampler.
 *
 * Bilinear sampling does not match the triangles Rapier collides with
 * (04.2-RESEARCH finding 3), so every consumer (spawn heights, graph node y,
 * render meshes, road brush) must use `sampleTerrainHeight`, whose diagonal is
 * measured against a real Rapier heightfield raycast in
 * tests/terrain-sampler.test.ts.
 *
 * Storage convention reused from heightfield-sample.ts:
 * `heights[row + col * (rows + 1)]`, row tracks Z, col tracks X, literal metres.
 *
 * Layering: pure data transform, no three/rapier/DOM.
 */
import type { SampleableHeightfield } from "./heightfield-sample.ts";

export interface TerrainGrid extends SampleableHeightfield {
  readonly heights: Float32Array;
  readonly cellSizeM: number;
}

export interface TerrainVec3 {
  x: number;
  y: number;
  z: number;
}

export type TerrainDiagonal = "row0col0-row1col1" | "row0col1-row1col0";

/**
 * The quad diagonal Rapier 0.20.0 uses for a heightfield cell.
 * (worst error 6e-6 m for this diagonal vs 2.2 m for the other.)
 * Measured against rapier3d 0.20.0 castRay in tests/terrain-sampler.test.ts. */
export const TERRAIN_DIAGONAL: TerrainDiagonal = "row0col1-row1col0";

export function createTerrainGrid(opts: {
  rows: number;
  cols: number;
  cellSizeM: number;
  originX: number;
  originZ: number;
  fill?: number;
}): TerrainGrid {
  const { rows, cols, cellSizeM, originX, originZ, fill = 0 } = opts;
  if (!Number.isInteger(rows) || rows <= 0)
    throw new RangeError(`rows must be a positive integer, got ${rows}`);
  if (!Number.isInteger(cols) || cols <= 0)
    throw new RangeError(`cols must be a positive integer, got ${cols}`);
  if (!Number.isFinite(cellSizeM) || cellSizeM <= 0) {
    throw new RangeError(`cellSizeM must be finite and > 0, got ${cellSizeM}`);
  }
  if ((rows + 1) * (cols + 1) > 2 ** 27)
    throw new RangeError("rows*cols too large for a terrain grid");
  const heights = new Float32Array((rows + 1) * (cols + 1));
  if (fill !== 0) heights.fill(fill);
  return {
    rows,
    cols,
    cellSizeM,
    originX,
    originZ,
    scaleX: cols * cellSizeM,
    scaleZ: rows * cellSizeM,
    heights,
  };
}

export function terrainIndex(grid: SampleableHeightfield, row: number, col: number): number {
  return row + col * (grid.rows + 1);
}

interface CellLocation {
  row0: number;
  col0: number;
  row1: number;
  col1: number;
  u: number; // fraction along X within the cell
  v: number; // fraction along Z within the cell
}

const loc: CellLocation = { row0: 0, col0: 0, row1: 0, col1: 0, u: 0, v: 0 };

function locate(grid: SampleableHeightfield, x: number, z: number): CellLocation {
  const colF = grid.scaleX > 0 ? ((x - grid.originX) / grid.scaleX) * grid.cols : 0;
  const rowF = grid.scaleZ > 0 ? ((z - grid.originZ) / grid.scaleZ) * grid.rows : 0;
  const colC = Number.isNaN(colF) ? 0 : Math.min(Math.max(colF, 0), grid.cols);
  const rowC = Number.isNaN(rowF) ? 0 : Math.min(Math.max(rowF, 0), grid.rows);
  loc.col0 = Math.min(Math.floor(colC), grid.cols - 1);
  loc.row0 = Math.min(Math.floor(rowC), grid.rows - 1);
  loc.col1 = loc.col0 + 1;
  loc.row1 = loc.row0 + 1;
  loc.u = colC - loc.col0;
  loc.v = rowC - loc.row0;
  return loc;
}

/** Height and per-axis gradient (dh/dx, dh/dz) of the triangle containing the located point. */
function triangle(
  grid: SampleableHeightfield,
  l: CellLocation,
  diagonal: TerrainDiagonal,
  grad: { gx: number; gz: number } | null,
): number {
  const h = grid.heights;
  const stride = grid.rows + 1;
  const h00 = h[l.row0 + l.col0 * stride];
  const h01 = h[l.row0 + l.col1 * stride]; // +X
  const h10 = h[l.row1 + l.col0 * stride]; // +Z
  const h11 = h[l.row1 + l.col1 * stride];
  const cx = grid.scaleX / grid.cols;
  const cz = grid.scaleZ / grid.rows;
  const { u, v } = l;
  let dU: number;
  let dV: number;
  let base: number;
  if (diagonal === "row0col0-row1col1") {
    if (u >= v) {
      base = h00;
      dU = h01 - h00;
      dV = h11 - h01;
    } else {
      base = h00;
      dU = h11 - h10;
      dV = h10 - h00;
    }
  } else if (u + v <= 1) {
    base = h00;
    dU = h01 - h00;
    dV = h10 - h00;
  } else {
    // triangle 11, 01, 10 anchored at h11: h = h11 + (h10-h11)(1-u) + (h01-h11)(1-v)
    base = h10 + h01 - h11;
    dU = h11 - h10;
    dV = h11 - h01;
  }
  if (grad) {
    grad.gx = dU / cx;
    grad.gz = dV / cz;
  }
  return base + dU * u + dV * v;
}

export function sampleTerrainHeightWithDiagonal(
  grid: SampleableHeightfield,
  x: number,
  z: number,
  diagonal: TerrainDiagonal,
): number {
  return triangle(grid, locate(grid, x, z), diagonal, null);
}

export function sampleTerrainHeight(grid: SampleableHeightfield, x: number, z: number): number {
  return triangle(grid, locate(grid, x, z), TERRAIN_DIAGONAL, null);
}

const gradScratch = { gx: 0, gz: 0 };

/** Unit face normal of the triangle containing (x, z). Writes into `out`. */
export function terrainTriangleNormal(
  grid: SampleableHeightfield,
  x: number,
  z: number,
  out: TerrainVec3,
): TerrainVec3 {
  triangle(grid, locate(grid, x, z), TERRAIN_DIAGONAL, gradScratch);
  const inv = 1 / Math.hypot(gradScratch.gx, 1, gradScratch.gz);
  out.x = -gradScratch.gx * inv;
  out.y = inv;
  out.z = -gradScratch.gz * inv;
  return out;
}

/** Unit vertex normal by central differences (one-sided at borders). */
export function terrainVertexNormal(
  grid: SampleableHeightfield,
  row: number,
  col: number,
  out: TerrainVec3,
): TerrainVec3 {
  const stride = grid.rows + 1;
  const cx = grid.scaleX / grid.cols;
  const cz = grid.scaleZ / grid.rows;
  const cL = Math.max(col - 1, 0);
  const cR = Math.min(col + 1, grid.cols);
  const rL = Math.max(row - 1, 0);
  const rR = Math.min(row + 1, grid.rows);
  const gx = (grid.heights[row + cR * stride] - grid.heights[row + cL * stride]) / ((cR - cL) * cx);
  const gz = (grid.heights[rR + col * stride] - grid.heights[rL + col * stride]) / ((rR - rL) * cz);
  const inv = 1 / Math.hypot(gx, 1, gz);
  out.x = -gx * inv;
  out.y = inv;
  out.z = -gz * inv;
  return out;
}

/**
 * Uniform Catmull-Rom between p1 and p2, clamped to [min(p1,p2), max(p1,p2)]
 * (WR-04). The clamp removes the cubic's overshoot where curvature changes,
 * e.g. a levelled road band next to a rising shoulder (0, 0, 0, h) would dip
 * to -h/16 mid-cell; clamped it stays exactly flat. Linear data lies inside
 * the bounds and is still reproduced exactly; smooth slopes are unchanged.
 */
function catmullRom(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const t2 = t * t;
  const t3 = t2 * t;
  const v =
    0.5 *
    (2 * p1 +
      (-p0 + p2) * t +
      (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 +
      (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
  // Where the pair sits in a straight (collinear) run of three samples, i.e. a
  // levelled road band (flat or on a constant grade), use the straight line:
  // the cubic would bend toward the next sample and dip or ridge the road.
  // Elsewhere (crests, smooth hills) the cubic is kept so the driven feel the
  // gate signed off does not change.
  if (
    Math.abs(p0 - 2 * p1 + p2) <= LINEAR_RUN_EPS_M ||
    Math.abs(p1 - 2 * p2 + p3) <= LINEAR_RUN_EPS_M
  ) {
    return p1 + (p2 - p1) * t;
  }
  return v;
}

/** Second difference (m) below which three samples count as a straight run (Float32 noise). */
const LINEAR_RUN_EPS_M = 1e-4;

/**
 * Doubles resolution with uniform Catmull-Rom (clamped edges, overshoot
 * clamped to the bracketing samples) in both axes. Original vertices are
 * preserved exactly; linear data is reproduced; flat levelled bands stay flat.
 */
export function upsampleTerrainGrid(grid: TerrainGrid, factor: 2): TerrainGrid {
  const out = createTerrainGrid({
    rows: grid.rows * factor,
    cols: grid.cols * factor,
    cellSizeM: grid.cellSizeM / factor,
    originX: grid.originX,
    originZ: grid.originZ,
  });
  const stride = grid.rows + 1;
  const outStride = out.rows + 1;
  // Out-of-range neighbours are linearly extrapolated (ghost points) so edge
  // cells reproduce linear data exactly instead of flattening.
  const at = (r: number, c: number): number => {
    if (r < 0) return 2 * at(0, c) - at(1, c);
    if (r > grid.rows) return 2 * at(grid.rows, c) - at(grid.rows - 1, c);
    if (c < 0) return 2 * at(r, 0) - at(r, 1);
    if (c > grid.cols) return 2 * at(r, grid.cols) - at(r, grid.cols - 1);
    return grid.heights[r + c * stride];
  };
  // Interpolate along rows (Z) for a fixed integer column, then along columns.
  const rowInterp = (r: number, c: number, t: number): number =>
    catmullRom(at(r - 1, c), at(r, c), at(r + 1, c), at(r + 2, c), t);
  for (let orow = 0; orow <= out.rows; orow++) {
    const r = Math.floor(orow / factor);
    const tr = (orow - r * factor) / factor;
    for (let ocol = 0; ocol <= out.cols; ocol++) {
      const c = Math.floor(ocol / factor);
      const tc = (ocol - c * factor) / factor;
      let value: number;
      if (tr === 0 && tc === 0) {
        value = at(r, c);
      } else {
        value = catmullRom(
          rowInterp(r, c - 1, tr),
          rowInterp(r, c, tr),
          rowInterp(r, c + 1, tr),
          rowInterp(r, c + 2, tr),
          tc,
        );
      }
      out.heights[orow + ocol * outStride] = value;
    }
  }
  return out;
}
