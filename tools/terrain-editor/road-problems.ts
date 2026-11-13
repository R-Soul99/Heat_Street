/**
 * Road problems list for the terrain editor (phase 07.1, plan 15).
 *
 * Turns validateGraph failures (plus unlocked roads that no longer match the
 * ground) into located, plain-English rows the editor shows in a panel, and
 * holds the two pure graph repairs the panel can offer. No DOM, no three, no
 * fs: safe in vitest.
 *
 * Row text never carries category codes; the code lives in `tip`.
 */
import type { RoadGraph, RoadGraphEdge } from "../../src/core/road-graph.ts";
import type { ValidationFailure } from "../map-compiler/validate/validator.ts";
import { NON_BLOCKING_ON_TERRAIN } from "./save-guard.ts";

export type FixKind =
  | "remove-duplicate-points"
  | "smooth-heights"
  | "regrade"
  | "make-two-way"
  | "connect-ends"
  | "close-loop";

/** One button the panel can offer on a row (07.1-21 wires them up). */
export interface RoadFix {
  readonly kind: FixKind;
  readonly label: string;
  readonly tip: string;
  readonly edgeId: number;
  readonly nodeId?: number;
}

/** Furthest a Connect ends fix will reach to join a cut-off piece to the network (m). */
export const CONNECT_MAX_M = 250;
/** Widest gap a Close loop fix will bridge between a piece's two open ends (m). */
export const CLOSE_LOOP_MAX_M = 150;

export interface RoadProblemRow {
  /** Plain English, no category codes. */
  readonly text: string;
  /** Hover text: what it means plus the technical code. */
  readonly tip: string;
  /** True when this problem stops the map being saved. */
  readonly blocking: boolean;
  /** Present when the panel can repair it with one click. */
  readonly fixKind?: FixKind;
  readonly fixLabel?: string;
  /**
   * Every fix the panel can offer, including the legacy one. New kinds
   * (make-two-way, connect-ends, close-loop) appear ONLY here, never in fixKind.
   */
  readonly fixes?: readonly RoadFix[];
  /** What to do by hand, shown when there is no automatic fix. */
  readonly hint?: string;
  readonly target: { readonly kind: "edge" | "node"; readonly id: number };
  /** World position to fly the camera to. */
  readonly at: { readonly x: number; readonly z: number };
}

/** Gradient the smoothing fix aims for (validator ceiling is 0.5). */
export const SMOOTH_TARGET_GRADIENT = 0.45;

type Pt = readonly [number, number, number];

const GENERIC = { x: 0, z: 0 };

function segmentMid(pts: readonly Pt[], i: number): { x: number; z: number } | null {
  const a = pts[i];
  const b = pts[i + 1];
  if (!a || !b) return null;
  return { x: (a[0] + b[0]) / 2, z: (a[2] + b[2]) / 2 };
}

/** Point half way along the polyline (by horizontal length). */
export function edgeMidpoint(edge: RoadGraphEdge): { x: number; z: number } {
  const pts = edge.points;
  if (pts.length === 0) return GENERIC;
  if (pts.length === 1) return { x: pts[0][0], z: pts[0][2] };
  let total = 0;
  for (let i = 1; i < pts.length; i++) {
    total += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][2] - pts[i - 1][2]);
  }
  let left = total / 2;
  for (let i = 1; i < pts.length; i++) {
    const d = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][2] - pts[i - 1][2]);
    if (left <= d || i === pts.length - 1) {
      const t = d > 1e-9 ? Math.min(1, left / d) : 0;
      return {
        x: pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * t,
        z: pts[i - 1][2] + (pts[i][2] - pts[i - 1][2]) * t,
      };
    }
    left -= d;
  }
  return GENERIC;
}

function steepestSegment(pts: readonly Pt[]): number {
  let best = -1;
  let bestG = -1;
  for (let i = 1; i < pts.length; i++) {
    const run = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][2] - pts[i - 1][2]);
    if (run <= 0) continue;
    const g = Math.abs(pts[i][1] - pts[i - 1][1]) / run;
    if (g > bestG) {
      bestG = g;
      best = i - 1;
    }
  }
  return best;
}

