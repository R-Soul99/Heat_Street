import { describe, expect, it } from "vitest";
// Real committed artifact, read through Vite's `?raw` transform — the same
// idiom `tests/road-graph-schema.test.ts` uses for the hand-authored
// fixture. This suite asserts against the REAL compiled output, not the
// fixture, per plan 04-04 Task 3's own requirement.
import compiledRaw from "../public/maps/juliette-ga.map.json?raw";
import { buildRoadGeometry } from "../src/core/road-geometry.ts";
import { parseRoadGraph } from "../src/core/road-graph.ts";
import { SURFACE_TYPES } from "../src/core/surface-types.ts";
import {
  formatValidationFailures,
  validateGraph,
} from "../tools/map-compiler/validate/validator.ts";

const graph = parseRoadGraph(compiledRaw, "public/maps/juliette-ga.map.json");
const ENDPOINT_TOLERANCE = 1e-6;

describe("compiled map — public/maps/juliette-ga.map.json (real output)", () => {
  it("conforms to the schema via parseRoadGraph (already asserted at import time above, re-asserted here for a named test)", () => {
    expect(() => parseRoadGraph(compiledRaw, "public/maps/juliette-ga.map.json")).not.toThrow();
  });

  it("has schemaVersion exactly 1", () => {
    expect(graph.schemaVersion).toBe(1);
  });

  it("has dense, contiguous node and edge ids from 0", () => {
    const nodeIds = graph.nodes.map((n) => n.id);
    expect(nodeIds).toEqual([...nodeIds.keys()]);
    const edgeIds = graph.edges.map((e) => e.id);
    expect(edgeIds).toEqual([...edgeIds.keys()]);
  });

  it("matches every edge's endpoints to its from/to node coordinates", () => {
    const byId = new Map(graph.nodes.map((n) => [n.id, n]));
    for (const edge of graph.edges) {
      const from = byId.get(edge.from);
      const to = byId.get(edge.to);
      expect(from).toBeDefined();
      expect(to).toBeDefined();
      const first = edge.points[0];
      const last = edge.points[edge.points.length - 1];
      if (from !== undefined) {
        expect(Math.abs(first[0] - from.x)).toBeLessThanOrEqual(ENDPOINT_TOLERANCE);
        expect(Math.abs(first[1] - from.y)).toBeLessThanOrEqual(ENDPOINT_TOLERANCE);
        expect(Math.abs(first[2] - from.z)).toBeLessThanOrEqual(ENDPOINT_TOLERANCE);
      }
      if (to !== undefined) {
        expect(Math.abs(last[0] - to.x)).toBeLessThanOrEqual(ENDPOINT_TOLERANCE);
        expect(Math.abs(last[1] - to.y)).toBeLessThanOrEqual(ENDPOINT_TOLERANCE);
        expect(Math.abs(last[2] - to.z)).toBeLessThanOrEqual(ENDPOINT_TOLERANCE);
      }
    }
  });

  it("uses only surfaces from the closed six-value enum", () => {
    for (const edge of graph.edges) {
      expect(SURFACE_TYPES as readonly string[]).toContain(edge.surface);
    }
  });

  it("carries the four ADR 0001 attribution strings exactly", () => {
    expect(graph.attribution.osm).toBe("© OpenStreetMap contributors");
    expect(graph.attribution.osmLicense).toBe("ODbL-1.0");
    expect(graph.attribution.osmLicenseUrl).toBe("https://www.openstreetmap.org/copyright");
    expect(graph.attribution.dem).toBe(
      "U.S. Geological Survey 3D Elevation Program (public domain)",
    );
  });

  it("has a parseable ISO-8601 source.osmSnapshot", () => {
    const parsed = Date.parse(graph.source.osmSnapshot);
    expect(Number.isNaN(parsed)).toBe(false);
  });

  it("has bounds containing every node coordinate", () => {
    const { minX, minZ, maxX, maxZ } = graph.bounds;
    for (const node of graph.nodes) {
      expect(node.x).toBeGreaterThanOrEqual(minX);
      expect(node.x).toBeLessThanOrEqual(maxX);
      expect(node.z).toBeGreaterThanOrEqual(minZ);
      expect(node.z).toBeLessThanOrEqual(maxZ);
    }
  });

  it("has at least two distinct surface values (SC2)", () => {
    const surfaces = new Set(graph.edges.map((e) => e.surface));
    expect(surfaces.size).toBeGreaterThanOrEqual(2);
  });

  it("has at least 20 edges and at least 3 junction nodes (a sanity floor)", () => {
    expect(graph.edges.length).toBeGreaterThanOrEqual(20);
    expect(graph.nodes.filter((n) => n.junction).length).toBeGreaterThanOrEqual(3);
  });

  it("contains at least one cycle (D-08's genuine loops) — edges.length >= nodes.length for a connected graph", () => {
    expect(graph.edges.length).toBeGreaterThanOrEqual(graph.nodes.length);
  });

  // --- Plan 04-05: elevation (D-09, SC1's elevation failure mode) ---

  it("has non-zero, varying node y values — at least 10 distinct values (a flat map would mean the DEM stage silently no-opped)", () => {
    const distinctY = new Set(graph.nodes.map((n) => n.y));
    expect(distinctY.size).toBeGreaterThanOrEqual(10);
    expect(graph.nodes.some((n) => n.y !== 0)).toBe(true);
  });

  it("has at least 10m of node elevation relief and every node inside the 50-250m Georgia Piedmont plausibility band", () => {
    const elevations = graph.nodes.map((n) => n.y);
    const min = Math.min(...elevations);
    const max = Math.max(...elevations);
    const relief = max - min;

    expect(relief).toBeGreaterThanOrEqual(10);
    for (const y of elevations) {
      expect(y).toBeGreaterThanOrEqual(50);
      expect(y).toBeLessThanOrEqual(250);
    }
  });

  it("matches every edge's first/last point Y to its from/to node's y with EXACT float equality (no tolerance — a junction step is SC1's named failure mode)", () => {
    const byId = new Map(graph.nodes.map((n) => [n.id, n]));
    for (const edge of graph.edges) {
      const from = byId.get(edge.from);
      const to = byId.get(edge.to);
      expect(from).toBeDefined();
      expect(to).toBeDefined();
      if (from !== undefined) {
        expect(edge.points[0][1]).toBe(from.y);
      }
      if (to !== undefined) {
        expect(edge.points[edge.points.length - 1][1]).toBe(to.y);
      }
    }
  });

  it("has no edge whose maximum gradient exceeds 0.5 (27 degrees — steeper than any real rural Georgia road; a misaligned DEM, not dramatic terrain)", () => {
    for (const edge of graph.edges) {
      let maxGradient = 0;
      for (let i = 1; i < edge.points.length; i++) {
        const dx = edge.points[i][0] - edge.points[i - 1][0];
        const dz = edge.points[i][2] - edge.points[i - 1][2];
        const dy = edge.points[i][1] - edge.points[i - 1][1];
        const runXZ = Math.sqrt(dx * dx + dz * dz);
        if (runXZ > 0) {
          const gradient = Math.abs(dy) / runXZ;
          if (gradient > maxGradient) maxGradient = gradient;
        }
      }
      expect(maxGradient, `edge id=${edge.id} maxGradient=${maxGradient}`).toBeLessThanOrEqual(0.5);
    }
  });

  it("has source.compilerVersion 0.2.0 (elevation changed emitted geometry — plan 04-05)", () => {
    expect(graph.source.compilerVersion).toBe("0.2.0");
  });

  // --- Plan 04-06: validator wired as a build gate (SC5, D-P17/D-P18) ---

  it("passes validateGraph with zero failures — proves the shipped gate is not trivially green: it ran against this exact artifact at compile time and this test re-runs it against the same real data", () => {
    const geometry = buildRoadGeometry(graph);
    const failures = validateGraph(graph, geometry);
    expect(formatValidationFailures(failures)).toBe("");
  });

  it("paired negative case: deleting one edge from the REAL artifact to disconnect a dead-end node makes validateGraph report a failure naming that node — proving the gate is not trivially green against real data", () => {
    // Node 18 is a real degree-1 (dead-end) node in the committed artifact,
    // reached only via edge 34 (22 -> 18). Removing that one edge orphans
    // node 18: no edge references it any longer, and it becomes unreachable
    // (undirected) and unpathable (directed) from the root. Re-verify both
    // assumptions defensively so this test fails loudly, rather than
    // vacuously passing, if the compiled artifact's topology ever changes.
    const disconnectedNodeId = 18;
    const removedEdgeId = 34;
    const removedEdge = graph.edges.find((e) => e.id === removedEdgeId);
    expect(removedEdge).toBeDefined();
    expect(removedEdge?.from === disconnectedNodeId || removedEdge?.to === disconnectedNodeId).toBe(
      true,
    );
    const otherEdgesTouchingNode = graph.edges.filter(
      (e) =>
        e.id !== removedEdgeId && (e.from === disconnectedNodeId || e.to === disconnectedNodeId),
    );
    expect(otherEdgesTouchingNode).toHaveLength(0);

    const mutatedGraph = {
      ...graph,
      edges: graph.edges.filter((e) => e.id !== removedEdgeId),
    };
    const geometry = buildRoadGeometry(mutatedGraph);
    const failures = validateGraph(mutatedGraph, geometry);

    expect(failures.length).toBeGreaterThan(0);
    expect(failures.some((f) => f.kind === "node" && f.id === disconnectedNodeId)).toBe(true);
    expect(formatValidationFailures(failures)).toContain(`node ${disconnectedNodeId}`);
  });
});
