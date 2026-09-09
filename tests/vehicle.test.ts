import * as RAPIER from "@dimforge/rapier3d";
import { describe, expect, it } from "vitest";
import { NEUTRAL } from "../src/core/input-tape";
import { defaultTuning, type VehicleTuning } from "../src/core/vehicle-tuning";
import { createVehicle, FL, FR, RL, RR, sampleVehicle } from "../src/physics/vehicle";
import { createWorld } from "../src/physics/world";

/**
 * Structural-assertion style copied from `tests/determinism.test.ts`
 * (01-PATTERNS.md), extended to the vehicle: a fresh throwaway world plus a
 * flat ground cuboid, never the live game world.
 */

/** Ground half-extents; the top surface is placed at y = 0 (see `buildGround`). */
const GROUND_HALF_EXTENTS = { x: 50, y: 0.5, z: 50 };

/** Build a static ground plane whose top surface sits at world y = 0. */
function buildGround(world: RAPIER.World): void {
  const ground = world.createRigidBody(
    RAPIER.RigidBodyDesc.fixed().setTranslation(0, -GROUND_HALF_EXTENTS.y, 0),
  );
  world.createCollider(
    RAPIER.ColliderDesc.cuboid(GROUND_HALF_EXTENTS.x, GROUND_HALF_EXTENTS.y, GROUND_HALF_EXTENTS.z),
    ground,
  );
}

/** Spawn point 1 m above the ground plane, matching 02-04-PLAN.md's rest test. */
const SPAWN = { x: 0, y: 1, z: 0 };

/** Build a world with ground and one vehicle at `SPAWN`, returning both plus its tuning. */
function buildScene(tuning: VehicleTuning = defaultTuning()) {
  const world = createWorld();
  buildGround(world);
  const vehicle = createVehicle(world, tuning, SPAWN);
  return { world, vehicle, tuning };
}

/** Settle a vehicle onto the ground for `ticks` fixed steps with a neutral input. */
function settle(
  world: RAPIER.World,
  vehicle: ReturnType<typeof createVehicle>,
  tuning: VehicleTuning,
  ticks: number,
): void {
  for (let i = 0; i < ticks; i++) {
    vehicle.tick(NEUTRAL, tuning);
    world.step();
  }
}

describe("createVehicle: structure and rest state", () => {
  it("builds one chassis body and four wheels", () => {
    const { world, vehicle } = buildScene();

    expect(vehicle.controller.numWheels()).toBe(4);
    // ground + chassis. The chassis's own wheels are raycast wheels, not
    // separate rigid bodies, so this is 2, not 6.
    expect(world.bodies.len()).toBe(2);

    expect(FL).toBe(0);
    expect(FR).toBe(1);
    expect(RL).toBe(2);
    expect(RR).toBe(3);

    const flZ = vehicle.controller.wheelChassisConnectionPointCs(FL)?.z ?? Number.NaN;
    const frZ = vehicle.controller.wheelChassisConnectionPointCs(FR)?.z ?? Number.NaN;
    const rlZ = vehicle.controller.wheelChassisConnectionPointCs(RL)?.z ?? Number.NaN;
    const rrZ = vehicle.controller.wheelChassisConnectionPointCs(RR)?.z ?? Number.NaN;
    expect(flZ).toBeLessThan(0);
    expect(frZ).toBeLessThan(0);
    expect(rlZ).toBeGreaterThan(0);
    expect(rrZ).toBeGreaterThan(0);
  });

  it("rests on all four wheels with the summed suspension force equal to mg", () => {
    const { world, vehicle, tuning } = buildScene();

    settle(world, vehicle, tuning, 120);

    for (let i = 0; i < 4; i++) {
      expect(vehicle.controller.wheelIsInContact(i)).toBe(true);
    }

    let summedForce = 0;
    for (let i = 0; i < 4; i++) {
      summedForce += vehicle.controller.wheelSuspensionForce(i) ?? 0;
    }
    const mg = tuning.chassis.mass * 9.81;
    // Within 2%, matching 02-RESEARCH.md's own measured 0.9996 * mg anchor.
    expect(Math.abs(summedForce - mg) / mg).toBeLessThan(0.02);
  });
});

describe("createVehicle: steer sign (asserted, not discovered in the browser)", () => {
  it("steer sign: full right steer produces a right turn (negative angvel.y)", () => {
    const { world, vehicle, tuning } = buildScene();
    settle(world, vehicle, tuning, 60);

    // Establish 20 m/s forward motion directly rather than via throttle, so
    // this test isolates the steering sign from the acceleration profile.
    vehicle.body.setLinvel({ x: 0, y: vehicle.body.linvel().y, z: -20 }, true);

    const frame = { steer: 1, throttle: 0, brake: 0, handbrake: false };
    for (let i = 0; i < 30; i++) {
      vehicle.tick(frame, tuning);
      world.step();
    }

    expect(vehicle.body.angvel().y).toBeLessThan(0);
  });

  it("steer sign: full left steer produces a left turn (positive angvel.y), mirrored", () => {
    const { world, vehicle, tuning } = buildScene();
    settle(world, vehicle, tuning, 60);

    vehicle.body.setLinvel({ x: 0, y: vehicle.body.linvel().y, z: -20 }, true);

    const frame = { steer: -1, throttle: 0, brake: 0, handbrake: false };
    for (let i = 0; i < 30; i++) {
      vehicle.tick(frame, tuning);
      world.step();
    }

    expect(vehicle.body.angvel().y).toBeGreaterThan(0);
  });
});

