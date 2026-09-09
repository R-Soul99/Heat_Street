import { describe, expect, it } from "vitest";
import { NEUTRAL } from "../src/core/input-tape";
import { defaultTuning } from "../src/core/vehicle-tuning";
import { sampleVehicle, type VehicleSample } from "../src/physics/vehicle";
import { createVehicleScene, RAMP_APPROACH_Z, SPAWN } from "../src/physics/vehicle-scene";
import { createWorld } from "../src/physics/world";

/**
 * The VEH-04 / ROADMAP SC3 proof: "hit a ramp at speed and land driveable".
 * 02-RESEARCH.md Open Question 2 explicitly left the ramp geometry unsolved
 * -- the researcher's own probe built the ramp as a rotated cuboid and the
 * car hit its vertical leading edge instead of driving up it. This file is
 * the gate: a ramp that merely "usually works" does not pass it.
 */

/**
 * Must match `RAMP_HEIGHT` in `src/physics/vehicle-scene.ts`. Not exported
 * from that module (only `RAMP_APPROACH_Z` and `SPAWN` are, per this plan's
 * `<interfaces>` block), so it is restated here with this comment as the
 * cross-reference.
 */
const RAMP_CREST_HEIGHT = 1.6;

/** Settle the vehicle onto the ground for `ticks` fixed steps with NEUTRAL input. */
function settle(
  world: ReturnType<typeof createWorld>,
  scene: ReturnType<typeof createVehicleScene>,
  ticks: number,
): void {
  for (let t = 0; t < ticks; t++) {
    scene.preTick(t);
    scene.applyInput(NEUTRAL);
    world.step();
  }
}

/** One tick's recorded sample, tagged with the tick index it was taken at. */
interface TickSample extends VehicleSample {
  readonly tick: number;
}

/**
 * Settle for 60 ticks, then drive full throttle for `driveTicks` more,
 * recording one `VehicleSample` per tick. Full throttle, straight steering --
 * the scripted, closed-form input 02-PATTERNS.md's "never random" convention
 * requires (`tests/determinism.test.ts`'s `buildVaryingTape` is the same
 * idea applied to a varying tape; this is the constant-input equivalent).
 */
function driveAtRampFullThrottle(driveTicks: number): {
  samples: readonly TickSample[];
} {
  const world = createWorld();
  const scene = createVehicleScene(world, defaultTuning());
  settle(world, scene, 60);

  const frame = { steer: 0, throttle: 1, brake: 0, handbrake: false };
  const samples: TickSample[] = [];
  for (let t = 60; t < 60 + driveTicks; t++) {
    scene.preTick(t);
    scene.applyInput(frame);
    world.step();
    samples.push({ ...sampleVehicle(scene.vehicle), tick: t });
  }
  return { samples };
}

/** Tick budget covering settle + approach + climb + launch + landing + 0.5s of driveaway. */
const RAMP_RUN_TICKS = 500;

describe("createVehicleScene: structure", () => {
  it("builds ground, ramp and exactly one chassis body", () => {
    const world = createWorld();
    const scene = createVehicleScene(world, defaultTuning());

    // ground (fixed) + ramp (fixed) + chassis (dynamic) = 3 bodies, 3 colliders.
    // The vehicle controller's four wheels are raycast wheels, not separate
    // rigid bodies (tests/vehicle.test.ts already establishes this for
    // createVehicle alone).
    expect(world.bodies.len()).toBe(3);
    expect(world.colliders.len()).toBe(3);

    // `bodies` excludes the ground AND the ramp -- neither is a tracked
    // body, matching DebugScene.bodies' own exclusion of its ground
    // (threat T-01-16).
    expect(scene.bodies.length).toBe(1);
    expect(scene.bodies[0]).toBe(scene.vehicle.body);
  });
});

describe("createVehicleScene: rest state", () => {
  it("the car rests on the ground at spawn", () => {
    const world = createWorld();
    const scene = createVehicleScene(world, defaultTuning());

    const lastYs: number[] = [];
    for (let t = 0; t < 120; t++) {
      scene.preTick(t);
      scene.applyInput(NEUTRAL);
      world.step();
      if (t >= 90) {
        lastYs.push(scene.vehicle.body.translation().y);
      }
    }

    const spread = Math.max(...lastYs) - Math.min(...lastYs);
    expect(spread).toBeLessThan(0.01);

    for (let i = 0; i < 4; i++) {
      expect(scene.vehicle.controller.wheelIsInContact(i)).toBe(true);
    }
  });
});

