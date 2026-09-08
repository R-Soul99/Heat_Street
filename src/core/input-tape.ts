/**
 * Per-tick input latching, plus record and replay over the same mechanism.
 *
 * This is the subtle half of SC1 that a correct clock alone does not cover. If
 * input were sampled once per render frame, a 144 fps run would feed 144 distinct
 * samples per second into 60 fixed ticks while a 30 fps run fed 30 into the same
 * 60 ticks: the tick sequence is identical but the inputs to it are not, so end
 * states diverge for reasons that have nothing to do with timing. Keying every
 * sample on the integer tick index is what makes "the same recorded input" mean
 * something.
 *
 * Pure by construction: no renderer, no physics engine, no DOM, no wall clock.
 * A real keyboard/gamepad source is Phase 2's job and lives outside `src/core/`.
 */

/** One tick's resolved control state. Phase 2 fills in the real axis semantics. */
export interface InputFrame {
  /** Steering axis, -1 (full left) to 1 (full right). */
  readonly steer: number;
  /** Throttle axis, 0 to 1. */
  readonly throttle: number;
  /** Brake axis, 0 to 1. */
  readonly brake: number;
  /** Handbrake, latched for the whole tick. */
  readonly handbrake: boolean;
}

/** The all-zero frame. Frozen because it is handed out by reference as a gap filler. */
export const NEUTRAL: InputFrame = Object.freeze({
  steer: 0,
  throttle: 0,
  brake: 0,
  handbrake: false,
});

/** Anything the fixed tick can ask for a frame: live hardware, a tape, or a script. */
export interface InputSource {
  /** Resolve this tick's immutable frame. Must be stable for a given tick index. */
  sampleForTick(tick: number): InputFrame;
}

/**
 * Wraps a live source and keeps every frame it produced, indexed by tick.
 *
 * Sampling is idempotent per tick: asking twice returns the identical frame
 * reference without re-querying the live source, so the fixed tick and anything
 * else observing the same tick cannot disagree.
 */
export class RecordingInput implements InputSource {
  private readonly live: InputSource;
  private readonly tape: InputFrame[] = [];

  constructor(live: InputSource) {
    this.live = live;
  }

  sampleForTick(tick: number): InputFrame {
    if (tick < 0) {
      return NEUTRAL;
    }
    if (tick < this.tape.length) {
      return this.tape[tick];
    }
    // A skipped tick is recorded as NEUTRAL rather than shifting the tape, so a
    // frame's index always equals its tick index on replay.
    while (this.tape.length < tick) {
      this.tape.push(NEUTRAL);
    }
    const frame = this.live.sampleForTick(tick);
    this.tape.push(frame);
    return frame;
  }

  /** A defensive copy — callers must not be able to edit the recording in place. */
  frames(): readonly InputFrame[] {
    return this.tape.slice();
  }
}

/**
 * Plays a recorded tape back by tick index. Out-of-range ticks resolve to NEUTRAL
 * so a run that outlives its tape coasts rather than throwing.
 */
export class ReplayInput implements InputSource {
  private readonly tape: readonly InputFrame[];

  constructor(frames: readonly InputFrame[]) {
    this.tape = frames;
  }

  sampleForTick(tick: number): InputFrame {
    if (tick < 0 || tick >= this.tape.length) {
      return NEUTRAL;
    }
    return this.tape[tick];
  }
}
