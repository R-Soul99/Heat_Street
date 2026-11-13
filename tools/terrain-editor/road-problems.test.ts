import { describe, expect, it } from "vitest";
import { buildRoadGeometry } from "../../src/core/road-geometry.ts";
import type { RoadGraph, RoadGraphEdge } from "../../src/core/road-graph.ts";
import { validateGraph } from "../map-compiler/validate/validator.ts";
import { createEmptyTerrainArea } from "./new-area.ts";
import {
  buildRoadProblems,
  describeNodeEnds,
  edgeMidpoint,
  makeTwoWay,
  mergeEndNodes,
  planCloseLoop,
  planConnectEnds,
  type RoadProblemRow,
  removeDuplicatePoints,
  roadPieces,
  smoothEdgeHeights,
  twoWayCandidates,
} from "./road-problems.ts";

type P = [number, number, number];

function graphWith(edges: { id: number; points: P[]; from?: number; to?: number }[]): RoadGraph {
  const base = createEmptyTerrainArea({
    areaId: "t",
    widthM: 600,
    depthM: 600,
    cellSizeM: 3,
  }).graph;
  const nodeIds = new Set<number>();
  const mk = (e: (typeof edges)[number]): RoadGraphEdge => {
    const from = e.from ?? e.id * 2;
    const to = e.to ?? e.id * 2 + 1;
    nodeIds.add(from);
    nodeIds.add(to);
    return {
      id: e.id,
      from,
      to,
      points: e.points,
      lengthM: e.points.reduce(
        (s, p, i) =>
          i === 0
            ? 0
            : s +
              Math.hypot(
                p[0] - e.points[i - 1][0],
                p[1] - e.points[i - 1][1],
                p[2] - e.points[i - 1][2],
              ),
        0,
      ),
      surface: "tarmac",
      roadClass: "residential",
      lanes: 2,
      widthM: 7,
      oneway: false,
      speedLimitKph: 50,
      bridge: false,
      tunnel: false,
      layer: 0,
      osmWayId: 0,
    };
  };
  const es = edges.map(mk);
  const nodes = [...nodeIds].map((id) => {
    const e = es.find((x) => x.from === id || x.to === id) as RoadGraphEdge;
    const p = e.from === id ? e.points[0] : e.points[e.points.length - 1];
    return { id, x: p[0], y: p[1], z: p[2], junction: false, osmNodeId: 0 };
  });
  return { ...base, nodes, edges: es };
}

const failuresOf = (g: RoadGraph) => validateGraph(g, buildRoadGeometry(g));
const fixKindsOf = (r: RoadProblemRow) => (r.fixes ?? []).map((f) => f.kind);
const joined = (rows: { text: string }[]) => rows.map((r) => r.text).join("\n");

