/**
 * Quick 261110-rdx: per-road lock state. Data-model helpers (this block),
 * lock-aware mask, sculpt, re-grade, junction pins, setRoadLock, carry and undo
 * (appended below by the road-logic block).
 */
import { describe, expect, it } from "vitest";
import { parseRoadGraph, type RoadGraph } from "../src/core/road-graph.ts";
import {
  createStrokeRecorder,
  raiseBlock,
  raiseLower,
  smoothBrush,
} from "../src/core/terrain-brush.ts";
import { createTerrainGrid, sampleTerrainHeight } from "../src/core/terrain-grid.ts";
import { createPaintMap } from "../src/core/terrain-paint.ts";
import {
  applyRoadStroke,
  eraseRoad,
  type RoadEditTarget,
  regradeRoads,
  roadVertexMask,
  setRoadLock,
} from "../src/core/terrain-road.ts";
import {
  carryUnlocked,
  isUnlocked,
  nearestEdgeWithin,
  normaliseUnlocked,
  STALE_ROAD_TOL_M,
  staleUnlockedEdges,
  unlockedSet,
} from "../src/core/terrain-road-lock.ts";
import { applyStrokeDiff } from "../src/core/terrain-undo.ts";

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

// ------------------------------------------------------------ road logic

const ALL = (a: LockArea) => ({
  minRow: 0,
  minCol: 0,
  maxRow: a.grid.rows,
  maxCol: a.grid.cols,
});

/** Compact-support hill added straight onto the terrain (stands in for user sculpting). */
function addHill(a: LockArea, cx: number, cz: number, radius: number, heightM: number): void {
  const stride = a.grid.rows + 1;
  for (let c = 0; c <= a.grid.cols; c++) {
    for (let r = 0; r <= a.grid.rows; r++) {
      const d = Math.hypot(
        a.grid.originX + c * a.grid.cellSizeM - cx,
        a.grid.originZ + r * a.grid.cellSizeM - cz,
      );
      const t = Math.max(0, 1 - d / radius);
      a.grid.heights[r + c * stride] += heightM * t * t;
    }
  }
}

function dabs(a: LockArea, x: number, z: number, free: ReadonlySet<number>): void {
  const opts = {
    roadMask: (win: ReturnType<typeof ALL>) => roadVertexMask(a.grid, a.paint, a.graph, win, free),
  };
  const rec = createStrokeRecorder(a.grid, a.paint);
  const brush = { x, z, radiusM: 16, strength: 1, falloff: "smooth" as const };
  for (let k = 0; k < 4; k++) raiseLower(a.grid, brush, 1, 2, rec, opts);
  smoothBrush(a.grid, brush, rec, opts);
  raiseBlock(a.grid, { x, z, blockCells: 5, stepM: 1 }, 1, rec, opts);
}

function twoRoads(): { a: LockArea; idA: number; idB: number } {
  const a = makeLockArea();
  applyRoadStroke(a, line(-60, -40, 60, -40), "street");
  applyRoadStroke(a, line(-60, 40, 60, 40), "street");
  const ids = a.graph.edges.map((e) => e.id);
  expect(ids).toHaveLength(2);
  return { a, idA: ids[0], idB: ids[1] };
}

function vertexIndex(a: LockArea, x: number, z: number): number {
  const stride = a.grid.rows + 1;
  return (
    Math.round((z - a.grid.originZ) / a.grid.cellSizeM) +
    Math.round((x - a.grid.originX) / a.grid.cellSizeM) * stride
  );
}

