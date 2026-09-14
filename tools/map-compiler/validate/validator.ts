/**
 * The last gate before a `RoadGraph` becomes a shipped `*.map.json` artifact:
 * proves every road is reachable and pathable (honouring `oneway`), proves
 * the graph is consumable by `ngraph.path` with zero adaptation, and proves
 * the compiled ribbon/junction geometry is free of degenerate points, length
 * drift, excessive gradient and self-overlapping ribbons — all reported by
 * category and by the specific offending node or edge id, never a bare
 * boolean or a bare stack trace (SC5, plan decision D-P17/D-P18).
 *
 * Structured as a list of independent, named check functions (referential
 * integrity, undirected reachability, directed pathability, four geometry
 * checks), each returning its OWN failures with a single `return failures;`
 * at the end of the function body — `validateGraph` below only concatenates
 * their results, it never inspects or short-circuits on an individual
 * check's outcome. This is deliberate: a build that fails on ten edges must
 * report ten, not one at a time across ten rebuilds, and adding a new check
 * later is an addition to the list in `validateGraph`, not an edit to a
 * monolith.
 *
 * The ribbon self-intersection check does not literally test "negative
 * signed area" against a fixed global sign convention (three.js/Rapier
 * winding chirality is a separate, already-settled concern owned by
 * `src/core/road-geometry.ts`'s own header comment, not re-litigated here).
 * Instead it establishes EACH EDGE's own reference winding sign from its
 * first non-degenerate triangle, then flags any later triangle on that same
 * edge whose sign flips relative to that reference — exactly the "quad whose
 * XZ projection folds back on itself" case a clamped miter (D-P10) is
 * supposed to prevent, detected without needing to hard-code which absolute
 * sign is "correct" from above.
 *
 * Layering: build-time only, imported by `tools/map-compiler/cli.ts`. Reads
 * plain `RoadGraph`/`RoadGeometry` data and returns plain data — no `node:fs`,
 * no network, no `three`, no Rapier. NOT mechanically enforced —
 * `tests/layering.test.ts` does not scan `tools/**`; this file's own
 * discipline is the only guard.
 */
import createGraph from "ngraph.graph";
import { aStar } from "ngraph.path";
import type { EdgeGeometryEntry, RoadGeometry } from "../../../src/core/road-geometry.ts";
import type { RoadGraph } from "../../../src/core/road-graph.ts";

/** A 3-tuple of local ENU metres, matching `RoadGraphEdge.points`'s own element shape. */
type Vec3 = readonly [number, number, number];

export type ValidationFailureCategory =
  | "REFERENTIAL_INTEGRITY"
  | "UNDIRECTED_REACHABILITY"
  | "DIRECTED_PATHABILITY"
  | "GEOMETRY_DEGENERATE_POINT"
  | "GEOMETRY_LENGTH_MISMATCH"
  | "GEOMETRY_GRADIENT"
  | "GEOMETRY_SELF_INTERSECTION";

export interface ValidationFailure {
  readonly category: ValidationFailureCategory;
  readonly kind: "node" | "edge";
  /** The offending node or edge id — always present, always the compiler-assigned dense integer id. */
  readonly id: number;
  /** Human-readable detail carrying the concrete numbers involved, never just "invalid". */
  readonly message: string;
}

/**
 * Renders `failures` as one line per entry in a `CATEGORY edge/node <id>:
 * <message>` shape, or the empty string when there are none — the empty
 * string is itself the "this build is clean" signal `cli.ts`'s gate checks
 * for, and what `tests/compiled-map.test.ts` asserts against the real
 * artifact.
 */
export function formatValidationFailures(failures: readonly ValidationFailure[]): string {
  return failures.map((f) => `${f.category} ${f.kind} ${f.id}: ${f.message}`).join("\n");
}

