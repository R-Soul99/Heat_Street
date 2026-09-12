/**
 * Per-surface skidpad and straight-line-stability routines plus the sweep
 * driver (plan 03-06 Task 2). This is what turns SC1's claim — "driving
 * from tarmac onto gravel, grass, mud, sand or dirt produces a distinct and
 * measurable grip change" — into a passing, repeatable assertion, and what
 * re-verifies `.planning/STATE.md`'s Phase 3 carry-forward on the
 * plan-02-10 straight-line spin-out across every real surface, not just the
 * flat tarmac test ground.
 *
 * Built by PARAMETERISING `./routines`'s existing `skidpad`/`stability`
 * routines rather than copying their bodies wholesale — every shared
 * constant below cites the exact source line it was copied from, so the two
 * cannot silently diverge.
 *
 * Both sweeps take `profiles` as a PARAMETER and never import the
 * project's factory for a fresh default profiles object themselves (see the
 * zero-count acceptance grep on this file), so the plan 03-07 browser panel
 * can run the identical sweep against live-tuned values with no code edit —
 * the same property that makes SC5 literal for vehicle tuning
 * (`src/physics/telemetry/run.ts`'s own two-runner design doc comment).
 *
 * Layering: may import `@dimforge/rapier3d` types and `src/core/`. Must not
 * import `three` and must not touch the DOM or any wall clock.
 */
import { DT } from "../../core/sim-clock";
import type { SurfaceProfiles } from "../../core/surface-tuning";
import { SURFACE_TYPES, type SurfaceType } from "../../core/surface-types";
import type { VehicleTuning } from "../../core/vehicle-tuning";
import type { Routine, RoutineResult } from "./routines";
import { runRoutine } from "./run";

const RAD_TO_DEG = 180 / Math.PI;

/**
 * SC1's "measurable" grip-change threshold expressed as a number: every pair
 * of surfaces' skidpad steady-state lateral-g must differ by at least this
 * much for the claim to count as "distinct and measurable" rather than
 * merely non-zero. Starts conservative — plan 03-12's feel session may raise
 * it once the shipped `SurfaceProfiles` are tuned against real play.
 */
export const SURFACE_SEPARATION_MIN_G = 0.02;

// ---- Skidpad (mirrors ./routines.ts's `skidpad`, lines 242-305) ----

/** Copied from routines.ts:60 (`MPH_45_MS`). */
const SKIDPAD_TARGET_MPH = 20.1168;
/** Copied from routines.ts:242 (`STEER_FRACTION_15DEG`). Assumes the
 * default `maxSteerLock` of pi/4 — same accepted approximation the source
 * routine documents. */
const STEER_FRACTION_15DEG = 15 / 45;
/** Copied from routines.ts:244 (`SKIDPAD_HOLD_TICKS`). */
const SKIDPAD_HOLD_TICKS = Math.round(4 / DT);
/** Copied from routines.ts:245 (`SKIDPAD_AVERAGE_WINDOW_TICKS`). */
const SKIDPAD_AVERAGE_WINDOW_TICKS = Math.round(2 / DT);
/** Copied from routines.ts:248 (`SKIDPAD_HOLD_THROTTLE`). */
const SKIDPAD_HOLD_THROTTLE = 0.3;

/**
 * Build a skidpad routine identical in shape to `./routines.ts`'s `skidpad`
 * (same 45 mph entry speed, same 15/45 steer fraction, same 0.3 hold
 * throttle, same 4 s hold with a 2 s averaging window, same
 * `|angvel.y * groundSpeedMs| / 9.81` lateral-g formula), but scoped to one
 * `surface` and reporting a RELATIVE pass criterion (finite, positive g)
 * rather than borrowing `./routines.ts`'s tarmac-authored absolute pass band
 * for its own `skidpad` routine (see the zero-count acceptance grep on this
 * file) — a mud skidpad legitimately falls far outside a band authored for
 * tarmac, and reusing it would make five of six surfaces permanently read as
 * failing in the browser panel.
 */
function makeSurfaceSkidpadRoutine(surface: SurfaceType): Routine {
  const id = `skidpad:${surface}`;
  const label = `skidpad steady-state lateral g (${surface})`;
  let holding = false;
  let holdStartTick = 0;

  return {
    id,
    label,
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
      const gCount = acc.gCount ?? 0;
      const avgG = gCount > 0 ? (acc.gSum ?? 0) / gCount : 0;
      return {
        id,
        label,
        value: avgG,
        unit: "g",
        target: `finite, positive g (cross-surface separation checked by the sweep, not a per-surface band)`,
        pass: Number.isFinite(avgG) && avgG > 0,
      };
    },
  };
}

// ---- Straight-line stability (STATE.md Phase 3 carry-forward re-verification) ----

