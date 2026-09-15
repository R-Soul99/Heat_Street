/**
 * DEM-derived off-road heightfield grid: a coarse, uniformly-`grass` terrain
 * safety net covering the compiled map's full `bounds`, sitting beneath the
 * road ribbons (04-RESEARCH.md Open Question 3, decision D-P28). Consumed by
 * `author/collision.ts` (the physics sidecar block) and `author/gltf.ts` (the
 * `terrain` render mesh) so both artifacts describe the exact same grid.
 *
 * `buildHeightfield` samples the DEM (via `sources/dem.ts`'s
 * `ElevationSampler`) on a regular `(resolution + 1) x (resolution + 1)`
 * lattice spanning the map's own `bounds` — the road network's actual footprint,
 * not the raw request bbox — converting each grid point's local ENU (x, z)
 * back to lat/lon with `graph/project.ts`'s `Projector.unproject` before
 * sampling. Every sampled height has `HEIGHTFIELD_SINK_M` subtracted (D-P29):
 * the road ribbons are built from SMOOTHED elevation while this grid samples
 * the RAW DEM, so the two can disagree by tens of centimetres, and sinking the
 * ground guarantees a road ribbon always wins the contact where the two
 * coincide.
 *
 * Grid orientation and storage order, VERIFIED EMPIRICALLY against the
 * installed `@dimforge/rapier3d@0.20.0` build (04-10-PLAN.md's own
 * `<action>` instruction: "do not guess"). The `.d.ts` declarations alone are
 * ambiguous about which axis is "row" vs "column" and which varies fastest in
 * the column-major `heights` buffer, so this was resolved with a throwaway
 * Rapier world: a 2x2-sample heightfield (`nrows=1, ncols=1`) with a single
 * elevated corner, raycast straight down at each of the four world corners to
 * see which one read back elevated. Two findings, both baked into this
 * module's index math below:
 *
 *   1. Storage order is `heights[row + col * (nrows + 1)]` — ROW is the
 *      faster-varying index (matches the `.d.ts`'s "column-major" label: a
 *      "column" of the matrix is contiguous in memory, i.e. varying row
 *      first). `nrows=1, ncols=1` (4 samples) with elevation at index 0 read
 *      back at local `(x=-5, z=-10)` (the `col=0,row=0` corner); index 1 read
 *      back at `(x=-5, z=+10)` (`row` incremented, `x` unchanged, `z` moved to
 *      its OTHER extreme); index 2 read back at `(x=+5, z=-10)` (`col`
 *      incremented, `z` back to its first extreme, `x` moved to its other
 *      extreme). That fixes ROW to the Z axis and COLUMN to the X axis.
 *   2. Height values are used LITERALLY, not internally centred by Rapier —
 *      a second probe (heights `[1000, 900, 900, 900]`, `scale.y = 1`, body
 *      translated off-origin) read back exactly `1000`/`900` at world Y,
 *      matching the raw array values with zero offset. `scale.y` is a plain
 *      multiplier (kept at `1.0` here so a stored height IS its real-world
 *      metre value), and the body's own Y translation is added on top with no
 *      "mid-height" correction needed — `src/physics/map-scene.ts` (Task 2)
 *      relies on this and translates its heightfield body's Y to exactly `0`.
 *
 * Layering: pure data transform — no `node:fs`, no network, no `three`, no
 * Rapier (Rapier objects are constructed at runtime by
 * `src/physics/map-scene.ts`, never here, mirroring `author/collision.ts`'s
 * own "compiler has no business importing a physics engine" discipline). NOT
 * mechanically enforced — `tests/layering.test.ts` does not scan `tools/**`;
 * this file's own discipline is the only guard.
 */
import type { RoadGraphBounds } from "../../../src/core/road-graph.ts";
import type { Projector } from "../graph/project.ts";
import type { ElevationSampler } from "../sources/dem.ts";

/**
 * Cells per axis (129x129 samples). [ASSUMED] first-pass value for the plan
 * 04-11 feel session, per D-P29: over Juliette, GA's ~2.9km box this is about
 * 23m spacing — coarse and deliberately so, since this grid is a safety net
 * and a visual backdrop, not a driving surface.
 */
export const HEIGHTFIELD_RESOLUTION = 128;

// [confirmed unchanged in plan 04-11's session] Driven and evaluated: the
// floating-road/falling-off-and-stuck finding this plan's Task 2 fixed was
// traced to this grid's coarseness combined with HEIGHTFIELD_SINK_M below —
// but raising resolution to meaningfully shrink the disagreement (e.g. to
// ~512, matching sources/dem.ts's own DEM_MAX_SIZE_PX) would grow the
// terrain mesh alone to ~524,288 triangles, over 10x the entire compiled-map
// triangle budget (docs/frame-budget.md, currently ~45,000 total, of which
// this 128-res grid already accounts for 32,768 — the single largest
// contributor). The fix landed instead as `src/core/road-geometry.ts`'s
// `buildRoadShoulders`: a per-edge ramp down to this SAME grid's own
// (bilinearly sampled) height, which closes the gap regardless of how coarse
// the background terrain stays. Left at 128 deliberately.

