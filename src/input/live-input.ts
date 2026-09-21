/**
 * The live keyboard + gamepad `InputSource`. Keyboard steering ramps to full
 * lock over a fixed, DT-driven duration; a connected gamepad's analog axes
 * bypass the ramp entirely and pass through (already deadzoned/clamped by
 * `gamepad.ts`).
 *
 * Layering: touches `document`/`navigator`; may import `src/core/`; never writes
 * simulation state; all smoothing advances by `DT` per fixed tick, never per frame.
 */
import { type InputFrame, type InputSource, NEUTRAL } from "../core/input-tape";
import { DT } from "../core/sim-clock";
import { type PadSnapshot, readGamepad } from "./gamepad";
import { createKeyboard, type KeyState } from "./keyboard";
import { createRaceCommandLatch, type RaceCommandSource } from "./race-commands";

/**
 * Upper bound on how many ramp steps `sampleForTick` will advance in one call.
 * `src/loop.ts`'s `MAX_STEPS_PER_FRAME` (5) already bounds how many ticks a
 * single frame can execute, so a catch-up larger than that clamp can never
 * occur in practice; 8 is a comfortable margin above it, not a tuning dial.
 */
const MAX_CATCHUP = 8;

/**
 * Linear ramp rate, full-scale-units per second, for steering AWAY from
 * centre (or in the same direction it is already leaning).
 *
 * [MEASURED, 02-RESEARCH.md Pattern 5]: 2.5/s reaches full lock in 0.400 s;
 * 1.6/s takes 0.633 s; 4.0/s takes 0.250 s. The linear form is deliberate — an
 * exponential lerp (the three.js example's `MathUtils.lerp(cur, tgt, 0.25)`)
 * never actually reaches full lock, so "hold left" asymptotes just short of
 * the steering limit, which is measurable in lap times (Pitfall 11).
 */
const DEFAULT_STEER_RAMP_PER_SEC = 2.5;

/**
 * Linear rate, full-scale-units per second, for steering back TOWARD centre or
 * reversing direction. Deliberately faster than the outward ramp — a quicker
 * return/reversal is what makes counter-steer responsive without making the
 * ramp itself twitchy. SC1 depends on being able to catch a slide.
 */
const DEFAULT_STEER_RETURN_PER_SEC = 4.0;

/** Linear rate, full-scale-units per second, for the throttle axis. */
const DEFAULT_THROTTLE_RATE_PER_SEC = 3.0;

/** Linear rate, full-scale-units per second, for the brake axis. */
const DEFAULT_BRAKE_RATE_PER_SEC = 5.0;

/** Injectable dependencies. All optional; defaults are built lazily inside the constructor. */
export interface LiveInputSourceDeps {
  keys?: () => KeyState;
  readPad?: () => PadSnapshot | null;
  steerRampPerSec?: number;
  steerReturnPerSec?: number;
  throttleRatePerSec?: number;
  brakeRatePerSec?: number;
}

function clamp(value: number, lo: number, hi: number): number {
  const v = Number.isFinite(value) ? value : 0;
  return v < lo ? lo : v > hi ? hi : v;
}

/** Moves `current` toward `target` by at most `rate * DT`, without overshoot. */
function approach(current: number, target: number, rate: number): number {
  const delta = target - current;
  const step = rate * DT;
  if (Math.abs(delta) <= step) return target;
  return current + Math.sign(delta) * step;
}

/**
 * `InputSource` backed by live hardware. `sampleForTick` is idempotent per
 * tick (copying `RecordingInput`'s `tick < 0` guard and cached-frame-by-
 * reference contract, `src/core/input-tape.ts:57-72`) — the ramp only
 * advances when the tick index actually moves forward.
 */
export class LiveInputSource implements InputSource {
  readonly raceCommands: RaceCommandSource;
  private readonly keys: () => KeyState;
  private readonly readPad: () => PadSnapshot | null;
  private readonly steerRampPerSec: number;
  private readonly steerReturnPerSec: number;
  private readonly throttleRatePerSec: number;
  private readonly brakeRatePerSec: number;

