import { describe, expect, it } from "vitest";
import {
  encodeTerrainBinary,
  loadTerrainArea,
  serializeTerrainSidecar,
} from "../../src/core/terrain-format.ts";
import { createEmptyTerrainArea, suggestAreaName, validateNewTerrainArea } from "./new-area.ts";

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

  it("CR-02: refuses grids over the encoder's vertex cap at creation time", () => {
    // 1000 m at 0.5 m cells and 2000 m at 1 m cells are both (2001)^2 = 4,004,001 vertices.
    expect(() =>
      createEmptyTerrainArea({ areaId: "x", widthM: 1000, depthM: 1000, cellSizeM: 0.5 }),
    ).toThrow(/4004001 vertices, max 4000000/);
    expect(() =>
      createEmptyTerrainArea({ areaId: "x", widthM: 2000, depthM: 2000, cellSizeM: 1 }),
    ).toThrow(RangeError);
  });

  it("CR-02: every area it does create can be encoded", async () => {
    // Largest square just under the cap at 1 m cells: 1998 cells -> 1999^2 vertices.
    const big = createEmptyTerrainArea({ areaId: "x", widthM: 1998, depthM: 1998, cellSizeM: 1 });
    expect((big.grid.rows + 1) * (big.grid.cols + 1)).toBeLessThanOrEqual(4_000_000);
    await expect(encodeTerrainBinary(big)).resolves.toBeInstanceOf(Uint8Array);
  });
});

describe("validateNewTerrainArea", () => {
  const ok = { name: "hills", widthM: 1000, depthM: 1000, cellSizeM: 3 };
  const nameRule = "Give the area a name: 1-64 characters, a-z, 0-9 and - only.";

  it("accepts valid input", () => {
    expect(validateNewTerrainArea(ok, [])).toBeNull();
  });
  it("rejects bad names", () => {
    expect(validateNewTerrainArea({ ...ok, name: "" }, [])).toBe(nameRule);
    expect(validateNewTerrainArea({ ...ok, name: "Hills!" }, [])).toBe(nameRule);
    expect(validateNewTerrainArea({ ...ok, name: "a".repeat(65) }, [])).toBe(nameRule);
  });
  it("rejects bad sizes", () => {
    expect(validateNewTerrainArea({ ...ok, widthM: 0 }, [])).toBe(
      "Width must be more than 0 and at most 2000 m.",
    );
    expect(validateNewTerrainArea({ ...ok, widthM: 2500 }, [])).toBe(
      "Width must be more than 0 and at most 2000 m.",
    );
    expect(validateNewTerrainArea({ ...ok, depthM: 0 }, [])).toBe(
      "Height (north-south) must be more than 0 and at most 2000 m.",
    );
  });
  it("rejects bad cell size", () => {
    expect(validateNewTerrainArea({ ...ok, cellSizeM: 0 }, [])).toBe(
      "Cell size must be a positive number of metres.",
    );
    expect(validateNewTerrainArea({ ...ok, cellSizeM: Number.NaN }, [])).toBe(
      "Cell size must be a positive number of metres.",
    );
  });
  it("rejects an existing name", () => {
    expect(validateNewTerrainArea(ok, ["hills"])).toBe(
      'An area called "hills" already exists. Pick another name or load it from the list.',
    );
  });
  it("reports the builder's vertex cap verbatim", () => {
    const err = validateNewTerrainArea({ ...ok, widthM: 2000, depthM: 2000, cellSizeM: 0.5 }, []);
    expect(err).toMatch(/vertices, max/);
  });
});

describe("suggestAreaName", () => {
  it("picks the first free name", () => {
    expect(suggestAreaName([])).toBe("new-area");
    expect(suggestAreaName(["new-area"])).toBe("new-area-2");
    expect(suggestAreaName(["new-area", "new-area-2"])).toBe("new-area-3");
  });
});
