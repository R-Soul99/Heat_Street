/**
 * The single source of truth for vehicle handling configuration: the shape of
 * every tunable knob, the measured default values, the per-field legal range,
 * and the pure parse/clamp functions that make a user-editable `localStorage`
 * blob safe to feed into Rapier.
 *
 * Every default value below is `02-RESEARCH.md`'s measured Config A, with
 * Config B's deltas already applied — not a guess and not the three.js
 * example's demo numbers. Each of the eight load-bearing fields carries a doc
 * comment stating the measured consequence of that value, per 02-PATTERNS.md
 * S7 ("explain the decision, not the code").
 *
 * DEVIATION from CLAUDE.md's tuning table (mass 10, suspension stiffness 24,
 * frictionSlip 1000.0, engine force ±30): that table is the three.js example's
 * DEMO values, not muscle-car values, and 02-RESEARCH.md measured that
 * `frictionSlip` above ~10 is dead — 10.5 and 1000 are numerically
 * indistinguishable (3.48 g vs 3.49 g on the same skidpad). The values below
 * supersede that table. The fix belongs in `.planning/research/STACK.md`, NOT
 * in `CLAUDE.md` directly — CLAUDE.md lines 28-219 are GENERATED from
 * `STACK.md` and a regeneration would silently revert a direct edit (see
 * `.planning/STATE.md`, decision "[Phase 01-03]").
 *
 * Pure by construction: no renderer, no physics engine, no DOM, no wall clock.
 * `tests/layering.test.ts` mechanically enforces this for every file under
 * `src/core/` — no `from "three"`, no `from "@dimforge/rapier3d"`, no
 * `document.`, `window.`, `performance.` or `requestAnimationFrame`.
 */

import { clampNode, copyLeaves, isPlainObject, type TuningRange } from "./tuning-utils";

/** Re-exported so `src/debug/tuning-panel.ts` (and any other existing
 * caller) can keep importing `TuningRange` from this module without change —
 * the type itself now lives in `./tuning-utils`, shared with
 * `src/core/surface-tuning.ts`. */
export type { TuningRange } from "./tuning-utils";

/**
 * The full handling configuration for one vehicle. Group keys (`chassis`,
 * `wheels`, `drive`, `assists`) are `readonly` — a caller should never
 * reassign a whole group. The numeric LEAVES are deliberately mutable:
 * `gui.add(tuning.wheels, "frictionSlip", …)` (plan 02-09) writes through the
 * object reference, so a deeply-readonly `as const` shape would not compile
 * against the tuning panel. This is a deliberate deviation from
 * `frame-budget.ts`'s fully-frozen `as const` pattern — see 02-PATTERNS.md,
 * "`src/core/vehicle-tuning.ts`" section.
 */
