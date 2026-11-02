import * as RAPIER from "@dimforge/rapier3d";
import { describe, expect, it } from "vitest";
import { NEUTRAL } from "../src/core/input-tape";
import { defaultSurfaceProfiles } from "../src/core/surface-tuning";
import { createPaintMap, encodePaintValue } from "../src/core/terrain-paint";
import { defaultTuning } from "../src/core/vehicle-tuning";
import { createPaintLookup, createSurfaceMap, type SurfaceContext } from "../src/physics/surface";
import { createVehicle } from "../src/physics/vehicle";
import { createWorld } from "../src/physics/world";

const HALF = 50;

function buildGround(world: RAPIER.World): RAPIER.Collider {
  const body = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(0, -0.5, 0));
  return world.createCollider(RAPIER.ColliderDesc.cuboid(HALF, 0.5, HALF), body);
}

/** 100 m paint map, mud for x < 0, tarmac for x >= 0. */
function buildPaint() {
  const paint = createPaintMap({
    originX: -HALF,
    originZ: -HALF,
    widthM: 100,
    depthM: 100,
    metresPerPixel: 1,
    fill: "tarmac",
  });
  const mud = encodePaintValue("mud", false);
  for (let pz = 0; pz < paint.height; pz++) {
    for (let px = 0; px < HALF; px++) paint.data[pz * paint.width + px] = mud;
  }
  return paint;
}

function settle(
  world: RAPIER.World,
  vehicle: ReturnType<typeof createVehicle>,
  surfaces: SurfaceContext | undefined,
) {
  const tuning = defaultTuning();
  for (let i = 0; i < 30; i++) {
    vehicle.tick(NEUTRAL, tuning, surfaces);
    world.step();
  }
}

describe("per-wheel surface from the paint map", () => {
  it("wheels left of x = 0 report mud, right report tarmac", () => {
    const world = createWorld();
    try {
      const ground = buildGround(world);
      const map = createSurfaceMap("grass");
      map.register(ground.handle, "grass");
      const surfaces: SurfaceContext = {
        map,
        profiles: defaultSurfaceProfiles(),
        paint: createPaintLookup(ground.handle, buildPaint(), "grass"),
      };
      const vehicle = createVehicle(world, defaultTuning(), { x: 0, y: 1, z: 0 });
      settle(world, vehicle, surfaces);
      let mud = 0;
      let tarmac = 0;
      for (let i = 0; i < 4; i++) {
        const p = vehicle.controller.wheelContactPoint(i);
        expect(p).not.toBeNull();
        const expected = (p?.x ?? 0) < 0 ? "mud" : "tarmac";
        expect(vehicle.wheelSurfaces[i]).toBe(expected);
        if (expected === "mud") mud++;
        else tarmac++;
      }
      expect(mud).toBe(2);
      expect(tarmac).toBe(2);
    } finally {
      world.free();
    }
  });

  it("a ground collider other than paint.colliderHandle uses the SurfaceMap", () => {
    const world = createWorld();
    try {
      const ground = buildGround(world);
      const map = createSurfaceMap();
      map.register(ground.handle, "grass");
      const surfaces: SurfaceContext = {
        map,
        profiles: defaultSurfaceProfiles(),
        paint: createPaintLookup(ground.handle + 1000, buildPaint(), "tarmac"),
      };
      const vehicle = createVehicle(world, defaultTuning(), { x: 0, y: 1, z: 0 });
      settle(world, vehicle, surfaces);
      for (const s of vehicle.wheelSurfaces) expect(s).toBe("grass");
    } finally {
      world.free();
    }
  });

  it("without paint the legacy handle lookup is used", () => {
    const world = createWorld();
    try {
      const ground = buildGround(world);
      const map = createSurfaceMap();
      map.register(ground.handle, "sand");
      const vehicle = createVehicle(world, defaultTuning(), { x: 0, y: 1, z: 0 });
      settle(world, vehicle, { map, profiles: defaultSurfaceProfiles() });
      for (const s of vehicle.wheelSurfaces) expect(s).toBe("sand");
    } finally {
      world.free();
    }
  });

  it("airborne wheels keep their previous surface", () => {
    const world = createWorld();
    try {
      const ground = buildGround(world);
      const map = createSurfaceMap();
      const surfaces: SurfaceContext = {
        map,
        profiles: defaultSurfaceProfiles(),
        paint: createPaintLookup(ground.handle, buildPaint(), "tarmac"),
      };
      const vehicle = createVehicle(world, defaultTuning(), { x: -10, y: 1, z: 0 });
      settle(world, vehicle, surfaces);
      for (const s of vehicle.wheelSurfaces) expect(s).toBe("mud");
      // Lift the car out of ray range: ground becomes null or contact null.
      vehicle.body.setTranslation({ x: -10, y: 80, z: 0 }, true);
      vehicle.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      const tuning = defaultTuning();
      for (let i = 0; i < 3; i++) {
        vehicle.tick(NEUTRAL, tuning, surfaces);
        world.step();
      }
      for (const s of vehicle.wheelSurfaces) expect(s).toBe("mud");
    } finally {
      world.free();
    }
  });
});
