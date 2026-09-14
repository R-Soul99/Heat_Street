/**
 * Hand-authored small graphs proving every `<behavior>` bullet of plan
 * 04-06 Task 1: referential integrity, undirected reachability, directed
 * (oneway-honouring) pathability, and the four geometry-sanity checks — each
 * asserted by constructing the SPECIFIC defect the check exists to catch and
 * confirming the failure names the offending id, per
 * `tests/road-graph-schema.test.ts`'s "iterate every edge, check the
 * specific invariant, report the specific id" discipline (04-PATTERNS.md).
 */
import createGraph from "ngraph.graph";
import { aStar } from "ngraph.path";
import { describe, expect, it } from "vitest";
import type { RoadGeometry } from "../../../src/core/road-geometry.ts";
import { buildRoadGeometry } from "../../../src/core/road-geometry.ts";
import type { RoadGraph, RoadGraphEdge, RoadGraphNode } from "../../../src/core/road-graph.ts";
import { formatValidationFailures, validateGraph } from "./validator.ts";

type Vec3 = readonly [number, number, number];

const EMPTY_GEOMETRY: RoadGeometry = { edges: [], junctions: [] };

function dist3D(a: Vec3, b: Vec3): number {
  return Math.sqrt((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2);
}

function polylineLength3D(points: readonly Vec3[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) total += dist3D(points[i - 1], points[i]);
  return total;
}

function makeNode(id: number, x: number, z: number, y = 0, junction = false): RoadGraphNode {
  return { id, x, y, z, junction, osmNodeId: id };
}

function makeEdge(
  id: number,
  from: number,
  to: number,
  points: readonly Vec3[],
  overrides: Partial<RoadGraphEdge> = {},
): RoadGraphEdge {
  return {
    id,
    from,
    to,
    points,
    lengthM: overrides.lengthM ?? polylineLength3D(points),
    surface: "tarmac",
    roadClass: "residential",
    lanes: 2,
    widthM: 6,
    oneway: false,
    speedLimitKph: 50,
    bridge: false,
    tunnel: false,
    layer: 0,
    osmWayId: id,
    ...overrides,
  };
}

function makeGraph(nodes: readonly RoadGraphNode[], edges: readonly RoadGraphEdge[]): RoadGraph {
  return {
    schemaVersion: 1,
    areaId: "test-area",
    name: "Test Area",
    source: {
      osmExtract: "overpass://test/test-area",
      osmSnapshot: "2026-01-01T00:00:00Z",
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

/** A clean, fully-connected 4-node square loop (mirrors `fixtures/road-graph.sample.json`'s own shape) — the baseline every negative test starts from and mutates. */
function makeSquareLoop(): RoadGraph {
  const nodes = [makeNode(0, 0, 0), makeNode(1, 10, 0), makeNode(2, 10, 10), makeNode(3, 0, 10)];
  const edges = [
    makeEdge(0, 0, 1, [
      [0, 0, 0],
      [10, 0, 0],
    ]),
    makeEdge(1, 1, 2, [
      [10, 0, 0],
      [10, 0, 10],
    ]),
    makeEdge(2, 2, 3, [
      [10, 0, 10],
      [0, 0, 10],
    ]),
    makeEdge(3, 3, 0, [
      [0, 0, 10],
      [0, 0, 0],
    ]),
  ];
  return makeGraph(nodes, edges);
}

describe("validateGraph — clean graph", () => {
  it("a fully connected two-way graph passes with zero failures", () => {
    const graph = makeSquareLoop();
    const geometry = buildRoadGeometry(graph);
    expect(validateGraph(graph, geometry)).toEqual([]);
  });
});

describe("validateGraph — undirected reachability", () => {
  it("fails on an isolated two-edge component, naming both orphan edge ids and at least one orphan node id", () => {
    const graph = makeSquareLoop();
    const isolatedNodes = [makeNode(10, 500, 500), makeNode(11, 510, 500), makeNode(12, 520, 500)];
    const isolatedEdges = [
      makeEdge(10, 10, 11, [
        [500, 0, 500],
        [510, 0, 500],
      ]),
      makeEdge(11, 11, 12, [
        [510, 0, 500],
        [520, 0, 500],
      ]),
    ];
    const merged = makeGraph(
      [...graph.nodes, ...isolatedNodes],
      [...graph.edges, ...isolatedEdges],
    );

    const failures = validateGraph(merged, EMPTY_GEOMETRY);
    const reachabilityFailures = failures.filter((f) => f.category === "UNDIRECTED_REACHABILITY");

    const orphanEdgeIds = reachabilityFailures
      .filter((f) => f.kind === "edge")
      .map((f) => f.id)
      .sort();
    expect(orphanEdgeIds).toEqual([10, 11]);

    const orphanNodeIds = reachabilityFailures.filter((f) => f.kind === "node").map((f) => f.id);
    expect(orphanNodeIds.length).toBeGreaterThanOrEqual(1);
    expect(orphanNodeIds).toContain(10);
  });
});

describe("validateGraph — directed pathability (oneway trap)", () => {
  it("passes the undirected check but fails the directed check, naming the trapped node, when a subgraph is entered only through a oneway edge", () => {
    // A-B-C is a two-way loop (root = A = node 0); D hangs off C, reachable
    // ONLY via a oneway edge C -> D. D can be driven INTO but never OUT OF.
    const nodes = [makeNode(0, 0, 0), makeNode(1, 10, 0), makeNode(2, 10, 10), makeNode(3, 20, 10)];
    const edges = [
      makeEdge(0, 0, 1, [
        [0, 0, 0],
        [10, 0, 0],
      ]),
      makeEdge(1, 1, 2, [
        [10, 0, 0],
        [10, 0, 10],
      ]),
      makeEdge(2, 2, 0, [
        [10, 0, 10],
        [0, 0, 0],
      ]),
      makeEdge(
        3,
        2,
        3,
        [
          [10, 0, 10],
          [20, 0, 10],
        ],
        { oneway: true },
      ),
    ];
    const graph = makeGraph(nodes, edges);

    const failures = validateGraph(graph, EMPTY_GEOMETRY);

    const undirectedFailures = failures.filter((f) => f.category === "UNDIRECTED_REACHABILITY");
    expect(undirectedFailures).toEqual([]);

    const directedFailures = failures.filter((f) => f.category === "DIRECTED_PATHABILITY");
    expect(directedFailures.length).toBeGreaterThan(0);
    expect(directedFailures.some((f) => f.kind === "node" && f.id === 3)).toBe(true);
  });
});

describe("validateGraph — referential integrity", () => {
  it("fails on a node no edge references, naming the node id", () => {
    const nodes = [makeNode(0, 0, 0), makeNode(1, 10, 0), makeNode(2, 20, 0)];
    const edges = [
      makeEdge(0, 0, 1, [
        [0, 0, 0],
        [10, 0, 0],
      ]),
    ];
    const graph = makeGraph(nodes, edges);

    const failures = validateGraph(graph, EMPTY_GEOMETRY);
    const referentialFailures = failures.filter((f) => f.category === "REFERENTIAL_INTEGRITY");
    expect(referentialFailures.some((f) => f.kind === "node" && f.id === 2)).toBe(true);
  });

  it("fails on an edge referencing a non-existent node id, naming the edge id and the missing node id", () => {
    const nodes = [makeNode(0, 0, 0), makeNode(1, 10, 0)];
    const edges = [
      makeEdge(5, 0, 99, [
        [0, 0, 0],
        [10, 0, 0],
      ]),
    ];
    const graph = makeGraph(nodes, edges);

    const failures = validateGraph(graph, EMPTY_GEOMETRY);
    const failure = failures.find((f) => f.category === "REFERENTIAL_INTEGRITY" && f.id === 5);
    expect(failure).toBeDefined();
    expect(failure?.message).toContain("99");
  });
});

describe("validateGraph — geometry sanity", () => {
  it("fails the degenerate-point check on two identical consecutive points, naming the edge id and point index", () => {
    const nodes = [makeNode(0, 0, 0), makeNode(1, 10, 0)];
    const points: Vec3[] = [
      [0, 0, 0],
      [0, 0, 0],
      [10, 0, 0],
    ];
    const edges = [makeEdge(0, 0, 1, points, { lengthM: 10 })];
    const graph = makeGraph(nodes, edges);

    const failures = validateGraph(graph, EMPTY_GEOMETRY);
    const failure = failures.find((f) => f.category === "GEOMETRY_DEGENERATE_POINT");
    expect(failure).toBeDefined();
    expect(failure?.id).toBe(0);
    expect(failure?.message).toContain("points[1]");
  });

  it("fails the length-consistency check when lengthM disagrees with the computed 3D length by more than 1%, naming the edge id and both values", () => {
    const nodes = [makeNode(0, 0, 0), makeNode(1, 100, 0)];
    const points: Vec3[] = [
      [0, 0, 0],
      [100, 0, 0],
    ];
    // Real length is 100; declaring 50 is a 50% disagreement, well over 1%.
    const edges = [makeEdge(0, 0, 1, points, { lengthM: 50 })];
    const graph = makeGraph(nodes, edges);

    const failures = validateGraph(graph, EMPTY_GEOMETRY);
    const failure = failures.find((f) => f.category === "GEOMETRY_LENGTH_MISMATCH");
    expect(failure).toBeDefined();
    expect(failure?.id).toBe(0);
    expect(failure?.message).toContain("50");
    expect(failure?.message).toContain("100");
  });

  it("fails the gradient check when the maximum gradient exceeds 0.5, naming the edge id and the gradient", () => {
    const nodes = [makeNode(0, 0, 0), makeNode(1, 1, 0, 1)];
    const points: Vec3[] = [
      [0, 0, 0],
      [1, 1, 0],
    ];
    const edges = [makeEdge(0, 0, 1, points)];
    const graph = makeGraph(nodes, edges);

    const failures = validateGraph(graph, EMPTY_GEOMETRY);
    const failure = failures.find((f) => f.category === "GEOMETRY_GRADIENT");
    expect(failure).toBeDefined();
    expect(failure?.id).toBe(0);
    expect(failure?.message).toContain("1");
  });

  it("fails the self-intersection check when a ribbon's triangle winding flips (folds back on itself), naming the edge id and segment index", () => {
    // Hand-built geometry (not run through buildRibbon): triangle 0 has
    // positive XZ signed area (the edge's established winding); triangle 1
    // deliberately has the opposite sign, simulating a folded-back quad at
    // segment floor(1/2) = 0.
    const positions = new Float32Array([
      0,
      0,
      0, // v0
      1,
      0,
      0, // v1
      0,
      0,
      1, // v2
      1,
      0,
      -1, // v3
    ]);
    const indices = new Uint32Array([0, 1, 2, 2, 1, 3]);
    const geometry: RoadGeometry = {
      edges: [{ edgeId: 7, surface: "tarmac", positions, indices }],
      junctions: [],
    };
    const graph = makeSquareLoop();

    const failures = validateGraph(graph, geometry);
    const failure = failures.find((f) => f.category === "GEOMETRY_SELF_INTERSECTION");
    expect(failure).toBeDefined();
    expect(failure?.id).toBe(7);
    expect(failure?.message).toContain("segment 0");
  });
});

describe("validateGraph — reports every failure, never stops at the first", () => {
  it("a graph with three independent defects returns three failures, not one", () => {
    const nodes = [makeNode(0, 0, 0), makeNode(1, 10, 0), makeNode(2, 10, 10), makeNode(3, 0, 10)];
    const edges = [
      // Defect 1: degenerate consecutive point. Computed length still 10 (the
      // duplicate contributes zero distance), so lengthM=10 stays consistent
      // — isolates this edge to exactly one failing check.
      makeEdge(
        0,
        0,
        1,
        [
          [0, 0, 0],
          [0, 0, 0],
          [10, 0, 0],
        ],
        { lengthM: 10 },
      ),
      // Defect 2: length mismatch. Real length is 10; declared 1.
      makeEdge(
        1,
        1,
        2,
        [
          [10, 0, 0],
          [10, 0, 10],
        ],
        { lengthM: 1 },
      ),
      // Defect 3: gradient. dx=-1, dy=1, dz=0 => gradient exactly 1.0 > 0.5.
      // lengthM set to the exact computed 3D length so this edge does not
      // also trip the length-consistency check.
      makeEdge(
        2,
        2,
        3,
        [
          [10, 0, 10],
          [9, 1, 10],
        ],
        { lengthM: Math.SQRT2 },
      ),
      // Clean closing edge — no defects.
      makeEdge(3, 3, 0, [
        [0, 0, 10],
        [0, 0, 0],
      ]),
    ];
    const graph = makeGraph(nodes, edges);

    const failures = validateGraph(graph, EMPTY_GEOMETRY);
    expect(failures).toHaveLength(3);
    const categories = failures.map((f) => f.category).sort();
    expect(categories).toEqual(
      ["GEOMETRY_DEGENERATE_POINT", "GEOMETRY_GRADIENT", "GEOMETRY_LENGTH_MISMATCH"].sort(),
    );
  });
});

describe("formatValidationFailures", () => {
  it("returns the empty string when there are no failures", () => {
    expect(formatValidationFailures([])).toBe("");
  });

  it("returns one line per failure in a `CATEGORY edge/node <id>: <message>` shape, and every line names its edge or node id", () => {
    const nodes = [makeNode(0, 0, 0), makeNode(1, 100, 0), makeNode(2, 999, 999)];
    const edges = [
      makeEdge(
        0,
        0,
        1,
        [
          [0, 0, 0],
          [100, 0, 0],
        ],
        { lengthM: 1 },
      ),
    ];
    const graph = makeGraph(nodes, edges);

    const failures = validateGraph(graph, EMPTY_GEOMETRY);
    expect(failures.length).toBeGreaterThan(1);

    const formatted = formatValidationFailures(failures);
    const lines = formatted.split("\n");
    expect(lines).toHaveLength(failures.length);
    for (const [i, line] of lines.entries()) {
      expect(line).toMatch(/^[A-Z_]+ (edge|node) \d+: .+$/);
      expect(line).toContain(`${failures[i].kind} ${failures[i].id}`);
    }
  });
});

describe("validateGraph — real ngraph.path consumability", () => {
  it("a valid graph produces zero DIRECTED_PATHABILITY failures, proving the real aStar.find call inside checkDirectedPathability succeeded", () => {
    const graph = makeSquareLoop();
    const failures = validateGraph(graph, EMPTY_GEOMETRY);
    expect(failures.filter((f) => f.category === "DIRECTED_PATHABILITY")).toEqual([]);
  });

  it("a real ngraph.path aStar.find returns a non-empty path on a graph built exactly the way validator.ts builds one — the emitted RoadGraph shape is consumable with zero adaptation", () => {
    const graph = createGraph<undefined, { weight: number }>();
    const square = makeSquareLoop();
    for (const node of square.nodes) graph.addNode(node.id);
    for (const edge of square.edges) {
      graph.addLink(edge.from, edge.to, { weight: edge.lengthM });
      if (!edge.oneway) graph.addLink(edge.to, edge.from, { weight: edge.lengthM });
    }

    const pathFinder = aStar(graph, { distance: (_from, _to, link) => link.data.weight });
    const path = pathFinder.find(0, 2);
    expect(path.length).toBeGreaterThan(0);
  });
});
