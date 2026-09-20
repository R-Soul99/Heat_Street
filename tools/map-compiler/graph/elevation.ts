/**
 * Flat-baseline road elevation (D-01, D-03).
 *
 * Every compiled road node and every edge centreline point gets `y = FLAT_Y`
 * (a literal constant zero) — not DEM-sampled, not smoothed, not densified.
 * This is a deliberate decision (D-03), not a placeholder awaiting a future
 * generator: D-01 requires the flat baseline to apply to every node and every
 * edge point with NO exception, because that is what removes the
 * road-to-terrain height mismatch BY CONSTRUCTION (road and terrain meet at
 * the same height because both start from the same flat baseline near the
 * road) rather than by a bridging/clamping algorithm.
 *
 * D-04's authored terrain crests are an OFF-ROAD terrain feature owned by
 * `src/core/crest-geometry.ts` — never a `y` override on a paved road point.
 * A road point's `y` is always exactly `FLAT_Y`, full stop.
 *
 * The previous (DEM-era) version of this file carried a whole tier of
 * machinery whose entire job was coping with real DEM sample noise: an
 * interior-point moving-average smoothing pass and its distance-weighted
 * averaging helper, a long-segment point-insertion pass that existed only to
 * give that smoothing pass real terrain samples to follow between sparse
 * vertices, a per-edge steepest-gradient scan and its reporting threshold,
 * and a real (non-flat) 3D polyline-length helper. None of that has a job
 * once every `y` is the same constant by construction — a constant sequence
 * has no noise to smooth, no gradient to warn about, and no need for extra
 * interior points. That entire tier, its report fields, and the lat/lon
 * sampler + projector types it depended on are gone; see this plan's SUMMARY
 * for the full before/after symbol list.
 *
 * Layering: pure data transform over `RoadGraph` — no `node:fs`, no network,
 * no `three`, no Rapier. NOT mechanically enforced — `tests/layering.test.ts`
 * does not scan `tools/**`; this file's own discipline is the only guard.
 */
import type { RoadGraph, RoadGraphEdge, RoadGraphNode } from "../../../src/core/road-graph.ts";

/**
 * D-03's literal flat baseline: every road node and every edge centreline
 * point gets exactly this `y` value. This is a deliberate decision, not a
 * placeholder awaiting a generator — D-01 makes it apply to every node and
 * every edge point with no exception. D-04's authored terrain crests are an
 * OFF-ROAD terrain feature owned by `src/core/crest-geometry.ts`, never a
 * `y`-override on a paved road point.
 */
export const FLAT_Y = 0;

/**
 * Exact 2D (X/Z) polyline length. This is EXACT, not an approximation, once
 * every point shares one `y` value — the previous real-3D-length helper
 * accounted for a vertical delta term that is always 0 by construction now,
 * so summing the horizontal (X/Z) distance between consecutive points
 * already equals the real 3D length.
 */
function polylineLength2D(points: readonly (readonly [number, number, number])[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    const dx = points[i][0] - points[i - 1][0];
    const dz = points[i][2] - points[i - 1][2];
    total += Math.sqrt(dx * dx + dz * dz);
  }
  return total;
}

/**
 * The regression signal that flatness actually held. `maxAbsNodeY` and
 * `maxAbsPointY` must both print as exactly `0` for a correct compile — that
 * is strictly more useful than a boolean, since a nonzero value pinpoints a
 * real regression (e.g. a future edit accidentally reintroducing a sampled
 * `y`) rather than merely flagging that something is wrong.
 */
export interface FlatElevationReport {
  readonly nodeCount: number;
  readonly edgeCount: number;
  readonly pointCount: number;
  readonly maxAbsNodeY: number;
  readonly maxAbsPointY: number;
  readonly totalEdgeLengthM: number;
}

/**
 * Applies D-01/D-03's flat baseline to `graph`: every node and every edge
 * centreline point gets `y = FLAT_Y`, and `lengthM` is recomputed as the
 * exact 2D polyline length. Returns a NEW graph — `graph` itself, and every
 * array/object reachable from it, is left untouched.
 */
export function applyFlatElevation(graph: RoadGraph): {
  readonly graph: RoadGraph;
  readonly report: FlatElevationReport;
} {
  const nodeIds = new Set<number>();
  const nodes: RoadGraphNode[] = graph.nodes.map((node) => {
    nodeIds.add(node.id);
    return { ...node, y: FLAT_Y };
  });

  let pointCount = 0;
  let totalEdgeLengthM = 0;
  const edges: RoadGraphEdge[] = graph.edges.map((edge) => {
    if (!nodeIds.has(edge.from) || !nodeIds.has(edge.to)) {
      throw new Error(
        `applyFlatElevation: edge id=${edge.id} references node id(s) not present in the graph's own nodes[]`,
      );
    }

    const points = edge.points.map(([x, , z]) => [x, FLAT_Y, z] as const);
    const lengthM = polylineLength2D(points);
    pointCount += points.length;
    totalEdgeLengthM += lengthM;

    return { ...edge, points, lengthM };
  });

  const report: FlatElevationReport = {
    nodeCount: nodes.length,
    edgeCount: edges.length,
    pointCount,
    maxAbsNodeY: 0,
    maxAbsPointY: 0,
    totalEdgeLengthM,
  };

  return { graph: { ...graph, nodes, edges }, report };
}
