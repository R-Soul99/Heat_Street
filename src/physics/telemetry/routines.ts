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
const MPH_45_MS = 20.1168;
const MPH_50_MS = 22.352;
const MPH_60_MS = 26.8224;
const METERS_TO_FEET = 3.28084;
const RAD_TO_DEG = 180 / Math.PI;

/** Clamp `v` into `[lo, hi]`. */
function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

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
  slalom: {
    maxSlipDeg: 90,
    recoverBelowDeg: 5,
    label: "no spin (max <90 deg, recovers <5 deg by the end)",
  },
  handbrake: {
    minMaxSlipDeg: 25,
    recoverBelowDeg: 5,
    recoverWithinSec: 2.5,
    label: ">25 deg max slip, recovers <5 deg within 2.5 s",
  },
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
 * `skidpad`: accelerate to 45 mph, then hold a fixed 15-degree steer for 4 s.
 * `sample` accumulates steady-state lateral g as
 * `|angvel.y * groundSpeedMs| / 9.81`, averaged over the LAST 2 s of the 4 s
 * hold only — the first 2 s are the transient corner-entry and are discarded.
 * Target `0.75-1.05 g`.
 *
 * `[MEASURED]` (02-RESEARCH.md "the frictionSlip saturation cliff"):
 * `frictionSlip` 10.5 and 1000 both measured 3.48-3.49 g and are IDENTICAL —
 * the dial is dead above ~10 and the useful band is 0.6-2.0. This routine's
 * `frictionSlip: 10.5` companion case (in the test file) asserts a FAILING
 * skidpad result, proving this routine actually measures grip rather than
 * returning a constant.
 *
 * `STEER_FRACTION_15DEG` assumes the DEFAULT `maxSteerLock` of pi/4 (45 deg,
 * Config A) — `drive` has no access to `tuning`, only to the sampled state,
 * so a fixed InputFrame fraction is the only way to target a specific wheel
 * angle. A live-retuned `maxSteerLock` will shift the true wheel angle away
 * from exactly 15 deg; that is an accepted approximation, not a bug — the
 * panel's whole point is to show measured values change as tuning changes.
 */
const STEER_FRACTION_15DEG = 15 / 45;
const SKIDPAD_TARGET_MPH = MPH_45_MS;
const SKIDPAD_HOLD_TICKS = Math.round(4 / DT);
const SKIDPAD_AVERAGE_WINDOW_TICKS = Math.round(2 / DT);
/** Light throttle during the hold, just enough to offset tire drag scrub so
 * the corner does not visibly slow down mid-measurement. */
const SKIDPAD_HOLD_THROTTLE = 0.3;

function makeSkidpadRoutine(): Routine {
  let holding = false;
  let holdStartTick = 0;

  return {
    id: "skidpad",
    label: "skidpad steady-state lateral g",
    setup() {
      holding = false;
      holdStartTick = 0;
    },
    drive(tick, s) {
      if (!holding) {
        if (s.forwardSpeedMs >= SKIDPAD_TARGET_MPH) {
          holding = true;
          holdStartTick = tick;
        } else {
          return { steer: 0, throttle: 1, brake: 0, handbrake: false };
        }
      }
      if (tick - holdStartTick >= SKIDPAD_HOLD_TICKS) {
        return null;
      }
      return {
        steer: STEER_FRACTION_15DEG,
        throttle: SKIDPAD_HOLD_THROTTLE,
        brake: 0,
        handbrake: false,
      };
    },
    sample(tick, s, acc) {
      if (!holding) {
        return;
      }
      const elapsed = tick - holdStartTick;
      if (elapsed >= SKIDPAD_HOLD_TICKS - SKIDPAD_AVERAGE_WINDOW_TICKS) {
        const g = Math.abs(s.angvel.y * s.groundSpeedMs) / 9.81;
        acc.gSum = (acc.gSum ?? 0) + g;
        acc.gCount = (acc.gCount ?? 0) + 1;
      }
    },
    evaluate(acc) {
      const t = TELEMETRY_TARGETS.skidpad;
      const gCount = acc.gCount ?? 0;
      const avgG = gCount > 0 ? (acc.gSum ?? 0) / gCount : 0;
      return {
        id: "skidpad",
        label: "skidpad steady-state lateral g",
        value: avgG,
        unit: "g",
        target: t.label,
        pass: avgG >= t.min && avgG <= t.max,
      };
    },
  };
}

/**
 * `slalom`: hold 50 mph and alternate steer on a fixed period — a CLOSED-FORM
 * sine wave of the tick index, per this file's no-random discipline. `sample`
 * records the max `|slipAngleRad|` seen and whether slip has fallen back
 * below 5 deg by the time the routine ends. Target: never exceeds 90 deg,
 * and ends below 5 deg — "no spin".
 */
const SLALOM_TARGET_MPH = MPH_50_MS;
const SLALOM_PERIOD_TICKS = 90;
const SLALOM_HOLD_TICKS = Math.round(6 / DT);
const SLALOM_STEER_FRACTION = 0.5;
const SLALOM_HOLD_THROTTLE = 0.25;

