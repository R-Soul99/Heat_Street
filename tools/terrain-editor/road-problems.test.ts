import { describe, expect, it } from "vitest";
import { buildRoadGeometry } from "../../src/core/road-geometry.ts";
import type { RoadGraph, RoadGraphEdge } from "../../src/core/road-graph.ts";
import { validateGraph } from "../map-compiler/validate/validator.ts";
import { createEmptyTerrainArea } from "./new-area.ts";
import {
  buildRoadProblems,
  edgeMidpoint,
  removeDuplicatePoints,
  smoothEdgeHeights,
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
    const row = rows.find((r) => r.fixKind === "remove-duplicate-points");
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
    expect(row?.fixKind).toBe("smooth-heights");
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
    expect(stale.filter((r) => r.fixKind === "regrade")).toHaveLength(1);
    const fresh = buildRoadProblems(g, f, [], [0]);
    const steep = fresh.find((r) => r.text.includes("steeper"));
    expect(steep?.fixKind).toBeUndefined();
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
    expect(rows[0].fixKind).toBe("regrade");
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
    expect(rows[0].blocking).toBe(true);
    expect(rows[0].fixKind).toBeUndefined();
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
