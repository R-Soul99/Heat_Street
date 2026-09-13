/**
 * Node-authoritative elevation with endpoint-clamped centreline smoothing.
 *
 * Order of operations is the whole point of this file (04-RESEARCH.md
 * "Pattern 3: Endpoint-clamped elevation smoothing", D-P15):
 *
 *   1. Sample once per NODE at that node's lat/lon. This value is
 *      authoritative and is NEVER smoothed — every edge touching a node
 *      shares its exact `y`, so junction continuity holds by construction
 *      rather than by agreement between two independent smoothing passes.
 *   2. For each edge, sample the raw DEM at every interior centreline point.
 *   3. Smooth the interior sequence with a windowed moving average
 *      (`SMOOTHING_WINDOW`, shrinking symmetrically near the ends), THEN
 *      overwrite the first and last entries with the `from`/`to` nodes'
 *      authoritative `y`. The clamp is applied AFTER smoothing, never
 *      before, so no smoothing window can pull a junction off its node
 *      height (schema design decision 1; the exact invariant
 *      `tests/road-graph-schema.test.ts` already enforces on the fixture).
 *   4. Recompute `lengthM` as the real 3D polyline length now that `y` is
 *      real — the flat-`y` value from plan 04-04 understates a hilly edge's
 *      length, and `lengthM` feeds pathfinding cost (Phase 5) and AI target
 *      speed (Phase 7).
 *
 * Layering: pure data transform over `RoadGraph` + a `sources/dem.ts`
 * `ElevationSampler` + a `graph/project.ts` `Projector` — no `node:fs`, no
 * network, no `three`, no Rapier. NOT mechanically enforced —
 * `tests/layering.test.ts` does not scan `tools/**`; this file's own
 * discipline is the only guard.
 */
import type { RoadGraph, RoadGraphEdge, RoadGraphNode } from "../../../src/core/road-graph.ts";
import type { ElevationSampler } from "../sources/dem.ts";
import type { Projector } from "./project.ts";

/**
 * [ASSUMED] Interior centreline smoothing window, in point count, applied as
 * a moving average that shrinks symmetrically near each edge's ends. This is
 * a reasoned default, not yet feel-confirmed — plan 04-10's tuning session
 * owns retuning it. Raising it flattens real crests, working AGAINST D-09's
 * "real rolling elevation, not flat ground"; lowering it reintroduces the 1m
 * DEM's per-pixel noise as visible judder, working AGAINST SC1's "no bumpy
 * junctions/roads". The two failure modes bracket this value from both
 * sides, which is why it is a named, documented constant rather than an
 * inline literal.
 */
export const SMOOTHING_WINDOW = 5;

/**
 * Above this per-edge maximum gradient (rise / horizontal run), a road is
 * steeper than any public road in rural Georgia (roughly 19 degrees) — a
 * strong signal the DEM is misaligned with the road network rather than
 * that the terrain is genuinely this dramatic. Reported, not thrown: a
 * human should look at the named edge, not have the build fail outright.
 */
export const GRADIENT_WARNING_THRESHOLD = 0.35;

export interface EdgeGradientReportEntry {
  readonly edgeId: number;
  readonly maxGradient: number;
}

export interface ElevationReport {
  readonly minNodeElevationM: number;
  readonly maxNodeElevationM: number;
  readonly reliefM: number;
  /** One entry per edge, in edge id order. */
  readonly edgeGradients: readonly EdgeGradientReportEntry[];
  /** Subset of `edgeGradients` whose `maxGradient` exceeds `GRADIENT_WARNING_THRESHOLD`. */
  readonly steepEdges: readonly EdgeGradientReportEntry[];
}

/** Cumulative arc length (metres, over X/Z only) at every point, `arcLength[0] === 0`. */
function cumulativeArcLengthXZ(points: readonly (readonly [number, number, number])[]): number[] {
  const arcLength = new Array<number>(points.length);
  arcLength[0] = 0;
  for (let i = 1; i < points.length; i++) {
    const dx = points[i][0] - points[i - 1][0];
    const dz = points[i][2] - points[i - 1][2];
    arcLength[i] = arcLength[i - 1] + Math.sqrt(dx * dx + dz * dz);
  }
  return arcLength;
}

/**
 * Averages `values[i]` over every point within `radiusM` of point `i`'s OWN
 * arc-length position — a distance-based window, not a point-COUNT window.
 *
 * [Rule 1 fix, found compiling the real Juliette artifact] Real OSM way
 * geometry routinely mixes densely- and sparsely-spaced vertices within a
 * single edge (extra vertices captured on a curve near a junction, few on a
 * long straight stretch after it). A point-COUNT window on such geometry
 * averages together points that are close in ARRAY INDEX but far apart in
 * real distance, which silently reintroduces a sharp local artifact — the
 * exact failure mode this smoothing pass exists to prevent. This was caught
 * empirically on the real compiled output (edge id=36, osmWayId=446581088):
 * three vertices spaced ~7m apart near a junction, immediately followed by
 * vertices 50-150m apart, produced a smoothed-Y gradient of 0.566 between
 * two points only 7.5m apart on the ground — steeper than any real road,
 * and above this plan's own 0.5 hard ceiling. A distance-based window
 * degrades gracefully on uneven spacing: near a cluster of close vertices it
 * behaves like the intended point-count window; near a lone sparse vertex it
 * naturally shrinks to just that vertex, rather than reaching across 100+
 * metres to points with no real bearing on the local terrain.
 */
