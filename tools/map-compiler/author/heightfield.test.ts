import { describe, expect, it } from "vitest";
import { sampleHeightfieldBilinear } from "../../../src/core/heightfield-sample.ts";
import { MAP_COLLISION_VERSION, parseMapCollision } from "../../../src/core/map-collision.ts";
import type {
  RoadGraph,
  RoadGraphBounds,
  RoadGraphEdge,
  RoadGraphNode,
} from "../../../src/core/road-graph.ts";
import {
  buildOffRoadRelief,
  HEIGHTFIELD_RESOLUTION,
  HEIGHTFIELD_SINK_M,
  heightfieldHeightAt,
  heightfieldX,
  heightfieldZ,
  RELIEF_AMPLITUDE_M,
  RELIEF_COARSE_FEATURE_SIZE_M,
  RELIEF_FALLOFF_DISTANCE_M,
  RELIEF_FEATURE_SIZE_M,
  reliefAt,
} from "./heightfield.ts";

type Vec3 = readonly [number, number, number];

/** Builds a conforming RoadGraphEdge literal, filling in plausible defaults for every field a test doesn't care about. Mirrors `./road-distance.test.ts`'s own fixture-building style. */
function makeEdge(
  overrides: Partial<RoadGraphEdge> & { id: number; from: number; to: number; points: Vec3[] },
): RoadGraphEdge {
  return {
    lengthM: 0,
    surface: "tarmac",
    roadClass: "residential",
    lanes: 2,
    widthM: 6,
    oneway: false,
    speedLimitKph: 50,
    bridge: false,
    tunnel: false,
    layer: 0,
    osmWayId: 0,
    ...overrides,
  };
}

function makeNode(
  overrides: Partial<RoadGraphNode> & { id: number; x: number; y: number; z: number },
): RoadGraphNode {
  return { junction: false, osmNodeId: 0, ...overrides };
}

function makeGraph(nodes: RoadGraphNode[], edges: RoadGraphEdge[]): RoadGraph {
  return {
    schemaVersion: 1,
    areaId: "test-area",
    name: "Test Area",
    source: {
      osmExtract: "test://fixture",
      osmSnapshot: "2026-09-13T00:00:00Z",
      demSource: "none-flat-authored",
      compilerVersion: "0.0.0-test",
    },
    attribution: {
      osm: "© OpenStreetMap contributors",
      osmLicense: "ODbL-1.0",
      osmLicenseUrl: "https://www.openstreetmap.org/copyright",
      dem: "No DEM used — flat/hand-authored terrain, see ADR 0001 amendment",
    },
    origin: { lat: 0, lon: 0, projection: "local-enu-metres" },
    bounds: { minX: -3000, minZ: -3000, maxX: 3000, maxZ: 3000 },
    nodes,
    edges,
  };
}

/**
 * Real compiled Juliette, GA bounds (measured 2026-09-19, per
 * `04.1-04-PLAN.md`'s own `<interfaces>` block: 5504.17m x 5656.76m over
 * `HEIGHTFIELD_RESOLUTION` 128 cells), rounded to plain numbers for a test
 * fixture. Used everywhere this suite needs the REAL grid-spacing arithmetic
 * `RELIEF_FALLOFF_DISTANCE_M`/`RELIEF_FEATURE_SIZE_M` are tuned against, not
 * an arbitrary small fixture span.
 */
const REAL_BOUNDS: RoadGraphBounds = { minX: -2752, minZ: -2828, maxX: 2752, maxZ: 2828 };
const GRID_SPACING_M = (REAL_BOUNDS.maxX - REAL_BOUNDS.minX) / HEIGHTFIELD_RESOLUTION;

