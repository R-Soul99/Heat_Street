/**
 * Quick 261110-rdx: per-road lock state. Data-model helpers (this block),
 * lock-aware mask, sculpt, re-grade, junction pins, setRoadLock, carry and undo
 * (appended below by the road-logic block).
 */
import { describe, expect, it } from "vitest";
import type { RoadGraph } from "../src/core/road-graph.ts";
import { createTerrainGrid, sampleTerrainHeight } from "../src/core/terrain-grid.ts";
import { createPaintMap } from "../src/core/terrain-paint.ts";
import { applyRoadStroke, type RoadEditTarget } from "../src/core/terrain-road.ts";
import {
  carryUnlocked,
  isUnlocked,
  nearestEdgeWithin,
  normaliseUnlocked,
  STALE_ROAD_TOL_M,
  staleUnlockedEdges,
  unlockedSet,
} from "../src/core/terrain-road-lock.ts";

function emptyGraph(half: number): RoadGraph {
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

type LockArea = RoadEditTarget;

/** Flat (default) or caller-shaped terrain, 2 m cells. */
function makeLockArea(sizeM = 200, shape?: (x: number, z: number) => number): LockArea {
  const cell = 2;
  const n = Math.round(sizeM / cell);
  const grid = createTerrainGrid({
    rows: n,
    cols: n,
    cellSizeM: cell,
    originX: -sizeM / 2,
    originZ: -sizeM / 2,
  });
  const stride = n + 1;
  if (shape) {
    for (let c = 0; c <= n; c++) {
      for (let r = 0; r <= n; r++) {
        grid.heights[r + c * stride] = shape(grid.originX + c * cell, grid.originZ + r * cell);
      }
    }
  }
  return {
    grid,
    paint: createPaintMap({
      originX: -sizeM / 2,
      originZ: -sizeM / 2,
      widthM: sizeM,
      depthM: sizeM,
      metresPerPixel: 0.5,
      fill: "grass",
    }),
    groundSurface: "grass",
    graph: emptyGraph(sizeM / 2),
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

describe("lock helpers", () => {
  it("normaliseUnlocked sorts, dedupes and drops unknown ids", () => {
    const a = makeLockArea();
    applyRoadStroke(a, line(-60, 0, 60, 0), "street");
    const id = a.graph.edges[0].id;
    expect(normaliseUnlocked([id, id, 99, -1, 1.5], a.graph)).toEqual([id]);
    expect(normaliseUnlocked(undefined, a.graph)).toEqual([]);
  });

  it("unlockedSet is undefined when empty so callers keep the old path", () => {
    expect(unlockedSet(undefined)).toBeUndefined();
    expect(unlockedSet([])).toBeUndefined();
    expect(unlockedSet([3])?.has(3)).toBe(true);
    expect(isUnlocked({ unlockedEdgeIds: [3] }, 3)).toBe(true);
    expect(isUnlocked({}, 3)).toBe(false);
  });

  it("carryUnlocked keeps survivors, inherits split pieces, drops removed ids", () => {
    const a = makeLockArea();
    applyRoadStroke(a, line(-60, 0, 60, 0), "street");
    const after = a.graph;
    const keep = after.edges[0].id;
    const out = carryUnlocked([keep, 77], after, [
      { id: 500, parentId: keep },
      { id: after.edges[0].id, parentId: keep },
    ]);
    expect(out).toEqual([keep]);
    const edgeB = { ...after.edges[0], id: 500 };
    const withB = { ...after, edges: [...after.edges, edgeB] };
    expect(carryUnlocked([keep], withB, [{ id: 500, parentId: keep }])).toEqual([keep, 500]);
    expect(carryUnlocked([], withB, [{ id: 500, parentId: keep }])).toEqual([]);
  });

  it("staleUnlockedEdges flags an unlocked edge after the terrain moves, ignores locked and tiny deltas", () => {
    const a = makeLockArea();
    applyRoadStroke(a, line(-60, 0, 60, 0), "street");
    const id = a.graph.edges[0].id;
    expect(staleUnlockedEdges(a.grid, a.graph, [id])).toEqual([]);
    for (let i = 0; i < a.grid.heights.length; i++) a.grid.heights[i] += STALE_ROAD_TOL_M * 0.5;
    expect(staleUnlockedEdges(a.grid, a.graph, [id])).toEqual([]);
    for (let i = 0; i < a.grid.heights.length; i++) a.grid.heights[i] += 1;
    const stale = staleUnlockedEdges(a.grid, a.graph, [id]);
    expect(stale.map((s) => s.edgeId)).toEqual([id]);
    expect(stale[0].maxDeltaM).toBeGreaterThan(1);
    expect(staleUnlockedEdges(a.grid, a.graph, [])).toEqual([]);
    expect(staleUnlockedEdges(a.grid, a.graph, undefined)).toEqual([]);
    const p = a.graph.edges[0].points[3];
    expect(Math.abs(p[1] - sampleTerrainHeight(a.grid, p[0], p[2]))).toBeGreaterThan(0.9);
  });

  it("nearestEdgeWithin picks the closest edge inside max(radius, half width + 2)", () => {
    const a = makeLockArea();
    applyRoadStroke(a, line(-60, 0, 60, 0), "street");
    const id = a.graph.edges[0].id;
    expect(nearestEdgeWithin(a.graph, 0, 1, 1)?.edgeId).toBe(id);
    expect(nearestEdgeWithin(a.graph, 0, 6.5, 1)?.edgeId).toBe(id);
    expect(nearestEdgeWithin(a.graph, 0, 8, 1)).toBeNull();
    expect(nearestEdgeWithin(a.graph, 0, 8, 10)?.edgeId).toBe(id);
  });
});
