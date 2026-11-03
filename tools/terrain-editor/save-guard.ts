/**
 * The one rule deciding whether a terrain road graph may be saved (phase 04.3,
 * D-15..D-17). Used by live validation and the client save() in editor.ts and
 * by the dev-server PUT in vite-plugin.ts, so both sides agree. Lives under
 * tools/ because it imports the map-compiler validator (src/core must not
 * import tools/).
 */
import { buildRoadGeometry } from "../../src/core/road-geometry.ts";
import type { RoadGraph } from "../../src/core/road-graph.ts";
import {
  formatValidationFailures,
  type ValidationFailure,
  type ValidationFailureCategory,
  validateGraph,
} from "../map-compiler/validate/validator.ts";

/**
 * Failures that never block a terrain save (D-16). A map can be mid-build
 * (disconnected pieces), and terrain maps never build ribbon meshes so a
 * self-intersection is cosmetic. DIRECTED_PATHABILITY deliberately blocks.
 */
export const NON_BLOCKING_ON_TERRAIN: ReadonlySet<ValidationFailureCategory> = new Set<
  ValidationFailureCategory
>(["UNDIRECTED_REACHABILITY", "GEOMETRY_SELF_INTERSECTION"]);

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