/** Parses "segment N" or "points[N]" from a validator message. */
function messageLocation(edge: RoadGraphEdge, message: string): { x: number; z: number } | null {
  const seg = /segment (\d+)/.exec(message);
  if (seg) return segmentMid(edge.points, Number(seg[1]));
  const pt = /points\[(\d+)\]/.exec(message);
  if (pt) {
    const p = edge.points[Number(pt[1])];
    if (p) return { x: p[0], z: p[2] };
  }
  return null;
}

export interface StaleRoad {
  readonly edgeId: number;
  readonly maxDeltaM: number;
}

const roadName = (id: number): string => `Road ${id}`;
const capitalise = (t: string): string => t.charAt(0).toUpperCase() + t.slice(1);

function joinAnd(items: readonly string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

type RowCore = Pick<RoadProblemRow, "text" | "tip" | "fixKind" | "fixLabel" | "hint">;

/**
 * Builds the panel rows. Blocking rows come first. One row per (problem kind,
 * road/junction); repeats on the same road are counted in the text.
 */
export function buildRoadProblems(
  graph: RoadGraph,
  failures: readonly ValidationFailure[],
  stale: readonly StaleRoad[] = [],
  unlocked: readonly number[] = [],
): RoadProblemRow[] {
  const edgeById = new Map(graph.edges.map((e) => [e.id, e]));
  const nodeById = new Map(graph.nodes.map((n) => [n.id, n]));
  const unlockedSet = new Set(unlocked);
  const pieces = roadPieces(graph);

  const groups = new Map<string, ValidationFailure[]>();
  for (const f of failures) {
    // Connectivity failures are reported per piece / per trapped node below, so
    // a cut-off piece is never listed twice (once per node and edge).
    if (f.category === "UNDIRECTED_REACHABILITY" || f.category === "DIRECTED_PATHABILITY") continue;
    const key = `${f.category}|${f.kind}|${f.id}`;
    const g = groups.get(key);
    if (g) g.push(f);
    else groups.set(key, [f]);
  }

  const rows: RoadProblemRow[] = [];
  for (const list of groups.values()) {
    const f = list[0];
    const edge = f.kind === "edge" ? edgeById.get(f.id) : undefined;
    const node = f.kind === "node" ? nodeById.get(f.id) : undefined;
    const blocking = !NON_BLOCKING_ON_TERRAIN.has(f.category);
    const target = { kind: f.kind === "edge" ? ("edge" as const) : ("node" as const), id: f.id };
    const name = f.kind === "edge" ? roadName(f.id) : capitalise(describeNodeEnds(graph, f.id));
    let at = edge ? edgeMidpoint(edge) : node ? { x: node.x, z: node.z } : GENERIC;
    if (edge) at = messageLocation(edge, f.message) ?? at;
    const code = `Check code: ${f.category}. ${f.message}`;
    const n = list.length;
    let row: RowCore;

    switch (f.category) {
      case "GEOMETRY_DEGENERATE_POINT":
        row = {
          text: `${name} has ${n === 1 ? "two points" : `${n} pairs of points`} sitting on top of each other.`,
          fixKind: "remove-duplicate-points",
          fixLabel: "Remove duplicate points",
          tip: `Duplicate points can make the road fold or drive badly. ${code}`,
        };
        break;
      case "GEOMETRY_GRADIENT": {
        const steep = edge ? steepestSegment(edge.points) : -1;
        if (edge && steep >= 0) at = segmentMid(edge.points, steep) ?? at;
        const isStale = stale.some((s) => s.edgeId === f.id);
        if (edge && unlockedSet.has(f.id) && isStale) {
          row = {
            text: `${name} is steeper than a car can climb, and no longer matches the ground.`,
            fixKind: "regrade",
            fixLabel: "Re-grade to the ground",
            tip: `Re-grading lays the road back onto the ground under it. ${code}`,
          };
        } else if (edge && !unlockedSet.has(f.id)) {
          row = {
            text: `${name} is steeper than a car can climb.`,
            fixKind: "smooth-heights",
            fixLabel: "Smooth the road's heights",
            tip: `Evens out the road's recorded heights to a drivable slope. The ground is not changed. ${code}`,
          };
        } else {
          row = {
            text: `${name} is steeper than a car can climb.`,
            hint: "Flatten the ground under it with the Smooth tool, then use Re-grade.",
            tip: code,
          };
        }
        break;
      }
      case "GEOMETRY_LENGTH_MISMATCH":
        row = {
          text: `${name} has a recorded length that does not match its shape.`,
          hint: "Erase the road and draw it again.",
          tip: code,
        };
        break;
      case "GEOMETRY_SELF_INTERSECTION":
        row = {
          text: `${name} bends back on itself in ${n === 1 ? "one place" : `${n} places`}. This does not stop saving.`,
          hint: "Redraw that stretch with a wider curve if it looks wrong.",
          tip: code,
        };
        break;
      default:
        row = {
          text: `${name} points at a junction that does not exist.`,
          hint: "Erase the road and draw it again.",
          tip: code,
        };
        break;
    }
    const fixes: RoadFix[] =
      row.fixKind && row.fixLabel
        ? [{ kind: row.fixKind, label: row.fixLabel, tip: row.tip, edgeId: f.id }]
        : [];
    rows.push({ ...row, ...(fixes.length > 0 ? { fixes } : {}), blocking, target, at });
  }

  for (const s of stale) {
    const edge = edgeById.get(s.edgeId);
    if (!edge) continue;
    const covered = rows.some(
      (r) => r.fixKind === "regrade" && r.target.kind === "edge" && r.target.id === s.edgeId,
    );
    if (covered) continue;
    rows.push({
      text: `${roadName(s.edgeId)} no longer matches the ground (off by up to ${s.maxDeltaM.toFixed(1)} m).`,
      tip: "An unlocked road was left behind after sculpting the ground under it. Re-grading lays it back onto the ground.",
      blocking: true,
      fixKind: "regrade",
      fixLabel: "Re-grade to the ground",
      fixes: [
        {
          kind: "regrade",
          label: "Re-grade to the ground",
          tip: "Lays the road back onto the ground under it.",
          edgeId: s.edgeId,
        },
      ],
      target: { kind: "edge", id: s.edgeId },
      at: edgeMidpoint(edge),
    });
  }

  rows.push(...cutOffRows(graph, pieces), ...trapRows(graph, failures, pieces));

  // Stable: blocking first, otherwise keep discovery order.
  return rows
    .map((r, i) => ({ r, i }))
    .sort((a, b) => Number(b.r.blocking) - Number(a.r.blocking) || a.i - b.i)
    .map((x) => x.r);
}

// ---------------------------------------------------------------- pure repairs

function polylineLength(pts: readonly Pt[]): number {
  let len = 0;
  for (let i = 1; i < pts.length; i++) {
    len += Math.hypot(
      pts[i][0] - pts[i - 1][0],
      pts[i][1] - pts[i - 1][1],
      pts[i][2] - pts[i - 1][2],
    );
  }
  return len;
}

function withEdge(graph: RoadGraph, edgeId: number, points: Pt[]): RoadGraph {
  return {
    ...graph,
    edges: graph.edges.map((e) =>
      e.id === edgeId ? { ...e, points, lengthM: polylineLength(points) } : e,
    ),
  };
}

/**
 * Removes consecutive duplicate points from one road. The two end points are
 * never moved (they sit on junctions); when the duplicate is the last point,
 * the point before it goes instead. Null when nothing changes or the road
 * would collapse to a single point.
 */
export function removeDuplicatePoints(graph: RoadGraph, edgeId: number): RoadGraph | null {
  const edge = graph.edges.find((e) => e.id === edgeId);
  if (!edge) return null;
  const pts = edge.points.map((p) => [p[0], p[1], p[2]] as [number, number, number]);
  let changed = false;
  for (let i = 1; i < pts.length; ) {
    const d = Math.hypot(
      pts[i][0] - pts[i - 1][0],
      pts[i][1] - pts[i - 1][1],
      pts[i][2] - pts[i - 1][2],
    );
    if (d > 1e-9) {
      i++;
      continue;
    }
    if (pts.length <= 2) return null; // both ends identical: zero-length road
    pts.splice(i === pts.length - 1 ? i - 1 : i, 1);
    changed = true;
  }
  if (!changed || pts.length < 2) return null;
  return withEdge(graph, edgeId, pts);
}

/**
 * Evens out one road's heights so no segment is steeper than `maxGradient`,
 * keeping both end heights (they belong to junctions shared with other roads).
 * Null when already fine, or when the end heights are too far apart for the
 * road's length.
 */
export function smoothEdgeHeights(
  graph: RoadGraph,
  edgeId: number,
  maxGradient: number = SMOOTH_TARGET_GRADIENT,
): RoadGraph | null {
  const edge = graph.edges.find((e) => e.id === edgeId);
  if (!edge || edge.points.length < 2) return null;
  const pts = edge.points.map((p) => [p[0], p[1], p[2]] as [number, number, number]);
  const n = pts.length;
  const run: number[] = [0];
  for (let i = 1; i < n; i++) {
    run.push(run[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][2] - pts[i - 1][2]));
  }
  const seg = (i: number): number => Math.max(run[i] - run[i - 1], 1e-9);
  const y = pts.map((p) => p[1]);
  const y0 = y[0];
  const yN = y[n - 1];
  for (let pass = 0; pass < 8; pass++) {
    for (let i = 1; i < n - 1; i++) {
      const lo = Math.max(y0 - maxGradient * run[i], yN - maxGradient * (run[n - 1] - run[i]));
      const hi = Math.min(y0 + maxGradient * run[i], yN + maxGradient * (run[n - 1] - run[i]));
      y[i] = Math.min(hi, Math.max(lo, y[i]));
    }
    for (let i = 1; i < n - 1; i++) {
      const d = maxGradient * seg(i);
      y[i] = Math.min(y[i - 1] + d, Math.max(y[i - 1] - d, y[i]));
    }
    for (let i = n - 2; i >= 1; i--) {
      const d = maxGradient * seg(i + 1);
      y[i] = Math.min(y[i + 1] + d, Math.max(y[i + 1] - d, y[i]));
    }
  }
  let worst = 0;
  let moved = false;
  for (let i = 1; i < n; i++) worst = Math.max(worst, Math.abs(y[i] - y[i - 1]) / seg(i));
  for (let i = 0; i < n; i++) if (Math.abs(y[i] - pts[i][1]) > 1e-9) moved = true;
  if (!moved || worst > maxGradient + 1e-6) return null;
  for (let i = 0; i < n; i++) pts[i][1] = y[i];
  return withEdge(graph, edgeId, pts);
}

