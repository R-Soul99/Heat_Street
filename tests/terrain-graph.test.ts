/**
 * Plan 04.2-08: pure road-graph edit operations. Every case round-trips the
 * result through `JSON.stringify` -> `parseRoadGraph` and then runs the real
 * map-compiler `validateGraph` against `buildRoadGeometry`, so the edits are
 * proven to emit road-graph v1 that the existing consumers accept (SC-4).
 */
import { describe, expect, it } from "vitest";
import { buildRoadGeometry } from "../src/core/road-geometry.ts";
import { parseRoadGraph, type RoadGraph } from "../src/core/road-graph.ts";
import {
  addRoadStroke,
  compactNodes,
  ensureDefaultSpawn,
  eraseGraphDisc,
  findStrokeCrossings,
  type GraphEditState,
  type RoadProfile,
} from "../src/core/terrain-graph.ts";
import { validateGraph } from "../tools/map-compiler/validate/validator.ts";

type P3 = readonly [number, number, number];

const PROFILE: RoadProfile = {
  roadClass: "residential",
  lanes: 2,
  widthM: 8,
  surface: "tarmac",
  speedLimitKph: 50,
  oneway: false,
};

function emptyState(): GraphEditState {
  const graph: RoadGraph = {
    schemaVersion: 1,
    areaId: "test",
    name: "Test",
    source: { osmExtract: "n/a", osmSnapshot: "n/a", demSource: "n/a", compilerVersion: "test" },
    attribution: { osm: "n/a", osmLicense: "n/a", osmLicenseUrl: "n/a", dem: "n/a" },
    origin: { lat: 0, lon: 0, projection: "local" },
    bounds: { minX: -500, minZ: -500, maxX: 500, maxZ: 500 },
    nodes: [],
    edges: [],
  };
  return { graph, nextEdgeId: 0 };
}

/** Round-trips through the real parser and validator; returns the parsed graph. */
function check(graph: RoadGraph, allowDisconnected = false): RoadGraph {
  const parsed = parseRoadGraph(JSON.stringify(graph), "terrain-graph.test");
  const failures = validateGraph(parsed, buildRoadGeometry(parsed)).filter(
    (f) =>
      !(
        allowDisconnected &&
        (f.category === "UNDIRECTED_REACHABILITY" || f.category === "DIRECTED_PATHABILITY")
      ),
  );
  expect(failures).toEqual([]);
  return parsed;
}

function add(
  state: GraphEditState,
  pts: readonly P3[],
  opts?: Parameters<typeof addRoadStroke>[3],
) {
  return addRoadStroke(state, pts, PROFILE, opts);
}

function degree(graph: RoadGraph, nodeId: number): number {
  let d = 0;
  for (const e of graph.edges) {
    if (e.from === nodeId) d++;
    if (e.to === nodeId) d++;
  }
  return d;
}

const ROAD_X: readonly P3[] = [
  [-50, 0, 0],
  [50, 0, 0],
];

