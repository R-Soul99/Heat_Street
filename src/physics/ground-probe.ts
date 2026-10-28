/**
 * Ground height straight below a point, for render-side effects that need to
 * know how far the car is off the ground (the contact shadow). Casts one ray
 * down against the world, ignoring `ownBody`. Read-only: never alters physics.
 */
import * as RAPIER from "@dimforge/rapier3d";

const MAX_DROP_M = 60;

export type GroundProbe = (x: number, y: number, z: number) => number | null;

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
