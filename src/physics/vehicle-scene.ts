/**
 * Phase 2 vehicle scene: a flat plane, a drivable ramp, and exactly one
 * `Vehicle`.
 *
 * SUPERSEDES `src/physics/debug-scene.ts` at the composition root ONLY.
 * `src/physics/debug-scene.ts` and `src/render/debug-scene.ts` must NOT be
 * deleted or edited: `tests/determinism.test.ts` (7 import sites),
 * `tests/transform-cache.test.ts` and `tests/loop.test.ts` all import
 * `createDebugScene`, and `tests/determinism.test.ts` is the VEH-03 proof
 * that CLAUDE.md project constraint 3 says "must not regress". They are
 * regression fixtures now, and retiring them is a separately planned task,
 * never a side effect of this phase.
 *
 * Layering: may import `@dimforge/rapier3d` and `src/core/`. Must not import
 * `three` and must not touch the DOM or any wall clock. Meshes for the
 * chassis and wheels are built in `src/render/vehicle-view.ts`, keyed on
 * `bodies`' dense index order exactly as `src/physics/debug-scene.ts`
 * establishes for its own bodies (threat T-01-16).
 */
import * as RAPIER from "@dimforge/rapier3d";
import type { InputFrame } from "../core/input-tape";
import type { VehicleTuning } from "../core/vehicle-tuning";
import { createVehicle, type Vehicle } from "./vehicle";

/**
 * Ground half-extents, metres. Y is deliberately >= 1 m thick: 120 mph is
 * 0.894 m of travel per fixed tick (02-RESEARCH.md Pitfall 6, threat
 * T-02-13), so anything thinner is a tunnelling candidate even with CCD
 * enabled on the chassis (`src/physics/vehicle.ts`'s `setCcdEnabled(true)`).
 * X/Z are sized generously so the telemetry routines (plan 02-07) have room
 * to run a full straight-line pass without leaving the ground.
 */
const GROUND_HALF_EXTENTS = { x: 200, y: 1, z: 400 };

/** Ramp half-width along X, metres (8 m wide total). */
const RAMP_HALF_WIDTH = 4;

/** Ramp length along Z, foot to crest, metres. */
const RAMP_LENGTH = 12;

/**
 * Ramp crest height, metres. `atan(1.6 / 12)` is approximately 7.6 degrees,
 * matching this plan's target incline.
 */
const RAMP_HEIGHT = 1.6;

/**
 * Z coordinate of the ramp's foot -- the knife edge where the ramp meets the
 * ground's top surface (both at y = 0). A car approaching from larger +Z and
 * driving in -Z (the vehicle's forward direction, per `src/physics/vehicle.ts`)
 * reaches the ramp here. Exported so the telemetry routines in plan 02-07 and
 * this file's own tests can position scripted runs against the ramp without
 * duplicating the literal.
 */
export const RAMP_APPROACH_Z = 10;

/** Z coordinate of the ramp's crest -- the foot minus the ramp's length. */
const RAMP_CREST_Z = RAMP_APPROACH_Z - RAMP_LENGTH;

/**
 * Spawn point: 0.6 m above the ground (the suspension settles the rest of
 * the way down on the first few ticks), 30 m of clear approach before the
 * ramp's foot, facing -Z -- the vehicle's forward direction.
 */
export const SPAWN = { x: 0, y: 0.6, z: RAMP_APPROACH_Z + 30 };

/**
 * Build the static ground plane. Top surface at y = 0 (the body is
 * translated down by its own half-extent), matching the top surface the
 * ramp's knife edge sits flush against.
 */
function buildGround(world: RAPIER.World): void {
  const ground = world.createRigidBody(
    RAPIER.RigidBodyDesc.fixed().setTranslation(0, -GROUND_HALF_EXTENTS.y, 0),
  );
  world.createCollider(
    RAPIER.ColliderDesc.cuboid(
      GROUND_HALF_EXTENTS.x,
      GROUND_HALF_EXTENTS.y,
      GROUND_HALF_EXTENTS.z,
    ).setFriction(1.0),
    ground,
  );
}

/**
 * Build the ramp collider -- the piece 02-RESEARCH.md's Open Question 2 left
 * unsolved. The researcher's own probe built the ramp as a rotated cuboid and
 * the car hit its vertical leading edge instead of driving up it.
 *
 * Shipped here as a `ColliderDesc.convexHull` wedge: the convex hull of six
 * points forming a triangular-prism ramp block extruded along X. Cross-section
 * (in the Y-Z plane) is a right triangle:
 *   - the KNIFE EDGE, at (y=0, z=RAMP_APPROACH_Z) -- flush with the ground's
 *     top surface, zero height, so there is no vertical face for the wheels
 *     to strike;
 *   - the crest's back-base corner, at (y=0, z=RAMP_CREST_Z);
 *   - the crest's top corner, at (y=RAMP_HEIGHT, z=RAMP_CREST_Z).
 * The hypotenuse from the knife edge to the crest top is the sloped driving
 * surface; the back edge (base to top, both at z=RAMP_CREST_Z) is the ramp's
 * vertical rear face, which is what launches the car airborne once its
 * forward velocity carries it past the crest into open air above the flat
 * ground beyond. A triangular-prism wedge is already convex, so its hull IS
 * this exact shape -- no interior points are needed.
 *
 * Fallback order, per 02-RESEARCH.md Open Question 2, if this ever regresses:
 * (a) THIS convex hull wedge -- shipped, gated by
 * `tests/vehicle-scene.test.ts -t "ramp is climbable"` and its airborne/landing
 * companions; (b) a rotated cuboid sunk deep enough into the ground that its
 * leading edge is below y = 0 -- this is the researcher's failed probe
 * shape and is NOT used here; (c) `ColliderDesc.trimesh(verts, indices,
 * TriMeshFlags.FIX_INTERNAL_EDGES)` (144) -- CLAUDE.md's documented
 * trimesh-must-fix-internal-edges constraint, for if a hull-based ramp is
 * ever found to catch under some other tuning.
 */
