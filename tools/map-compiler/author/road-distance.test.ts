import { describe, expect, it } from "vitest";
import type { RoadGraph, RoadGraphEdge, RoadGraphNode } from "../../../src/core/road-graph.ts";
import { buildRoadDistanceField, pointToSegmentDistanceXZ } from "./road-distance.ts";

type Vec3 = readonly [number, number, number];

/** Builds a conforming RoadGraphEdge literal, filling in plausible defaults for every field a test doesn't care about. */
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
      demSource: "usgs-3dep-1m",
      compilerVersion: "0.0.0-test",
    },
    attribution: {
      osm: "© OpenStreetMap contributors",
      osmLicense: "ODbL-1.0",
      osmLicenseUrl: "https://www.openstreetmap.org/copyright",
      dem: "U.S. Geological Survey 3D Elevation Program (public domain)",
    },
    origin: { lat: 0, lon: 0, projection: "local-enu-metres" },
    bounds: { minX: -100, minZ: -100, maxX: 100, maxZ: 100 },
    nodes,
    edges,
  };
}

describe("pointToSegmentDistanceXZ", () => {
  it("perpendicular from the middle of a segment", () => {
    // Segment (0,0)-(10,0); query (5,3) projects to (5,0), distance 3.
    expect(pointToSegmentDistanceXZ(5, 3, 0, 0, 10, 0)).toBeCloseTo(3, 9);
  });

  it("clamps past each endpoint", () => {
    // Query beyond the start (ax,az): clamps to (0,0), distance 5.
    expect(pointToSegmentDistanceXZ(-5, 0, 0, 0, 10, 0)).toBeCloseTo(5, 9);
    // Query beyond the end (bx,bz): clamps to (10,0), distance 5.
    expect(pointToSegmentDistanceXZ(15, 0, 0, 0, 10, 0)).toBeCloseTo(5, 9);
  });

  it("a point exactly on the segment returns 0", () => {
    expect(pointToSegmentDistanceXZ(5, 0, 0, 0, 10, 0)).toBeCloseTo(0, 9);
  });

  it("a zero-length segment returns the point-to-point distance, not NaN", () => {
    const dist = pointToSegmentDistanceXZ(8, 9, 5, 5, 5, 5);
    expect(dist).toBeCloseTo(5, 9); // hypot(3, 4) = 5
    expect(Number.isNaN(dist)).toBe(false);
  });
});

describe("buildRoadDistanceField — single straight widthM 10 edge (halfWidth 5) along +Z", () => {
  const edge = makeEdge({
    id: 0,
    from: 0,
    to: 1,
    points: [
      [0, 0, 0],
      [0, 0, 100],
    ],
    widthM: 10,
  });
  const graph = makeGraph(
    [makeNode({ id: 0, x: 0, y: 0, z: 0 }), makeNode({ id: 1, x: 0, y: 0, z: 100 })],
    [edge],
  );
  const field = buildRoadDistanceField(graph);

  it("a point 5m lateral (exactly on the paved edge) returns 0", () => {
    expect(field.distanceToPavedEdgeM(5, 50)).toBeCloseTo(0, 9);
  });

  it("a point 3m lateral (inside the pavement) is clamped to 0", () => {
    expect(field.distanceToPavedEdgeM(3, 50)).toBeCloseTo(0, 9);
  });

  it("a point 25m lateral returns 20 within 1e-9", () => {
    expect(field.distanceToPavedEdgeM(25, 50)).toBeCloseTo(20, 9);
  });
});

describe("buildRoadDistanceField — half-width is per-edge, not a global constant", () => {
  it("the wider road wins (returns the smaller paved-edge distance) at equal centreline distance", () => {
    // Edge A: widthM 4 (halfWidth 2), straight line along X=0.
    const edgeA = makeEdge({
      id: 0,
      from: 0,
      to: 1,
      points: [
        [0, 0, -50],
        [0, 0, 50],
      ],
      widthM: 4,
    });
    // Edge B: widthM 14 (halfWidth 7), straight line along X=20.
    const edgeB = makeEdge({
      id: 1,
      from: 2,
      to: 3,
      points: [
        [20, 0, -50],
        [20, 0, 50],
      ],
      widthM: 14,
    });
    const graph = makeGraph(
      [
        makeNode({ id: 0, x: 0, y: 0, z: -50 }),
        makeNode({ id: 1, x: 0, y: 0, z: 50 }),
        makeNode({ id: 2, x: 20, y: 0, z: -50 }),
        makeNode({ id: 3, x: 20, y: 0, z: 50 }),
      ],
      [edgeA, edgeB],
    );
    const field = buildRoadDistanceField(graph);

    // Query point at x=10, z=0: 10m from edge A's centreline, 10m from edge B's centreline (equal).
    const distance = field.distanceToPavedEdgeM(10, 0);
    // Edge A: 10 - 2 = 8. Edge B: 10 - 7 = 3. Wider road (B) wins with the smaller distance.
    expect(distance).toBeCloseTo(3, 9);
    expect(distance).toBeLessThan(8);
  });
});

