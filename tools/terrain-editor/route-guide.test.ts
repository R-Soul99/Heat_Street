import { describe, expect, it } from "vitest";
import type { RouteDraft } from "../../src/core/route-draft.ts";
import type { StageDraft } from "../../src/core/stage.ts";
import {
  planPartialSave,
  routeMissing,
  routePrompt,
  stackTags,
  stageMissing,
} from "./route-guide.ts";

const gate = { id: "g1", x: 1, z: 1, headingRad: 0, widthM: 20 };
const fin = { x: 5, z: 5, headingRad: 0, widthM: 20 };

function stage(id: string, over: Partial<StageDraft> = {}): StageDraft {
  return {
    id,
    name: id,
    start: { x: 0, z: 0, headingRad: 0 },
    gates: [gate],
    finish: fin,
    ...over,
  };
}

function route(mode: "p2p" | "circuit", cps: number, finish: boolean): RouteDraft {
  return {
    id: "r",
    name: "R",
    mode,
    laps: 2,
    start: { x: 0, z: 0, headingRad: 0 },
    checkpoints: Array.from({ length: cps }, (_, i) => ({ id: `c${i}`, x: i, z: 0 })),
    finish: finish ? { id: "f", x: 9, z: 9 } : null,
  };
}

describe("what is missing", () => {
  it("names the missing parts of a stage", () => {
    expect(stageMissing(stage("a"))).toBeNull();
    expect(stageMissing(stage("a", { finish: null }))).toBe("has no finish");
    expect(stageMissing(stage("a", { gates: [] }))).toBe("has no gates");
    expect(stageMissing(stage("a", { gates: [], finish: null }))).toBe("has no gates or finish");
  });

  it("knows the point-to-point and circuit minimums", () => {
    expect(routeMissing(route("p2p", 1, true))).toBeNull();
    expect(routeMissing(route("circuit", 1, true))).toBe("has no second checkpoint");
    expect(routeMissing(route("circuit", 2, false))).toBe("has no lap line");
  });
});

describe("planPartialSave", () => {
  it("writes complete items and reports the unfinished one", () => {
    const a = stage("a");
    const b = stage("b", { finish: null });
    expect(planPartialSave([a, b], [], stageMissing)).toEqual({
      write: [a],
      unfinished: ["b has no finish"],
    });
  });

  it("keeps the saved version of an item that became unfinished, in place", () => {
    const old = stage("a");
    const c = stage("c");
    const r = planPartialSave([stage("a", { finish: null }), c], [old], stageMissing);
    expect(r.write).toEqual([old, c]);
  });

  it("does not bring back a deleted item", () => {
    expect(planPartialSave([], [stage("a")], stageMissing).write).toEqual([]);
  });
});

describe("routePrompt", () => {
  const base = { kind: "stage" as const, newPending: false, finishPending: false };
  const cur = (items: number, hasFinish = false) => ({ name: "Stage 1", items, hasFinish });

  it("walks start, gates, finish, complete", () => {
    expect(routePrompt({ ...base, current: null })).toContain("set the start");
    expect(routePrompt({ ...base, current: cur(0) })).toContain("first gate");
    expect(routePrompt({ ...base, current: cur(2) })).toContain("Place finish");
    expect(routePrompt({ ...base, current: cur(2), finishPending: true })).toContain("click on");
    expect(routePrompt({ ...base, current: cur(2, true) })).toContain("Stage 1 is complete");
    expect(routePrompt({ ...base, current: cur(2), newPending: true })).toContain("set the start");
  });

  it("uses circuit words", () => {
    const circuit = { ...base, kind: "circuit" as const };
    expect(routePrompt({ ...circuit, current: cur(1) })).toContain("1 more checkpoint.");
    expect(routePrompt({ ...circuit, current: cur(2) })).toContain("Place lap line");
  });
});

describe("stackTags", () => {
  const size = { w: 40, h: 20 };

  it("leaves separate tags alone", () => {
    expect(
      stackTags([
        { x: 0, y: 100, ...size },
        { x: 200, y: 100, ...size },
      ]),
    ).toEqual([100, 100]);
  });

  it("lifts covered tags clear of each other", () => {
    expect(
      stackTags([
        { x: 0, y: 100, ...size },
        { x: 5, y: 102, ...size },
        { x: 3, y: 99, ...size },
      ]),
    ).toEqual([100, 78, 56]);
  });
});
