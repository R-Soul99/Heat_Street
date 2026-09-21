import { describe, expect, it } from "vitest";
import routesRaw from "../public/maps/juliette-ga.routes.json?raw";
import { parseCourseData } from "../src/core/course";
import { MEDAL_CONTRACT_VERSION } from "../src/core/medal-timing";
import {
  MEDAL_REFERENCE_KIND,
  MEDAL_REFERENCE_VERSION,
  parseMedalReference,
  type MedalReferenceCourseExpectation,
} from "../src/core/medal-reference";
import { parseRoadGraph } from "../src/core/road-graph";

const routeIdentity: readonly MedalReferenceCourseExpectation[] = [
  {
    courseId: "juliette-backroads-run",
    mode: "p2p",
    laps: 1,
    checkpointIds: ["p2p-01", "p2p-02", "p2p-03"],
  },
  {
    courseId: "juliette-three-lap-loop",
    mode: "circuit",
    laps: 3,
    checkpointIds: ["circuit-01", "circuit-02"],
  },
];

function validSource(): Record<string, unknown> {
  return {
    kind: MEDAL_REFERENCE_KIND,
    version: MEDAL_REFERENCE_VERSION,
    areaId: "juliette-ga",
    contractVersion: MEDAL_CONTRACT_VERSION,
    handlingContentVersion: "fixture-handling-v1",
    courses: [
      {
        courseId: "juliette-backroads-run",
        mode: "p2p",
        laps: 1,
        totalTimeSec: 30,
        splits: [
          { checkpointId: "p2p-01", lap: 1, authoredIndex: 0, hitOrder: 0, cumulativeTimeSec: 10 },
          { checkpointId: "p2p-02", lap: 1, authoredIndex: 1, hitOrder: 2, cumulativeTimeSec: 20 },
          { checkpointId: "p2p-03", lap: 1, authoredIndex: 2, hitOrder: 1, cumulativeTimeSec: 30 },
        ],
      },
      {
        courseId: "juliette-three-lap-loop",
        mode: "circuit",
        laps: 3,
        totalTimeSec: 60,
        splits: [
          { checkpointId: "circuit-01", lap: 1, authoredIndex: 0, hitOrder: 0, cumulativeTimeSec: 10 },
          { checkpointId: "circuit-02", lap: 1, authoredIndex: 1, hitOrder: 1, cumulativeTimeSec: 20 },
          { checkpointId: "circuit-01", lap: 2, authoredIndex: 0, hitOrder: 2, cumulativeTimeSec: 30 },
          { checkpointId: "circuit-02", lap: 2, authoredIndex: 1, hitOrder: 3, cumulativeTimeSec: 40 },
          { checkpointId: "circuit-01", lap: 3, authoredIndex: 0, hitOrder: 4, cumulativeTimeSec: 50 },
          { checkpointId: "circuit-02", lap: 3, authoredIndex: 1, hitOrder: 5, cumulativeTimeSec: 60 },
        ],
      },
    ],
  };
}

function copySource(): Record<string, unknown> {
  return JSON.parse(JSON.stringify(validSource())) as Record<string, unknown>;
}

describe("parseMedalReference", () => {
  it("parses versioned course references and derives shared thresholds", () => {
    const result = parseMedalReference(JSON.stringify(validSource()), "fixture", "juliette-ga", routeIdentity);
    expect(result.handlingContentVersion).toBe("fixture-handling-v1");
    expect(result.courses[0].totalTimeSec).toBe(30);
    expect(result.courses[0].thresholds).toEqual({ ace: 27, gold: 30, silver: 34.5, bronze: 40.5 });
    expect(result.courses[0].splits.map((split) => split.hitOrder)).toEqual([0, 2, 1]);
    expect(result.courses[1].splits.map((split) => `${split.lap}:${split.checkpointId}`)).toHaveLength(6);
  });

  it.each([
    ["kind", (source: Record<string, unknown>) => (source.kind = "wrong")],
    ["version", (source: Record<string, unknown>) => (source.version = 2)],
    ["area", (source: Record<string, unknown>) => (source.areaId = "other")],
    ["contract", (source: Record<string, unknown>) => (source.contractVersion = 2)],
    ["handling", (source: Record<string, unknown>) => (source.handlingContentVersion = "")],
  ] as const)("rejects stale or invalid %s metadata", (_label, mutate) => {
    const source = copySource();
    mutate(source);
    expect(() => parseMedalReference(JSON.stringify(source), "fixture", "juliette-ga", routeIdentity)).toThrow();
  });

  it.each([
    ["duplicate checkpoint-lap key", (source: Record<string, unknown>) => {
      const course = (source.courses as Record<string, unknown>[])[1];
      const splits = course.splits as Record<string, unknown>[];
      splits[1].checkpointId = splits[0].checkpointId;
      splits[1].lap = splits[0].lap;
    }],
    ["missing checkpoint-lap key", (source: Record<string, unknown>) => {
      const course = (source.courses as Record<string, unknown>[])[1];
      (course.splits as Record<string, unknown>[]).pop();
    }],
    ["non-monotonic split", (source: Record<string, unknown>) => {
      const course = (source.courses as Record<string, unknown>[])[0];
      ((course.splits as Record<string, unknown>[])[1]).cumulativeTimeSec = 9;
    }],
    ["non-finite total", (source: Record<string, unknown>) => {
      const course = (source.courses as Record<string, unknown>[])[0];
      course.totalTimeSec = null;
    }],
    ["unknown course", (source: Record<string, unknown>) => {
      const course = (source.courses as Record<string, unknown>[])[0];
      course.courseId = "unknown-course";
    }],
  ] as const)("rejects invalid reference content: %s", (_label, mutate) => {
    const source = copySource();
    mutate(source);
    expect(() => parseMedalReference(JSON.stringify(source), "fixture", "juliette-ga", routeIdentity)).toThrow();
  });

  it("uses route checkpoint identity without parsing routes itself", () => {
    const graph = parseRoadGraph(
      JSON.stringify({ schemaVersion: 1, nodes: [], edges: [] }),
      "minimal-map",
    );
    expect(graph.nodes).toHaveLength(0);
    expect(() => parseMedalReference(JSON.stringify(validSource()), "fixture", "juliette-ga", routeIdentity)).not.toThrow();
    expect(routesRaw).toContain("juliette-backroads-run");
    expect(parseCourseData).toBeTypeOf("function");
  });
});