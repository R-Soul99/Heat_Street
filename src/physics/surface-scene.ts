/**
 * Phase 3 surface test scene: six contiguous surface zones (D-01's
 * patchwork) plus two placeholder occlusion-building clusters (D-06/D-07),
 * and exactly one `Vehicle`.
 *
 * SUPERSEDES `src/physics/vehicle-scene.ts` at the composition root ONLY.
 * `src/physics/vehicle-scene.ts` and `src/physics/debug-scene.ts` (and their
 * render-side counterparts) stay in place as regression fixtures and must
 * NOT be deleted or edited: `tests/vehicle-scene.test.ts`,
 * `tests/determinism.test.ts`, `tests/transform-cache.test.ts` and
 * `tests/loop.test.ts` all import them, and `tests/determinism.test.ts` is
 * the VEH-03 proof CLAUDE.md project constraint 3 says must not regress.
 *
 * Per CONTEXT.md D-03, this scene is ITSELF a dev/test fixture, matching the
 * `debug-scene.ts`/`vehicle-scene.ts` precedent -- a placeholder proving the
 * mechanism, explicitly superseded once Phase 4's real map pipeline lands,
 * not shipped content.
 *
 * D-02: this scene has NO climbable incline -- a deliberate omission, not an
 * oversight. This is a fresh layout, not a reuse of Phase 2's inclined-
 * surface scene; do not copy that file's wedge-collider builder or its
 * exported approach-distance constant into this file.
 *
 * Layering: may import `@dimforge/rapier3d` and `src/core/`. Must not import
 * `three` and must not touch the DOM or any wall clock.
 */
import * as RAPIER from "@dimforge/rapier3d";
import type { InputFrame } from "../core/input-tape";
import type { SurfaceProfiles } from "../core/surface-tuning";
import type { SurfaceType } from "../core/surface-types";
import type { VehicleTuning } from "../core/vehicle-tuning";
import { createSurfaceMap, type SurfaceContext, type SurfaceMap } from "./surface";
import { createVehicle, type Vehicle } from "./vehicle";

/**
 * Half-extents of one surface band, metres: 120 m wide (X), >= 1 m thick (Y
 * -- the SAME tunnelling guard `vehicle-scene.ts`'s `GROUND_HALF_EXTENTS`
 * documents: 120 mph is 0.894 m of travel per fixed tick, so anything
 * thinner is a tunnelling candidate even with CCD enabled), 80 m long (Z).
 */
const ZONE_HALF_X = 60;
const ZONE_HALF_Y = 1;
const ZONE_HALF_Z = 40;

/**
 * D-01's patchwork, tarmac -> gravel -> dirt_road -> grass -> sand -> mud,
 * laid out as bands ACROSS the driving direction (the car's forward is local
 * -Z) so one straight run crosses every band in this exact order. Band `i`
 * is centred at `z = 200 - i * 80`; with `ZONE_HALF_Z = 40` the bands are
 * therefore contiguous from z = +240 down to z = -240, no gap and no
 * overlap.
 */
export const SURFACE_ZONE_ORDER: readonly SurfaceType[] = [
  "tarmac",
  "gravel",
  "dirt_road",
  "grass",
  "sand",
  "mud",
];

/**
 * Spawn point: on tarmac, 0.6 m above the ground (the suspension settles the
 * rest of the way down on the first few ticks), facing -Z (the vehicle's
 * forward direction). 205 - 160 = 45 m of clear run-up before the
 * tarmac/gravel boundary at z = 160, giving the car room to reach real speed
 * before the first surface transition.
 */
export const SURFACE_SCENE_SPAWN = { x: 0, y: 0.6, z: 205 };

/**
 * Half-extents (metres) of the scene's full drivable floor footprint: X is
 * one band's half-width (`ZONE_HALF_X`, every band is the same width), Z is
 * the whole six-band patchwork's half-length (`SURFACE_ZONE_ORDER.length *
 * ZONE_HALF_Z`, since the bands are contiguous with no gap). Exported so
 * `src/main.ts` can size the render tier's reference grid to match -- a grid
 * wider than the real floor reads as "the ground continues here" when it
 * does not (found during plan 03-08's human go/no-go session).
 */
export const SURFACE_SCENE_FLOOR_HALF_EXTENTS = {
  x: ZONE_HALF_X,
  z: SURFACE_ZONE_ORDER.length * ZONE_HALF_Z,
} as const;