// --------------------------------------------------------- pieces and naming

export interface OpenEnd {
  readonly nodeId: number;
  readonly edgeId: number;
  readonly end: "start" | "end";
}

export interface CutOffPiece {
  readonly nodeIds: number[];
  readonly edgeIds: number[];
  readonly openEnds: OpenEnd[];
}

export interface RoadPieces {
  /** Node ids connected (ignoring direction) to graph.nodes[0], the validator's root. */
  readonly root: ReadonlySet<number>;
  readonly cutOff: CutOffPiece[];
}

/** Undirected connected components over the edges' endpoint ids (union-find). */
function componentOf(graph: RoadGraph): (nodeId: number) => number {
  const parent = new Map<number, number>();
  const find = (x: number): number => {
    let r = x;
    while ((parent.get(r) ?? r) !== r) r = parent.get(r) as number;
    let c = x;
    while (c !== r) {
      const next = parent.get(c) as number;
      parent.set(c, r);
      c = next;
    }
    return r;
  };
  for (const n of graph.nodes) parent.set(n.id, n.id);
  for (const e of graph.edges) {
    if (!parent.has(e.from)) parent.set(e.from, e.from);
    if (!parent.has(e.to)) parent.set(e.to, e.to);
    parent.set(find(e.from), find(e.to));
  }
  return (id) => (parent.has(id) ? find(id) : id);
}

