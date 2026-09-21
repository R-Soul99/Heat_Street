import { describe, expect, it } from "vitest";
import fixtureRaw from "../fixtures/road-graph.sample.json?raw";
import { parseCourseData } from "../src/core/course";
import { parseRoadGraph } from "../src/core/road-graph";

const graph = parseRoadGraph(fixtureRaw, "fixtures/road-graph.sample.json");

function validSource(): Record<string, unknown> {
  return {
    schemaVersion: 1,
    areaId: "sample-square",
    courses: [
      {
        id: "p2p-demo",
        name: "Demo Run",
        mode: "p2p",
        checkpoints: Array.from({ length: 5 }, (_, index) => ({
          id: `p2p-${index + 1}`,
          nodeId: index % 4,
          edgeId: index % 4,
          position: [index === 1 || index === 2 ? 100 : 0, 0, index === 2 || index === 3 ? 100 : 0],
          sensor: { widthM: 8, depthM: 12, heightM: 10 },
        })),
        start: { nodeId: 0, headingRad: 0 },
      },
      {
        id: "circuit-demo",
        name: "Demo Circuit",
        mode: "circuit",
        laps: 3,
        checkpoints: Array.from({ length: 4 }, (_, index) => ({
          id: `circuit-${index + 1}`,
          nodeId: index % 4,
          edgeId: index % 4,
          position: [index === 1 || index === 2 ? 100 : 0, 0, index === 2 || index === 3 ? 100 : 0],
          sensor: { widthM: 8, depthM: 12, heightM: 10 },
        })),
        start: { nodeId: 0, headingRad: 0 },
      },
    ],
  };
}

describe("parseCourseData", () => {
  it("parses exactly one P2P and one three-lap Circuit course", () => {
    const result = parseCourseData(JSON.stringify(validSource()), "routes.json", graph);
    expect(result.areaId).toBe("sample-square");
    expect(result.courses.map((course) => course.mode)).toEqual(["p2p", "circuit"]);
    expect(result.courses[1].laps).toBe(3);
    expect(result.courses[0].checkpoints[0].sensor.widthM).toBe(8);
  });

  it.each([
    [
      "schemaVersion",
      (source: Record<string, unknown>): void => {
        source.schemaVersion = 2;
      },
    ],
    [
      "duplicate checkpoint id",
      (source: Record<string, unknown>) => {
        const courses = source.courses as Record<string, unknown>[];
        const checkpoints = courses[0].checkpoints as Record<string, unknown>[];
        checkpoints[1].id = checkpoints[0].id;
      },
    ],
    [
      "checkpoint count",
      (source: Record<string, unknown>) => {
        const courses = source.courses as Record<string, unknown>[];
        courses[0].checkpoints = (courses[0].checkpoints as unknown[]).slice(0, 4);
      },
    ],
    [
      "coordinate",
      (source: Record<string, unknown>) => {
        const courses = source.courses as Record<string, unknown>[];
        const checkpoints = courses[0].checkpoints as Record<string, unknown>[];
        checkpoints[0].position = [Number.NaN, 0, 0];
      },
    ],
    [
      "node reference",
      (source: Record<string, unknown>) => {
        const courses = source.courses as Record<string, unknown>[];
        const checkpoints = courses[0].checkpoints as Record<string, unknown>[];
        checkpoints[0].nodeId = 99;
      },
    ],
    [
      "mode",
      (source: Record<string, unknown>) => {
        const courses = source.courses as Record<string, unknown>[];
        courses[0].mode = "drift";
      },
    ],
    [
      "laps",
      (source: Record<string, unknown>) => {
        const courses = source.courses as Record<string, unknown>[];
        courses[1].laps = 2;
      },
    ],
  ] as const)("rejects invalid %s", (label, mutate) => {
    const source = validSource();
    mutate(source);
    expect(() => parseCourseData(JSON.stringify(source), "routes.json", graph)).toThrow(
      new RegExp(label),
    );
  });

  it("copies named fields without allowing prototype keys into the result", () => {
    const source = validSource();
    Object.defineProperty(source, "__proto__", {
      value: { polluted: true },
      enumerable: true,
    });
    const result = parseCourseData(JSON.stringify(source), "routes.json", graph);
    expect((result as unknown as Record<string, unknown>).polluted).toBeUndefined();
    expect((Object.prototype as unknown as Record<string, unknown>).polluted).toBeUndefined();
  });
});
