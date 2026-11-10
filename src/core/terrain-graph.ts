/**
 * Pure road-graph editing for the terrain road brush (plan 04.2-08).
 *
 * Every operation takes a `GraphEditState` and returns a NEW state; the input
 * graph is never mutated. The output is the unchanged road-graph v1 schema
 * (D-16), so `parseRoadGraph`, `validateGraph`, pathfinding, the minimap and
 * route code consume it with no changes (SC-4).
 *
 * Id rules:
 * - EDGE ids are stable and never reused (D-16). `GraphEditState.nextEdgeId`
 *   is a monotonic counter persisted in the sidecar; it never decreases, not
 *   even when edges are erased. When an edge is split, its FIRST half keeps
 *   the original id and the other halves take fresh ids, so a route that
 *   references a split edge's id still starts on valid road.
 * - NODE ids are dense 0..n-1 (schema rule enforced by `parseRoadGraph`).
 *   `addRoadStroke` only ever APPENDS nodes, so existing node ids never
 *   change on add. Node ids may be compacted only by an erase (or by the
 *   `replace` mode of `addRoadStroke`, which removes roads), through
 *   `compactNodes`, which remaps edges and spawns.
 *
 * `graph.bounds` is never modified by any operation here: sculpted areas keep
 * the grid extent written at Create (plan 12) and converted areas keep their
 * compiled bounds.
 *
 * Junctions (D-13): a stroke that crosses or touches an existing road splits
 * both edges at one shared node (`junction` = degree >= 3); a stroke ending in
 * open ground is a dead end. `findStrokeCrossings` and `addRoadStroke` share a
 * single planning function, so the x/z reported to plan 09 for height pinning
 * are exactly the x/z of the nodes `addRoadStroke` creates or reuses.
 *
 * Pure by construction: no renderer, no physics engine, no DOM, no wall clock.
 * `tests/layering.test.ts` mechanically enforces this for every file under
 * `src/core/`.
 */
import { yawFromTravelDirection } from "./heading.ts";
import type { RoadGraph, RoadGraphEdge, RoadGraphNode, RoadGraphSpawn } from "./road-graph.ts";
import type { SurfaceType } from "./surface-types.ts";

type P3 = readonly [number, number, number];

/** Points closer than this in XZ (metres) are the same point. */
const MERGE_EPS = 1e-6;
/** Replace mode removes an existing edge when this much of its length lies under the new stroke. */
const REPLACE_OVERLAP_FRACTION = 0.8;
/** Spacing (metres) of the samples used to measure overlap in replace mode. */
const OVERLAP_SAMPLE_STEP_M = 0.5;
const OVERLAP_SAMPLE_CAP = 4000;

export interface RoadProfile {
  readonly roadClass: string;
  readonly lanes: number;
  readonly widthM: number;
  readonly surface: SurfaceType;
  readonly speedLimitKph: number;
  readonly oneway: boolean;
}

export interface GraphEditState {
  readonly graph: RoadGraph;
  /** Monotonic edge id counter; never decreases, never reused (D-16). */
  readonly nextEdgeId: number;
}

export type StrokeJoin =
  | {
      readonly kind: "cross";
      readonly x: number;
      readonly z: number;
      readonly edgeId: number;
      readonly distanceAlongStroke: number;
    }
  | {
      readonly kind: "snap-edge";
      readonly x: number;
      readonly z: number;
      readonly edgeId: number;
      readonly endpoint: "start" | "end";
      readonly distanceAlongStroke: number;
    }
  | {
      readonly kind: "snap-node";
      readonly x: number;
      readonly z: number;
      readonly nodeId: number;
      /** "through" = an interior stroke point passes exactly over an existing node. */
      readonly endpoint: "start" | "end" | "through";
      readonly distanceAlongStroke: number;
    };

export interface StrokeOptions {
  /** Snap distance override (metres). Default: max(stroke half-width, existing edge half-width). */
  readonly snapM?: number;
  /** D-15: remove existing edges lying under the stroke over >= 80% of their own length. */
  readonly replace?: boolean;
}

export interface AddStrokeResult {
  readonly state: GraphEditState;
  readonly newEdgeIds: number[];
  readonly junctionNodeIds: number[];
  /** Split pieces that took a fresh edge id, with the edge they were cut from (lock inheritance). */
  readonly splitFrom: readonly { id: number; parentId: number }[];
  /** Set (and `state` is the unchanged input) when the stroke was rejected. */
  readonly reason?: string;
}

