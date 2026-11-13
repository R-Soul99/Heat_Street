/**
 * Phase 04.3 plan 04 (D-15..D-17): the shared save-guard rule, plus proof that
 * every tracked shipped terrain map passes it (so none becomes un-saveable).
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { RoadGraph } from "../src/core/road-graph.ts";
import { parseTerrainSidecar } from "../src/core/terrain-format.ts";
import { createTerrainGrid } from "../src/core/terrain-grid.ts";
import { createPaintMap } from "../src/core/terrain-paint.ts";
import { applyRoadStroke, type RoadEditTarget, regradeRoads } from "../src/core/terrain-road.ts";
import {
  formatValidationFailures,
  type ValidationFailure,
} from "../tools/map-compiler/validate/validator.ts";
import {
  assertGradedRoads,
  assertSaveableGraph,
  blockingRoadFailures,
  NON_BLOCKING_ON_TERRAIN,
  SAVE_GUARD_PREFIX,
  saveBlockMessage,
  staleRoadBlockMessage,
} from "../tools/terrain-editor/save-guard.ts";

const SHIPPED = ["demo-hills", "feel-test", "grid-test", "juliette-ga"] as const;

function shippedGraph(id: string): RoadGraph {
  const text = readFileSync(`public/maps/${id}.terrain.json`, "utf8");
  return parseTerrainSidecar(text, id, `${id}.terrain.json`).graph;
}

function failure(category: ValidationFailure["category"]): ValidationFailure {
  return { category, kind: "edge", id: 1, message: "x" };
}

describe("save-guard rule", () => {
  it("exempts exactly the connectivity checks and GEOMETRY_SELF_INTERSECTION (GD-ROAD)", () => {
    expect([...NON_BLOCKING_ON_TERRAIN].sort()).toEqual([
      "DIRECTED_PATHABILITY",
      "GEOMETRY_SELF_INTERSECTION",
      "UNDIRECTED_REACHABILITY",
    ]);
  });

  it("saveBlockMessage is null for no failures and formatted otherwise", () => {
    expect(saveBlockMessage([])).toBeNull();
    const blocking = [failure("GEOMETRY_GRADIENT")];
    const msg = saveBlockMessage(blocking);
    expect(msg?.startsWith("Road graph invalid: ")).toBe(true);
    expect(msg).toContain(formatValidationFailures(blocking));
    expect(
      msg?.endsWith("Fix this before saving: undo the last stroke or erase the road and repaint."),
    ).toBe(true);
  });

  it("a clean graph is saveable", () => {
    const g = shippedGraph("feel-test");
    expect(blockingRoadFailures(g)).toEqual([]);
    expect(() => assertSaveableGraph(g)).not.toThrow();
  });

  it("an edge to a missing node blocks (REFERENTIAL_INTEGRITY)", () => {
    const g = shippedGraph("feel-test");
    const [first, ...rest] = g.edges;
    if (!first) throw new Error("fixture has no edges");
    const broken: RoadGraph = { ...g, edges: [{ ...first, to: 99999 }, ...rest] };
    const blocking = blockingRoadFailures(broken);
    expect(blocking.some((f) => f.category === "REFERENTIAL_INTEGRITY")).toBe(true);
    expect(() => assertSaveableGraph(broken)).toThrow(new RegExp(`^${SAVE_GUARD_PREFIX} `));
  });

  it("a disconnected island is never reported as UNDIRECTED_REACHABILITY blocking", () => {
    const g = shippedGraph("grid-test");
    const [n0] = g.nodes;
    const [e0] = g.edges;
    if (!n0 || !e0) throw new Error("fixture has no nodes/edges");
    const a = g.nodes.length;
    const b = a + 1;
    const dx = 1000;
    const nodes = [
      ...g.nodes,
      { ...n0, id: a, x: n0.x + dx, junction: false },
      { ...n0, id: b, x: n0.x + dx + 50, junction: false },
    ];
    const edge = {
      ...e0,
      id: g.edges.length,
      from: a,
      to: b,
      oneway: false,
      points: [
        [n0.x + dx, n0.y, n0.z],
        [n0.x + dx + 50, n0.y, n0.z],
      ],
      lengthM: 50,
    };
    const island = { ...g, nodes, edges: [...g.edges, edge] } as unknown as RoadGraph;
    expect(blockingRoadFailures(island)).toEqual([]);
    expect(() => assertSaveableGraph(island)).not.toThrow();
  });

  it("a genuine one-way trap never blocks", () => {
    const g = shippedGraph("grid-test");
    const [n0] = g.nodes;
    const [e0] = g.edges;
    if (!n0 || !e0) throw new Error("fixture has no nodes/edges");
    const a = g.nodes.length;
    const nodes = [...g.nodes, { ...n0, id: a, x: n0.x + 30, junction: false }];
    const edge = {
      ...e0,
      id: g.edges.length,
      from: n0.id,
      to: a,
      oneway: true,
      points: [
        [n0.x, n0.y, n0.z],
        [n0.x + 30, n0.y, n0.z],
      ],
      lengthM: 30,
    };
    const trap = { ...g, nodes, edges: [...g.edges, edge] } as unknown as RoadGraph;
    expect(blockingRoadFailures(trap)).toEqual([]);
  });

  it("a repeated edge point blocks", () => {
    const g = shippedGraph("feel-test");
    const [first, ...rest] = g.edges;
    if (!first) throw new Error("fixture has no edges");
    const p = first.points;
    const dup = [p[0], p[0], ...p.slice(1)];
    const broken = { ...g, edges: [{ ...first, points: dup }, ...rest] } as unknown as RoadGraph;
    expect(blockingRoadFailures(broken).length).toBeGreaterThan(0);
  });
});

describe("shipped terrain maps stay saveable", () => {
  for (const id of SHIPPED) {
    it(`${id} has no blocking road failures`, () => {
      expect(blockingRoadFailures(shippedGraph(id))).toEqual([]);
    });
  }
});

describe("stale unlocked road guard (quick 261110-rdx)", () => {
  function roadArea(): RoadEditTarget {
    const grid = createTerrainGrid({
      rows: 100,
      cols: 100,
      cellSizeM: 2,
      originX: -100,
      originZ: -100,
    });
    const area: RoadEditTarget = {
      grid,
      paint: createPaintMap({
        originX: -100,
        originZ: -100,
        widthM: 200,
        depthM: 200,
        metresPerPixel: 0.5,
        fill: "grass",
      }),
      groundSurface: "grass",
      graph: {
        schemaVersion: 1,
        areaId: "g",
        name: "G",
        source: { osmExtract: "n/a", osmSnapshot: "n/a", demSource: "n/a", compilerVersion: "t" },
        attribution: { osm: "n/a", osmLicense: "n/a", osmLicenseUrl: "n/a", dem: "n/a" },
        origin: { lat: 0, lon: 0, projection: "local" },
        bounds: { minX: -100, minZ: -100, maxX: 100, maxZ: 100 },
        nodes: [],
        edges: [],
      },
      nextEdgeId: 0,
    };
    const pts = Array.from({ length: 61 }, (_, i) => ({ x: -60 + 2 * i, z: 0 }));
    applyRoadStroke(area, pts, "street");
    return area;
  }

  it("is null when everything is locked or the unlocked road matches the terrain", () => {
    const a = roadArea();
    for (let i = 0; i < a.grid.heights.length; i++) a.grid.heights[i] += 3;
    expect(staleRoadBlockMessage(a.grid, a.graph, [])).toBeNull();
    expect(staleRoadBlockMessage(a.grid, a.graph, undefined)).toBeNull();
    expect(() => assertGradedRoads({ ...a })).not.toThrow();
  });

  it("names the stale edge, throws with the terrain-save prefix, and clears after a re-grade", () => {
    const a = roadArea();
    const id = a.graph.edges[0].id;
    a.unlockedEdgeIds = [id];
    expect(staleRoadBlockMessage(a.grid, a.graph, a.unlockedEdgeIds)).toBeNull();
    for (let i = 0; i < a.grid.heights.length; i++) a.grid.heights[i] += 3;
    const msg = staleRoadBlockMessage(a.grid, a.graph, a.unlockedEdgeIds);
    expect(msg).toContain(String(id));
    expect(msg).toContain("Re-grade");
    expect(() => assertGradedRoads(a)).toThrow(new RegExp(`^${SAVE_GUARD_PREFIX}`));
    regradeRoads(a, [id]);
    expect(staleRoadBlockMessage(a.grid, a.graph, a.unlockedEdgeIds)).toBeNull();
  });
});