export interface VehicleTuning {
  readonly chassis: {
    /** Kilograms. Scales every impulse the vehicle controller applies. */
    mass: number;
    /** Centre of mass offset from the geometric centre, metres. */
    comOffset: { x: number; y: number; z: number };
    /** Chassis collider half-extents, metres. */
    halfExtents: { x: number; y: number; z: number };
    /** Linear velocity damping, per second. */
    linearDamping: number;
    /** Angular velocity damping, per second. */
    angularDamping: number;
  };
  readonly wheels: {
    /** Half the track width (left-right wheel spacing / 2), metres. */
    halfTrack: number;
    /** Half the wheelbase (front-rear wheel spacing / 2), metres. */
    halfWheelbase: number;
    /** Wheel connection point Y offset from the chassis origin, metres. */
    connectionY: number;
    /** Wheel radius, metres. */
    radius: number;
    /** Suspension rest length, metres. */
    suspensionRestLength: number;
    /**
     * Maximum suspension travel, metres. Rapier's own default is 5.0 — five
     * METRES, a leftover from Bullet's centimetre-scaled defaults — and MUST
     * be set explicitly here or the suspension effectively never bottoms out
     * (02-RESEARCH.md Pitfall 5).
     */
    maxSuspensionTravel: number;
    /** Suspension spring stiffness. Mass-normalised by Rapier's own solver. */
    suspensionStiffness: number;
    /** Suspension compression damping ratio. */
    suspensionCompression: number;
    /** Suspension relaxation (rebound) damping ratio. */
    suspensionRelaxation: number;
    /**
     * Maximum suspension force, newtons. Rapier's default is 6000 N, which
     * clips a 1600 kg car whose static per-wheel load is already 3924 N
     * (mass * 9.81 / 4). 20000 N is roughly 5x static load, leaving headroom
     * for landings and weight transfer without an artificial force ceiling
     * (02-RESEARCH.md Pitfall 4).
     */
    maxSuspensionForce: number;
    /**
     * Friction-circle radius multiplier. `[MEASURED]` (02-RESEARCH.md): this
     * dial is DEAD above ~10 — Rapier's default 10.5 and the three.js
     * example's 1000.0 produced numerically identical skidpad results (3.48 g
     * vs 3.49 g). The useful band is 0.6-2.0: 0.6 -> 0.52 g (sloppy, washes
     * out), 1.0 -> 0.84 g (period-correct muscle car), 1.5 -> 1.25 g (modern
     * sports car). 1.2 gives roughly 1.0 g on the measured skidpad, which is
     * this file's default.
     */
    frictionSlip: number;
    /** Front-axle lateral grip multiplier, applied before the friction-circle clamp. */
    frontSideFriction: number;
    /**
     * Rear-axle lateral grip multiplier — the PERMANENT RWD-loose bias
     * (independent of the handbrake). `[MEASURED]`: 1.0 -> 0.9deg of slip at
     * 45 mph / 0.3 rad steer, 0.12 -> 2.2deg, 0.06 -> 6.5deg (looser, closer
     * to unstable). See `handbrakeRearSideFriction` below for Pitfall 14 — the
     * useful range for THIS style of dial is a narrow band near zero, which is
     * why `TUNING_RANGES.wheels.rearSideFriction` is bounded to `0..0.3`, not
     * a naive `0..1`.
     *
     * TUNED in the plan 02-10 feel session; supersedes the previous default of
     * 0.12. `[MEASURED]` during that session: at full throttle with ZERO
     * steering input, straight-line driving is unconditionally unaffected by
     * `powerOversteerGain` (its lerp factor is `gain * throttle * |steer|`,
     * which is exactly 0 with no steer), so the raw value here alone governs
     * high-speed straight-line stability. At 0.12 the car spontaneously spins
     * out from a symmetric, exponentially-growing lateral-force buildup under
     * sustained full throttle at ~89 mph — reproduced headlessly with every
     * assist disabled, and confirmed NOT speed-dependent alone (coasting with
     * zero throttle is stable at every speed up to 120 mph; only sustained
     * throttle triggers it). A `rearSideFriction` sweep at full throttle found
     * the onset speed rises sharply with this value (0.06 -> 67 mph, 0.12 ->
     * 89 mph, 0.2 -> 128 mph, 0.3 -> stable through a 20 s/1200-tick run) —
     * 0.2 was chosen as comfortably above realistic sustained-chase speeds
     * while still measurably looser than `frontSideFriction`. Confirmed in
     * the same session that this does NOT blunt the deliberate full-lock
     * power-oversteer move: at full throttle + full steer, `powerOversteerGain`
     * already drives the lerp factor to 1, so only `handbrakeRearSideFriction`
     * matters there regardless of this baseline.
     */
    rearSideFriction: number;
  };
  readonly drive: {
    /**
     * Engine force applied to each rear wheel at full throttle, newtons.
     * `[MEASURED]` (plan 02-07): 02-RESEARCH.md's Config A value of 4000 N
     * measures 5.9 s 0-60 mph against the SHIPPED vehicle/assist code in this
     * repo (`tests/vehicle-telemetry.test.ts -t accel`), not the 6.28 s the
     * research probe recorded — the gap is downstream of plan 02-04's own
     * corrections to the inertia formula and the auto-level torque sign,
     * which post-date that probe. 3650 N lands at 6.52 s, centred in D-14's
     * locked 6.0-7.0 s band; this file's default is corrected to match.
     */
    engineForcePerRearWheel: number;
    /** Brake impulse applied to each wheel at full brake, newton-seconds. */
    brakeImpulsePerWheel: number;
    /** Maximum steering angle at the front wheels, radians. */
    maxSteerLock: number;
    /** Steering ramp-in rate while steer input is held, radians per second. */
    steerRampPerSec: number;
    /** Steering ramp-out (return to centre) rate, radians per second. */
    steerReturnPerSec: number;
    /**
     * Rear-axle lateral grip multiplier while the handbrake is held.
     * `[MEASURED]` (02-RESEARCH.md): the entire useful range is `0.004..0.04`
     * — a 10x span inside the bottom 4% of a naive `0..1` slider
     * (02-RESEARCH.md Pitfall 14). 0.04 -> a 12deg slide (mild); 0.01 -> a
     * 34-66deg recoverable Bullitt/Dukes-style handbrake slide, this file's
     * default; 0.0 -> the car spins out uncontrollably rather than sliding.
     * `TUNING_RANGES.drive.handbrakeRearSideFriction` is bounded to `0..0.05`
     * (not `0..1`) specifically so this range is not lost in a linear slider.
     */
    handbrakeRearSideFriction: number;
    /**
     * Authored throttle-oversteer gain. `[MEASURED]` (02-RESEARCH.md): power
     * oversteer does NOT emerge from tuning alone — the friction-circle clamp
     * scales the side impulse down proportionally rather than releasing it,
     * so no engine force at any magnitude broke the rear loose in testing.
     * This gain blends `rearSideFriction` toward `handbrakeRearSideFriction`
     * as a function of throttle and steer angle, authoring the effect
     * directly (`rearSfs = lerp(baseline, handbrakeValue, gain * throttle *
     * |steer|)`, wired in plan 02-04).
     *
     * TUNED in the plan 02-10 feel session; supersedes the previous default of
     * 0.5, which was never swept. `[MEASURED]` in that session: 0.5 produced
     * no oversteer at all at full throttle + full lock; 1.0 still produced
     * none; 1.3 spun the car into a full doughnut (too aggressive, effectively
     * removing rear grip at full lock). 1.1 was the value that produced a
     * controllable, readable step-out — human-confirmed in-browser.
     */
    powerOversteerGain: number;
    /**
     * `[ASSUMED]` (this plan, 260913-epf): reverse engine force applied to
     * each rear wheel, newtons, while `reversing` is true in
     * `src/physics/vehicle.ts`'s `tick`. A starting value, not swept — chosen
     * to be roughly 40% of `engineForcePerRearWheel`'s default (3650 N), on
     * the reasoning that reverse gear in a real car is materially lower-geared
     * than any forward gear, so a docile creep-out-of-a-jam force is more
     * appropriate here than parity with forward acceleration.
     */
    reverseEngineForcePerRearWheel: number;
    /**
     * `[ASSUMED]` (this plan, 260913-epf): the forward-speed threshold below
     * which holding brake engages reverse instead of braking, m/s. Its
     * default (0.1) is DELIBERATELY BELOW
     * `src/physics/telemetry/routines.ts`'s `STOP_SPEED_MS` (0.15) so the
     * 60-0 braking telemetry routine provably terminates before reverse can
     * engage — a threshold at or above `STOP_SPEED_MS` would release the
     * brakes mid-measurement and the routine would never reach its stop
     * condition (it drives `brake: 1` until `forwardSpeedMs <= STOP_SPEED_MS`,
     * and reversing zeroes the brake impulse — see the matching comment in
     * `src/physics/vehicle.ts`).
     */
    reverseEngageSpeedMs: number;
  };
  readonly assists: {
    /**
     * In-air auto-level torque gain, applied only while zero wheels are in
     * contact with the ground. `[MEASURED]` (02-RESEARCH.md, D-07): this
     * assist is LOAD-BEARING, not decoration. Without it, a 120 mph ramp
     * launch with an off-axis spin tumbles to 127deg of tilt and lands
     * inverted EVERY TIME. With gain 0.4 it lands at roughly 21deg and
     * settles to under 5deg within a second. VEH-04 and the airborne success
     * criterion are unachievable without this assist.
     */
    autoLevelGain: number;
    /** Auto-level angular-rate damping term, as a multiple of the gain. */
    autoLevelDamping: number;
    /**
     * Body-roll assist torque gain, applied only while >=3 wheels are
     * grounded and current roll is under `bodyRollMaxDeg`. `[MEASURED]`
     * (02-RESEARCH.md, D-06): Rapier hardcodes `roll_influence = 0.1`
     * internally and does not expose it to JS, so lateral tire forces
     * produce almost no roll moment on their own (roughly 1.5-2deg at 0.85 g
     * with no assist, versus a real car's 4-6deg). This is an OPEN-LOOP
     * torque, not a closed-loop PD-toward-target controller — 02-RESEARCH.md
     * explicitly measured that the PD-toward-target formulation flipped the
     * car at every gain and cap tested. Gain 0.10 -> 5.46deg (Bullitt range)
     * at 02-RESEARCH.md's own probe conditions (45 mph, 0.26 rad steer).
     * Gain 0.20 -> the car FLIPS ONTO ITS ROOF. This is positive feedback:
     * rolling the body shifts suspension load, which changes lateral force,
     * which feeds the torque. `bodyRollMaxDeg` below is not an optional
     * decoration — it is the cutoff that keeps this assist from running away.
     *
     * `[MEASURED]` (plan 02-07): the roll-assist stability gate this plan
     * adds (`tests/vehicle-telemetry.test.ts -t "roll assist stability"`)
     * checks every scripted routine, not just the 45 mph probe condition
     * above — and at gain 0.1 the `handbrake` routine's own 34deg slide
     * reaches 15.40deg of chassis tilt, over the 15deg safety cutoff, a
     * "mid-drift" operating point 02-RESEARCH.md Open Question 3 flagged as
     * never characterised. 0.08 kept every scripted routine under 15deg
     * (worst case 12.15deg, in `slalom`) with margin.
     *
     * TUNED FURTHER in the plan 02-10 feel session; supersedes plan 02-07's
     * 0.08. Raised toward the Bullitt-anchor target after the car read as
     * too flat through corners at 0.08 — human-confirmed in-browser, and the
     * `tests/vehicle-telemetry.test.ts -t "roll assist stability"` gate still
     * passes at 0.12 (measured 5.42deg max tilt, well under the 15deg cutoff).
     */
    bodyRollGain: number;
    /** Body-roll rate damping term, as a multiple of the gain. */
    bodyRollDamping: number;
    /**
     * Hard cutoff, in degrees: the body-roll assist (above) is disabled once
     * the chassis has rolled past this angle in either direction. Required
     * BECAUSE `bodyRollGain` is positive feedback — see that field's comment.
     * A scripted telemetry routine asserting no run ever exceeds this angle
     * is the regression gate for this cutoff (02-RESEARCH.md).
     */
    bodyRollMaxDeg: number;
    /**
     * Slide-catch yaw assist gain, nudging yaw rate back toward zero slip
     * angle. `[MEASURED]` (02-RESEARCH.md, D-03): at the recommended
     * handbrake tuning this assist is near-inert on its own — restoring
     * `rearSideFriction` on handbrake release, not this torque, is what
     * actually catches the slide. It becomes meaningful only at the deeper
     * `0.01`/`0.004` handbrake settings where slides persist for 1.5-2.5 s,
     * which is exactly where the recommended tuning sits.
     *
     * TUNED in the plan 02-10 feel session; supersedes the previous default of
     * 0.1. Minor adjustment alongside the other session changes; raising it
     * further (0.3, tested during the same session's straight-line-instability
     * diagnosis) made the unrelated high-speed spin trigger EARLIER, not
     * later — that instability's actual fix was `rearSideFriction` (see its
     * own doc comment), not this gain, so 0.3 was rejected and 0.12 kept.
     */
    slideCatchGain: number;
    /** Slide-catch yaw-rate damping term, as a multiple of the gain. */
    slideCatchDamping: number;
    /**
     * Speed-scaled downforce impulse coefficient (impulse = gain * groundSpeed^2).
     * `[MEASURED]` (02-RESEARCH.md, D-08): DEFAULT IS DELIBERATELY ZERO. Full
     * steering lock at both 60 mph and 110 mph produced no more than 1.5deg of
     * tilt at every `frictionSlip` tested — the rollover risk D-08 anticipated
     * does not exist on flat ground. The knob is retained (not removed) for
     * Phase 3/4 surfaces and uneven terrain, where the risk may reappear.
     */
    downforcePerSpeed2: number;
  };
}

