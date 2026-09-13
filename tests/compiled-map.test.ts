import { describe, expect, it } from "vitest";
// Real committed artifact, read through Vite's `?raw` transform — the same
// idiom `tests/road-graph-schema.test.ts` uses for the hand-authored
// fixture. This suite asserts against the REAL compiled output, not the
// fixture, per plan 04-04 Task 3's own requirement.
import compiledRaw from "../public/maps/juliette-ga.map.json?raw";
import { parseRoadGraph } from "../src/core/road-graph.ts";
import { SURFACE_TYPES } from "../src/core/surface-types.ts";

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
});
