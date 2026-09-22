/**
 * Forward gap probe for D-10 mild avoidance (plan 07-03 Task 2) — the
 * repo's FIRST `World`-ray-cast consumer. Signature verified directly
 * against the installed `.d.ts`
 * (`node_modules/@dimforge/rapier3d/pipeline/world.d.ts`, the `World`
 * class's own closest-hit ray query: `(ray, maxToi, solid, filterFlags?,
 * filterGroups?, filterExcludeCollider?, filterExcludeRigidBody?,
 * filterPredicate?): RayColliderHit | null`) and
 * `node_modules/@dimforge/rapier3d/geometry/ray.d.ts` (`Ray(origin, dir)`;
 * `RayColliderHit.timeOfImpact` is the hit distance in metres when `dir` is
 * a unit vector, since the hit point is `origin + dir * timeOfImpact`).
 *
 * Read-only: casts a ray and reports a distance, never writes any Rapier
 * state. Layering: may import `@dimforge/rapier3d` and `src/core/`. Must not
 * import `three` and must not touch the DOM or any wall clock (mirrors
 * `src/physics/vehicle.ts`'s own documented layering rule).
 *
 * [MEASURED] (plan 07-03 Task 2, empirically): Rapier's broad-phase only
 * indexes a collider created THIS tick on the world's NEXT `step()` — a
 * probe called before that world has ever stepped once finds nothing, even
 * for colliders sitting directly in the ray's path. This is a one-tick,
 * self-healing gap (every AI fleet car's chassis exists for the entire race
 * after the grid/countdown sequence, which always steps the world many
 * times before racing starts) — the same "one tick behind" family of
 * behaviour `src/physics/vehicle.ts` already documents for
 * `wheelGroundObject`'s own suspension raycast, not a bug in this file.
 */
import * as RAPIER from "@dimforge/rapier3d";

/**
 * Casts one ray from `origin` along the normalised `forwardXZ` direction
 * (y held at 0 — this is a flat, forward-only probe, not a 3D cone),
 * filtered to ONLY the colliders in `obstacleColliderHandles` and
 * EXCLUDING `ownBody` (so a car origin placed just inside its own chassis
 * never reports itself). Returns the hit distance in metres, or `null`
 * when nothing obstacle-tagged is within `maxDistanceM`.
 */
export function probeForwardGapM(
  world: RAPIER.World,
  ownBody: RAPIER.RigidBody,
  obstacleColliderHandles: ReadonlySet<number>,
  origin: { readonly x: number; readonly y: number; readonly z: number },
  forwardXZ: { readonly x: number; readonly z: number },
  maxDistanceM: number,
): number | null {
  const len = Math.hypot(forwardXZ.x, forwardXZ.z);
  const fx = len > 1e-9 ? forwardXZ.x / len : 1;
  const fz = len > 1e-9 ? forwardXZ.z / len : 0;

  const ray = new RAPIER.Ray(origin, { x: fx, y: 0, z: fz });
  const hit = world.castRay(
    ray,
    maxDistanceM,
    true,
    undefined,
    undefined,
    undefined,
    ownBody,
    (collider) => obstacleColliderHandles.has(collider.handle),
  );
  if (hit === null) return null;
  return hit.timeOfImpact;
}