/**
 * A fresh, independent `VehicleTuning` object literal. Deliberately a
 * FACTORY, never a shared module-level singleton: the telemetry runner (plan
 * 02-07) needs a pristine baseline on every run while the live tuning panel
 * (plan 02-09) mutates its own copy, and if both held the same object one
 * would silently corrupt the other's readings.
 *
 * Values are 02-RESEARCH.md's Config A with Config B's deltas already
 * applied. See the per-field doc comments on `VehicleTuning` above for the
 * measured rationale behind the eight load-bearing values.
 */
export function defaultTuning(): VehicleTuning {
  return {
    chassis: {
      mass: 1600,
      comOffset: { x: 0, y: -0.15, z: 0 },
      halfExtents: { x: 0.95, y: 0.5, z: 2.35 },
      linearDamping: 0.03,
      angularDamping: 0.3,
    },
    wheels: {
      halfTrack: 0.85,
      halfWheelbase: 1.55,
      connectionY: -0.3,
      radius: 0.36,
      suspensionRestLength: 0.45,
      maxSuspensionTravel: 0.3,
      suspensionStiffness: 14,
      suspensionCompression: 1.3,
      suspensionRelaxation: 1.4,
      maxSuspensionForce: 20000,
      frictionSlip: 1.2,
      frontSideFriction: 1.0,
      rearSideFriction: 0.2,
    },
    drive: {
      engineForcePerRearWheel: 3650,
      brakeImpulsePerWheel: 60,
      maxSteerLock: Math.PI / 4,
      steerRampPerSec: 2.5,
      steerReturnPerSec: 4.0,
      handbrakeRearSideFriction: 0.01,
      powerOversteerGain: 1.1,
      reverseEngineForcePerRearWheel: 1500,
      reverseEngageSpeedMs: 0.1,
    },
    assists: {
      autoLevelGain: 0.4,
      autoLevelDamping: 0.6,
      bodyRollGain: 0.12,
      bodyRollDamping: 1.2,
      bodyRollMaxDeg: 15,
      slideCatchGain: 0.12,
      slideCatchDamping: 0.35,
      downforcePerSpeed2: 0,
    },
  };
}

