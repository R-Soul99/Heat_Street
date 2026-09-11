/**
 * The scripted telemetry track: `Routine` / `RoutineResult` types, the D-14
 * pass bands as data (`TELEMETRY_TARGETS`), and the six scripted routines
 * (`ROUTINES`) that measure VEH-01, VEH-04, SC3 and D-04/D-06.
 *
 * Every `drive` below is a CLOSED-FORM function of the tick index and the
 * sampled vehicle state, never random — the same discipline
 * `tests/determinism.test.ts:56-72` documents for its own input tape: no
 * random source appears anywhere in this file, so every run on every machine
 * drives the world with byte-identical input.
 *
 * A routine that needs to remember which phase it is in (e.g. "still
 * accelerating to the test speed" vs. "now holding a steer angle") does so
 * with a private, module-scoped closure variable that is reset in
 * `setup()` — `setup()` is called exactly once per `runRoutine` execution
 * (src/physics/telemetry/run.ts), so the SAME exported `Routine` object can
 * be run twice in a row (as the reproducibility test and the
 * "…without assist" companion cases both do) without state leaking between
 * runs. `drive` itself never receives the accumulator (`acc`) — only `sample`
 * does — which is why phase memory that `drive` needs lives in a closure
 * rather than in `acc`.
 *
 * Layering: may import `@dimforge/rapier3d` types and `src/core/`. Must not
 * import `three` and must not touch the DOM or any wall clock.
 */

import type { InputFrame } from "../../core/input-tape";
import { DT } from "../../core/sim-clock";
import type { Vehicle, VehicleSample } from "../vehicle";

/** One routine's measured outcome, shared by the Vitest suite and (plan
 * 02-09) the browser telemetry panel. */
export interface RoutineResult {
  readonly id: string;
  readonly label: string;
  readonly value: number;
  readonly unit: string;
  /** Human-readable pass band, e.g. "6.0-7.0 s". Always sourced from
   * `TELEMETRY_TARGETS` so the panel and the tests never drift apart. */
  readonly target: string;
  readonly pass: boolean;
}

/** One scripted telemetry routine, driven purely by tick index + sampled state. */
export interface Routine {
  readonly id: string;
  readonly label: string;
  /** Input for this tick given the current state; return null to end the routine. */
  drive(tick: number, s: VehicleSample): InputFrame | null;
  /** Accumulate measurements each tick. Called AFTER this tick's `vehicle.tick` + `world.step()`. */
  sample(tick: number, s: VehicleSample, acc: Record<string, number>): void;
  evaluate(acc: Record<string, number>): RoutineResult;
  /** Optional one-off setup, e.g. the ramp routine's scripted launch, or
   * resetting a routine's private phase-tracking closure state. */
  setup?(vehicle: Vehicle): void;
}

// ---- Unit conversions, exact per 02-RESEARCH.md "Units and Normalisation" --
// mph = m/s * 2.2369362920544; the reverse (mph -> m/s) is mph * 0.44704.
const MPH_60_MS = 26.8224;
const METERS_TO_FEET = 3.28084;

/** Speed at which a braking/coasting-to-rest routine considers the car "stopped". */
const STOP_SPEED_MS = 0.15;

/**
 * Fixed neutral-input settle period before any routine that starts "from
 * rest" begins measuring, letting the suspension reach its resting sag first
 * (mirrors `tests/vehicle.test.ts`'s own `settle()` helper, which uses
 * 60-120 ticks for the same reason before ITS measurements begin). Without
 * this, `accel`'s timer starts while the chassis is still dropping from its
 * 1 m spawn height onto the suspension, and the measured 0-60 time reads
 * fast relative to 02-RESEARCH.md's settled-start baseline of 6.28 s.
 */
const SETTLE_TICKS = 40;

/**
 * The D-14 pass bands as DATA, not scattered literals, so
 * `tests/vehicle-telemetry.test.ts` and the plan 02-09 browser panel display
 * the exact same target string for a given routine.
 */
export const TELEMETRY_TARGETS = {
  accel: { min: 6.0, max: 7.0, unit: "s", label: "6.0-7.0 s" },
  brake: { min: 110, max: 135, unit: "ft", label: "110-135 ft" },
  skidpad: { min: 0.75, max: 1.05, unit: "g", label: "0.75-1.05 g" },
} as const;