  private lastTick = -1;
  private steer = 0;
  private throttle = 0;
  private brake = 0;
  private handbrake = false;
  /** Cached by reference so a repeated sample of the same tick returns the identical object. */
  private cached: InputFrame = NEUTRAL;

  constructor(deps: LiveInputSourceDeps = {}) {
    // Lazy defaults, built INSIDE the constructor rather than at module scope
    // — exactly as `src/loop.ts:147`'s `scheduler = deps.scheduler ??
    // createBrowserScheduler()` — so importing this module never touches
    // `document` or `navigator`.
    if (deps.keys !== undefined) {
      this.keys = deps.keys;
      this.raceCommands = createRaceCommandLatch();
    } else {
      const keyboard = createKeyboard();
      this.keys = keyboard.read;
      this.raceCommands = keyboard.raceCommands;
    }
    this.readPad = deps.readPad ?? readGamepad;
    this.steerRampPerSec = deps.steerRampPerSec ?? DEFAULT_STEER_RAMP_PER_SEC;
    this.steerReturnPerSec = deps.steerReturnPerSec ?? DEFAULT_STEER_RETURN_PER_SEC;
    this.throttleRatePerSec = deps.throttleRatePerSec ?? DEFAULT_THROTTLE_RATE_PER_SEC;
    this.brakeRatePerSec = deps.brakeRatePerSec ?? DEFAULT_BRAKE_RATE_PER_SEC;
  }

  sampleForTick(tick: number): InputFrame {
    if (tick < 0) {
      return NEUTRAL;
    }
    if (tick > this.lastTick) {
      // A skipped run of ticks (e.g. after a clamp/rebaseline) advances the
      // ramp at most MAX_CATCHUP times, mirroring RecordingInput's skipped-
      // tick handling in spirit: the ramp still only moves DT-at-a-time, it
      // just does so up to MAX_CATCHUP times in this one call.
      const steps = Math.min(tick - this.lastTick, MAX_CATCHUP);
      for (let i = 0; i < steps; i++) {
        this.advance();
      }
      this.lastTick = tick;
      this.cached = this.buildFrame();
    }
    // tick <= lastTick: do NOT advance, return the cached frame object by
    // reference — repeated sampling of one tick must not re-read hardware.
    return this.cached;
  }

  private buildFrame(): InputFrame {
    return {
      steer: clamp(this.steer, -1, 1),
      throttle: clamp(this.throttle, 0, 1),
      brake: clamp(this.brake, 0, 1),
      handbrake: this.handbrake,
    };
  }

  private advance(): void {
    const pad = this.readPad();
    if (pad !== null) {
      // Analog source: already deadzoned and clamped by gamepad.ts. Pass
      // through with NO ramp — an analog stick is already analog.
      this.steer = pad.steer;
      this.throttle = pad.throttle;
      this.brake = pad.brake;
      this.handbrake = pad.handbrake;
      return;
    }

    const keys = this.keys();
    const steerTarget = (keys.right ? 1 : 0) - (keys.left ? 1 : 0);
    // Use the faster return/reversal rate whenever the target is centred or
    // opposes the current lean; the slower outward rate otherwise (including
    // starting from dead-centre, which is an outward ramp, not a reversal).
    const targetSign = Math.sign(steerTarget);
    const currentSign = Math.sign(this.steer);
    const reversingOrCentring =
      targetSign === 0 || (currentSign !== 0 && targetSign !== currentSign);
    const steerRate = reversingOrCentring ? this.steerReturnPerSec : this.steerRampPerSec;
    this.steer = approach(this.steer, steerTarget, steerRate);

    const throttleTarget = keys.up ? 1 : 0;
    this.throttle = approach(this.throttle, throttleTarget, this.throttleRatePerSec);

    const brakeTarget = keys.down ? 1 : 0;
    this.brake = approach(this.brake, brakeTarget, this.brakeRatePerSec);

    // Handbrake is binary and never ramped (D-02) — taken raw every advance.
    this.handbrake = keys.handbrake;
  }
}