/**
 * Per-leaf legal ranges, mirroring `VehicleTuning`'s exact shape. This ONE
 * table is the source of truth for both the lil-gui slider bounds (plan
 * 02-09) and the load-time clamp (task 2 of this plan) — defining it twice
 * would let the panel's bounds and the security clamp silently drift apart.
 *
 * The bounds below are fixed by 02-RESEARCH.md and 02-UI-SPEC.md and must
 * stay exact: `chassis.mass` 800/2600/10, `wheels.suspensionStiffness`
 * 6/40/0.5, `wheels.suspensionCompression` 0.2/4/0.05,
 * `wheels.suspensionRelaxation` 0.2/4/0.05, `wheels.frictionSlip` 0.4/3/0.05,
 * `wheels.rearSideFriction` 0/0.3/0.005, `drive.handbrakeRearSideFriction`
 * 0/0.05/0.001, `assists.autoLevelGain` 0/2/0.05, `assists.bodyRollGain`
 * 0/0.15/0.005, `assists.bodyRollMaxDeg` 0/25/1, `assists.slideCatchGain`
 * 0/0.6/0.02, `assists.downforcePerSpeed2` 0/40/0.5. Every other leaf brackets
 * its default with a useful tuning margin (`min < default < max`, and `min`
 * may equal 0 where zero is itself a meaningful value).
 */
