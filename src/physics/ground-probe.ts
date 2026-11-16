/**
 * Ground height straight below a point, for render-side effects that need to
 * know how far the car is off the ground (the contact shadow). Casts one ray
 * down against the world, ignoring `ownBody`. Read-only: never alters physics.
 */
import * as RAPIER from "@dimforge/rapier3d";

const MAX_DROP_M = 60;

export type GroundProbe = (x: number, y: number, z: number) => number | null;

/** Ground height and unit surface normal straight below a point. */
export interface GroundSample {
  readonly y: number;
  readonly nx: number;
  readonly ny: number;
  readonly nz: number;
}

export type GroundSampler = (x: number, y: number, z: number) => GroundSample | null;

/** Like `createGroundProbe` but also returns the surface normal (one ray, read-only). */
export function createGroundSampler(world: RAPIER.World, ownBody: RAPIER.RigidBody): GroundSampler {
  const ray = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: -1, z: 0 });
  return (x, y, z) => {
    ray.origin.x = x;
    ray.origin.y = y;
    ray.origin.z = z;
    const hit = world.castRayAndGetNormal(
      ray,
      MAX_DROP_M,
      true,
      undefined,
      undefined,
      undefined,
      ownBody,
    );
    if (hit === null) return null;
    const n = hit.normal;
    const len = Math.hypot(n.x, n.y, n.z);
    // A back-face or zero normal falls back to flat rather than flipping the patch.
    if (!(len > 0) || n.y <= 0) return { y: y - hit.timeOfImpact, nx: 0, ny: 1, nz: 0 };
    return { y: y - hit.timeOfImpact, nx: n.x / len, ny: n.y / len, nz: n.z / len };
  };
}

export function createGroundProbe(world: RAPIER.World, ownBody: RAPIER.RigidBody): GroundProbe {
  const ray = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: -1, z: 0 });
  return (x, y, z) => {
    ray.origin.x = x;
    ray.origin.y = y;
    ray.origin.z = z;
    const hit = world.castRay(ray, MAX_DROP_M, true, undefined, undefined, undefined, ownBody);
    return hit === null ? null : y - hit.timeOfImpact;
  };
}