describe("createVehicle: brake wins over throttle (Pitfall 7)", () => {
  it("brake wins over throttle: forward speed strictly decreases", () => {
    const { world, vehicle, tuning } = buildScene();
    settle(world, vehicle, tuning, 60);

    vehicle.body.setLinvel({ x: 0, y: vehicle.body.linvel().y, z: -18 }, true);
    const startSpeed = sampleVehicle(vehicle).forwardSpeedMs;

    const frame = { steer: 0, throttle: 1, brake: 1, handbrake: false };
    for (let i = 0; i < 120; i++) {
      vehicle.tick(frame, tuning);
      world.step();
    }
    const endSpeed = sampleVehicle(vehicle).forwardSpeedMs;

    expect(endSpeed).toBeLessThan(startSpeed);
  });

  it("brake wins companion: throttle alone (no brake) strictly increases speed", () => {
    // 01-PATTERNS.md R3 / anti-trivially-green convention: without this
    // companion, the test above would pass even if `tick` did nothing at
    // all to forward speed for reasons unrelated to the brake, because a
    // car coasting under drag alone also decelerates.
    const { world, vehicle, tuning } = buildScene();
    settle(world, vehicle, tuning, 60);

    vehicle.body.setLinvel({ x: 0, y: vehicle.body.linvel().y, z: -18 }, true);
    const startSpeed = sampleVehicle(vehicle).forwardSpeedMs;

    const frame = { steer: 0, throttle: 1, brake: 0, handbrake: false };
    for (let i = 0; i < 120; i++) {
      vehicle.tick(frame, tuning);
      world.step();
    }
    const endSpeed = sampleVehicle(vehicle).forwardSpeedMs;

    expect(endSpeed).toBeGreaterThan(startSpeed);
  });
});

describe("createVehicle: handbrake and the authored throttle-oversteer term", () => {
  it("handbrake drops rear side friction and release restores it", () => {
    const { world, vehicle, tuning } = buildScene();
    settle(world, vehicle, tuning, 60);

    const handbrakeFrame = { steer: 0, throttle: 0, brake: 0, handbrake: true };
    vehicle.tick(handbrakeFrame, tuning);
    world.step();
    expect(vehicle.controller.wheelSideFrictionStiffness(RL)).toBeCloseTo(
      tuning.drive.handbrakeRearSideFriction,
      6,
    );
    expect(vehicle.controller.wheelSideFrictionStiffness(RR)).toBeCloseTo(
      tuning.drive.handbrakeRearSideFriction,
      6,
    );

    vehicle.tick(NEUTRAL, tuning);
    world.step();
    expect(vehicle.controller.wheelSideFrictionStiffness(RL)).toBeCloseTo(
      tuning.wheels.rearSideFriction,
      6,
    );
  });

  it("throttle-oversteer term is load-bearing", () => {
    // Proves the authored term (02-RESEARCH.md: power oversteer does NOT
    // emerge from tuning alone) is actually wired, per 02-PATTERNS.md's
    // anti-trivially-green rule: with gain 0 the rear stays at baseline
    // under full throttle + full steer; with gain 0.5 it must be strictly
    // lower.
    const frame = { steer: 1, throttle: 1, brake: 0, handbrake: false };

    const zeroGainTuning = defaultTuning();
    zeroGainTuning.drive.powerOversteerGain = 0;
    const zeroScene = buildScene(zeroGainTuning);
    settle(zeroScene.world, zeroScene.vehicle, zeroScene.tuning, 60);
    zeroScene.vehicle.tick(frame, zeroScene.tuning);
    zeroScene.world.step();
    const zeroGainRearSfs =
      zeroScene.vehicle.controller.wheelSideFrictionStiffness(RL) ?? Number.NaN;
    expect(zeroGainRearSfs).toBeCloseTo(zeroGainTuning.wheels.rearSideFriction, 6);

    const halfGainTuning = defaultTuning();
    halfGainTuning.drive.powerOversteerGain = 0.5;
    const halfScene = buildScene(halfGainTuning);
    settle(halfScene.world, halfScene.vehicle, halfScene.tuning, 60);
    halfScene.vehicle.tick(frame, halfScene.tuning);
    halfScene.world.step();
    const halfGainRearSfs =
      halfScene.vehicle.controller.wheelSideFrictionStiffness(RL) ?? Number.NaN;

    expect(halfGainRearSfs).toBeLessThan(zeroGainRearSfs);
  });
});

describe("createVehicle: applyTuning retunes live without rebuilding", () => {
  it("applyTuning retunes live without rebuilding", () => {
    const { world, vehicle, tuning } = buildScene();
    const bodyBefore = vehicle.body;
    const bodyCountBefore = world.bodies.len();

    const retuned = defaultTuning();
    retuned.wheels.frictionSlip = tuning.wheels.frictionSlip + 0.5;
    vehicle.applyTuning(retuned);

    expect(vehicle.controller.wheelFrictionSlip(0)).toBeCloseTo(retuned.wheels.frictionSlip, 6);
    expect(vehicle.body).toBe(bodyBefore);
    expect(world.bodies.len()).toBe(bodyCountBefore);
  });
});