/**
 * Build one surface band's static collider and register it into
 * `surfaceMap`. Mirrors `vehicle-scene.ts`'s `buildGround` shape.
 */
function buildSurfaceZone(
  world: RAPIER.World,
  surfaceMap: SurfaceMap,
  surface: SurfaceType,
  centerZ: number,
): void {
  const body = world.createRigidBody(
    RAPIER.RigidBodyDesc.fixed().setTranslation(0, -ZONE_HALF_Y, centerZ),
  );
  // Ground-collider friction is a DELIBERATE constant, the SAME value on
  // every band -- SURF-01's literal requirement is that grip differences
  // come from per-wheel friction (src/physics/vehicle.ts step 0), never from
  // the ground collider's own coefficient. A reader must not mistake this
  // uniform value for an oversight.
  const collider = world.createCollider(
    RAPIER.ColliderDesc.cuboid(ZONE_HALF_X, ZONE_HALF_Y, ZONE_HALF_Z).setFriction(1.0),
    body,
  );
  surfaceMap.register(collider.handle, surface);
}

/**
 * One placeholder building's placement: centre X/Z and half-extents.
 * `src/render/surface-view.ts` mirrors these exact literals with a MUST
 * MATCH comment, so a human reading both files can cross-check the layout.
 */
export interface BuildingPlacement {
  readonly x: number;
  readonly z: number;
  readonly halfExtents: { readonly x: number; readonly y: number; readonly z: number };
}

/**
 * D-06/D-07's sparse cluster: 4 widely-spaced 12 x 20 x 12 m boxes on the +X
 * side, clear of the centreline drive -- the "relaxes in open areas" half of
 * CAM-04's steepen mitigation.
 */
export const SPARSE_BUILDINGS: readonly BuildingPlacement[] = [
  { x: 34, z: 170, halfExtents: { x: 6, y: 10, z: 6 } },
  { x: 48, z: 110, halfExtents: { x: 6, y: 10, z: 6 } },
  { x: 30, z: 55, halfExtents: { x: 6, y: 10, z: 6 } },
  { x: 50, z: 0, halfExtents: { x: 6, y: 10, z: 6 } },
];

/**
 * D-06/D-07's dense cluster: 10 taller 10 x 28 x 18 m boxes in two rows
 * (x = -41 / x = -21). The rows' inner faces sit at x = -36 and x = -26,
 * leaving a 10 m drivable corridor the car must thread -- the urban canyon
 * half of CAM-04's steepen mitigation. At 28 m tall these are taller than
 * the helicopter rig's default high-speed altitude, which is what makes
 * them occlude at all. Written as a literal, fully hand-placed table (not
 * synthesised by a nested loop) so the deliberate layout stays legible.
 */
export const DENSE_BUILDINGS: readonly BuildingPlacement[] = [
  { x: -41, z: 30, halfExtents: { x: 5, y: 14, z: 9 } },
  { x: -41, z: 10, halfExtents: { x: 5, y: 14, z: 9 } },
  { x: -41, z: -10, halfExtents: { x: 5, y: 14, z: 9 } },
  { x: -41, z: -30, halfExtents: { x: 5, y: 14, z: 9 } },
  { x: -41, z: -50, halfExtents: { x: 5, y: 14, z: 9 } },
  { x: -21, z: 30, halfExtents: { x: 5, y: 14, z: 9 } },
  { x: -21, z: 10, halfExtents: { x: 5, y: 14, z: 9 } },
  { x: -21, z: -10, halfExtents: { x: 5, y: 14, z: 9 } },
  { x: -21, z: -30, halfExtents: { x: 5, y: 14, z: 9 } },
  { x: -21, z: -50, halfExtents: { x: 5, y: 14, z: 9 } },
];

/**
 * Build one building's static collider. Deliberately NOT registered in the
 * `SurfaceMap` (T-03-16, accepted): a wheel that somehow ends up on a roof
 * resolves to the map's own default surface. Accepted for a placeholder
 * fixture explicitly superseded by Phase 4's real map pipeline (D-03).
 * `.setFriction(0.8)` matches the chassis collider's own friction
 * (`src/physics/vehicle.ts`) so a collision reads as a wall, not ice.
 */
