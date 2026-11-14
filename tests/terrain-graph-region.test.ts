/**
 * 07.1.2-05: cut-and-delete road at a selection edge (D-15, D-26) and whole
 * edge lookup for Lock/Unlock (D-25).
 */
import { describe, expect, it } from "vitest";
import type { RoadGraph } from "../src/core/road-graph.ts";
import { createCellMask } from "../src/core/terrain-cell-mask.ts";
import {
  addRoadStroke,
  eraseGraphMask,
  type GraphEditState,
  type RoadProfile,
  refineAgainstMask,
} from "../src/core/terrain-graph.ts";
import { createTerrainGrid } from "../src/core/terrain-grid.ts";
import { createPaintMap, PAINT_ROAD_FLAG, paintIndexAt } from "../src/core/terrain-paint.ts";
import {
  applyRoadStroke,
  edgeIdsInMask,
  eraseRoadRegion,
  type RoadEditTarget,
} from "../src/core/terrain-road.ts";
import { applyStrokeDiff } from "../src/core/terrain-undo.ts";
import { blockingRoadFailures } from "../tools/terrain-editor/save-guard.ts";

const PROFILE: RoadProfile = {
  roadClass: "residential",
  lanes: 2,
  widthM: 8,
  surface: "tarmac",
  speedLimitKph: 50,
  oneway: false,
};

const SIZE = 200;
const CELL = 2;
const N = SIZE / CELL;

function emptyGraph(): RoadGraph {
  const half = SIZE / 2;
  return {
    schemaVersion: 1,
    areaId: "test",
    name: "Test",
    source: { osmExtract: "n/a", osmSnapshot: "n/a", demSource: "n/a", compilerVersion: "test" },
    attribution: { osm: "n/a", osmLicense: "n/a", osmLicenseUrl: "n/a", dem: "n/a" },
    origin: { lat: 0, lon: 0, projection: "local" },
    bounds: { minX: -half, minZ: -half, maxX: half, maxZ: half },
    nodes: [],
    edges: [],
  };
}

function makeArea(): RoadEditTarget {
  return {
    grid: createTerrainGrid({
      rows: N,
      cols: N,
      cellSizeM: CELL,
      originX: -SIZE / 2,
      originZ: -SIZE / 2,
    }),
    paint: createPaintMap({
      originX: -SIZE / 2,
      originZ: -SIZE / 2,
      widthM: SIZE,
      depthM: SIZE,
      metresPerPixel: 0.5,
      fill: "grass",
    }),
    groundSurface: "grass",
    graph: emptyGraph(),
    nextEdgeId: 0,
  };
}

function line(x0: number, z0: number, x1: number, z1: number, step = 1) {
  const len = Math.hypot(x1 - x0, z1 - z0);
  const n = Math.max(2, Math.ceil(len / step));
  return Array.from({ length: n + 1 }, (_, i) => ({
    x: x0 + ((x1 - x0) * i) / n,
    z: z0 + ((z1 - z0) * i) / n,
  }));
}

/** Mask over world-metre box [x0,x1) x [z0,z1) on the 2 m grid. */
function boxMask(x0: number, z0: number, x1: number, z1: number, sub = false) {
  const m = createCellMask(N, N);
  const box = {
    minCol: (x0 + SIZE / 2) / CELL,
    maxCol: (x1 + SIZE / 2) / CELL,
    minRow: (z0 + SIZE / 2) / CELL,
    maxRow: (z1 + SIZE / 2) / CELL,
  };
  m.apply(box, "add");
  if (sub) return m;
  return m;
}

function onGridLine(v: number, origin: number): boolean {
  const k = (v - origin) / CELL;
  return Math.abs(k - Math.round(k)) < 1e-6;
}

function straightState(): GraphEditState {
  const s: GraphEditState = { graph: emptyGraph(), nextEdgeId: 0 };
  return addRoadStroke(
    s,
    [
      [-60, 0, 0],
      [60, 0, 0],
    ],
    PROFILE,
  ).state;
}