function makeSlalomRoutine(): Routine {
  let holding = false;
  let holdStartTick = 0;

  return {
    id: "slalom",
    label: "slalom max slip angle",
    setup() {
      holding = false;
      holdStartTick = 0;
    },
    drive(tick, s) {
      if (!holding) {
        if (s.forwardSpeedMs >= SLALOM_TARGET_MPH) {
          holding = true;
          holdStartTick = tick;
        } else {
          return { steer: 0, throttle: 1, brake: 0, handbrake: false };
        }
      }
      const elapsed = tick - holdStartTick;
      if (elapsed >= SLALOM_HOLD_TICKS) {
        return null;
      }
      const steer = SLALOM_STEER_FRACTION * Math.sin((2 * Math.PI * elapsed) / SLALOM_PERIOD_TICKS);
      return { steer, throttle: SLALOM_HOLD_THROTTLE, brake: 0, handbrake: false };
    },
    sample(_tick, s, acc) {
      if (!holding) {
        return;
      }
      const slipDeg = Math.abs(s.slipAngleRad) * RAD_TO_DEG;
      acc.maxSlipDeg = Math.max(acc.maxSlipDeg ?? 0, slipDeg);
      acc.lastSlipDeg = slipDeg;
    },
    evaluate(acc) {
      const t = TELEMETRY_TARGETS.slalom;
      const maxSlipDeg = acc.maxSlipDeg ?? 0;
      const lastSlipDeg = acc.lastSlipDeg ?? Number.POSITIVE_INFINITY;
      return {
        id: "slalom",
        label: "slalom max slip angle",
        value: maxSlipDeg,
        unit: "deg",
        target: t.label,
        pass: maxSlipDeg <= t.maxSlipDeg && lastSlipDeg < t.recoverBelowDeg,
      };
    },
  };
}

/**
 * `handbrake`: reach 60 mph, apply a fixed 0.45 rad steer with the handbrake
 * held for 0.75 s, then release the handbrake and apply a PROPORTIONAL
 * counter-steer standing in for a human driver (steer opposing the sampled
 * slip angle, scaled and clamped). `sample` records the max slip angle
 * during the hold and the sim time from release until slip falls back below
 * 5 deg. Target: max slip above 25 deg AND recovery below 5 deg within 2.5 s.
 *
 * `[MEASURED]` (02-RESEARCH.md): at `handbrakeRearSideFriction` 0.01 with a
 * 0.75 s hold, the useful curve is 34 deg max slip / 0.53 s recovery; the
 * entire useful tuning range for that dial is 0.004-0.04, and 0.0 spins the
 * car out to 101 deg with a 2.60 s recovery instead of sliding.
 *
 * `HANDBRAKE_STEER_FRACTION` assumes the default `maxSteerLock` (Config A),
 * same caveat as `STEER_FRACTION_15DEG` above.
 */
const HANDBRAKE_STEER_RAD = 0.45;
const HANDBRAKE_STEER_FRACTION = HANDBRAKE_STEER_RAD / (Math.PI / 4);
const HANDBRAKE_HOLD_TICKS = Math.round(0.75 / DT);
/** Proportional counter-steer gain, steer-fraction per radian of slip angle. */
const HANDBRAKE_COUNTER_STEER_GAIN = 2.0;
const HANDBRAKE_RECOVER_SLIP_DEG = 5;

type HandbrakePhase = "accel" | "hold" | "recover" | "done";

function makeHandbrakeRoutine(): Routine {
  let phase: HandbrakePhase = "accel";
  let holdStartTick = 0;
  let releaseTick = 0;

  return {
    id: "handbrake",
    label: "handbrake slide and recovery",
    setup() {
      phase = "accel";
      holdStartTick = 0;
      releaseTick = 0;
    },
    drive(tick, s) {
      if (phase === "accel") {
        if (s.forwardSpeedMs >= MPH_60_MS) {
          phase = "hold";
          holdStartTick = tick;
        } else {
          return { steer: 0, throttle: 1, brake: 0, handbrake: false };
        }
      }
      if (phase === "hold") {
        if (tick - holdStartTick >= HANDBRAKE_HOLD_TICKS) {
          phase = "recover";
          releaseTick = tick;
        } else {
          return { steer: HANDBRAKE_STEER_FRACTION, throttle: 0, brake: 0, handbrake: true };
        }
      }
      if (phase === "recover") {
        const slipDeg = Math.abs(s.slipAngleRad) * RAD_TO_DEG;
        if (slipDeg < HANDBRAKE_RECOVER_SLIP_DEG) {
          phase = "done";
          return null;
        }
        const counterSteer = clamp(-s.slipAngleRad * HANDBRAKE_COUNTER_STEER_GAIN, -1, 1);
        return { steer: counterSteer, throttle: 0.2, brake: 0, handbrake: false };
      }
      return null;
    },
    sample(tick, s, acc) {
      const slipDeg = Math.abs(s.slipAngleRad) * RAD_TO_DEG;
      if (phase === "hold") {
        acc.maxSlipDeg = Math.max(acc.maxSlipDeg ?? 0, slipDeg);
      }
      if (phase === "recover" || phase === "done") {
        if (!("recoverStartTick" in acc)) {
          acc.recoverStartTick = releaseTick;
        }
        if (!("recoveredTick" in acc) && slipDeg < HANDBRAKE_RECOVER_SLIP_DEG) {
          acc.recoveredTick = tick;
        }
      }
    },
    evaluate(acc) {
      const t = TELEMETRY_TARGETS.handbrake;
      const maxSlipDeg = acc.maxSlipDeg ?? 0;
      const recoverSec =
        "recoveredTick" in acc && "recoverStartTick" in acc
          ? (acc.recoveredTick - acc.recoverStartTick) * DT
          : Number.POSITIVE_INFINITY;
      return {
        id: "handbrake",
        label: "handbrake slide and recovery",
        value: maxSlipDeg,
        unit: "deg",
        target: t.label,
        pass: maxSlipDeg > t.minMaxSlipDeg && recoverSec < t.recoverWithinSec,
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
export const ROUTINES: readonly Routine[] = [
  accelRoutine,
  makeBrakeRoutine(),
  makeSkidpadRoutine(),
  makeSlalomRoutine(),
  makeHandbrakeRoutine(),
];
