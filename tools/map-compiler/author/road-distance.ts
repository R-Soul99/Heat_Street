/**
 * Answers "how far is `(x, z)` from the nearest road's PAVED EDGE?" — the
 * build-time query D-02b's off-road relief falloff is driven by (see
 * `04.1-RESEARCH.md`'s Common Pitfalls #3).
 *
 * Measuring from the road CENTRELINE instead of the paved edge would make
 * wide roads bleed relief onto their own shoulders: a query point sitting
 * exactly on a wide primary road's pavement is 0m from the paved edge but
 * several metres from the centreline, so a centreline-based falloff would
 * incorrectly start attenuating relief before the pavement even ends.
 * `src/core/road-geometry.ts`'s `computeEdgeRails` already solves the same
 * "centreline distance -> paved edge distance" problem for ribbon geometry
 * (subtracting `widthM / 2`); this module applies the identical subtraction
 * to a point-query rather than to rail vertices.
 *
 * Build-time only: this module is called once per off-road heightfield grid
 * point (`(resolution + 1)^2`, see `./heightfield.ts`) during compilation.
 * It is never called per frame and never imported from `src/`.
 *
 * Layering: pure build-time geometry — no filesystem, no network, no three,
 * no Rapier. Type-only import of `RoadGraph` from `src/core/road-graph.ts`.
 * NOT mechanically enforced — `tests/layering.test.ts` does not scan
 * `tools/**`; this file's own discipline is the only guard.
 */
// Explicit `.ts` extension, matching `./heightfield.ts`'s own convention:
// this module is executed by Node's native type-stripping, whose ESM
// resolver requires fully-specified relative specifiers for every module in
// the import graph. Do not "tidy" this back to extensionless.
import type { RoadGraph } from "../../../src/core/road-graph.ts";

/**
 * Clamped point-to-segment distance in the XZ plane: the distance from
 * `(x, z)` to the nearest point on the segment `(ax, az) -> (bx, bz)`,
 * projecting onto the segment and clamping the projection parameter to
 * `[0, 1]` so points beyond either endpoint measure to that endpoint
 * rather than to the segment's infinite line.
 *
 * A zero-length segment (`ax === bx && az === bz`, or numerically
 * indistinguishable from it) returns the plain point-to-point distance to
 * `(ax, az)` rather than `NaN` — dividing by a zero segment-length-squared
 * would otherwise produce an undefined projection parameter.
 */
export function pointToSegmentDistanceXZ(
  x: number,
  z: number,
  ax: number,
  az: number,
  bx: number,
  bz: number,
): number {
  const dx = bx - ax;
  const dz = bz - az;
  const lengthSq = dx * dx + dz * dz;

  if (lengthSq < 1e-12) {
    return Math.hypot(x - ax, z - az);
  }

  const tRaw = ((x - ax) * dx + (z - az) * dz) / lengthSq;
  const t = Math.min(Math.max(tRaw, 0), 1);
  const px = ax + t * dx;
  const pz = az + t * dz;
  return Math.hypot(x - px, z - pz);
}

export interface RoadDistanceField {
  /** Distance from `(x, z)` to the nearest road's paved edge, in metres, clamped at 0 (never negative, even for a query point on the pavement). */
  distanceToPavedEdgeM(x: number, z: number): number;
}

interface PreparedSegment {
  readonly ax: number;
  readonly az: number;
  readonly bx: number;
  readonly bz: number;
  readonly halfWidthM: number;
  readonly minX: number;
  readonly maxX: number;
  readonly minZ: number;
  readonly maxZ: number;
}

/**
 * Precomputes every edge's centreline segments (one per consecutive point
 * pair, so a multi-point polyline is measured against ALL its interior
 * segments, not just its two endpoints) into a flat array once, then
 * returns a `RoadDistanceField` whose `distanceToPavedEdgeM` queries that
 * array.
 *
 * `distanceToPavedEdgeM(x, z)` is
 * `Math.max(0, min over segments of (pointToSegmentDistanceXZ(...) - halfWidthM))`
 * — each segment inherits its own edge's `widthM / 2`, so two roads of
 * different widths at equal centreline distance from a query point resolve
 * to different paved-edge distances (the wider road's edge is closer).
 *
 * Performance guard (required — the caller runs this 16,641 times, once per
 * off-road heightfield grid point, over the compiled area's ~1,800
 * segments): each segment's bounding box is its own XZ extent expanded by
 * `halfWidthM` on every side. Before running the exact (but comparatively
 * expensive) `pointToSegmentDistanceXZ` projection, the loop cheaply rejects
 * any segment whose expanded box cannot possibly beat the current running
 * best, via
 * `Math.hypot(Math.max(0, minX - x, x - maxX), Math.max(0, minZ - z, z - maxZ)) - halfWidthM`.
 * This box-distance is always a conservative lower bound on that segment's
 * true `pointToSegmentDistanceXZ(...) - halfWidthM`, so the reject can never
 * skip a segment that could still improve the running best — proven by the
 * brute-force-equivalence test in this module's own test file, which
 * exercises a 20x20 sweep of query points and fails if the `- halfWidthM`
 * term is removed from this formula.
 *
 * Throws (rather than silently returning `Infinity` everywhere) if `graph`
 * yields zero segments — an empty distance field is a build-time
 * configuration error, not a runtime-degradable condition.
 */
export function buildRoadDistanceField(graph: RoadGraph): RoadDistanceField {
  const segments: PreparedSegment[] = [];

  for (const edge of graph.edges) {
    const halfWidthM = edge.widthM / 2;
    const { points } = edge;
    for (let i = 0; i < points.length - 1; i++) {
      const [ax, , az] = points[i];
      const [bx, , bz] = points[i + 1];
      segments.push({
        ax,
        az,
        bx,
        bz,
        halfWidthM,
        minX: Math.min(ax, bx) - halfWidthM,
        maxX: Math.max(ax, bx) + halfWidthM,
        minZ: Math.min(az, bz) - halfWidthM,
        maxZ: Math.max(az, bz) + halfWidthM,
      });
    }
  }

  if (segments.length === 0) {
    throw new Error("buildRoadDistanceField: graph has no road segments to measure against");
  }

  function distanceToPavedEdgeM(x: number, z: number): number {
    let best = Number.POSITIVE_INFINITY;
    for (const seg of segments) {
      const boxDist =
        Math.hypot(
          Math.max(0, seg.minX - x, x - seg.maxX),
          Math.max(0, seg.minZ - z, z - seg.maxZ),
        ) - seg.halfWidthM;
      if (boxDist >= best) {
        continue;
      }
      const dist = pointToSegmentDistanceXZ(x, z, seg.ax, seg.az, seg.bx, seg.bz) - seg.halfWidthM;
      if (dist < best) {
        best = dist;
      }
    }
    return Math.max(0, best);
  }

  return { distanceToPavedEdgeM };
}