describe("buildRoadProblems", () => {
  it("lists a duplicate point with a fix, located at the duplicate, in plain English", () => {
    const g = graphWith([
      {
        id: 0,
        points: [
          [0, 0, 0],
          [10, 0, 0],
          [10, 0, 0],
          [20, 0, 0],
        ],
      },
    ]);
    const rows = buildRoadProblems(g, failuresOf(g));
    const row = rows.find((r) => fixKindsOf(r)[0] === "remove-duplicate-points");
    expect(row).toBeDefined();
    expect(row?.blocking).toBe(true);
    expect(row?.at).toEqual({ x: 10, z: 0 });
    expect(row?.text).toBe("Road 0 has two points sitting on top of each other.");
    expect(row?.tip).toContain("GEOMETRY_DEGENERATE_POINT");
  });

  it("never puts category codes in row text", () => {
    const g = graphWith([
      {
        id: 0,
        points: [
          [0, 0, 0],
          [10, 0, 0],
          [10, 0, 0],
          [20, 0, 0],
        ],
      },
      {
        id: 1,
        points: [
          [100, 0, 0],
          [110, 20, 0],
        ],
      },
      {
        id: 2,
        points: [
          [300, 0, 0],
          [310, 0, 0],
        ],
      },
    ]);
    const rows = buildRoadProblems(g, failuresOf(g));
    expect(rows.length).toBeGreaterThan(2);
    expect(joined(rows)).not.toMatch(/[A-Z]+_[A-Z_]+/);
  });

  it("puts blocking rows first and marks non-blocking ones", () => {
    const g = graphWith([
      {
        id: 0,
        points: [
          [0, 0, 0],
          [10, 0, 0],
        ],
      },
      {
        id: 1,
        points: [
          [100, 0, 0],
          [110, 30, 0],
        ],
      },
    ]);
    const rows = buildRoadProblems(g, failuresOf(g));
    const firstNonBlocking = rows.findIndex((r) => !r.blocking);
    expect(firstNonBlocking).toBeGreaterThan(0);
    expect(rows.slice(firstNonBlocking).every((r) => !r.blocking)).toBe(true);
    const reach = rows.find((r) => r.text.includes("cut off"));
    expect(reach?.blocking).toBe(false);
    expect(reach?.hint).toBeDefined();
  });

  it("flags a steep locked road with a smoothing fix located at the steepest segment", () => {
    const g = graphWith([
      {
        id: 0,
        points: [
          [0, 0, 0],
          [50, 0, 0],
          [60, 8, 0],
          [200, 8, 0],
        ],
      },
    ]);
    const rows = buildRoadProblems(g, failuresOf(g));
    const row = rows.find((r) => r.text.includes("steeper"));
    expect(row && fixKindsOf(row)[0]).toBe("smooth-heights");
    expect(row?.at).toEqual({ x: 55, z: 0 });
  });

  it("offers re-grade for a steep stale unlocked road, and no fix for a steep matching one", () => {
    const g = graphWith([
      {
        id: 0,
        points: [
          [0, 0, 0],
          [10, 8, 0],
        ],
      },
    ]);
    const f = failuresOf(g);
    const stale = buildRoadProblems(g, f, [{ edgeId: 0, maxDeltaM: 2 }], [0]);
    expect(stale.filter((r) => fixKindsOf(r)[0] === "regrade")).toHaveLength(1);
    const fresh = buildRoadProblems(g, f, [], [0]);
    const steep = fresh.find((r) => r.text.includes("steeper"));
    expect(steep?.fixes).toBeUndefined();
    expect(steep?.hint).toBeTruthy();
  });

  it("adds a blocking stale row for an unlocked road with no other problem", () => {
    const g = graphWith([
      {
        id: 0,
        points: [
          [0, 0, 0],
          [30, 1, 0],
        ],
      },
    ]);
    const rows = buildRoadProblems(g, [], [{ edgeId: 0, maxDeltaM: 1.234 }], [0]);
    expect(rows).toHaveLength(1);
    expect(rows[0].blocking).toBe(true);
    expect(fixKindsOf(rows[0])[0]).toBe("regrade");
    expect(rows[0].text).toBe("Road 0 no longer matches the ground (off by up to 1.2 m).");
    expect(rows[0].at).toEqual({ x: 15, z: 0 });
  });

  it("locates a self-intersection at the named segment", () => {
    const g = graphWith([
      {
        id: 0,
        points: [
          [0, 0, 0],
          [10, 0, 0],
          [20, 0, 0],
          [30, 0, 0],
        ],
      },
    ]);
    const rows = buildRoadProblems(g, [
      {
        category: "GEOMETRY_SELF_INTERSECTION",
        kind: "edge",
        id: 0,
        message: "segment 1's ribbon triangle winding flips",
      },
    ]);
    expect(rows[0].at).toEqual({ x: 15, z: 0 });
    expect(rows[0].blocking).toBe(false);
  });

  it("locates a node problem at the node", () => {
    const g = graphWith([
      {
        id: 0,
        points: [
          [5, 0, 7],
          [10, 0, 7],
        ],
      },
    ]);
    const rows = buildRoadProblems(g, [
      { category: "DIRECTED_PATHABILITY", kind: "node", id: 1, message: "cannot be reached" },
    ]);
    expect(rows[0].at).toEqual({ x: 10, z: 7 });
    expect(rows[0].blocking).toBe(false);
    expect(rows[0].fixes).toBeUndefined();
  });
});

