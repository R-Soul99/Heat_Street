/**
 * D-04b's authored "launch over the hill" terrain: a small, hand-picked,
 * explicitly-provenanced set of off-road terrain crests, plus the dome
 * builder that turns each into triangle geometry.
 *
 * Phase 4.1's D-01 makes roads flat everywhere with NO exception — a crest
 * is therefore always an OFF-ROAD feature and never expressed as a y-override
 * on a paved road point. Crests also cannot be baked into the compiled
 * off-road heightfield: that grid is `HEIGHTFIELD_RESOLUTION` (128) cells
 * over the compiled area's ~5.5km bounds, i.e. roughly 43m of spacing per
 * cell (see `tools/map-compiler/author/heightfield.ts`), which physically
 * cannot represent a 28-45m-radius crest at all, let alone the apex
 * curvature a launch depends on reading as smooth. Crests ship as their own
 * trimesh instead, exactly the way `road-geometry.ts`'s `buildRoadShoulders`
 * already ships a shoulder ramp as its own trimesh rather than folding it
 * into the heightfield.
 *
 * This module is consumed by BOTH `tools/map-compiler/cli.ts` (baked into
 * the compiled `.glb`) and `src/physics/map-scene.ts` (built into the
 * runtime trimesh colliders) — the same "one algorithm, two consumers"
 * pattern ADR 0004 decision 5 records for road geometry, and the reason this
 * module lives in `src/core/` rather than under `tools/map-compiler/`.
 *
 * Layering: pure geometry, the same layer as `road-geometry.ts`. No three,
 * no Rapier, no DOM, no filesystem, no network.
 * `tests/layering.test.ts` mechanically enforces this for every file under
 * `src/core/`.
 */
// Explicit `.ts` extension, matching `road-geometry.ts`'s own convention:
// `tools/map-compiler/**` imports this module directly and is executed by
// Node's native type-stripping, whose ESM resolver requires fully-specified
// relative specifiers for every module in the import graph, not just the
// entry file. Do not "tidy" this back to extensionless.
import type { SurfaceType } from "./surface-types.ts";

/**
 * One hand-authored terrain crest: an off-road dome a car can launch off,
 * never touching a paved road (see this module's header for why).
 */
export interface AuthoredCrest {
  /** Stable, human-readable id — also the string this module's thrown errors name the offending entry by. */
  readonly id: string;
  /** Local-ENU X (metres) of the dome's apex. */
  readonly centerX: number;
  /** Local-ENU Z (metres) of the dome's apex. */
  readonly centerZ: number;
  /** The radius at which the dome reaches exactly zero height above the terrain. */
  readonly radiusM: number;
  /** Apex height above the sampled terrain at the centre. */
  readonly heightM: number;
}

/**
 * Juliette, GA's three authored crests.
 *
 * [MEASURED from `public/maps/juliette-ga.map.json` + `juliette-ga.collision.json`
 * during phase 04.1 planning, 2026-09-19, BEFORE the DEM-era artifact was
 * overwritten by this phase's flat-terrain recompile — this data cannot be
 * re-derived after the recompile, so `04.1-03-PLAN.md`'s own
 * `<crest_source_data>` block is the only remaining provenance for every
 * entry below.]
 *
 * [ASSUMED] Tagged per this repo's documented-constant convention (see
 * `road-geometry.ts`'s `TARGET_SHOULDER_WIDTH_M` for the same pattern): the
 * whole table is a reasoned first pass, flagged for re-judging in plan
 * 04.1-10's D-06 human drive-every-road re-verification session.
 *
 * Grade/launch-speed arithmetic (recorded here, not just in the source
 * plan, so a reader never has to leave this file to understand the table):
 * for the radial dome profile `crestProfileHeight` builds below, peak slope
 * occurs at half-radius and equals `1.5 * heightM / radiusM`; apex vertical
 * curvature is `6 * heightM / radiusM^2`; a car leaves the ground at the
 * apex once its speed exceeds `sqrt(9.81 * radiusM^2 / (6 * heightM))`
 * (curvature `k` needs `v^2 * k >= g`, i.e. `v >= sqrt(g / k)`).
 *
 * | id                          | centerX | centerZ | radiusM | heightM | clearance to paved edge | peak grade                  | apex launch speed |
 * |------------------------------|---------|---------|---------|---------|--------------------------|------------------------------|--------------------|
 * | juliette-north-ridge         | -779.7  | 263.2   | 45      | 9       | 51.5 - 45 = 6.5m         | 1.5*9/45 = 0.300 (16.7 deg)  | ~19.2 m/s (43 mph) |
 * | juliette-main-street-rise    | -420.0  | 102.2   | 30      | 5       | 36.5 - 30 = 6.5m         | 1.5*5/30 = 0.250 (14.0 deg)  | ~17.2 m/s (38 mph) |
 * | juliette-south-approach      | -1227.2 | -1062.3 | 28      | 6       | 36.5 - 28 = 8.5m         | 1.5*6/28 = 0.321 (17.8 deg)  | ~14.6 m/s (33 mph) |
 *
 * Why keyed by area at all (see `AUTHORED_CRESTS_BY_AREA`/`crestsForArea`
 * below): these coordinates are Juliette-specific local-ENU metres, derived
 * from Juliette's own real DEM-era compiled geometry — they would be
 * nonsense (wrong terrain entirely) in any other area. A second area must
 * author its own entry rather than silently inheriting these.
 */
