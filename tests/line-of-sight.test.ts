import * as RAPIER from "@dimforge/rapier3d";
import { describe, expect, it } from "vitest";
import type { RoadGraph } from "../src/core/road-graph";
import { defaultSurfaceProfiles } from "../src/core/surface-tuning";
import { createTerrainGrid } from "../src/core/terrain-grid";
import { createPaintMap } from "../src/core/terrain-paint";
import { defaultTuning } from "../src/core/vehicle-tuning";
import { lineOfSightClear } from "../src/physics/ai-avoidance";
import { createTerrainScene } from "../src/physics/terrain-scene";
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

  it("a hedge blocks sight; trunks and fences do not once their handles are ignored", () => {
    const world = createWorld();
    try {
      const grid = createTerrainGrid({
        rows: 20,
        cols: 20,
        cellSizeM: 3,
        originX: -30,
        originZ: -30,
      });
      const scene = createTerrainScene(
        world,
        {
          areaId: "los",
          grid,
          paint: createPaintMap({
            originX: -30,
            originZ: -30,
            widthM: 60,
            depthM: 60,
            metresPerPixel: 1,
            fill: "grass",
          }),
          graph: { areaId: "los", nodes: [], edges: [] } as unknown as RoadGraph,
          buildings: [],
          crests: [],
          groundSurface: "grass",
          features: [
            {
              id: "h",
              kind: "hedge",
              variant: "box",
              points: [
                [-5, 0],
                [5, 0],
              ],
              heightM: 3,
            },
            {
              id: "f",
              kind: "fence",
              variant: "picket",
              points: [
                [-5, 10],
                [5, 10],
              ],
              heightM: 3,
            },
            { id: "t", kind: "tree", variant: "pine", x: 0, z: -10, rotationY: 0, scale: 1 },
          ],
        },
        defaultTuning(),
        defaultSurfaceProfiles(),
      );
      world.step();
      const none = new Set<number>();
      const ignore = new Set<number>(scene.sightTransparentHandles);
      const across = (z0: number, z1: number, ig: ReadonlySet<number>) =>
        lineOfSightClear(world, { x: 0, y: 0.5, z: z0 }, { x: 0, y: 0.5, z: z1 }, ig);
      expect(across(-4, 4, none)).toBe(false);
      expect(across(-4, 4, ignore)).toBe(false); // hedge still blocks
      expect(across(6, 14, none)).toBe(false);
      expect(across(6, 14, ignore)).toBe(true); // fence see-through
      expect(across(-14, -6, none)).toBe(false);
      expect(across(-14, -6, ignore)).toBe(true); // trunk see-through
    } finally {
      world.free();
    }
  });
});
