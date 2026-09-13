import { describe, expect, it } from "vitest";
import type { RoadGraph, RoadGraphEdge, RoadGraphNode } from "../../../src/core/road-graph.ts";
import type { ElevationSampler } from "../sources/dem.ts";
import { applyElevation, GRADIENT_WARNING_THRESHOLD } from "./elevation.ts";
import { makeProjector, type Projector } from "./project.ts";

const projector: Projector = makeProjector({ lat: 33.1, lon: -83.8 });

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

function makeStraightPoints(
  x0: number,
  z0: number,
  x1: number,
  z1: number,
  n: number,
): [number, number, number][] {
  const points: [number, number, number][] = [];
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    points.push([x0 + (x1 - x0) * t, 0, z0 + (z1 - z0) * t]);
  }
  return points;
}

/** Builds a minimal, schema-shaped two-node one-edge `RoadGraph` fixture. */
function makeTwoNodeGraph(points: readonly (readonly [number, number, number])[]): RoadGraph {
  const first = points[0];
  const last = points[points.length - 1];
  const nodeA: RoadGraphNode = {
    id: 0,
    x: first[0],
    y: 0,
    z: first[2],
    junction: false,
    osmNodeId: 1,
  };
  const nodeB: RoadGraphNode = {
    id: 1,
    x: last[0],
    y: 0,
    z: last[2],
    junction: false,
    osmNodeId: 2,
  };
  const edge: RoadGraphEdge = {
    id: 0,
    from: 0,
    to: 1,
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
    osmWayId: 1,
  };
  return {
    ...baseGraphFields(),
    bounds: {
      minX: Math.min(nodeA.x, nodeB.x),
      minZ: Math.min(nodeA.z, nodeB.z),
      maxX: Math.max(nodeA.x, nodeB.x),
      maxZ: Math.max(nodeA.z, nodeB.z),
    },
    nodes: [nodeA, nodeB],
    edges: [edge],
  };
}

/** Builds a synthetic 4-way junction: one shared centre node with four short spokes. */
function makeFourWayJunctionGraph(): RoadGraph {
  const centre: RoadGraphNode = { id: 0, x: 0, y: 0, z: 0, junction: true, osmNodeId: 1 };
  const spokes = [
    { id: 1, x: 20, z: 0, osmNodeId: 2 }, // east
    { id: 2, x: -20, z: 0, osmNodeId: 3 }, // west
    { id: 3, x: 0, z: 20, osmNodeId: 4 }, // "north" in this local frame
    { id: 4, x: 0, z: -20, osmNodeId: 5 }, // "south" in this local frame
  ];
  const nodes: RoadGraphNode[] = [
    centre,
    ...spokes.map((s) => ({
      id: s.id,
      x: s.x,
      y: 0,
      z: s.z,
      junction: false,
      osmNodeId: s.osmNodeId,
    })),
  ];
  const edges: RoadGraphEdge[] = spokes.map((s, i) => {
    const points = makeStraightPoints(0, 0, s.x, s.z, 6);
    return {
      id: i,
      from: 0,
      to: s.id,
      points,
      lengthM: 20,
      surface: "tarmac",
      roadClass: "residential",
      lanes: 2,
      widthM: 6.5,
      oneway: false,
      speedLimitKph: 50,
      bridge: false,
      tunnel: false,
      layer: 0,
      osmWayId: i + 1,
    };
  });
  return {
    ...baseGraphFields(),
    bounds: { minX: -20, minZ: -20, maxX: 20, maxZ: 20 },
    nodes,
    edges,
  };
}

function makeSawtoothSampler(periodM: number, amplitudeM: number, baseM = 100): ElevationSampler {
  return {
    sample(lat: number, lon: number): number {
      const { x } = projector.project(lat, lon);
      const wrapped = ((x % periodM) + periodM) % periodM;
      return baseM + amplitudeM * (wrapped / periodM);
    },
  };
}

function makeNoisyJunctionSampler(amplitudeM: number, baseM = 100): ElevationSampler {
  // Deterministic pseudo-noise as a function of BOTH x and z, so every one of
  // the four spokes (which vary in x XOR z) samples genuinely different raw
  // values along their length, making the "all four agree at the shared
  // node" assertion non-trivial.
  return {
    sample(lat: number, lon: number): number {
      const { x, z } = projector.project(lat, lon);
      return baseM + amplitudeM * Math.sin(x * 0.7 + z * 1.3);
    },
  };
}