/**
 * Metres subtracted from every sampled height. [ASSUMED] first-pass value for
 * the plan 04-11 feel session, per D-P29: large enough to clear the observed
 * smoothed-vs-raw elevation disagreement between the road ribbons and the raw
 * DEM, small enough that the terrain never reads as visibly sunk beneath the
 * road it borders.
 *
 * Raised from D-P29's original 0.35m during this plan's own Task 2
 * verification: the real Juliette, GA map's road-network bounding box is
 * ~5.5km x 5.7km (D-P29's "~2.9km" was a pre-data estimate), giving a
 * 128-cell grid ~43m of spacing per cell rather than the ~23m assumed — on
 * this area's hilliest terrain (one edge already flagged over the
 * compiler's own gradient-sanity threshold, `cli.ts`'s printed "edges over
 * gradient threshold" line), a single coarse cell can span several metres of
 * real elevation change. An exhaustive raycast sweep of every point on every
 * real compiled road edge found a worst-case terrain-above-road disagreement
 * of ~3.95m; this constant carries a margin above that measured worst case,
 * per this plan's own `<action>` instruction ("raise HEIGHTFIELD_SINK_M and
 * recompile rather than loosening the assertion").
 */
export const HEIGHTFIELD_SINK_M = 5.0;

// [confirmed unchanged in plan 04-11's session] Left at 5.0m — see
// HEIGHTFIELD_RESOLUTION's own note just above. Lowering this would only
// re-risk terrain poking through the road at this grid's coarseness;
// `buildRoadShoulders` (src/core/road-geometry.ts) makes the sink's exact
// value a physics-invisible implementation detail at the road edge, since
// the shoulder ramp always closes down to the real sampled terrain height
// regardless of how far below the road it sits.

/**
 * The heightfield block this module produces, matching
 * `src/core/map-collision.ts`'s `MapCollisionHeightfield` field-for-field —
 * this IS that shape's producer, not a separate one `author/collision.ts`
 * has to convert.
 */
export interface HeightfieldGrid {
  /** Number of ROWS in the heights matrix (the Z axis) — `heights.length` is `(rows + 1) * (cols + 1)`. */
  readonly rows: number;
  /** Number of COLUMNS in the heights matrix (the X axis). */
  readonly cols: number;
  /** `heights[row + col * (rows + 1)]`, sunk by `sinkM`, in real-world metres — see this file's header comment for the verified storage order. */
  readonly heights: Float32Array;
  /** Local-ENU X of grid column 0 (`bounds.minX`). */
  readonly originX: number;
  /** Local-ENU Z of grid row 0 (`bounds.minZ`). */
  readonly originZ: number;
  /** Full X extent of the grid (`bounds.maxX - bounds.minX`). */
  readonly scaleX: number;
  /** Full Z extent of the grid (`bounds.maxZ - bounds.minZ`). */
  readonly scaleZ: number;
  /** The sink applied to every height, recorded rather than baked in silently (this file's own `<behavior>` requirement). */
  readonly sinkM: number;
}

/**
 * Samples `sampler` on a regular `(resolution + 1) x (resolution + 1)` grid
 * spanning `bounds` exactly — grid cell `(row=0, col=0)` sits at
 * `(bounds.minX, bounds.minZ)`, and `(row=resolution, col=resolution)` sits
 * at `(bounds.maxX, bounds.maxZ)`. Every sampled height has `HEIGHTFIELD_SINK_M`
 * subtracted.
 */
export function buildHeightfield(
  sampler: ElevationSampler,
  bounds: RoadGraphBounds,
  projector: Projector,
  resolution: number = HEIGHTFIELD_RESOLUTION,
): HeightfieldGrid {
  const samplesPerAxis = resolution + 1;
  const scaleX = bounds.maxX - bounds.minX;
  const scaleZ = bounds.maxZ - bounds.minZ;
  const heights = new Float32Array(samplesPerAxis * samplesPerAxis);

  for (let row = 0; row <= resolution; row++) {
    const z = bounds.minZ + (scaleZ * row) / resolution;
    for (let col = 0; col <= resolution; col++) {
      const x = bounds.minX + (scaleX * col) / resolution;
      const { lat, lon } = projector.unproject(x, z);
      const elevation = sampler.sample(lat, lon);
      heights[row + col * samplesPerAxis] = elevation - HEIGHTFIELD_SINK_M;
    }
  }

  return {
    rows: resolution,
    cols: resolution,
    heights,
    originX: bounds.minX,
    originZ: bounds.minZ,
    scaleX,
    scaleZ,
    sinkM: HEIGHTFIELD_SINK_M,
  };
}

/** Local-ENU X of grid column `col`, per `grid`'s own `originX`/`scaleX`/`cols`. */
export function heightfieldX(grid: HeightfieldGrid, col: number): number {
  return grid.originX + (grid.scaleX * col) / grid.cols;
}

/** Local-ENU Z of grid row `row`, per `grid`'s own `originZ`/`scaleZ`/`rows`. */
export function heightfieldZ(grid: HeightfieldGrid, row: number): number {
  return grid.originZ + (grid.scaleZ * row) / grid.rows;
}

/** The (already-sunk) height at `(row, col)`, per this file's verified `heights[row + col * (rows + 1)]` storage order. */
export function heightfieldHeightAt(grid: HeightfieldGrid, row: number, col: number): number {
  return grid.heights[row + col * (grid.rows + 1)];
}
