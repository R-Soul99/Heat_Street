import { describe, expect, it } from "vitest";
import collisionRaw from "../public/maps/playground.collision.json?raw";
import compiledRaw from "../public/maps/playground.map.json?raw";
import { shippedTuning } from "../src/core/feel";
import { NEUTRAL } from "../src/core/input-tape";
import { parseMapCollision } from "../src/core/map-collision";
import { parseRoadGraph } from "../src/core/road-graph";
import { defaultSurfaceProfiles } from "../src/core/surface-tuning";
import { createMapScene } from "../src/physics/map-scene";
import { sampleVehicle } from "../src/physics/vehicle";
import { createWorld } from "../src/physics/world";

const graph = parseRoadGraph(compiledRaw, "playground.map.json");
const collision = parseMapCollision(collisionRaw, graph.areaId, "playground.collision.json");
const MPH = 0.44704;
const EAST = -Math.PI / 2;

interface Run {
  readonly slipPeakDeg: number;
  readonly secOver10: number;
  readonly spun: boolean;
  readonly spinTicks: number;
}

/**
 * East-bound on the playground oval straight at `mph`: steer ramps to `steer`
 * over 0.25 s, is held to 1.4 s, then released. `wheelspinGain` 0 is the old car.
 */
function run(mph: number, steer: number, throttle: number, wheelspinGain: number): Run {
  const world = createWorld();
  const tuning = shippedTuning();
  tuning.drive.wheelspinGain = wheelspinGain;
  const scene = createMapScene(world, graph, collision, tuning, defaultSurfaceProfiles());
  scene.resetVehicle({ x: 170, y: scene.defaultSpawnPose.y, z: -490, headingRad: EAST });
  scene.vehicle.body.setLinvel({ x: mph * MPH, y: 0, z: 0 }, true);
  let peak = 0;
  let over = 0;
  let spun = false;
  let spinTicks = 0;
  for (let t = 0; t < 5 * 60; t++) {
    const sec = t / 60;
    const s = sec < 0.25 ? steer * (sec / 0.25) : sec < 1.4 ? steer : 0;
    scene.applyInput({ ...NEUTRAL, throttle, steer: s });
    world.step();
    const slip = Math.abs(sampleVehicle(scene.vehicle).slipAngleRad) * 57.3;
    peak = Math.max(peak, slip);
    if (slip > 10) over++;
    if (slip > 80) spun = true;
    if (scene.vehicle.rearGrip.dominant === "spin") spinTicks++;
  }
  return { slipPeakDeg: peak, secOver10: over / 60, spun, spinTicks };
}

describe("wheelspin oversteer", () => {
  it("lets throttle start a deeper, longer slide at speed (the old car stayed at 13-15 deg)", () => {
    // Measured 2026-11-06: 60 mph full steer, throttle held, slip peak 15 -> 25 deg.
    for (const mph of [60, 75]) {
      const off = run(mph, 1, 1, 0);
      const on = run(mph, 1, 1, 1);
      expect(on.slipPeakDeg, `${mph} mph`).toBeGreaterThan(off.slipPeakDeg + 4);
      expect(on.secOver10, `${mph} mph`).toBeGreaterThan(off.secOver10 + 0.2);
      expect(on.spun).toBe(false);
    }
  });

  it("does nothing without drive demand: coasting through the same corner is identical", () => {
    const off = run(45, 1, 0, 0);
    const on = run(45, 1, 0, 1);
    expect(on.spinTicks).toBe(0);
    expect(on.slipPeakDeg).toBeCloseTo(off.slipPeakDeg, 6);
  });

  it("does not make a straight line wander under full throttle", () => {
    for (const mph of [10, 60, 100]) {
      const r = run(mph, 0, 1, 1);
      expect(r.slipPeakDeg, `${mph} mph`).toBeLessThan(1);
    }
  });

  it("gain 0 switches it off completely", () => {
    expect(run(60, 1, 1, 0).spinTicks).toBe(0);
  });
});
