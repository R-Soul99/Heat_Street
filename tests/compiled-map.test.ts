import { describe, expect, it } from "vitest";
import collisionRaw from "../public/maps/juliette-ga.collision.json?raw";
// Real committed artifacts, read through Vite's `?raw` transform — the same
// idiom `tests/road-graph-schema.test.ts` uses for the hand-authored
// fixture. This suite asserts against the REAL compiled output, not a
// fixture, per plan 04-04 Task 3's own requirement (and, since phase 04.1,
// against the real `.collision.json` sidecar too).
import compiledRaw from "../public/maps/juliette-ga.map.json?raw";
import { crestsForArea } from "../src/core/crest-geometry.ts";
import { sampleHeightfieldBilinear } from "../src/core/heightfield-sample.ts";
import { parseMapCollision } from "../src/core/map-collision.ts";
import { buildRoadGeometry, TARGET_SHOULDER_WIDTH_M } from "../src/core/road-geometry.ts";
import { parseRoadGraph } from "../src/core/road-graph.ts";
import { SURFACE_TYPES } from "../src/core/surface-types.ts";
import {
  HEIGHTFIELD_SINK_M,
  RELIEF_AMPLITUDE_M,
} from "../tools/map-compiler/author/heightfield.ts";
import {
  formatValidationFailures,
  validateGraph,
} from "../tools/map-compiler/validate/validator.ts";