describe("edgeMidpoint", () => {
  it("is half way along by length, not the middle vertex", () => {
    const g = graphWith([
      {
        id: 0,
        points: [
          [0, 0, 0],
          [2, 0, 0],
          [100, 0, 0],
        ],
      },
    ]);
    expect(edgeMidpoint(g.edges[0])).toEqual({ x: 50, z: 0 });
  });
});

describe("removeDuplicatePoints", () => {
  it("removes the duplicate, fixes length, keeps ends, and clears the failure", () => {
    const g = graphWith([
      {
        id: 0,
        points: [
          [0, 0, 0],
          [10, 0, 0],
          [10, 0, 0],
          [20, 0, 0],
        ],
      },
    ]);
    const next = removeDuplicatePoints(g, 0);
    expect(next?.edges[0].points).toEqual([
      [0, 0, 0],
      [10, 0, 0],
      [20, 0, 0],
    ]);
    expect(next?.edges[0].lengthM).toBeCloseTo(20);
    expect(
      failuresOf(next as RoadGraph).some((f) => f.category === "GEOMETRY_DEGENERATE_POINT"),
    ).toBe(false);
  });

  it("drops the inner point when the duplicate is the last point", () => {
    const g = graphWith([
      {
        id: 0,
        points: [
          [0, 0, 0],
          [10, 0, 0],
          [20, 0, 0],
          [20, 0, 0],
        ],
      },
    ]);
    const next = removeDuplicatePoints(g, 0);
    expect(next?.edges[0].points).toEqual([
      [0, 0, 0],
      [10, 0, 0],
      [20, 0, 0],
    ]);
  });

  it("returns null when there is nothing to remove or the road would collapse", () => {
    expect(
      removeDuplicatePoints(
        graphWith([
          {
            id: 0,
            points: [
              [0, 0, 0],
              [5, 0, 0],
            ],
          },
        ]),
        0,
      ),
    ).toBeNull();
    expect(
      removeDuplicatePoints(
        graphWith([
          {
            id: 0,
            points: [
              [0, 0, 0],
              [0, 0, 0],
            ],
          },
        ]),
        0,
      ),
    ).toBeNull();
    expect(removeDuplicatePoints(graphWith([]), 9)).toBeNull();
  });
});

describe("smoothEdgeHeights", () => {
  it("brings a too-steep road under the ceiling, keeping end heights", () => {
    const g = graphWith([
      {
        id: 0,
        points: [
          [0, 0, 0],
          [50, 0, 0],
          [60, 8, 0],
          [200, 8, 0],
        ],
      },
    ]);
    expect(failuresOf(g).some((f) => f.category === "GEOMETRY_GRADIENT")).toBe(true);
    const next = smoothEdgeHeights(g, 0) as RoadGraph;
    expect(next).not.toBeNull();
    const pts = next.edges[0].points;
    expect(pts[0][1]).toBe(0);
    expect(pts[3][1]).toBe(8);
    expect(failuresOf(next).some((f) => f.category === "GEOMETRY_GRADIENT")).toBe(false);
  });

  it("returns null when the end heights cannot be reconciled or nothing needs changing", () => {
    expect(
      smoothEdgeHeights(
        graphWith([
          {
            id: 0,
            points: [
              [0, 0, 0],
              [10, 8, 0],
            ],
          },
        ]),
        0,
      ),
    ).toBeNull();
    expect(
      smoothEdgeHeights(
        graphWith([
          {
            id: 0,
            points: [
              [0, 0, 0],
              [100, 1, 0],
            ],
          },
        ]),
        0,
      ),
    ).toBeNull();
  });
});

// ------------------------------------------------- 07.1-18 pieces, names, fixes

const seg = (...pts: P[]): P[] => pts;