function buildRamp(world: RAPIER.World): void {
  // Six points, XYZ-interleaved: knife edge (left, right), crest back-base
  // (left, right), crest top (left, right) -- see the doc comment above.
  const points = new Float32Array([
    -RAMP_HALF_WIDTH,
    0,
    RAMP_APPROACH_Z,
    RAMP_HALF_WIDTH,
    0,
    RAMP_APPROACH_Z,
    -RAMP_HALF_WIDTH,
    0,
    RAMP_CREST_Z,
    RAMP_HALF_WIDTH,
    0,
    RAMP_CREST_Z,
    -RAMP_HALF_WIDTH,
    RAMP_HEIGHT,
    RAMP_CREST_Z,
    RAMP_HALF_WIDTH,
    RAMP_HEIGHT,
    RAMP_CREST_Z,
  ]);

  const desc = RAPIER.ColliderDesc.convexHull(points);
  if (desc === null) {
    // Not expected to trigger -- the six points above are a well-formed
    // convex prism -- but if Rapier's hull computation ever rejects them,
    // fail loudly rather than silently shipping a rampless scene. See the
    // fallback order documented above this function.
    throw new Error(
      "ColliderDesc.convexHull returned null for the ramp wedge points; " +
        "see src/physics/vehicle-scene.ts buildRamp's documented fallback order " +
        "(02-RESEARCH.md Open Question 2) -- the trimesh fallback is not yet implemented.",
    );
  }

  const ramp = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
  world.createCollider(desc.setFriction(1.0), ramp);
}

/**
 * Mirrors the shipped `DebugScene` contract (`src/physics/debug-scene.ts`) so
 * `src/loop.ts` needs no change to drive this scene instead.
 */
export interface VehicleScene {
  /**
   * Every body the render layer draws, in dense index order. Chassis is
   * index 0. Excludes the ground and the ramp -- neither is a tracked body,
   * matching `DebugScene.bodies`' own exclusion of its ground (threat
   * T-01-16). `src/render/vehicle-view.ts` builds one mesh per entry in this
   * exact order.
   */
  readonly bodies: readonly RAPIER.RigidBody[];

  /** The one vehicle this scene drives. */
  readonly vehicle: Vehicle;

  /**
   * Advance anything that is driven rather than simulated. Called once per
   * fixed tick, immediately before `world.step()`, mirroring
   * `DebugScene.preTick`. A no-op this phase -- Phase 3's per-wheel surface
   * lookup (`wheelGroundObject`) is the reason this hook exists at all, and
   * it lives here once surface types are introduced.
   */
  preTick(tick: number): void;

  /**
   * Apply this tick's latched input to the vehicle. `src/loop.ts:196-197`
   * guarantees this runs immediately before `world.step()`, which is exactly
   * the ordering 02-RESEARCH.md Pattern 2 requires -- no change to
   * `src/loop.ts` is needed for this phase.
   */
  applyInput(frame: InputFrame): void;

  /** The tuning panel's write path (plan 02-09). Retunes the live vehicle. */
  setTuning(t: VehicleTuning): void;

  /** Remove the vehicle controller from its world. */
  dispose(): void;
}

/**
 * Build the ground, the ramp, and exactly one `createVehicle(world, tuning,
 * SPAWN)` into `world`.
 */
export function createVehicleScene(world: RAPIER.World, tuning: VehicleTuning): VehicleScene {
  buildGround(world);
  buildRamp(world);

  const vehicle = createVehicle(world, tuning, SPAWN);
  let currentTuning = tuning;

  // `bodies` contains the chassis body and NOTHING else -- the ground and
  // ramp are both fixed bodies with no mesh counterpart, and
  // `src/render/vehicle-view.ts` / `TransformCache` both key on this dense
  // order (threat T-01-16).
  const bodies: readonly RAPIER.RigidBody[] = [vehicle.body];

  return {
    bodies,
    vehicle,

    preTick(_tick: number): void {
      // No-op this phase -- must exist so the loop wiring shape is
      // unchanged. Phase 3's per-wheel surface lookup lives here.
    },

    applyInput(frame: InputFrame): void {
      vehicle.tick(frame, currentTuning);
    },

    setTuning(t: VehicleTuning): void {
      currentTuning = t;
      vehicle.applyTuning(t);
    },

    dispose(): void {
      vehicle.dispose();
    },
  };
}
