import * as RAPIER from "@dimforge/rapier3d";
import { describe, expect, it } from "vitest";
import { NEUTRAL } from "../src/core/input-tape";
import { DT } from "../src/core/sim-clock";
import { defaultTuning, type VehicleTuning } from "../src/core/vehicle-tuning";
import { createVehicle, FL, FR, RL, RR, sampleVehicle } from "../src/physics/vehicle";
import { applyAssists, boxPrincipalInertia } from "../src/physics/vehicle-assists";
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

/**
 * Coverage for the free `applyAssists` function, driven directly with a
 * synthetic chassis and no full `Vehicle` — per 02-PATTERNS.md, this is
 * exactly why `applyAssists` is a free function rather than a method.
 */
describe("vehicle-assists", () => {
  /** A dynamic chassis body matching `tuning`'s mass/shape, with no wheels. */
  function makeFreeChassis(world: RAPIER.World, tuning: VehicleTuning): RAPIER.RigidBody {
    const c = tuning.chassis;
    const body = world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic().setTranslation(0, 5, 0).setCanSleep(false),
    );
    world.createCollider(
      RAPIER.ColliderDesc.cuboid(c.halfExtents.x, c.halfExtents.y, c.halfExtents.z),
      body,
    );
    const inertia = boxPrincipalInertia(c.mass, c.halfExtents);
    body.setAdditionalMassProperties(
      c.mass,
      c.comOffset,
      inertia,
      { x: 0, y: 0, z: 0, w: 1 },
      true,
    );
    // Without this, the total mass properties (additional + collider) are
    // not applied until the next world.step() and applyTorqueImpulse below
    // would divide by the tiny collider-default inertia instead — see the
    // matching comment in src/physics/vehicle.ts.
    body.recomputeMassPropertiesFromColliders();
    return body;
  }

  /** World-space Y component of the chassis local up axis (0,1,0) rotated by `q`. */
  function upY(q: { x: number; y: number; z: number; w: number }): number {
    return 1 - 2 * (q.x * q.x + q.z * q.z);
  }

  it("auto-level assist is gated to airborne only", () => {
    const tuning = defaultTuning();
    const I = boxPrincipalInertia(tuning.chassis.mass, tuning.chassis.halfExtents);

    // Grounded (contacts = 2): must be a true no-op on angular velocity.
    const worldA = createWorld();
    const bodyA = makeFreeChassis(worldA, tuning);
    bodyA.setAngvel({ x: 0.5, y: 0, z: 0.2 }, true);
    const vcA = worldA.createVehicleController(bodyA);
    const before = bodyA.angvel();
    applyAssists(bodyA, vcA, 2, tuning.assists, I);
    const after = bodyA.angvel();
    expect(after.x).toBe(before.x);
    expect(after.y).toBe(before.y);
    expect(after.z).toBe(before.z);

    // Airborne (contacts = 0) with a tilted chassis: repeated ticks reduce
    // tilt (`upY` climbs back toward 1 = level).
    const worldB = createWorld();
    const bodyB = makeFreeChassis(worldB, tuning);
    const tiltRad = Math.PI / 3; // 60 degrees, tipped about the local X axis
    bodyB.setRotation({ x: Math.sin(tiltRad / 2), y: 0, z: 0, w: Math.cos(tiltRad / 2) }, true);
    const vcB = worldB.createVehicleController(bodyB);
    const upYBefore = upY(bodyB.rotation());

    for (let i = 0; i < 30; i++) {
      applyAssists(bodyB, vcB, 0, tuning.assists, I);
      worldB.step();
    }
    const upYAfter = upY(bodyB.rotation());

    expect(upYAfter).toBeGreaterThan(upYBefore);
  });

  it("body-roll assist respects its cutoff", () => {
    const tuning = defaultTuning();
    const I = boxPrincipalInertia(tuning.chassis.mass, tuning.chassis.halfExtents);
    const world = createWorld();
    const body = makeFreeChassis(world, tuning);

    // Roll the chassis (rotation about the local forward/Z axis) past the
    // cutoff before ever calling applyAssists.
    const overRad = ((tuning.assists.bodyRollMaxDeg + 5) * Math.PI) / 180;
    body.setRotation({ x: 0, y: 0, z: Math.sin(overRad / 2), w: Math.cos(overRad / 2) }, true);
    const vc = world.createVehicleController(body);

    const before = body.angvel();
    applyAssists(body, vc, 4, tuning.assists, I);
    const after = body.angvel();

    expect(after.x).toBe(before.x);
    expect(after.y).toBe(before.y);
    expect(after.z).toBe(before.z);
  });

  it("body-roll torque is capped", () => {
    const tuning = defaultTuning();
    const I = boxPrincipalInertia(tuning.chassis.mass, tuning.chassis.halfExtents);
    const world = createWorld();
    const body = makeFreeChassis(world, tuning);

    // Drive latAccel = w.y * dot(v, fwd) to an absurd value at identity
    // rotation, so the uncapped open-loop magnitude vastly exceeds the cap.
    body.setAngvel({ x: 0, y: 1000, z: 0 }, true);
    body.setLinvel({ x: 0, y: 0, z: -1000 }, true);
    const vc = world.createVehicleController(body);

    const before = body.angvel();
    applyAssists(body, vc, 4, tuning.assists, I);
    const after = body.angvel();

    // At identity rotation the torque impulse lands purely on the Z axis;
    // recover its magnitude via I.z and compare against the documented cap.
    const deltaWz = after.z - before.z;
    const appliedImpulseMagnitude = Math.abs(deltaWz) * I.z;
    const cap = tuning.assists.bodyRollGain * I.x * 30 * DT;
    expect(appliedImpulseMagnitude).toBeLessThanOrEqual(cap + 1e-6);
  });

  it("downforce is inert at the default gain", () => {
    const tuning = defaultTuning();
    expect(tuning.assists.downforcePerSpeed2).toBe(0);
    const I = boxPrincipalInertia(tuning.chassis.mass, tuning.chassis.halfExtents);
    const world = createWorld();
    const body = makeFreeChassis(world, tuning);
    body.setLinvel({ x: 0, y: 0, z: -50 }, true);
    const vc = world.createVehicleController(body);

    const before = body.linvel();
    applyAssists(body, vc, 4, tuning.assists, I);
    world.step();
    const after = body.linvel();

    // No linear impulse from applyAssists itself at the default gain, so the
    // only change in linvel.y is gravity integrated by world.step().
    expect(after.y).toBeCloseTo(before.y - 9.81 * DT, 5);
  });

  it("boxPrincipalInertia matches the Config A anchor", () => {
    // DEVIATION from 02-RESEARCH.md line 1057 and 02-04-PLAN.md's stated
    // anchor of {3080, 3480, 512}: evaluating this file's formula (copied
    // verbatim from 02-04-PLAN.md's own action text) against Config A's
    // actual shipped values (mass 1600, halfExtents {0.95, 0.5, 2.35}) gives
    // {3078.7, 3426.7, 614.7}. See the doc comment on `boxPrincipalInertia`.
    const tuning = defaultTuning();
    const inertia = boxPrincipalInertia(tuning.chassis.mass, tuning.chassis.halfExtents);
    const expected = { x: 3078.67, y: 3426.67, z: 614.67 };

    expect(Math.abs(inertia.x - expected.x) / expected.x).toBeLessThan(0.01);
    expect(Math.abs(inertia.y - expected.y) / expected.y).toBeLessThan(0.01);
    expect(Math.abs(inertia.z - expected.z) / expected.z).toBeLessThan(0.01);
  });
});
