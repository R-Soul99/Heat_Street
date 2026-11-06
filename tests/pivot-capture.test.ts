import * as RAPIER from "@dimforge/rapier3d";
import { describe, expect, it } from "vitest";
import { shippedTuning } from "../src/core/feel";
import { createVehicle, sampleVehicle } from "../src/physics/vehicle";
import { createWorld } from "../src/physics/world";

const MPH = 0.44704;

/** Full lock (ramped like a key) + full throttle on a flat plane; returns the slowest and final speed in mph. */
function fullLockFullThrottle(
  launchMph: number,
  seconds: number,
): { minMph: number; endMph: number } {
  const world = createWorld();
  try {
    const t = shippedTuning();
    const ground = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(0, -1, 0));
    world.createCollider(RAPIER.ColliderDesc.cuboid(20000, 1, 20000), ground);
    const v = createVehicle(world, t, { x: 0, y: 1, z: 0 });
    for (let k = 0; k < 120; k++) {
      v.tick({ steer: 0, throttle: 0, brake: 0, handbrake: false }, t);
      world.step();
    }
    v.body.setLinvel({ x: 0, y: 0, z: -launchMph * MPH }, true);
    let minMph = Number.POSITIVE_INFINITY;
    let endMph = 0;
    for (let i = 0; i < seconds * 60; i++) {
      v.tick({ steer: Math.min(1, i / 9), throttle: 1, brake: 0, handbrake: false }, t);
      world.step();
      endMph = sampleVehicle(v).groundSpeedMs / MPH;
      if (i > 60) minMph = Math.min(minMph, endMph);
    }
    return { minMph, endMph };
  } finally {
    world.free();
  }
}

describe("pivot capture (2026-11-06 hand drives: low-speed corners bogged to ~8 mph)", () => {
  it("full lock + full throttle at 15 mph is NOT captured into a doughnut: the car drives away", () => {
    const r = fullLockFullThrottle(15, 6);
    expect(r.minMph).toBeGreaterThan(15);
    expect(r.endMph).toBeGreaterThan(25);
  });

  it("the same input from rest still makes a doughnut that holds near 8 mph", () => {
    const r = fullLockFullThrottle(0, 6);
    expect(r.endMph).toBeLessThan(12);
  });
});