/** A single straight road (given half-width) running the full length of `REAL_BOUNDS` along +Z, centred on X=0. */
function makeSingleEdgeGraph(widthM: number): RoadGraph {
  const edge = makeEdge({
    id: 0,
    from: 0,
    to: 1,
    points: [
      [0, 0, REAL_BOUNDS.minZ],
      [0, 0, REAL_BOUNDS.maxZ],
    ],
    widthM,
  });
  return makeGraph(
    [
      makeNode({ id: 0, x: 0, y: 0, z: REAL_BOUNDS.minZ }),
      makeNode({ id: 1, x: 0, y: 0, z: REAL_BOUNDS.maxZ }),
    ],
    [edge],
  );
}

describe("relief constants", () => {
  it("RELIEF_AMPLITUDE_M is locked to D-02a's 2m cap", () => {
    expect(RELIEF_AMPLITUDE_M).toBe(2);
  });

  it("HEIGHTFIELD_SINK_M is a small nonzero physics-contact margin, not a structural offset", () => {
    expect(HEIGHTFIELD_SINK_M).toBeGreaterThan(0);
    expect(HEIGHTFIELD_SINK_M).toBeLessThanOrEqual(0.5);
  });

  it("RELIEF_FALLOFF_DISTANCE_M stays >= 3 grid cells over the real compiled bounds -- a sub-grid-cell falloff is unrepresentable once the grid is baked and bilinearly resampled", () => {
    expect(RELIEF_FALLOFF_DISTANCE_M).toBeGreaterThanOrEqual(3 * GRID_SPACING_M);
  });

  it("both noise octave feature sizes stay well above grid spacing (>= 4 cells), or the noise aliases into per-cell jitter", () => {
    expect(RELIEF_FEATURE_SIZE_M).toBeGreaterThanOrEqual(4 * GRID_SPACING_M);
    expect(RELIEF_COARSE_FEATURE_SIZE_M).toBeGreaterThanOrEqual(4 * GRID_SPACING_M);
  });
});

describe("reliefAt", () => {
  it("returns exactly 0 at and inside the paved edge (distanceToPavedEdgeM 0 and -1), across a sweep of at least 200 positions", () => {
    let count = 0;
    for (let ix = 0; ix < 20; ix++) {
      const x = -1000 + (ix * 2000) / 19;
      for (let iz = 0; iz < 10; iz++) {
        const z = -1000 + (iz * 2000) / 9;
        expect(reliefAt(x, z, 0)).toBe(0);
        expect(reliefAt(x, z, -1)).toBe(0);
        count += 2;
      }
    }
    expect(count).toBeGreaterThanOrEqual(200);
  });

  it("never exceeds +/- RELIEF_AMPLITUDE_M, across a sweep of at least 2,000 (x,z,d) combinations spanning the real compiled bounds", () => {
    let count = 0;
    for (let ix = 0; ix < 40; ix++) {
      const x = REAL_BOUNDS.minX + (ix * (REAL_BOUNDS.maxX - REAL_BOUNDS.minX)) / 39;
      for (let iz = 0; iz < 10; iz++) {
        const z = REAL_BOUNDS.minZ + (iz * (REAL_BOUNDS.maxZ - REAL_BOUNDS.minZ)) / 9;
        for (let id = 0; id < 5; id++) {
          const d = (id * RELIEF_FALLOFF_DISTANCE_M * 2) / 4;
          expect(Math.abs(reliefAt(x, z, d))).toBeLessThanOrEqual(RELIEF_AMPLITUDE_M + 1e-9);
          count++;
        }
      }
    }
    expect(count).toBeGreaterThanOrEqual(2000);
  });

  it("falloff envelope is non-decreasing from d=0 to d=RELIEF_FALLOFF_DISTANCE_M, then constant beyond it, for a fixed (x,z) with nonzero noise", () => {
    const x = 137.4;
    const z = -412.9;
    // Confirm this fixture point genuinely has nonzero noise at full amplitude first.
    expect(Math.abs(reliefAt(x, z, RELIEF_FALLOFF_DISTANCE_M * 2))).toBeGreaterThan(0);

    let prevAbs = 0;
    for (let i = 0; i <= 20; i++) {
      const d = (i * RELIEF_FALLOFF_DISTANCE_M) / 20;
      const abs = Math.abs(reliefAt(x, z, d));
      expect(abs).toBeGreaterThanOrEqual(prevAbs - 1e-9);
      prevAbs = abs;
    }
    const atFalloff = Math.abs(reliefAt(x, z, RELIEF_FALLOFF_DISTANCE_M));
    const beyond1 = Math.abs(reliefAt(x, z, RELIEF_FALLOFF_DISTANCE_M * 1.5));
    const beyond2 = Math.abs(reliefAt(x, z, RELIEF_FALLOFF_DISTANCE_M * 3));
    expect(beyond1).toBeCloseTo(atFalloff, 9);
    expect(beyond2).toBeCloseTo(atFalloff, 9);
  });

  it("is deterministic: repeated calls and independently computed sweeps agree exactly", () => {
    expect(reliefAt(123.4, -567.8, 50)).toBe(reliefAt(123.4, -567.8, 50));

    const sweepA: number[] = [];
    for (let i = 0; i < 30; i++) {
      sweepA.push(reliefAt(i * 17.3, -i * 9.1, 60));
    }
    const sweepB: number[] = [];
    for (let i = 0; i < 30; i++) {
      sweepB.push(reliefAt(i * 17.3, -i * 9.1, 60));
    }
    expect(sweepA).toEqual(sweepB);
  });

  it("is non-trivial: a 50x50 sweep well past the falloff distance produces at least 100 distinct values with a spread over 1.0m, not a constant", () => {
    const d = RELIEF_FALLOFF_DISTANCE_M * 2;
    const values = new Set<number>();
    let min = Number.POSITIVE_INFINITY;
    let max = Number.NEGATIVE_INFINITY;
    for (let ix = 0; ix < 50; ix++) {
      const x = -1000 + (ix * 2000) / 49;
      for (let iz = 0; iz < 50; iz++) {
        const z = -1000 + (iz * 2000) / 49;
        const v = reliefAt(x, z, d);
        values.add(v);
        min = Math.min(min, v);
        max = Math.max(max, v);
      }
    }
    expect(values.size).toBeGreaterThanOrEqual(100);
    expect(max - min).toBeGreaterThan(1.0);
  });
});