/**
 * Splits the road network into the root piece (reachable from graph.nodes[0]
 * ignoring direction) and cut-off pieces. An open end is a node with exactly one
 * road attached (a self-loop counts twice).
 */
export function roadPieces(graph: RoadGraph): RoadPieces {
  const root = new Set<number>();
  const first = graph.nodes[0];
  if (!first) return { root, cutOff: [] };
  const comp = componentOf(graph);
  const rootComp = comp(first.id);
  const allIds = new Set<number>(graph.nodes.map((n) => n.id));
  for (const e of graph.edges) {
    allIds.add(e.from);
    allIds.add(e.to);
  }
  for (const id of allIds) if (comp(id) === rootComp) root.add(id);

  const degree = new Map<number, number>();
  for (const e of graph.edges) {
    degree.set(e.from, (degree.get(e.from) ?? 0) + 1);
    degree.set(e.to, (degree.get(e.to) ?? 0) + 1);
  }
  const pieces = new Map<number, CutOffPiece>();
  for (const e of graph.edges) {
    const c = comp(e.from);
    if (c === rootComp) continue;
    let piece = pieces.get(c);
    if (!piece) {
      piece = { nodeIds: [], edgeIds: [], openEnds: [] };
      pieces.set(c, piece);
    }
    piece.edgeIds.push(e.id);
    for (const [nodeId, end] of [
      [e.from, "start"],
      [e.to, "end"],
    ] as const) {
      if (!piece.nodeIds.includes(nodeId)) piece.nodeIds.push(nodeId);
      if (degree.get(nodeId) === 1) piece.openEnds.push({ nodeId, edgeId: e.id, end });
    }
  }
  return { root, cutOff: [...pieces.values()] };
}

