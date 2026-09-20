import { describe, expect, it } from "vitest";
import { defaultTuning } from "../src/core/vehicle-tuning";
import {
  highSpeedPulseRoutine,
  powerSlideRecoveryRoutine,
  ROUTINES,
} from "../src/physics/telemetry/routines";
import { runAllRoutines, runRoutine } from "../src/physics/telemetry/run";

/**
 * 260920-j4d task 1: proves the two new diagnostic routines actually measure
 * something (finite/reproducible values where the maneuver stays on the
 * measurable test track, run-to-run reproducibility everywhere) and that
 * adding them perturbed nothing about the canonical six. Deliberately does
 * NOT assert a pass band yet — at the committed defaults these routines are
 * expected to show the reported symptoms, and task 2's retune is what makes
 * a band assertion meaningful. Imports the two routines directly by name,
 * mirroring `handbrakeRoutine`'s own precedent in
 * `tests/vehicle-telemetry.test.ts`, rather than through a
 * `findRoutine`-style lookup into `ROUTINES` (neither routine is a member of
 * it).
 */

describe("vehicle-recovery: powerSlideRecoveryRoutine (260920-j4d symptom 1)", () => {
  it("returns a finite recovery time at default tuning (the routine completes, not Infinity)", () => {
    const result = runRoutine(powerSlideRecoveryRoutine, defaultTuning());

    expect(Number.isFinite(result.value)).toBe(true);
  });

  it("two runs in a row produce a bit-identical result (setup() resets closure state)", () => {
    const first = runRoutine(powerSlideRecoveryRoutine, defaultTuning());
    const second = runRoutine(powerSlideRecoveryRoutine, defaultTuning());

    expect(second.value).toBe(first.value);
    expect(second.pass).toBe(first.pass);
    expect(second.unit).toBe(first.unit);
  });
});

describe("vehicle-recovery: highSpeedPulseRoutine (260920-j4d symptom 2)", () => {
  /**
   * `[MEASURED]` baseline finding, worse than this plan's own `<behavior>`
   * spec anticipated: at the LITERAL `defaultTuning()`, the small 6.75 deg
   * pulse does not merely produce a slowly-decaying slip angle — it kicks the
   * chassis into a near-constant ~10 deg/s yaw rate that persists for
   * seconds with almost no decay (slip angle itself settles back to a small
   * ~0.5-0.6 deg almost immediately, so the divergence is in HEADING, not
   * slip). Hands-off for the full 5 s settle window, that sustained turn
   * carries the car off the telemetry ground's finite x-extent
   * (`GROUND_HALF_EXTENTS.x = 60`, `src/physics/telemetry/run.ts`) before the
   * settle phase ever completes, which is exactly the `contacts === 0`
   * condition this plan's own `<action>` text mandates `evaluate` treat as
   * `Number.POSITIVE_INFINITY` (a real, uncorrupted "left the measurable
   * track" reading, not a routine defect — the alternative, reporting a
   * slip-angle average computed from ticks where the car is airborne over
   * open space, would be the actual T-02-19 violation).
   *
   * Root-caused with a scratch sweep (not committed): `slideCatchGain` and
   * `slideCatchDamping`, even pushed to their `TUNING_RANGES` maximums (0.6 /
   * 2.0 — 5x and ~5.7x the shipped defaults), produced a BYTE-FOR-BYTE
   * identical divergence — the assist that targets slip angle and yaw rate
   * has essentially zero authority here, because slip angle is already small
   * throughout. `powerOversteerGain` also has zero effect at any value
   * (matches `<root_cause>` Fact 1 — during `settle`, `steer` is 0, so its
   * lerp factor is 0 regardless of gain). `wheels.rearSideFriction`, by
   * contrast, is dispositive: raising it from the shipped 0.2 resolves the
   * divergence entirely, and even this plan's own last-resort ceiling of
   * 0.26 already produces a small, cleanly-decaying result (~1.6 deg
   * post-pulse max). This is strong evidence the mechanism is the permanent
   * front/rear grip ASYMMETRY (front 1.0 vs rear 0.2) sustaining a
   * self-consistent, near-constant-radius low-angle drift equilibrium once
   * perturbed, rather than an under-damped oscillation as `<root_cause>`
   * Fact 4 hypothesized — useful context for task 2's sweep, which already
   * treats `rearSideFriction` as an available (if last-resort) lever.
   */
  it("[MEASURED] at default tuning the pulse induces a sustained, barely-damped yaw rate that carries the car off the finite test track before the 5s settle window completes — reports Number.POSITIVE_INFINITY per this plan's own T-02-19 discipline, not a healthy/decaying baseline", () => {
    const result = runRoutine(highSpeedPulseRoutine, defaultTuning());

    expect(result.value).toBe(Number.POSITIVE_INFINITY);
    expect(result.pass).toBe(false);
  });

  it("two runs in a row produce a bit-identical result, including at Infinity (setup() resets closure state)", () => {
    const first = runRoutine(highSpeedPulseRoutine, defaultTuning());
    const second = runRoutine(highSpeedPulseRoutine, defaultTuning());

    expect(second.value).toBe(first.value);
    expect(second.pass).toBe(first.pass);
    expect(second.unit).toBe(first.unit);
  });

  it("returns a finite, reproducible, decaying post-pulse slip once the maneuver stays on the measurable track (proves the routine's plumbing is sound, not permanently Infinity by construction)", () => {
    // rearSideFriction 0.26 is this plan's own last-resort ceiling
    // (<root_cause>'s NON-GOAL) and, per the scratch sweep documented above,
    // is enough on its own to keep the car on the finite test track for the
    // full settle window. This is an anti-trivially-green companion to the
    // Infinity case above: it proves `highSpeedPulseRoutine` is not simply
    // hardcoded to fail, and that its off-track detection is a real,
    // conditional check rather than dead code.
    const tuning = defaultTuning();
    tuning.wheels.rearSideFriction = 0.26;
    const result = runRoutine(highSpeedPulseRoutine, tuning);

    expect(Number.isFinite(result.value)).toBe(true);
    expect(result.value).toBeLessThan(15);
  });
});

describe("vehicle-recovery: canonical ROUTINES is unperturbed", () => {
  it("runAllRoutines(defaultTuning()) still returns exactly 6 results — the new routines are not in ROUTINES", () => {
    const results = runAllRoutines(defaultTuning());

    expect(results.length).toBe(6);
    expect(ROUTINES.length).toBe(6);
  });
});
