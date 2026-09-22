/**
 * Shared heading/bearing conventions used across race-state, minimap,
 * navigation-arrow and (from Phase 7) the AI racing line and driver.
 *
 * Two distinct, numerically DIFFERENT conventions coexist in this codebase.
 * Mixing them up feeds a pose builder the wrong angle by a non-trivial
 * offset, not a small error — this file exists to give both a single, well
 * documented home instead of leaving the distinction implicit at every call
 * site.
 *
 * - BEARING (`headingFromRotation`): `atan2(forwardZ, forwardX)` of the
 *   chassis's world-forward vector, derived directly from a Rapier rotation
 *   quaternion. This is the convention `race-state.ts`/`minimap.ts`/
 *   `navigation-arrow.ts`/`race-coordinator.ts` already use for "current
 *   heading" everywhere in this codebase, and the pure-pursuit steering math
 *   in `src/core/ai-driver.ts` is written against it.
 *
 * - YAW (`yawFromTravelDirection`/`forwardFromYaw`): `VehiclePose.headingRad`,
 *   the value `src/physics/vehicle.ts`'s `resetPose` feeds into
 *   `{x:0, y:sin(h/2), z:0, w:cos(h/2)}` to build a chassis rotation whose
 *   world-forward (local -Z) points along a desired travel direction
 *   `(dx, dz)`. `yawFromTravelDirection` is the exact algebraic inverse of
 *   `forwardFromYaw`, verified both symbolically (forward = (-sin h, -cos h)
 *   implies sin h = -dx, cos h = -dz, i.e. h = atan2(-dx, -dz)) and
 *   numerically against `src/physics/vehicle.ts`'s own `rotateVec` — this is
 *   the property `buildGridPoses` (`src/core/racing-line.ts`) depends on to
 *   make a grid slot's chassis actually face along the racing line's tangent
 *   once `resetPose` runs.
 *
 * DEVIATION (Rule 1 — bug found while writing this file's own tests): the
 * plan's illustrative anchor value for `yawFromTravelDirection` used the raw
 * dx/dz travel-direction components (0.985, -0.170) directly. Those two
 * numbers are real — they match this repo's own `juliette-ga.map.json` edge
 * 19->16's incoming tangent to within 1e-3 — but plugged into the
 * round-trip-consistent formula above they yield roughly -1.40 rad, not the
 * authored `course.start.headingRad` of -1.7419882003637046 the plan compares
 * against (verified with a throwaway Node script against the real map/route
 * artifacts and against `vehicle.ts`'s own `rotateVec`). The formula that DOES
 * reproduce -1.7419882 from a real direction vector close to (0.985, -0.170)
 * is a DIFFERENT function (`atan2(-dx, dz)`, negating only dx) — but that
 * formula breaks the `forwardFromYaw` round trip for every other input
 * (fails already at h=0), which is a hard mathematical requirement `vehicle.ts`
 * itself enforces (confirmed directly against `rotateVec`). Since
 * `buildGridPoses` (Task 2) needs the round-trip property to hold for EVERY
 * heading, not just this one anchor, this file keeps the round-trip-correct
 * formula and anchors `tests/heading.test.ts` to the sign-corrected input
 * `(0.985, +0.170)` — which is exactly `forwardFromYaw(-1.7419882003637046)`
 * — rather than the plan's literal `(0.985, -0.170)`. `course.start.headingRad`
 * itself is untouched; only the test's illustrative input is corrected.
 *
 * Pure by construction: no renderer, no physics engine, no DOM, no wall
 * clock. `tests/layering.test.ts` mechanically enforces this for every file
 * under `src/core/`.
 */

/** One rigid body's world rotation quaternion, as `RAPIER.RigidBody.rotation()` returns it. */
export interface RotationLike {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly w: number;
}

/**
 * BEARING convention: `atan2(forwardZ, forwardX)` of the chassis's
 * world-forward vector (chassis-local -Z, rotated by `rotation`). Moved
 * verbatim from `src/gameplay/race-coordinator.ts`'s former private
 * `headingFromRotation` — every existing caller (race-state, minimap,
 * navigation-arrow) already assumes this exact formula, so the body is
 * copied byte-for-byte rather than re-derived.
 */
export function headingFromRotation(rotation: RotationLike): number {
  const forwardX = 2 * (rotation.x * rotation.z - rotation.w * rotation.y);
  const forwardZ = 2 * (rotation.x * rotation.x + rotation.y * rotation.y) - 1;
  return Math.atan2(forwardZ, forwardX);
}

/**
 * YAW convention: the `VehiclePose.headingRad` that, fed through
 * `vehicle.ts`'s `resetPose` (`{x:0, y:sin(h/2), z:0, w:cos(h/2)}`), points
 * the chassis's world-forward (local -Z) along the unit travel direction
 * `(dx, dz)`. The exact algebraic inverse of `forwardFromYaw` — see this
 * file's own doc comment above for the derivation and the DEVIATION note on
 * why this is NOT `atan2(-dx, dz)` despite that alternative looking closer
 * to a specific real anchor value.
 */
export function yawFromTravelDirection(dx: number, dz: number): number {
  return Math.atan2(-dx, -dz);
}

/**
 * Inverse of `yawFromTravelDirection`: the unit world-forward `(x, z)` a
 * chassis built with `resetPose({ headingRad: yawRad, ... })` would have.
 * `yawFromTravelDirection(forwardFromYaw(h).x, forwardFromYaw(h).z)`
 * round-trips `h` (wrapped to `(-pi, pi]`) for every finite `h` — verified
 * directly against `src/physics/vehicle.ts`'s own `rotateVec`, not merely
 * assumed from the formula's algebra.
 */
export function forwardFromYaw(yawRad: number): { x: number; z: number } {
  return { x: -Math.sin(yawRad), z: -Math.cos(yawRad) };
}