describe("lock-aware road mask", () => {
  it("is element-equal with no, undefined or empty free set", () => {
    const { a } = twoRoads();
    const win = ALL(a);
    const base = roadVertexMask(a.grid, a.paint, a.graph, win);
    expect(roadVertexMask(a.grid, a.paint, a.graph, win, undefined)).toEqual(base);
    expect(roadVertexMask(a.grid, a.paint, a.graph, win, new Set())).toEqual(base);
  });

  it("an unlocked edge is not held; a locked edge still is", () => {
    const { a, idA } = twoRoads();
    const m = roadVertexMask(a.grid, a.paint, a.graph, ALL(a), new Set([idA]));
    expect(m[vertexIndex(a, 0, -40)]).toBe(0);
    expect(m[vertexIndex(a, 0, -42)]).toBe(0);
    expect(m[vertexIndex(a, 0, 40)]).toBe(1);
    expect(m[vertexIndex(a, 0, 42)]).toBe(1);
  });
});

describe("sculpting over locked and unlocked roads", () => {
  it("leaves a locked road bit-identical", () => {
    const { a, idA } = twoRoads();
    const held = roadVertexMask(a.grid, a.paint, a.graph, ALL(a), new Set([idA]));
    const before = a.grid.heights.slice();
    const graphBefore = JSON.stringify(a.graph);
    dabs(a, 0, 40, new Set([idA]));
    for (let i = 0; i < held.length; i++) if (held[i]) expect(a.grid.heights[i]).toBe(before[i]);
    expect(JSON.stringify(a.graph)).toBe(graphBefore);
  });

  it("moves the terrain under an unlocked road, which then reads stale", () => {
    const { a, idA } = twoRoads();
    const idx = vertexIndex(a, 0, -40);
    const h0 = a.grid.heights[idx];
    dabs(a, 0, -40, new Set([idA]));
    expect(a.grid.heights[idx]).toBeGreaterThan(h0 + 0.5);
    expect(staleUnlockedEdges(a.grid, a.graph, [idA]).map((s) => s.edgeId)).toEqual([idA]);
  });
});