function makeRampSampler(slopePerMetre: number, baseM = 100): ElevationSampler {
  return {
    sample(lat: number, lon: number): number {
      const { x } = projector.project(lat, lon);
      return baseM + slopePerMetre * x;
    },
  };
}

function makeBumpSampler(
  centerX: number,
  heightM: number,
  widthM: number,
  baseM = 100,
): ElevationSampler {
  return {
    sample(lat: number, lon: number): number {
      const { x } = projector.project(lat, lon);
      const dist = Math.abs(x - centerX);
      if (dist > widthM) return baseM;
      return baseM + heightM * (1 - dist / widthM);
    },
  };
}

function sumAbsSecondDifference(values: readonly number[]): number {
  let total = 0;
  for (let i = 1; i < values.length - 1; i++) {
    total += Math.abs(values[i + 1] - 2 * values[i] + values[i - 1]);
  }
  return total;
}

describe("applyElevation", () => {
  it("sets every node's y to the sampler's value at that node's lat/lon, unmodified by any smoothing", () => {
    const points = makeStraightPoints(0, 0, 40, 0, 21);
    const graph = makeTwoNodeGraph(points);
    const sampler = makeSawtoothSampler(6, 8);

    const { graph: result } = applyElevation(graph, sampler, projector);

    for (const node of result.nodes) {
      const { lat, lon } = projector.unproject(node.x, node.z);
      expect(node.y).toBe(sampler.sample(lat, lon));
    }
  });

  it("clamps every edge's first/last point Y to its from/to node's y exactly", () => {
    const points = makeStraightPoints(0, 0, 40, 0, 21);
    const graph = makeTwoNodeGraph(points);
    const sampler = makeSawtoothSampler(6, 8);

    const { graph: result } = applyElevation(graph, sampler, projector);
    const edge = result.edges[0];
    const fromNode = result.nodes.find((n) => n.id === edge.from);
    const toNode = result.nodes.find((n) => n.id === edge.to);

    expect(fromNode).toBeDefined();
    expect(toNode).toBeDefined();
    expect(edge.points[0][1]).toBe(fromNode?.y);
    expect(edge.points[edge.points.length - 1][1]).toBe(toNode?.y);
  });

  it("rejects DEM noise: summed absolute second difference drops by at least 60% after smoothing (sawtooth DEM)", () => {
    const points = makeStraightPoints(0, 0, 40, 0, 21);
    const graph = makeTwoNodeGraph(points);
    const sampler = makeSawtoothSampler(6, 8);

    const rawY = points.map((p) => {
      const { lat, lon } = projector.unproject(p[0], p[2]);
      return sampler.sample(lat, lon);
    });
    const { graph: result } = applyElevation(graph, sampler, projector);
    const smoothedY = result.edges[0].points.map((p) => p[1]);

    const rawSecondDiff = sumAbsSecondDifference(rawY);
    const smoothedSecondDiff = sumAbsSecondDifference(smoothedY);

    expect(smoothedSecondDiff).toBeLessThanOrEqual(rawSecondDiff * 0.4);
  });

  it("preserves large-scale relief: a monotonic ramp DEM produces a monotonically increasing smoothed Y with total rise within 1% of the raw sampled rise", () => {
    const points = makeStraightPoints(0, 0, 40, 0, 21);
    const graph = makeTwoNodeGraph(points);
    const sampler = makeRampSampler(0.5); // 0.5 m of rise per metre of X

    const rawY = points.map((p) => {
      const { lat, lon } = projector.unproject(p[0], p[2]);
      return sampler.sample(lat, lon);
    });
    const { graph: result } = applyElevation(graph, sampler, projector);
    const smoothedY = result.edges[0].points.map((p) => p[1]);

    for (let i = 1; i < smoothedY.length; i++) {
      expect(smoothedY[i]).toBeGreaterThanOrEqual(smoothedY[i - 1]);
    }

    const rawRise = rawY[rawY.length - 1] - rawY[0];
    const smoothedRise = smoothedY[smoothedY.length - 1] - smoothedY[0];
    expect(Math.abs(smoothedRise - rawRise) / rawRise).toBeLessThanOrEqual(0.01);
  });

  it("leaves a 2-point edge unchanged beyond clamping its two endpoints to node heights", () => {
    const points = makeStraightPoints(0, 0, 40, 0, 2);
    const graph = makeTwoNodeGraph(points);
    const sampler = makeSawtoothSampler(6, 8);

    const { graph: result } = applyElevation(graph, sampler, projector);
    const edge = result.edges[0];
    const fromNode = result.nodes.find((n) => n.id === edge.from);
    const toNode = result.nodes.find((n) => n.id === edge.to);

    expect(edge.points).toHaveLength(2);
    expect(edge.points[0][1]).toBe(fromNode?.y);
    expect(edge.points[1][1]).toBe(toNode?.y);
  });

  it("gives every edge meeting at a shared node exactly equal Y at that node, across a synthetic 4-way junction with noisy terrain", () => {
    const graph = makeFourWayJunctionGraph();
    const sampler = makeNoisyJunctionSampler(15);

    const { graph: result } = applyElevation(graph, sampler, projector);
    const centreNode = result.nodes.find((n) => n.id === 0);
    expect(centreNode).toBeDefined();

    for (const edge of result.edges) {
      expect(edge.from).toBe(0);
      expect(edge.points[0][1]).toBe(centreNode?.y);
    }
    // All four edges' first-point Y values are identical to each other, not
    // just individually equal to centreNode.y (redundant given the above,
    // but asserted directly per the plan's own phrasing).
    const firstPointYs = new Set(result.edges.map((e) => e.points[0][1]));
    expect(firstPointYs.size).toBe(1);
  });

  it("reports per-edge maximum gradient and lists an edge exceeding the 0.35 threshold by edge id", () => {
    const points = makeStraightPoints(0, 0, 20, 0, 11);
    const graph = makeTwoNodeGraph(points);
    const sampler = makeBumpSampler(10, 50, 3); // a sharp local bump — smoothed gradient still steep

    const { report } = applyElevation(graph, sampler, projector);

    expect(report.edgeGradients).toHaveLength(1);
    expect(report.edgeGradients[0].edgeId).toBe(0);
    expect(report.edgeGradients[0].maxGradient).toBeGreaterThan(GRADIENT_WARNING_THRESHOLD);

    expect(report.steepEdges).toHaveLength(1);
    expect(report.steepEdges[0].edgeId).toBe(0);
  });

  it("does not report any steep edge for a gentle, realistic slope", () => {
    const points = makeStraightPoints(0, 0, 40, 0, 21);
    const graph = makeTwoNodeGraph(points);
    const sampler = makeRampSampler(0.05); // a gentle 5% grade

    const { report } = applyElevation(graph, sampler, projector);

    expect(report.steepEdges).toHaveLength(0);
  });

  it("computes min/max node elevation and relief across the graph", () => {
    const graph = makeFourWayJunctionGraph();
    const sampler = makeNoisyJunctionSampler(15);

    const { report } = applyElevation(graph, sampler, projector);

    expect(report.maxNodeElevationM).toBeGreaterThanOrEqual(report.minNodeElevationM);
    expect(report.reliefM).toBeCloseTo(report.maxNodeElevationM - report.minNodeElevationM, 9);
  });

  it("does not mutate its input graph", () => {
    const points = makeStraightPoints(0, 0, 40, 0, 21);
    const graph = makeTwoNodeGraph(points);
    const snapshot = structuredClone(graph);
    const sampler = makeSawtoothSampler(6, 8);

    applyElevation(graph, sampler, projector);

    expect(graph).toEqual(snapshot);
  });

  it("returns a graph object distinct from the input (never the same reference)", () => {
    const points = makeStraightPoints(0, 0, 40, 0, 21);
    const graph = makeTwoNodeGraph(points);
    const sampler = makeSawtoothSampler(6, 8);

    const { graph: result } = applyElevation(graph, sampler, projector);

    expect(result).not.toBe(graph);
    expect(result.nodes).not.toBe(graph.nodes);
    expect(result.edges).not.toBe(graph.edges);
  });
});
