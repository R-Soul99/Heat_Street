import { describe, expect, it } from "vitest";

// Both files are read through Vite's `?raw` transform rather than `node:fs`.
// `@types/node` is not installed and this phase's threat model (T-01-SC) forbids
// adding packages, so `node:fs` fails `tsc --noEmit`. `?raw` is typed by
// `vite/client` (already in tsconfig `types`) and still genuinely reads the file
// from disk on every run. This is the pattern established by plan 01-02 in
// tests/frame-budget.test.ts.
import schemaDoc from "../docs/schemas/road-graph.v1.md?raw";
import fixtureRaw from "../fixtures/road-graph.sample.json?raw";

interface GraphNode {
  id: number;
  x: number;
  y: number;
  z: number;
  junction: boolean;
  osmNodeId: number;
}

interface GraphEdge {
  id: number;
  from: number;
  to: number;
  points: number[][];
  lengthM: number;
  surface: string;
  roadClass: string;
  lanes: number;
  widthM: number;
  oneway: boolean;
  speedLimitKph: number;
  bridge: boolean;
  tunnel: boolean;
  layer: number;
  osmWayId: number;
}

interface RoadGraph {
  schemaVersion: number;
  areaId: string;
  name: string;
  source: Record<string, string>;
  attribution: Record<string, string>;
  origin: { lat: number; lon: number; projection: string };
  bounds: { minX: number; minZ: number; maxX: number; maxZ: number };
  nodes: GraphNode[];
  edges: GraphEdge[];
  spawns?: Array<{ id: string; nodeId: number; headingRad: number }>;
}

const REQUIRED_TOP_LEVEL = [
  "schemaVersion",
  "areaId",
  "name",
  "source",
  "attribution",
  "origin",
  "bounds",
  "nodes",
  "edges",
] as const;

const REQUIRED_SOURCE = ["osmExtract", "osmSnapshot", "demSource", "compilerVersion"] as const;
const REQUIRED_ATTRIBUTION = ["osm", "osmLicense", "osmLicenseUrl", "dem"] as const;
const REQUIRED_NODE = ["id", "x", "y", "z", "junction", "osmNodeId"] as const;
const REQUIRED_EDGE = [
  "id",
  "from",
  "to",
  "points",
  "lengthM",
  "surface",
  "roadClass",
  "lanes",
  "widthM",
  "oneway",
  "speedLimitKph",
  "bridge",
  "tunnel",
  "layer",
  "osmWayId",
] as const;

const OSM_COPYRIGHT_URL = "https://www.openstreetmap.org/copyright";
const ENDPOINT_TOLERANCE = 1e-6;

/**
 * The enum is read FROM the schema document, not hardcoded here. Adding a
 * seventh surface to `docs/schemas/road-graph.v1.md` without updating the
 * compiler and fixture therefore surfaces as a test failure rather than as a
 * doc/code divergence nobody notices. This mirrors the doc/code drift guard
 * plan 01-02 established for the frame budget.
 *
 * Not exported: biome's lint/suspicious/noExportsInTest forbids exports from a
 * test file, and nothing outside this file needs it.
 */
function surfaceEnumFromDoc(doc: string): string[] {
  const match = doc.match(/^SURFACE_ENUM\s*=\s*(.+)$/m);
  if (match === null) {
    throw new Error(
      "docs/schemas/road-graph.v1.md contains no normative `SURFACE_ENUM = a | b | ...` line",
    );
  }
  return match[1]
    .split("|")
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
}

const SURFACES = surfaceEnumFromDoc(schemaDoc);
const graph = JSON.parse(fixtureRaw) as RoadGraph;
const nodeIds = new Set(graph.nodes.map((node) => node.id));

describe("road graph v1 — schema document", () => {
  it("declares a closed six-value surface enum", () => {
    expect(SURFACES).toEqual(["tarmac", "gravel", "dirt_road", "grass", "sand", "mud"]);
  });

  it("documents local-enu-metres as the v1 projection", () => {
    expect(schemaDoc).toContain("local-enu-metres");
  });

  it("documents the mandatory provenance fields", () => {
    for (const key of REQUIRED_SOURCE) {
      expect(schemaDoc).toContain(key);
    }
  });
});