describe("buildOffRoadRelief", () => {
  it("relief is exactly sink-only right at the paved edge, and measurably different far from the road", () => {
    const graph = makeSingleEdgeGraph(10); // halfWidthM = 5
    const grid = buildOffRoadRelief(graph, REAL_BOUNDS, HEIGHTFIELD_RESOLUTION);
    const nearThreshold = RELIEF_FALLOFF_DISTANCE_M * 0.05;

    let sawFarDifference = false;
    for (let row = 0; row <= grid.rows; row++) {
      for (let col = 0; col <= grid.cols; col++) {
        const x = heightfieldX(grid, col);
        const distanceToPavedEdgeM = Math.max(0, Math.abs(x) - 5);
        const h = heightfieldHeightAt(grid, row, col);
        if (distanceToPavedEdgeM <= nearThreshold) {
          expect(Math.abs(h - -HEIGHTFIELD_SINK_M)).toBeLessThan(1e-6);
        }
        if (
          distanceToPavedEdgeM > RELIEF_FALLOFF_DISTANCE_M &&
          Math.abs(h - -HEIGHTFIELD_SINK_M) > 0.5
        ) {
          sawFarDifference = true;
        }
      }
    }
    expect(sawFarDifference).toBe(true);
  });

  it("every stored height stays within the amplitude+sink bound", () => {
    const graph = makeSingleEdgeGraph(10);
    const grid = buildOffRoadRelief(graph, REAL_BOUNDS, HEIGHTFIELD_RESOLUTION);
    for (const h of grid.heights) {
      expect(h).toBeGreaterThanOrEqual(-(RELIEF_AMPLITUDE_M + HEIGHTFIELD_SINK_M) - 1e-6);
      expect(h).toBeLessThanOrEqual(RELIEF_AMPLITUDE_M - HEIGHTFIELD_SINK_M + 1e-6);
    }
  });

  it("grid shape/field contract matches bounds and resolution", () => {
    const graph = makeSingleEdgeGraph(10);
    const resolution = 16;
    const grid = buildOffRoadRelief(graph, REAL_BOUNDS, resolution);
    expect(grid.heights.length).toBe((resolution + 1) ** 2);
    expect(grid.rows).toBe(resolution);
    expect(grid.cols).toBe(resolution);
    expect(grid.sinkM).toBe(HEIGHTFIELD_SINK_M);
    expect(grid.originX).toBe(REAL_BOUNDS.minX);
    expect(grid.originZ).toBe(REAL_BOUNDS.minZ);
    expect(grid.scaleX).toBeCloseTo(REAL_BOUNDS.maxX - REAL_BOUNDS.minX, 9);
    expect(grid.scaleZ).toBeCloseTo(REAL_BOUNDS.maxZ - REAL_BOUNDS.minZ, 9);
  });

  it("is byte-identical on repeated builds with the same inputs -- the guard that a recompile stays reproducible", () => {
    const graph = makeSingleEdgeGraph(10);
    const gridA = buildOffRoadRelief(graph, REAL_BOUNDS, 16);
    const gridB = buildOffRoadRelief(graph, REAL_BOUNDS, 16);
    expect(Array.from(gridA.heights)).toEqual(Array.from(gridB.heights));
  });

  it("round-trips through sampleHeightfieldBilinear: sampling exactly at a grid node's own (x,z) returns that node's own height", () => {
    const graph = makeSingleEdgeGraph(10);
    const resolution = 8;
    const grid = buildOffRoadRelief(graph, REAL_BOUNDS, resolution);
    for (let row = 0; row <= resolution; row++) {
      const z = heightfieldZ(grid, row);
      for (let col = 0; col <= resolution; col++) {
        const x = heightfieldX(grid, col);
        const expected = heightfieldHeightAt(grid, row, col);
        const sampled = sampleHeightfieldBilinear(grid, x, z);
        expect(Math.abs(sampled - expected)).toBeLessThan(1e-4);
      }
    }
  });
});

