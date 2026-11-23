import { describe, expect, it } from "vitest";
import fixtureRaw from "../fixtures/road-graph.sample.json?raw";
import { parseCourseData, serializeCourseData } from "../src/core/course";
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
  it("parses a P2P and a three-lap Circuit course", () => {
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
        courses[0].checkpoints = (courses[0].checkpoints as unknown[]).slice(0, 1);
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
        courses[1].laps = 0;
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

  const parse = (source: unknown) => parseCourseData(JSON.stringify(source), "routes.json", graph);
  const courseList = (source: Record<string, unknown>) =>
    source.courses as Record<string, unknown>[];
  const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

  it("accepts 0, 1 and 3 courses and rejects 21", () => {
    const source = validSource();
    const [p2p, circuit] = courseList(source);
    expect(parse({ ...source, courses: [] }).courses).toHaveLength(0);
    expect(parse({ ...source, courses: [p2p] }).courses).toHaveLength(1);
    const p2pB = clone(p2p);
    p2pB.id = "p2p-b";
    for (const cp of p2pB.checkpoints as Record<string, unknown>[]) cp.id = `b-${cp.id}`;
    expect(parse({ ...source, courses: [p2p, p2pB, circuit] }).courses).toHaveLength(3);
    const many = Array.from({ length: 21 }, (_, i) => {
      const c = clone(p2p);
      c.id = `c${i}`;
      for (const cp of c.checkpoints as Record<string, unknown>[]) cp.id = `c${i}-${cp.id}`;
      return c;
    });
    expect(() => parse({ ...source, courses: many })).toThrow(/at most 20/);
  });

  it("enforces checkpoint count and lap ranges", () => {
    const withCount = (index: number, count: number, laps?: number) => {
      const source = validSource();
      const course = courseList(source)[index];
      const template = (course.checkpoints as Record<string, unknown>[])[0];
      course.checkpoints = Array.from({ length: count }, (_, i) => ({
        ...template,
        id: `x-${i}`,
      }));
      if (laps !== undefined) course.laps = laps;
      return source;
    };
    expect(() => parse(withCount(0, 1))).toThrow(/checkpoint count/);
    expect(() => parse(withCount(0, 2))).not.toThrow();
    expect(() => parse(withCount(0, 41))).toThrow(/checkpoint count/);
    expect(() => parse(withCount(1, 2))).toThrow(/checkpoint count/);
    expect(() => parse(withCount(1, 3))).not.toThrow();
    expect(() => parse(withCount(1, 4, 0))).toThrow(/laps/);
    expect(() => parse(withCount(1, 4, 21))).toThrow(/laps/);
    expect(() => parse(withCount(1, 4, 1))).not.toThrow();
    expect(() => parse(withCount(1, 4, 20))).not.toThrow();
  });

  it("parses optional start x/z and rejects partial or bad values", () => {
    const withStart = (start: Record<string, unknown>) => {
      const source = validSource();
      courseList(source)[0].start = { nodeId: 0, headingRad: 0, ...start };
      return source;
    };
    const ok = parse(withStart({ x: 5, z: -7 }));
    expect(ok.courses[0].start.x).toBe(5);
    expect(ok.courses[0].start.z).toBe(-7);
    expect(() => parse(withStart({ x: 5 }))).toThrow(/start/);
    expect(() => parse(withStart({ x: 5, z: null }))).toThrow(/start\.z/);
    expect(() => parse(withStart({ x: 100001, z: 0 }))).toThrow(/start\.x/);
  });

  it("round-trips through serializeCourseData with and without start x/z", () => {
    const source = validSource();
    const first = parse(source);
    expect(parse(JSON.parse(serializeCourseData(first)))).toEqual(first);
    courseList(source)[0].start = { nodeId: 0, headingRad: 1, x: 3, z: 4 };
    const second = parse(source);
    expect(parse(JSON.parse(serializeCourseData(second)))).toEqual(second);
    expect(serializeCourseData(second).endsWith("\n")).toBe(true);
  });
});