describe("buildRoadDistanceField — multi-segment polyline", () => {
  it("measures to the nearest point of an interior segment, not just the endpoints", () => {
    // L-shaped 3-point edge: (0,0)-(10,0)-(10,10), widthM 6 (halfWidth 3).
    const edge = makeEdge({
      id: 0,
      from: 0,
      to: 1,
      points: [
        [0, 0, 0],
        [10, 0, 0],
        [10, 0, 10],
      ],
      widthM: 6,
    });
    const graph = makeGraph(
      [makeNode({ id: 0, x: 0, y: 0, z: 0 }), makeNode({ id: 1, x: 10, y: 0, z: 10 })],
      [edge],
    );
    const field = buildRoadDistanceField(graph);

    // Query near the middle of the second segment (10,0)-(10,10): x=17, z=5.
    // Perpendicular distance to segment 2 is 7 (projects to (10,5), within range).
    // Distance to segment 1 (clamped to its endpoint (10,0)) is hypot(7,5) ~ 8.60.
    // So segment 2 is genuinely nearer -- exercising the "not just endpoints" path.
    const distance = field.distanceToPavedEdgeM(17, 5);
    expect(distance).toBeCloseTo(7 - 3, 9); // 4
  });
});

describe("buildRoadDistanceField — bounding-box fast path matches brute force", () => {
  function buildFixtureGraph(): RoadGraph {
    const edge0 = makeEdge({
      id: 0,
      from: 0,
      to: 1,
      points: [
        [-15, 0, -15],
        [15, 0, -15],
      ],
      widthM: 6,
    });
    const edge1 = makeEdge({
      id: 1,
      from: 2,
      to: 3,
      points: [
        [0, 0, -20],
        [0, 0, 20],
      ],
      widthM: 10,
    });
    const edge2 = makeEdge({
      id: 2,
      from: 4,
      to: 5,
      points: [
        [10, 0, 10],
        [-10, 0, -5],
      ],
      widthM: 4,
    });
    return makeGraph(
      [
        makeNode({ id: 0, x: -15, y: 0, z: -15 }),
        makeNode({ id: 1, x: 15, y: 0, z: -15 }),
        makeNode({ id: 2, x: 0, y: 0, z: -20 }),
        makeNode({ id: 3, x: 0, y: 0, z: 20 }),
        makeNode({ id: 4, x: 10, y: 0, z: 10 }),
        makeNode({ id: 5, x: -10, y: 0, z: -5 }),
      ],
      [edge0, edge1, edge2],
    );
  }

  /** Brute-force reference: no bounding-box reject, checks every segment. */
  function bruteForceDistanceToPavedEdgeM(graph: RoadGraph, x: number, z: number): number {
    let best = Number.POSITIVE_INFINITY;
    for (const edge of graph.edges) {
      const halfWidthM = edge.widthM / 2;
      for (let i = 0; i < edge.points.length - 1; i++) {
        const [ax, , az] = edge.points[i];
        const [bx, , bz] = edge.points[i + 1];
        const dist = pointToSegmentDistanceXZ(x, z, ax, az, bx, bz) - halfWidthM;
        if (dist < best) best = dist;
      }
    }
    return Math.max(0, best);
  }

  it("matches the brute-force reference across a 20x20 sweep of query points", () => {
    const graph = buildFixtureGraph();
    const field = buildRoadDistanceField(graph);

    for (let ix = 0; ix < 20; ix++) {
      const x = -20 + (ix * 40) / 19;
      for (let iz = 0; iz < 20; iz++) {
        const z = -20 + (iz * 40) / 19;
        const actual = field.distanceToPavedEdgeM(x, z);
        const expected = bruteForceDistanceToPavedEdgeM(graph, x, z);
        expect(actual, `x=${x} z=${z}`).toBeCloseTo(expected, 9);
      }
    }
  });
});

describe("buildRoadDistanceField — empty graph", () => {
  it("throws the named error for a graph with no edges", () => {
    const graph = makeGraph([], []);
    expect(() => buildRoadDistanceField(graph)).toThrow(
      /buildRoadDistanceField: graph has no road segments to measure against/,
    );
  });
});
