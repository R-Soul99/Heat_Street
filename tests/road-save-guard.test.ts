/**
 * Phase 04.3 plan 04 (D-15..D-17): the shared save-guard rule, plus proof that
 * every tracked shipped terrain map passes it (so none becomes un-saveable).
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { RoadGraph } from "../src/core/road-graph.ts";
import { parseTerrainSidecar } from "../src/core/terrain-format.ts";
import {
  formatValidationFailures,
  type ValidationFailure,
} from "../tools/map-compiler/validate/validator.ts";
import {
  assertSaveableGraph,
  blockingRoadFailures,
  NON_BLOCKING_ON_TERRAIN,
  SAVE_GUARD_PREFIX,
  saveBlockMessage,
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
  it("exempts exactly UNDIRECTED_REACHABILITY and GEOMETRY_SELF_INTERSECTION", () => {
    expect([...NON_BLOCKING_ON_TERRAIN].sort()).toEqual([
      "GEOMETRY_SELF_INTERSECTION",
      "UNDIRECTED_REACHABILITY",
    ]);
    expect(NON_BLOCKING_ON_TERRAIN.has("DIRECTED_PATHABILITY")).toBe(false);
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
    const cats = blockingRoadFailures(island).map((f) => f.category);
    expect(cats).not.toContain("UNDIRECTED_REACHABILITY");
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
