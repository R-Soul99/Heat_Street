import * as RAPIER from "@dimforge/rapier3d";
import { describe, expect, it } from "vitest";
import { NEUTRAL } from "../src/core/input-tape";
import { defaultSurfaceProfiles } from "../src/core/surface-tuning";
import { defaultTuning, type VehicleTuning } from "../src/core/vehicle-tuning";
import { createSurfaceMap, type SurfaceContext } from "../src/physics/surface";
import { createVehicle, FL, FR, RL, RR } from "../src/physics/vehicle";
import { createWorld } from "../src/physics/world";

/**
 * Wave-0 gate for `SurfaceMap` (03-VALIDATION.md). Written FIRST, before
 * `src/physics/surface.ts` exists — must fail (module not found) until Task
 * 1's implementation lands, per this plan's TDD requirement.
 */

describe("createSurfaceMap: defaults", () => {
  it("with no argument defaults unknown handles to tarmac", () => {
    const map = createSurfaceMap();
    expect(map.lookup(42)).toBe("tarmac");
  });

  it("with an explicit default surface, unknown handles resolve to it", () => {
    const map = createSurfaceMap("grass");
    expect(map.lookup(42)).toBe("grass");
  });
});

describe("createSurfaceMap: register/lookup", () => {
  it("after register(7, mud), lookup(7) returns mud", () => {
    const map = createSurfaceMap();
    map.register(7, "mud");
    expect(map.lookup(7)).toBe("mud");
  });

  it("lookup(undefined) returns the default surface — the airborne-wheel case", () => {
    // wheelGroundObject(i) returning null and `?.handle` producing
    // `undefined` is the exact shape the vehicle tick hands this function.
    const map = createSurfaceMap("sand");
    expect(map.lookup(undefined)).toBe("sand");
  });

  it("lookup(999) for an unregistered handle returns the default surface, does not throw", () => {
    const map = createSurfaceMap();
    expect(() => map.lookup(999)).not.toThrow();
    expect(map.lookup(999)).toBe("tarmac");
  });

  it("register called twice for the same handle keeps the last value", () => {
    const map = createSurfaceMap();
    map.register(3, "gravel");
    map.register(3, "dirt_road");
    expect(map.lookup(3)).toBe("dirt_road");
  });

  it("a handle of 0 is a legitimate Rapier handle, not falsy/absent", () => {
    // register(0, ...) must not be confused with "no handle" — lookup uses
    // an explicit `=== undefined` check, never a truthiness test.
    const map = createSurfaceMap();
    map.register(0, "sand");
    expect(map.lookup(0)).toBe("sand");
  });
});

/**
 * Integration half: `Vehicle.tick`'s optional `surfaces` parameter
 * (03-03-PLAN.md Task 2). Each case builds a real `createWorld()`, a ground
 * cuboid collider registered into a `SurfaceMap`, and a `createVehicle`
 * spawned above it — written BEFORE the `src/physics/vehicle.ts` edit, must
 * fail (no third parameter accepted / wheelSurfaces undefined) until Task
 * 2's implementation lands.
 *
 * Ground-contact timing note (empirically measured, not assumed): with
 * `defaultTuning()`'s wheel geometry and a chassis spawned at y=1 directly
 * above the single ground plane, `wheelGroundObject(i)` already resolves to
 * the ground collider on the very FIRST `tick()` call — the shipped
 * `DynamicRayCastVehicleController`'s wheel raycast is not bounded to
 * `wheelIsInContact`'s suspension-travel range; it finds a collider far
 * outside contact range too (see the airborne-fallback case, which spawns
 * with NO ground collider in the world at all rather than merely far away,
 * to force the true `null` fallback path). This means a straight
 * single-zone scene never demonstrates 03-RESEARCH.md Pitfall 2's one-tick
 * lag by itself — that test instead spawns two adjacent zones and
 * TELEPORTS the chassis from one to the other between two ticks (see
 * "one-tick lag is intentional" below), which is the scenario the lag
 * actually describes: crossing a surface BOUNDARY mid-drive, not cold
 * start.
 */