export const JULIETTE_GA_CRESTS: readonly AuthoredCrest[] = [
  {
    // [VERIFIED: 04.1-03-PLAN.md <crest_source_data>, Candidate 1] edge
    // id=8, osmWayId=9397242, residential/tarmac, widthM 7, 811.9m/37
    // points. Real DEM local crest at point index 17, local
    // (x=-780.7, z=208.3), 15.05m above the endpoint-to-endpoint chord; road
    // normal ~(0.018, 1.000). Crest centre = that point offset +55m along
    // the normal: (-779.7, 263.2). Measured distance from centre to nearest
    // paved edge = 51.5m; to nearest building edge = 465.9m. The DEM-era
    // compiled map this was measured from is destroyed by this phase's flat
    // recompile — this comment plus the plan file are the only remaining
    // record.
    id: "juliette-north-ridge",
    centerX: -779.7,
    centerZ: 263.2,
    radiusM: 45,
    heightM: 9,
  },
  {
    // [VERIFIED: 04.1-03-PLAN.md <crest_source_data>, Candidate 2] edge
    // id=29, osmWayId=195682275, primary (the main road through town),
    // widthM 7. Real DEM local crest at point index 16, local
    // (x=-452.8, z=125.1), 5.70m above the chord; road normal
    // ~(0.820, -0.572). Crest centre = that point offset +40m:
    // (-420.0, 102.2). Measured distance from centre to nearest paved edge
    // = 36.5m; to nearest building edge = 285.4m.
    id: "juliette-main-street-rise",
    centerX: -420.0,
    centerZ: 102.2,
    radiusM: 30,
    heightM: 5,
  },
  {
    // [VERIFIED: 04.1-03-PLAN.md <crest_source_data>, Candidate 3] edge
    // id=34, osmWayId=195682275, primary, widthM 7. Real DEM local crest at
    // point index 11, local (x=-1260.1, z=-1039.6), 4.93m above the chord;
    // road normal ~(0.823, -0.568). Crest centre = that point offset +40m:
    // (-1227.2, -1062.3). Measured distance from centre to nearest paved
    // edge = 36.5m; to nearest building edge = 258.2m.
    id: "juliette-south-approach",
    centerX: -1227.2,
    centerZ: -1062.3,
    radiusM: 28,
    heightM: 6,
  },
];

/**
 * Every area's authored crest table, keyed by `AreaConfig.areaId`. See
 * `JULIETTE_GA_CRESTS`'s own doc comment for why this is keyed by area
 * rather than a single flat list — the coordinates are area-local and would
 * be meaningless (or worse, silently wrong) if applied to a different area.
 */
export const AUTHORED_CRESTS_BY_AREA: Readonly<Record<string, readonly AuthoredCrest[]>> = {
  "juliette-ga": JULIETTE_GA_CRESTS,
};

