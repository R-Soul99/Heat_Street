import * as RAPIER from "@dimforge/rapier3d";
import { describe, expect, it } from "vitest";
import { shippedTuning } from "../src/core/feel";
import { defaultSurfaceProfiles } from "../src/core/surface-tuning";
import type { SurfaceType } from "../src/core/surface-types";
import { createSurfaceMap } from "../src/physics/surface";
import { createVehicle } from "../src/physics/vehicle";
import { createWorld } from "../src/physics/world";

const MPH = 0.44704;

/** Full lock + full throttle from 45 mph on a 10 km square of one surface; returns how far the direction of travel turned (deg) in 6 s. */
function pathTurnDeg(surface: SurfaceType, looseTraction: number): number {
  const world = createWorld();
  try {
    const t = shippedTuning();
    t.drive.looseTraction = looseTraction;
    const ground = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(0, -1, 0));
    const collider = world.createCollider(RAPIER.ColliderDesc.cuboid(5000, 1, 5000), ground);
    const map = createSurfaceMap("tarmac");
    map.register(collider.handle, surface);
    const surfaces = { map, profiles: defaultSurfaceProfiles() };
    const vehicle = createVehicle(world, t, { x: 0, y: 1, z: 0 });
    const idle = { steer: 0, throttle: 0, brake: 0, handbrake: false };
    for (let i = 0; i < 90; i++) {
      vehicle.tick(idle, t, surfaces);
      world.step();
    }
    vehicle.body.setLinvel({ x: 0, y: 0, z: -45 * MPH }, true);
    let turned = 0;
    let last = Math.PI;
    for (let i = 0; i < 360; i++) {
      vehicle.tick({ steer: 1, throttle: 1, brake: 0, handbrake: false }, t, surfaces);
      world.step();
      const v = vehicle.body.linvel();
      const h = Math.atan2(v.x, v.z);
      turned += Math.atan2(Math.sin(h - last), Math.cos(h - last));
      last = h;
    }
    return Math.abs(turned) * 57.3;
  } finally {
    world.free();
  }
}

describe("loose-ground traction assist (mud drive 2026-11-07: full lock at 45 mph barely turned)", () => {
  it("mud: a held full-lock slide at speed goes round the corner noticeably more", () => {
    expect(pathTurnDeg("mud", 0.3)).toBeGreaterThan(pathTurnDeg("mud", 0) * 1.3);
  });

  it("tarmac is untouched", () => {
    expect(pathTurnDeg("tarmac", 0.3)).toBeCloseTo(pathTurnDeg("tarmac", 0), 6);
  });
});
