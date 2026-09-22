/**
 * Pure racing/recovering/reset state machine (plan 07-04, SC3/D-13):
 * detects a stuck (throttle commanded, near-zero speed), wedged (no line
 * progress) or flipped AI car, drives a reverse-then-forward "drive out"
 * attempt, and — if that fails — requests a checkpoint reset deferred while
 * the car is within camera-framing distance of the player.
 *
 * Mirrors `src/core/race-state.ts`'s own hysteresis shape
 * (`WRONG_WAY_ENTER_RAD`/`WRONG_WAY_EXIT_RAD`) and `immutableSnapshot`
 * freeze convention, generalized to a richer telemetry-driven machine.
 *
 * `update()` is a pure function of its own accumulated timers and the
 * `StuckInput` passed in each tick — it never reads Rapier state, the DOM,
 * a wall clock or `Math.random` itself. The CALLER (`src/physics/ai-fleet.ts`
 * / `src/gameplay/circuit-race-coordinator.ts`) is responsible for deriving
 * `StuckInput` from live vehicle telemetry each tick.
 *
 * Pure by construction: imports only `./input-tape` (types). No renderer, no
 * physics engine, no DOM, no wall clock. `tests/layering.test.ts`
 * mechanically enforces this for every file under `src/core/`.
 */
import type { InputFrame } from "./input-tape";

export type StuckPhase = "racing" | "recovering" | "reset";

export type StuckAction = "none" | "begin-recovery" | "request-reset";

/** This detector's own tunable thresholds — see `STUCK_PARAMS`'s doc comment for provenance. */
export interface StuckParams {
  readonly stuckSpeedEnterMs: number;
  readonly stuckSpeedExitMs: number;
  readonly stuckEnterSec: number;
  readonly throttleCommandedMin: number;
  readonly flippedTiltDeg: number;
  readonly flippedEnterSec: number;
  readonly noProgressWindowSec: number;
  readonly noProgressMinM: number;
  readonly driveOutSec: number;
  readonly driveOutReverseSec: number;
  readonly resetCameraClearanceM: number;
  readonly resetMaxDeferSec: number;
  readonly resetLabelSec: number;
}

/**
 * D-13 discretion values (07-RESEARCH.md Open Question 1 explicitly left
 * these to Claude's discretion, flagging them for a later feel pass — the
 * 07-05 browser checkpoint may retune this constant, the same way Phase 2/3
 * retuned `defaultTuning()`'s own starting values after a feel session).
 * Frozen: this is a single fixed compile-time constant, never a live knob
 * (mirrors `racing-line.ts`'s own `AI_PACE_CALIBRATION` discipline).
 */
export const STUCK_PARAMS: StuckParams = Object.freeze({
  stuckSpeedEnterMs: 1.0,
  stuckSpeedExitMs: 4.0,
  stuckEnterSec: 2.5,
  throttleCommandedMin: 0.3,
  flippedTiltDeg: 70,
  flippedEnterSec: 1.0,
  noProgressWindowSec: 8,
  noProgressMinM: 10,
  driveOutSec: 3.0,
  driveOutReverseSec: 1.8,
  resetCameraClearanceM: 60,
  resetMaxDeferSec: 3.0,
  resetLabelSec: 1.0,
});

/** One tick's telemetry, fed in by the caller. */
export interface StuckInput {
  readonly dtSec: number;
  readonly groundSpeedMs: number;
  readonly tiltDeg: number;
  /** `AiFleet.lastFrame(carIndex).throttle` — the throttle this car was COMMANDED, before any avoidance/drive-out override. */
  readonly throttleCommanded: number;
  /** Cumulative racing-line arc position, metres (`RacingLine.points[i].arcM`). */
  readonly arcM: number;
  readonly distanceToPlayerM: number;
}

/** This detector's own accumulated timers, exposed read-only for the debug overlay (D-15) and Task 3's own tests. */
export interface StuckSnapshot {
  readonly phase: StuckPhase;
  readonly stuckSec: number;
  readonly flippedSec: number;
  readonly noProgressSec: number;
  readonly recoverSec: number;
  readonly deferSec: number;
}

export type AiDebugState = "racing" | "avoiding" | "recovering" | "reset";

