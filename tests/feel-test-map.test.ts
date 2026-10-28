import { describe, expect, it } from "vitest";
import collisionRaw from "../public/maps/feel-test.collision.json?raw";
import compiledRaw from "../public/maps/feel-test.map.json?raw";
import stationsRaw from "../public/maps/feel-test.stations.json?raw";
import { type InputFrame, NEUTRAL } from "../src/core/input-tape";
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

function launch(stationId: string, speedMph: number, frame: InputFrame, seconds: number) {
  const world = createWorld();
  const scene = createMapScene(world, graph, collision, defaultTuning(), defaultSurfaceProfiles());
  const station = stations.find((s) => s.id === stationId);
  if (station === undefined) throw new Error(`no station ${stationId}`);
  scene.resetVehicle({
    x: station.x,
    y: scene.defaultSpawnPose.y,
    z: station.z,
    headingRad: station.headingRad,
  });
  scene.vehicle.body.setLinvel(launchVelocity(station.headingRad, speedMph), true);
  const out: {
    x: number;
    y: number;
    z: number;
    speed: number;
    contacts: number;
    surfaces: string[];
  }[] = [];
  for (let t = 0; t < seconds * 60; t++) {
    scene.applyInput(frame);
    world.step();
    const s = sampleVehicle(scene.vehicle);
    out.push({
      x: s.position.x,
      y: s.position.y,
      z: s.position.z,
      speed: s.groundSpeedMs,
      contacts: s.contacts,
      surfaces: [...scene.vehicle.wheelSurfaces],
    });
  }
  return out;
}

describe("feel-test proving ground", () => {
  it("has no buildings and one launch pad per station key", () => {
    expect(collision.buildings).toHaveLength(0);
    expect(new Set(stations.map((s) => s.key)).size).toBe(stations.length);
    expect(stations.length).toBeGreaterThanOrEqual(10);
  });

  it("every launch pad drops the car on solid ground that holds it level", () => {
    for (const station of stations) {
      const run = launch(station.id, 0, NEUTRAL, 1);
      const end = run[run.length - 1];
      expect(end.contacts, station.id).toBe(4);
      expect(Math.abs(end.y - run[0].y), station.id).toBeLessThan(1);
    }
  });

  it("a 70 mph launch down the long straight keeps its speed and stays on the road line", () => {
    const run = launch("straight", 70, NEUTRAL, 3);
    const start = run[0];
    const end = run[run.length - 1];
    expect(end.speed).toBeGreaterThan(25);
    expect(end.x).toBeGreaterThan(start.x + 60);
    expect(Math.abs(end.z - start.z)).toBeLessThan(1);
    expect(end.contacts).toBe(4);
  });

  it("leaving the painted road never changes the surface: every wheel stays on tarmac", () => {
    const run = launch("straight", 60, { ...NEUTRAL, steer: 0.6 }, 4);
    const offRoad = run.filter((r) => Math.abs(r.z - run[0].z) > 12);
    expect(offRoad.length).toBeGreaterThan(30);
    for (const r of run) for (const surface of r.surfaces) expect(surface).toBe("tarmac");
  });

  it("the jumps launch the car: 80 mph over the big air leaves the ground", () => {
    const run = launch("jumps-b", 80, { ...NEUTRAL, throttle: 1 }, 6);
    const airborne = run.filter((r) => r.contacts === 0).length;
    expect(airborne).toBeGreaterThan(20);
    expect(Math.max(...run.map((r) => r.y))).toBeGreaterThan(run[0].y + 1.5);
  });
});