describe("eraseGraphMask", () => {
  it("splits an edge crossing a selected strip on the grid lines", () => {
    const s = straightState();
    const grid = makeArea().grid;
    const mask = boxMask(-3 + 1, -20, 5, 20); // x in [-2, 5) -> aligned to cells
    const r = eraseGraphMask(s, grid, mask);
    expect(r.state.graph.edges).toHaveLength(2);
    expect(r.splitFrom).toHaveLength(1);
    const first = r.state.graph.edges.find((e) => e.id === s.graph.edges[0].id);
    const second = r.state.graph.edges.find((e) => e.id !== s.graph.edges[0].id);
    expect(first).toBeDefined();
    expect(r.splitFrom[0].id).toBe(second?.id);
    const cutA = first?.points[first.points.length - 1];
    const cutB = second?.points[0];
    expect(onGridLine(cutA?.[0] ?? 0.5, grid.originX)).toBe(true);
    expect(onGridLine(cutB?.[0] ?? 0.5, grid.originX)).toBe(true);
    for (const e of r.state.graph.edges) {
      expect(e.lengthM).toBeGreaterThan(0);
      for (const p of e.points) expect(p[1]).toBeCloseTo(0, 9);
    }
  });

  it("removes an edge fully inside and leaves an outside edge untouched", () => {
    const s = straightState();
    const grid = makeArea().grid;
    const all = eraseGraphMask(s, grid, boxMask(-100, -100, 100, 100));
    expect(all.state.graph.edges).toHaveLength(0);
    expect(all.removedEdgeIds).toEqual([s.graph.edges[0].id]);
    const miss = eraseGraphMask(s, grid, boxMask(-20, 40, 20, 60));
    expect(miss.state).toBe(s);
  });

  it("a ring selection leaves three pieces (before, hole, after)", () => {
    const s = straightState();
    const grid = makeArea().grid;
    const mask = boxMask(-30, -30, 30, 30);
    mask.apply(
      {
        minCol: (-10 + 100) / CELL,
        maxCol: (10 + 100) / CELL,
        minRow: (-10 + 100) / CELL,
        maxRow: (10 + 100) / CELL,
      },
      "subtract",
    );
    const r = eraseGraphMask(s, grid, mask);
    expect(r.state.graph.edges).toHaveLength(3);
    const xs = r.state.graph.edges
      .map((e) => [e.points[0][0], e.points[e.points.length - 1][0]].sort((a, b) => a - b))
      .sort((a, b) => a[0] - b[0]);
    expect(xs[0][0]).toBeCloseTo(-60, 6);
    expect(xs[0][1]).toBeCloseTo(-30, 6);
    expect(xs[1][0]).toBeCloseTo(-10, 6);
    expect(xs[1][1]).toBeCloseTo(10, 6);
    expect(xs[2][0]).toBeCloseTo(30, 6);
    expect(xs[2][1]).toBeCloseTo(60, 6);
  });

  it("refineAgainstMask flags inside segments as not kept", () => {
    const grid = makeArea().grid;
    const r = refineAgainstMask(
      [
        [-10, 0, 0],
        [10, 0, 0],
      ],
      grid,
      boxMask(-4, -4, 4, 4),
    );
    expect(r.keep.filter((k) => !k).length).toBeGreaterThan(0);
    expect(r.keep[0]).toBe(true);
    expect(r.keep[r.keep.length - 1]).toBe(true);
  });
});

describe("eraseRoadRegion", () => {
  function roadArea() {
    const a = makeArea();
    applyRoadStroke(a, line(-60, 0, 60, 0), "street");
    return a;
  }

  it("cuts the graph, clears road paint in the selection, keeps heights, undoes cleanly", () => {
    const a = roadArea();
    const heightsBefore = a.grid.heights.slice();
    const graphBefore = JSON.stringify(a.graph);
    const paintBefore = a.paint.data.slice();
    const res = eraseRoadRegion(a, boxMask(-10, -20, 10, 20));
    expect(res.diff).toBeDefined();
    expect(a.graph.edges).toHaveLength(2);
    expect(Array.from(a.grid.heights)).toEqual(Array.from(heightsBefore));
    const inside = paintIndexAt(a.paint, 0, 0);
    expect(inside).toBeGreaterThanOrEqual(0);
    expect(a.paint.data[inside] & PAINT_ROAD_FLAG).toBe(0);
    const outside = paintIndexAt(a.paint, 40, 0);
    expect(a.paint.data[outside] & PAINT_ROAD_FLAG).not.toBe(0);
    expect(blockingRoadFailures(a.graph)).toHaveLength(0);
    if (res.diff) applyStrokeDiff(a, res.diff, "before");
    expect(JSON.stringify(a.graph)).toBe(graphBefore);
    expect(Array.from(a.paint.data)).toEqual(Array.from(paintBefore));
  });

  it("deletes a locked road too (D-26)", () => {
    const a = roadArea();
    a.unlockedEdgeIds = [];
    const res = eraseRoadRegion(a, boxMask(-100, -20, 100, 20));
    expect(res.removedEdgeIds).toHaveLength(1);
    expect(a.graph.edges).toHaveLength(0);
  });

  it("both surviving pieces of an unlocked road stay unlocked", () => {
    const a = roadArea();
    a.unlockedEdgeIds = [a.graph.edges[0].id];
    eraseRoadRegion(a, boxMask(-10, -20, 10, 20));
    expect([...(a.unlockedEdgeIds ?? [])].sort()).toEqual(a.graph.edges.map((e) => e.id).sort());
    expect(a.graph.edges).toHaveLength(2);
  });

  it("an empty mask changes nothing", () => {
    const a = roadArea();
    const before = JSON.stringify(a.graph);
    const res = eraseRoadRegion(a, createCellMask(N, N));
    expect(res.diff).toBeUndefined();
    expect(JSON.stringify(a.graph)).toBe(before);
  });
});

describe("edgeIdsInMask", () => {
  it("lists whole edges touching the selection, graph unchanged", () => {
    const a = makeArea();
    applyRoadStroke(a, line(-60, 0, 60, 0), "street");
    applyRoadStroke(a, line(-60, 80, 60, 80), "street");
    const before = JSON.stringify(a.graph);
    const ids = edgeIdsInMask(a.graph, a.grid, boxMask(-10, -10, 10, 10));
    expect(ids).toHaveLength(1);
    expect(edgeIdsInMask(a.graph, a.grid, boxMask(-10, 40, 10, 60))).toEqual([]);
    expect(edgeIdsInMask(a.graph, a.grid, createCellMask(N, N))).toEqual([]);
    expect(JSON.stringify(a.graph)).toBe(before);
  });
});
