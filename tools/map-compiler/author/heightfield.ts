/**
 * Off-road terrain heightfield grid: a small, capped, deterministic
 * procedural relief that gives off-road terrain visual texture without
 * reintroducing a road-to-terrain height mismatch (D-02, D-02a, D-02b, D-03
 * — phase 04.1, `04.1-CONTEXT.md`). Consumed by `author/collision.ts` (the
 * physics sidecar block) and `author/gltf.ts` (the `terrain` render mesh)
 * so both artifacts describe the exact same grid.
 *
 * `buildOffRoadRelief` samples a pure function of local-ENU `(x, z)` on a
 * regular `(resolution + 1) x (resolution + 1)` lattice spanning the map's
 * own `bounds` — the road network's actual footprint, not a raw request
 * bbox. Each sample is `reliefAt(x, z, distanceToPavedEdgeM) -
 * HEIGHTFIELD_SINK_M`: a seeded value-noise term shaped by a falloff that
 * reaches exactly 0 at every road's paved edge (D-02b), then sunk by a small
 * physics-contact margin (see `HEIGHTFIELD_SINK_M`'s own doc comment below
 * for why that margin still exists even though the elevation-disagreement
 * problem it originally bridged is gone).
 *
 * REPLACED (phase 04.1): this module previously sampled a real DEM raster
 * (the old elevation-sampler interface) via a lat/lon coordinate-projector
 * round-trip. That entire pipeline — network fetch, GeoTIFF parse, lat/lon
 * projection — is deleted; `buildOffRoadRelief` takes no bytes from any
 * network or file and is a pure function of `(x, z)` and a hard-coded seed
 * (`RELIEF_SEED`). See `04.1-RESEARCH.md`'s Summary and Pattern 2.
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
// Explicit `.ts` extension, matching `./road-distance.ts`'s own convention:
// this module is executed by Node's native type-stripping, whose ESM
// resolver requires fully-specified relative specifiers for every module in
// the import graph. Do not "tidy" this back to extensionless.
import type { RoadGraph, RoadGraphBounds } from "../../../src/core/road-graph.ts";
import { buildRoadDistanceField } from "./road-distance.ts";

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
// ~512, matching the old DEM module's own DEM_MAX_SIZE_PX) would grow the
// terrain mesh alone to ~524,288 triangles, over 10x the entire compiled-map
// triangle budget (docs/frame-budget.md, currently ~45,000 total, of which
// this 128-res grid already accounts for 32,768 — the single largest
// contributor). The fix landed instead as `src/core/road-geometry.ts`'s
// `buildRoadShoulders`: a per-edge ramp down to this SAME grid's own
// (bilinearly sampled) height, which closes the gap regardless of how coarse
// the background terrain stays. Left at 128 deliberately.
//
// [phase 04.1] Still left at 128: nothing about the elevation-source change
// affects the triangle-budget argument above, and the new relief generator's
// own falloff distance (RELIEF_FALLOFF_DISTANCE_M below) is explicitly tuned
// AROUND this resolution's ~43m grid spacing, not the other way around.

/**
 * D-02a's locked cap on off-road relief amplitude, in metres — the maximum
 * a grid sample can be pushed away from its sunk baseline by `reliefAt`.
 * Chosen by the developer over a +/-5m alternative as "noticeably subtler"
 * (both were explicitly offered during the phase 04.1 discussion — see
 * `04.1-CONTEXT.md` D-02a).
 *
 * Bracketing failure modes: raising this steepens every shoulder ramp built
 * against this grid's residual near-road relief (see
 * `src/core/road-geometry.ts`'s `TARGET_SHOULDER_WIDTH_M` comment, the other
 * half of this same argument) and works directly against phase 04.1's whole
 * purpose (killing the "ridiculous... extra road width" defect); lowering it
 * toward 0 makes off-road terrain read as the featureless flat plane D-02
 * explicitly rejected in favour of visible texture.
 *
 * [ASSUMED] — flagged for re-judging in plan 04.1-10's D-06
 * drive-every-road session, per this file's own established convention for
 * this kind of reasoned-default constant.
 */
