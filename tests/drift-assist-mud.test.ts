import { describe, expect, it } from "vitest";
import { shippedTuning } from "../src/core/feel";
import { defaultSurfaceProfiles } from "../src/core/surface-tuning";
import { createSurfaceScene } from "../src/physics/surface-scene";
import { sampleVehicle } from "../src/physics/vehicle";
import { createWorld } from "../src/physics/world";

const MPH = 0.44704;
const Z = { sand: -120, mud: -200, gravel: 120 } as const;

/** Held full lock + throttle from 30 mph; returns the slip angles (deg) sampled every 0.25 s. */
function slips(surface: keyof typeof Z): number[] {
  const world = createWorld();
  try {
    const scene = createSurfaceScene(world, shippedTuning(), defaultSurfaceProfiles());
    scene.vehicle.body.setTranslation({ x: 0, y: 0.6, z: Z[surface] }, true);
    scene.vehicle.body.setLinvel({ x: 0, y: 0, z: -30 * MPH }, true);
    const out: number[] = [];
    for (let i = 0; i < 60 * 8; i++) {
      scene.applyInput({ steer: i >= 20 ? 1 : 0, throttle: 1, brake: 0, handbrake: false });
      world.step();
      if (i % 15 === 0) out.push(sampleVehicle(scene.vehicle).slipAngleRad * 57.3);
    }
    return out;
  } finally {
    world.free();
  }
}

describe("drift assist on loose ground", () => {
  it.each(["mud", "sand", "gravel"] as const)(
    "%s: a held-lock slide stays bounded (under 70 deg) and never spins",
    (s) => {
      const v = slips(s).slice(8);
      expect(Math.max(...v.map(Math.abs))).toBeLessThan(70);
    },
  );
});
