import { describe, expect, it } from "vitest";
import fixtureRaw from "../fixtures/road-graph.sample.json?raw";
import { parseCourseData, serializeCourseData } from "../src/core/course";
import { parseRoadGraph } from "../src/core/road-graph";
import {
  courseFromRouteDraft,
  distanceToNearestNode,
  type RouteDraft,
  routeDraftFromCourse,
} from "../src/core/route-draft";

const graph = parseRoadGraph(fixtureRaw, "fixtures/road-graph.sample.json");
const heightAt = (x: number, z: number): number => x * 0.01 + z * 0.02;

function draft(overrides: Partial<RouteDraft> = {}): RouteDraft {
  return {
    id: "r1",
    name: "Route One",
    mode: "p2p",
    laps: 1,
    start: { x: 3, z: 2, headingRad: 1.5 },
    checkpoints: [{ id: "r1-cp-1", x: 100, z: 12 }],
    finish: { id: "r1-finish", x: 98, z: 100 },
    ...overrides,
  };
}

describe("courseFromRouteDraft", () => {
  it("binds an off-node checkpoint to the nearest node and a touching edge", () => {
    const result = courseFromRouteDraft(draft(), graph, heightAt);
    if (!("course" in result)) throw new Error(result.error);
    const [cp, finish] = result.course.checkpoints;
    expect(cp.nodeId).toBe(1);
    const edge = graph.edges.find((e) => e.id === cp.edgeId);
    expect(edge && (edge.from === 1 || edge.to === 1)).toBe(true);
    expect(cp.position).toEqual([100, heightAt(100, 12), 12]);
    expect(finish.id).toBe("r1-finish");
    expect(result.course.start).toEqual({ nodeId: 0, headingRad: 1.5, x: 3, z: 2 });
    expect(cp.sensor).toEqual({ widthM: 20, depthM: 8, heightM: 12 });
  });

  it("produces a course that parseCourseData accepts", () => {
    const result = courseFromRouteDraft(draft(), graph, heightAt);
    if (!("course" in result)) throw new Error(result.error);
    const text = serializeCourseData({
      schemaVersion: 1,
      areaId: graph.areaId,
      courses: [result.course],
    });
    expect(() => parseCourseData(text, "t", graph)).not.toThrow();
  });

  it("reports errors", () => {
    expect(courseFromRouteDraft(draft({ start: null }), graph, heightAt)).toEqual({
      error: "A route needs a start and a finish",
    });
    expect(courseFromRouteDraft(draft({ finish: null }), graph, heightAt)).toEqual({
      error: "A route needs a start and a finish",
    });
    expect(courseFromRouteDraft(draft(), { ...graph, nodes: [], edges: [] }, heightAt)).toEqual({
      error: "This map has no roads; use Stage",
    });
    expect(
      courseFromRouteDraft(draft({ checkpoints: [], mode: "circuit" }), graph, heightAt),
    ).toHaveProperty("error");
    const isolated = { ...graph, edges: [] };
    expect(courseFromRouteDraft(draft(), isolated, heightAt)).toHaveProperty("error");
  });

  it("widens the sensor to the road width when wider than 20 m", () => {
    const wide = { ...graph, edges: graph.edges.map((e) => ({ ...e, widthM: 30 })) };
    const result = courseFromRouteDraft(draft(), wide, heightAt);
    if (!("course" in result)) throw new Error(result.error);
    expect(result.course.checkpoints[0].sensor.widthM).toBe(30);
  });
});

describe("routeDraftFromCourse", () => {
  it("round-trips ids, mode, laps and positions", () => {
    const result = courseFromRouteDraft(
      draft({
        mode: "circuit",
        laps: 4,
        checkpoints: [
          { id: "r1-cp-1", x: 100, z: 12 },
          { id: "r1-cp-2", x: 90, z: 95 },
        ],
      }),
      graph,
      heightAt,
    );
    if (!("course" in result)) throw new Error(result.error);
    const back = routeDraftFromCourse(result.course, graph);
    expect(back.finish?.id).toBe("r1-finish");
    expect(back.checkpoints.map((c) => c.id)).toEqual(["r1-cp-1", "r1-cp-2"]);
    const again = courseFromRouteDraft(back, graph, heightAt);
    if (!("course" in again)) throw new Error(again.error);
    expect(again.course).toEqual(result.course);
  });

  it("falls back to the start node position when start x/z is absent", () => {
    const result = courseFromRouteDraft(draft(), graph, heightAt);
    if (!("course" in result)) throw new Error(result.error);
    const { x: _x, z: _z, ...start } = result.course.start;
    const back = routeDraftFromCourse({ ...result.course, start }, graph);
    expect(back.start).toEqual({ x: 0, z: 0, headingRad: 1.5 });
  });
});

describe("distanceToNearestNode", () => {
  it("measures XZ distance and is Infinity on an empty graph", () => {
    expect(distanceToNearestNode(graph, 100, 12)).toBeCloseTo(12);
    expect(distanceToNearestNode({ ...graph, nodes: [] }, 0, 0)).toBe(Number.POSITIVE_INFINITY);
  });
});
