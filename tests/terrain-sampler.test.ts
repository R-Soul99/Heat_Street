import * as RAPIER from "@dimforge/rapier3d";
import { describe, expect, it } from "vitest";
import {
  createTerrainGrid,
  sampleTerrainHeight,
  sampleTerrainHeightWithDiagonal,
  TERRAIN_DIAGONAL,
  type TerrainDiagonal,
  type TerrainGrid,
  terrainIndex,
  terrainTriangleNormal,
  terrainVertexNormal,
  upsampleTerrainGrid,
} from "../src/core/terrain-grid";
import { createWorld } from "../src/physics/world";

function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function randomGrid(): TerrainGrid {
  const rand = lcg(12345);
  const grid = createTerrainGrid({ rows: 4, cols: 4, cellSizeM: 3, originX: -6, originZ: -6 });
  for (let i = 0; i < grid.heights.length; i++) grid.heights[i] = rand() * 6 - 3;
  return grid;
}

function seededPoints(grid: TerrainGrid, n: number): Array<[number, number]> {
  const rand = lcg(777);
  const pts: Array<[number, number]> = [];
  const eps = 1e-4;
  for (let i = 0; i < n; i++) {
    pts.push([
      grid.originX + eps + rand() * (grid.scaleX - 2 * eps),
      grid.originZ + eps + rand() * (grid.scaleZ - 2 * eps),
    ]);
  }
  return pts;
}

function rapierHeights(grid: TerrainGrid, points: Array<[number, number]>): number[] {
  const world = createWorld();
  try {
    const body = world.createRigidBody(
      RAPIER.RigidBodyDesc.fixed().setTranslation(
        grid.originX + grid.scaleX / 2,
        0,
        grid.originZ + grid.scaleZ / 2,
      ),
    );
    world.createCollider(
      RAPIER.ColliderDesc.heightfield(
        grid.rows,
        grid.cols,
        new Float32Array(grid.heights),
        { x: grid.scaleX, y: 1, z: grid.scaleZ },
        RAPIER.HeightFieldFlags.FIX_INTERNAL_EDGES,
      ),
      body,
    );
    world.step();
    return points.map(([x, z]) => {
      const ray = new RAPIER.Ray({ x, y: 50, z }, { x: 0, y: -1, z: 0 });
      const hit = world.castRay(ray, 100, true);
      if (!hit) throw new Error(`no hit at ${x},${z}`);
      return 50 - hit.timeOfImpact;
    });
  } finally {
    world.free();
  }
}

describe("createTerrainGrid / terrainIndex", () => {
  it("builds the documented shape", () => {
    const g = createTerrainGrid({ rows: 4, cols: 4, cellSizeM: 3, originX: -6, originZ: -6 });
    expect(g.heights.length).toBe(25);
    expect(g.scaleX).toBe(12);
    expect(g.scaleZ).toBe(12);
    expect(g.heights.every((h) => h === 0)).toBe(true);
    expect(terrainIndex(g, 2, 3)).toBe(2 + 3 * 5);
  });

  it("rejects invalid sizes naming the field", () => {
    expect(() =>
      createTerrainGrid({ rows: 0, cols: 4, cellSizeM: 3, originX: 0, originZ: 0 }),
    ).toThrow(/rows/);
    expect(() =>
      createTerrainGrid({ rows: 4, cols: 1.5, cellSizeM: 3, originX: 0, originZ: 0 }),
    ).toThrow(/cols/);
    expect(() =>
      createTerrainGrid({ rows: 4, cols: 4, cellSizeM: 0, originX: 0, originZ: 0 }),
    ).toThrow(/cellSizeM/);
  });
});

describe("sampleTerrainHeight", () => {
  it("returns vertex heights exactly at vertices and clamps outside", () => {
    const g = randomGrid();
    for (let r = 0; r <= g.rows; r++) {
      for (let c = 0; c <= g.cols; c++) {
        const x = g.originX + c * g.cellSizeM;
        const z = g.originZ + r * g.cellSizeM;
        expect(sampleTerrainHeight(g, x, z)).toBeCloseTo(g.heights[terrainIndex(g, r, c)], 5);
      }
    }
    const far = sampleTerrainHeight(g, 1e9, -1e9);
    expect(Number.isFinite(far)).toBe(true);
    expect(Number.isNaN(sampleTerrainHeight(g, Number.NaN, 0))).toBe(false);
  });

  it("agrees with Rapier castRay at 200 seeded points within 1e-3 m", () => {
    const g = randomGrid();
    const pts = seededPoints(g, 200);
    const hits = rapierHeights(g, pts);
    let worst = 0;
    pts.forEach(([x, z], i) => {
      worst = Math.max(worst, Math.abs(sampleTerrainHeight(g, x, z) - hits[i]));
    });
    expect(worst).toBeLessThan(1e-3);
  });

  it("the opposite diagonal disagrees with Rapier (test discriminates)", () => {
    const g = randomGrid();
    const pts = seededPoints(g, 200);
    const hits = rapierHeights(g, pts);
    const opposite: TerrainDiagonal =
      TERRAIN_DIAGONAL === "row0col0-row1col1" ? "row0col1-row1col0" : "row0col0-row1col1";
    let worst = 0;
    pts.forEach(([x, z], i) => {
      worst = Math.max(
        worst,
        Math.abs(sampleTerrainHeightWithDiagonal(g, x, z, opposite) - hits[i]),
      );
    });
    expect(worst).toBeGreaterThan(1e-2);
  });
});

