import { describe, expect, it } from "vitest";
import { shippedTuning } from "../src/core/feel";
import { defaultSurfaceProfiles } from "../src/core/surface-tuning";
import { createSurfaceScene } from "../src/physics/surface-scene";
import { sampleVehicle } from "../src/physics/vehicle";
import { createWorld } from "../src/physics/world";

const MPH = 0.44704;
/** Centre z of each band in the surface test scene (tarmac, gravel, dirt, grass, sand, mud). */
const BAND_Z = { tarmac: 200, gravel: 120, grass: 40, sand: -120, mud: -200 } as const;

/** Rolling start at `startMph`, then full lock + full throttle for 6 s; returns the final speed in mph. */
function finalMph(surface: keyof typeof BAND_Z, startMph: number): number {
  const world = createWorld();
  try {
    const scene = createSurfaceScene(world, shippedTuning(), defaultSurfaceProfiles());
    scene.vehicle.body.setTranslation({ x: 0, y: 0.6, z: BAND_Z[surface] }, true);
    scene.vehicle.body.setLinvel({ x: 0, y: 0, z: -startMph * MPH }, true);
    for (let i = 0; i < 60 * 6; i++) {
      const on = i >= 20;
      scene.applyInput({ steer: on ? 1 : 0, throttle: on ? 1 : 0, brake: 0, handbrake: false });
      world.step();
    }
    return sampleVehicle(scene.vehicle).groundSpeedMs / MPH;
  } finally {
    world.free();
  }
}

describe("pivot from a rolling start on loose ground", () => {
  it.each(["mud", "sand", "gravel", "grass"] as const)(
    "%s: full lock + throttle from 20 mph settles into a ~8 mph pivot, not a wide arc",
    (surface) => {
      expect(finalMph(surface, 20)).toBeLessThan(12);
    },
  );

  it("tarmac: the same input from 20 mph still drives out (no capture, the 10-25 mph bog stays fixed)", () => {
    expect(finalMph("tarmac", 20)).toBeGreaterThan(25);
  });
});