export interface StuckDetector {
  update(input: StuckInput): StuckAction;
  /** Called once the caller has actually reset the car's pose (D-13's 5s penalty applied). Enters the `"reset"` label phase for `resetLabelSec`, then returns to `"racing"` with every timer zeroed. */
  acknowledgeReset(): void;
  /** Full reset to a fresh `"racing"` state — used on a race restart (grid + fresh countdown). */
  restart(): void;
  snapshot(): StuckSnapshot;
}

function freezeSnapshot(snapshot: StuckSnapshot): StuckSnapshot {
  return Object.freeze({ ...snapshot });
}

/**
 * Signed forward arc delta from `previous` to `current`, wrapping at
 * `lapLengthM` and mapped into `(-lapLengthM/2, lapLengthM/2]` — a wrap past
 * the start/finish line (e.g. `995 -> 7` on a 1000m lap) reads as a SMALL
 * FORWARD delta (`+12`), never a huge backward jump, and genuine backward
 * motion reads as negative. Matches `src/core/racing-line.ts`'s own
 * closed-loop arc convention.
 */
function wrappedArcDelta(current: number, previous: number, lapLengthM: number): number {
  if (lapLengthM <= 0) return 0;
  let delta = (current - previous) % lapLengthM;
  if (delta < 0) delta += lapLengthM;
  if (delta > lapLengthM / 2) delta -= lapLengthM;
  return delta;
}

/**
 * Builds a `StuckDetector` for one AI racer over a course of length
 * `lapLengthM` (`RacingLine.lapLengthM`) — the no-progress window needs the
 * lap length to correctly interpret a start/finish-line wrap as forward
 * progress rather than a huge backward jump.
 */