function arcLengthMovingAverage(
  values: readonly number[],
  arcLength: readonly number[],
  radiusM: number,
): number[] {
  const n = values.length;
  const out = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    let sum = 0;
    let count = 0;
    for (let j = 0; j < n; j++) {
      if (Math.abs(arcLength[j] - arcLength[i]) <= radiusM) {
        sum += values[j];
        count++;
      }
    }
    out[i] = sum / count;
  }
  return out;
}

/**
 * Smooths `rawY` (one raw DEM sample per centreline point, in order) and
 * then clamps both ends to the node-authoritative `fromY`/`toY` — the clamp
 * happens AFTER smoothing, per this file's header comment.
 *
 * The point-count `window` is converted to an equivalent arc-length radius
 * using THIS edge's own nominal (mean) point spacing — `halfWindow *
 * nominalSpacingM` — so behaviour is identical to a plain point-count window
 * on evenly-spaced points (the common case, and every case this plan's own
 * synthetic tests exercise), while degrading gracefully on the unevenly-
 * spaced real-world geometry `arcLengthMovingAverage`'s own comment
 * documents.
 */
function smoothEdgeElevation(
  rawY: readonly number[],
  points: readonly (readonly [number, number, number])[],
  fromY: number,
  toY: number,
  window: number,
): number[] {
  const halfWindow = Math.floor(window / 2);
  const n = rawY.length;
  const arcLength = cumulativeArcLengthXZ(points);
  const totalArcLength = arcLength[arcLength.length - 1];
  const nominalSpacingM = n > 1 ? totalArcLength / (n - 1) : 0;
  const radiusM = halfWindow * nominalSpacingM;

  const smoothed = radiusM > 0 ? arcLengthMovingAverage(rawY, arcLength, radiusM) : rawY.slice();
  smoothed[0] = fromY;
  smoothed[smoothed.length - 1] = toY;
  return smoothed;
}

/** Real 3D polyline length — replaces plan 04-04's flat-`y` length now that `y` is real. */
function polylineLength3D(points: readonly (readonly [number, number, number])[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    const dx = points[i][0] - points[i - 1][0];
    const dy = points[i][1] - points[i - 1][1];
    const dz = points[i][2] - points[i - 1][2];
    total += Math.sqrt(dx * dx + dy * dy + dz * dz);
  }
  return total;
}

/** Maximum |rise| / horizontal-run across every segment of `points`. Segments with zero horizontal run (should not occur on a real road) are skipped rather than producing `Infinity`. */
function computeMaxGradient(points: readonly (readonly [number, number, number])[]): number {
  let maxGradient = 0;
  for (let i = 1; i < points.length; i++) {
    const dx = points[i][0] - points[i - 1][0];
    const dz = points[i][2] - points[i - 1][2];
    const dy = points[i][1] - points[i - 1][1];
    const runXZ = Math.sqrt(dx * dx + dz * dz);
    if (runXZ > 0) {
      const gradient = Math.abs(dy) / runXZ;
      if (gradient > maxGradient) maxGradient = gradient;
    }
  }
  return maxGradient;
}

/**
 * Applies real elevation to `graph`: samples every node once (authoritative,
 * never smoothed), samples and smooths every edge's interior centreline
 * points (endpoints clamped to node heights after smoothing), and
 * recomputes `lengthM`. Returns a NEW graph — `graph` itself, and every
 * array/object reachable from it, is left untouched.
 */
export function applyElevation(
  graph: RoadGraph,
  sampler: ElevationSampler,
  projector: Projector,
): { readonly graph: RoadGraph; readonly report: ElevationReport } {
  const nodeYById = new Map<number, number>();
  const nodes: RoadGraphNode[] = graph.nodes.map((node) => {
    const { lat, lon } = projector.unproject(node.x, node.z);
    const y = sampler.sample(lat, lon);
    nodeYById.set(node.id, y);
    return { ...node, y };
  });

  const edgeGradients: EdgeGradientReportEntry[] = [];
  const steepEdges: EdgeGradientReportEntry[] = [];

  const edges: RoadGraphEdge[] = graph.edges.map((edge) => {
    const fromY = nodeYById.get(edge.from);
    const toY = nodeYById.get(edge.to);
    if (fromY === undefined || toY === undefined) {
      throw new Error(
        `applyElevation: edge id=${edge.id} references node id(s) not present in the graph's own nodes[]`,
      );
    }

    const rawY = edge.points.map((point) => {
      const { lat, lon } = projector.unproject(point[0], point[2]);
      return sampler.sample(lat, lon);
    });

    const smoothedY = smoothEdgeElevation(rawY, edge.points, fromY, toY, SMOOTHING_WINDOW);
    const points = edge.points.map((point, i) => [point[0], smoothedY[i], point[2]] as const);
    const lengthM = polylineLength3D(points);
    const maxGradient = computeMaxGradient(points);

    edgeGradients.push({ edgeId: edge.id, maxGradient });
    if (maxGradient > GRADIENT_WARNING_THRESHOLD) {
      steepEdges.push({ edgeId: edge.id, maxGradient });
    }

    return { ...edge, points, lengthM };
  });

  let minNodeElevationM = Number.POSITIVE_INFINITY;
  let maxNodeElevationM = Number.NEGATIVE_INFINITY;
  for (const node of nodes) {
    if (node.y < minNodeElevationM) minNodeElevationM = node.y;
    if (node.y > maxNodeElevationM) maxNodeElevationM = node.y;
  }
  if (nodes.length === 0) {
    minNodeElevationM = 0;
    maxNodeElevationM = 0;
  }

  const newGraph: RoadGraph = { ...graph, nodes, edges };

  const report: ElevationReport = {
    minNodeElevationM,
    maxNodeElevationM,
    reliefM: maxNodeElevationM - minNodeElevationM,
    edgeGradients,
    steepEdges,
  };

  return { graph: newGraph, report };
}
