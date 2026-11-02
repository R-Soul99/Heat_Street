import { describe, expect, it } from "vitest";
import {
  encodeTerrainBinary,
  loadTerrainArea,
  serializeTerrainSidecar,
} from "../../src/core/terrain-format.ts";
import { createEmptyTerrainArea } from "./new-area.ts";

describe("createEmptyTerrainArea", () => {
  const area = createEmptyTerrainArea({ areaId: "x", widthM: 600, depthM: 400, cellSizeM: 3 });

  it("sets graph bounds equal to the grid extent", () => {
    // 400 m is not a whole number of 3 m cells, so the size snaps to 133 rows (399 m).
    expect(area.graph.bounds).toEqual({ minX: -300, minZ: -199.5, maxX: 300, maxZ: 199.5 });
    const exact = createEmptyTerrainArea({ areaId: "x", widthM: 600, depthM: 402, cellSizeM: 3 });
    expect(exact.graph.bounds).toEqual({ minX: -300, minZ: -201, maxX: 300, maxZ: 201 });
    const g = area.grid;
    expect(area.graph.bounds).toEqual({
      minX: g.originX,
      minZ: g.originZ,
      maxX: g.originX + g.scaleX,
      maxZ: g.originZ + g.scaleZ,
    });
  });

  it("starts with an empty graph and nextEdgeId 0", () => {
    expect(area.graph.nodes).toHaveLength(0);
    expect(area.graph.edges).toHaveLength(0);
    expect(area.nextEdgeId).toBe(0);
    expect(area.areaId).toBe("x");
  });

  it("round-trips through serialize and loadTerrainArea", async () => {
    const bin = await encodeTerrainBinary(area);
    const json = serializeTerrainSidecar(area);
    const back = await loadTerrainArea(bin, json, "x", "test");
    expect(back.graph.bounds).toEqual(area.graph.bounds);
    expect(back.grid.rows).toBe(area.grid.rows);
    expect(back.groundSurface).toBe("grass");
  });

  it("rejects oversize or non-positive sizes", () => {
    expect(() =>
      createEmptyTerrainArea({ areaId: "x", widthM: 2001, depthM: 10, cellSizeM: 3 }),
    ).toThrow();
    expect(() =>
      createEmptyTerrainArea({ areaId: "x", widthM: 10, depthM: 10, cellSizeM: 0 }),
    ).toThrow();
  });
});
