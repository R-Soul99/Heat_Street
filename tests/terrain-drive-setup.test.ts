import { describe, expect, it } from "vitest";
import { forwardFromYaw } from "../src/core/heading";
import type { RoadGraph } from "../src/core/road-graph";
import {
  crestsFromObjects,
  nearestEdgeHeading,
  physicsGridForArea,
  resolveDriveHerePose,
  terrainGridExtent,
} from "../src/core/terrain-drive-setup";
import { createTerrainGrid } from "../src/core/terrain-grid";

function graph(withEdge: boolean): RoadGraph {
  return {
    schemaVersion: 1,
    areaId: "t",
    name: "T",
    source: {
      osmExtract: "none",
      osmSnapshot: "2026-01-01T00:00:00Z",
      demSource: "none-flat-authored",
      compilerVersion: "0.0.0",
    },
    attribution: { osm: "o", osmLicense: "ODbL-1.0", osmLicenseUrl: "https://x", dem: "d" },
    origin: { lat: 0, lon: 0, projection: "enu" },
    bounds: { minX: 0, minZ: 0, maxX: 1, maxZ: 1 },
    nodes: withEdge
      ? [
          { id: 0, x: -50, y: 0, z: 10, junction: false, osmNodeId: 0 },
          { id: 1, x: 50, y: 0, z: 10, junction: false, osmNodeId: 0 },
        ]
      : [],
    edges: withEdge
      ? [
          {
            id: 1,
            from: 0,
            to: 1,
            points: [
              [-50, 0, 10],
              [50, 0, 10],
            ],
            lengthM: 100,
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
          },
        ]
      : [],
  };
}

const grid = createTerrainGrid({ rows: 10, cols: 10, cellSizeM: 10, originX: -50, originZ: -50 });

describe("terrainGridExtent", () => {
  it("is origin to origin + scale", () => {
    expect(terrainGridExtent(grid)).toEqual({ minX: -50, minZ: -50, maxX: 50, maxZ: 50 });
  });
});

describe("resolveDriveHerePose", () => {
  it("accepts an in-grid point on a stroke-less area with a tiny graph.bounds", () => {
    expect(resolveDriveHerePose("?at=30,-20", grid, graph(false))).toEqual({
      x: 30,
      z: -20,
      headingRad: 0,
    });
  });
  it("rejects a point outside the grid", () => {
    expect(resolveDriveHerePose("?at=51,0", grid, graph(false))).toBeUndefined();
    expect(resolveDriveHerePose("", grid, graph(false))).toBeUndefined();
  });
  it("faces along the nearest edge", () => {
    const pose = resolveDriveHerePose("?at=0,5", grid, graph(true));
    expect(pose).toBeDefined();
    const fwd = forwardFromYaw(pose?.headingRad ?? Number.NaN);
    expect(fwd.x).toBeCloseTo(1, 6);
    expect(fwd.z).toBeCloseTo(0, 6);
  });
});

describe("nearestEdgeHeading", () => {
  it("is undefined without edges", () => {
    expect(nearestEdgeHeading(graph(false), 0, 0)).toBeUndefined();
  });
});

describe("physicsGridForArea", () => {
  it("returns the grid for subdiv 1 and doubles for subdiv 2 over the same extent", () => {
    expect(physicsGridForArea({ grid, colliderSubdiv: 1 })).toBe(grid);
    const g2 = physicsGridForArea({ grid, colliderSubdiv: 2 });
    expect(g2.rows).toBe(20);
    expect(g2.cols).toBe(20);
    expect(terrainGridExtent(g2)).toEqual(terrainGridExtent(grid));
  });
});

describe("crestsFromObjects", () => {
  it("returns crest values in order", () => {
    const a = { id: "a", centerX: 0, centerZ: 0, radiusM: 5, heightM: 1 };
    const b = { id: "b", centerX: 1, centerZ: 1, radiusM: 6, heightM: 2 };
    expect(
      crestsFromObjects([
        { kind: "crest", crest: a },
        { kind: "crest", crest: b },
      ]),
    ).toEqual([a, b]);
    expect(crestsFromObjects([])).toEqual([]);
  });
});
