import { describe, expect, it } from "vitest";
import { shippedTuning } from "../src/core/feel";
import { defaultSurfaceProfiles } from "../src/core/surface-tuning";
import { createSurfaceScene } from "../src/physics/surface-scene";
import { sampleVehicle } from "../src/physics/vehicle";
import { createWorld } from "../src/physics/world";
import raw from "./fixtures/drive-mud-snapback-2026-11-07.csv?raw";

const MPH = 0.44704;
const rows = raw
  .trim()
  .split("\n")
  .slice(1)
  .map((l) => l.split(",").map(Number));

/** Replays the 2026-11-07 mud drive from 16.7 s (full lock + throttle held) and returns slip (deg) per tick. */
function replay(): number[] {
  const world = createWorld();
  try {
    const scene = createSurfaceScene(world, shippedTuning(), defaultSurfaceProfiles());
    scene.vehicle.body.setTranslation({ x: 0, y: 0.6, z: -200 }, true);
    const r0 = rows[0] as number[];
    const sp = (r0[8] as number) * MPH;
    const a = (r0[10] as number) / 57.3;
    scene.vehicle.body.setLinvel({ x: Math.sin(a) * sp, y: 0, z: -Math.cos(a) * sp }, true);
    return rows.map((r) => {
      scene.applyInput({
        steer: r[3] as number,
        throttle: r[4] as number,
        brake: 0,
        handbrake: false,
      });
      world.step();
      return sampleVehicle(scene.vehicle).slipAngleRad * 57.3;
    });
  } finally {
    world.free();
  }
}

describe("drift assist never swings a held slide back against the key (mud drive 2026-11-07)", () => {
  it("once the slide is deep it is not thrown back toward straight while the key is held", () => {
    const s = replay();
    const peakAt = s.reduce((best, v, i) => (v > (s[best] as number) ? i : best), 0);
    const afterPeak = s.slice(peakAt);
    // The old full-strength pull-back took this from 80+ deg to ~0 within a second.
    expect(Math.min(...afterPeak)).toBeGreaterThan(40);
  });
});