export const RELIEF_AMPLITUDE_M = 2;

/**
 * Distance, in metres, from a road's PAVED EDGE (not centreline — see
 * `./road-distance.ts`'s own header comment on why the paved edge is the
 * correct reference point, and `04.1-RESEARCH.md`'s Common Pitfalls #3) over
 * which `reliefAt`'s smoothstep falloff ramps from 0 up to full
 * `RELIEF_AMPLITUDE_M`.
 *
 * DEVIATION FROM `04.1-RESEARCH.md`'s Assumption A3, recorded here with its
 * reason: A3 proposed a falloff distance no larger than the (new, shrunk)
 * shoulder width — a few metres — reasoning that D-02b's "fades to exactly 0
 * by the paved edge" guarantee should hold at the point the paved edge
 * itself sits. That distance is unrepresentable on THIS grid: at
 * `HEIGHTFIELD_RESOLUTION` = 128 over Juliette, GA's real ~5504m x 5657m
 * compiled bounds, grid spacing is ~43m per cell, so a sub-cell falloff
 * distance is invisible after the grid is baked and bilinearly resampled —
 * the terrain adjacent to a road would then carry near-full amplitude
 * anyway, because nothing samples the true zero-crossing between the
 * nearest grid node and the road.
 *
 * 130m (~3 grid cells) is chosen instead so the falloff's shape is actually
 * representable, while D-02b's literal guarantee ("exactly 0 at the paved
 * edge") still holds A FORTIORI: the nearest grid node to any road sits at
 * most ~30m from the paved edge (roughly the ~43m cell spacing, worst case),
 * carrying only `RELIEF_AMPLITUDE_M * smoothstep(30 / 130)` =
 * `2 * smoothstep(0.2308)` ~= 0.27m of relief. Adding `HEIGHTFIELD_SINK_M`
 * (0.1m) gives a worst-case flat-terrain shoulder height delta of ~0.37m —
 * see `src/core/road-geometry.ts`'s `TARGET_SHOULDER_WIDTH_M` comment for the
 * resulting shoulder-grade arithmetic, the other half of this same argument.
 *
 * Hard invariant, enforced by this file's own test suite: this constant must
 * stay at least 3x the grid spacing (`max(scaleX, scaleZ) / resolution`), or
 * the falloff shape degenerates back into the unrepresentable sub-cell case
 * A3 originally (incorrectly, for this grid) assumed.
 *
 * [ASSUMED] — flagged for re-judging in plan 04.1-10's D-06 session.
 */
export const RELIEF_FALLOFF_DISTANCE_M = 130;

/**
 * Fixed seed for `reliefAt`'s value-noise lattice hash. A recompile with the
 * same road graph and bounds must be byte-identical (D-03, RESEARCH.md's
 * T-04.1-09 reproducibility mitigation) — JavaScript's non-seedable default
 * PRNG (the one every JS engine ships as a built-in global) is forbidden
 * here for exactly that reason, and its call syntax is grepped for in this
 * plan's own acceptance criteria.
 */
export const RELIEF_SEED = 20260919;

/**
 * Wavelength, in metres, of the finer of `reliefAt`'s two noise octaves.
 * Must stay well above `HEIGHTFIELD_RESOLUTION`'s ~43m grid spacing or the
 * noise aliases into per-cell jitter (a visibly blocky/pixelated grid)
 * rather than reading as smooth rolling ground.
 */
export const RELIEF_FEATURE_SIZE_M = 220;

/**
 * Wavelength, in metres, of the coarser of `reliefAt`'s two noise octaves —
 * the dominant term (see `reliefAt`'s 0.65/0.35 octave weighting), giving
 * off-road terrain broad, slow undulation rather than uniform-scale static.
 * Same grid-spacing requirement as `RELIEF_FEATURE_SIZE_M` above.
 */
export const RELIEF_COARSE_FEATURE_SIZE_M = 500;

