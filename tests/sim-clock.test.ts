import { describe, expect, it } from "vitest";
import { DT, MAX_STEPS_PER_FRAME, SimClock } from "../src/core/sim-clock";

/**
 * Drives a clock with ABSOLUTE synthetic timestamps for `seconds` of frames at
 * `fps`. Mirrors what requestAnimationFrame hands the loop: a monotonic
 * DOMHighResTimeStamp, never a delta.
 */
function runAtFps(clock: SimClock, fps: number, seconds: number): void {
  for (let f = 1; f <= fps * seconds; f++) {
    clock.stepsFor((f / fps) * 1000);
  }
}

/**
 * The textbook `acc += frameDelta` accumulator, implemented HERE and never in
 * `src/` so the invariance assertion above is proven discriminating rather than
 * trivially green. 01-RESEARCH.md Pitfall 1 measured this variant at 599 ticks /
 * snapshot hash `e91b9ed3` at 144 fps versus 600 ticks / `e68ecce6` everywhere else.
 */
function naiveAccumulatorTicks(fps: number, seconds: number): number {
  const frameDelta = 1 / fps;
  let acc = 0;
  let tick = 0;
  for (let f = 1; f <= fps * seconds; f++) {
    acc += frameDelta;
    let steps = 0;
    while (acc >= DT && steps < MAX_STEPS_PER_FRAME) {
      tick++;
      steps++;
      acc -= DT;
    }
  }
  return tick;
}

/** 1 s of 60 fps play, ending at t = 1000 ms with tick === 60. */
function playOneSecond(clock: SimClock, baseMs: number): void {
  for (let k = 1; k <= 60; k++) {
    clock.stepsFor(baseMs + (k / 60) * 1000);
  }
}

/** The tab comes back at t = 61 s: 1 s of play plus a 60 s hidden stall. */
const RESUME_MS = 61_000;

const REFRESH_RATES = [30, 60, 75, 90, 120, 144, 165, 240];

describe("SimClock tick invariance (SC1)", () => {
  it.each(REFRESH_RATES)(
    "produces exactly 600 ticks over 10 simulated seconds at %i fps",
    (fps) => {
      const clock = new SimClock();
      clock.start(0);
      runAtFps(clock, fps, 10);
      expect(clock.tick).toBe(600);
    },
  );

  it("is discriminating: a delta-accumulating variant loses a tick at 144 fps", () => {
    expect(naiveAccumulatorTicks(60, 10)).toBe(600);
    expect(naiveAccumulatorTicks(144, 10)).toBe(599);
  });
});

describe("SimClock run clock is tick x DT", () => {
  it("reports simTimeSec as exactly tick * DT at several tick values", () => {
    const clock = new SimClock();
    clock.start(0);
    for (const targetTick of [1, 7, 60, 137, 600]) {
      clock.stepsFor(targetTick * DT * 1000);
      while (clock.tick < targetTick) {
        clock.stepsFor(targetTick * DT * 1000);
      }
      expect(clock.simTimeSec).toBe(clock.tick * DT);
    }
  });

  it("reports simTimeSec as 10 seconds after 600 ticks", () => {
    const clock = new SimClock();
    clock.start(0);
    runAtFps(clock, 60, 10);
    expect(clock.tick).toBe(600);
    expect(clock.simTimeSec).toBeCloseTo(10, 12);
  });

  it("never reads wall time: two clocks fed identical timestamps agree exactly", () => {
    const a = new SimClock();
    const b = new SimClock();
    a.start(0);
    b.start(0);
    runAtFps(a, 144, 3);
    runAtFps(b, 30, 3);
    expect(a.simTimeSec).toBe(b.simTimeSec);
  });
});

describe("SimClock clamp", () => {
  it("returns exactly MAX_STEPS_PER_FRAME when one frame jumps forward 1000 ms", () => {
    const clock = new SimClock();
    clock.start(0);
    expect(clock.stepsFor(1000)).toBe(MAX_STEPS_PER_FRAME);
    expect(clock.tick).toBe(MAX_STEPS_PER_FRAME);
  });
});

describe("SimClock stall recovery (SC3)", () => {
  it("fast-forwards to 300 ticks in the first second back with the clamp alone", () => {
    const clock = new SimClock();
    clock.start(0);
    playOneSecond(clock, 0);
    expect(clock.tick).toBe(60);

    // No rebaseline: the 3600-tick backlog is replayed 5 steps per frame.
    playOneSecond(clock, RESUME_MS);
    expect(clock.tick - 60).toBe(300);
    expect(clock.droppedTicks).toBe(0);
  });

  it("resumes 1:1 with exactly 60 ticks in the first second back after rebaseline", () => {
    const clock = new SimClock();
    clock.start(0);
    playOneSecond(clock, 0);
    expect(clock.tick).toBe(60);

    clock.rebaseline(RESUME_MS);
    playOneSecond(clock, RESUME_MS);
    expect(clock.tick - 60).toBe(60);
  });

  it("never rewinds the tick counter on rebaseline", () => {
    const clock = new SimClock();
    clock.start(0);
    playOneSecond(clock, 0);
    const before = clock.tick;
    clock.rebaseline(RESUME_MS);
    expect(clock.tick).toBe(before);
  });

  it("accounts a 60 second stall as ~3600 dropped ticks", () => {
    const clock = new SimClock();
    clock.start(0);
    playOneSecond(clock, 0);
    clock.rebaseline(RESUME_MS);
    expect(clock.droppedTicks).toBeGreaterThanOrEqual(3599);
    expect(clock.droppedTicks).toBeLessThanOrEqual(3601);
  });

  it("is a no-op when the clock is not behind", () => {
    const clock = new SimClock();
    clock.start(0);
    playOneSecond(clock, 0);
    clock.rebaseline(1000);
    const dropped = clock.droppedTicks;
    expect(dropped).toBe(0);
    clock.rebaseline(1000);
    expect(clock.droppedTicks).toBe(dropped);
  });
});

describe("SimClock alpha", () => {
  it("stays within [0, 1] across a 5 second sweep at 144 fps", () => {
    const clock = new SimClock();
    clock.start(0);
    for (let f = 1; f <= 144 * 5; f++) {
      const nowMs = (f / 144) * 1000;
      clock.stepsFor(nowMs);
      const a = clock.alpha(nowMs);
      expect(a).toBeGreaterThanOrEqual(0);
      expect(a).toBeLessThanOrEqual(1);
    }
  });

  it("is monotonically non-decreasing between two consecutive zero-step frames", () => {
    const clock = new SimClock();
    clock.start(0);
    let previous: { alpha: number; steps: number } | null = null;
    let comparisons = 0;
    for (let f = 1; f <= 144 * 5; f++) {
      const nowMs = (f / 144) * 1000;
      const steps = clock.stepsFor(nowMs);
      const alpha = clock.alpha(nowMs);
      if (previous !== null && previous.steps === 0 && steps === 0) {
        expect(alpha).toBeGreaterThanOrEqual(previous.alpha);
        comparisons++;
      }
      previous = { alpha, steps };
    }
    // At 144 fps most frames run zero steps, so this must actually have compared.
    expect(comparisons).toBeGreaterThan(100);
  });
});
