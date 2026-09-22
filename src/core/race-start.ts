/**
 * Pure countdown/field/paint constants for Circuit Race (plan 07-02, D-01
 * through D-04, D-14). This is the ONLY module `circuit-race-coordinator.ts`
 * and `main.ts` share for "how many racers, who starts where, what does the
 * grid look like before GO" — no countdown/grid logic exists anywhere else in
 * the codebase (Solo Time Attack starts on first movement, per Phase 6 D-04,
 * and is untouched by this file).
 *
 * Pure by construction: imports only `./input-tape` and `./sim-clock` (a
 * constant, `DT`, not a clock instance). No renderer, no physics engine, no
 * DOM, no wall clock. `tests/layering.test.ts` mechanically enforces this for
 * every file under `src/core/`.
 */
import { type InputFrame, NEUTRAL } from "./input-tape";
import { DT } from "./sim-clock";

/** D-01: the whole field is the player plus three AI racers. */
export const RACE_FIELD_SIZE = 4;

/** D-01: three AI racers occupy grid slots 0..2. */
export const AI_RACER_COUNT = 3;

/** D-03: the player starts at the BACK of the grid — the last slot, not pole. */
export const PLAYER_GRID_SLOT = 3;

/**
 * Ticks per countdown step. `Math.round(1 / DT)` rather than the literal `60`
 * so this stays correct if `DT` (`src/core/sim-clock.ts`) is ever retuned —
 * `DT` is `1/60`, so this evaluates to exactly `60` today.
 */
export const COUNTDOWN_STEP_TICKS = Math.round(1 / DT);

/**
 * Ticks from arming (the countdown's first tick) to GO — three one-second
 * steps ("3", "2", "1"), per D-04's Claude's-discretion choice of one second
 * per count. This is also the tick offset `circuit-race-coordinator.ts` adds
 * to `armedTick` to compute `goTick`.
 */
export const COUNTDOWN_TICKS = 3 * COUNTDOWN_STEP_TICKS;

export type CountdownLabel = "3" | "2" | "1" | "GO";

export interface CountdownState {
  /** `null` once the countdown (including the one-step "GO" flash) has fully finished. */
  readonly label: CountdownLabel | null;
  /** `true` from the instant GO fires onward — never flips back to `false`. */
  readonly released: boolean;
}

/**
 * Pure countdown state machine keyed on ticks elapsed since arming (NOT an
 * absolute tick index — the caller subtracts its own `armedTick`). One
 * `COUNTDOWN_STEP_TICKS`-tick step each for "3", "2", "1", then one more step
 * of "GO" (released), then `null` (still released) forever after.
 */
export function countdownState(ticksSinceArm: number): CountdownState {
  const step = COUNTDOWN_STEP_TICKS;
  if (ticksSinceArm < step) return { label: "3", released: false };
  if (ticksSinceArm < 2 * step) return { label: "2", released: false };
  if (ticksSinceArm < 3 * step) return { label: "1", released: false };
  if (ticksSinceArm < 4 * step) return { label: "GO", released: true };
  return { label: null, released: true };
}

/**
 * The frame every held car receives before GO. `NEUTRAL`, NOT `{ ...NEUTRAL,
 * brake: 1 }` — `src/physics/vehicle.ts`'s own `tick()` engages REVERSE
 * whenever `brake > 0` while `forwardSpeedMs` is below
 * `t.drive.reverseEngageSpeedMs` (see that file's "Reverse is DERIVED from
 * physics state" comment), which is exactly the stationary-at-the-grid case
 * every held car sits in. A held car must stay parked, not creep backward —
 * `NEUTRAL`'s zero brake is what keeps it still without ever satisfying that
 * reverse condition.
 */
export const HOLD_FRAME: InputFrame = NEUTRAL;

/**
 * The frame a finished AI racer drives while the rest of the field is still
 * racing (D-07: "AI keep driving until they finish" applies to the PLAYER's
 * finish, not an AI's own — a finished AI simply coasts off the racing line
 * rather than continuing to chase Silver pace). Keeps steering (so it still
 * tracks the line and does not wander), drops throttle to zero, and brakes
 * gently only once genuinely moving — `forwardSpeedMs > 1.5` guards against
 * the same reverse-engagement hazard `HOLD_FRAME` guards against: braking a
 * near-stationary car would engage reverse per `vehicle.ts`'s own rule.
 */
export function coastFrame(base: InputFrame, forwardSpeedMs: number): InputFrame {
  return Object.freeze({
    steer: base.steer,
    throttle: 0,
    brake: forwardSpeedMs > 1.5 ? 0.5 : 0,
    handbrake: false,
  });
}

export interface AiPaint {
  readonly name: string;
  readonly hex: number;
  readonly css: string;
}

/**
 * D-02/D-14 discretion: three distinct AI paints, one per AI grid slot
 * (`AI_PAINTS[i]` <-> fleet car `i` <-> grid slot `i`, per the RACER INDEX
 * TABLE this plan documents in `circuit-race-coordinator.ts`). None collides
 * with the player's own existing chassis colour, `COLOUR_CHASSIS` in
 * `src/render/vehicle-view.ts` (see `tests/race-start.test.ts`'s own
 * assertion for the exact value this deliberately avoids).
 */
export const AI_PAINTS: readonly AiPaint[] = Object.freeze([
  Object.freeze({ name: "HIGHWAY YELLOW", hex: 0xf2c230, css: "#f2c230" }),
  Object.freeze({ name: "HIGHLAND GREEN", hex: 0x2e8b57, css: "#2e8b57" }),
  Object.freeze({ name: "GRABBER BLUE", hex: 0x2f6fd6, css: "#2f6fd6" }),
]);
