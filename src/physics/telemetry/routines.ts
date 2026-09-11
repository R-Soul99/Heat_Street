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
  ramp: {
    maxTiltDeg: 20,
    minSpeedMph: 40,
    label: "<20 deg tilt, >40 mph forward speed (0.5 s after landing)",
  },
  stability: { maxTiltDeg: 15, label: "<15 deg max tilt" },
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
 * sine wave of the tick index, per this file's no-random discipline. After
 * the alternating phase, a short STRAIGHT-STEER recovery tail lets slip decay
 * before the final sample — without it, `lastSlipDeg` is measured mid-way
 * through the sine wave's own transition back toward centre, which is a
 * chassis-inertia lag away from "has it actually stopped spinning", not a
 * real recovery check. `sample` records the max `|slipAngleRad|` seen and
 * whether slip has fallen back below 5 deg by the end of the tail. Target:
 * never exceeds 90 deg, and ends below 5 deg — "no spin".
 */
const SLALOM_TARGET_MPH = MPH_50_MS;
const SLALOM_PERIOD_TICKS = 90;
const SLALOM_ALTERNATE_TICKS = Math.round(6 / DT);
const SLALOM_RECOVERY_TAIL_TICKS = Math.round(1 / DT);
const SLALOM_HOLD_TICKS = SLALOM_ALTERNATE_TICKS + SLALOM_RECOVERY_TAIL_TICKS;
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
      if (elapsed >= SLALOM_ALTERNATE_TICKS) {
        // Recovery tail: straight steer, let slip decay before the final sample.
        return { steer: 0, throttle: SLALOM_HOLD_THROTTLE, brake: 0, handbrake: false };
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
 * `ramp` (VEH-04): a SCRIPTED LAUNCH, per 02-RESEARCH.md Open Question 2's
 * explicit recommendation, rather than driving over ramp geometry — this
 * regression-tests the auto-level assist independently of the ramp collider
 * plan 02-06 owns (a physical drive-over is covered separately by
 * `tests/vehicle-scene.test.ts`; the two together cover VEH-04).
 *
 * `setup(vehicle)` places the chassis 3 m up and injects a 120 mph (-Z)
 * launch with an upward component and an off-axis angular velocity —
 * simulating a launch with a nose-up pitch and spin, without any ramp
 * collider. `drive` holds neutral input while airborne, then applies a mild
 * throttle after at least 3 wheels regain contact. `sample` records the
 * max tilt while airborne (informational only — the auto-level assist is
 * gated to airborne-only and is expected to fight a large tumble there) and
 * the tilt/forward-speed 0.5 s after the first tick with 3+ wheels grounded.
 * Target: tilt < 20 deg AND forward speed > 40 mph at that check point.
 *
 * `[MEASURED]` (plan 02-07, this exact launch): with `autoLevelGain: 0` the
 * chassis never regains 3-wheel contact inside `MAX_TICKS` (it tumbles
 * indefinitely, matching 02-RESEARCH.md's D-07 finding of "never landed on
 * its wheels" at gain 0) — the `ramp without assist` companion in the test
 * file asserts exactly this FAILS. At the default gain the chassis lands at
 * tick ~115, tilt 0.5 s later is ~7 deg, and forward speed is ~100 mph.
 */
const RAMP_LAUNCH_HEIGHT_M = 3;
const RAMP_LAUNCH_SPEED_MS = 53.6448;
const RAMP_LAUNCH_UPWARD_MS = 8;
/** Off-axis spin, rad/s. Severe enough that an unassisted landing never
 * regains 3-wheel contact, but shallow enough that the default-gain assist
 * settles the chassis to grounded tilt comfortably under the roll-assist
 * stability gate's 15 deg gate (see `TELEMETRY_TARGETS.stability`). */
const RAMP_LAUNCH_ANGVEL = { x: 0.71, y: 0.142, z: 0.355 };
const RAMP_CHECK_DELAY_TICKS = Math.round(0.5 / DT);
const RAMP_LANDED_HOLD_TICKS = Math.round(1.0 / DT);
const RAMP_THROTTLE_AFTER_LANDING = 0.3;

function makeRampRoutine(): Routine {
  let landed = false;
  let landedTick = 0;

  return {
    id: "ramp",
    label: "ramp launch landing tilt",
    setup(vehicle) {
      landed = false;
      landedTick = 0;
      vehicle.body.setTranslation({ x: 0, y: RAMP_LAUNCH_HEIGHT_M, z: 0 }, true);
      vehicle.body.setLinvel({ x: 0, y: RAMP_LAUNCH_UPWARD_MS, z: -RAMP_LAUNCH_SPEED_MS }, true);
      vehicle.body.setAngvel(RAMP_LAUNCH_ANGVEL, true);
    },
    drive(tick, s) {
      if (!landed) {
        if (s.contacts >= 3) {
          landed = true;
          landedTick = tick;
        } else {
          return { steer: 0, throttle: 0, brake: 0, handbrake: false };
        }
      }
      if (tick - landedTick >= RAMP_LANDED_HOLD_TICKS) {
        return null;
      }
      return { steer: 0, throttle: RAMP_THROTTLE_AFTER_LANDING, brake: 0, handbrake: false };
    },
    sample(tick, s, acc) {
      if (!landed) {
        acc.maxAirTiltDeg = Math.max(acc.maxAirTiltDeg ?? 0, s.tiltDeg);
        return;
      }
      const sinceLanding = tick - landedTick;
      if (sinceLanding === RAMP_CHECK_DELAY_TICKS) {
        acc.tiltAtCheckDeg = s.tiltDeg;
        acc.speedAtCheckMs = s.forwardSpeedMs;
      }
    },
    evaluate(acc) {
      const t = TELEMETRY_TARGETS.ramp;
      // Never landing (still tumbling when MAX_TICKS is reached) or never
      // reaching the check point both leave `tiltAtCheckDeg` unset, and
      // Infinity always fails the band (T-02-19) rather than reporting a
      // spurious pass on an incomplete run.
      const tiltAtCheckDeg = "tiltAtCheckDeg" in acc ? acc.tiltAtCheckDeg : Number.POSITIVE_INFINITY;
      const speedAtCheckMs = acc.speedAtCheckMs ?? 0;
      return {
        id: "ramp",
        label: "ramp launch landing tilt",
        value: tiltAtCheckDeg,
        unit: "deg",
        target: t.label,
        pass: tiltAtCheckDeg < t.maxTiltDeg && speedAtCheckMs * 2.2369362920544 > t.minSpeedMph,
      };
    },
  };
}

/**
 * `stability` (SC3 / D-08): reach 60 mph, then hold FULL steer lock for 5 s
 * with the body-roll assist at its default gain. `sample` records the max
 * chassis tilt across the WHOLE run (accel phase included, though tilt there
 * is negligible). Target: max tilt under 15 deg.
 *
 * `[MEASURED]` (02-RESEARCH.md): full lock at both 60 mph and 110 mph
 * produced at most 1.5 deg of tilt with NO assist — rollover from tire
 * forces alone is a non-risk. The real thing this gate protects against is
 * the body-roll assist's OWN positive feedback: 02-RESEARCH.md's 45 mph /
 * 0.26 rad probe measured gain 0.10 -> 5.46 deg and gain 0.20 -> the car
 * flipping onto its roof. At this routine's own 60 mph / full-lock
 * condition the cliff is shallower (gain 0.08 -> ~5 deg, gain 0.5 -> ~16 deg,
 * no flip observed even at 0.5) — the sharpest cliff instead shows up in the
 * `slalom` routine, which is what makes the CROSS-ROUTINE
 * "roll assist stability" gate below (not just this routine alone) the real
 * regression coverage for D-06's positive-feedback risk.
 */
const STABILITY_HOLD_TICKS = Math.round(5 / DT);
const STABILITY_STEER_FRACTION = 1.0;
const STABILITY_HOLD_THROTTLE = 0.3;

function makeStabilityRoutine(): Routine {
  let holding = false;
  let holdStartTick = 0;

  return {
    id: "stability",
    label: "full-lock stability max tilt",
    setup() {
      holding = false;
      holdStartTick = 0;
    },
    drive(tick, s) {
      if (!holding) {
        if (s.forwardSpeedMs >= MPH_60_MS) {
          holding = true;
          holdStartTick = tick;
        } else {
          return { steer: 0, throttle: 1, brake: 0, handbrake: false };
        }
      }
      if (tick - holdStartTick >= STABILITY_HOLD_TICKS) {
        return null;
      }
      return { steer: STABILITY_STEER_FRACTION, throttle: STABILITY_HOLD_THROTTLE, brake: 0, handbrake: false };
    },
    sample(_tick, s, acc) {
      acc.maxTiltDeg = Math.max(acc.maxTiltDeg ?? 0, s.tiltDeg);
    },
    evaluate(acc) {
      const t = TELEMETRY_TARGETS.stability;
      const maxTiltDeg = acc.maxTiltDeg ?? 0;
      return {
        id: "stability",
        label: "full-lock stability max tilt",
        value: maxTiltDeg,
        unit: "deg",
        target: t.label,
        pass: maxTiltDeg < t.maxTiltDeg,
      };
    },
  };
}

/**
 * A standing instance of the `handbrake` routine (D-01), usable directly via
 * `runRoutine`. Deliberately NOT a member of `ROUTINES` below — per this
 * file's interface contract `ROUTINES` is exactly the six routines named in
 * its own doc comment (accel, brake, skidpad, slalom, ramp, stability), the
 * ones `runAllRoutines` and the plan 02-09 panel iterate uniformly.
 * `handbrake` measures a deliberately provoked, transient slide rather than
 * one of those six steady-state/pass-fail checks, so `tests/vehicle-telemetry.test.ts`
 * imports and runs it directly instead.
 */
export const handbrakeRoutine: Routine = makeHandbrakeRoutine();

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
  makeRampRoutine(),
  makeStabilityRoutine(),
];
