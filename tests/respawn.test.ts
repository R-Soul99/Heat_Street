import { describe, expect, it } from "vitest";
import collisionRaw from "../public/maps/juliette-ga.collision.json?raw";
import compiledRaw from "../public/maps/juliette-ga.map.json?raw";
import { NEUTRAL } from "../src/core/input-tape";
import { parseMapCollision } from "../src/core/map-collision";
import { parseRoadGraph } from "../src/core/road-graph";
import { defaultSurfaceProfiles } from "../src/core/surface-tuning";
import { defaultTuning } from "../src/core/vehicle-tuning";
import { createMapScene } from "../src/physics/map-scene";
import { sampleVehicle } from "../src/physics/vehicle";
import { createWorld } from "../src/physics/world";

const graph = parseRoadGraph(compiledRaw, "juliette-ga.map.json");
const collision = parseMapCollision(collisionRaw, graph.areaId, "juliette-ga.collision.json");

describe("MapScene.resetVehicle", () => {
  it("resets the existing body upright at the authored heading with zero velocity", () => {
    const world = createWorld();
    const scene = createMapScene(world, graph, collision, defaultTuning(), defaultSurfaceProfiles());
    const body = scene.vehicle.body;
    const originalBody = body;
    const pose = { x: 12, y: 4, z: -8, headingRad: Math.PI / 3 };

    body.setTranslation({ x: pose.x + 20, y: pose.y + 4, z: pose.z - 20 }, true);
    body.setLinvel({ x: 12, y: 8, z: -6 }, true);
    body.setAngvel({ x: 2, y: 3, z: 4 }, true);
    scene.resetVehicle(pose);

    expect(scene.vehicle.body).toBe(originalBody);
    const sample = sampleVehicle(scene.vehicle);
    expect(sample.position.x).toBeCloseTo(pose.x);
    expect(sample.position.y).toBeCloseTo(pose.y);
    expect(sample.position.z).toBeCloseTo(pose.z);
    expect(sample.rotation.y).toBeCloseTo(Math.sin(pose.headingRad / 2));
    expect(sample.rotation.w).toBeCloseTo(Math.cos(pose.headingRad / 2));
    expect(sample.tiltDeg).toBe(0);
    expect(sample.linvel).toEqual({ x: 0, y: 0, z: 0 });
    expect(sample.angvel).toEqual({ x: 0, y: 0, z: 0 });

    scene.applyInput(NEUTRAL);
    world.step();
    const settled = sampleVehicle(scene.vehicle);
    expect(settled.tiltDeg).toBeLessThan(1);
    expect(settled.groundSpeedMs).toBeLessThan(0.01);
  });

  it("rejects non-finite reset poses at the physics boundary", () => {
    const world = createWorld();
    const scene = createMapScene(world, graph, collision, defaultTuning(), defaultSurfaceProfiles());

    expect(() => scene.resetVehicle({ x: Number.NaN, y: 0, z: 0, headingRad: 0 })).toThrow(
      "finite",
    );
  });
});