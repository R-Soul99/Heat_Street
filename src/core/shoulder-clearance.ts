/**
 * Resolves a shoulder width, AT A SINGLE POINT, for `road-geometry.ts`'s
 * `buildRoadShoulders`, clamped so the ramp never reaches far enough to
 * physically clip through a nearby building.
 *
 * Plan 04-11's grounding fix originally shipped a flat `SHOULDER_WIDTH_M`
 * (6m) for every edge. Driven and measured against the real compiled area:
 * the off-road heightfield's sink makes the road-to-terrain gap close to
 * `HEIGHTFIELD_SINK_M` almost everywhere (average measured 5.09m, not a rare
 * worst case), so a flat 6m-wide ramp reads as a near-45-degree slope
 * everywhere — steep enough to roll the car, exactly the "ridiculous 45
 * degree slopes... climb back on (and if the car hasn't rolled, which
 * happens a lot)" finding. A much wider ramp fixes the angle, but the
 * nearest building on the real map sits only ~6.9m from its road's paved
 * edge — a flat wide shoulder would plough straight through it.
 *
 * A first version of this fix resolved one width per EDGE (checking every
 * point but collapsing to the single tightest constraint along the whole
 * edge) — re-driving found that dragged a road's ENTIRE shoulder down to a
 * close-building width even where most of that same road had plenty of
 * room, measuring up to ~65 degrees at the resolved minimum. This per-POINT
 * version fixes that: wide wherever there is room (most of the map — median
 * measured building setback is ~21.5m), narrower only exactly where a
 * building actually is.
 *
 * Layering: pure data transform over plain point coordinates and a plain
 * `{x, z, radiusM}` building list — no fs/network/three/rapier, fits
 * `src/core/`. Deliberately takes a MINIMAL structural building shape
 * (not `MapCollisionBuilding` directly) so callers can pass either the
 * compiler's own `BuildingBox`-derived data or the runtime's parsed
 * `MapCollisionBuilding[]` without either importing the other's type.
 */

export interface ClearanceBuilding {
  readonly centerX: number;
  readonly centerZ: number;
  /** A conservative bounding-CIRCLE radius around the building's footprint (never smaller than its true half-diagonal), so this module never under-estimates how much room a building actually occupies. */
  readonly radiusM: number;
}

/** `Math.hypot(halfExtents.x, halfExtents.z)` — the building's own bounding-circle radius, per `ClearanceBuilding.radiusM`'s own doc comment. */
export function buildingBoundingRadius(halfExtentX: number, halfExtentZ: number): number {
  return Math.hypot(halfExtentX, halfExtentZ);
}

/**
 * The widest shoulder a road point at `(x, z)`, with paved half-width
 * `halfWidthM`, can safely carry without reaching any building in
 * `buildings`, clamped to `[minWidthM, targetWidthM]`.
 *
 * The same single width is used for both the left and right shoulder strip
 * at this point (a building near only one side still narrows both) — a
 * deliberately conservative simplification over independently resolving
 * each side, since a shoulder ramping unevenly narrow-on-one-side is a
 * bigger visual/behavioural inconsistency than a shoulder that is narrower
 * than strictly necessary on its clear side.
 *
 * `available = nearestBuildingEdgeDistance - safetyMarginM` is clamped
 * DOWN to `minWidthM` rather than allowed to go to zero or negative — a
 * building close enough to force that means the shoulder is locally as
 * narrow (and as steep) as `minWidthM` allows, never removed outright,
 * since a bare cliff is worse than a short, steep ramp.
 */
export function resolvePointShoulderWidth(
  x: number,
  z: number,
  halfWidthM: number,
  buildings: readonly ClearanceBuilding[],
  targetWidthM: number,
  minWidthM: number,
  safetyMarginM: number,
): number {
  if (buildings.length === 0) return targetWidthM;

  let nearestEdgeDistance = Number.POSITIVE_INFINITY;
  for (const building of buildings) {
    const dx = x - building.centerX;
    const dz = z - building.centerZ;
    const centerDistance = Math.hypot(dx, dz);
    // Distance from the road's OWN paved edge (not centreline) to the
    // building's own bounding circle, in the plane -- the shoulder starts
    // at the paved edge, so that is the correct zero point for "distance
    // available to ramp into."
    const edgeDistance = centerDistance - building.radiusM - halfWidthM;
    if (edgeDistance < nearestEdgeDistance) nearestEdgeDistance = edgeDistance;
  }

  const available = nearestEdgeDistance - safetyMarginM;
  return Math.max(minWidthM, Math.min(targetWidthM, available));
}