/** "the end of Road 4", "the start of Road 4" or "the junction of Roads 3, 4 and 7". */
export function describeNodeEnds(graph: RoadGraph, nodeId: number): string {
  const incident = graph.edges.filter((e) => e.from === nodeId || e.to === nodeId);
  if (incident.length === 0) return "an unattached point";
  const ids = [...new Set(incident.map((e) => e.id))].sort((a, b) => a - b);
  if (incident.length === 1) {
    const e = incident[0];
    return `the ${e.from === nodeId ? "start" : "end"} of ${roadName(e.id)}`;
  }
  return `the junction of Roads ${joinAnd(ids.map(String))}`;
}

function nodePos(graph: RoadGraph, nodeId: number): { x: number; z: number } | null {
  const n = graph.nodes.find((x) => x.id === nodeId);
  return n ? { x: n.x, z: n.z } : null;
}

// ------------------------------------------------------- cut-off and trap rows

function cutOffRows(graph: RoadGraph, pieces: RoadPieces): RoadProblemRow[] {
  const out: RoadProblemRow[] = [];
  for (const piece of pieces.cutOff) {
    const edgeId = piece.edgeIds[0];
    const edge = graph.edges.find((e) => e.id === edgeId);
    if (!edge) continue;
    const roads = piece.edgeIds.map((id) => roadName(id));
    const ends = piece.openEnds.map((o) => describeNodeEnds(graph, o.nodeId));
    const subject = roads.length === 1 ? `${roads[0]} is` : `${joinAnd(roads)} are`;
    const open = ends.length > 0 ? ` (open ends: ${joinAnd(ends)})` : "";
    const fixes: RoadFix[] = [];
    if (planConnectEnds(graph, edgeId)) {
      fixes.push({
        kind: "connect-ends",
        label: "Connect ends",
        tip: "Draws a short road from this piece to the nearest part of the main network.",
        edgeId,
      });
    }
    if (planCloseLoop(graph, edgeId)) {
      fixes.push({
        kind: "close-loop",
        label: "Close loop",
        tip: "Joins the two open ends of this piece to each other.",
        edgeId,
      });
    }
    const first = piece.openEnds[0];
    out.push({
      text: `${capitalise(subject)} cut off from the main road network${open}. This does not stop you saving: saving still works.`,
      tip: "Cars cannot drive between this piece and the rest of the map. Check code: UNDIRECTED_REACHABILITY.",
      blocking: false,
      ...(fixes.length > 0 ? { fixes } : {}),
      hint:
        fixes.length > 0
          ? "Use a fix button, or join it to another road by hand."
          : "Too far to join automatically: draw a road to join it to the network, or ignore it while you are still building.",
      target: { kind: "edge", id: edgeId },
      at: (first && nodePos(graph, first.nodeId)) || edgeMidpoint(edge),
    });
  }
  return out;
}