/**
 * Metres subtracted from every sampled relief height.
 *
 * REVISION HISTORY (kept as history, not deleted, per this file's own
 * convention):
 *   - D-P29's original 0.35m first-pass value (plan 04-10).
 *   - Raised to 4.5m across plan 04-11's Task 2 and feel session: on the OLD
 *     DEM-sampled grid this constant bridged a real disagreement between the
 *     smoothed road-ribbon elevation and the raw DEM off-road grid — large
 *     enough to clear a measured worst-case ~3.95m disagreement (later
 *     3.28m post-densification), with a margin, small enough not to read as
 *     visibly sunk.
 *
 * PHASE 04.1: the constant's JOB has changed, not just its value. There is
 * no DEM anymore, so there is no smoothed-vs-raw elevation disagreement left
 * to bridge — D-01 (roads flat at y=0) and D-02b (relief fades to exactly 0
 * at the paved edge) jointly guarantee that gap is ~0m by construction (see
 * `RELIEF_FALLOFF_DISTANCE_M`'s own comment for the exact residual
 * arithmetic). This constant is now PURELY a physics-contact separation
 * margin: two coincident (exactly-touching, zero-gap) static Rapier
 * colliders — the road ribbon at y=0 and this heightfield grid, both
 * approaching y=0 near a road — can produce contact-solver jitter/z-fighting
 * at the boundary (`04.1-RESEARCH.md`'s Common Pitfall #4), a physics-engine
 * failure mode distinct from the "visible elevation gap" problem this phase
 * exists to fix. 0 is deliberately NOT used for exactly that reason.
 *
 * 0.1m is a reasoned, deliberately small starting value — comfortably
 * outside typical contact-solver slop margins without being large enough to
 * read as a visible sunk-terrain seam. [ASSUMED] pending plan 04.1-10's D-06
 * drive-every-road re-verification session, matching this constant's own
 * established retune-empirically history above.
 */
export const HEIGHTFIELD_SINK_M = 0.1;

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
 * Deterministic integer-mixing hash of a lattice coordinate, returning a
 * value in `[0, 1)`. Uses `Math.imul`/xor/unsigned-shift bit mixing rather
 * than a `Math.sin`-based hash — `Math.sin` is NOT guaranteed bit-identical
 * across JS engines/architectures at the precision this needs, which would
 * break the byte-identical-recompile guarantee (D-03, RESEARCH.md's
 * T-04.1-09). Integer arithmetic (`Math.imul`, `^`, `>>>`) is exact and
 * portable.
 */
