import { describe, expect, it } from "vitest";
import { createTerrainGrid, sampleTerrainHeight, terrainIndex } from "../src/core/terrain-grid.ts";
import { raycastTerrain } from "../src/core/terrain-pick.ts";

function flat(h: number, n = 20, cell = 2) {
  return createTerrainGrid({
    rows: n,
    cols: n,
    cellSizeM: cell,
    originX: -(n * cell) / 2,
    originZ: -(n * cell) / 2,
    fill: h,
  });
}

describe("raycastTerrain", () => {
  it("hits a flat grid straight below", () => {
    const g = flat(5);
    const hit = raycastTerrain(g, { x: 0, y: 100, z: 0 }, { x: 0, y: -1, z: 0 });
    expect(hit).not.toBeNull();
    expect(hit?.x).toBeCloseTo(0, 6);
    expect(hit?.y).toBeCloseTo(5, 6);
    expect(hit?.z).toBeCloseTo(0, 6);
    expect(hit?.distance).toBeCloseTo(95, 6);
  });

  it("agrees with sampleTerrainHeight on a 20 degree slope (oblique ray)", () => {
    const g = flat(0);
    const slope = Math.tan((20 * Math.PI) / 180);
    for (let row = 0; row <= g.rows; row++) {
      for (let col = 0; col <= g.cols; col++) {
        g.heights[terrainIndex(g, row, col)] = (g.originX + col * g.cellSizeM) * slope;
      }
    }
    const hit = raycastTerrain(g, { x: -15, y: 30, z: -12 }, { x: 0.4, y: -1, z: 0.35 });
    expect(hit).not.toBeNull();
    if (hit) expect(hit.y).toBeCloseTo(sampleTerrainHeight(g, hit.x, hit.z), 4);
  });

  it("returns null for upward rays and rays that miss the extent", () => {
    const g = flat(5);
    expect(raycastTerrain(g, { x: 0, y: 100, z: 0 }, { x: 0, y: 1, z: 0 })).toBeNull();
    expect(raycastTerrain(g, { x: 500, y: 100, z: 0 }, { x: 0, y: -1, z: 0 })).toBeNull();
    expect(raycastTerrain(g, { x: -100, y: 10, z: 0 }, { x: -1, y: -0.1, z: 0 })).toBeNull();
  });

  it("returns the first intersection when a ridge precedes a far slope", () => {
    const g = flat(0, 40, 1);
    // ridge along column ~ 15..17 of height 6
    for (let row = 0; row <= g.rows; row++) {
      for (let col = 15; col <= 17; col++) g.heights[terrainIndex(g, row, col)] = 6;
    }
    const origin = { x: g.originX - 5, y: 5, z: 0 };
    const hit = raycastTerrain(g, origin, { x: 1, y: -0.02, z: 0 });
    expect(hit).not.toBeNull();
    // hit must be on the ridge side facing the origin, not the ground beyond
    if (hit) {
      expect(hit.x).toBeLessThan(g.originX + 17.5);
      expect(hit.y).toBeCloseTo(sampleTerrainHeight(g, hit.x, hit.z), 4);
    }
  });

  it("marches a 667x667 grid diagonally in under 5 ms", () => {
    const g = flat(0, 667, 3);
    const o = { x: g.originX - 1, y: 5, z: g.originZ - 1 };
    const d = { x: 1, y: -0.0001, z: 1 };
    raycastTerrain(g, o, d); // warm up
    const t0 = performance.now();
    const hit = raycastTerrain(g, o, d);
    const ms = performance.now() - t0;
    expect(hit === null || hit.y >= 0).toBe(true);
    expect(ms).toBeLessThan(5);
  });
});