/**
 * `accel`: full throttle, zero steer, from rest. Ends the instant forward
 * speed reaches 60 mph (26.8224 m/s); `sample` records the FIRST tick that
 * happened on, and `evaluate` reports it as seconds (`tick * DT`). Stateless
 * — no closure needed, because "have we reached the target speed yet" can
 * always be read straight off the current `VehicleSample`.
 */
const accelRoutine: Routine = {
  id: "accel",
  label: "0-60 mph",
  drive(tick, s) {
    if (tick < SETTLE_TICKS) {
      return { steer: 0, throttle: 0, brake: 0, handbrake: false };
    }
    if (s.forwardSpeedMs >= MPH_60_MS) {
      return null;
    }
    return { steer: 0, throttle: 1, brake: 0, handbrake: false };
  },
  sample(tick, s, acc) {
    if (tick < SETTLE_TICKS) {
      return;
    }
    // `"hitTick" in acc` rather than `acc.hitTick === undefined` — the
    // accumulator's declared type is `Record<string, number>`, so `tsc`
    // would flag a direct `undefined` comparison as a Reason it can never be
    // true; `in` sidesteps that without weakening the type.
    if (!("hitTick" in acc) && s.forwardSpeedMs >= MPH_60_MS) {
      acc.hitTick = tick;
    }
  },
  evaluate(acc) {
    const t = TELEMETRY_TARGETS.accel;
    // A routine that never reached the target reports +Infinity, which
    // always fails the band rather than silently reporting `pass: true` on
    // an incomplete run (T-02-19). The measured time excludes SETTLE_TICKS —
    // the clock starts when throttle is first applied, not at spawn.
    const seconds = "hitTick" in acc ? (acc.hitTick - SETTLE_TICKS) * DT : Number.POSITIVE_INFINITY;
    return {
      id: "accel",
      label: "0-60 mph",
      value: seconds,
      unit: "s",
      target: t.label,
      pass: seconds >= t.min && seconds <= t.max,
    };
  },
};

/**
 * `brake`: full throttle until 60 mph, then `throttle: 0, brake: 1` while
 * recording the distance travelled from the moment braking begins until
 * forward speed reaches (near) zero. Zeroing engine force while braking is
 * `vehicle.tick`'s own job (Pitfall 7) — this routine only has to stop
 * asking for throttle once it flips into the braking phase.
 *
 * Needs phase memory ("have we started braking yet") that persists across
 * ticks but `drive` cannot read `acc`, so the phase lives in a closure reset
 * by `setup()`.
 */
function makeBrakeRoutine(): Routine {
  let braking = false;

  return {
    id: "brake",
    label: "60-0 mph braking distance",
    setup() {
      braking = false;
    },
    drive(_tick, s) {
      if (!braking && s.forwardSpeedMs >= MPH_60_MS) {
        braking = true;
      }
      if (braking && s.forwardSpeedMs <= STOP_SPEED_MS) {
        return null;
      }
      return { steer: 0, throttle: braking ? 0 : 1, brake: braking ? 1 : 0, handbrake: false };
    },
    sample(_tick, s, acc) {
      if (!braking) {
        return;
      }
      // The position at the first braking-phase sample is already one tick
      // into braking (this fires AFTER that tick's `vehicle.tick` +
      // `world.step()`), so the measured distance is a few tenths of a
      // metre short of the true start point — negligible against the
      // 110-135 ft (~33.5-41.1 m) target band.
      if (!("brakeStartZ" in acc)) {
        acc.brakeStartZ = s.position.z;
      }
      acc.brakeEndZ = s.position.z;
    },
    evaluate(acc) {
      const t = TELEMETRY_TARGETS.brake;
      const distanceM = Math.abs((acc.brakeEndZ ?? 0) - (acc.brakeStartZ ?? 0));
      const distanceFt = distanceM * METERS_TO_FEET;
      return {
        id: "brake",
        label: "60-0 mph braking distance",
        value: distanceFt,
        unit: "ft",
        target: t.label,
        pass: distanceFt >= t.min && distanceFt <= t.max,
      };
    },
  };
}

/**
 * The six scripted routines, in the fixed order every consumer (the Vitest
 * suite, the plan 02-09 browser panel, `runAllRoutines`) iterates. Written
 * inline here rather than assembled elsewhere, so the list a reader sees is
 * the list that runs.
 */
export const ROUTINES: readonly Routine[] = [accelRoutine, makeBrakeRoutine()];