export function createStuckDetector(
  lapLengthM: number,
  params: StuckParams = STUCK_PARAMS,
): StuckDetector {
  let phase: StuckPhase = "racing";
  let stuckSec = 0;
  let flippedSec = 0;
  let recoverSec = 0;
  let deferSec = 0;
  let resetLabelTimer = 0;
  let pendingReset = false;
  let resetReady = false;
  let lastArcM: number | null = null;
  let windowArcM = 0;
  let noProgressWindowSec = 0;

  function resetProgressWindow(): void {
    windowArcM = 0;
    noProgressWindowSec = 0;
    lastArcM = null;
  }

  function resolvePendingReset(distanceToPlayerM: number, dtSec: number): StuckAction {
    if (!resetReady) {
      if (distanceToPlayerM >= params.resetCameraClearanceM) {
        resetReady = true;
      } else {
        deferSec += dtSec;
        if (deferSec >= params.resetMaxDeferSec) resetReady = true;
      }
    }
    return resetReady ? "request-reset" : "none";
  }

  function update(input: StuckInput): StuckAction {
    const { dtSec, groundSpeedMs, tiltDeg, throttleCommanded, arcM, distanceToPlayerM } = input;

    // "reset" is a label-display-only phase: no stuck/flip/progress logic
    // runs while the car is sitting at its just-reset pose. Re-baseline
    // lastArcM every tick here so the no-progress window never measures
    // across the teleport once racing resumes.
    if (phase === "reset") {
      resetLabelTimer += dtSec;
      lastArcM = arcM;
      if (resetLabelTimer >= params.resetLabelSec) {
        phase = "racing";
        resetLabelTimer = 0;
      }
      return "none";
    }

    // Flip check runs every tick regardless of phase — a flipped car resets
    // immediately, bypassing (or abandoning) any in-progress drive-out.
    flippedSec = tiltDeg > params.flippedTiltDeg ? flippedSec + dtSec : 0;
    if (flippedSec >= params.flippedEnterSec && !pendingReset) {
      pendingReset = true;
      // Force phase back to "racing" so Task 3's `phase === "recovering"`
      // gate never calls `driveOutFrame` for a flipped car (D-13: flip
      // "skips drive-out").
      phase = "racing";
    }

    if (pendingReset) {
      return resolvePendingReset(distanceToPlayerM, dtSec);
    }

    if (phase === "racing") {
      // Stuck hysteresis: accumulate only while at/under the ENTER
      // threshold with throttle genuinely commanded; freeze (neither
      // accumulate nor reset) in the hysteresis band between enter and
      // exit; reset only once speed reaches the EXIT threshold.
      if (groundSpeedMs >= params.stuckSpeedExitMs) {
        stuckSec = 0;
      } else if (
        groundSpeedMs <= params.stuckSpeedEnterMs &&
        throttleCommanded >= params.throttleCommandedMin
      ) {
        stuckSec += dtSec;
      }

      if (lastArcM !== null) {
        windowArcM += wrappedArcDelta(arcM, lastArcM, lapLengthM);
      }
      lastArcM = arcM;
      noProgressWindowSec += dtSec;
      let noProgressTriggered = false;
      if (noProgressWindowSec >= params.noProgressWindowSec) {
        if (windowArcM < params.noProgressMinM) noProgressTriggered = true;
        windowArcM = 0;
        noProgressWindowSec = 0;
      }

      if (stuckSec >= params.stuckEnterSec || noProgressTriggered) {
        phase = "recovering";
        stuckSec = 0;
        recoverSec = 0;
        resetProgressWindow();
        return "begin-recovery";
      }
      return "none";
    }

    // phase === "recovering"
    recoverSec += dtSec;
    if (
      recoverSec >= params.driveOutReverseSec &&
      groundSpeedMs >= params.stuckSpeedExitMs &&
      tiltDeg < params.flippedTiltDeg
    ) {
      phase = "racing";
      recoverSec = 0;
      stuckSec = 0;
      resetProgressWindow();
      return "none";
    }
    if (recoverSec >= params.driveOutSec) {
      pendingReset = true;
      return resolvePendingReset(distanceToPlayerM, dtSec);
    }
    return "none";
  }

  function acknowledgeReset(): void {
    phase = "reset";
    resetLabelTimer = 0;
    pendingReset = false;
    resetReady = false;
    deferSec = 0;
    stuckSec = 0;
    flippedSec = 0;
    recoverSec = 0;
    resetProgressWindow();
  }

  function restart(): void {
    phase = "racing";
    resetLabelTimer = 0;
    pendingReset = false;
    resetReady = false;
    deferSec = 0;
    stuckSec = 0;
    flippedSec = 0;
    recoverSec = 0;
    resetProgressWindow();
  }

  function snapshot(): StuckSnapshot {
    return freezeSnapshot({
      phase,
      stuckSec,
      flippedSec,
      noProgressSec: noProgressWindowSec,
      recoverSec,
      deferSec,
    });
  }

  return { update, acknowledgeReset, restart, snapshot };
}

/**
 * Reverse-then-forward drive-out `InputFrame` (D-13): reverse phase
 * (`recoverSec < driveOutReverseSec`) brakes at standstill to engage
 * reverse (`vehicle.ts`'s own documented "brake near standstill reverses"
 * behavior) and counter-steers (`-lineSteer`, since reversing turns the
 * opposite way of a forward steer input); forward phase applies a fixed
 * moderate throttle and steers toward the line (`lineSteer`). `handbrake`
 * is always `false` (D-12: tidy grip driving, no deliberate handbrake).
 */
export function driveOutFrame(
  recoverSec: number,
  lineSteer: number,
  params: StuckParams = STUCK_PARAMS,
): InputFrame {
  if (recoverSec < params.driveOutReverseSec) {
    return Object.freeze({ steer: -lineSteer, throttle: 0, brake: 1, handbrake: false });
  }
  return Object.freeze({ steer: lineSteer, throttle: 0.6, brake: 0, handbrake: false });
}

/**
 * Derives the `?debug` AI overlay's (D-15) per-car label from this
 * detector's own `phase` plus `AiFleet.avoidanceScale(carIndex)` — "racing"
 * only reads as "avoiding" when genuinely throttled back for another car
 * (`avoidanceScale < 1`), never during recovery or the post-reset label
 * phase (those take priority).
 */
export function deriveAiDebugState(phase: StuckPhase, avoidanceScale: number): AiDebugState {
  if (phase === "reset") return "reset";
  if (phase === "recovering") return "recovering";
  return avoidanceScale < 1 ? "avoiding" : "racing";
}
