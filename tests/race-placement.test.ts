import { describe, expect, it } from "vitest";
import {
  computeStandings,
  createGapTracker,
  createProgressTracker,
  GAP_MILESTONE_M,
  LEG_BACKTRACK_M,
  type StandingInput,
} from "../src/core/race-placement";
import type { RaceSnapshot } from "../src/core/race-state";
import type { RacingLine, RacingLinePoint } from "../src/core/racing-line";

/**
 * Synthetic closed-loop RacingLine fixture (400 m lap, 4 checkpoints at arcs
 * 100/200/300/400). Two halves are geometrically DISTINCT shapes on purpose:
 * arcs [0,200) run a straight line z=0 (x = arc), arcs [200,400) run a
 * near-parallel return line z=1 (x = 400 - arc) — close enough in XZ space
 * that an UNRESTRICTED nearest-point search across the whole line would pick
 * a point from the wrong leg, which is exactly what the leg-restriction
 * behavior (07-RESEARCH.md Pattern 7 / this plan's Task 1 behavior list)
 * must prevent.
 */
function makePoint(arcM: number): RacingLinePoint {
  const x = arcM < 200 ? arcM : 400 - arcM;
  const z = arcM < 200 ? 0 : 1;
  return Object.freeze({
    x,
    y: 0,
    z,
    centreX: x,
    centreZ: z,
    halfWidthM: 5,
    surface: "tarmac",
    arcM,
    curvature: 0,
    targetSpeedMs: 20,
  });
}

function makeLine(): RacingLine {
  const points: RacingLinePoint[] = [];
  for (let arcM = 0; arcM < 400; arcM += 10) points.push(makePoint(arcM));
  return Object.freeze({
    courseId: "test-square",
    points: Object.freeze(points),
    lapLengthM: 400,
    checkpointArcM: Object.freeze([100, 200, 300, 400]),
  });
}

const CHECKPOINT_IDS = ["c0", "c1", "c2", "c3"] as const;

function makeRace(overrides: Partial<RaceSnapshot>): RaceSnapshot {
  return Object.freeze({
    mode: "circuit",
    currentTargetId: "c0",
    visitedIds: Object.freeze([]),
    lap: 1,
    totalLaps: 3,
    complete: false,
    wrongWay: false,
    respawnAnchorId: null,
    penaltySec: 0,
    ...overrides,
  });
}

describe("race-placement constants", () => {
  it("LEG_BACKTRACK_M is 60 and GAP_MILESTONE_M is 20", () => {
    expect(LEG_BACKTRACK_M).toBe(60);
    expect(GAP_MILESTONE_M).toBe(20);
  });
});

describe("createProgressTracker", () => {
  it("a car targeting checkpoint 0 on lap 1 at arc 50 has progress 50", () => {
    const tracker = createProgressTracker(makeLine(), [...CHECKPOINT_IDS]);
    const race = makeRace({ currentTargetId: "c0", lap: 1 });
    expect(tracker.update(race, 50, 0)).toBeCloseTo(50);
  });

  it("at lap 2 targeting checkpoint 2 at arc 250 has progress 650", () => {
    const tracker = createProgressTracker(makeLine(), [...CHECKPOINT_IDS]);
    const race = makeRace({ currentTargetId: "c2", lap: 2 });
    // arc 250 is in the [200,400) branch: x = 400-250 = 150, z = 1.
    expect(tracker.update(race, 150, 1)).toBeCloseTo(650);
  });

  it("a car 20 m behind the start line on lap 1 has progress -20", () => {
    const tracker = createProgressTracker(makeLine(), [...CHECKPOINT_IDS]);
    const race = makeRace({ currentTargetId: "c0", lap: 1 });
    // arc 380 (20 m behind lap length 400): x = 400-380 = 20, z = 1.
    expect(tracker.update(race, 20, 1)).toBeCloseTo(-20);
  });

  it("a completed race returns totalLaps * lapLengthM", () => {
    const tracker = createProgressTracker(makeLine(), [...CHECKPOINT_IDS]);
    const race = makeRace({ complete: true, currentTargetId: null, totalLaps: 3 });
    expect(tracker.update(race, 999, 999)).toBe(3 * 400);
  });

  it("restricts the progress search to the current leg, so a car geometrically near another part of the loop is not mis-projected", () => {
    const tracker = createProgressTracker(makeLine(), [...CHECKPOINT_IDS]);
    const race = makeRace({ currentTargetId: "c0", lap: 1 });
    // (150, 0) is EXACTLY on the line at arc 150 (distance 0), but arc 150
    // is outside c0's own leg range ([-60,100]). Restricted to that leg, the
    // nearest candidate is arc 100 (100, 0), distance 50 -> progress 100.
    expect(tracker.update(race, 150, 0)).toBeCloseTo(100);
  });
});