/** Root piece (edge 0, nodes 0-1) plus a cut-off piece (edges 4 and 6) 100 m away. */
function cutOffGraph(): RoadGraph {
  return graphWith([
    { id: 0, points: seg([0, 0, 0], [50, 0, 0]) },
    { id: 4, from: 10, to: 11, points: seg([150, 0, 0], [200, 0, 0]) },
    { id: 6, from: 11, to: 12, points: seg([200, 0, 0], [250, 0, 0]) },
  ]);
}

/** Edge 0 two-way (0-1), edge 1 oneway into dead end node 2. */
function trapGraph(): RoadGraph {
  const g = graphWith([
    { id: 0, from: 0, to: 1, points: seg([0, 0, 0], [50, 0, 0]) },
    { id: 1, from: 1, to: 2, points: seg([50, 0, 0], [100, 0, 0]) },
  ]);
  return { ...g, edges: g.edges.map((e) => (e.id === 1 ? { ...e, oneway: true } : e)) };
}

/** Open loop: node 0 at (0,0), node 2 at (0,1); ends 1 m apart. */
function openLoop(): RoadGraph {
  return graphWith([
    { id: 0, from: 0, to: 1, points: seg([0, 0, 0], [100, 0, 0]) },
    { id: 1, from: 1, to: 2, points: seg([100, 0, 0], [100, 0, 1], [0, 0, 1]) },
  ]);
}

describe("roadPieces", () => {
  it("separates the root piece from cut-off pieces and lists open ends", () => {
    const pieces = roadPieces(cutOffGraph());
    expect([...pieces.root].sort((a, b) => a - b)).toEqual([0, 1]);
    expect(pieces.cutOff).toHaveLength(1);
    const piece = pieces.cutOff[0];
    expect([...piece.edgeIds].sort((a, b) => a - b)).toEqual([4, 6]);
    expect(piece.openEnds).toEqual([
      { nodeId: 10, edgeId: 4, end: "start" },
      { nodeId: 12, edgeId: 6, end: "end" },
    ]);
  });

  it("a self-loop counts two, so a lone loop has no open ends", () => {
    const g = graphWith([
      { id: 0, from: 0, to: 1, points: seg([0, 0, 0], [50, 0, 0]) },
      { id: 1, from: 5, to: 5, points: seg([200, 0, 0], [250, 0, 0], [200, 0, 0]) },
    ]);
    const piece = roadPieces(g).cutOff[0];
    expect(piece.nodeIds).toEqual([5]);
    expect(piece.openEnds).toEqual([]);
  });
});

describe("describeNodeEnds", () => {
  it("names a single road end or start, and a junction", () => {
    const g = cutOffGraph();
    expect(describeNodeEnds(g, 10)).toBe("the start of Road 4");
    expect(describeNodeEnds(g, 12)).toBe("the end of Road 6");
    expect(describeNodeEnds(g, 11)).toBe("the junction of Roads 4 and 6");
  });

  it("lists three roads with a plain and", () => {
    const g = graphWith([
      { id: 3, from: 0, to: 1, points: seg([0, 0, 0], [10, 0, 0]) },
      { id: 4, from: 0, to: 2, points: seg([0, 0, 0], [0, 0, 10]) },
      { id: 7, from: 0, to: 3, points: seg([0, 0, 0], [-10, 0, 0]) },
    ]);
    expect(describeNodeEnds(g, 0)).toBe("the junction of Roads 3, 4 and 7");
  });
});

