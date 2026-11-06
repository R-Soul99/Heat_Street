import { describe, expect, it } from "vitest";
import collisionRaw from "../public/maps/playground.collision.json?raw";
import compiledRaw from "../public/maps/playground.map.json?raw";
import { NEUTRAL } from "../src/core/input-tape";
import { parseMapCollision } from "../src/core/map-collision";
import { parseRoadGraph } from "../src/core/road-graph";
import { defaultSurfaceProfiles } from "../src/core/surface-tuning";
import { defaultTuning } from "../src/core/vehicle-tuning";
import { createMapScene } from "../src/physics/map-scene";
import { sampleVehicle } from "../src/physics/vehicle";
import { createWorld } from "../src/physics/world";

const graph = parseRoadGraph(compiledRaw, "playground.map.json");
const collision = parseMapCollision(collisionRaw, graph.areaId, "playground.collision.json");
const MPH = 0.44704;
const EAST = -Math.PI / 2;
/** The playground mud strip (z 398) ends at x=660; tarmac beyond. */
const MUD_Z = 398;
const EDGE_X = 660;

/**
 * Peak |yaw rate| over 6 s of a car sliding east on mud at `mph`, nose `offDeg`
 * off its velocity, 15 m before the strip's tarmac edge. Degrip is zeroed so
 * only the regrip blend (the part under test) differs, not the spawn tick.
 */
function crossingYawPeak(offDeg: number, mph: number, throttle: number, regripSec: number): number {
  const world = createWorld();
  const tuning = defaultTuning();
  tuning.wheels.surfaceRegripSec = regripSec;
  tuning.wheels.surfaceDegripSec = 0;
  const scene = createMapScene(world, graph, collision, tuning, defaultSurfaceProfiles());
  scene.resetVehicle({
    x: EDGE_X - 15,
    y: scene.defaultSpawnPose.y,
    z: MUD_Z,
    headingRad: EAST + (offDeg * Math.PI) / 180,
  });
  scene.vehicle.body.setLinvel({ x: mph * MPH, y: 0, z: 0 }, true);
  let peak = 0;
  for (let t = 0; t < 6 * 60; t++) {
    scene.applyInput({ ...NEUTRAL, throttle });
    world.step();
    peak = Math.max(peak, Math.abs(sampleVehicle(scene.vehicle).angvel.y));
  }
  return peak;
}

describe("surface regrip blend (mud onto tarmac)", () => {
  // Instant regrip (0) is the old behaviour: 25 deg / 45 mph gave 1.02 rad/s coasting
  // and 0.68 rad/s on throttle (0.19 / 0.13 with no crossing).
  const instantCoast = crossingYawPeak(25, 45, 0, 0);
  const instantPower = crossingYawPeak(25, 45, 1, 0);

  it("the instant-regrip baseline really does kick the car round on the crossing", () => {
    expect(instantCoast).toBeGreaterThan(0.8);
    expect(instantPower).toBeGreaterThan(0.25);
  });

  it("the default regrip blend cuts the crossing yaw kick by at least a quarter", () => {
    const tuned = defaultTuning().wheels.surfaceRegripSec;
    expect(tuned).toBeGreaterThan(0);
    expect(crossingYawPeak(25, 45, 0, tuned)).toBeLessThan(instantCoast * 0.75);
    expect(crossingYawPeak(25, 45, 1, tuned)).toBeLessThan(instantPower * 0.75);
  });

  it("changes nothing for a slide that never crosses a surface edge", () => {
    const run = (regrip: number) => {
      const tuning = defaultTuning();
      tuning.wheels.surfaceRegripSec = regrip;
      tuning.wheels.surfaceDegripSec = 0;
      const w = createWorld();
      const scene = createMapScene(w, graph, collision, tuning, defaultSurfaceProfiles());
      scene.resetVehicle({
        x: 300,
        y: scene.defaultSpawnPose.y,
        z: MUD_Z,
        headingRad: EAST + 0.44,
      });
      scene.vehicle.body.setLinvel({ x: 30 * MPH, y: 0, z: 0 }, true);
      for (let t = 0; t < 4 * 60; t++) {
        scene.applyInput({ ...NEUTRAL, throttle: 1 });
        w.step();
      }
      return sampleVehicle(scene.vehicle).position.x;
    };
    expect(Math.abs(run(0) - run(0.5))).toBeLessThan(0.05);
  });
});