/**
 * How long to hold sustained full throttle with zero steer, from rest.
 * `[MEASURED]` (Phase 02-10 finding, restated in `.planning/STATE.md`): at
 * the shipped `rearSideFriction` default the spin-out onset (when it exists
 * at all) is well past 60 mph, so this hold needs enough time for the car to
 * keep accelerating past that point on every surface, including ones with
 * reduced `forwardGrip` that slow acceleration. 20 s comfortably exceeds
 * every measured onset speed's required run-up time while staying inside
 * `MAX_TICKS`'s 30 s cap.
 */
const STABILITY_HOLD_SECONDS = 20;
const STABILITY_HOLD_TICKS = Math.round(STABILITY_HOLD_SECONDS / DT);
/** The plan-02-10 spin-out re-verification threshold: a car that is still
 * tracking straight never exceeds this much slip angle. */
const STABILITY_MAX_SLIP_DEG = 30;

/**
 * Build a straight-line stability routine scoped to one `surface`: full
 * throttle, exactly zero steer, from rest, held for
 * `STABILITY_HOLD_SECONDS`. Unlike `./routines.ts`'s own `stability` routine
 * (full-LOCK steer, a different regression target entirely — D-06/D-08's
 * body-roll positive feedback), this one re-verifies the plan-02-10
 * straight-line spin-out (`rearSideFriction` finding) does not reopen at any
 * surface's reduced lateral grip.
 */
function makeSurfaceStabilityRoutine(surface: SurfaceType): Routine {
  const id = `stability:${surface}`;
  const label = `straight-line stability (${surface})`;

  return {
    id,
    label,
    drive(tick, _s) {
      // Sustained full throttle, exactly zero steer, for the whole hold —
      // this IS the plan-02-10 finding's exact provocation (STATE.md:
      // "sustained full-throttle, zero-steer driving spontaneously spun the
      // car out"). No accel/hold phase split: the car simply keeps
      // accelerating (or not, on a low-forwardGrip surface) for the entire
      // window.
      if (tick >= STABILITY_HOLD_TICKS) {
        return null;
      }
      return { steer: 0, throttle: 1, brake: 0, handbrake: false };
    },
    sample(_tick, s, acc) {
      const slipDeg = Math.abs(s.slipAngleRad) * RAD_TO_DEG;
      acc.maxSlipDeg = Math.max(acc.maxSlipDeg ?? 0, slipDeg);
      acc.finalForwardSpeedMs = s.forwardSpeedMs;
    },
    evaluate(acc) {
      const maxSlipDeg = acc.maxSlipDeg ?? 0;
      const finalForwardSpeedMs = acc.finalForwardSpeedMs ?? 0;
      return {
        id,
        label,
        value: maxSlipDeg,
        unit: "deg",
        target: `<= ${STABILITY_MAX_SLIP_DEG} deg, ends moving forward`,
        pass: maxSlipDeg <= STABILITY_MAX_SLIP_DEG && finalForwardSpeedMs > 0,
      };
    },
  };
}

/**
 * Run the skidpad routine once per `SURFACE_TYPES` entry, in order —
 * SC1's automated proof. `profiles` is a parameter, never imported.
 */
export function runSurfaceSkidpadSweep(
  tuning: VehicleTuning,
  profiles: SurfaceProfiles,
): RoutineResult[] {
  return SURFACE_TYPES.map((surface) =>
    runRoutine(makeSurfaceSkidpadRoutine(surface), tuning, { surface, profiles }),
  );
}

/**
 * Run the straight-line stability routine once per `SURFACE_TYPES` entry, in
 * order — the plan-02-10 spin-out re-verification.
 */
export function runSurfaceStabilitySweep(
  tuning: VehicleTuning,
  profiles: SurfaceProfiles,
): RoutineResult[] {
  return SURFACE_TYPES.map((surface) =>
    runRoutine(makeSurfaceStabilityRoutine(surface), tuning, { surface, profiles }),
  );
}

/**
 * The 03-RESEARCH.md Assumption A1 / Open Question 1 control: a single
 * tarmac skidpad run with an EXPLICIT ground-collider friction value,
 * everything else (wheel tuning, surface profile) held fixed. Comparing two
 * calls at different `groundFriction` values is how
 * `tests/surface-telemetry.test.ts` settles whether the raycast vehicle's
 * tire model reads the ground collider's own friction coefficient at all.
 */
export function runSkidpadAtGroundFriction(
  tuning: VehicleTuning,
  profiles: SurfaceProfiles,
  groundFriction: number,
): RoutineResult {
  return runRoutine(makeSurfaceSkidpadRoutine("tarmac"), tuning, {
    surface: "tarmac",
    profiles,
    groundFriction,
  });
}