/** Consecutive edge points closer than this (metres) are "identical" for the degenerate-point check — an exact-duplicate tolerance, deliberately much tighter than `src/core/road-geometry.ts`'s own `COLLAPSE_EPS` (1e-4), which exists to smooth near-duplicates rather than flag them. */
const DEGENERATE_POINT_EPS = 1e-9;

/** Above this fractional disagreement between a declared `lengthM` and the polyline's own computed 3D length, the two have drifted enough to be a build-time bug rather than float noise (plan action's own "more than 1%"). */
const LENGTH_MISMATCH_RATIO = 0.01;

/** Above this rise/run ratio (~27 degrees) a road is steeper than any real rural road — the same ceiling `tools/map-compiler/graph/elevation.ts`'s own report treats as a misaligned-DEM signal, enforced here as a hard build failure rather than a printed warning. */
const MAX_GRADIENT = 0.5;

/** Triangle XZ areas below this magnitude are themselves degenerate (already reported by the degenerate-point check) and must not be used to seed or break the self-intersection check's reference sign. */
const TRIANGLE_AREA_EPS = 1e-9;

function dist3D(a: Vec3, b: Vec3): number {
  const dx = a[0] - b[0];
  const dy = a[1] - b[1];
  const dz = a[2] - b[2];
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

function polylineLength3D(points: readonly Vec3[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    total += dist3D(points[i - 1], points[i]);
  }
  return total;
}

/** Maximum |rise| / horizontal-run across every segment. Segments with zero horizontal run are skipped rather than producing `Infinity`, matching `tools/map-compiler/graph/elevation.ts`'s own `computeMaxGradient`. */
function computeMaxGradient(points: readonly Vec3[]): number {
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
 * Check 1 (referential integrity): every `edge.from`/`edge.to` resolves to an
 * existing node; every node is referenced by at least one edge.
 */
function checkReferentialIntegrity(graph: RoadGraph): ValidationFailure[] {
  const failures: ValidationFailure[] = [];
  const nodeIds = new Set(graph.nodes.map((n) => n.id));
  const referencedNodeIds = new Set<number>();

  for (const edge of graph.edges) {
    if (!nodeIds.has(edge.from)) {
      failures.push({
        category: "REFERENTIAL_INTEGRITY",
        kind: "edge",
        id: edge.id,
        message: `references unknown "from" node id ${edge.from}`,
      });
    } else {
      referencedNodeIds.add(edge.from);
    }
    if (!nodeIds.has(edge.to)) {
      failures.push({
        category: "REFERENTIAL_INTEGRITY",
        kind: "edge",
        id: edge.id,
        message: `references unknown "to" node id ${edge.to}`,
      });
    } else {
      referencedNodeIds.add(edge.to);
    }
  }

  for (const node of graph.nodes) {
    if (!referencedNodeIds.has(node.id)) {
      failures.push({
        category: "REFERENTIAL_INTEGRITY",
        kind: "node",
        id: node.id,
        message: "is not referenced by any edge",
      });
    }
  }

  return failures;
}

function buildUndirectedAdjacency(graph: RoadGraph): Map<number, Set<number>> {
  const adjacency = new Map<number, Set<number>>();
  for (const node of graph.nodes) adjacency.set(node.id, new Set());
  for (const edge of graph.edges) {
    adjacency.get(edge.from)?.add(edge.to);
    adjacency.get(edge.to)?.add(edge.from);
  }
  return adjacency;
}

function bfsUndirected(
  adjacency: ReadonlyMap<number, ReadonlySet<number>>,
  rootId: number,
): Set<number> {
  const visited = new Set<number>([rootId]);
  const queue: number[] = [rootId];
  while (queue.length > 0) {
    // biome-ignore lint/style/noNonNullAssertion: queue.length > 0 guarantees shift() returns a value
    const current = queue.shift()!;
    for (const neighbor of adjacency.get(current) ?? []) {
      if (!visited.has(neighbor)) {
        visited.add(neighbor);
        queue.push(neighbor);
      }
    }
  }
  return visited;
}

/**
 * Check 2 (undirected reachability): builds an ngraph-shaped adjacency with
 * both directions for every edge regardless of `oneway`, traverses from
 * `graph.nodes[0]`, and reports every unvisited node and every edge touching
 * one — catches an island component a road cannot be reached from at all.
 */
function checkUndirectedReachability(graph: RoadGraph): ValidationFailure[] {
  const failures: ValidationFailure[] = [];
  if (graph.nodes.length === 0) return failures;

  const rootId = graph.nodes[0].id;
  const adjacency = buildUndirectedAdjacency(graph);
  const visited = bfsUndirected(adjacency, rootId);

  for (const node of graph.nodes) {
    if (!visited.has(node.id)) {
      failures.push({
        category: "UNDIRECTED_REACHABILITY",
        kind: "node",
        id: node.id,
        message: `is not reachable (undirected) from root node ${rootId}`,
      });
    }
  }
  for (const edge of graph.edges) {
    if (!visited.has(edge.from) || !visited.has(edge.to)) {
      failures.push({
        category: "UNDIRECTED_REACHABILITY",
        kind: "edge",
        id: edge.id,
        message: `touches a node unreachable (undirected) from root node ${rootId}`,
      });
    }
  }
  return failures;
}

type DirectedGraph = ReturnType<typeof createGraph<undefined, { weight: number }>>;

/** Directed graph honouring `oneway`: one link `from -> to` for a one-way edge, both directions for a two-way edge, weighted by `lengthM` — the exact shape `ngraph.path`'s `aStar` expects. */
function buildDirectedNgraph(graph: RoadGraph): DirectedGraph {
  const g = createGraph<undefined, { weight: number }>();
  for (const node of graph.nodes) g.addNode(node.id);
  for (const edge of graph.edges) {
    g.addLink(edge.from, edge.to, { weight: edge.lengthM });
    if (!edge.oneway) {
      g.addLink(edge.to, edge.from, { weight: edge.lengthM });
    }
  }
  return g;
}

/** The same directed graph with every link reversed — a forward traversal from `root` on THIS graph visits exactly the nodes that can reach `root` in the original graph. */
function buildReversedNgraph(graph: RoadGraph): DirectedGraph {
  const g = createGraph<undefined, { weight: number }>();
  for (const node of graph.nodes) g.addNode(node.id);
  for (const edge of graph.edges) {
    g.addLink(edge.to, edge.from, { weight: edge.lengthM });
    if (!edge.oneway) {
      g.addLink(edge.from, edge.to, { weight: edge.lengthM });
    }
  }
  return g;
}

/** Oriented (outgoing-links-only) BFS from `rootId`, returning visited node ids in VISIT ORDER — the last entry is the node reached at maximum BFS depth, used as the "far" node for the real `aStar` proof below. */
function orientedBfs(g: DirectedGraph, rootId: number): number[] {
  const visited = new Set<number>([rootId]);
  const order: number[] = [rootId];
  const queue: number[] = [rootId];
  while (queue.length > 0) {
    // biome-ignore lint/style/noNonNullAssertion: queue.length > 0 guarantees shift() returns a value
    const current = queue.shift()!;
    g.forEachLinkedNode(
      current,
      (other) => {
        const otherId = other.id as number;
        if (!visited.has(otherId)) {
          visited.add(otherId);
          order.push(otherId);
          queue.push(otherId);
        }
      },
      true,
    );
  }
  return order;
}

/**
 * Check 3 (directed pathability): builds a directed ngraph honouring
 * `oneway`, then runs a forward traversal from node 0 and a backward
 * traversal on the reversed graph from node 0 — linear in edges, and exactly
 * enough to catch "a road you can drive into but never out of" (the
 * oneway-trap case) without the O(n^2) cost of checking every node pair
 * (T-04-23). When both traversals cover the whole graph, additionally runs a
 * real `ngraph.path` `aStar.find` between node 0 and the farthest node the
 * forward traversal reached, proving the emitted graph is consumable by the
 * Phase 5 pathfinder with zero adaptation rather than merely shaped like one.
 */
function checkDirectedPathability(graph: RoadGraph): ValidationFailure[] {
  const failures: ValidationFailure[] = [];
  if (graph.nodes.length === 0) return failures;

  const rootId = graph.nodes[0].id;
  const forwardGraph = buildDirectedNgraph(graph);
  const reversedGraph = buildReversedNgraph(graph);

  const forwardOrder = orientedBfs(forwardGraph, rootId);
  const forwardSet = new Set(forwardOrder);
  const backwardSet = new Set(orientedBfs(reversedGraph, rootId));

  for (const node of graph.nodes) {
    if (!forwardSet.has(node.id)) {
      failures.push({
        category: "DIRECTED_PATHABILITY",
        kind: "node",
        id: node.id,
        message: `cannot be reached (directed, honouring oneway) from root node ${rootId}`,
      });
    }
    if (!backwardSet.has(node.id)) {
      failures.push({
        category: "DIRECTED_PATHABILITY",
        kind: "node",
        id: node.id,
        message:
          `cannot reach root node ${rootId} (directed, honouring oneway) — entered only ` +
          "through a one-way edge with no way back",
      });
    }
  }

  if (failures.length === 0 && forwardOrder.length >= 2) {
    const farNodeId = forwardOrder[forwardOrder.length - 1];
    const pathFinder = aStar(forwardGraph, {
      distance: (_from, _to, link) => link.data.weight,
    });
    const path = pathFinder.find(rootId, farNodeId);
    if (path.length === 0) {
      failures.push({
        category: "DIRECTED_PATHABILITY",
        kind: "node",
        id: farNodeId,
        message:
          `ngraph.path's aStar found no path from root node ${rootId} despite both BFS ` +
          "traversals reporting full coverage — the emitted graph is not cleanly consumable " +
          "by the pathfinder",
      });
    }
  }

  return failures;
}

/**
 * Check 4a (geometry sanity — degenerate points): any two consecutive points
 * on an edge's raw polyline closer than `DEGENERATE_POINT_EPS` apart.
 */
function checkDegeneratePoints(graph: RoadGraph): ValidationFailure[] {
  const failures: ValidationFailure[] = [];
  for (const edge of graph.edges) {
    for (let i = 1; i < edge.points.length; i++) {
      if (dist3D(edge.points[i - 1], edge.points[i]) <= DEGENERATE_POINT_EPS) {
        failures.push({
          category: "GEOMETRY_DEGENERATE_POINT",
          kind: "edge",
          id: edge.id,
          message: `points[${i}] is identical to points[${i - 1}] (degenerate consecutive point)`,
        });
      }
    }
  }
  return failures;
}

/**
 * Check 4b (geometry sanity — length consistency): `edge.lengthM` versus the
 * polyline's own computed 3D length, disagreeing by more than
 * `LENGTH_MISMATCH_RATIO`.
 */
function checkLengthConsistency(graph: RoadGraph): ValidationFailure[] {
  const failures: ValidationFailure[] = [];
  for (const edge of graph.edges) {
    const computed = polylineLength3D(edge.points);
    const denom = Math.max(computed, edge.lengthM, 1e-9);
    const ratio = Math.abs(computed - edge.lengthM) / denom;
    if (ratio > LENGTH_MISMATCH_RATIO) {
      failures.push({
        category: "GEOMETRY_LENGTH_MISMATCH",
        kind: "edge",
        id: edge.id,
        message:
          `declared lengthM=${edge.lengthM} disagrees with the polyline's computed 3D ` +
          `length=${computed.toFixed(3)} by ${(ratio * 100).toFixed(2)}% (over the ` +
          `${(LENGTH_MISMATCH_RATIO * 100).toFixed(0)}% ceiling)`,
      });
    }
  }
  return failures;
}

/**
 * Check 4c (geometry sanity — gradient): the polyline's maximum |rise|/run
 * segment gradient exceeding `MAX_GRADIENT`.
 */
function checkGradient(graph: RoadGraph): ValidationFailure[] {
  const failures: ValidationFailure[] = [];
  for (const edge of graph.edges) {
    const maxGradient = computeMaxGradient(edge.points);
    if (maxGradient > MAX_GRADIENT) {
      failures.push({
        category: "GEOMETRY_GRADIENT",
        kind: "edge",
        id: edge.id,
        message: `maximum gradient ${maxGradient.toFixed(3)} exceeds the ${MAX_GRADIENT} ceiling`,
      });
    }
  }
  return failures;
}

function vertexAt(positions: Float32Array, index: number): Vec3 {
  return [positions[index * 3], positions[index * 3 + 1], positions[index * 3 + 2]];
}

function signedAreaXZ(a: Vec3, b: Vec3, c: Vec3): number {
  return 0.5 * ((b[0] - a[0]) * (c[2] - a[2]) - (c[0] - a[0]) * (b[2] - a[2]));
}

/** One edge's own ribbon self-intersection scan — see this file's header comment for the reference-sign rationale. */
function checkRibbonSelfIntersectionForEdge(edgeGeom: EdgeGeometryEntry): ValidationFailure[] {
  const failures: ValidationFailure[] = [];
  const { positions, indices, edgeId } = edgeGeom;
  const numTriangles = Math.floor(indices.length / 3);

  let referenceSign = 0;
  for (let t = 0; t < numTriangles; t++) {
    const a = vertexAt(positions, indices[t * 3]);
    const b = vertexAt(positions, indices[t * 3 + 1]);
    const c = vertexAt(positions, indices[t * 3 + 2]);
    const area = signedAreaXZ(a, b, c);
    if (Math.abs(area) < TRIANGLE_AREA_EPS) continue;

    const sign = Math.sign(area);
    if (referenceSign === 0) {
      referenceSign = sign;
      continue;
    }
    if (sign !== referenceSign) {
      // Two triangles per segment (buildRibbon's own indexing convention) —
      // integer-divide the triangle index to recover the segment it belongs to.
      const segmentIndex = Math.floor(t / 2);
      failures.push({
        category: "GEOMETRY_SELF_INTERSECTION",
        kind: "edge",
        id: edgeId,
        message:
          `segment ${segmentIndex}'s ribbon triangle winding flips relative to this edge's ` +
          "own established winding — the ribbon folds back on itself",
      });
    }
  }
  return failures;
}

/**
 * Check 4d (geometry sanity — ribbon self-intersection): any quad (pair of
 * triangles) in the compiled ribbon geometry whose XZ projection folds back
 * relative to its own edge's established winding — exactly the fold-back
 * case D-P10's miter clamp is supposed to prevent.
 */
function checkRibbonSelfIntersection(geometry: RoadGeometry): ValidationFailure[] {
  const failures: ValidationFailure[] = [];
  for (const edgeGeom of geometry.edges) {
    failures.push(...checkRibbonSelfIntersectionForEdge(edgeGeom));
  }
  return failures;
}

/**
 * Runs every check and concatenates their failures — never stops at the
 * first, never inspects an individual check's result before running the
 * next. `graph` is validated for topology and raw-polyline geometry sanity;
 * `geometry` (the compiled ribbon/junction output of
 * `src/core/road-geometry.ts`'s `buildRoadGeometry`) is validated for
 * ribbon self-intersection.
 */
export function validateGraph(graph: RoadGraph, geometry: RoadGeometry): ValidationFailure[] {
  return [
    ...checkReferentialIntegrity(graph),
    ...checkUndirectedReachability(graph),
    ...checkDirectedPathability(graph),
    ...checkDegeneratePoints(graph),
    ...checkLengthConsistency(graph),
    ...checkGradient(graph),
    ...checkRibbonSelfIntersection(geometry),
  ];
}