describe("grid geometry (orientation, unchanged from the DEM-era grid)", () => {
  it("returns a grid of resolution + 1 samples per axis, plus the scale extents", () => {
    const graph = makeSingleEdgeGraph(10);
    const grid = buildOffRoadRelief(graph, REAL_BOUNDS, 4);
    expect(grid.rows).toBe(4);
    expect(grid.cols).toBe(4);
    expect(grid.heights.length).toBe(5 * 5);
    expect(grid.scaleX).toBeCloseTo(REAL_BOUNDS.maxX - REAL_BOUNDS.minX, 9);
    expect(grid.scaleZ).toBeCloseTo(REAL_BOUNDS.maxZ - REAL_BOUNDS.minZ, 9);
  });

  it("uses HEIGHTFIELD_RESOLUTION by default", () => {
    const graph = makeSingleEdgeGraph(10);
    const grid = buildOffRoadRelief(graph, REAL_BOUNDS);
    expect(grid.rows).toBe(HEIGHTFIELD_RESOLUTION);
    expect(grid.cols).toBe(HEIGHTFIELD_RESOLUTION);
    expect(grid.heights.length).toBe((HEIGHTFIELD_RESOLUTION + 1) ** 2);
  });

  it("places grid cell (0,0) exactly at bounds' minimum corner and the last cell exactly at the maximum corner", () => {
    const graph = makeSingleEdgeGraph(10);
    const resolution = 6;
    const grid = buildOffRoadRelief(graph, REAL_BOUNDS, resolution);
    expect(heightfieldX(grid, 0)).toBeCloseTo(REAL_BOUNDS.minX, 9);
    expect(heightfieldZ(grid, 0)).toBeCloseTo(REAL_BOUNDS.minZ, 9);
    expect(heightfieldX(grid, resolution)).toBeCloseTo(REAL_BOUNDS.maxX, 9);
    expect(heightfieldZ(grid, resolution)).toBeCloseTo(REAL_BOUNDS.maxZ, 9);
  });

  it("heightfieldHeightAt agrees with the raw row + col*(rows+1) index math (ROW is the Z axis, COL is the X axis)", () => {
    const graph = makeSingleEdgeGraph(10);
    const resolution = 5;
    const grid = buildOffRoadRelief(graph, REAL_BOUNDS, resolution);
    for (let row = 0; row <= resolution; row++) {
      for (let col = 0; col <= resolution; col++) {
        expect(heightfieldHeightAt(grid, row, col)).toBe(
          grid.heights[row + col * (resolution + 1)],
        );
      }
    }
  });
});

