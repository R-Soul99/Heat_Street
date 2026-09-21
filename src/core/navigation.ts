import createGraph, { type Graph } from "ngraph.graph";
import { aStar } from "ngraph.path";
import type { CourseData } from "./course";
import type { RoadGraph, RoadGraphEdge } from "./road-graph";

export interface NavigationLink {
  readonly weight: number;
  readonly edgeId: number;
}

export interface NavigationGraph {
  readonly graph: Graph<undefined, NavigationLink>;
  readonly roadGraph: RoadGraph;
  readonly edgesById: ReadonlyMap<number, RoadGraphEdge>;
}

export function buildNavigationGraph(roadGraph: RoadGraph): NavigationGraph {
  const graph = createGraph<undefined, NavigationLink>();
  for (const node of roadGraph.nodes) graph.addNode(node.id);
  for (const edge of roadGraph.edges) {
    graph.addLink(edge.from, edge.to, { weight: edge.lengthM, edgeId: edge.id });
    if (!edge.oneway) graph.addLink(edge.to, edge.from, { weight: edge.lengthM, edgeId: edge.id });
  }
  return { graph, roadGraph, edgesById: new Map(roadGraph.edges.map((edge) => [edge.id, edge])) };
}

export function findRoadPath(
  navigation: NavigationGraph,
  fromNodeId: number,
  toNodeId: number,
): readonly number[] {
  if (!navigation.graph.hasNode(fromNodeId) || !navigation.graph.hasNode(toNodeId)) return [];
  const pathFinder = aStar(navigation.graph, {
    oriented: true,
    distance: (_from, _to, link) => link.data.weight,
  });
  return pathFinder
    .find(fromNodeId, toNodeId)
    .map((node) => Number(node.id))
    .reverse();
}

export function nearestRoadNode(
  navigation: NavigationGraph,
  position: readonly [number, number, number],
): number {
  let nearest = navigation.roadGraph.nodes[0];
  let nearestDistance = Number.POSITIVE_INFINITY;
  for (const node of navigation.roadGraph.nodes) {
    const dx = node.x - position[0];
    const dy = node.y - position[1];
    const dz = node.z - position[2];
    const distance = dx * dx + dy * dy + dz * dz;
    if (distance < nearestDistance) {
      nearest = node;
      nearestDistance = distance;
    }
  }
  return nearest.id;
}

const DEFECT_COORDINATES: readonly (readonly [number, number])[] = [
  [-633.25, -134.43],
  [-420, 102.2],
  [-1227.2, -1062.3],
  [-384.66, 229.75],
  [1167.69, 195.84],
  [891.84, 240.86],
  [1048.35, 215.1],
  [1039.58, 344.87],
];
const DEFECT_CLEARANCE_M = 40;
const CHECKPOINT_EDGE_TOLERANCE_M = 30;

function distanceXZ(a: readonly [number, number, number], b: readonly [number, number]): number {
  const dx = a[0] - b[0];
  const dz = a[2] - b[1];
  return Math.sqrt(dx * dx + dz * dz);
}

function edgePointDistance(
  position: readonly [number, number, number],
  edge: RoadGraphEdge,
): number {
  return Math.min(
    ...edge.points.map((point) => {
      const dx = position[0] - point[0];
      const dz = position[2] - point[2];
      return Math.sqrt(dx * dx + dz * dz);
    }),
  );
}

export function validateCourseRoutes(routes: CourseData, roadGraph: RoadGraph): readonly string[] {
  const navigation = buildNavigationGraph(roadGraph);
  const failures: string[] = [];
  for (const course of routes.courses) {
    const nodeIds = [
      course.start.nodeId,
      ...course.checkpoints.map((checkpoint) => checkpoint.nodeId),
    ];
    const pathEdgeIds = new Set<number>();
    for (let index = 0; index < nodeIds.length - (course.mode === "circuit" ? 0 : 1); index++) {
      const from = nodeIds[index];
      const to = nodeIds[(index + 1) % nodeIds.length];
      const path = findRoadPath(navigation, from, to);
      if (path.length === 0)
        failures.push(`${course.id}: no directed path from node ${from} to ${to}`);
      for (let pathIndex = 0; pathIndex < path.length - 1; pathIndex++) {
        const link = navigation.graph.getLink(path[pathIndex], path[pathIndex + 1]);
        if (link !== undefined) pathEdgeIds.add(link.data.edgeId);
      }
    }
    for (const checkpoint of course.checkpoints) {
      const edge = navigation.edgesById.get(checkpoint.edgeId);
      if (edge === undefined) continue;
      if (edgePointDistance(checkpoint.position, edge) > CHECKPOINT_EDGE_TOLERANCE_M)
        failures.push(`${course.id}/${checkpoint.id}: checkpoint is not near edge ${edge.id}`);
      if (checkpoint.sensor.widthM < edge.widthM || checkpoint.sensor.heightM < 6)
        failures.push(`${course.id}/${checkpoint.id}: sensor is too small for its road`);
      for (const defect of DEFECT_COORDINATES) {
        if (distanceXZ(checkpoint.position, defect) < DEFECT_CLEARANCE_M)
          failures.push(
            `${course.id}/${checkpoint.id}: checkpoint is within ${DEFECT_CLEARANCE_M}m of defect coordinate`,
          );
      }
    }
    for (const edgeId of pathEdgeIds) {
      const edge = navigation.edgesById.get(edgeId);
      if (edge?.surface === "gravel" || edge?.surface === "dirt_road") continue;
    }
    if (
      ![...pathEdgeIds].some((edgeId) => {
        const surface = navigation.edgesById.get(edgeId)?.surface;
        return surface === "gravel" || surface === "dirt_road";
      })
    )
      failures.push(`${course.id}: route does not include a gravel or dirt_road edge`);
  }
  return failures;
}