export const TUNING_RANGES: {
  readonly chassis: {
    mass: TuningRange;
    comOffset: { x: TuningRange; y: TuningRange; z: TuningRange };
    halfExtents: { x: TuningRange; y: TuningRange; z: TuningRange };
    linearDamping: TuningRange;
    angularDamping: TuningRange;
  };
  readonly wheels: {
    halfTrack: TuningRange;
    halfWheelbase: TuningRange;
    connectionY: TuningRange;
    radius: TuningRange;
    suspensionRestLength: TuningRange;
    maxSuspensionTravel: TuningRange;
    suspensionStiffness: TuningRange;
    suspensionCompression: TuningRange;
    suspensionRelaxation: TuningRange;
    maxSuspensionForce: TuningRange;
    frictionSlip: TuningRange;
    frontSideFriction: TuningRange;
    rearSideFriction: TuningRange;
  };
  readonly drive: {
    engineForcePerRearWheel: TuningRange;
    brakeImpulsePerWheel: TuningRange;
    maxSteerLock: TuningRange;
    steerRampPerSec: TuningRange;
    steerReturnPerSec: TuningRange;
    handbrakeRearSideFriction: TuningRange;
    powerOversteerGain: TuningRange;
    reverseEngineForcePerRearWheel: TuningRange;
    reverseEngageSpeedMs: TuningRange;
  };
  readonly assists: {
    autoLevelGain: TuningRange;
    autoLevelDamping: TuningRange;
    bodyRollGain: TuningRange;
    bodyRollDamping: TuningRange;
    bodyRollMaxDeg: TuningRange;
    slideCatchGain: TuningRange;
    slideCatchDamping: TuningRange;
    downforcePerSpeed2: TuningRange;
  };
} = {
  chassis: {
    mass: { min: 800, max: 2600, step: 10 },
    comOffset: {
      x: { min: -0.3, max: 0.3, step: 0.01 },
      y: { min: -0.5, max: 0.1, step: 0.01 },
      z: { min: -0.5, max: 0.5, step: 0.01 },
    },
    halfExtents: {
      x: { min: 0.5, max: 1.5, step: 0.01 },
      y: { min: 0.2, max: 1.0, step: 0.01 },
      z: { min: 1.5, max: 3.0, step: 0.01 },
    },
    linearDamping: { min: 0, max: 0.5, step: 0.01 },
    angularDamping: { min: 0, max: 2, step: 0.01 },
  },
  wheels: {
    halfTrack: { min: 0.5, max: 1.3, step: 0.01 },
    halfWheelbase: { min: 1.0, max: 2.2, step: 0.01 },
    connectionY: { min: -0.6, max: 0, step: 0.01 },
    radius: { min: 0.2, max: 0.55, step: 0.01 },
    suspensionRestLength: { min: 0.2, max: 0.8, step: 0.01 },
    maxSuspensionTravel: { min: 0.1, max: 0.6, step: 0.01 },
    suspensionStiffness: { min: 6, max: 40, step: 0.5 },
    suspensionCompression: { min: 0.2, max: 4, step: 0.05 },
    suspensionRelaxation: { min: 0.2, max: 4, step: 0.05 },
    maxSuspensionForce: { min: 5000, max: 40000, step: 500 },
    frictionSlip: { min: 0.4, max: 3, step: 0.05 },
    frontSideFriction: { min: 0.2, max: 1.5, step: 0.01 },
    // Pitfall 14 (02-RESEARCH.md): the useful range for a rear-bias slider is
    // a narrow band near zero (measured 0.06-1.0 all meaningfully distinct),
    // so this stays bounded to 0..0.3 rather than a naive 0..1 that would
    // waste 70% of the slider on a dead zone.
    rearSideFriction: { min: 0, max: 0.3, step: 0.005 },
  },
  drive: {
    engineForcePerRearWheel: { min: 1000, max: 10000, step: 100 },
    brakeImpulsePerWheel: { min: 10, max: 150, step: 1 },
    maxSteerLock: { min: 0.2, max: 1.2, step: 0.01 },
    steerRampPerSec: { min: 0.5, max: 8, step: 0.1 },
    steerReturnPerSec: { min: 0.5, max: 10, step: 0.1 },
    // Pitfall 14 (02-RESEARCH.md): the ENTIRE useful range measured for the
    // handbrake dial is 0.004..0.04 — a 10x span inside the bottom 4% of a
    // naive 0..1 track. Bounding this to 0..0.05 (not 0..1) is what makes the
    // dial tunable at all; a linear 0..1 slider would put every useful value
    // inside the first half-percent of the track.
    handbrakeRearSideFriction: { min: 0, max: 0.05, step: 0.001 },
    powerOversteerGain: { min: 0, max: 2, step: 0.05 },
    reverseEngineForcePerRearWheel: { min: 0, max: 6000, step: 50 },
    // Max 1 m/s keeps the engage window at walking pace or below — a larger
    // max would let a slider release the brakes at real driving speed.
    reverseEngageSpeedMs: { min: 0, max: 1, step: 0.01 },
  },
  assists: {
    autoLevelGain: { min: 0, max: 2, step: 0.05 },
    autoLevelDamping: { min: 0, max: 2, step: 0.05 },
    bodyRollGain: { min: 0, max: 0.15, step: 0.005 },
    bodyRollDamping: { min: 0, max: 3, step: 0.05 },
    bodyRollMaxDeg: { min: 0, max: 25, step: 1 },
    slideCatchGain: { min: 0, max: 0.6, step: 0.02 },
    slideCatchDamping: { min: 0, max: 2, step: 0.05 },
    downforcePerSpeed2: { min: 0, max: 40, step: 0.5 },
  },
};

