import { describe, expect, it } from "vitest";
// Real committed artifacts, read through Vite's `?raw` transform — the same
// idiom `tests/ai-lap.test.ts`/`tests/route-validation.test.ts` use. Proving
// this helper faces down-course at EVERY checkpoint of both real Juliette
// courses (not a synthetic fixture) is this task's whole point.
import compiledRaw from "../public/maps/juliette-ga.map.json?raw";
import routesRaw from "../public/maps/juliette-ga.routes.json?raw";
import { checkpointResetPose } from "../src/core/checkpoint-pose";
import type { Course } from "../src/core/course";
import { parseCourseData } from "../src/core/course";
import { forwardFromYaw } from "../src/core/heading";
import { buildNavigationGraph, findRoadPath, type NavigationGraph } from "../src/core/navigation";
import type { RoadGraph } from "../src/core/road-graph";
import { parseRoadGraph } from "../src/core/road-graph";

const graph = parseRoadGraph(compiledRaw, "public/maps/juliette-ga.map.json");
const routes = parseCourseData(routesRaw, "public/maps/juliette-ga.routes.json", graph);
const navigation = buildNavigationGraph(graph);

/**
 * Unit XZ road tangent from `fromNodeId` toward `toNodeId`, sampled the same
 * way `checkpointResetPose` samples it — the first path edge, ordered in
 * travel direction, first point at least 10m from the node. Independent of
 * `checkpoint-pose.ts`'s own internals so the assertion is a genuine
 * behavioral check, not a tautology against the implementation.
 */
function roadTangent(
  fromNodeId: number,
  toNodeId: number,
  nav: NavigationGraph,
): { readonly x: number; readonly z: number } {
  const path = findRoadPath(nav, fromNodeId, toNodeId);
  const link = nav.graph.getLink(path[0], path[1]);
  if (link === undefined) throw new Error("roadTangent: no link on first path edge");
  const edge = nav.edgesById.get(link.data.edgeId);
  if (edge === undefined) throw new Error("roadTangent: no edge for link");
  const ordered = edge.from === path[0] ? edge.points : [...edge.points].reverse();
  const node = ordered[0];
  let target = ordered[ordered.length - 1];
  for (const point of ordered) {
    const dx = point[0] - node[0];
    const dz = point[2] - node[2];
    if (Math.hypot(dx, dz) >= 10) {
      target = point;
      break;
    }
  }
  const dx = target[0] - node[0];
  const dz = target[2] - node[2];
  const length = Math.hypot(dx, dz) || 1;
  return { x: dx / length, z: dz / length };
}

describe("checkpointResetPose — position unchanged from the former poseForCheckpoint", () => {
  it("returns x/z from checkpoint.position and y raised 0.6m", () => {
    const course = routes.courses.find((candidate) => candidate.mode === "circuit");
    if (course === undefined) throw new Error("fixture has no circuit course");
    const checkpoint = course.checkpoints[0];
    const pose = checkpointResetPose(checkpoint, course, navigation);
    expect(pose.x).toBe(checkpoint.position[0]);
    expect(pose.z).toBe(checkpoint.position[2]);
    expect(pose.y).toBeCloseTo(checkpoint.position[1] + 0.6, 9);
  });
});

describe("checkpointResetPose — faces down-course at every checkpoint of both real Juliette courses (D-13 bug fix)", () => {
  for (const course of routes.courses) {
    it(`${course.id}: every checkpoint's forward direction aligns with the road tangent toward the next checkpoint (dot > cos(30deg))`, () => {
      for (let i = 0; i < course.checkpoints.length; i++) {
        const checkpoint = course.checkpoints[i];
        const next = course.checkpoints[(i + 1) % course.checkpoints.length];
        const pose = checkpointResetPose(checkpoint, course, navigation);
        const forward = forwardFromYaw(pose.headingRad);
        const tangent = roadTangent(checkpoint.nodeId, next.nodeId, navigation);
        const dot = forward.x * tangent.x + forward.z * tangent.z;
        expect(dot).toBeGreaterThan(Math.cos(Math.PI / 6));
      }
    });
  }
});

describe("checkpointResetPose — fallback when no route to the next checkpoint exists", () => {
  it("falls back to course.start.headingRad", () => {
    // Two disconnected nodes: node 1 has no edges, so findRoadPath(0 -> 1)
    // (and any path FROM node 0, which is what checkpointResetPose walks
    // toward the next checkpoint) returns an empty path.
    const disconnectedGraph: RoadGraph = {
      schemaVersion: 1,
      areaId: "test",
      name: "test",
      source: { osmExtract: "", osmSnapshot: "", demSource: "", compilerVersion: "" },
      attribution: { osm: "", osmLicense: "", osmLicenseUrl: "", dem: "" },
      origin: { lat: 0, lon: 0, projection: "" },
      bounds: { minX: -100, minZ: -100, maxX: 100, maxZ: 100 },
      nodes: [
        { id: 0, x: 0, y: 0, z: 0, junction: false, osmNodeId: 0 },
        { id: 1, x: 50, y: 0, z: 0, junction: false, osmNodeId: 1 },
      ],
      edges: [],
    };
    const disconnectedNavigation = buildNavigationGraph(disconnectedGraph);
    const course: Course = {
      id: "fallback-fixture",
      name: "Fallback Fixture",
      mode: "circuit",
      laps: 3,
      start: { nodeId: 0, headingRad: 1.2345 },
      checkpoints: [
        {
          id: "c0",
          nodeId: 0,
          edgeId: 0,
          position: [0, 0, 0],
          sensor: { widthM: 8, depthM: 8, heightM: 10 },
        },
        {
          id: "c1",
          nodeId: 1,
          edgeId: 0,
          position: [50, 0, 0],
          sensor: { widthM: 8, depthM: 8, heightM: 10 },
        },
      ],
    };
    const pose = checkpointResetPose(course.checkpoints[0], course, disconnectedNavigation);
    expect(pose.headingRad).toBe(course.start.headingRad);
  });
});
