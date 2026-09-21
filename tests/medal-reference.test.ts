import { describe, expect, it } from "vitest";
import medalReferenceRaw from "../public/maps/juliette-ga.medals.json?raw";
import routesRaw from "../public/maps/juliette-ga.routes.json?raw";
import {
  MEDAL_REFERENCE_KIND,
  MEDAL_REFERENCE_VERSION,
  type MedalReferenceCourseExpectation,
  parseMedalReference,
} from "../src/core/medal-reference";
import { MEDAL_CONTRACT_VERSION } from "../src/core/medal-timing";

const routeIdentity: readonly MedalReferenceCourseExpectation[] = [
  {
    courseId: "juliette-backroads-run",
    mode: "p2p",
    laps: 1,
    checkpointIds: [
      "p2p-01",
      "p2p-02",
      "p2p-03",
      "p2p-04",
      "p2p-05",
      "p2p-06",
      "p2p-07",
    ],
  },
  {
    courseId: "juliette-three-lap-loop",
    mode: "circuit",
    laps: 3,
    checkpointIds: [
      "circuit-01",
      "circuit-02",
      "circuit-03",
      "circuit-04",
      "circuit-05",
    ],
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
          { checkpointId: "p2p-02", lap: 1, authoredIndex: 1, hitOrder: 2, cumulativeTimeSec: 14 },
          { checkpointId: "p2p-03", lap: 1, authoredIndex: 2, hitOrder: 1, cumulativeTimeSec: 18 },
          { checkpointId: "p2p-04", lap: 1, authoredIndex: 3, hitOrder: 3, cumulativeTimeSec: 21 },
          { checkpointId: "p2p-05", lap: 1, authoredIndex: 4, hitOrder: 4, cumulativeTimeSec: 24 },
          { checkpointId: "p2p-06", lap: 1, authoredIndex: 5, hitOrder: 5, cumulativeTimeSec: 27 },
          { checkpointId: "p2p-07", lap: 1, authoredIndex: 6, hitOrder: 6, cumulativeTimeSec: 30 },
        ],
      },
      {
        courseId: "juliette-three-lap-loop",
        mode: "circuit",
        laps: 3,
        totalTimeSec: 85,
        splits: [
          {
            checkpointId: "circuit-01",
            lap: 1,
            authoredIndex: 0,
            hitOrder: 0,
            cumulativeTimeSec: 10,
          },
          {
            checkpointId: "circuit-02",
            lap: 1,
            authoredIndex: 1,
            hitOrder: 1,
            cumulativeTimeSec: 20,
          },
          {
            checkpointId: "circuit-03",
            lap: 1,
            authoredIndex: 2,
            hitOrder: 2,
            cumulativeTimeSec: 25,
          },
          {
            checkpointId: "circuit-04",
            lap: 1,
            authoredIndex: 3,
            hitOrder: 3,
            cumulativeTimeSec: 30,
          },
          {
            checkpointId: "circuit-05",
            lap: 1,
            authoredIndex: 4,
            hitOrder: 4,
            cumulativeTimeSec: 35,
          },
          {
            checkpointId: "circuit-01",
            lap: 2,
            authoredIndex: 0,
            hitOrder: 5,
            cumulativeTimeSec: 40,
          },
          {
            checkpointId: "circuit-02",
            lap: 2,
            authoredIndex: 1,
            hitOrder: 6,
            cumulativeTimeSec: 45,
          },
          {
            checkpointId: "circuit-03",
            lap: 2,
            authoredIndex: 2,
            hitOrder: 7,
            cumulativeTimeSec: 50,
          },
          {
            checkpointId: "circuit-04",
            lap: 2,
            authoredIndex: 3,
            hitOrder: 8,
            cumulativeTimeSec: 55,
          },
          {
            checkpointId: "circuit-05",
            lap: 2,
            authoredIndex: 4,
            hitOrder: 9,
            cumulativeTimeSec: 60,
          },
          {
            checkpointId: "circuit-01",
            lap: 3,
            authoredIndex: 0,
            hitOrder: 10,
            cumulativeTimeSec: 65,
          },
          {
            checkpointId: "circuit-02",
            lap: 3,
            authoredIndex: 1,
            hitOrder: 11,
            cumulativeTimeSec: 70,
          },
          {
            checkpointId: "circuit-03",
            lap: 3,
            authoredIndex: 2,
            hitOrder: 12,
            cumulativeTimeSec: 75,
          },
          {
            checkpointId: "circuit-04",
            lap: 3,
            authoredIndex: 3,
            hitOrder: 13,
            cumulativeTimeSec: 80,
          },
          {
            checkpointId: "circuit-05",
            lap: 3,
            authoredIndex: 4,
            hitOrder: 14,
            cumulativeTimeSec: 85,
          },
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
    const result = parseMedalReference(
      JSON.stringify(validSource()),
      "fixture",
      "juliette-ga",
      routeIdentity,
    );
    expect(result.handlingContentVersion).toBe("fixture-handling-v1");
    expect(result.courses[0].totalTimeSec).toBe(30);
    expect(result.courses[0].thresholds).toEqual({ ace: 27, gold: 30, silver: 34.5, bronze: 40.5 });
    expect(result.courses[0].splits.map((split) => split.hitOrder)).toEqual([0, 2, 1, 3, 4, 5, 6]);
    expect(
      result.courses[1].splits.map((split) => `${split.lap}:${split.checkpointId}`),
    ).toHaveLength(15);
  });

  it.each([
    [
      "kind",
      (source: Record<string, unknown>): void => {
        source.kind = "wrong";
      },
    ],
    [
      "version",
      (source: Record<string, unknown>): void => {
        source.version = 2;
      },
    ],
    [
      "area",
      (source: Record<string, unknown>): void => {
        source.areaId = "other";
      },
    ],
    [
      "contract",
      (source: Record<string, unknown>): void => {
        source.contractVersion = 2;
      },
    ],
    [
      "handling",
      (source: Record<string, unknown>): void => {
        source.handlingContentVersion = "";
      },
    ],
  ] as const)("rejects stale or invalid %s metadata", (_label, mutate) => {
    const source = copySource();
    mutate(source);
    expect(() =>
      parseMedalReference(JSON.stringify(source), "fixture", "juliette-ga", routeIdentity),
    ).toThrow();
  });

  it.each([
    [
      "duplicate checkpoint-lap key",
      (source: Record<string, unknown>) => {
        const course = (source.courses as Record<string, unknown>[])[1];
        const splits = course.splits as Record<string, unknown>[];
        splits[1].checkpointId = splits[0].checkpointId;
        splits[1].lap = splits[0].lap;
      },
    ],
    [
      "missing checkpoint-lap key",
      (source: Record<string, unknown>) => {
        const course = (source.courses as Record<string, unknown>[])[1];
        (course.splits as Record<string, unknown>[]).pop();
      },
    ],
    [
      "non-monotonic split",
      (source: Record<string, unknown>) => {
        const course = (source.courses as Record<string, unknown>[])[0];
        (course.splits as Record<string, unknown>[])[1].cumulativeTimeSec = 9;
      },
    ],
    [
      "non-finite total",
      (source: Record<string, unknown>) => {
        const course = (source.courses as Record<string, unknown>[])[0];
        course.totalTimeSec = null;
      },
    ],
    [
      "unknown course",
      (source: Record<string, unknown>) => {
        const course = (source.courses as Record<string, unknown>[])[0];
        course.courseId = "unknown-course";
      },
    ],
  ] as const)("rejects invalid reference content: %s", (_label, mutate) => {
    const source = copySource();
    mutate(source);
    expect(() =>
      parseMedalReference(JSON.stringify(source), "fixture", "juliette-ga", routeIdentity),
    ).toThrow();
  });

  it("uses route checkpoint identity without parsing routes itself", () => {
    expect(() =>
      parseMedalReference(JSON.stringify(validSource()), "fixture", "juliette-ga", routeIdentity),
    ).not.toThrow();
    expect(routesRaw).toContain("juliette-backroads-run");
    expect(routesRaw).toContain("circuit-02");
  });

  it("accepts the committed Juliette reference sidecar with complete course data", () => {
    const result = parseMedalReference(
      medalReferenceRaw,
      "public/maps/juliette-ga.medals.json",
      "juliette-ga",
      routeIdentity,
    );
    expect(result.handlingContentVersion).toBe("260920-sm2");
    expect(result.courses).toHaveLength(2);
    expect(result.courses[0].splits).toHaveLength(7);
    expect(result.courses[1].splits).toHaveLength(15);
    expect(result.courses[0].thresholds.ace).toBeCloseTo(162);
    expect(result.courses[0].thresholds.gold).toBeCloseTo(180);
    expect(result.courses[0].thresholds.silver).toBeCloseTo(207);
    expect(result.courses[0].thresholds.bronze).toBeCloseTo(243);
    expect(result.courses[1].thresholds.ace).toBeCloseTo(378);
    expect(result.courses[1].thresholds.gold).toBeCloseTo(420);
    expect(result.courses[1].thresholds.silver).toBeCloseTo(483);
    expect(result.courses[1].thresholds.bronze).toBeCloseTo(567);
  });
});