describe("parseMapCollision: heightfield block (collisionVersion 2)", () => {
  const validHeightfieldRaw = {
    rows: 2,
    cols: 2,
    heights: [1, 2, 3, 4, 5, 6, 7, 8, 9],
    originX: -10,
    originZ: -10,
    scaleX: 20,
    scaleZ: 20,
    sinkM: 0.1,
  };

  it("accepts collisionVersion 2 with a heightfield block", () => {
    const raw = JSON.stringify({
      collisionVersion: 2,
      areaId: "juliette-ga",
      buildings: [],
      heightfield: validHeightfieldRaw,
    });
    const parsed = parseMapCollision(raw, "juliette-ga", "test-fixture");
    expect(parsed.collisionVersion).toBe(2);
    expect(MAP_COLLISION_VERSION).toBe(2);
    expect(parsed.heightfield).toBeDefined();
    expect(parsed.heightfield?.rows).toBe(2);
    expect(parsed.heightfield?.cols).toBe(2);
    // A plain array, not a Float32Array — JSON.stringify does not serialise a
    // Float32Array as a JSON array (see `MapCollisionHeightfield`'s doc
    // comment in `src/core/map-collision.ts`); the Rapier-required
    // `Float32Array` conversion happens once at collider construction in
    // `src/physics/map-scene.ts`, not in the parsed wire type.
    expect(Array.isArray(parsed.heightfield?.heights)).toBe(true);
    expect(parsed.heightfield?.heights).toEqual(validHeightfieldRaw.heights);
  });

  it("rejects a version-1 sidecar, naming both versions", () => {
    const raw = JSON.stringify({ collisionVersion: 1, areaId: "juliette-ga", buildings: [] });
    expect(() => parseMapCollision(raw, "juliette-ga", "test-fixture")).toThrowError(/1/);
    try {
      parseMapCollision(raw, "juliette-ga", "test-fixture");
      expect.fail("expected parseMapCollision to throw");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      expect(message).toContain("1");
      expect(message).toContain("2");
    }
  });

  it("throws when the heights array length does not equal (rows+1)*(cols+1), naming both the expected and actual lengths", () => {
    const raw = JSON.stringify({
      collisionVersion: 2,
      areaId: "juliette-ga",
      buildings: [],
      heightfield: { ...validHeightfieldRaw, heights: [1, 2, 3] },
    });
    expect(() => parseMapCollision(raw, "juliette-ga", "test-fixture")).toThrowError(/9.*3|3.*9/);
  });

  it("rejects a non-finite or out-of-range height value", () => {
    const rawNonFinite = JSON.stringify({
      collisionVersion: 2,
      areaId: "juliette-ga",
      buildings: [],
      heightfield: { ...validHeightfieldRaw, heights: [1, 2, 3, 4, 5, 6, 7, 8, Number.NaN] },
    });
    expect(() => parseMapCollision(rawNonFinite, "juliette-ga", "test-fixture")).toThrow();

    const rawOutOfRange = JSON.stringify({
      collisionVersion: 2,
      areaId: "juliette-ga",
      buildings: [],
      heightfield: { ...validHeightfieldRaw, heights: [1, 2, 3, 4, 5, 6, 7, 8, 12000] },
    });
    expect(() => parseMapCollision(rawOutOfRange, "juliette-ga", "test-fixture")).toThrow();
  });
});