function hashLattice2D(ix: number, iz: number, seed: number): number {
  let h = Math.imul(ix, 374761393);
  h = (h ^ Math.imul(iz, 668265263)) | 0;
  h = (h ^ Math.imul(seed, 2147483647)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h = (h ^ (h >>> 16)) >>> 0;
  return h / 4294967296;
}

/** Smoothstep: C1-continuous (zero derivative at both ends) ease curve, `t` clamped to `[0, 1]`. */
function smoothstep(t: number): number {
  return t * t * (3 - 2 * t);
}

/**
 * Classic lattice value noise at world position `(x, z)`: floors to lattice
 * coordinates spaced `featureSizeM` apart, hashes the four surrounding
 * corners, smoothsteps the fractional position, and bilinearly blends.
 * Returns a value in `[-1, 1]`.
 */
function valueNoise2D(x: number, z: number, featureSizeM: number, seed: number): number {
  const gx = x / featureSizeM;
  const gz = z / featureSizeM;
  const ix0 = Math.floor(gx);
  const iz0 = Math.floor(gz);
  const fx = gx - ix0;
  const fz = gz - iz0;

  const h00 = hashLattice2D(ix0, iz0, seed);
  const h10 = hashLattice2D(ix0 + 1, iz0, seed);
  const h01 = hashLattice2D(ix0, iz0 + 1, seed);
  const h11 = hashLattice2D(ix0 + 1, iz0 + 1, seed);

  const sx = smoothstep(fx);
  const sz = smoothstep(fz);

  const top = h00 + (h10 - h00) * sx;
  const bottom = h01 + (h11 - h01) * sx;
  const blended = top + (bottom - top) * sz; // [0, 1)

  return blended * 2 - 1; // [-1, 1]
}

/**
 * Off-road relief at world position `(x, z)`, given its precomputed distance
 * to the nearest road's paved edge (see `./road-distance.ts`).
 *
 * Blends two value-noise octaves (`RELIEF_COARSE_FEATURE_SIZE_M` at weight
 * 0.65, `RELIEF_FEATURE_SIZE_M` at weight 0.35 — weights sum to 1, so the
 * combined term stays within `[-1, 1]`), then multiplies by a smoothstep
 * falloff that is 0 at `distanceToPavedEdgeM <= 0` and reaches 1 at
 * `RELIEF_FALLOFF_DISTANCE_M`, then scales by `RELIEF_AMPLITUDE_M`.
 *
 * Hard guarantees (D-02a, D-02b), both enforced by this file's test suite:
 *   - Returns exactly `0` (positive zero, not `-0`) when
 *     `distanceToPavedEdgeM <= 0` — the falloff term itself is exactly 0
 *     there (`t` clamps to 0), and this function special-cases that to
 *     return the literal `0` rather than the product, because IEEE-754
 *     `0 * negative` produces `-0`, which is numerically equal but would
 *     fail a strict `Object.is`/`toBe(0)` equality check in this file's own
 *     test suite.
 *   - `Math.abs(reliefAt(...)) <= RELIEF_AMPLITUDE_M` always — the noise
 *     term is bounded to `[-1, 1]` by construction and the falloff term is
 *     bounded to `[0, 1]`, so the product can never exceed the amplitude.
 */
export function reliefAt(x: number, z: number, distanceToPavedEdgeM: number): number {
  const t = Math.min(1, Math.max(0, distanceToPavedEdgeM / RELIEF_FALLOFF_DISTANCE_M));
  const falloff = smoothstep(t);
  if (falloff === 0) {
    return 0;
  }
  const noise =
    0.65 * valueNoise2D(x, z, RELIEF_COARSE_FEATURE_SIZE_M, RELIEF_SEED) +
    0.35 * valueNoise2D(x, z, RELIEF_FEATURE_SIZE_M, RELIEF_SEED + 1);
  return noise * RELIEF_AMPLITUDE_M * falloff;
}

/**
 * Builds the off-road relief grid: samples `reliefAt` (shaped by
 * `buildRoadDistanceField`'s paved-edge distance query) on a regular
 * `(resolution + 1) x (resolution + 1)` lattice spanning `bounds` exactly —
 * grid cell `(row=0, col=0)` sits at `(bounds.minX, bounds.minZ)`, and
 * `(row=resolution, col=resolution)` sits at `(bounds.maxX, bounds.maxZ)`.
 * Every sampled height has `HEIGHTFIELD_SINK_M` subtracted. Replaces the
 * former DEM-sampled `buildHeightfield` — same grid SHAPE and storage order
 * (this file's own header comment), pure seeded noise instead of a real
 * elevation raster.
 */
export function buildOffRoadRelief(
  graph: RoadGraph,
  bounds: RoadGraphBounds,
  resolution: number = HEIGHTFIELD_RESOLUTION,
): HeightfieldGrid {
  const samplesPerAxis = resolution + 1;
  const scaleX = bounds.maxX - bounds.minX;
  const scaleZ = bounds.maxZ - bounds.minZ;
  const heights = new Float32Array(samplesPerAxis * samplesPerAxis);
  const roadDistance = buildRoadDistanceField(graph);

  for (let row = 0; row <= resolution; row++) {
    const z = bounds.minZ + (scaleZ * row) / resolution;
    for (let col = 0; col <= resolution; col++) {
      const x = bounds.minX + (scaleX * col) / resolution;
      const distanceToPavedEdgeM = roadDistance.distanceToPavedEdgeM(x, z);
      heights[row + col * samplesPerAxis] =
        reliefAt(x, z, distanceToPavedEdgeM) - HEIGHTFIELD_SINK_M;
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