describe("addRoadStroke", () => {
  it("creates two dead-end nodes and one edge from a 3-point polyline", () => {
    const r = add(emptyState(), [
      [0, 0, 0],
      [30, 0, 0],
      [30, 0, 40],
    ]);
    const g = check(r.state.graph);
    expect(g.nodes).toHaveLength(2);
    expect(g.nodes.every((n) => !n.junction && n.osmNodeId === 0)).toBe(true);
    expect(g.edges).toHaveLength(1);
    const e = g.edges[0];
    expect(e.id).toBe(0);
    expect(e.lengthM).toBeCloseTo(70, 9);
    expect(e.points).toHaveLength(3);
    expect(e.roadClass).toBe("residential");
    expect(e.lanes).toBe(2);
    expect(e.widthM).toBe(8);
    expect(e.surface).toBe("tarmac");
    expect(e.speedLimitKph).toBe(50);
    expect(e.oneway).toBe(false);
    expect(e.bridge).toBe(false);
    expect(e.tunnel).toBe(false);
    expect(e.layer).toBe(0);
    expect(e.osmWayId).toBe(0);
    expect(r.state.nextEdgeId).toBe(1);
    expect(r.newEdgeIds).toEqual([0]);
    expect(r.junctionNodeIds).toEqual([]);
  });

  it("splits both roads at an X crossing into a degree-4 junction with mean y", () => {
    const s1 = add(emptyState(), ROAD_X).state;
    const r = add(s1, [
      [0, 4, -50],
      [0, 4, 50],
    ]);
    const g = check(r.state.graph);
    expect(g.edges).toHaveLength(4);
    expect(g.nodes).toHaveLength(5);
    expect(r.junctionNodeIds).toHaveLength(1);
    const j = g.nodes[r.junctionNodeIds[0]];
    expect(j.junction).toBe(true);
    expect(degree(g, j.id)).toBe(4);
    expect(j.x).toBeCloseTo(0, 9);
    expect(j.z).toBeCloseTo(0, 9);
    expect(j.y).toBeCloseTo(2, 9);
    // First half of the split edge keeps the original id and ends at the junction.
    const e0 = g.edges.find((e) => e.id === 0);
    expect(e0?.to).toBe(j.id);
    expect(e0?.points[0]).toEqual([-50, 0, 0]);
    expect(r.state.nextEdgeId).toBe(4);
    // Reachable: whole thing is one connected component (check() already enforced).
  });

  it("snaps a stroke end onto an existing edge interior as a T junction", () => {
    const s1 = add(emptyState(), ROAD_X).state;
    const r = add(s1, [
      [0, 0, -60],
      [0, 0, 2],
    ]);
    const g = check(r.state.graph);
    expect(r.junctionNodeIds).toHaveLength(1);
    const j = g.nodes[r.junctionNodeIds[0]];
    expect(degree(g, j.id)).toBe(3);
    expect(j.junction).toBe(true);
    expect(j.x).toBeCloseTo(0, 9);
    expect(j.z).toBeCloseTo(0, 9);
    expect(g.edges).toHaveLength(3);
  });

  it("reuses an existing node when a stroke end lands within the snap distance", () => {
    const s1 = add(emptyState(), ROAD_X).state;
    const r = add(s1, [
      [-48, 0, 30],
      [-48, 0, 1],
    ]);
    const g = check(r.state.graph);
    // 2 original nodes + 1 free end; the near end reused node 0.
    expect(g.nodes).toHaveLength(3);
    expect(r.junctionNodeIds).toEqual([]);
    expect(degree(g, 0)).toBe(2);
    expect(g.edges).toHaveLength(2);
  });

  it("ends in open ground as a degree-1 dead end", () => {
    const s1 = add(emptyState(), ROAD_X).state;
    const r = add(s1, [
      [0, 0, 1],
      [0, 0, 60],
    ]);
    const g = check(r.state.graph);
    const last = g.nodes[g.nodes.length - 1];
    expect(degree(g, last.id)).toBe(1);
    expect(last.junction).toBe(false);
    expect(last.z).toBeCloseTo(60, 9);
  });

  it("findStrokeCrossings reports exactly the x/z addRoadStroke places (cross, snap-edge, snap-node)", () => {
    const s1 = add(emptyState(), ROAD_X).state;
    const cases: readonly (readonly P3[])[] = [
      [
        [10, 0, -40],
        [10, 0, 40],
      ],
      [
        [20, 0, -60],
        [20, 0, 2.5],
      ],
      [
        [-48, 0, 30],
        [-48, 0, 1],
      ],
    ];
    const kinds: string[] = [];
    for (const pts of cases) {
      const joins = findStrokeCrossings(s1, pts, PROFILE.widthM / 2);
      expect(joins).toHaveLength(1);
      kinds.push(joins[0].kind);
      const before = JSON.stringify(s1);
      const r = add(s1, pts);
      expect(JSON.stringify(s1)).toBe(before);
      const g = check(r.state.graph);
      // The join point must coincide with a node that has degree >= 2 and is not a free end.
      const node = g.nodes.find(
        (n) =>
          Math.abs(n.x - joins[0].x) < 1e-9 &&
          Math.abs(n.z - joins[0].z) < 1e-9 &&
          degree(g, n.id) >= 2,
      );
      expect(node).toBeDefined();
    }
    expect(kinds).toEqual(["cross", "snap-edge", "snap-node"]);
  });

  it("never modifies graph.bounds", () => {
    const s1 = add(emptyState(), ROAD_X).state;
    const r = add(s1, [
      [0, 0, -900],
      [0, 0, 900],
    ]);
    expect(r.state.graph.bounds).toEqual(emptyState().graph.bounds);
  });

  it("keeps existing edge ids and points across save/load and allocates only new ids", () => {
    const s1 = add(emptyState(), ROAD_X).state;
    const s2 = add(s1, [
      [200, 0, 200],
      [300, 0, 200],
    ]).state;
    const reloaded: GraphEditState = {
      graph: parseRoadGraph(JSON.stringify(s2.graph), "reload"),
      nextEdgeId: s2.nextEdgeId,
    };
    const r = add(reloaded, [
      [200, 0, 240],
      [300, 0, 240],
    ]);
    const g = check(r.state.graph, true);
    for (const old of reloaded.graph.edges) {
      const now = g.edges.find((e) => e.id === old.id);
      expect(now?.points).toEqual(old.points);
    }
    for (const id of r.newEdgeIds) expect(id).toBeGreaterThanOrEqual(reloaded.nextEdgeId);
  });

  it("rejects degenerate strokes without changing state", () => {
    const s = emptyState();
    const a = add(s, [[0, 0, 0]]);
    expect(a.state).toBe(s);
    expect(a.reason).toBeDefined();
    const b = add(s, [
      [0, 0, 0],
      [0, 0, 0],
    ]);
    expect(b.state).toBe(s);
    const c = add(s, [
      [0, 0, 0],
      [Number.NaN, 0, 5],
    ]);
    expect(c.state).toBe(s);
    expect(c.newEdgeIds).toEqual([]);
  });

  it("does not mutate the input state", () => {
    const s1 = add(emptyState(), ROAD_X).state;
    const snapshot = JSON.stringify(s1);
    add(s1, [
      [0, 0, -50],
      [0, 0, 50],
    ]);
    expect(JSON.stringify(s1)).toBe(snapshot);
  });
});

