/**
 * Per-road lock state for the terrain editor (quick 261110-rdx).
 *
 * DD-1  The lock unit is the road-graph EDGE id (stable, never reused). Split
 *       pieces inherit the lock state of the edge they were cut from.
 * DD-2  Storage is the list of UNLOCKED edge ids; absent or empty = all locked.
 * DD-3  An unlocked edge is "stale" when its graph y differs from the terrain
 *       by more than STALE_ROAD_TOL_M; saving is refused while any exist.
 * DD-4  Locking a stale road re-grades it first (see terrain-road.ts).
 *
 * Layering: pure core, no three/rapier/DOM.
 */
import type { RoadGraph } from "./road-graph.ts";
import { sampleTerrainHeight, type TerrainGrid } from "./terrain-grid.ts";

/** Well above the 0.01 m save quantisation of terrain heights. */
export const STALE_ROAD_TOL_M = 0.05;

/** Sorted, distinct ids that exist as edges in `graph`. */
export function normaliseUnlocked(ids: readonly number[] | undefined, graph: RoadGraph): number[] {
  if (ids === undefined || ids.length === 0) return [];
  const exists = new Set(graph.edges.map((e) => e.id));
  const out = new Set<number>();
  for (const id of ids) if (Number.isInteger(id) && exists.has(id)) out.add(id);
  return [...out].sort((a, b) => a - b);
}

/** The set callers pass to the lock-aware road mask; undefined when nothing is unlocked (old path). */
export function unlockedSet(ids: readonly number[] | undefined): ReadonlySet<number> | undefined {
  return ids === undefined || ids.length === 0 ? undefined : new Set(ids);
}

export function isUnlocked(area: { unlockedEdgeIds?: readonly number[] }, edgeId: number): boolean {
  return area.unlockedEdgeIds?.includes(edgeId) === true;
}

/**
 * Unlocked ids after a graph edit: survivors stay unlocked, split pieces whose
 * parent was unlocked become unlocked, removed edges drop out, brand new edges
 * stay locked.
 */
export function carryUnlocked(
  prev: readonly number[] | undefined,
  after: RoadGraph,
  splitFrom: readonly { id: number; parentId: number }[],
): number[] {
  const wasUnlocked = new Set(prev ?? []);
  const exists = new Set(after.edges.map((e) => e.id));
  const next = new Set<number>();
  for (const id of wasUnlocked) if (exists.has(id)) next.add(id);
  for (const s of splitFrom) if (wasUnlocked.has(s.parentId) && exists.has(s.id)) next.add(s.id);
  return [...next].sort((a, b) => a - b);
}

/** Unlocked edges whose graph y no longer matches the terrain (points and end nodes). */
export function staleUnlockedEdges(
  grid: TerrainGrid,
  graph: RoadGraph,
  unlocked: readonly number[] | undefined,
  tolM: number = STALE_ROAD_TOL_M,
): { edgeId: number; maxDeltaM: number }[] {
  if (unlocked === undefined || unlocked.length === 0) return [];
  const set = new Set(unlocked);
  const nodeById = new Map(graph.nodes.map((n) => [n.id, n]));
  const out: { edgeId: number; maxDeltaM: number }[] = [];
  for (const e of graph.edges) {
    if (!set.has(e.id)) continue;
    let worst = 0;
    for (const p of e.points) {
      worst = Math.max(worst, Math.abs(p[1] - sampleTerrainHeight(grid, p[0], p[2])));
    }
    for (const id of [e.from, e.to]) {
      const n = nodeById.get(id);
      if (n) worst = Math.max(worst, Math.abs(n.y - sampleTerrainHeight(grid, n.x, n.z)));
    }
    if (worst > tolM) out.push({ edgeId: e.id, maxDeltaM: worst });
  }
  return out;
}

/** Nearest edge whose XZ distance is within max(radiusM, widthM / 2 + 2). */
export function nearestEdgeWithin(
  graph: RoadGraph,
  x: number,
  z: number,
  radiusM: number,
): { edgeId: number; distanceM: number } | null {
  let best: { edgeId: number; distanceM: number } | null = null;
  for (const e of graph.edges) {
    const limit = Math.max(radiusM, e.widthM / 2 + 2);
    let d = Number.POSITIVE_INFINITY;
    for (let k = 0; k + 1 < e.points.length; k++) {
      const a = e.points[k];
      const b = e.points[k + 1];
      const dx = b[0] - a[0];
      const dz = b[2] - a[2];
      const len2 = dx * dx + dz * dz;
      const t = len2 > 0 ? Math.min(1, Math.max(0, ((x - a[0]) * dx + (z - a[2]) * dz) / len2)) : 0;
      d = Math.min(d, Math.hypot(x - (a[0] + dx * t), z - (a[2] + dz * t)));
    }
    if (d <= limit && (best === null || d < best.distanceM)) best = { edgeId: e.id, distanceM: d };
  }
  return best;
}