describe("Vehicle.tick: surface integration", () => {
  const GROUND_HALF_EXTENTS = { x: 50, y: 0.5, z: 50 };
  const SPAWN = { x: 0, y: 1, z: 0 };
  const AIRBORNE_SPAWN = { x: 0, y: 50, z: 0 };

  function buildGroundCollider(world: RAPIER.World): RAPIER.Collider {
    const ground = world.createRigidBody(
      RAPIER.RigidBodyDesc.fixed().setTranslation(0, -GROUND_HALF_EXTENTS.y, 0),
    );
    return world.createCollider(
      RAPIER.ColliderDesc.cuboid(
        GROUND_HALF_EXTENTS.x,
        GROUND_HALF_EXTENTS.y,
        GROUND_HALF_EXTENTS.z,
      ),
      ground,
    );
  }

  function buildScene(tuning: VehicleTuning = defaultTuning(), spawn = SPAWN) {
    const world = createWorld();
    const groundCollider = buildGroundCollider(world);
    const vehicle = createVehicle(world, tuning, spawn);
    return { world, vehicle, tuning, groundCollider };
  }

  it("backwards compatibility: surfaces omitted leaves friction read-backs at applyTuning values", () => {
    const { world, vehicle, tuning } = buildScene();
    for (let i = 0; i < 2; i++) {
      vehicle.tick(NEUTRAL, tuning);
      world.step();
    }
    for (let i = 0; i < 4; i++) {
      expect(vehicle.controller.wheelFrictionSlip(i)).toBeCloseTo(tuning.wheels.frictionSlip, 6);
    }
    expect(vehicle.controller.wheelSideFrictionStiffness(FL)).toBeCloseTo(
      tuning.wheels.frontSideFriction,
      6,
    );
    expect(vehicle.controller.wheelSideFrictionStiffness(FR)).toBeCloseTo(
      tuning.wheels.frontSideFriction,
      6,
    );
    expect(vehicle.controller.wheelSideFrictionStiffness(RL)).toBeCloseTo(
      tuning.wheels.rearSideFriction,
      6,
    );
    expect(vehicle.controller.wheelSideFrictionStiffness(RR)).toBeCloseTo(
      tuning.wheels.rearSideFriction,
      6,
    );
  });

  it("surface applied: mud ground scales frictionSlip by mud.forwardGrip after two ticks", () => {
    const { world, vehicle, tuning, groundCollider } = buildScene();
    const map = createSurfaceMap();
    map.register(groundCollider.handle, "mud");
    const profiles = defaultSurfaceProfiles();
    const surfaces: SurfaceContext = { map, profiles };

    vehicle.tick(NEUTRAL, tuning, surfaces);
    world.step();
    vehicle.tick(NEUTRAL, tuning, surfaces);
    world.step();

    const expectedForward = tuning.wheels.frictionSlip * profiles.mud.forwardGrip;
    for (let i = 0; i < 4; i++) {
      expect(vehicle.controller.wheelFrictionSlip(i)).toBeCloseTo(expectedForward, 6);
    }
  });

  it("front lateral: front wheels' side-friction scales by mud.lateralGrip after two ticks", () => {
    const { world, vehicle, tuning, groundCollider } = buildScene();
    const map = createSurfaceMap();
    map.register(groundCollider.handle, "mud");
    const profiles = defaultSurfaceProfiles();
    const surfaces: SurfaceContext = { map, profiles };

    vehicle.tick(NEUTRAL, tuning, surfaces);
    world.step();
    vehicle.tick(NEUTRAL, tuning, surfaces);
    world.step();

    const expectedFrontLateral = tuning.wheels.frontSideFriction * profiles.mud.lateralGrip;
    expect(vehicle.controller.wheelSideFrictionStiffness(FL)).toBeCloseTo(expectedFrontLateral, 6);
    expect(vehicle.controller.wheelSideFrictionStiffness(FR)).toBeCloseTo(expectedFrontLateral, 6);
  });

  it("composition, not replacement: handbrake on mud scales the handbrake value by mud.lateralGrip", () => {
    const { world, vehicle, tuning, groundCollider } = buildScene();
    const map = createSurfaceMap();
    map.register(groundCollider.handle, "mud");
    const profiles = defaultSurfaceProfiles();
    const surfaces: SurfaceContext = { map, profiles };
    const handbrakeFrame = { steer: 0, throttle: 0, brake: 0, handbrake: true };

    vehicle.tick(handbrakeFrame, tuning, surfaces);
    world.step();
    vehicle.tick(handbrakeFrame, tuning, surfaces);
    world.step();

    // The composition bug the naive insertion produces: this must equal
    // handbrakeRearSideFriction * mud.lateralGrip, NOT
    // rearSideFriction * mud.lateralGrip (baseline, ignoring the handbrake)
    // and NOT the raw unscaled handbrakeRearSideFriction (surface discarded).
    const expectedRear = tuning.drive.handbrakeRearSideFriction * profiles.mud.lateralGrip;
    expect(vehicle.controller.wheelSideFrictionStiffness(RL)).toBeCloseTo(expectedRear, 6);
    expect(vehicle.controller.wheelSideFrictionStiffness(RR)).toBeCloseTo(expectedRear, 6);
  });

  it("tarmac is a true no-op: read-backs equal the surface-less values exactly", () => {
    const { world, vehicle, tuning, groundCollider } = buildScene();
    const map = createSurfaceMap();
    map.register(groundCollider.handle, "tarmac");
    const profiles = defaultSurfaceProfiles();
    const surfaces: SurfaceContext = { map, profiles };

    vehicle.tick(NEUTRAL, tuning, surfaces);
    world.step();
    vehicle.tick(NEUTRAL, tuning, surfaces);
    world.step();

    for (let i = 0; i < 4; i++) {
      expect(vehicle.controller.wheelFrictionSlip(i)).toBeCloseTo(tuning.wheels.frictionSlip, 6);
    }
    expect(vehicle.controller.wheelSideFrictionStiffness(FL)).toBeCloseTo(
      tuning.wheels.frontSideFriction,
      6,
    );
    expect(vehicle.controller.wheelSideFrictionStiffness(RL)).toBeCloseTo(
      tuning.wheels.rearSideFriction,
      6,
    );
  });

  it("wheelSurfaces reporting: sand ground reports sand for all 4 wheels after two ticks", () => {
    const { world, vehicle, tuning, groundCollider } = buildScene();
    const map = createSurfaceMap();
    map.register(groundCollider.handle, "sand");
    const surfaces: SurfaceContext = { map, profiles: defaultSurfaceProfiles() };

    vehicle.tick(NEUTRAL, tuning, surfaces);
    world.step();
    vehicle.tick(NEUTRAL, tuning, surfaces);
    world.step();

    expect(vehicle.wheelSurfaces.length).toBe(4);
    for (const s of vehicle.wheelSurfaces) {
      expect(s).toBe("sand");
    }
  });

  it("one-tick lag is intentional (03-RESEARCH.md Pitfall 2): crossing a surface boundary keeps reporting the OLD surface for one extra tick", () => {
    // Two adjacent zones, far enough apart that the vehicle is only ever
    // over one at a time: tarmac under the spawn point, mud a long way off
    // in +x. Teleporting between them (rather than driving) isolates the
    // raycast-timing effect from throttle/steering.
    const world = createWorld();
    const tarmacGround = world.createRigidBody(
      RAPIER.RigidBodyDesc.fixed().setTranslation(-100, -GROUND_HALF_EXTENTS.y, 0),
    );
    const tarmacCollider = world.createCollider(
      RAPIER.ColliderDesc.cuboid(
        GROUND_HALF_EXTENTS.x,
        GROUND_HALF_EXTENTS.y,
        GROUND_HALF_EXTENTS.z,
      ),
      tarmacGround,
    );
    const mudGround = world.createRigidBody(
      RAPIER.RigidBodyDesc.fixed().setTranslation(100, -GROUND_HALF_EXTENTS.y, 0),
    );
    const mudCollider = world.createCollider(
      RAPIER.ColliderDesc.cuboid(
        GROUND_HALF_EXTENTS.x,
        GROUND_HALF_EXTENTS.y,
        GROUND_HALF_EXTENTS.z,
      ),
      mudGround,
    );
    const map = createSurfaceMap();
    map.register(tarmacCollider.handle, "tarmac");
    map.register(mudCollider.handle, "mud");
    const surfaces: SurfaceContext = { map, profiles: defaultSurfaceProfiles() };

    const tuning = defaultTuning();
    const vehicle = createVehicle(world, tuning, { x: -100, y: 1, z: 0 });

    // Establish steady contact over the tarmac zone.
    vehicle.tick(NEUTRAL, tuning, surfaces);
    world.step();
    vehicle.tick(NEUTRAL, tuning, surfaces);
    world.step();
    for (const s of vehicle.wheelSurfaces) {
      expect(s).toBe("tarmac");
    }

    // Teleport straight to the mud zone, matching the chassis's settled
    // height so it starts already resting rather than falling.
    const y = vehicle.body.translation().y;
    vehicle.body.setTranslation({ x: 100, y, z: 0 }, true);
    vehicle.body.setLinvel({ x: 0, y: 0, z: 0 }, true);

    // Tick immediately after the teleport: wheelGroundObject at the TOP of
    // THIS tick still reflects the raycast from the PREVIOUS tick (taken
    // while over tarmac, before the teleport) — the one-tick lag.
    vehicle.tick(NEUTRAL, tuning, surfaces);
    world.step();
    for (const s of vehicle.wheelSurfaces) {
      expect(s).toBe("tarmac");
    }

    // One more tick: THIS tick's top now reads the raycast taken during the
    // previous tick's updateVehicle, which ran AFTER the teleport — mud.
    vehicle.tick(NEUTRAL, tuning, surfaces);
    world.step();
    for (const s of vehicle.wheelSurfaces) {
      expect(s).toBe("mud");
    }
  });

  it("airborne fallback: ticking with a surface context does not throw and wheelSurfaces reports the default", () => {
    // No ground collider anywhere in this world — not merely far away, but
    // genuinely absent, so wheelGroundObject(i) is guaranteed null rather
    // than depending on how far the controller's own raycast reaches.
    const world = createWorld();
    const tuning = defaultTuning();
    const vehicle = createVehicle(world, tuning, AIRBORNE_SPAWN);
    const map = createSurfaceMap();
    const surfaces: SurfaceContext = { map, profiles: defaultSurfaceProfiles() };

    expect(() => {
      for (let i = 0; i < 5; i++) {
        vehicle.tick(NEUTRAL, tuning, surfaces);
        world.step();
      }
    }).not.toThrow();

    for (let i = 0; i < 4; i++) {
      expect(vehicle.controller.wheelIsInContact(i)).toBe(false);
    }
    for (const s of vehicle.wheelSurfaces) {
      expect(s).toBe("tarmac");
    }
  });
});