function trapRows(
  graph: RoadGraph,
  failures: readonly ValidationFailure[],
  pieces: RoadPieces,
): RoadProblemRow[] {
  const out: RoadProblemRow[] = [];
  const seen = new Set<number>();
  for (const f of failures) {
    if (f.category !== "DIRECTED_PATHABILITY" || f.kind !== "node") continue;
    if (seen.has(f.id) || !pieces.root.has(f.id)) continue; // cut-off nodes: reported per piece
    seen.add(f.id);
    const pos = nodePos(graph, f.id);
    if (!pos) continue;
    const edgeId = twoWayCandidates(graph, f.id)[0];
    out.push({
      text: `${capitalise(describeNodeEnds(graph, f.id))} is a one-way trap: cars can get in but not out, or out but not in. This does not stop saving.`,
      tip: `Check code: ${f.category}. ${f.message}`,
      blocking: false,
      ...(edgeId !== undefined
        ? {
            fixes: [
              {
                kind: "make-two-way" as const,
                label: "Make two-way",
                tip: "Makes the one-way road(s) here two-way so cars can leave again.",
                edgeId,
                nodeId: f.id,
              },
            ],
          }
        : { hint: "Add a road back out, or redraw the road that leads in." }),
      target: { kind: "node", id: f.id },
      at: pos,
    });
  }
  return out;
}

// ----------------------------------------------------------------- fix planners

export interface ConnectPlan {
  readonly from: { readonly x: number; readonly z: number; readonly nodeId: number };
  readonly to: {
    readonly x: number;
    readonly z: number;
    readonly nodeId?: number;
    readonly edgeId?: number;
  };
  readonly distanceM: number;
}

/**
 * Where to bridge a cut-off piece to the main network: the nearest pairing of
 * one of the piece's open ends (all its nodes if it has none) with a root node
 * or a point on a root road. Null for roads already in the network, an empty
 * network, or a gap over CONNECT_MAX_M.
 */
export function planConnectEnds(graph: RoadGraph, edgeId: number): ConnectPlan | null {
  const pieces = roadPieces(graph);
  const piece = pieces.cutOff.find((p) => p.edgeIds.includes(edgeId));
  if (!piece) return null;
  const roots = pieces.root;
  const rootNodes = graph.nodes.filter((n) => roots.has(n.id));
  if (rootNodes.length === 0) return null;
  const rootEdges = graph.edges.filter((e) => roots.has(e.from));
  const sourceIds = piece.openEnds.length > 0 ? piece.openEnds.map((o) => o.nodeId) : piece.nodeIds;
  const sources = sourceIds
    .map((id) => graph.nodes.find((n) => n.id === id))
    .filter((n): n is NonNullable<typeof n> => n !== undefined);

  let best: ConnectPlan | null = null;
  for (const src of sources) {
    let found: ConnectPlan["to"] | null = null;
    let d = Number.POSITIVE_INFINITY;
    for (const n of rootNodes) {
      const dist = Math.hypot(n.x - src.x, n.z - src.z);
      if (dist < d) {
        d = dist;
        found = { x: n.x, z: n.z, nodeId: n.id };
      }
    }
    for (const e of rootEdges) {
      for (let i = 1; i < e.points.length; i++) {
        const a = e.points[i - 1];
        const b = e.points[i];
        const dx = b[0] - a[0];
        const dz = b[2] - a[2];
        const len2 = dx * dx + dz * dz;
        const along = len2 > 1e-12 ? ((src.x - a[0]) * dx + (src.z - a[2]) * dz) / len2 : 0;
        const t = Math.max(0, Math.min(1, along));
        const px = a[0] + dx * t;
        const pz = a[2] + dz * t;
        const dist = Math.hypot(px - src.x, pz - src.z);
        if (dist < d - 1e-6) {
          d = dist;
          found = { x: px, z: pz, edgeId: e.id };
        }
      }
    }
    if (found && (!best || d < best.distanceM)) {
      best = { from: { x: src.x, z: src.z, nodeId: src.id }, to: found, distanceM: d };
    }
  }
  if (!best || best.distanceM > CONNECT_MAX_M) return null;
  return best;
}