/**
 * ASVS V5 (Input Validation) control, half one of two. Walks `TUNING_RANGES`
 * recursively and clamps every numeric leaf of `t` to its legal range,
 * substituting the matching `defaultTuning()` value for anything that is not
 * a finite number. This is the control that stops a `NaN` mass — or any other
 * non-finite leaf — from ever reaching `world.step()`, where it would corrupt
 * every body in the physics world, not just the vehicle's own. Mutates `t` in
 * place and returns the same object reference for convenient chaining.
 */
export function clampTuning(t: VehicleTuning): VehicleTuning {
  const fallback = defaultTuning() as unknown as Record<string, unknown>;
  clampNode(
    t as unknown as Record<string, unknown>,
    TUNING_RANGES as unknown as Record<string, unknown>,
    fallback,
  );
  return t;
}

/**
 * The `localStorage` key this module's saved tuning blob lives under. Fixed
 * by 02-UI-SPEC.md so the panel (plan 02-09) and any future reader agree on
 * it without a second source of truth.
 */
export const TUNING_STORAGE_KEY = "heat-street.tuning.v1";

/** The four required top-level group keys of a `VehicleTuning` object. */
const REQUIRED_GROUP_KEYS = ["chassis", "wheels", "drive", "assists"] as const;

/**
 * ASVS V5 (Input Validation) control, half two of two. Parses a raw
 * `localStorage` string into a fully-validated `VehicleTuning`, or `null` if
 * the input cannot be trusted even partially. This is the boundary D-17's
 * persisted tuning blob crosses: the blob is user-editable from devtools and
 * survives across sessions, and on the very next fixed tick a `NaN` mass or
 * an `Infinity` friction value would be written into
 * `chassis.setAdditionalMassProperties` / the per-wheel Rapier setters,
 * corrupting every body in `world.step()` — not just this vehicle.
 *
 * Returns `null` for: `null` input; a `JSON.parse` throw (wrapped in
 * try/catch so this function itself NEVER throws); a parsed value that is not
 * a plain, non-array object; or an object missing any of the four required
 * group keys (`chassis`, `wheels`, `drive`, `assists`). Otherwise, starts from
 * a fresh `defaultTuning()`, copies over only the leaves that exist in the
 * parsed object at the matching path, runs `clampTuning` over the result, and
 * returns it. The input string itself is discarded at this boundary — nothing
 * downstream of this function ever sees the raw text again, and the returned
 * object is always fully populated and every leaf is a finite, in-range
 * number.
 */
