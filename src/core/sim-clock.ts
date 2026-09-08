/**
 * The fixed-timestep simulation clock. Pure: zero dependencies, no DOM, no
 * wall-clock read. Every timestamp arrives as a `nowMs` parameter, which is what
 * makes phase 01 success criteria SC1 and SC3 testable in Node instead of by eye.
 *
 * See `.planning/phases/01-engine-foundation/01-RESEARCH.md` Pattern 1, Pattern 2
 * and Pattern 5 — the class body below was executed and measured across eight
 * refresh rates before it was written down. Do not "improve" it; see the notes on
 * `stepsFor` and `rebaseline`.
 */

/** Fixed simulation timestep, in seconds. The physics world timestep must equal this. */
export const DT = 1 / 60;

/**
 * Upper bound on fixed steps executed in a single render frame. Protects against
 * the spiral of death on one slow frame. It does NOT protect against a long stall —
 * that is what `rebaseline` is for, and the two are not interchangeable.
 */
export const MAX_STEPS_PER_FRAME = 5;

export class SimClock {
  /** Monotonically increasing simulation tick index. Never rewinds. */
  tick = 0;

  /** Ticks discarded by `rebaseline`. Surfaced in the HUD so stalls stay visible. */
  droppedTicks = 0;

  /** Wall-clock ms corresponding to tick 0. Moves forward on `rebaseline`. */
  private originMs = 0;

  /** Anchors tick 0 to an absolute timestamp. Called on the loop's first frame. */
  start(nowMs: number): void {
    this.originMs = nowMs;
    this.tick = 0;
  }

  /**
   * How many fixed steps to run this frame, advancing `tick` by that amount.
   *
   * ABSOLUTE clock: the target is recomputed from `nowMs` on every call, so
   * floating-point error never accumulates. An `acc += frameDelta` rewrite loses a
   * tick at 144 fps (measured: 599 ticks / snapshot hash `e91b9ed3` versus 600 /
   * `e68ecce6`), which is a direct SC1 failure.
   *
   * There is deliberately no epsilon in the loop condition. Subtracting `DT * 0.5`
   * was tested at all eight refresh rates and changed nothing; an unexplained
   * epsilon here is a review smell, not a safety margin.
   */
  stepsFor(nowMs: number): number {
    const elapsedSec = (nowMs - this.originMs) / 1000;
    let steps = 0;
    while (this.tick * DT < elapsedSec && steps < MAX_STEPS_PER_FRAME) {
      this.tick++;
      steps++;
    }
    return steps;
  }

  /** Render interpolation factor between tick - 1 and tick, clamped to [0, 1]. */
  alpha(nowMs: number): number {
    const elapsedSec = (nowMs - this.originMs) / 1000;
    const a = (elapsedSec - (this.tick - 1) * DT) / DT;
    return a < 0 ? 0 : a > 1 ? 1 : a;
  }

  /**
   * Redefines "now" as the current tick, discarding the backlog rather than
   * replaying it. Called when the tab becomes visible again, and as a safety net
   * when the step clamp saturates for a sustained run of frames.
   *
   * Without this, a 60 second stall leaves a 3600-tick backlog that the clamp
   * replays at 5 steps per frame — 300 ticks in the first second back instead of
   * 60, a five-times fast-forward lasting roughly twelve real seconds. That is the
   * exact SC3 failure. `tick` is never touched here.
   */
  rebaseline(nowMs: number): void {
    const behindSec = (nowMs - this.originMs) / 1000 - this.tick * DT;
    if (behindSec > 0) {
      this.droppedTicks += Math.floor(behindSec / DT);
      this.originMs = nowMs - this.tick * DT * 1000;
    }
  }

  /**
   * THE run clock. Lap times, splits, medal times and the heat timer all derive
   * from this and nothing else, which is what makes "same elapsed time at every
   * refresh rate" definitionally true rather than approximately true.
   */
  get simTimeSec(): number {
    return this.tick * DT;
  }
}