describe("cut-off rows", () => {
  it("is ONE row per piece, naming roads and ends, with no one-way rows", () => {
    const g = cutOffGraph();
    const rows = buildRoadProblems(g, failuresOf(g));
    expect(failuresOf(g).some((f) => f.category === "DIRECTED_PATHABILITY")).toBe(true);
    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(row.blocking).toBe(false);
    expect(row.text).toContain("Road 4");
    expect(row.text).toContain("Road 6");
    expect(row.text).toContain("the start of Road 4");
    expect(row.text).toContain("the end of Road 6");
    expect(row.text).toContain("saving still works");
    expect(joined(rows)).not.toMatch(/one-way/i);
    expect(row.tip).toContain("UNDIRECTED_REACHABILITY");
    expect(row.fixes?.map((f) => f.kind)).toContain("connect-ends");
  });

  it("gives a hint when neither connect nor close-loop is possible", () => {
    const g = graphWith([
      { id: 0, points: seg([0, 0, 0], [50, 0, 0]) },
      { id: 1, points: seg([5000, 0, 0], [5400, 0, 0]) },
    ]);
    const row = buildRoadProblems(g, failuresOf(g))[0];
    expect(row.fixes ?? []).toEqual([]);
    expect(row.hint).toBeTruthy();
  });

  it("offers close-loop for a piece with two close open ends", () => {
    const g = graphWith([
      { id: 0, points: seg([0, 0, 0], [10, 0, 0]) },
      { id: 4, from: 10, to: 11, points: seg([300, 0, 0], [400, 0, 0]) },
      { id: 5, from: 11, to: 12, points: seg([400, 0, 0], [400, 0, 100], [300, 0, 100]) },
    ]);
    const row = buildRoadProblems(g, failuresOf(g)).find((r) => r.text.includes("cut off"));
    expect(row?.fixes?.map((f) => f.kind)).toContain("close-loop");
  });

  it("every row lists its repairs in fixes (old and new kinds), no legacy single-fix field", () => {
    const g = cutOffGraph();
    const trap = trapGraph();
    const dup = graphWith([{ id: 0, points: seg([0, 0, 0], [10, 0, 0], [10, 0, 0], [20, 0, 0]) }]);
    const all = [
      ...buildRoadProblems(g, failuresOf(g)),
      ...buildRoadProblems(trap, failuresOf(trap)),
      ...buildRoadProblems(dup, failuresOf(dup)),
    ];
    for (const r of all) {
      expect(Object.keys(r)).not.toContain("fixKind");
      expect(Object.keys(r)).not.toContain("fixLabel");
    }
    const kinds = all.flatMap((r) => (r.fixes ?? []).map((f) => f.kind));
    expect(kinds).toContain("make-two-way");
    expect(kinds).toContain("connect-ends");
    const dupRow = all.find((r) => fixKindsOf(r)[0] === "remove-duplicate-points");
    expect(dupRow?.fixes?.[0]?.kind).toBe("remove-duplicate-points");
    expect(dupRow?.fixes?.[0]?.edgeId).toBe(0);
  });
});

describe("one-way trap rows", () => {
  it("names the road end and offers make-two-way, never Junction N", () => {
    const g = trapGraph();
    const rows = buildRoadProblems(g, failuresOf(g));
    expect(rows).toHaveLength(1);
    expect(rows[0].blocking).toBe(false);
    expect(rows[0].text).toMatch(/the end of Road 1/i);
    expect(rows[0].text).not.toMatch(/Junction \d/);
    expect(rows[0].target).toEqual({ kind: "node", id: 2 });
    expect(rows[0].at).toEqual({ x: 100, z: 0 });
    expect(rows[0].fixes).toEqual([
      expect.objectContaining({ kind: "make-two-way", nodeId: 2, edgeId: 1 }),
    ]);
  });
});

describe("twoWayCandidates and makeTwoWay", () => {
  it("lists incident oneway edges, falling back to the piece", () => {
    const g = trapGraph();
    expect(twoWayCandidates(g, 2)).toEqual([1]);
    expect(twoWayCandidates(g, 0)).toEqual([1]);
    expect(twoWayCandidates(cutOffGraph(), 0)).toEqual([]);
  });

  it("clears the trap without mutating the input", () => {
    const g = trapGraph();
    const next = makeTwoWay(g, twoWayCandidates(g, 2)) as RoadGraph;
    expect(next).not.toBeNull();
    expect(g.edges[1].oneway).toBe(true);
    expect(next.edges[1].oneway).toBe(false);
    expect(failuresOf(next).some((f) => f.category === "DIRECTED_PATHABILITY")).toBe(false);
    expect(makeTwoWay(next, [1])).toBeNull();
    expect(makeTwoWay(g, [])).toBeNull();
  });
});