export interface EraseResult {
  readonly state: GraphEditState;
  /** Edges that were deleted outright (no portion of them survives). */
  readonly removedEdgeIds: number[];
  /** Split pieces that took a fresh edge id, with the edge they were cut from (lock inheritance). */
  readonly splitFrom: readonly { id: number; parentId: number }[];
  readonly spawnLost: boolean;
}

// ---------------------------------------------------------------- geometry

function dist3D(a: P3, b: P3): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

function distXZ(ax: number, az: number, bx: number, bz: number): number {
  return Math.hypot(ax - bx, az - bz);
}

function polylineLength3D(points: readonly P3[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) total += dist3D(points[i - 1], points[i]);
  return total;
}

function lerp3(a: P3, b: P3, t: number): P3 {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

function cumulative3D(points: readonly P3[]): number[] {
  const cum = [0];
  for (let i = 1; i < points.length; i++) cum.push(cum[i - 1] + dist3D(points[i - 1], points[i]));
  return cum;
}

/** Closest point of the XZ segment a-b to (px, pz): parameter u in [0, 1] and distance. */
function projectOnSegmentXZ(
  px: number,
  pz: number,
  a: P3,
  b: P3,
): { readonly u: number; readonly d: number } {
  const dx = b[0] - a[0];
  const dz = b[2] - a[2];
  const len2 = dx * dx + dz * dz;
  let u = len2 > 0 ? ((px - a[0]) * dx + (pz - a[2]) * dz) / len2 : 0;
  u = Math.max(0, Math.min(1, u));
  return { u, d: distXZ(px, pz, a[0] + dx * u, a[2] + dz * u) };
}

function distToPolylineXZ(px: number, pz: number, poly: readonly P3[]): number {
  let best = Number.POSITIVE_INFINITY;
  for (let i = 1; i < poly.length; i++) {
    const { d } = projectOnSegmentXZ(px, pz, poly[i - 1], poly[i]);
    if (d < best) best = d;
  }
  return best;
}

/**
 * A split position on an edge polyline: between vertex k and k+1 at fraction
 * u, normalised so a hit within MERGE_EPS of a vertex becomes (vertex, 0).
 * Returns null when the position is the edge's own end (that is a node join).
 */
function normalizeSplit(
  pts: readonly P3[],
  k: number,
  u: number,
): { readonly k: number; readonly u: number } | null {
  const a = pts[k];
  const b = pts[k + 1];
  const len = distXZ(a[0], a[2], b[0], b[2]);
  let kk = k;
  let uu = u;
  if (u * len < MERGE_EPS) {
    uu = 0;
  } else if ((1 - u) * len < MERGE_EPS) {
    kk = k + 1;
    uu = 0;
  } else {
    return { k, u };
  }
  if (kk <= 0 || kk >= pts.length - 1) return null;
  return { k: kk, u: uu };
}

function pointOnEdge(pts: readonly P3[], k: number, u: number): P3 {
  return u === 0 ? pts[k] : lerp3(pts[k], pts[k + 1], u);
}

// ---------------------------------------------------------------- planning

interface PlannedJoin {
  readonly kind: "cross" | "snap-edge" | "snap-node";
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly distance: number;
  readonly endpoint?: "start" | "end" | "through";
  readonly edgeId?: number;
  readonly splitK?: number;
  readonly splitU?: number;
  readonly nodeId?: number;
}

interface StrokePlan {
  readonly poly: P3[];
  readonly cum: number[];
  readonly joins: PlannedJoin[];
}

function cleanPolyline(polyline: readonly P3[]): P3[] | null {
  const out: P3[] = [];
  for (const p of polyline) {
    if (!Array.isArray(p) || p.length !== 3 || p.some((c) => !Number.isFinite(c))) return null;
    const last = out[out.length - 1];
    if (last !== undefined && distXZ(last[0], last[2], p[0], p[2]) < MERGE_EPS) continue;
    out.push([p[0], p[1], p[2]]);
  }
  return out.length >= 2 ? out : null;
}

/** The single join-planning routine shared by findStrokeCrossings and addRoadStroke. */
function planStroke(
  graph: RoadGraph,
  removed: ReadonlySet<number>,
  poly0: readonly P3[],
  halfWidth: number,
  snapOverride: number | undefined,
): StrokePlan {
  const edges = graph.edges.filter((e) => !removed.has(e.id));
  const maxHalfAt = new Map<number, number>();
  for (const e of edges) {
    const h = e.widthM / 2;
    for (const id of [e.from, e.to]) maxHalfAt.set(id, Math.max(maxHalfAt.get(id) ?? 0, h));
  }
  const liveNodes = graph.nodes.filter((n) => maxHalfAt.has(n.id));

  const poly: P3[] = poly0.map((p) => [p[0], p[1], p[2]]);
  const raw: PlannedJoin[] = [];
  const taken = (x: number, z: number): boolean =>
    raw.some((j) => distXZ(j.x, j.z, x, z) < MERGE_EPS);

  // Stroke ends: snap to a node first, else onto an edge interior.
  for (const endpoint of ["start", "end"] as const) {
    const idx = endpoint === "start" ? 0 : poly.length - 1;
    const p = poly[idx];
    let bestNode: RoadGraphNode | null = null;
    let bestD = Number.POSITIVE_INFINITY;
    for (const n of liveNodes) {
      const snap = snapOverride ?? Math.max(halfWidth, maxHalfAt.get(n.id) ?? 0);
      const d = distXZ(p[0], p[2], n.x, n.z);
      if (d <= snap && d < bestD) {
        bestD = d;
        bestNode = n;
      }
    }
    if (bestNode !== null) {
      poly[idx] = [bestNode.x, bestNode.y, bestNode.z];
      raw.push({
        kind: "snap-node",
        x: bestNode.x,
        y: bestNode.y,
        z: bestNode.z,
        distance: 0,
        endpoint,
        nodeId: bestNode.id,
      });
      continue;
    }
    let best: { e: RoadGraphEdge; k: number; u: number } | null = null;
    bestD = Number.POSITIVE_INFINITY;
    for (const e of edges) {
      const snap = snapOverride ?? Math.max(halfWidth, e.widthM / 2);
      for (let k = 0; k + 1 < e.points.length; k++) {
        const { u, d } = projectOnSegmentXZ(p[0], p[2], e.points[k], e.points[k + 1]);
        if (d <= snap && d < bestD && normalizeSplit(e.points, k, u) !== null) {
          bestD = d;
          best = { e, k, u };
        }
      }
    }
    if (best !== null) {
      const split = normalizeSplit(best.e.points, best.k, best.u);
      if (split !== null) {
        const q = pointOnEdge(best.e.points, split.k, split.u);
        const y = (p[1] + q[1]) / 2;
        poly[idx] = [q[0], y, q[2]];
        raw.push({
          kind: "snap-edge",
          x: q[0],
          y,
          z: q[2],
          distance: 0,
          endpoint,
          edgeId: best.e.id,
          splitK: split.k,
          splitU: split.u,
        });
      }
    }
  }

  const cum = cumulative3D(poly);

  // Interior crossings: stroke segments against every existing edge segment.
  for (let i = 0; i + 1 < poly.length; i++) {
    const a = poly[i];
    const b = poly[i + 1];
    const rx = b[0] - a[0];
    const rz = b[2] - a[2];
    const minX = Math.min(a[0], b[0]);
    const maxX = Math.max(a[0], b[0]);
    const minZ = Math.min(a[2], b[2]);
    const maxZ = Math.max(a[2], b[2]);
    for (const e of edges) {
      for (let k = 0; k + 1 < e.points.length; k++) {
        const c = e.points[k];
        const d = e.points[k + 1];
        if (
          Math.max(c[0], d[0]) < minX - MERGE_EPS ||
          Math.min(c[0], d[0]) > maxX + MERGE_EPS ||
          Math.max(c[2], d[2]) < minZ - MERGE_EPS ||
          Math.min(c[2], d[2]) > maxZ + MERGE_EPS
        ) {
          continue;
        }
        const sx = d[0] - c[0];
        const sz = d[2] - c[2];
        const denom = rx * sz - rz * sx;
        if (Math.abs(denom) < 1e-12) continue;
        const qx = c[0] - a[0];
        const qz = c[2] - a[2];
        const t = (qx * sz - qz * sx) / denom;
        const s = (qx * rz - qz * rx) / denom;
        const tol = 1e-9;
        if (t < -tol || t > 1 + tol || s < -tol || s > 1 + tol) continue;
        const tc = Math.max(0, Math.min(1, t));
        const sc = Math.max(0, Math.min(1, s));
        const x = a[0] + rx * tc;
        const z = a[2] + rz * tc;
        const segLen = cum[i + 1] - cum[i];
        const distance = cum[i] + tc * segLen;
        const strokeY = a[1] + (b[1] - a[1]) * tc;

        // Passing exactly over an existing node: reuse it instead of splitting.
        const node = liveNodes.find((n) => distXZ(n.x, n.z, x, z) < MERGE_EPS);
        if (node !== undefined) {
          if (!taken(node.x, node.z)) {
            raw.push({
              kind: "snap-node",
              x: node.x,
              y: node.y,
              z: node.z,
              distance,
              endpoint: "through",
              nodeId: node.id,
            });
          }
          continue;
        }
        const split = normalizeSplit(e.points, k, sc);
        if (split === null) continue;
        const q = pointOnEdge(e.points, split.k, split.u);
        if (taken(q[0], q[2]) || taken(x, z)) continue;
        // Report the location on the stroke line; the edge point agrees to float noise.
        raw.push({
          kind: "cross",
          x,
          y: (strokeY + q[1]) / 2,
          z,
          distance,
          edgeId: e.id,
          splitK: split.k,
          splitU: split.u,
        });
      }
    }
  }

  const total = cum[cum.length - 1];
  const joins = raw
    .map((j) => (j.endpoint === "end" ? { ...j, distance: total } : j))
    .sort((p, q) => p.distance - q.distance);
  return { poly, cum, joins };
}

function toStrokeJoin(j: PlannedJoin): StrokeJoin {
  if (j.kind === "snap-node") {
    return {
      kind: "snap-node",
      x: j.x,
      z: j.z,
      nodeId: j.nodeId as number,
      endpoint: j.endpoint as "start" | "end" | "through",
      distanceAlongStroke: j.distance,
    };
  }
  if (j.kind === "snap-edge") {
    return {
      kind: "snap-edge",
      x: j.x,
      z: j.z,
      edgeId: j.edgeId as number,
      endpoint: j.endpoint as "start" | "end",
      distanceAlongStroke: j.distance,
    };
  }
  return {
    kind: "cross",
    x: j.x,
    z: j.z,
    edgeId: j.edgeId as number,
    distanceAlongStroke: j.distance,
  };
}

/**
 * Every point where `polyline` will join the existing graph, without mutating
 * anything. Uses the same snap rule and planner as `addRoadStroke`, so the
 * reported x/z equal the x/z of the junction node it creates or reuses (D-13).
 * With `opts.replace`, edges that replace mode would remove are ignored (node
 * ids reported are those of the unedited graph).
 */
export function findStrokeCrossings(
  state: GraphEditState,
  polyline: readonly P3[],
  halfWidthM: number,
  opts?: StrokeOptions,
): StrokeJoin[] {
  const poly = cleanPolyline(polyline);
  if (poly === null) return [];
  const removed =
    opts?.replace === true ? findReplacedEdges(state.graph, poly, halfWidthM) : new Set<number>();
  return planStroke(state.graph, removed, poly, halfWidthM, opts?.snapM).joins.map(toStrokeJoin);
}

// ---------------------------------------------------------------- replace

function findReplacedEdges(graph: RoadGraph, stroke: readonly P3[], half: number): Set<number> {
  const removed = new Set<number>();
  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minZ = Number.POSITIVE_INFINITY;
  let maxZ = Number.NEGATIVE_INFINITY;
  for (const p of stroke) {
    minX = Math.min(minX, p[0]);
    maxX = Math.max(maxX, p[0]);
    minZ = Math.min(minZ, p[2]);
    maxZ = Math.max(maxZ, p[2]);
  }
  for (const e of graph.edges) {
    let eMinX = Number.POSITIVE_INFINITY;
    let eMaxX = Number.NEGATIVE_INFINITY;
    let eMinZ = Number.POSITIVE_INFINITY;
    let eMaxZ = Number.NEGATIVE_INFINITY;
    for (const p of e.points) {
      eMinX = Math.min(eMinX, p[0]);
      eMaxX = Math.max(eMaxX, p[0]);
      eMinZ = Math.min(eMinZ, p[2]);
      eMaxZ = Math.max(eMaxZ, p[2]);
    }
    if (eMaxX < minX - half || eMinX > maxX + half || eMaxZ < minZ - half || eMinZ > maxZ + half) {
      continue;
    }
    let inside = 0;
    let total = 0;
    for (let k = 0; k + 1 < e.points.length; k++) {
      const a = e.points[k];
      const b = e.points[k + 1];
      const len = distXZ(a[0], a[2], b[0], b[2]);
      const n = Math.max(1, Math.min(OVERLAP_SAMPLE_CAP, Math.ceil(len / OVERLAP_SAMPLE_STEP_M)));
      for (let s = 0; s < n; s++) {
        const t = (s + 0.5) / n;
        const x = a[0] + (b[0] - a[0]) * t;
        const z = a[2] + (b[2] - a[2]) * t;
        total += len / n;
        if (distToPolylineXZ(x, z, stroke) <= half) inside += len / n;
      }
    }
    if (total > 0 && inside / total >= REPLACE_OVERLAP_FRACTION) removed.add(e.id);
  }
  return removed;
}

// ---------------------------------------------------------------- compaction

function nodeDegrees(graph: RoadGraph): Map<number, number> {
  const deg = new Map<number, number>();
  for (const e of graph.edges) {
    deg.set(e.from, (deg.get(e.from) ?? 0) + 1);
    deg.set(e.to, (deg.get(e.to) ?? 0) + 1);
  }
  return deg;
}

/** Travel heading (yaw) leaving `nodeId` along its first incident edge; 0 if it has none. */
function headingAlongFirstEdge(graph: RoadGraph, nodeId: number): number {
  for (const e of graph.edges) {
    const m = e.points.length;
    if (e.from === nodeId) {
      return yawFromTravelDirection(
        e.points[1][0] - e.points[0][0],
        e.points[1][2] - e.points[0][2],
      );
    }
    if (e.to === nodeId) {
      return yawFromTravelDirection(
        e.points[m - 2][0] - e.points[m - 1][0],
        e.points[m - 2][2] - e.points[m - 1][2],
      );
    }
  }
  return 0;
}

interface CompactResult {
  readonly graph: RoadGraph;
  /** old node id -> new node id for every surviving node. */
  readonly idMap: ReadonlyMap<number, number>;
  readonly spawnLost: boolean;
}

function compactInternal(graph: RoadGraph): CompactResult {
  const deg = nodeDegrees(graph);
  if (graph.nodes.every((n) => (deg.get(n.id) ?? 0) > 0)) {
    return { graph, idMap: new Map(graph.nodes.map((n) => [n.id, n.id])), spawnLost: false };
  }
  const kept = graph.nodes.filter((n) => (deg.get(n.id) ?? 0) > 0);
  const idMap = new Map<number, number>();
  const nodes: RoadGraphNode[] = kept.map((n, i) => {
    idMap.set(n.id, i);
    return { ...n, id: i };
  });
  const edges: RoadGraphEdge[] = graph.edges.map((e) => ({
    ...e,
    from: idMap.get(e.from) as number,
    to: idMap.get(e.to) as number,
  }));
  const remapped: RoadGraph = { ...graph, nodes, edges };

  let spawnLost = false;
  let spawns: RoadGraphSpawn[] | undefined;
  if (graph.spawns !== undefined) {
    spawns = [];
    for (const sp of graph.spawns) {
      const mapped = idMap.get(sp.nodeId);
      if (mapped !== undefined) {
        spawns.push({ ...sp, nodeId: mapped });
        continue;
      }
      const old = graph.nodes.find((n) => n.id === sp.nodeId);
      let nearest: RoadGraphNode | null = null;
      let bestD = Number.POSITIVE_INFINITY;
      for (const n of nodes) {
        const d = old === undefined ? 0 : distXZ(old.x, old.z, n.x, n.z);
        if (d < bestD) {
          bestD = d;
          nearest = n;
        }
      }
      if (nearest === null) {
        spawnLost = true;
        continue;
      }
      spawns.push({
        id: sp.id,
        nodeId: nearest.id,
        headingRad: headingAlongFirstEdge(remapped, nearest.id),
      });
    }
  }
  const out: RoadGraph = spawns !== undefined ? { ...remapped, spawns } : remapped;
  return { graph: out, idMap, spawnLost };
}

/**
 * Drops nodes no edge references and renumbers the rest densely 0..n-1,
 * remapping edge from/to and spawn nodeIds (a spawn on a dropped node moves to
 * the nearest surviving node). Returns the input unchanged (same object) when
 * every node is already referenced. Called by erase and replace only, never
 * by a plain add (node ids stay stable on add).
 */
export function compactNodes(graph: RoadGraph): RoadGraph {
  return compactInternal(graph).graph;
}

function withJunctionFlags(
  nodes: RoadGraphNode[],
  edges: readonly RoadGraphEdge[],
  touched: ReadonlySet<number>,
): void {
  const deg = new Map<number, number>();
  for (const e of edges) {
    deg.set(e.from, (deg.get(e.from) ?? 0) + 1);
    deg.set(e.to, (deg.get(e.to) ?? 0) + 1);
  }
  for (const id of touched) {
    const n = nodes[id];
    const junction = (deg.get(id) ?? 0) >= 3;
    if (n !== undefined && n.junction !== junction) nodes[id] = { ...n, junction };
  }
}

// ---------------------------------------------------------------- add

interface Stop {
  readonly nodeId: number;
  readonly distance: number;
}

export function addRoadStroke(
  state: GraphEditState,
  polyline: readonly P3[],
  profile: RoadProfile,
  opts?: StrokeOptions,
): AddStrokeResult {
  const reject = (reason: string): AddStrokeResult => ({
    state,
    newEdgeIds: [],
    junctionNodeIds: [],
    splitFrom: [],
    reason,
  });
  const poly0 = cleanPolyline(polyline);
  if (poly0 === null) {
    return reject("stroke needs at least 2 distinct finite points");
  }
  const half = profile.widthM / 2;
  const graph = state.graph;
  const removed =
    opts?.replace === true ? findReplacedEdges(graph, poly0, half) : new Set<number>();
  const plan = planStroke(graph, removed, poly0, half, opts?.snapM);
  const { poly, cum, joins } = plan;

  let nextEdgeId = state.nextEdgeId;
  const nodes: RoadGraphNode[] = graph.nodes.slice();
  const touched = new Set<number>();
  const newNode = (x: number, y: number, z: number): number => {
    const id = nodes.length;
    nodes.push({ id, x, y, z, junction: false, osmNodeId: 0 });
    touched.add(id);
    return id;
  };

  // Resolve each join to a node id (creating junction nodes), in stroke order.
  interface Split {
    readonly k: number;
    readonly u: number;
    readonly nodeId: number;
    readonly point: P3;
  }
  const splits = new Map<number, Split[]>();
  const junctionNodeIds: number[] = [];
  const resolve = (j: PlannedJoin): number => {
    if (j.kind === "snap-node") {
      touched.add(j.nodeId as number);
      return j.nodeId as number;
    }
    const id = newNode(j.x, j.y, j.z);
    junctionNodeIds.push(id);
    const list = splits.get(j.edgeId as number) ?? [];
    list.push({ k: j.splitK as number, u: j.splitU as number, nodeId: id, point: [j.x, j.y, j.z] });
    splits.set(j.edgeId as number, list);
    return id;
  };

  const startJoin = joins.find((j) => j.endpoint === "start");
  const endJoin = joins.find((j) => j.endpoint === "end");
  const midJoins = joins.filter((j) => j.endpoint !== "start" && j.endpoint !== "end");
  const stops: Stop[] = [];
  stops.push({
    nodeId:
      startJoin !== undefined ? resolve(startJoin) : newNode(poly[0][0], poly[0][1], poly[0][2]),
    distance: 0,
  });
  for (const j of midJoins) stops.push({ nodeId: resolve(j), distance: j.distance });
  const last = poly[poly.length - 1];
  stops.push({
    nodeId: endJoin !== undefined ? resolve(endJoin) : newNode(last[0], last[1], last[2]),
    distance: cum[cum.length - 1],
  });

  // Split existing edges: first piece keeps the id, later pieces take fresh ids.
  const edges: RoadGraphEdge[] = [];
  const splitFrom: { id: number; parentId: number }[] = [];
  for (const e of graph.edges) {
    if (removed.has(e.id)) continue;
    const list = splits.get(e.id);
    if (list === undefined) {
      edges.push(e);
      continue;
    }
    list.sort((a, b) => a.k - b.k || a.u - b.u);
    touched.add(e.from);
    touched.add(e.to);
    const pieces: P3[][] = [];
    const cutNodes: number[] = [];
    let cur: P3[] = [e.points[0]];
    let next = 1;
    for (const s of list) {
      const lastIdx = s.u === 0 ? s.k - 1 : s.k;
      while (next <= lastIdx) cur.push(e.points[next++]);
      cur.push(s.point);
      pieces.push(cur);
      cutNodes.push(s.nodeId);
      cur = [s.point];
      if (s.u === 0) next = s.k + 1;
    }
    while (next < e.points.length) cur.push(e.points[next++]);
    pieces.push(cur);
    pieces.forEach((pts, i) => {
      const pieceId = i === 0 ? e.id : nextEdgeId++;
      if (i > 0) splitFrom.push({ id: pieceId, parentId: e.id });
      edges.push({
        ...e,
        id: pieceId,
        from: i === 0 ? e.from : cutNodes[i - 1],
        to: i === pieces.length - 1 ? e.to : cutNodes[i],
        points: pts,
        lengthM: polylineLength3D(pts),
      });
    });
  }

  // Stroke edges between consecutive stops.
  const newEdgeIds: number[] = [];
  for (let s = 0; s + 1 < stops.length; s++) {
    const a = stops[s];
    const b = stops[s + 1];
    const na = nodes[a.nodeId];
    const nb = nodes[b.nodeId];
    const pts: P3[] = [[na.x, na.y, na.z]];
    for (let i = 0; i < poly.length; i++) {
      if (cum[i] <= a.distance + 1e-9 || cum[i] >= b.distance - 1e-9) continue;
      const prev = pts[pts.length - 1];
      if (distXZ(prev[0], prev[2], poly[i][0], poly[i][2]) < MERGE_EPS) continue;
      pts.push(poly[i]);
    }
    const tail = pts[pts.length - 1];
    if (distXZ(tail[0], tail[2], nb.x, nb.z) >= MERGE_EPS) pts.push([nb.x, nb.y, nb.z]);
    else pts[pts.length - 1] = [nb.x, nb.y, nb.z];
    if (pts.length < 2) continue;
    if (a.nodeId === b.nodeId && pts.length < 3) continue;
    const id = nextEdgeId++;
    newEdgeIds.push(id);
    edges.push({
      id,
      from: a.nodeId,
      to: b.nodeId,
      points: pts,
      lengthM: polylineLength3D(pts),
      surface: profile.surface,
      roadClass: profile.roadClass,
      lanes: profile.lanes,
      widthM: profile.widthM,
      oneway: profile.oneway,
      speedLimitKph: profile.speedLimitKph,
      bridge: false,
      tunnel: false,
      layer: 0,
      osmWayId: 0,
    });
  }

  withJunctionFlags(nodes, edges, touched);
  let out: RoadGraph = { ...graph, nodes, edges };
  let outJunctions = junctionNodeIds;
  if (removed.size > 0) {
    const compact = compactInternal(out);
    out = compact.graph;
    outJunctions = junctionNodeIds
      .map((id) => compact.idMap.get(id))
      .filter((id): id is number => id !== undefined);
  }
  return {
    state: { graph: out, nextEdgeId },
    newEdgeIds,
    junctionNodeIds: outJunctions,
    splitFrom,
  };
}

// ---------------------------------------------------------------- spawn

/** Adds `{ id: "default", nodeId: 0 }` facing along node 0's first edge when absent. */
export function ensureDefaultSpawn(state: GraphEditState): GraphEditState {
  const graph = state.graph;
  if (graph.spawns?.some((s) => s.id === "default")) return state;
  if (graph.nodes.length === 0) return state;
  const spawn: RoadGraphSpawn = {
    id: "default",
    nodeId: graph.nodes[0].id,
    headingRad: headingAlongFirstEdge(graph, graph.nodes[0].id),
  };
  return { ...state, graph: { ...graph, spawns: [...(graph.spawns ?? []), spawn] } };
}

// ---------------------------------------------------------------- erase

/**
 * Inserts the disc-boundary crossing points into a polyline and flags which
 * resulting segments lie outside the disc (kept).
 */
function refineAgainstDisc(
  pts: readonly P3[],
  cx: number,
  cz: number,
  r: number,
): { readonly pts: P3[]; readonly keep: boolean[] } {
  const out: P3[] = [pts[0]];
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    const dx = b[0] - a[0];
    const dz = b[2] - a[2];
    const fx = a[0] - cx;
    const fz = a[2] - cz;
    const A = dx * dx + dz * dz;
    const B = 2 * (fx * dx + fz * dz);
    const C = fx * fx + fz * fz - r * r;
    const disc = B * B - 4 * A * C;
    if (A > 0 && disc > 0) {
      const sq = Math.sqrt(disc);
      const len = Math.sqrt(A);
      for (const t of [(-B - sq) / (2 * A), (-B + sq) / (2 * A)]) {
        if (t * len > MERGE_EPS && (1 - t) * len > MERGE_EPS) out.push(lerp3(a, b, t));
      }
    }
    out.push(b);
  }
  const keep: boolean[] = [];
  for (let i = 0; i + 1 < out.length; i++) {
    const mx = (out[i][0] + out[i + 1][0]) / 2 - cx;
    const mz = (out[i][2] + out[i + 1][2]) / 2 - cz;
    keep.push(mx * mx + mz * mz > r * r);
  }
  return { pts: out, keep };
}

