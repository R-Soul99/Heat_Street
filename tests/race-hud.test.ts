import { describe, expect, it } from "vitest";
import { formatRaceStatus, type RaceStatusModel } from "../src/hud/race-hud";

function baseModel(overrides: Partial<RaceStatusModel> = {}): RaceStatusModel {
  return {
    position: 3,
    fieldSize: 4,
    lap: 2,
    totalLaps: 3,
    gapSec: 1.43,
    leading: false,
    finished: false,
    elapsedSec: 0,
    ...overrides,
  };
}

describe("formatRaceStatus", () => {
  it('formats position, lap and a trailing gap: "P3/4 · Lap 2/3 · +1.4s"', () => {
    expect(formatRaceStatus(baseModel())).toBe("P3/4 · Lap 2/3 · +1.4s");
  });

  it('formats a leading gap as negative: "P1/4 · Lap 2/3 · -0.8s"', () => {
    expect(formatRaceStatus(baseModel({ position: 1, leading: true, gapSec: 0.8 }))).toBe(
      "P1/4 · Lap 2/3 · -0.8s",
    );
  });

  it('formats a null gap as "--": "P2/4 · Lap 1/3 · --"', () => {
    expect(formatRaceStatus(baseModel({ position: 2, lap: 1, gapSec: null, leading: false }))).toBe(
      "P2/4 · Lap 1/3 · --",
    );
  });

  it("clamps lap 4 of 3 to Lap 3/3", () => {
    expect(formatRaceStatus(baseModel({ lap: 4, totalLaps: 3, gapSec: null }))).toBe(
      "P3/4 · Lap 3/3 · --",
    );
  });

  it('renders "P2/4 · FINISHED" when finished', () => {
    expect(formatRaceStatus(baseModel({ position: 2, finished: true }))).toBe("P2/4 · FINISHED");
  });
});
