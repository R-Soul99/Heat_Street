import { describe, expect, it } from "vitest";
import type { Course } from "../src/core/course";
import { parseRouteRequest, selectCourse } from "../src/core/route-select";

function course(id: string, mode: "p2p" | "circuit"): Course {
  return {
    id,
    name: id,
    mode,
    laps: 1,
    checkpoints: [],
    start: { nodeId: 0, headingRad: 0 },
  };
}

describe("parseRouteRequest", () => {
  it("defaults to p2p", () => {
    expect(parseRouteRequest("")).toEqual({ mode: "p2p", routeId: null, badRouteId: false });
  });
  it("reads modes", () => {
    expect(parseRouteRequest("?mode=circuit").mode).toBe("circuit");
    expect(parseRouteRequest("?mode=circuit-race").mode).toBe("circuit-race");
    expect(parseRouteRequest("?mode=stage").mode).toBe("p2p");
  });
  it("reads a route id", () => {
    expect(parseRouteRequest("?route=demo-hills-route-2").routeId).toBe("demo-hills-route-2");
  });
  it("rejects a bad route id", () => {
    const r = parseRouteRequest("?route=../x");
    expect(r.routeId).toBeNull();
    expect(r.badRouteId).toBe(true);
  });
});

describe("selectCourse", () => {
  const a = course("a", "p2p");
  const b = course("b", "circuit");
  const c = course("c", "p2p");
  it("none for empty", () => {
    expect(selectCourse([], parseRouteRequest(""))).toEqual({ kind: "none" });
  });
  it("route id wins and takes its own mode", () => {
    const s = selectCourse([a, b, c], parseRouteRequest("?route=b"));
    expect(s).toMatchObject({ kind: "course", mode: "circuit" });
    expect((s as { course: Course }).course.id).toBe("b");
  });
  it("circuit-race with circuit route id", () => {
    const s = selectCourse([a, b], parseRouteRequest("?route=b&mode=circuit-race"));
    expect(s).toMatchObject({ kind: "course", mode: "circuit-race" });
  });
  it("circuit-race with non-circuit route id falls back with warning", () => {
    const s = selectCourse([a, b], parseRouteRequest("?route=a&mode=circuit-race"));
    expect(s).toMatchObject({ kind: "course", mode: "p2p" });
    expect((s as { warning?: string }).warning).toBeDefined();
  });
  it("first course of requested mode", () => {
    const s = selectCourse([a, b, c], parseRouteRequest("?mode=p2p"));
    expect((s as { course: Course }).course.id).toBe("a");
    const k = selectCourse([a, b], parseRouteRequest("?mode=circuit-race"));
    expect((k as { course: Course }).course.id).toBe("b");
    expect((k as { warning?: string }).warning).toBeUndefined();
  });
  it("falls back to any mode with warning naming requested mode", () => {
    const s = selectCourse([b], parseRouteRequest("?mode=p2p"));
    expect((s as { course: Course }).course.id).toBe("b");
    expect((s as { warning: string }).warning).toContain("p2p");
  });
  it("unknown route id warns and uses mode default", () => {
    const s = selectCourse([a, b], parseRouteRequest("?route=zzz"));
    expect((s as { course: Course }).course.id).toBe("a");
    expect((s as { warning: string }).warning).toContain("zzz");
  });
});