/**
 * Removes the portions of the road graph inside the disc (x, z, radiusM).
 * Split edges: the first surviving piece keeps the original id, later pieces
 * take fresh ids; cut ends become new dead-end nodes. Nodes left with no edge
 * are dropped and ids compacted (D-15).
 */
export function eraseGraphDisc(
  state: GraphEditState,
  x: number,
  z: number,
  radiusM: number,
): EraseResult {
  if (![x, z, radiusM].every(Number.isFinite) || radiusM <= 0) {
    return { state, removedEdgeIds: [], splitFrom: [], spawnLost: false };
  }
  const graph = state.graph;
  const splitFrom: { id: number; parentId: number }[] = [];
  let nextEdgeId = state.nextEdgeId;
  const nodes: RoadGraphNode[] = graph.nodes.slice();
  const edges: RoadGraphEdge[] = [];
  const removedEdgeIds: number[] = [];
  const touched = new Set<number>();
  let changed = false;

  for (const e of graph.edges) {
    const refined = refineAgainstDisc(e.points, x, z, radiusM);
    if (refined.keep.every(Boolean)) {
      edges.push(e);
      continue;
    }
    changed = true;
    touched.add(e.from);
    touched.add(e.to);
    // Maximal runs of kept segments -> [firstVertex, lastVertex].
    const runs: [number, number][] = [];
    for (let i = 0; i < refined.keep.length; i++) {
      if (!refined.keep[i]) continue;
      const open = runs[runs.length - 1];
      if (open !== undefined && open[1] === i) open[1] = i + 1;
      else runs.push([i, i + 1]);
    }
    let pieceIndex = 0;
    const lastVertex = refined.pts.length - 1;
    for (const [s, t] of runs) {
      const pts = refined.pts.slice(s, t + 1);
      const length = polylineLength3D(pts);
      if (length < MERGE_EPS) continue;
      const endNode = (vertex: number, original: number): number => {
        if (original >= 0) return original;
        const p = refined.pts[vertex];
        const id = nodes.length;
        nodes.push({ id, x: p[0], y: p[1], z: p[2], junction: false, osmNodeId: 0 });
        return id;
      };
      const from = endNode(s, s === 0 ? e.from : -1);
      const to = endNode(t, t === lastVertex ? e.to : -1);
      const pieceId = pieceIndex === 0 ? e.id : nextEdgeId++;
      if (pieceIndex > 0) splitFrom.push({ id: pieceId, parentId: e.id });
      edges.push({
        ...e,
        id: pieceId,
        from,
        to,
        points: pts,
        lengthM: length,
      });
      pieceIndex++;
    }
    if (pieceIndex === 0) removedEdgeIds.push(e.id);
  }

  if (!changed) return { state, removedEdgeIds: [], splitFrom: [], spawnLost: false };

  withJunctionFlags(nodes, edges, touched);
  const compact = compactInternal({ ...graph, nodes, edges });
  return {
    state: { graph: compact.graph, nextEdgeId },
    removedEdgeIds,
    splitFrom,
    spawnLost: compact.spawnLost,
  };
}