describe("road graph v1 — fixture conforms", () => {
  it("parses as JSON", () => {
    expect(typeof graph).toBe("object");
    expect(fixtureRaw.length).toBeGreaterThan(500);
  });

  it("has every required top-level key", () => {
    for (const key of REQUIRED_TOP_LEVEL) {
      expect(graph).toHaveProperty(key);
    }
  });

  it("has schemaVersion exactly the number 1", () => {
    expect(graph.schemaVersion).toBe(1);
    expect(typeof graph.schemaVersion).toBe("number");
  });

  it("carries complete provenance so a shipped map traces to its inputs", () => {
    for (const key of REQUIRED_SOURCE) {
      expect(typeof graph.source[key]).toBe("string");
      expect(graph.source[key]).not.toBe("");
    }
  });

  it("carries a complete attribution block pointing at the OSM copyright URL", () => {
    for (const key of REQUIRED_ATTRIBUTION) {
      expect(typeof graph.attribution[key]).toBe("string");
      expect(graph.attribution[key]).not.toBe("");
    }
    expect(graph.attribution.osmLicense).toBe("ODbL-1.0");
    expect(graph.attribution.osmLicenseUrl).toBe(OSM_COPYRIGHT_URL);
  });

  it("declares the v1 projection on its origin", () => {
    expect(graph.origin.projection).toBe("local-enu-metres");
    expect(Number.isFinite(graph.origin.lat)).toBe(true);
    expect(Number.isFinite(graph.origin.lon)).toBe(true);
  });

  it("is a 4-node, 4-edge square loop", () => {
    expect(graph.nodes).toHaveLength(4);
    expect(graph.edges).toHaveLength(4);
  });

  it("has dense node ids contiguous from 0", () => {
    const ids = graph.nodes.map((node) => node.id);
    expect(ids).toEqual([...ids.keys()]);
  });

  it("populates every required node field", () => {
    for (const node of graph.nodes) {
      for (const key of REQUIRED_NODE) {
        expect(node).toHaveProperty(key);
      }
      expect(Number.isFinite(node.x)).toBe(true);
      expect(Number.isFinite(node.y)).toBe(true);
      expect(Number.isFinite(node.z)).toBe(true);
      expect(typeof node.junction).toBe("boolean");
    }
  });

  it("places every node coordinate inside bounds", () => {
    const { minX, minZ, maxX, maxZ } = graph.bounds;
    expect(minX).toBeLessThan(maxX);
    expect(minZ).toBeLessThan(maxZ);
    for (const node of graph.nodes) {
      expect(node.x).toBeGreaterThanOrEqual(minX);
      expect(node.x).toBeLessThanOrEqual(maxX);
      expect(node.z).toBeGreaterThanOrEqual(minZ);
      expect(node.z).toBeLessThanOrEqual(maxZ);
    }
  });

  it("populates every required edge field", () => {
    for (const edge of graph.edges) {
      for (const key of REQUIRED_EDGE) {
        expect(edge).toHaveProperty(key);
      }
      expect(typeof edge.oneway).toBe("boolean");
      expect(typeof edge.bridge).toBe("boolean");
      expect(typeof edge.tunnel).toBe("boolean");
      expect(Number.isInteger(edge.layer)).toBe(true);
    }
  });

  it("references only existing node ids from every edge", () => {
    for (const edge of graph.edges) {
      expect(nodeIds.has(edge.from)).toBe(true);
      expect(nodeIds.has(edge.to)).toBe(true);
    }
  });

  it("uses only surfaces from the closed enum", () => {
    for (const edge of graph.edges) {
      expect(SURFACES).toContain(edge.surface);
    }
  });

  it("has exactly one gravel edge", () => {
    const gravel = graph.edges.filter((edge) => edge.surface === "gravel");
    expect(gravel).toHaveLength(1);
  });

  it("gives every edge a polyline of at least two 3-number tuples", () => {
    for (const edge of graph.edges) {
      expect(edge.points.length).toBeGreaterThanOrEqual(2);
      for (const point of edge.points) {
        expect(point).toHaveLength(3);
        for (const component of point) {
          expect(Number.isFinite(component)).toBe(true);
        }
      }
    }
  });

  it("matches each polyline's endpoints to its from/to node coordinates", () => {
    const byId = new Map(graph.nodes.map((node) => [node.id, node]));
    for (const edge of graph.edges) {
      const first = edge.points[0];
      const last = edge.points[edge.points.length - 1];
      const from = byId.get(edge.from);
      const to = byId.get(edge.to);
      expect(from).toBeDefined();
      expect(to).toBeDefined();
      if (from === undefined || to === undefined) continue;
      expect(Math.abs(first[0] - from.x)).toBeLessThanOrEqual(ENDPOINT_TOLERANCE);
      expect(Math.abs(first[1] - from.y)).toBeLessThanOrEqual(ENDPOINT_TOLERANCE);
      expect(Math.abs(first[2] - from.z)).toBeLessThanOrEqual(ENDPOINT_TOLERANCE);
      expect(Math.abs(last[0] - to.x)).toBeLessThanOrEqual(ENDPOINT_TOLERANCE);
      expect(Math.abs(last[1] - to.y)).toBeLessThanOrEqual(ENDPOINT_TOLERANCE);
      expect(Math.abs(last[2] - to.z)).toBeLessThanOrEqual(ENDPOINT_TOLERANCE);
    }
  });

  it("closes the loop: every node has degree 2", () => {
    const degree = new Map<number, number>();
    for (const edge of graph.edges) {
      degree.set(edge.from, (degree.get(edge.from) ?? 0) + 1);
      degree.set(edge.to, (degree.get(edge.to) ?? 0) + 1);
    }
    for (const node of graph.nodes) {
      expect(degree.get(node.id)).toBe(2);
    }
  });

  it("has an optional spawn that references a real node", () => {
    expect(graph.spawns).toBeDefined();
    for (const spawn of graph.spawns ?? []) {
      expect(nodeIds.has(spawn.nodeId)).toBe(true);
      expect(Number.isFinite(spawn.headingRad)).toBe(true);
    }
  });
});

describe("road graph v1 — the enum check is discriminating", () => {
  it("rejects a raw OSM surface value that is not in the game enum", () => {
    expect(SURFACES).not.toContain("asphalt");
    expect(SURFACES).not.toContain("cobblestone");
  });

  it("throws when the schema doc has no normative enum line", () => {
    expect(() => surfaceEnumFromDoc("# a doc with no enum line\n")).toThrow(/SURFACE_ENUM/);
  });
});
