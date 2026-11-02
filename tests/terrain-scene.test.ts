import * as RAPIER from "@dimforge/rapier3d";
import { describe, expect, it } from "vitest";
import type { AuthoredCrest } from "../src/core/crest-geometry";
import type { MapCollisionBuilding } from "../src/core/map-collision";
import type { RoadGraph } from "../src/core/road-graph";
import { defaultSurfaceProfiles } from "../src/core/surface-tuning";
import { createTerrainGrid, sampleTerrainHeight, type TerrainGrid } from "../src/core/terrain-grid";
import { createPaintMap } from "../src/core/terrain-paint";
import { defaultTuning } from "../src/core/vehicle-tuning";
import { BUILDING_FRICTION, ROAD_FRICTION } from "../src/physics/map-scene";
import { createTerrainScene, type TerrainSceneInput } from "../src/physics/terrain-scene";
import terrainSceneSource from "../src/physics/terrain-scene.ts?raw";
import { createWorld } from "../src/physics/world";

function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function flatGrid(): TerrainGrid {
  return createTerrainGrid({ rows: 20, cols: 20, cellSizeM: 3, originX: -30, originZ: -30 });
}

function graphWith(withSpawn: boolean): RoadGraph {
  return {
    areaId: "test-area",
    nodes: [{ id: 1, x: 0, y: 0, z: 0, junction: false, osmNodeId: 1 }],
    edges: [],
    ...(withSpawn ? { spawns: [{ id: "default", nodeId: 1, headingRad: 0 }] } : {}),
  } as unknown as RoadGraph;
}

function input(grid: TerrainGrid, extra: Partial<TerrainSceneInput> = {}): TerrainSceneInput {
  return {
    areaId: "test-area",
    grid,
    paint: createPaintMap({
      originX: grid.originX,
      originZ: grid.originZ,
      widthM: grid.scaleX,
      depthM: grid.scaleZ,
      metresPerPixel: 1,
      fill: "grass",
    }),
    graph: graphWith(true),
    buildings: [],
    crests: [],
    groundSurface: "grass",
    ...extra,
  };
}

function colliders(world: RAPIER.World): RAPIER.Collider[] {
  const out: RAPIER.Collider[] = [];
  world.colliders.forEach((c) => {
    out.push(c);
  });
  return out;
}

const BUILDING: MapCollisionBuilding = {
  center: { x: 12, y: 3, z: 12 },
  halfExtents: { x: 2, y: 3, z: 2 },
  rotationY: 0.3,
};

const CREST: AuthoredCrest = { id: "c1", centerX: -15, centerZ: -15, radiusM: 6, heightM: 1.5 };

