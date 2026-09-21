import { describe, expect, it } from "vitest";
import type { Course } from "../src/core/course";
import { buildCourseCardModels, buildResultRows, formatResultTime } from "../src/hud/results-view";

const courses: Course[] = [
  {
    id: "p2p",
    name: "Backroads Run",
    mode: "p2p",
    laps: 1,
    checkpoints: [],
    start: { nodeId: 0, headingRad: 0 },
  },
  {
    id: "circuit",
    name: "Three-Lap Loop",
    mode: "circuit",
    laps: 3,
    checkpoints: [],
    start: { nodeId: 0, headingRad: 0 },
  },
];
const references = courses.map((course) => ({
  courseId: course.id,
  mode: course.mode,
  laps: course.laps,
  totalTimeSec: course.mode === "p2p" ? 180 : 420,
  thresholds:
    course.mode === "p2p"
      ? { ace: 162, gold: 180, silver: 207, bronze: 243 }
      : { ace: 378, gold: 420, silver: 483, bronze: 567 },
  splits: [],
}));

describe("results view models", () => {
  it("builds both course cards with explicit unavailable progress", () => {
    const cards = buildCourseCardModels(
      courses,
      references,
      { p2p: { courseId: "p2p", bestTimeSec: 171.2, medal: "gold" } },
      "p2p",
    );
    expect(cards).toHaveLength(2);
    expect(cards[0]).toMatchObject({ bestTimeSec: 171.2, medal: "gold", selected: true });
    expect(cards[1]).toMatchObject({ bestTimeSec: null, medal: null, selected: false });
    expect(formatResultTime(cards[1].bestTimeSec)).toBe("UNAVAILABLE");
    expect(cards[1].thresholds).toEqual({ ace: 378, gold: 420, silver: 483, bronze: 567 });
  });

  it("formats medal labels and highlights only the slowest result row", () => {
    const rows = buildResultRows({
      effectiveTimeSec: 100,
      medal: "silver",
      slowestSectorOrdinal: 1,
      sectors: [
        {
          checkpointId: "a",
          fromCheckpointId: null,
          ordinal: 0,
          lap: 1,
          sectorElapsedSec: 20,
          cumulativeElapsedSec: 20,
          deltaSec: -1,
          comparisonSource: "reference",
        },
        {
          checkpointId: "b",
          fromCheckpointId: "a",
          ordinal: 1,
          lap: 2,
          sectorElapsedSec: 40,
          cumulativeElapsedSec: 60,
          deltaSec: 2.5,
          comparisonSource: "personal-best",
        },
      ],
    });
    expect(rows.map((row) => row.slowest)).toEqual([false, true]);
    expect(rows[1]).toMatchObject({ label: "L2 a->b", deltaSec: 2.5 });
    expect(formatResultTime(62.346)).toBe("1:02.35");
  });
});
