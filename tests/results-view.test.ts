import { describe, expect, it } from "vitest";
import type { Course } from "../src/core/course";
import {
  buildCourseCardModels,
  buildRaceCardModel,
  buildRaceClassificationRows,
  buildResultRows,
  buildStageResultLines,
  formatResultTime,
} from "../src/hud/results-view";

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

describe("circuit race view models (07-07)", () => {
  const circuit = courses[1];

  it("builds the race card from the race record, or null for both when absent", () => {
    const withRecord = buildRaceCardModel(
      circuit,
      "circuit.race",
      {
        "circuit.race": {
          courseId: "circuit.race",
          bestTimeSec: 483.12,
          medal: "none",
          bestFinish: 2,
        },
      },
      "circuit.race",
      4,
    );
    expect(withRecord).toEqual({
      courseId: "circuit.race",
      title: "Three-Lap Loop",
      modeLabel: "CIRCUIT RACE",
      bestTimeSec: 483.12,
      bestFinish: 2,
      fieldSize: 4,
      selected: true,
    });

    const absent = buildRaceCardModel(
      circuit,
      "circuit.race",
      { circuit: { courseId: "circuit", bestTimeSec: 470, medal: "silver" } },
      "circuit",
      4,
    );
    expect(absent).toMatchObject({ bestTimeSec: null, bestFinish: null, selected: false });
  });

  it("renders finished and projected classification rows", () => {
    const rows = buildRaceClassificationRows(
      [
        { position: 1, racerIndex: 3, isPlayer: true, effectiveSec: 481.22, projected: false },
        { position: 2, racerIndex: 0, isPlayer: false, effectiveSec: 483.5, projected: false },
        { position: 3, racerIndex: 2, isPlayer: false, effectiveSec: null, projected: true },
      ],
      ["POLICE BLUE", "RACING GREEN", "HIGHWAY YELLOW", "YOU"],
    );
    expect(rows[0]).toEqual({ text: "P1  YOU  8:01.22", isPlayer: true, projected: false });
    expect(rows[1].text).toBe("P2  POLICE BLUE  8:03.50");
    expect(rows[2]).toEqual({
      text: "P3  HIGHWAY YELLOW  PROJECTED",
      isPlayer: false,
      projected: true,
    });
  });
});

describe("buildStageResultLines", () => {
  const sector = (id: string, cum: number) =>
    ({
      checkpointId: id,
      fromCheckpointId: null,
      ordinal: 0,
      lap: 1,
      sectorElapsedSec: cum,
      cumulativeElapsedSec: cum,
      deltaSec: null,
      comparisonSource: null,
    }) as never;
  const base = {
    name: "Dust Run",
    effectiveTimeSec: 77.48,
    penaltySec: 5,
    medal: "none" as const,
    medalsShown: false,
    newBest: true,
    bestSec: 77.48,
    sectors: [sector("g1", 20), sector("g2", 40), sector("f", 72.48)],
    gateCount: 2,
  };

  it("lists time, penalty, final, new best and splits in order", () => {
    expect(buildStageResultLines(base)).toEqual([
      "STAGE COMPLETE",
      "Dust Run",
      "TIME  1:12.48",
      "PENALTY  +0:05.00",
      "FINAL  1:17.48",
      "NEW BEST",
      "G1  0:20.00",
      "G2  0:40.00",
      "FINISH  1:12.48",
    ]);
  });

  it("has no medal text when medals are not shown", () => {
    expect(buildStageResultLines(base).some((l) => /UNEARNED|MEDAL|NONE/.test(l))).toBe(false);
  });

  it("shows the medal right after FINAL when medals are shown", () => {
    const lines = buildStageResultLines({ ...base, medalsShown: true, medal: "gold" });
    expect(lines[lines.indexOf("FINAL  1:17.48") + 1]).toBe("MEDAL  GOLD");
  });

  it("shows PB when not a new best, nothing when there is no best", () => {
    expect(buildStageResultLines({ ...base, newBest: false, bestSec: 70 })).toContain(
      "PB  1:10.00",
    );
    expect(
      buildStageResultLines({ ...base, newBest: false, bestSec: null }).some((l) =>
        l.startsWith("PB"),
      ),
    ).toBe(false);
  });

  it("always shows the penalty row", () => {
    expect(buildStageResultLines({ ...base, penaltySec: 0 })).toContain("PENALTY  +0:00.00");
  });
});
