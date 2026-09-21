import { describe, expect, it } from "vitest";
import {
  classifyMedal,
  createMedalTiming,
  FIRST_MOVEMENT_SPEED_MS,
  MEDAL_CONTRACT_VERSION,
  medalThresholds,
} from "../src/core/medal-timing";

describe("medal contract", () => {
  it("keeps the percentage bands versioned and inclusive", () => {
    expect(MEDAL_CONTRACT_VERSION).toBe(1);
    expect(classifyMedal(90, 100)).toBe("ace");
    expect(classifyMedal(100, 100)).toBe("gold");
    expect(classifyMedal(115, 100)).toBe("silver");
    expect(classifyMedal(135, 100)).toBe("bronze");
    expect(classifyMedal(135.001, 100)).toBe("none");
    expect(medalThresholds(0)).toBeNull();
    expect(medalThresholds(Number.NaN)).toBeNull();
    expect(classifyMedal(-1, 100)).toBe("none");
    expect(classifyMedal(10, Number.POSITIVE_INFINITY)).toBe("none");
  });

  it("starts only at the first qualifying fixed tick", () => {
    const timing = createMedalTiming({ referenceTimeSec: 100 });

    expect(timing.update({ simTimeSec: 30, speedMs: 0 }).phase).toBe("pre-drive");
    const started = timing.update({
      simTimeSec: 42,
      speedMs: FIRST_MOVEMENT_SPEED_MS,
    });

    expect(started.startedAtSimSec).toBe(42);
    expect(started.baseElapsedSec).toBe(0);
    expect(timing.update({ simTimeSec: 47, speedMs: 4 }).baseElapsedSec).toBe(5);
  });

  it.each([30, 60, 144])("uses absolute simulation samples at %i render Hz", (renderRate) => {
    const timing = createMedalTiming({ referenceTimeSec: 5 });
    const sampleTicks = [60, 120, 240, 360];
    for (const tick of sampleTicks) {
      // The render rate only changes how often these already-fixed samples are observed.
      if (tick % Math.max(1, Math.round(60 / renderRate)) === 0) {
        timing.update({ simTimeSec: tick / 60, speedMs: tick === 60 ? 1 : 8 });
      }
    }
    timing.update({ simTimeSec: 6, speedMs: 8, complete: true });
    expect(timing.snapshot().effectiveElapsedSec).toBe(5);
    expect(timing.snapshot().completion?.medal).toBe("gold");
  });

  it("rejects backwards fixed-clock samples without negative time", () => {
    const timing = createMedalTiming({ referenceTimeSec: 20 });
    timing.update({ simTimeSec: 5, speedMs: 1 });
    timing.update({ simTimeSec: 8, speedMs: 1 });
    const snapshot = timing.update({ simTimeSec: 2, speedMs: 1 });

    expect(snapshot.baseElapsedSec).toBe(3);
    expect(snapshot.effectiveElapsedSec).toBe(3);
  });
});

describe("attempt lifecycle", () => {
  it("applies each respawn penalty once and restart clears every attempt field", () => {
    const timing = createMedalTiming({ referenceTimeSec: 100 });

    timing.respawn();
    expect(timing.snapshot().penaltySec).toBe(5);
    timing.update({ simTimeSec: 10, speedMs: 1 });
    timing.respawn();
    expect(timing.update({ simTimeSec: 15, speedMs: 1 }).effectiveElapsedSec).toBe(15);

    const restarted = timing.restart();
    expect(restarted).toMatchObject({
      phase: "pre-drive",
      startedAtSimSec: null,
      baseElapsedSec: 0,
      penaltySec: 0,
      sectors: [],
      completion: null,
    });
  });

  it("does not double-count a race snapshot penalty", () => {
    const timing = createMedalTiming({ referenceTimeSec: 100 });
    timing.update({ simTimeSec: 10, speedMs: 1, penaltySec: 5 });
    const snapshot = timing.update({ simTimeSec: 20, speedMs: 1, penaltySec: 5 });

    expect(snapshot.baseElapsedSec).toBe(10);
    expect(snapshot.penaltySec).toBe(5);
    expect(snapshot.effectiveElapsedSec).toBe(15);
  });

  it("freezes completion time, medal, and sectors", () => {
    const timing = createMedalTiming({ referenceTimeSec: 5 });
    timing.update({ simTimeSec: 1, speedMs: 1 });
    timing.update({ simTimeSec: 4, speedMs: 1, checkpoint: { checkpointId: "a" } });
    const completed = timing.complete(6);
    const later = timing.update({
      simTimeSec: 100,
      speedMs: 20,
      complete: false,
      checkpoint: { checkpointId: "ignored" },
    });

    expect(completed.completion).toEqual({
      effectiveTimeSec: 5,
      medal: "gold",
      sectors: [expect.objectContaining({ checkpointId: "a" })],
      slowestSectorOrdinal: 0,
    });
    expect(later).toEqual(completed);
  });
});

describe("checkpoint sectors", () => {
  it("records P2P accepted order and comparison source", () => {
    const timing = createMedalTiming({ referenceTimeSec: 20 });
    timing.update({ simTimeSec: 2, speedMs: 1 });
    timing.recordCheckpoint(5, {
      checkpointId: "c",
      comparison: { source: "personal-best", cumulativeSec: 4 },
    });
    const snapshot = timing.recordCheckpoint(9, {
      checkpointId: "a",
      fromCheckpointId: "c",
      comparison: { source: "reference", cumulativeSec: 8 },
    });

    expect(snapshot.sectors).toMatchObject([
      {
        checkpointId: "c",
        fromCheckpointId: null,
        sectorElapsedSec: 3,
        cumulativeElapsedSec: 3,
        deltaSec: -1,
        comparisonSource: "personal-best",
      },
      {
        checkpointId: "a",
        fromCheckpointId: "c",
        sectorElapsedSec: 4,
        cumulativeElapsedSec: 7,
        deltaSec: -1,
        comparisonSource: "reference",
      },
    ]);
  });

  it("keeps Circuit lap identity for all 15 sectors and chooses one slowest", () => {
    const timing = createMedalTiming({ referenceTimeSec: 100 });
    timing.update({ simTimeSec: 0, speedMs: 1 });
    for (let lap = 1; lap <= 3; lap++) {
      for (let checkpoint = 1; checkpoint <= 5; checkpoint++) {
        const ordinal = (lap - 1) * 5 + checkpoint - 1;
        timing.recordCheckpoint(ordinal + 1, {
          checkpointId: `checkpoint-${checkpoint}`,
          lap,
          ordinal,
        });
      }
    }
    const completed = timing.complete(16);

    expect(completed.sectors).toHaveLength(15);
    expect(completed.sectors[0]).toMatchObject({ lap: 1, checkpointId: "checkpoint-1" });
    expect(completed.sectors[5]).toMatchObject({ lap: 2, checkpointId: "checkpoint-1" });
    expect(completed.sectors[10]).toMatchObject({ lap: 3, checkpointId: "checkpoint-1" });
    expect(completed.completion?.slowestSectorOrdinal).toBe(0);
  });
});
