import { describe, expect, it } from "vitest";
import collisionRaw from "../public/maps/feel-test.collision.json?raw";
import compiledRaw from "../public/maps/feel-test.map.json?raw";
import stationsRaw from "../public/maps/feel-test.stations.json?raw";
import { NEUTRAL } from "../src/core/input-tape";
import { parseMapCollision } from "../src/core/map-collision";
import { parseRoadGraph } from "../src/core/road-graph";
import { defaultSurfaceProfiles } from "../src/core/surface-tuning";
import { defaultTuning } from "../src/core/vehicle-tuning";
import { launchVelocity, parseStations } from "../src/debug/test-stations";
import { createMapScene } from "../src/physics/map-scene";
import { sampleVehicle } from "../src/physics/vehicle";
import { createWorld } from "../src/physics/world";

const graph = parseRoadGraph(compiledRaw, "public/maps/feel-test.map.json");
const collision = parseMapCollision(
  collisionRaw,
  graph.areaId,
  "public/maps/feel-test.collision.json",
);
const stations = parseStations(stationsRaw, graph.areaId);

/**
 * Drive log 2026-10-28: a 13 deg slide at 93 mph, recovered into, rolled the
 * car 90 deg on flat tarmac. Reproduce it: travel along the straight with the
 * body yawed `yawOffDeg` away from the velocity, wheels straight, throttle on.
 */
function peakRollDeg(guard: number, yawOffDeg: number, yawRate: number): number {
  const tuning = defaultTuning();
  tuning.drive.rollGuard = guard;
  const world = createWorld();
  const scene = createMapScene(world, graph, collision, tuning, defaultSurfaceProfiles());
  const station = stations.find((s) => s.id === "straight");
  if (station === undefined) throw new Error("no straight station");
  scene.resetVehicle({
    x: station.x,
    y: scene.defaultSpawnPose.y,
    z: station.z,
    headingRad: station.headingRad + (yawOffDeg * Math.PI) / 180,
  });
  scene.vehicle.body.setLinvel(launchVelocity(station.headingRad, 93), true);
  scene.vehicle.body.setAngvel({ x: 0, y: yawRate, z: 0 }, true);
  let peak = 0;
  for (let t = 0; t < 3 * 60; t++) {
    scene.applyInput({ ...NEUTRAL, throttle: 1 });
    world.step();
    peak = Math.max(peak, Math.abs(sampleVehicle(scene.vehicle).rollDeg));
  }
  return peak;
}

describe("roll guard", () => {
  it("without the guard the log's 93 mph slide rolls the car over", () => {
    expect(peakRollDeg(0, 14, 0.9)).toBeGreaterThan(60);
  });

  it("at the default strength the same slide stays on its wheels", () => {
    expect(peakRollDeg(defaultTuning().drive.rollGuard, 14, 0.9)).toBeLessThan(35);
  });

  it("does not touch a slide that never rolls past the onset angle", () => {
    expect(peakRollDeg(0.85, 25, 0)).toBe(peakRollDeg(0, 25, 0));
  });
});