describe("regradeRoads", () => {
  it("follows a new hill, stays within grade, one consistent graph", () => {
    const a = makeLockArea();
    applyRoadStroke(a, line(-70, 0, 70, 0), "street");
    const id = a.graph.edges[0].id;
    a.unlockedEdgeIds = [id];
    addHill(a, 0, 0, 40, 6);
    expect(staleUnlockedEdges(a.grid, a.graph, [id]).length).toBe(1);
    const res = regradeRoads(a, [id]);
    expect(res.diff?.heights).toBeDefined();
    expect(res.diff?.graph).toBeDefined();
    expect(res.regradedEdgeIds).toEqual([id]);
    const e = a.graph.edges[0];
    for (const p of e.points) {
      expect(Math.abs(p[1] - sampleTerrainHeight(a.grid, p[0], p[2]))).toBeLessThan(1e-6);
    }
    expect(res.maxHeightChangeM).toBeGreaterThan(1);
    for (let i = 1; i < e.points.length; i++) {
      const dxz = Math.hypot(
        e.points[i][0] - e.points[i - 1][0],
        e.points[i][2] - e.points[i - 1][2],
      );
      expect(Math.abs(e.points[i][1] - e.points[i - 1][1]) / dxz).toBeLessThanOrEqual(0.45 + 1e-6);
    }
    expect(res.maxGradePct).toBeGreaterThan(0);
    expect(res.maxGradePct).toBeLessThanOrEqual(45 + 1e-4);
    expect(staleUnlockedEdges(a.grid, a.graph, [id])).toEqual([]);
    parseRoadGraph(JSON.stringify(a.graph), "regrade-test");
  });

  it("pins to a locked road at a junction and never moves it", () => {
    const a = makeLockArea();
    applyRoadStroke(a, line(-60, 0, 60, 0), "street");
    applyRoadStroke(a, line(0, 0, 0, 70), "street");
    expect(a.graph.edges).toHaveLength(3);
    const stem = a.graph.edges.find((e) => e.points.some((p) => p[2] > 50));
    if (!stem) throw new Error("stem edge missing");
    const lockedEdges = a.graph.edges.filter((e) => e.id !== stem.id);
    a.unlockedEdgeIds = [stem.id];
    addHill(a, 0, 45, 22, 6);
    const held = roadVertexMask(a.grid, a.paint, a.graph, ALL(a), new Set([stem.id]));
    const heightsBefore = a.grid.heights.slice();
    const lockedBefore = JSON.stringify(lockedEdges);
    const junction = a.graph.nodes.find((n) => Math.abs(n.x) < 1 && Math.abs(n.z) < 1);
    if (!junction) throw new Error("junction missing");
    const nodeBefore = { ...junction };
    const res = regradeRoads(a, [stem.id]);
    expect(res.regradedEdgeIds).toEqual([stem.id]);
    for (let i = 0; i < held.length; i++) {
      if (held[i]) expect(a.grid.heights[i]).toBe(heightsBefore[i]);
    }
    expect(JSON.stringify(a.graph.edges.filter((e) => e.id !== stem.id))).toBe(lockedBefore);
    expect(a.graph.nodes.find((n) => n.id === junction.id)).toEqual(nodeBefore);
    const stemAfter = a.graph.edges.find((e) => e.id === stem.id);
    if (!stemAfter) throw new Error("stem missing");
    const ends = [stemAfter.points[0], stemAfter.points[stemAfter.points.length - 1]];
    const atJunction = ends.find((p) => Math.abs(p[2]) < 1);
    expect(atJunction?.[1]).toBe(nodeBefore.y);
    const far = stemAfter.points[stemAfter.points.length - 1];
    expect(Math.abs(far[1] - sampleTerrainHeight(a.grid, far[0], far[2]))).toBeLessThan(0.05);
    expect(staleUnlockedEdges(a.grid, a.graph, [stem.id])).toEqual([]);
    parseRoadGraph(JSON.stringify(a.graph), "regrade-junction");
  });

  it("gives two re-graded roads sharing a node one shared height", () => {
    const a = makeLockArea();
    applyRoadStroke(a, line(-60, 0, 60, 0), "street");
    applyRoadStroke(a, line(0, 0, 0, 70), "street");
    a.unlockedEdgeIds = a.graph.edges.map((e) => e.id);
    addHill(a, 0, 10, 40, 5);
    const res = regradeRoads(a, "all-unlocked");
    expect(res.regradedEdgeIds).toHaveLength(3);
    const parsed = parseRoadGraph(JSON.stringify(a.graph), "regrade-shared");
    for (const n of parsed.nodes) {
      for (const e of parsed.edges) {
        if (e.from === n.id) expect(e.points[0][1]).toBe(n.y);
        if (e.to === n.id) expect(e.points[e.points.length - 1][1]).toBe(n.y);
      }
    }
    expect(staleUnlockedEdges(a.grid, a.graph, a.unlockedEdgeIds)).toEqual([]);
  });

  it("is a no-op with a warning on a locked edge, and without a diff when none is unlocked", () => {
    const a = makeLockArea();
    applyRoadStroke(a, line(-60, 0, 60, 0), "street");
    const id = a.graph.edges[0].id;
    const res = regradeRoads(a, [id]);
    expect(res.diff).toBeUndefined();
    expect(res.warnings).toContain(`Road ${id} is locked; unlock it to re-grade.`);
    expect(regradeRoads(a, "all-unlocked").diff).toBeUndefined();
  });
});