const graph = parseRoadGraph(compiledRaw, "public/maps/juliette-ga.map.json");
const collision = parseMapCollision(
  collisionRaw,
  "juliette-ga",
  "public/maps/juliette-ga.collision.json",
);
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

  it("carries the four ADR 0001 attribution strings exactly, and the phase 04.1 flat-terrain provenance fields", () => {
    expect(graph.attribution.osm).toBe("© OpenStreetMap contributors");
    expect(graph.attribution.osmLicense).toBe("ODbL-1.0");
    expect(graph.attribution.osmLicenseUrl).toBe("https://www.openstreetmap.org/copyright");
    expect(graph.attribution.dem).toBe(
      "Terrain elevation is flat and hand-authored — no DEM data is used (see docs/adr/0001-map-data-source.md)",
    );
    expect(graph.source.demSource).toBe("none-flat-authored");
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

  // --- Plan 04.1-09: elevation, inverted from DEM relief to exact flatness
  // (D-01, D-09, SC1's elevation failure mode reversed: a NON-flat map now
  // means the flat-elevation stage silently no-opped or a DEM path was
  // reintroduced) ---

  it("has exactly one distinct node y value, and it is exactly 0 (a non-flat map would mean the flat-elevation stage silently no-opped or a DEM path was reintroduced)", () => {
    const distinctY = new Set(graph.nodes.map((n) => n.y));
    expect(distinctY.size).toBe(1);
    expect(distinctY.has(0)).toBe(true);
  });

  it("has exactly 0m of node elevation relief (every node's y is identically 0 — the DEM-era 50-250m Georgia Piedmont plausibility band no longer applies)", () => {
    const elevations = graph.nodes.map((n) => n.y);
    const min = Math.min(...elevations);
    const max = Math.max(...elevations);
    const relief = max - min;

    expect(relief).toBe(0);
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

  it("has exactly zero gradient on every edge (a flat polyline has zero rise everywhere; any non-zero gradient means a DEM path was reintroduced)", () => {
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
      expect(maxGradient, `edge id=${edge.id} maxGradient=${maxGradient}`).toBe(0);
    }
  });

  it("has source.compilerVersion 0.6.0 (flat-terrain stage set — phase 04.1)", () => {
    expect(graph.source.compilerVersion).toBe("0.6.0");
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

// --- Plan 04.1-09: real-artifact assertions for the phase's headline claims
// (D-01, D-02, D-02a, D-02b, D-04, D-07) — measured against the REAL
// regenerated public/maps/juliette-ga.* artifacts, not a fixture. Each
// assertion here is a real-data companion to a unit test that already covers
// the same behavior against a synthetic fixture elsewhere in this repo. ---

const heightfield = collision.heightfield;
if (heightfield === undefined) {
  throw new Error("compiled-map.test.ts: the real collision sidecar has no heightfield block");
}

/** 2D (XZ) distance from a point to the closest point on a segment. */
function distPointToSegmentXZ(
  px: number,
  pz: number,
  ax: number,
  az: number,
  bx: number,
  bz: number,
): number {
  const abx = bx - ax;
  const abz = bz - az;
  const apx = px - ax;
  const apz = pz - az;
  const abLenSq = abx * abx + abz * abz;
  let t = abLenSq > 0 ? (apx * abx + apz * abz) / abLenSq : 0;
  t = Math.min(1, Math.max(0, t));
  const cx = ax + abx * t;
  const cz = az + abz * t;
  const dx = px - cx;
  const dz = pz - cz;
  return Math.sqrt(dx * dx + dz * dz);
}

/** 2D (XZ) distance from a point to the closest point on an edge's centreline polyline. */
function distPointToPolylineXZ(
  px: number,
  pz: number,
  points: readonly (readonly [number, number, number])[],
): number {
  let min = Number.POSITIVE_INFINITY;
  for (let i = 1; i < points.length; i++) {
    const d = distPointToSegmentXZ(
      px,
      pz,
      points[i - 1][0],
      points[i - 1][2],
      points[i][0],
      points[i][2],
    );
    if (d < min) min = d;
  }
  return min;
}

/**
 * Per-point unit tangent in the XZ plane, matching `road-geometry.ts`'s own
 * "average of incoming/outgoing segment direction" convention (simplified —
 * this test needs a direction to derive a perpendicular from, not a miter
 * factor). Falls back to whichever neighbouring segment is non-degenerate.
 */
function edgePointTangentXZ(
  points: readonly (readonly [number, number, number])[],
  i: number,
): { x: number; z: number } | null {
  const n = points.length;
  const seg = (a: number, b: number): { x: number; z: number } | null => {
    const x = points[b][0] - points[a][0];
    const z = points[b][2] - points[a][2];
    const len = Math.sqrt(x * x + z * z);
    return len > 0 ? { x: x / len, z: z / len } : null;
  };
  if (n < 2) return null;
  if (i === 0) return seg(0, 1);
  if (i === n - 1) return seg(n - 2, n - 1);
  const din = seg(i - 1, i);
  const dout = seg(i, i + 1);
  if (din === null) return dout;
  if (dout === null) return din;
  const sx = din.x + dout.x;
  const sz = din.z + dout.z;
  const len = Math.sqrt(sx * sx + sz * sz);
  return len > 0 ? { x: sx / len, z: sz / len } : din;
}

/** The p-th percentile (0-1) of a sorted-in-place-copy numeric array. */
function percentile(values: readonly number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length === 0) return Number.NaN;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.round(p * (sorted.length - 1))));
  return sorted[idx];
}

describe("compiled map — flat terrain (phase 04.1)", () => {
  it("has y exactly 0 on every edge point (D-01: roads flat everywhere, no exception)", () => {
    for (const edge of graph.edges) {
      for (let i = 0; i < edge.points.length; i++) {
        expect(edge.points[i][1], `edge id=${edge.id} point[${i}] y=${edge.points[i][1]}`).toBe(0);
      }
    }
  });

  it("has every edge's lengthM matching its own 2D (XZ) polyline length within 1e-6", () => {
    for (const edge of graph.edges) {
      let xzLength = 0;
      for (let i = 1; i < edge.points.length; i++) {
        const dx = edge.points[i][0] - edge.points[i - 1][0];
        const dz = edge.points[i][2] - edge.points[i - 1][2];
        xzLength += Math.sqrt(dx * dx + dz * dz);
      }
      expect(
        Math.abs(edge.lengthM - xzLength),
        `edge id=${edge.id} lengthM=${edge.lengthM} xzLength=${xzLength}`,
      ).toBeLessThanOrEqual(1e-6);
    }
  });

  it("has a real collision.json heightfield.sinkM matching HEIGHTFIELD_SINK_M, every height within the +/-RELIEF_AMPLITUDE_M cap (D-02a)", () => {
    expect(heightfield.sinkM).toBe(HEIGHTFIELD_SINK_M);
    const lowerBound = -(RELIEF_AMPLITUDE_M + HEIGHTFIELD_SINK_M) - 1e-3;
    const upperBound = RELIEF_AMPLITUDE_M - HEIGHTFIELD_SINK_M + 1e-3;
    for (let i = 0; i < heightfield.heights.length; i++) {
      const h = heightfield.heights[i];
      expect(h, `heights[${i}]=${h}`).toBeGreaterThanOrEqual(lowerBound);
      expect(h, `heights[${i}]=${h}`).toBeLessThanOrEqual(upperBound);
    }
  });

  it("has terrain never above the road anywhere on the real map (D-02b's headline claim — the DEM-era artifact had 123 such violations before plan 04-11's densification fix, worst case 3.25m; this must now be 0)", () => {
    let worst: { edgeId: number; pointIndex: number; height: number } | null = null;
    let violationCount = 0;
    for (const edge of graph.edges) {
      for (let i = 0; i < edge.points.length; i++) {
        const [x, , z] = edge.points[i];
        const terrainY = sampleHeightfieldBilinear(heightfield, x, z);
        if (terrainY > 1e-6) {
          violationCount++;
          if (worst === null || terrainY > worst.height) {
            worst = { edgeId: edge.id, pointIndex: i, height: terrainY };
          }
        }
      }
    }
    expect(
      violationCount,
      worst === null
        ? "0 violations"
        : `worst violation: edge id=${worst.edgeId} point[${worst.pointIndex}] height=${worst.height}`,
    ).toBe(0);
  });

  it("keeps the shoulder grade under 15 degrees max / 8 degrees p95 across the whole real map (D-04)", () => {
    const ratios: number[] = [];
    let worstRatio = 0;
    let worstLabel = "";
    for (const edge of graph.edges) {
      for (let i = 0; i < edge.points.length; i++) {
        const tangent = edgePointTangentXZ(edge.points, i);
        if (tangent === null) continue;
        const perp = { x: -tangent.z, z: tangent.x };
        const [px, , pz] = edge.points[i];
        for (const sign of [1, -1] as const) {
          const sx = px + perp.x * TARGET_SHOULDER_WIDTH_M * sign;
          const sz = pz + perp.z * TARGET_SHOULDER_WIDTH_M * sign;
          const terrainY = sampleHeightfieldBilinear(heightfield, sx, sz);
          const ratio = Math.abs(terrainY) / TARGET_SHOULDER_WIDTH_M;
          ratios.push(ratio);
          if (ratio > worstRatio) {
            worstRatio = ratio;
            worstLabel = `edge id=${edge.id} point[${i}] side=${sign}`;
          }
        }
      }
    }
    const maxRatio = Math.max(...ratios);
    const p95Ratio = percentile(ratios, 0.95);
    const medianRatio = percentile(ratios, 0.5);
    const toDeg = (r: number) => (Math.atan(r) * 180) / Math.PI;
    const message = `median=${toDeg(medianRatio).toFixed(2)}deg p95=${toDeg(p95Ratio).toFixed(2)}deg max=${toDeg(maxRatio).toFixed(2)}deg (worst at ${worstLabel})`;
    expect(maxRatio, message).toBeLessThan(Math.tan((15 * Math.PI) / 180));
    expect(p95Ratio, message).toBeLessThan(Math.tan((8 * Math.PI) / 180));
  });

  it("has exactly 3 authored crests for juliette-ga, each clearing every road's paved edge by at least 5m beyond its own radius (D-04b, guarding D-01's flat roads from D-04b's crests)", () => {
    const crests = crestsForArea("juliette-ga");
    expect(crests).toHaveLength(3);
    for (const crest of crests) {
      let minPavedEdgeDistance = Number.POSITIVE_INFINITY;
      for (const edge of graph.edges) {
        const centreDistance = distPointToPolylineXZ(crest.centerX, crest.centerZ, edge.points);
        const pavedEdgeDistance = centreDistance - edge.widthM / 2;
        if (pavedEdgeDistance < minPavedEdgeDistance) {
          minPavedEdgeDistance = pavedEdgeDistance;
        }
      }
      expect(
        minPavedEdgeDistance - crest.radiusM,
        `crest id=${crest.id} minPavedEdgeDistance=${minPavedEdgeDistance} radiusM=${crest.radiusM}`,
      ).toBeGreaterThanOrEqual(5);
    }
  });
});
