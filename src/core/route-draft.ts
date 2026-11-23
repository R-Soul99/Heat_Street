import {
  type CheckpointSensor,
  CIRCUIT_CHECKPOINTS_MIN,
  COURSE_CHECKPOINTS_MAX,
  type Course,
  type CourseCheckpoint,
  type CourseMode,
  P2P_CHECKPOINTS_MIN,
} from "./course";
import type { RoadGraph } from "./road-graph";

/** A hand-placed checkpoint farther than this from any road node gets an off-road warning in the editor. */
export const ROUTE_OFF_ROAD_WARN_M = 30;

export const DEFAULT_ROUTE_SENSOR: CheckpointSensor = { widthM: 20, depthM: 8, heightM: 12 };

export interface RouteDraftPoint {
  readonly id: string;
  readonly x: number;
  readonly z: number;
}

/** Editor shape for a road route. Only the start carries a heading (YAW, radians). */
export interface RouteDraft {
  readonly id: string;
  readonly name: string;
  readonly mode: CourseMode;
  readonly laps: number;
  readonly start: { readonly x: number; readonly z: number; readonly headingRad: number } | null;
  readonly checkpoints: readonly RouteDraftPoint[];
  readonly finish: RouteDraftPoint | null;
}

function xzDistance(ax: number, az: number, bx: number, bz: number): number {
  return Math.hypot(ax - bx, az - bz);
}

export function distanceToNearestNode(graph: RoadGraph, x: number, z: number): number {
  let best = Number.POSITIVE_INFINITY;
  for (const node of graph.nodes) best = Math.min(best, xzDistance(node.x, node.z, x, z));
  return best;
}

function nearestNodeId(graph: RoadGraph, x: number, z: number): number {
  let bestId = -1;
  let best = Number.POSITIVE_INFINITY;
  for (const node of graph.nodes) {
    const d = xzDistance(node.x, node.z, x, z);
    if (d < best) {
      best = d;
      bestId = node.id;
    }
  }
  return bestId;
}

function nearestTouchingEdgeId(graph: RoadGraph, nodeId: number, x: number, z: number): number {
  let bestId = -1;
  let best = Number.POSITIVE_INFINITY;
  for (const edge of graph.edges) {
    if (edge.from !== nodeId && edge.to !== nodeId) continue;
    let edgeBest = Number.POSITIVE_INFINITY;
    for (const point of edge.points)
      edgeBest = Math.min(edgeBest, xzDistance(point[0], point[2], x, z));
    if (edgeBest < best) {
      best = edgeBest;
      bestId = edge.id;
    }
  }
  return bestId;
}

export function courseFromRouteDraft(
  draft: RouteDraft,
  graph: RoadGraph,
  heightAt: (x: number, z: number) => number,
): { course: Course } | { error: string } {
  if (draft.start === null || draft.finish === null)
    return { error: "A route needs a start and a finish" };
  if (graph.nodes.length === 0) return { error: "This map has no roads; use Stage" };
  const points: RouteDraftPoint[] = [
    ...draft.checkpoints,
    { id: `${draft.id}-finish`, x: draft.finish.x, z: draft.finish.z },
  ];
  const minimum = draft.mode === "p2p" ? P2P_CHECKPOINTS_MIN : CIRCUIT_CHECKPOINTS_MIN;
  if (points.length < minimum)
    return {
      error: `A ${draft.mode} route needs at least ${minimum} checkpoints including the finish`,
    };
  if (points.length > COURSE_CHECKPOINTS_MAX)
    return { error: `A route can have at most ${COURSE_CHECKPOINTS_MAX} checkpoints` };

  const checkpoints: CourseCheckpoint[] = [];
  for (const point of points) {
    const nodeId = nearestNodeId(graph, point.x, point.z);
    const edgeId = nearestTouchingEdgeId(graph, nodeId, point.x, point.z);
    if (edgeId < 0) return { error: "A checkpoint is on a road node with no road attached" };
    const edge = graph.edges.find((candidate) => candidate.id === edgeId);
    checkpoints.push({
      id: point.id,
      nodeId,
      edgeId,
      position: [point.x, heightAt(point.x, point.z), point.z],
      sensor: {
        widthM: Math.max(DEFAULT_ROUTE_SENSOR.widthM, edge?.widthM ?? 0),
        depthM: DEFAULT_ROUTE_SENSOR.depthM,
        heightM: DEFAULT_ROUTE_SENSOR.heightM,
      },
    });
  }
  const startNodeId = nearestNodeId(graph, draft.start.x, draft.start.z);
  return {
    course: {
      id: draft.id,
      name: draft.name,
      mode: draft.mode,
      laps: draft.mode === "circuit" ? draft.laps : 1,
      checkpoints,
      start: {
        nodeId: startNodeId,
        headingRad: draft.start.headingRad,
        x: draft.start.x,
        z: draft.start.z,
      },
    },
  };
}

export function routeDraftFromCourse(course: Course, graph: RoadGraph): RouteDraft {
  const startNode = graph.nodes.find((node) => node.id === course.start.nodeId);
  const startX = course.start.x ?? startNode?.x ?? 0;
  const startZ = course.start.z ?? startNode?.z ?? 0;
  const last = course.checkpoints[course.checkpoints.length - 1];
  return {
    id: course.id,
    name: course.name,
    mode: course.mode,
    laps: course.laps,
    start: { x: startX, z: startZ, headingRad: course.start.headingRad },
    checkpoints: course.checkpoints
      .slice(0, -1)
      .map((cp) => ({ id: cp.id, x: cp.position[0], z: cp.position[2] })),
    finish: last === undefined ? null : { id: last.id, x: last.position[0], z: last.position[2] },
  };
}