describe("setRoadLock", () => {
  it("unlocking is a lock-only diff", () => {
    const a = makeLockArea();
    applyRoadStroke(a, line(-60, 0, 60, 0), "street");
    const id = a.graph.edges[0].id;
    const res = setRoadLock(a, [id], false);
    expect(res.changedEdgeIds).toEqual([id]);
    expect(res.diff?.heights).toBeUndefined();
    expect(res.diff?.graph).toBeUndefined();
    expect(res.diff?.lock).toEqual({ before: [], after: [id] });
    expect(a.unlockedEdgeIds).toEqual([id]);
    expect(setRoadLock(a, [id], false).diff).toBeUndefined();
  });

  it("locking a stale road re-grades first in ONE diff; undo and redo restore everything", () => {
    const a = makeLockArea();
    applyRoadStroke(a, line(-70, 0, 70, 0), "street");
    const id = a.graph.edges[0].id;
    a.unlockedEdgeIds = [id];
    addHill(a, 0, 0, 40, 6);
    const h0 = a.grid.heights.slice();
    const g0 = JSON.stringify(a.graph);
    const res = setRoadLock(a, [id], true);
    expect(res.regradedEdgeIds).toEqual([id]);
    expect(res.diff?.heights).toBeDefined();
    expect(res.diff?.graph).toBeDefined();
    expect(res.diff?.lock).toEqual({ before: [id], after: [] });
    expect(a.unlockedEdgeIds).toEqual([]);
    const h1 = a.grid.heights.slice();
    const g1 = JSON.stringify(a.graph);
    expect(g1).not.toBe(g0);
    if (!res.diff) throw new Error("diff expected");
    applyStrokeDiff(a, res.diff, "before");
    expect(a.grid.heights).toEqual(h0);
    expect(JSON.stringify(a.graph)).toBe(g0);
    expect(a.unlockedEdgeIds).toEqual([id]);
    applyStrokeDiff(a, res.diff, "after");
    expect(a.grid.heights).toEqual(h1);
    expect(JSON.stringify(a.graph)).toBe(g1);
    expect(a.unlockedEdgeIds).toEqual([]);
  });

  it("locking a consistent road is a pure flag change", () => {
    const a = makeLockArea();
    applyRoadStroke(a, line(-60, 0, 60, 0), "street");
    const id = a.graph.edges[0].id;
    a.unlockedEdgeIds = [id];
    const res = setRoadLock(a, [id], true);
    expect(res.diff?.heights).toBeUndefined();
    expect(res.diff?.graph).toBeUndefined();
    expect(res.diff?.lock).toEqual({ before: [id], after: [] });
  });
});

describe("lock carry through strokes and erase", () => {
  it("both pieces of a crossed unlocked road stay unlocked; new edges are locked", () => {
    const a = makeLockArea();
    applyRoadStroke(a, line(-60, 0, 60, 0), "street");
    const idA = a.graph.edges[0].id;
    a.unlockedEdgeIds = [idA];
    const res = applyRoadStroke(a, line(0, -60, 0, 60), "highway");
    expect(res.diff?.lock).toBeDefined();
    const horizontal = a.graph.edges.filter((e) => e.points.every((p) => Math.abs(p[2]) < 0.5));
    expect(horizontal.length).toBe(2);
    expect([...(a.unlockedEdgeIds ?? [])].sort()).toEqual(horizontal.map((e) => e.id).sort());
    for (const id of res.newEdgeIds) expect(a.unlockedEdgeIds).not.toContain(id);
  });

  it("a partial erase keeps the surviving pieces unlocked", () => {
    const a = makeLockArea();
    applyRoadStroke(a, line(-60, 0, 60, 0), "street");
    a.unlockedEdgeIds = [a.graph.edges[0].id];
    eraseRoad(a, 0, 0, 8);
    expect(a.graph.edges).toHaveLength(2);
    expect([...(a.unlockedEdgeIds ?? [])].sort()).toEqual(a.graph.edges.map((e) => e.id).sort());
  });

  it("a replace-mode overwrite drops the replaced edge from the unlocked list", () => {
    const a = makeLockArea();
    applyRoadStroke(a, line(-60, 0, 60, 0), "street");
    a.unlockedEdgeIds = [a.graph.edges[0].id];
    applyRoadStroke(a, line(-60, 0, 60, 0), "street", { replace: true });
    expect(a.unlockedEdgeIds).toEqual([]);
  });
});