describe("ensureDefaultSpawn", () => {
  it("adds a default spawn at node 0 and leaves an existing one alone", () => {
    const s1 = add(emptyState(), ROAD_X).state;
    const s2 = ensureDefaultSpawn(s1);
    const g = check(s2.graph);
    expect(g.spawns).toHaveLength(1);
    expect(g.spawns?.[0].id).toBe("default");
    expect(g.spawns?.[0].nodeId).toBe(0);
    expect(Number.isFinite(g.spawns?.[0].headingRad)).toBe(true);
    const s3 = ensureDefaultSpawn(s2);
    expect(s3.graph.spawns).toEqual(s2.graph.spawns);
  });
});

describe("eraseGraphDisc", () => {
  it("splits a straight edge: start part keeps the id, end part gets a new one", () => {
    const s1 = add(emptyState(), ROAD_X).state;
    const r = eraseGraphDisc(s1, 0, 0, 10);
    const g = check(r.state.graph, true);
    expect(g.edges).toHaveLength(2);
    const a = g.edges.find((e) => e.id === 0);
    const b = g.edges.find((e) => e.id !== 0);
    expect(a?.points[0]).toEqual([-50, 0, 0]);
    expect(a?.points[a.points.length - 1][0]).toBeCloseTo(-10, 6);
    expect(b?.points[0][0]).toBeCloseTo(10, 6);
    expect(b?.id).toBeGreaterThanOrEqual(s1.nextEdgeId);
    expect(r.state.nextEdgeId).toBeGreaterThanOrEqual(s1.nextEdgeId);
    expect(g.nodes).toHaveLength(4);
    expect(g.nodes.every((n) => degree(g, n.id) === 1)).toBe(true);
    expect(r.removedEdgeIds).toEqual([]);
  });

  it("deletes a fully covered edge, drops orphans and compacts ids with spawns remapped", () => {
    let s = add(emptyState(), ROAD_X).state;
    s = add(s, [
      [200, 0, 200],
      [300, 0, 200],
    ]).state;
    s = ensureDefaultSpawn(s); // node 0 is on the first road
    const r = eraseGraphDisc(s, 0, 0, 80);
    expect(r.removedEdgeIds).toEqual([0]);
    const g = check(r.state.graph);
    expect(g.nodes.map((n) => n.id)).toEqual([0, 1]);
    expect(g.edges).toHaveLength(1);
    expect(g.edges[0].from).toBe(0);
    expect(g.edges[0].to).toBe(1);
    expect(g.spawns?.[0].id).toBe("default");
    expect(g.spawns?.[0].nodeId).toBe(0);
    expect(r.spawnLost).toBe(false);
  });

  it("reports spawnLost and empties spawns when no nodes remain", () => {
    const s = ensureDefaultSpawn(add(emptyState(), ROAD_X).state);
    const r = eraseGraphDisc(s, 0, 0, 80);
    expect(r.spawnLost).toBe(true);
    expect(r.state.graph.nodes).toEqual([]);
    expect(r.state.graph.spawns).toEqual([]);
    expect(r.state.nextEdgeId).toBe(s.nextEdgeId);
    parseRoadGraph(JSON.stringify(r.state.graph), "empty");
  });

  it("never reuses erased edge ids", () => {
    const s1 = add(emptyState(), ROAD_X).state;
    const r = eraseGraphDisc(s1, 0, 0, 80);
    const a = add(r.state, ROAD_X);
    expect(a.newEdgeIds[0]).toBeGreaterThanOrEqual(s1.nextEdgeId);
    check(a.state.graph);
  });

  it("leaves the graph untouched when the disc misses everything", () => {
    const s1 = add(emptyState(), ROAD_X).state;
    const r = eraseGraphDisc(s1, 0, 100, 5);
    expect(r.state).toBe(s1);
  });

  it("does not modify bounds", () => {
    const s1 = add(emptyState(), ROAD_X).state;
    expect(eraseGraphDisc(s1, 0, 0, 10).state.graph.bounds).toEqual(s1.graph.bounds);
  });
});

describe("addRoadStroke replace mode", () => {
  it("replaces an existing road repainted over it instead of drawing it twice", () => {
    const s1 = add(emptyState(), ROAD_X).state;
    const r = add(
      s1,
      [
        [-50, 0, 1],
        [50, 0, 1],
      ],
      { replace: true },
    );
    const g = check(r.state.graph);
    expect(g.edges).toHaveLength(1);
    expect(g.nodes).toHaveLength(2);
    expect(g.edges[0].id).toBeGreaterThanOrEqual(s1.nextEdgeId);
  });

  it("only splits a road that is merely crossed", () => {
    const s1 = add(emptyState(), ROAD_X).state;
    const r = add(
      s1,
      [
        [0, 0, -50],
        [0, 0, 50],
      ],
      { replace: true },
    );
    const g = check(r.state.graph);
    expect(g.edges).toHaveLength(4);
  });
});

describe("compactNodes", () => {
  it("is a no-op (same object) when ids are already dense", () => {
    const g = add(emptyState(), ROAD_X).state.graph;
    expect(compactNodes(g)).toBe(g);
  });
});
