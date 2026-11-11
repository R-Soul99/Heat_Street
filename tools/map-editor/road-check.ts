/**
 * Road check + auto-fix for the map editor.
 *
 * `checkRoads` runs the compiler's own pipeline (buildGraph -> flat elevation ->
 * buildRoadGeometry -> validateGraph) on the editor's raw roads, so "passes
 * here" means "compiles". Failures come back in plain English, tied to the
 * editor way they came from.
 *
 * `fixFoldedRoads` repairs GEOMETRY_SELF_INTERSECTION: a road whose centre line
 * kinks back on itself within less than its half-width (typical of traced
 * images: 1 m hooks on an 8 m road), so its ribbon folds over. It removes one
 * kink point per folded edge, re-checks, and repeats until clean. Junction
 * nodes and way ends are never removed.
 *
 * Layering: pure (no DOM, no fs) - safe in the browser and in vitest.
 */
import { buildRoadGeometry } from "../../src/core/road-geometry.ts";
import type { RoadGraph } from "../../src/core/road-graph.ts";
import type { AreaConfig } from "../map-compiler/areas/juliette-ga.config.ts";
import { buildGraph } from "../map-compiler/graph/build-graph.ts";
import { applyFlatElevation } from "../map-compiler/graph/elevation.ts";
import { makeProjector } from "../map-compiler/graph/project.ts";
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
  /** True when "Fix roads" can repair this kind of problem. */
  readonly fixable: boolean;
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
        fixable: f.category === "GEOMETRY_SELF_INTERSECTION",
      });
    }
    return { problems, graph };
  } catch (err) {
    return {
      problems: [
        {
          category: "BUILD_ERROR",
          text: `The road network could not be built: ${err instanceof Error ? err.message : String(err)}`,
          fixable: false,
        },
      ],
    };
  }
}

export interface FixResult {
  /** Interior points removed across all roads. */
  readonly removedPoints: number;
  /** Ways that were changed. */
  readonly changedWays: number[];
  /** Problems still present after fixing (fixable or not). */
  readonly remaining: RoadProblem[];
}

const MATCH_TOL_M = 0.5;
const MAX_PASSES = 200;

/**
 * Removes kink points until no road ribbon folds. Mutates `roads` in place
 * (callers snapshot for undo first). Returns what changed and what is left.
 */
export function fixFoldedRoads(id: string, roads: RawEnvelope): FixResult {
  const changed = new Set<number>();
  let removed = 0;
  const proj = makeProjector({
    lat: (roads.bbox.south + roads.bbox.north) / 2,
    lon: (roads.bbox.west + roads.bbox.east) / 2,
  });

  for (let pass = 0; pass < MAX_PASSES; pass++) {
    let pipeline: ReturnType<typeof runPipeline>;
    try {
      pipeline = runPipeline(id, roads);
    } catch {
      break;
    }
    const folds = pipeline.failures.filter((f) => f.category === "GEOMETRY_SELF_INTERSECTION");
    if (folds.length === 0) break;

    // Node ids that must survive: shared between ways, or a way's end.
    const useCount = new Map<number, number>();
    for (const w of roads.response.elements) {
      const ns = w.nodes ?? [];
      ns.forEach((n, i) => {
        const end = i === 0 || i === ns.length - 1;
        useCount.set(n, (useCount.get(n) ?? 0) + (end ? 2 : 1));
      });
    }

    let progress = false;
    const doneEdges = new Set<number>();
    for (const f of folds) {
      if (doneEdges.has(f.id)) continue; // one removal per edge per pass, then re-check
      doneEdges.add(f.id);
      const edge = pipeline.graph.edges.find((e) => e.id === f.id);
      const way = roads.response.elements.find((w) => w.id === edge?.osmWayId);
      if (edge === undefined || way === undefined || way.nodes === undefined) continue;
      const seg = Number(/segment (\d+)/.exec(f.message)?.[1] ?? Number.NaN);
      if (!Number.isFinite(seg)) continue;
      const pts = edge.points;
      const segLen = (i: number) =>
        i <= 0 || i >= pts.length
          ? Number.POSITIVE_INFINITY
          : Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][2] - pts[i - 1][2]);
      // Interior candidates around the folding segment, shortest neighbouring segment first.
      const candidates = [seg, seg + 1, seg - 1, seg + 2]
        .filter((i) => i > 0 && i < pts.length - 1)
        .sort((a, b) => Math.min(segLen(a), segLen(a + 1)) - Math.min(segLen(b), segLen(b + 1)));
      for (const ci of candidates) {
        const p = pts[ci];
        let best = -1;
        let bestD = MATCH_TOL_M;
        way.geometry.forEach((g, gi) => {
          const q = proj.project(g.lat, g.lon);
          const d = Math.hypot(q.x - p[0], q.z - p[2]);
          if (d < bestD) {
            bestD = d;
            best = gi;
          }
        });
        if (best <= 0 || best >= way.nodes.length - 1) continue;
        if ((useCount.get(way.nodes[best]) ?? 0) > 1) continue;
        way.nodes.splice(best, 1);
        way.geometry.splice(best, 1);
        removed++;
        changed.add(way.id);
        progress = true;
        break;
      }
    }
    if (!progress) break;
  }

  return {
    removedPoints: removed,
    changedWays: [...changed],
    remaining: checkRoads(id, roads).problems,
  };
}
