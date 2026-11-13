/**
 * The one rule deciding whether a terrain road graph may be saved (phase 04.3,
 * D-15..D-17). Used by live validation and the client save() in editor.ts and
 * by the dev-server PUT in vite-plugin.ts, so both sides agree. Lives under
 * tools/ because it imports the map-compiler validator (src/core must not
 * import tools/).
 */
import { buildRoadGeometry } from "../../src/core/road-geometry.ts";
import type { RoadGraph } from "../../src/core/road-graph.ts";
import type { TerrainGrid } from "../../src/core/terrain-grid.ts";
import { staleUnlockedEdges } from "../../src/core/terrain-road-lock.ts";
import {
  formatValidationFailures,
  type ValidationFailure,
  type ValidationFailureCategory,
  validateGraph,
} from "../map-compiler/validate/validator.ts";

/**
 * Failures that never block a terrain save (D-16, GD-ROAD). A map can be
 * mid-build: disconnected pieces (UNDIRECTED_REACHABILITY) and one-way traps
 * (DIRECTED_PATHABILITY, which also fires for every node of a cut-off piece)
 * are warnings only, and terrain maps never build ribbon meshes so a
 * self-intersection is cosmetic. Corruption (REFERENTIAL_INTEGRITY, degenerate
 * points, length mismatch) and GEOMETRY_GRADIENT still block.
 */
export const NON_BLOCKING_ON_TERRAIN: ReadonlySet<ValidationFailureCategory> =
  new Set<ValidationFailureCategory>([
    "UNDIRECTED_REACHABILITY",
    "DIRECTED_PATHABILITY",
    "GEOMETRY_SELF_INTERSECTION",
  ]);

export const SAVE_GUARD_PREFIX = "terrain-save:";

/** Validation failures that must stop a save. */
export function blockingRoadFailures(graph: RoadGraph): ValidationFailure[] {
  return validateGraph(graph, buildRoadGeometry(graph)).filter(
    (f) => !NON_BLOCKING_ON_TERRAIN.has(f.category),
  );
}

/** User-facing refusal text, or null when nothing blocks. */
export function saveBlockMessage(blocking: readonly ValidationFailure[]): string | null {
  if (blocking.length === 0) return null;
  return `Road graph invalid: ${formatValidationFailures(blocking)}. Fix this before saving: undo the last stroke or erase the road and repaint.`;
}

/** Throws a `terrain-save:` error when the graph has a blocking failure. */
export function assertSaveableGraph(graph: RoadGraph): void {
  const message = saveBlockMessage(blockingRoadFailures(graph));
  if (message !== null) throw new Error(`${SAVE_GUARD_PREFIX} ${message}`);
}

/**
 * Quick 261110-rdx (DD-3): refuses a save while any UNLOCKED road no longer
 * matches the terrain under it. Null when every unlocked road is consistent
 * (or none is unlocked).
 */
export function staleRoadBlockMessage(
  grid: TerrainGrid,
  graph: RoadGraph,
  unlocked: readonly number[] | undefined,
): string | null {
  const stale = staleUnlockedEdges(grid, graph, unlocked);
  if (stale.length === 0) return null;
  const ids = stale.map((s) => s.edgeId).join(", ");
  const worst = Math.max(...stale.map((s) => s.maxDeltaM)).toFixed(2);
  return `Unlocked road(s) ${ids} no longer match the terrain (up to ${worst} m). Re-grade them, or Lock them (locking re-grades), before saving.`;
}

/** Throws a `terrain-save:` error when an unlocked road is stale. */
export function assertGradedRoads(area: {
  grid: TerrainGrid;
  graph: RoadGraph;
  unlockedEdgeIds?: readonly number[];
}): void {
  const message = staleRoadBlockMessage(area.grid, area.graph, area.unlockedEdgeIds);
  if (message !== null) throw new Error(`${SAVE_GUARD_PREFIX} ${message}`);
}
