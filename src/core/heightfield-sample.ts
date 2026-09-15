/**
 * Bilinear sampling over a grid shaped like `tools/map-compiler/author/
 * heightfield.ts`'s `HeightfieldGrid` (compiler) or `map-collision.ts`'s
 * `MapCollisionHeightfield` (runtime, parsed sidecar) — both satisfy
 * `SampleableHeightfield` structurally, so this one function serves both
 * call sites and cannot drift between them (the same discipline
 * `road-geometry.ts`'s own module header documents for ribbon geometry).
 *
 * Storage order and axis convention are `heightfield.ts`'s own VERIFIED
 * findings, reused verbatim: `heights[row + col * (rows + 1)]`, row tracks Z,
 * col tracks X, values are literal metres.
 *
 * Layering: pure data transform, no fs/network/three/rapier — fits `src/core/`.
 */

/** The minimal shape both `HeightfieldGrid` and `MapCollisionHeightfield` satisfy. `ArrayLike<number>` covers both `Float32Array` and `readonly number[]`. */
export interface SampleableHeightfield {
  readonly rows: number;
  readonly cols: number;
  readonly heights: ArrayLike<number>;
  readonly originX: number;
  readonly originZ: number;
  readonly scaleX: number;
  readonly scaleZ: number;
}

function heightAt(grid: SampleableHeightfield, row: number, col: number): number {
  return grid.heights[row + col * (grid.rows + 1)];
}

/**
 * Bilinearly samples `grid` at world-space `(x, z)`, clamping the query point
 * to the grid's own bounds first — a road point slightly outside the grid's
 * footprint (possible at the very edge of `bounds`, from floating-point
 * accumulation) degrades to an edge-clamped sample rather than an out-of-range
 * index or a thrown error, matching this codebase's "a build defect must
 * surface loudly, a runtime geometry query degrades gracefully" split.
 */
export function sampleHeightfieldBilinear(
  grid: SampleableHeightfield,
  x: number,
  z: number,
): number {
  const colF = grid.scaleX > 0 ? ((x - grid.originX) / grid.scaleX) * grid.cols : 0;
  const rowF = grid.scaleZ > 0 ? ((z - grid.originZ) / grid.scaleZ) * grid.rows : 0;

  const colClamped = Math.min(Math.max(colF, 0), grid.cols);
  const rowClamped = Math.min(Math.max(rowF, 0), grid.rows);

  const col0 = Math.min(Math.floor(colClamped), grid.cols - 1 >= 0 ? grid.cols - 1 : 0);
  const row0 = Math.min(Math.floor(rowClamped), grid.rows - 1 >= 0 ? grid.rows - 1 : 0);
  const col1 = Math.min(col0 + 1, grid.cols);
  const row1 = Math.min(row0 + 1, grid.rows);

  const tCol = colClamped - col0;
  const tRow = rowClamped - row0;

  const h00 = heightAt(grid, row0, col0);
  const h01 = heightAt(grid, row0, col1);
  const h10 = heightAt(grid, row1, col0);
  const h11 = heightAt(grid, row1, col1);

  const hTop = h00 + (h01 - h00) * tCol;
  const hBottom = h10 + (h11 - h10) * tCol;
  return hTop + (hBottom - hTop) * tRow;
}