describe("computeStandings", () => {
  it("orders finished racers first by finishEffectiveSec ascending, then unfinished by progressM descending, ties by racerIndex ascending", () => {
    const inputs: readonly StandingInput[] = [
      { racerIndex: 0, finishEffectiveSec: null, progressM: 300 },
      { racerIndex: 1, finishEffectiveSec: 120, progressM: 1200 },
      { racerIndex: 2, finishEffectiveSec: 100, progressM: 1200 },
      { racerIndex: 3, finishEffectiveSec: null, progressM: 300 },
    ];
    const standings = computeStandings(inputs);
    expect(standings.map((s) => s.racerIndex)).toEqual([2, 1, 0, 3]);
    expect(standings.map((s) => s.position)).toEqual([1, 2, 3, 4]);
    expect(standings.map((s) => s.finished)).toEqual([true, true, false, false]);
    expect(Object.isFrozen(standings)).toBe(true);
    expect(Object.isFrozen(standings[0])).toBe(true);
  });

  it("positions are exactly 1..N", () => {
    const inputs: readonly StandingInput[] = [
      { racerIndex: 0, finishEffectiveSec: null, progressM: 10 },
      { racerIndex: 1, finishEffectiveSec: null, progressM: 50 },
    ];
    const standings = computeStandings(inputs);
    expect(standings.map((s) => s.position)).toEqual([1, 2]);
    expect(standings.map((s) => s.racerIndex)).toEqual([1, 0]);
  });
});

describe("createGapTracker", () => {
  it("gapSec(behind, ahead) is time-based at shared 20 m milestones", () => {
    const gap = createGapTracker(2);
    // Racer A (ahead) passes 0/20/40 m at t = 1/2/3 s.
    gap.record(0, 0, 1);
    gap.record(0, 20, 2);
    gap.record(0, 40, 3);
    // Racer B (behind) passes 0/20 m at t = 1.5/2.8 s.
    gap.record(1, 0, 1.5);
    gap.record(1, 20, 2.8);
    expect(gap.gapSec(1, 0)).toBeCloseTo(0.8);
  });

  it("returns null when the ahead racer has not reached the behind racer's latest milestone", () => {
    const gap = createGapTracker(2);
    gap.record(0, 0, 1);
    gap.record(1, 0, 1.5);
    gap.record(1, 20, 2.8);
    // Racer 0 (ahead) has only reached milestone 0; racer 1 (behind) is at
    // milestone 1 (20 m) -> no shared data at that milestone yet.
    expect(gap.gapSec(1, 0)).toBeNull();
  });

  it("returns null when the behind racer has not recorded any milestone", () => {
    const gap = createGapTracker(2);
    gap.record(0, 0, 1);
    expect(gap.gapSec(1, 0)).toBeNull();
  });

  it("truncate(B, 5) drops B's milestones above 0, so B's re-pass records fresh times", () => {
    const gap = createGapTracker(2);
    gap.record(1, 0, 1);
    gap.record(1, 20, 2);
    gap.record(1, 40, 3);
    gap.truncate(1, 5);
    // Re-pass milestone 0 (still 0 <= 5) keeps the truncated value; re-record
    // milestone 1 (20 m) with a fresh, later time.
    gap.record(1, 20, 10);
    gap.record(0, 0, 1);
    gap.record(0, 20, 1.5);
    expect(gap.gapSec(1, 0)).toBeCloseTo(10 - 1.5);
  });

  it("reset() clears everything", () => {
    const gap = createGapTracker(2);
    gap.record(0, 0, 1);
    gap.record(1, 0, 1.5);
    gap.reset();
    expect(gap.gapSec(1, 0)).toBeNull();
  });

  it("negative progress records nothing", () => {
    const gap = createGapTracker(2);
    gap.record(0, -20, 5);
    gap.record(1, 0, 1);
    expect(gap.gapSec(1, 0)).toBeNull();
  });
});