/**
 * Looks up `areaId`'s authored crest table, or `[]` for an unknown area.
 *
 * MUST use `Object.hasOwn` rather than a bare `AUTHORED_CRESTS_BY_AREA[areaId]`
 * index: a bare index on an attacker- or bug-influenced `areaId` string like
 * `"toString"` or `"constructor"` resolves to a function inherited from
 * `Object.prototype` instead of `undefined`, silently handing the caller a
 * function where it expects (and may iterate as) an array.
 */
export function crestsForArea(areaId: string): readonly AuthoredCrest[] {
  if (!Object.hasOwn(AUTHORED_CRESTS_BY_AREA, areaId)) {
    return [];
  }
  return AUTHORED_CRESTS_BY_AREA[areaId];
}

/**
 * Dome tessellation. Rings/segments control tessellation ONLY — they do not
 * change a crest's radius, height, or placement. 12 rings x 32 segments
 * gives ~768 triangles per crest (32 fan triangles + 2*32*11 quad-strip
 * triangles) and ~2,300 across all three JULIETTE_GA_CRESTS entries,
 * negligible against the ~45,000-triangle map budget in
 * `docs/frame-budget.md`, while keeping the apex smooth enough that a
 * launch reads as a rounded ramp rather than a faceted polyhedron.
 */
export const CREST_RINGS = 12;
export const CREST_SEGMENTS = 32;

/**
 * The radial dome height profile: one minus smoothstep, so
 * `crestProfileHeight(0, h) === h` (the apex) and
 * `crestProfileHeight(1, h) === 0` (the rim, exactly on the terrain). This
 * profile is C1-continuous at BOTH ends — zero slope at the apex (so the
 * dome's peak is rounded, not a spike) and zero slope at the rim (so the rim
 * meets the sampled terrain height with no visible seam or discontinuous
 * lip, the same reason a launch off it reads as a ramp rather than a step).
 */
export function crestProfileHeight(t: number, heightM: number): number {
  if (t <= 0) return heightM;
  if (t >= 1) return 0;
  return heightM * (1 - (3 * t * t - 2 * t * t * t));
}

/**
 * One crest's built dome geometry. Field-for-field parallel to
 * `road-geometry.ts`'s `ShoulderGeometryEntry`.
 */
export interface CrestGeometryEntry {
  readonly crestId: string;
  /** Always `"grass"` — crests are terrain, and D-07 leaves the road surface mapping untouched. */
  readonly surface: SurfaceType;
  readonly positions: Float32Array;
  readonly indices: Uint32Array;
}

function ringVertexIndex(ring: number, segment: number): number {
  // ring is 1-indexed (1..CREST_RINGS); apex occupies index 0.
  return 1 + (ring - 1) * CREST_SEGMENTS + segment;
}

/**
 * Builds a radial dome for each `crests` entry, sampling `heightSampler` at
 * every vertex so the dome always sits on top of whatever off-road terrain
 * exists there.
 *
 * Vertex 0 is the apex, at `(centerX, heightSampler(centerX, centerZ) + heightM, centerZ)`.
 * For ring `r` in `1..CREST_RINGS` and segment `s` in `0..CREST_SEGMENTS-1`:
 * `t = r / CREST_RINGS`, `radius = radiusM * t`,
 * `theta = (2 * Math.PI * s) / CREST_SEGMENTS`,
 * `x = centerX + radius * Math.cos(theta)`, `z = centerZ + radius * Math.sin(theta)`,
 * `y = heightSampler(x, z) + crestProfileHeight(t, heightM)`. The outermost
 * ring (`t === 1`) therefore lands EXACTLY on the sampled terrain height —
 * the same rim-seating technique `road-geometry.ts`'s `buildEdgeShoulder`
 * uses for its outer rail, and the reason a crest never produces a cliff at
 * its base.
 *
 * Winding is CCW viewed from +Y, matching every other surface in
 * `road-geometry.ts`. The naive triangle order produced by increasing
 * `theta` turns out clockwise from +Y (verified by direct cross-product
 * derivation against `tests/road-geometry.test.ts`'s own
 * `expectAllTrianglesCCW` convention), so both the apex fan and the
 * ring-to-ring quad strips below deliberately swap the second and third
 * index of every triangle relative to the naive order — vertex generation
 * itself (the `x`/`z`/`y` formulas above) is unchanged.
 */