describe("createTerrainScene", () => {
  it("builds one flat-friction heightfield, spawns at terrain + 0.6, returns every MapScene key", () => {
    const world = createWorld();
    try {
      const grid = flatGrid();
      const scene = createTerrainScene(
        world,
        input(grid),
        defaultTuning(),
        defaultSurfaceProfiles(),
      );
      const all = colliders(world);
      const fields = all.filter((c) => c.shapeType() === RAPIER.ShapeType.HeightField);
      expect(fields).toHaveLength(1);
      expect(fields[0].friction()).toBeCloseTo(ROAD_FRICTION, 6);
      expect(scene.defaultSpawnPose.y).toBeCloseTo(sampleTerrainHeight(grid, 0, 0) + 0.6, 6);
      for (const key of [
        "bodies",
        "vehicle",
        "defaultSpawnPose",
        "surfaces",
        "preTick",
        "applyInput",
        "setTuning",
        "setSurfaceProfiles",
        "resetVehicle",
        "dispose",
      ]) {
        expect(scene).toHaveProperty(key);
      }
      expect(scene.surfaces.paint?.colliderHandle).toBe(fields[0].handle);
    } finally {
      world.free();
    }
  });

  it("source uses HeightFieldFlags.FIX_INTERNAL_EDGES", () => {
    expect(terrainSceneSource).toContain("HeightFieldFlags.FIX_INTERNAL_EDGES");
  });

  it("a crest adds one TriMesh registered with the ground surface", () => {
    const world = createWorld();
    try {
      const scene = createTerrainScene(
        world,
        input(flatGrid(), { crests: [CREST] }),
        defaultTuning(),
        defaultSurfaceProfiles(),
      );
      const meshes = colliders(world).filter((c) => c.shapeType() === RAPIER.ShapeType.TriMesh);
      expect(meshes).toHaveLength(1);
      expect(scene.surfaces.map.lookup(meshes[0].handle)).toBe("grass");
    } finally {
      world.free();
    }
  });

  it("each building adds one cuboid with building friction", () => {
    const world = createWorld();
    try {
      createTerrainScene(
        world,
        input(flatGrid(), {
          buildings: [BUILDING, { ...BUILDING, center: { x: -12, y: 3, z: 12 } }],
        }),
        defaultTuning(),
        defaultSurfaceProfiles(),
      );
      const boxes = colliders(world).filter(
        (c) =>
          c.shapeType() === RAPIER.ShapeType.Cuboid &&
          Math.abs(c.friction() - BUILDING_FRICTION) < 1e-6,
      );
      expect(boxes.length).toBeGreaterThanOrEqual(2);
    } finally {
      world.free();
    }
  });

  it("spawnOverride sets the pose; y is recomputed from terrain + 0.6", () => {
    const world = createWorld();
    try {
      const grid = flatGrid();
      for (let i = 0; i < grid.heights.length; i++) grid.heights[i] = 2;
      const scene = createTerrainScene(
        world,
        input(grid, { spawnOverride: { x: 5, z: -4, headingRad: 1.2 } }),
        defaultTuning(),
        defaultSurfaceProfiles(),
      );
      expect(scene.defaultSpawnPose.x).toBe(5);
      expect(scene.defaultSpawnPose.z).toBe(-4);
      expect(scene.defaultSpawnPose.headingRad).toBe(1.2);
      expect(scene.defaultSpawnPose.y).toBeCloseTo(2.6, 5);
    } finally {
      world.free();
    }
  });

  it("throws naming the area when there is no default spawn and no override", () => {
    const world = createWorld();
    try {
      expect(() =>
        createTerrainScene(
          world,
          input(flatGrid(), { graph: graphWith(false) }),
          defaultTuning(),
          defaultSurfaceProfiles(),
        ),
      ).toThrow(/test-area/);
    } finally {
      world.free();
    }
  });

  it("heightfield raycasts match sampleTerrainHeight at 50 seeded points", () => {
    const world = createWorld();
    try {
      const grid = flatGrid();
      const rand = lcg(4242);
      for (let i = 0; i < grid.heights.length; i++) grid.heights[i] = rand() * 6 - 3;
      createTerrainScene(world, input(grid), defaultTuning(), defaultSurfaceProfiles());
      world.step(); // refresh the query pipeline
      for (let i = 0; i < 50; i++) {
        const x = grid.originX + 0.01 + rand() * (grid.scaleX - 0.02);
        const z = grid.originZ + 0.01 + rand() * (grid.scaleZ - 0.02);
        const ray = new RAPIER.Ray({ x, y: 50, z }, { x: 0, y: -1, z: 0 });
        const hit = world.castRay(
          ray,
          200,
          true,
          undefined,
          undefined,
          undefined,
          undefined,
          (c) => c.shapeType() === RAPIER.ShapeType.HeightField,
        );
        expect(hit).not.toBeNull();
        const y = 50 - (hit?.timeOfImpact ?? 0);
        expect(Math.abs(y - sampleTerrainHeight(grid, x, z))).toBeLessThan(1e-3);
      }
    } finally {
      world.free();
    }
  });
});
