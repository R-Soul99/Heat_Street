import { describe, expect, it } from "vitest";
import { defaultTuning } from "../src/core/vehicle-tuning";
import {
  highSpeedPulseRoutine,
  powerSlideRecoveryRoutine,
  ROUTINES,
} from "../src/physics/telemetry/routines";
import { runAllRoutines, runRoutine } from "../src/physics/telemetry/run";

/**
 * 260920-j4d: two new standing routines that make the two reported handling
 * symptoms measurable headlessly, plus locked pass bands proven against a
 * candidate retune (`powerOversteerGain: 0.95`, `wheels.rearSideFriction:
 * 0.26`) found during this session's sweep. That candidate retune is
 * DELIBERATELY NOT applied to `defaultTuning()` here — the developer is
 * hand-tuning the feel live via the `?debug` panel and will hand back a
 * final values JSON (see `.planning/STATE.md`'s quick task 260920-j4d) — so
 * the "passes the locked band" cases below construct their own tuning
 * object with the candidate values rather than asserting against bare
 * `defaultTuning()`. Imports the two routines directly by name, mirroring
 * `handbrakeRoutine`'s own precedent in `tests/vehicle-telemetry.test.ts`,
 * rather than through a `findRoutine`-style lookup into `ROUTINES` (neither
 * routine is a member of it).
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

  it("passes the locked band at the candidate retune: recovers under 2.5 s power-on, and the hold slide still exceeds 25 deg", () => {
    // [MEASURED] (260920-j4d sweep): 1.52 s recovery (39% margin under the
    // 2.5 s band), hold max slip unaffected at ~33.5 deg (identical hold
    // provocation to `handbrakeRoutine`, which shares the same >25 deg
    // floor) -- the slide itself is still real, not skipped. Constructs its
    // own tuning rather than using bare `defaultTuning()` -- the candidate
    // `powerOversteerGain: 0.95` has NOT been applied to the shipped
    // defaults yet (pending the developer's own manual retune, see this
    // file's module doc comment).
    const tuning = defaultTuning();
    tuning.drive.powerOversteerGain = 0.95;
    const result = runRoutine(powerSlideRecoveryRoutine, tuning);

    expect(result.pass).toBe(true);
    expect(result.value).toBeLessThan(2.5);
  });

  it("anti-trivially-green companion: the shipped powerOversteerGain (1.1) fails the band (proves the gate can fail)", () => {
    // <root_cause> Fact 1: at throttle=1, |steer|=1 (this routine's recovery
    // phase), the blend factor saturates at 1.0 for ANY gain >= 1.0 -- 1.0
    // and 1.1 are byte-identical there, so this is the mechanism-accurate
    // "old" value, not an arbitrary pick.
    const tuning = defaultTuning();
    tuning.drive.powerOversteerGain = 1.1;
    const result = runRoutine(powerSlideRecoveryRoutine, tuning);

    expect(result.pass).toBe(false);
  });
});

describe("vehicle-recovery: highSpeedPulseRoutine (260920-j4d symptom 2)", () => {
  /**
   * `[MEASURED]` baseline finding (before this plan's retune), worse than
   * this plan's own `<behavior>` spec anticipated: at the SHIPPED
   * `powerOversteerGain 1.1` / `wheels.rearSideFriction 0.2`, the small
   * 6.75 deg pulse does not merely produce a slowly-decaying slip angle — it
   * kicks the chassis into a near-constant ~10 deg/s yaw rate that persists
   * for seconds with almost no decay (slip angle itself settles back to a
   * small ~0.5-0.6 deg almost immediately, so the divergence is in HEADING,
   * not slip). Hands-off for the full 5 s settle window, that sustained turn
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
   * divergence entirely, and this plan's own last-resort ceiling of 0.26 —
   * a candidate value, not yet applied to `defaultTuning()` (see this
   * file's module doc comment) — produces a small, cleanly decaying result
   * (~1.5 deg post-pulse max). This is strong evidence the
   * mechanism is the permanent front/rear grip ASYMMETRY (front 1.0 vs the
   * shipped rear 0.2) sustaining a self-consistent, near-constant-radius
   * low-angle drift equilibrium once perturbed, rather than an under-damped
   * oscillation as `<root_cause>` Fact 4 hypothesized.
   */
  it("anti-trivially-green companion: the shipped rearSideFriction (0.2) reports Number.POSITIVE_INFINITY (proves the gate can fail, and is not a routine defect -- see doc comment above)", () => {
    const tuning = defaultTuning();
    tuning.wheels.rearSideFriction = 0.2;
    const result = runRoutine(highSpeedPulseRoutine, tuning);

    expect(result.value).toBe(Number.POSITIVE_INFINITY);
    expect(result.pass).toBe(false);
  });

  it("two runs in a row produce a bit-identical result at default tuning (setup() resets closure state)", () => {
    const first = runRoutine(highSpeedPulseRoutine, defaultTuning());
    const second = runRoutine(highSpeedPulseRoutine, defaultTuning());

    expect(second.value).toBe(first.value);
    expect(second.pass).toBe(first.pass);
    expect(second.unit).toBe(first.unit);
  });

  it("passes the locked band at the candidate retune: post-pulse max slip decays well under 15 deg", () => {
    // [MEASURED] (260920-j4d sweep): ~1.5 deg post-pulse max slip at
    // wheels.rearSideFriction: 0.26 -- comfortably inside both the 15 deg
    // max-slip band and the 3 deg settled-slip band `pass` also checks.
    // Constructs its own tuning rather than using bare `defaultTuning()` --
    // see this file's module doc comment.
    const tuning = defaultTuning();
    tuning.wheels.rearSideFriction = 0.26;
    const result = runRoutine(highSpeedPulseRoutine, tuning);

    expect(Number.isFinite(result.value)).toBe(true);
    expect(result.pass).toBe(true);
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
