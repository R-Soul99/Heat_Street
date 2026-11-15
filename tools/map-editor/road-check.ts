/**
 * Road check for the map editor (report only: it never changes your roads).
 *
 * `checkRoads` runs the compiler's own pipeline (buildGraph -> flat elevation ->
 * buildRoadGeometry -> validateGraph) on the editor's raw roads, so "passes
 * here" means "compiles". Failures come back in plain English, tied to the
 * editor way they came from.
 *
 * Folded road ribbons are repaired in the ribbon builder itself (plan 07.1-14), so
 * nothing here deletes points any more.
 *
 * Layering: pure (no DOM, no fs) - safe in the browser and in vitest.
 */
import { buildRoadGeometry } from "../../src/core/road-geometry.ts";
import type { RoadGraph } from "../../src/core/road-graph.ts";
import type { AreaConfig } from "../map-compiler/areas/juliette-ga.config.ts";
import { buildGraph } from "../map-compiler/graph/build-graph.ts";
import { applyFlatElevation } from "../map-compiler/graph/elevation.ts";
import {
  type ValidationFailure,
  type ValidationFailureCategory,
  validateGraph,
} from "../map-compiler/validate/validator.ts";
import type { RawEnvelope } from "./world.ts";

export interface RoadProblem {
  readonly category: ValidationFailureCategory | "BUILD_ERROR";
  /** Editor way id the problem sits on, when known. */
  readonly wayId?: number;
  /** Plain-English explanation for the info bar / problems list. */
  readonly text: string;
}

export interface RoadCheck {
  readonly problems: RoadProblem[];
  readonly graph?: RoadGraph;
}

const PLAIN: Record<ValidationFailureCategory, string> = {
  GEOMETRY_SELF_INTERSECTION:
    "bends back on itself too sharply for its width (a tiny hook or zigzag), so the road surface folds over",
  UNDIRECTED_REACHABILITY: "is not connected to the rest of the road network",
  DIRECTED_PATHABILITY: "can't be driven to or from the rest of the network (one-way trap)",
  GEOMETRY_DEGENERATE_POINT: "has two points on top of each other",
  GEOMETRY_LENGTH_MISMATCH: "has inconsistent length data",
  GEOMETRY_GRADIENT: "is too steep",
  REFERENTIAL_INTEGRITY: "refers to a junction that doesn't exist",
};

function configFor(id: string, roads: RawEnvelope): AreaConfig {
  return {
    areaId: id,
    name: id,
    bbox: roads.bbox,
    demSource: "none-flat-authored",
    osmSnapshot: roads.fetchedAt || "editor",
    osmExtract: roads.endpoint || `authored://heat-street/${id}`,
    excludeHighwayClasses: [],
    surfaceFallbackAcknowledged: true,
  } as AreaConfig;
}

function runPipeline(
  id: string,
  roads: RawEnvelope,
): { graph: RoadGraph; failures: ValidationFailure[] } {
  const { graph } = buildGraph(roads as never, configFor(id, roads));
  const flat = applyFlatElevation(graph).graph;
  return { graph: flat, failures: validateGraph(flat, buildRoadGeometry(flat)) };
}

/** Runs the compiler's validation on the editor's roads. Never throws. */
export function checkRoads(id: string, roads: RawEnvelope): RoadCheck {
  if (roads.response.elements.length === 0) return { problems: [] };
  try {
    const { graph, failures } = runPipeline(id, roads);
    const seen = new Set<string>();
    const problems: RoadProblem[] = [];
    for (const f of failures) {
      const edge = f.kind === "edge" ? graph.edges.find((e) => e.id === f.id) : undefined;
      const wayId = edge?.osmWayId;
      const key = `${f.category}:${wayId ?? `n${f.id}`}`;
      if (seen.has(key)) continue; // one line per road per problem kind
      seen.add(key);
      problems.push({
        category: f.category,
        wayId,
        text: `${wayId !== undefined ? "A road" : `Junction ${f.id}`} ${PLAIN[f.category]}.`,
      });
    }
    return { problems, graph };
  } catch (err) {
    return {
      problems: [
        {
          category: "BUILD_ERROR",
          text: `The road network could not be built: ${err instanceof Error ? err.message : String(err)}`,
        },
      ],
    };
  }
}