function buildBuilding(world: RAPIER.World, placement: BuildingPlacement): void {
  const body = world.createRigidBody(
    RAPIER.RigidBodyDesc.fixed().setTranslation(placement.x, placement.halfExtents.y, placement.z),
  );
  world.createCollider(
    RAPIER.ColliderDesc.cuboid(
      placement.halfExtents.x,
      placement.halfExtents.y,
      placement.halfExtents.z,
    ).setFriction(0.8),
    body,
  );
}

/**
 * Mirrors `VehicleScene`'s contract (`vehicle-scene.ts`), adding `surfaces`
 * -- the `SurfaceContext` `applyInput` passes into `vehicle.tick`, which is
 * the entire point of this scene over its Phase 2 predecessor.
 */
export interface SurfaceScene {
  /**
   * Every body the render layer draws, in dense index order. Chassis only
   * -- zones and buildings have no mesh counterpart, the same exclusion
   * `VehicleScene.bodies` documents (threat T-01-16).
   */
  readonly bodies: readonly RAPIER.RigidBody[];

  /** The one vehicle this scene drives. */
  readonly vehicle: Vehicle;

  /** The surface map + grip-profile table `applyInput` feeds into `vehicle.tick`. */
  readonly surfaces: SurfaceContext;

  /**
   * No-op this phase, same as `VehicleScene.preTick` -- Phase 3's per-wheel
   * surface lookup turned out to belong inside `vehicle.tick` (plan 03-03),
   * not this hook. Carried forward as a corrected note rather than a
   * repeated, now-outdated prediction.
   */
  preTick(tick: number): void;

  /** Apply this tick's latched input to the vehicle, WITH surface context. */
  applyInput(frame: InputFrame): void;

  /** The tuning panel's write path (plan 02-09 precedent). Retunes the live vehicle. */
  setTuning(t: VehicleTuning): void;

  /**
   * Swaps the `SurfaceProfiles` object `surfaces.profiles` holds, so plan
   * 03-06's tuning panel can sweep grip live with no scene rebuild.
   */
  setSurfaceProfiles(p: SurfaceProfiles): void;

  /** Remove the vehicle controller from its world. */
  dispose(): void;
}

/**
 * Build the six surface bands (in `SURFACE_ZONE_ORDER`), both building
 * clusters, and exactly one `createVehicle(world, tuning,
 * SURFACE_SCENE_SPAWN)` into `world`.
 */
export function createSurfaceScene(
  world: RAPIER.World,
  tuning: VehicleTuning,
  profiles: SurfaceProfiles,
): SurfaceScene {
  const surfaceMap = createSurfaceMap();
  for (let i = 0; i < SURFACE_ZONE_ORDER.length; i++) {
    buildSurfaceZone(world, surfaceMap, SURFACE_ZONE_ORDER[i], 200 - i * ZONE_HALF_Z * 2);
  }

  for (const placement of SPARSE_BUILDINGS) {
    buildBuilding(world, placement);
  }
  for (const placement of DENSE_BUILDINGS) {
    buildBuilding(world, placement);
  }

  const vehicle = createVehicle(world, tuning, SURFACE_SCENE_SPAWN);
  let currentTuning = tuning;

  // The single mutable object `applyInput` hands to `vehicle.tick` every
  // tick. `setSurfaceProfiles` swaps `.profiles` in place, never reallocates
  // `.map` -- matching `SurfaceMap`'s own "allocate once, mutate in place"
  // discipline (src/physics/surface.ts).
  const surfaceContext: { map: SurfaceMap; profiles: SurfaceProfiles } = {
    map: surfaceMap,
    profiles,
  };

  // `bodies` contains the chassis body and NOTHING else -- zones and
  // buildings are all fixed bodies with no mesh counterpart, and
  // `src/render/surface-view.ts` / `TransformCache` both key on this dense
  // order (threat T-01-16).
  const bodies: readonly RAPIER.RigidBody[] = [vehicle.body];

  return {
    bodies,
    vehicle,
    surfaces: surfaceContext,

    preTick(_tick: number): void {
      // No-op -- see the doc comment on `SurfaceScene.preTick` above.
    },

    applyInput(frame: InputFrame): void {
      vehicle.tick(frame, currentTuning, surfaceContext);
    },

    setTuning(t: VehicleTuning): void {
      currentTuning = t;
      vehicle.applyTuning(t);
    },

    setSurfaceProfiles(p: SurfaceProfiles): void {
      surfaceContext.profiles = p;
    },

    dispose(): void {
      vehicle.dispose();
    },
  };
}
