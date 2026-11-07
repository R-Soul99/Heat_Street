import * as RAPIER from "@dimforge/rapier3d";
import { describe, expect, it } from "vitest";
import { lineOfSightClear } from "../src/physics/ai-avoidance";
import { createWorld } from "../src/physics/world";

describe("lineOfSightClear", () => {
  it("is blocked by a building between the cars, clear without it, and ignores other cars", () => {
    const world = createWorld();
    try {
      const wall = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(0, 5, 0));
      world.createCollider(RAPIER.ColliderDesc.cuboid(10, 5, 1), wall);
      const car = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(0, 1, 20));
      const carCollider = world.createCollider(RAPIER.ColliderDesc.cuboid(1, 1.5, 2), car);
      world.step();
      const none = new Set<number>();
      const cars = new Set<number>([carCollider.handle]);
      // Across the wall (z -10 -> 10): blocked.
      expect(lineOfSightClear(world, { x: 0, y: 1, z: -10 }, { x: 0, y: 1, z: 10 }, none)).toBe(
        false,
      );
      // Beside the wall (x 30): clear.
      expect(lineOfSightClear(world, { x: 30, y: 1, z: -10 }, { x: 30, y: 1, z: 10 }, none)).toBe(
        true,
      );
      // A car in the ray's path does not block when it is in the car set, does when it is not.
      expect(lineOfSightClear(world, { x: 0, y: 1, z: 10 }, { x: 0, y: 1, z: 30 }, cars)).toBe(
        true,
      );
      expect(lineOfSightClear(world, { x: 0, y: 1, z: 10 }, { x: 0, y: 1, z: 30 }, none)).toBe(
        false,
      );
    } finally {
      world.free();
    }
  });
});