describe("normals", () => {
  it("triangle normal on a plane tilted 20 degrees about Z", () => {
    const g = createTerrainGrid({ rows: 4, cols: 4, cellSizeM: 3, originX: 0, originZ: 0 });
    const slope = Math.tan((20 * Math.PI) / 180);
    for (let r = 0; r <= 4; r++)
      for (let c = 0; c <= 4; c++) g.heights[terrainIndex(g, r, c)] = slope * c * 3;
    const n = terrainTriangleNormal(g, 5.1, 4.3, { x: 0, y: 0, z: 0 });
    const a = (20 * Math.PI) / 180;
    expect(n.x).toBeCloseTo(-Math.sin(a), 5);
    expect(n.y).toBeCloseTo(Math.cos(a), 5);
    expect(n.z).toBeCloseTo(0, 5);
  });

  it("vertex normal is unit length, including borders", () => {
    const g = randomGrid();
    for (const [r, c] of [
      [0, 0],
      [2, 2],
      [4, 4],
      [0, 3],
    ]) {
      const n = terrainVertexNormal(g, r, c, { x: 0, y: 0, z: 0 });
      expect(Math.hypot(n.x, n.y, n.z)).toBeCloseTo(1, 9);
    }
  });
});

describe("upsampleTerrainGrid", () => {
  it("keeps originals exactly and reproduces planes", () => {
    const g = createTerrainGrid({ rows: 4, cols: 4, cellSizeM: 3, originX: 1, originZ: 2 });
    // dyadic coefficients keep the plane exactly representable in float32
    for (let r = 0; r <= 4; r++)
      for (let c = 0; c <= 4; c++) g.heights[terrainIndex(g, r, c)] = 0.5 * c + 0.25 * r + 1;
    const up = upsampleTerrainGrid(g, 2);
    expect(up.rows).toBe(8);
    expect(up.cols).toBe(8);
    expect(up.cellSizeM).toBe(1.5);
    expect(up.originX).toBe(1);
    expect(up.scaleX).toBe(g.scaleX);
    for (let r = 0; r <= 4; r++) {
      for (let c = 0; c <= 4; c++) {
        expect(up.heights[terrainIndex(up, r * 2, c * 2)]).toBe(g.heights[terrainIndex(g, r, c)]);
      }
    }
    for (let r = 0; r <= 8; r++) {
      for (let c = 0; c <= 8; c++) {
        expect(
          Math.abs(up.heights[terrainIndex(up, r, c)] - (0.25 * c + 0.125 * r + 1)),
        ).toBeLessThan(1e-9);
      }
    }
  });

  it("WR-04: keeps a levelled band straight next to a rising shoulder (no cubic dip)", () => {
    // Columns: flat road 0,0,0 then a 2 m shoulder; and a graded road 0,1,2 then 10.
    const g = createTerrainGrid({ rows: 1, cols: 7, cellSizeM: 3, originX: 0, originZ: 0 });
    const flatRow = [0, 0, 0, 2, 2, 2, 2, 2];
    const gradedRow = [0, 1, 2, 10, 10, 10, 10, 10];
    for (let c = 0; c <= 7; c++) {
      g.heights[terrainIndex(g, 0, c)] = flatRow[c];
      g.heights[terrainIndex(g, 1, c)] = gradedRow[c];
    }
    const up = upsampleTerrainGrid(g, 2);
    // Midpoint between the last two flat road vertices: was -2/16 = -0.125 m.
    expect(up.heights[terrainIndex(up, 0, 3)]).toBe(0);
    // Graded road: the straight midpoint 1.5 m (the plain cubic gave 1.0625 m).
    expect(up.heights[terrainIndex(up, 2, 3)]).toBeCloseTo(1.5, 9);
    // A curved crest keeps its cubic shape (the signed-off gate feel).
    const crest = createTerrainGrid({ rows: 1, cols: 3, cellSizeM: 3, originX: 0, originZ: 0 });
    [0, 3, 3, 0].forEach((h, c) => {
      crest.heights[terrainIndex(crest, 0, c)] = h;
      crest.heights[terrainIndex(crest, 1, c)] = h;
    });
    expect(
      upsampleTerrainGrid(crest, 2).heights[terrainIndex(upsampleTerrainGrid(crest, 2), 0, 3)],
    ).toBeCloseTo(3.375, 9);
  });
});