export function parseSavedTuning(raw: string | null): VehicleTuning | null {
  if (raw === null) {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  if (!isPlainObject(parsed)) {
    return null;
  }

  for (const groupKey of REQUIRED_GROUP_KEYS) {
    if (!(groupKey in parsed)) {
      return null;
    }
  }

  const result = defaultTuning();
  copyLeaves(
    parsed,
    result as unknown as Record<string, unknown>,
    TUNING_RANGES as unknown as Record<string, unknown>,
  );
  clampTuning(result);
  return result;
}

/**
 * Serializes a `VehicleTuning` for persistence under `TUNING_STORAGE_KEY`.
 *
 * DEVIATION from 02-RESEARCH.md lines 1019-1033 and 02-UI-SPEC.md
 * "Persistence", both of which recommend `gui.save(true)` / `gui.load(obj,
 * true)` for D-17's localStorage round trip. `gui.save()`'s own format
 * couples the stored blob to lil-gui controller paths, and
 * `three/addons/libs/lil-gui.module.min.js` cannot be imported under
 * Vitest's `node` test environment (no DOM), which would make this file's own
 * hostile-blob suite (`tests/tuning-persist.test.ts`, the D-17 security
 * control) unrunnable. Persisting the plain `VehicleTuning` object directly —
 * same storage key, same round-trip behaviour — keeps the same behaviour for
 * the player while keeping the validation path pure and Node-testable.
 */
export function serializeTuning(t: VehicleTuning): string {
  return JSON.stringify(t);
}