export interface CloseLoopPlan {
  readonly a: number;
  readonly b: number;
  readonly from: { readonly x: number; readonly z: number };
  readonly to: { readonly x: number; readonly z: number };
  readonly gapM: number;
}

/**
 * The piece holding `edgeId` has exactly two open ends within CLOSE_LOOP_MAX_M of
 * each other: plan to join them. Null otherwise.
 */
export function planCloseLoop(graph: RoadGraph, edgeId: number): CloseLoopPlan | null {
  const edge = graph.edges.find((e) => e.id === edgeId);
  if (!edge) return null;
  const comp = componentOf(graph);
  const c = comp(edge.from);
  const degree = new Map<number, number>();
  for (const e of graph.edges) {
    if (comp(e.from) !== c) continue;
    degree.set(e.from, (degree.get(e.from) ?? 0) + 1);
    degree.set(e.to, (degree.get(e.to) ?? 0) + 1);
  }
  const ends = [...degree].filter(([, d]) => d === 1).map(([id]) => id);
  if (ends.length !== 2) return null;
  const pa = nodePos(graph, ends[0]);
  const pb = nodePos(graph, ends[1]);
  if (!pa || !pb) return null;
  const gapM = Math.hypot(pa.x - pb.x, pa.z - pb.z);
  if (gapM > CLOSE_LOOP_MAX_M) return null;
  return { a: ends[0], b: ends[1], from: pa, to: pb, gapM };
}

/**
 * Oneway edges to flip for a trapped node: those touching it, else every oneway
 * edge in its undirected piece. Empty when there are none.
 */
export function twoWayCandidates(graph: RoadGraph, nodeId: number): number[] {
  const touching = graph.edges.filter((e) => e.oneway && (e.from === nodeId || e.to === nodeId));
  if (touching.length > 0) return touching.map((e) => e.id);
  const comp = componentOf(graph);
  const c = comp(nodeId);
  return graph.edges.filter((e) => e.oneway && comp(e.from) === c).map((e) => e.id);
}

/** Sets oneway=false on the given edges. Null when nothing changes. */
export function makeTwoWay(graph: RoadGraph, edgeIds: readonly number[]): RoadGraph | null {
  const ids = new Set(edgeIds);
  let changed = false;
  const edges = graph.edges.map((e) => {
    if (!ids.has(e.id) || !e.oneway) return e;
    changed = true;
    return { ...e, oneway: false };
  });
  return changed ? { ...graph, edges } : null;
}

/**
 * Merges node `dropId` into `keepId`: every road end at dropId moves to keepId's
 * position (length recomputed) and dropId is removed. Null if an id is missing,
 * they are the same, or a road would collapse to zero length. For tiny
 * Close-loop gaps.
 */
export function mergeEndNodes(graph: RoadGraph, keepId: number, dropId: number): RoadGraph | null {
  if (keepId === dropId) return null;
  const keep = graph.nodes.find((n) => n.id === keepId);
  const drop = graph.nodes.find((n) => n.id === dropId);
  if (!keep || !drop) return null;
  let bad = false;
  const edges = graph.edges.map((e) => {
    if (e.from !== dropId && e.to !== dropId) return e;
    const points = e.points.map((p) => [p[0], p[1], p[2]] as [number, number, number]);
    if (e.from === dropId && points.length > 0) points[0] = [keep.x, keep.y, keep.z];
    if (e.to === dropId && points.length > 0) points[points.length - 1] = [keep.x, keep.y, keep.z];
    const lengthM = polylineLength(points);
    if (lengthM < 1e-6) bad = true;
    return {
      ...e,
      from: e.from === dropId ? keepId : e.from,
      to: e.to === dropId ? keepId : e.to,
      points,
      lengthM,
    };
  });
  if (bad) return null;
  return { ...graph, nodes: graph.nodes.filter((n) => n.id !== dropId), edges };
}