describe("planConnectEnds", () => {
  it("pairs an open end with the nearest root node and the plan fixes reachability", () => {
    const g = cutOffGraph();
    const plan = planConnectEnds(g, 4);
    expect(plan).not.toBeNull();
    expect(plan?.from).toEqual({ x: 150, z: 0, nodeId: 10 });
    expect(plan?.to.nodeId).toBe(1);
    expect(plan?.distanceM).toBeCloseTo(100);
    const bridge: RoadGraphEdge = {
      ...g.edges[0],
      id: 99,
      from: plan?.from.nodeId as number,
      to: plan?.to.nodeId as number,
      points: [
        [50, 0, 0],
        [150, 0, 0],
      ],
      lengthM: 100,
    };
    const next = { ...g, edges: [...g.edges, bridge] };
    expect(failuresOf(next).some((f) => f.category === "UNDIRECTED_REACHABILITY")).toBe(false);
  });

  it("can target a point on a root edge, and is null for root edges or too far", () => {
    const g = graphWith([
      { id: 0, points: seg([0, 0, 0], [400, 0, 0]) },
      { id: 4, points: seg([200, 0, 60], [200, 0, 120]) },
    ]);
    const plan = planConnectEnds(g, 4);
    expect(plan?.to.edgeId).toBe(0);
    expect(plan?.to.x).toBeCloseTo(200);
    expect(plan?.distanceM).toBeCloseTo(60);
    expect(planConnectEnds(g, 0)).toBeNull();
    const far = graphWith([
      { id: 0, points: seg([0, 0, 0], [10, 0, 0]) },
      { id: 1, points: seg([5000, 0, 0], [5010, 0, 0]) },
    ]);
    expect(planConnectEnds(far, 1)).toBeNull();
  });
});

describe("planCloseLoop and mergeEndNodes", () => {
  it("plans the gap between the two open ends", () => {
    const plan = planCloseLoop(openLoop(), 0);
    expect(plan).not.toBeNull();
    expect(plan?.gapM).toBeCloseTo(1);
    expect([plan?.a, plan?.b].sort()).toEqual([0, 2]);
  });

  it("is null with more than two open ends or a wide gap", () => {
    const wide = graphWith([{ id: 0, from: 0, to: 1, points: seg([0, 0, 0], [500, 0, 0]) }]);
    expect(planCloseLoop(wide, 0)).toBeNull();
    const fork = graphWith([
      { id: 0, from: 0, to: 1, points: seg([0, 0, 0], [10, 0, 0]) },
      { id: 1, from: 1, to: 2, points: seg([10, 0, 0], [20, 0, 0]) },
      { id: 2, from: 1, to: 3, points: seg([10, 0, 0], [10, 0, 10]) },
    ]);
    expect(planCloseLoop(fork, 0)).toBeNull();
  });

  it("merging the ends of a 1 m gap leaves no reachability or degenerate failures", () => {
    const g = openLoop();
    const next = mergeEndNodes(g, 0, 2) as RoadGraph;
    expect(next).not.toBeNull();
    expect(next.nodes.some((n) => n.id === 2)).toBe(false);
    expect(next.edges[1].to).toBe(0);
    expect(next.edges[1].points[next.edges[1].points.length - 1]).toEqual([0, 0, 0]);
    const cats = failuresOf(next).map((f) => f.category);
    expect(cats).not.toContain("UNDIRECTED_REACHABILITY");
    expect(cats).not.toContain("GEOMETRY_DEGENERATE_POINT");
    expect(g.nodes.some((n) => n.id === 2)).toBe(true);
  });

  it("returns null for missing ids, the same id, or a zero-length result", () => {
    const g = openLoop();
    expect(mergeEndNodes(g, 0, 99)).toBeNull();
    expect(mergeEndNodes(g, 0, 0)).toBeNull();
    const tiny = graphWith([{ id: 0, from: 0, to: 1, points: seg([0, 0, 0], [0, 0, 0.5]) }]);
    expect(mergeEndNodes(tiny, 0, 1)).toBeNull();
  });
});
