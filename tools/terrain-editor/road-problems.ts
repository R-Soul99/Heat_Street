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

export type FixKind = "remove-duplicate-points" | "smooth-heights" | "regrade";

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

  const groups = new Map<string, ValidationFailure[]>();
  for (const f of failures) {
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
    const name = f.kind === "edge" ? roadName(f.id) : `Junction ${f.id}`;
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
      case "UNDIRECTED_REACHABILITY":
        row = {
          text: `${name} is cut off from the main road network. This does not stop saving.`,
          hint: "Join it to another road, or ignore it while you are still building.",
          tip: code,
        };
        break;
      case "DIRECTED_PATHABILITY":
        row = {
          text: `${name} is a one-way trap: cars can get in but not out, or out but not in.`,
          hint: "Erase the one-way road and redraw it, or add a road back out.",
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
    rows.push({ ...row, blocking, target, at });
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
      target: { kind: "edge", id: s.edgeId },
      at: edgeMidpoint(edge),
    });
  }

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
