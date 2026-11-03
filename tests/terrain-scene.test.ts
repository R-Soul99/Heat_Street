import { readFileSync } from "node:fs";
import * as RAPIER from "@dimforge/rapier3d";
import { describe, expect, it } from "vitest";
import type { AuthoredCrest } from "../src/core/crest-geometry";
import { type InputFrame, NEUTRAL } from "../src/core/input-tape";
import type { MapCollisionBuilding } from "../src/core/map-collision";
import type { RoadGraph } from "../src/core/road-graph";
import { defaultSurfaceProfiles } from "../src/core/surface-tuning";
import { BERM_INSET_M, BERM_THICKNESS_M, buildEdgeBerm } from "../src/core/terrain-edge-berm";
import { loadTerrainArea } from "../src/core/terrain-format";
import { createTerrainGrid, sampleTerrainHeight, type TerrainGrid } from "../src/core/terrain-grid";
import { createPaintMap } from "../src/core/terrain-paint";
import { defaultTuning } from "../src/core/vehicle-tuning";
import { BUILDING_FRICTION, ROAD_FRICTION } from "../src/physics/map-scene";
import {
  buildTerrainCollider,
  createTerrainScene,
  type TerrainSceneInput,
} from "../src/physics/terrain-scene";
import terrainSceneSource from "../src/physics/terrain-scene.ts?raw";
import { sampleVehicle } from "../src/physics/vehicle";
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

  it("WR-05: extraTerrain (gate course) adds a second painted heightfield chained into surfaces.paint", () => {
    const world = createWorld();
    try {
      const grid = flatGrid();
      const gateGrid = createTerrainGrid({
        rows: 10,
        cols: 10,
        cellSizeM: 3,
        originX: 700,
        originZ: 0,
      });
      const gatePaint = createPaintMap({
        originX: 700,
        originZ: 0,
        widthM: 30,
        depthM: 30,
        metresPerPixel: 1,
        fill: "tarmac",
      });
      const scene = createTerrainScene(
        world,
        input(grid, { extraTerrain: { grid: gateGrid, paint: gatePaint } }),
        defaultTuning(),
        defaultSurfaceProfiles(),
      );
      const fields = colliders(world).filter((c) => c.shapeType() === RAPIER.ShapeType.HeightField);
      expect(fields).toHaveLength(2);
      const handles = new Set<number>();
      for (let p = scene.surfaces.paint; p !== undefined; p = p.next) handles.add(p.colliderHandle);
      expect(handles).toEqual(new Set(fields.map((f) => f.handle)));
      // The gate lookup reads the gate paint; the main one reads feel-test's.
      const head = scene.surfaces.paint;
      expect(head?.surfaceAt(715, 15)).toBe("tarmac");
      expect(head?.next?.surfaceAt(0, 0)).toBe("grass");
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

describe("terrain edge berm (04.3 D-06..D-10)", () => {
  const FRAME_FULL: InputFrame = { steer: 0, throttle: 1, brake: 0, handbrake: false };

  function drive(opts: { upward: number; seconds: number; throttle: boolean }) {
    const world = createWorld();
    try {
      const grid = flatGrid(); // x/z -30..30
      // heading pi/2: forward = (-1, 0), straight at the west edge from x = -10
      const scene = createTerrainScene(
        world,
        input(grid, { spawnOverride: { x: -10, z: 0, headingRad: Math.PI / 2 } }),
        defaultTuning(),
        defaultSurfaceProfiles(),
      );
      scene.vehicle.body.setLinvel({ x: -30, y: opts.upward, z: 0 }, true);
      const track: { x: number; y: number }[] = [];
      for (let t = 0; t < opts.seconds * 60; t++) {
        scene.applyInput(opts.throttle ? FRAME_FULL : NEUTRAL);
        world.step();
        const s = sampleVehicle(scene.vehicle);
        track.push({ x: s.position.x, y: s.position.y });
      }
      return track;
    } finally {
      world.free();
    }
  }

  it("adds one fixed body carrying one cuboid per berm box, and exposes edgeBerm", () => {
    const world = createWorld();
    try {
      const grid = flatGrid();
      const scene = createTerrainScene(
        world,
        input(grid),
        defaultTuning(),
        defaultSurfaceProfiles(),
      );
      const berm = buildEdgeBerm(grid);
      expect(scene.edgeBerm).toEqual(berm);
      const cuboids = colliders(world).filter((c) => c.shapeType() === RAPIER.ShapeType.Cuboid);
      const bermCuboids = cuboids.filter((c) => Math.abs(c.friction() - BUILDING_FRICTION) < 1e-6);
      expect(bermCuboids.length).toBeGreaterThanOrEqual(berm.length);
      const parents = new Set(bermCuboids.map((c) => c.parent()?.handle));
      expect(parents.size).toBe(1);
    } finally {
      world.free();
    }
  });

  it("a car driven at the edge at 30 m/s is stopped by the berm: no teleport", () => {
    const track = drive({ upward: 0, seconds: 3, throttle: true });
    let prev = track[0];
    for (const p of track) {
      expect(p.x).toBeGreaterThan(-30 - BERM_THICKNESS_M);
      expect(Math.abs(p.y)).toBeLessThan(3);
      expect(Math.abs(p.x - prev.x)).toBeLessThan(30 / 60 + 0.5);
      prev = p;
    }
    expect(track[track.length - 1].x).toBeLessThan(-20); // it did reach the wall
  });

  it("a big jump clears the berm and the car then falls (no respawn)", () => {
    const track = drive({ upward: 12, seconds: 3, throttle: false });
    const end = track[track.length - 1];
    expect(end.x).toBeLessThan(-30 - BERM_THICKNESS_M);
    expect(end.y).toBeLessThan(0);
  });

  it("buildTerrainCollider alone creates no berm colliders", () => {
    const world = createWorld();
    try {
      const grid = flatGrid();
      const i = input(grid);
      buildTerrainCollider(world, grid, i.paint, "grass");
      expect(colliders(world)).toHaveLength(1);
    } finally {
      world.free();
    }
  });

  it("default spawn is at least 10 m inside the berm inner face on every tracked terrain map", async () => {
    for (const id of ["demo-hills", "feel-test", "grid-test", "juliette-ga"]) {
      const bin = new Uint8Array(readFileSync(`public/maps/${id}.terrain.bin`));
      const json = readFileSync(`public/maps/${id}.terrain.json`, "utf8");
      const area = await loadTerrainArea(bin, json, id, `${id}.terrain`);
      const world = createWorld();
      try {
        const scene = createTerrainScene(
          world,
          {
            areaId: id,
            grid: area.grid,
            paint: area.paint,
            graph: area.graph,
            buildings: area.buildings,
            crests: [],
            groundSurface: area.groundSurface,
          },
          defaultTuning(),
          defaultSurfaceProfiles(),
        );
        const g = area.grid;
        const p = scene.defaultSpawnPose;
        const inside = Math.min(
          p.x - (g.originX + BERM_INSET_M),
          g.originX + g.scaleX - BERM_INSET_M - p.x,
          p.z - (g.originZ + BERM_INSET_M),
          g.originZ + g.scaleZ - BERM_INSET_M - p.z,
        );
        expect(inside, id).toBeGreaterThanOrEqual(10);
      } finally {
        world.free();
      }
    }
  });
});
