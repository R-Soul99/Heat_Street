import { describe, expect, it } from "vitest";
import type { RoadGraph, RoadGraphEdge, RoadGraphNode } from "../../../src/core/road-graph.ts";
import { applyFlatElevation, FLAT_Y } from "./elevation.ts";

function baseGraphFields() {
  return {
    schemaVersion: 1 as const,
    areaId: "test-area",
    name: "Test Area",
    source: {
      osmExtract: "overpass://test/test-area",
      osmSnapshot: "2026-01-01T00:00:00.000Z",
      demSource: "usgs-3dep-1m" as const,
      compilerVersion: "0.1.0",
    },
    attribution: {
      osm: "© OpenStreetMap contributors",
      osmLicense: "ODbL-1.0",
      osmLicenseUrl: "https://www.openstreetmap.org/copyright",
      dem: "U.S. Geological Survey 3D Elevation Program (public domain)",
    },
    origin: { lat: 33.1, lon: -83.8, projection: "local-enu-metres" },
  };
}

function makeNode(
  id: number,
  x: number,
  junkY: number,
  z: number,
  osmNodeId: number,
  junction = false,
): RoadGraphNode {
  return { id, x, y: junkY, z, junction, osmNodeId };
}

function makeEdge(
  id: number,
  from: number,
  to: number,
  points: readonly (readonly [number, number, number])[],
  osmWayId: number,
): RoadGraphEdge {
  return {
    id,
    from,
    to,
    points,
    lengthM: 0,
    surface: "tarmac",
    roadClass: "residential",
    lanes: 2,
    widthM: 6.5,
    oneway: false,
    speedLimitKph: 50,
    bridge: false,
    tunnel: false,
    layer: 0,
    osmWayId,
  };
}

/** Builds a schema-shaped `RoadGraph` fixture from already-constructed nodes/edges. */
function makeGraph(nodes: readonly RoadGraphNode[], edges: readonly RoadGraphEdge[]): RoadGraph {
  const xs = nodes.map((n) => n.x);
  const zs = nodes.map((n) => n.z);
  return {
    ...baseGraphFields(),
    bounds: {
      minX: Math.min(...xs),
      minZ: Math.min(...zs),
      maxX: Math.max(...xs),
      maxZ: Math.max(...zs),
    },
    nodes: [...nodes],
    edges: [...edges],
  };
}

describe("applyFlatElevation", () => {
  it("sets every returned node's y to exactly 0, from a fixture with deliberately non-zero input y", () => {
    const nodes = [
      makeNode(0, 0, 15, 0, 1),
      makeNode(1, 40, -8, 0, 2),
      makeNode(2, 40, 22.5, 40, 3),
    ];
    const edges = [
      makeEdge(
        0,
        0,
        1,
        [
          [0, 15, 0],
          [40, -8, 0],
        ],
        1,
      ),
      makeEdge(
        1,
        1,
        2,
        [
          [40, -8, 0],
          [40, 22.5, 40],
        ],
        2,
      ),
    ];
    const graph = makeGraph(nodes, edges);

    const { graph: result } = applyFlatElevation(graph);

    for (const node of result.nodes) {
      expect(node.y).toBe(0);
      expect(node.y).toBe(FLAT_Y);
    }
  });

  it("sets every returned edge point's y to exactly 0, from a fixture with deliberately non-zero input point y", () => {
    const nodes = [makeNode(0, 0, 9, 0, 1), makeNode(1, 40, 17, 0, 2)];
    const edges = [
      makeEdge(
        0,
        0,
        1,
        [
          [0, 9, 0],
          [10, 40, 0],
          [20, -30, 0],
          [30, 5, 0],
          [40, 17, 0],
        ],
        1,
      ),
    ];
    const graph = makeGraph(nodes, edges);

    const { graph: result } = applyFlatElevation(graph);

    for (const point of result.edges[0].points) {
      expect(point[1]).toBe(0);
    }
  });

  it("computes lengthM as the exact 2D length for a 3-4-5 right-triangle edge, dropping non-zero input y", () => {
    const nodes = [makeNode(0, 0, 100, 0, 1), makeNode(1, 3, -75, 4, 2)];
    const edges = [
      makeEdge(
        0,
        0,
        1,
        [
          [0, 100, 0],
          [3, -75, 4],
        ],
        1,
      ),
    ];
    const graph = makeGraph(nodes, edges);

    const { graph: result } = applyFlatElevation(graph);

    expect(result.edges[0].lengthM).toBeCloseTo(5, 9);
  });

  it("does not mutate its input graph, nodes array, edges array, or any edge's points array", () => {
    const nodes = [makeNode(0, 0, 12, 0, 1), makeNode(1, 40, -6, 0, 2)];
    const edges = [
      makeEdge(
        0,
        0,
        1,
        [
          [0, 12, 0],
          [20, 33, 0],
          [40, -6, 0],
        ],
        1,
      ),
    ];
    const graph = makeGraph(nodes, edges);
    const snapshot = structuredClone(graph);
    const originalNodes = graph.nodes;
    const originalEdges = graph.edges;
    const originalPoints = graph.edges[0].points;

    const { graph: result } = applyFlatElevation(graph);

    expect(graph).toEqual(snapshot);
    expect(graph.nodes).toBe(originalNodes);
    expect(graph.edges).toBe(originalEdges);
    expect(graph.edges[0].points).toBe(originalPoints);
    expect(result).not.toBe(graph);
    expect(result.nodes).not.toBe(graph.nodes);
    expect(result.edges).not.toBe(graph.edges);
  });

  it("reports zero max-abs Y, correct node/edge/point counts, and totalEdgeLengthM matching the summed edge lengths", () => {
    const nodes = [makeNode(0, 0, 5, 0, 1), makeNode(1, 3, -5, 4, 2), makeNode(2, 3, 8, -4, 3)];
    const edges = [
      makeEdge(
        0,
        0,
        1,
        [
          [0, 5, 0],
          [3, -5, 4],
        ],
        1,
      ),
      makeEdge(
        1,
        0,
        2,
        [
          [0, 5, 0],
          [3, 8, -4],
        ],
        2,
      ),
    ];
    const graph = makeGraph(nodes, edges);

    const { graph: result, report } = applyFlatElevation(graph);

    expect(report.maxAbsNodeY).toBe(0);
    expect(report.maxAbsPointY).toBe(0);
    expect(report.nodeCount).toBe(result.nodes.length);
    expect(report.edgeCount).toBe(result.edges.length);
    expect(report.pointCount).toBe(result.edges.reduce((sum, e) => sum + e.points.length, 0));

    const summedLengthM = result.edges.reduce((sum, e) => sum + e.lengthM, 0);
    expect(report.totalEdgeLengthM).toBeCloseTo(summedLengthM, 9);
  });

  it("throws with the function name and offending edge id when an edge references a node id absent from nodes[]", () => {
    const nodes = [makeNode(0, 0, 0, 0, 1)];
    const edges = [
      makeEdge(
        7,
        0,
        99,
        [
          [0, 0, 0],
          [10, 0, 0],
        ],
        1,
      ),
    ];
    const graph = makeGraph(nodes, edges);

    expect(() => applyFlatElevation(graph)).toThrowError(/applyFlatElevation.*edge id=7/);
  });
});