export function buildCrestGeometry(
  crests: readonly AuthoredCrest[],
  heightSampler: (x: number, z: number) => number,
): readonly CrestGeometryEntry[] {
  const seenIds = new Set<string>();
  for (const crest of crests) {
    if (crest.radiusM <= 0) {
      throw new Error(`buildCrestGeometry: crest "${crest.id}" has radiusM <= 0`);
    }
    if (crest.heightM <= 0) {
      throw new Error(`buildCrestGeometry: crest "${crest.id}" has heightM <= 0`);
    }
    if (seenIds.has(crest.id)) {
      throw new Error(`buildCrestGeometry: duplicate crest id "${crest.id}"`);
    }
    seenIds.add(crest.id);
  }

  return crests.map((crest) => {
    const vertexCount = 1 + CREST_RINGS * CREST_SEGMENTS;
    const positions = new Float32Array(vertexCount * 3);

    // Vertex 0: the apex.
    positions[0] = crest.centerX;
    positions[1] = heightSampler(crest.centerX, crest.centerZ) + crest.heightM;
    positions[2] = crest.centerZ;

    for (let r = 1; r <= CREST_RINGS; r++) {
      const t = r / CREST_RINGS;
      const radius = crest.radiusM * t;
      for (let s = 0; s < CREST_SEGMENTS; s++) {
        const theta = (2 * Math.PI * s) / CREST_SEGMENTS;
        const x = crest.centerX + radius * Math.cos(theta);
        const z = crest.centerZ + radius * Math.sin(theta);
        const y = heightSampler(x, z) + crestProfileHeight(t, crest.heightM);
        const idx = ringVertexIndex(r, s) * 3;
        positions[idx] = x;
        positions[idx + 1] = y;
        positions[idx + 2] = z;
      }
    }

    // Triangle count: CREST_SEGMENTS fan triangles (apex -> ring 1) plus
    // 2 * CREST_SEGMENTS * (CREST_RINGS - 1) quad-strip triangles between
    // consecutive rings.
    const triangleCount = CREST_SEGMENTS + 2 * CREST_SEGMENTS * (CREST_RINGS - 1);
    const indices = new Uint32Array(triangleCount * 3);
    let outIdx = 0;

    // Fan: apex (0) to ring 1. Naive order (0, ring1[s], ring1[s+1]) winds
    // CW from +Y; swap the last two indices for CCW.
    for (let s = 0; s < CREST_SEGMENTS; s++) {
      const sNext = (s + 1) % CREST_SEGMENTS;
      indices[outIdx++] = 0;
      indices[outIdx++] = ringVertexIndex(1, sNext);
      indices[outIdx++] = ringVertexIndex(1, s);
    }

    // Quad strips between ring r and ring r+1, for r in 1..CREST_RINGS-1.
    // Each quad (innerS, innerS1, outerS, outerS1) splits into two
    // triangles; both are ordered (relative to the naive innerS/outerS/
    // innerS1 sweep) to wind CCW from +Y, verified by direct cross-product
    // derivation for this module.
    for (let r = 1; r < CREST_RINGS; r++) {
      for (let s = 0; s < CREST_SEGMENTS; s++) {
        const sNext = (s + 1) % CREST_SEGMENTS;
        const innerS = ringVertexIndex(r, s);
        const innerS1 = ringVertexIndex(r, sNext);
        const outerS = ringVertexIndex(r + 1, s);
        const outerS1 = ringVertexIndex(r + 1, sNext);

        indices[outIdx++] = innerS;
        indices[outIdx++] = innerS1;
        indices[outIdx++] = outerS;

        indices[outIdx++] = innerS1;
        indices[outIdx++] = outerS1;
        indices[outIdx++] = outerS;
      }
    }

    return {
      crestId: crest.id,
      surface: "grass" as SurfaceType,
      positions,
      indices,
    };
  });
}