describe("createVehicleScene: ramp geometry (02-RESEARCH.md Open Question 2)", () => {
  it("ramp is climbable, not a wall", () => {
    const { samples } = driveAtRampFullThrottle(RAMP_RUN_TICKS);

    const rampFootIndex = samples.findIndex((s) => s.position.z <= RAMP_APPROACH_Z);
    expect(rampFootIndex).toBeGreaterThan(-1);
    const preRampSpeed = samples[rampFootIndex].forwardSpeedMs;
    // The approach must actually have built up real speed, or "retained at
    // least 60% of pre-ramp speed" would be true of a car that never moved.
    expect(preRampSpeed).toBeGreaterThan(5);

    // The climb window: from crossing the ramp's foot until the wheels first
    // leave the ground (exclusive) -- NOT the whole rest of the run, which
    // would also sweep up the post-landing samples, where z has continued
    // past the crest and the car has fallen back toward rest height. A car
    // that struck a vertical leading edge would never enter this window
    // with any forward speed at all -- it would stop dead at the wall.
    const firstAirborneIndex = samples.findIndex(
      (s, i) => i >= rampFootIndex && s.contacts === 0,
    );
    expect(firstAirborneIndex).toBeGreaterThan(rampFootIndex);
    const climb = samples.slice(rampFootIndex, firstAirborneIndex);
    expect(climb.length).toBeGreaterThan(5);

    for (let i = 1; i < climb.length; i++) {
      // A tiny epsilon guards against float noise at an otherwise-flat
      // sample without hiding a real regression back down the slope.
      expect(climb[i].position.y).toBeGreaterThanOrEqual(climb[i - 1].position.y - 1e-6);
    }

    const minClimbSpeed = Math.min(...climb.map((s) => s.forwardSpeedMs));
    // A car that hit a vertical edge loses nearly all forward speed on
    // impact -- this is what distinguishes a working ramp from the
    // researcher's failed probe (02-RESEARCH.md Open Question 2).
    expect(minClimbSpeed).toBeGreaterThanOrEqual(preRampSpeed * 0.6);
  });

  it("ramp launches the car airborne", () => {
    const { samples } = driveAtRampFullThrottle(RAMP_RUN_TICKS);

    const airborneAboveCrest = samples.find(
      (s) => s.contacts === 0 && s.position.y > RAMP_CREST_HEIGHT,
    );
    expect(airborneAboveCrest).toBeDefined();
  });

  it("lands driveable off the ramp", () => {
    const { samples } = driveAtRampFullThrottle(RAMP_RUN_TICKS);

    const launchIndex = samples.findIndex(
      (s) => s.contacts === 0 && s.position.y > RAMP_CREST_HEIGHT,
    );
    expect(launchIndex).toBeGreaterThan(-1);

    const touchdownIndex = samples.findIndex(
      (s, i) => i > launchIndex && s.contacts > 0,
    );
    expect(touchdownIndex).toBeGreaterThan(-1);

    // 0.5s of sim time is exactly 30 ticks at the fixed 60Hz timestep.
    const afterIndex = touchdownIndex + 30;
    expect(afterIndex).toBeLessThan(samples.length);
    const after = samples[afterIndex];

    expect(after.tiltDeg).toBeLessThan(20);
    const MPH_TO_MS = 0.44704;
    expect(after.forwardSpeedMs).toBeGreaterThan(40 * MPH_TO_MS);
  });

  it("anti-trivially-green companion: throttle 0 never leaves the ground", () => {
    // 02-PATTERNS.md's anti-trivially-green convention
    // (tests/determinism.test.ts:158-166): without this, the airborne
    // assertions above could pass for a reason unrelated to the ramp -- for
    // instance if the chassis spawned already clipping through the ground,
    // or if `contacts` were miscounted. This proves the ramp itself, not an
    // unrelated artifact, is what launches the car.
    const world = createWorld();
    const scene = createVehicleScene(world, defaultTuning());
    settle(world, scene, 60);

    let everAirborne = false;
    for (let t = 60; t < 60 + RAMP_RUN_TICKS; t++) {
      scene.preTick(t);
      scene.applyInput({ steer: 0, throttle: 0, brake: 0, handbrake: false });
      world.step();
      if (sampleVehicle(scene.vehicle).contacts === 0) {
        everAirborne = true;
      }
    }

    expect(everAirborne).toBe(false);
  });
});
