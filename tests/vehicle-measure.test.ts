import { describe, expect, it } from "vitest";
import { defaultSurfaceProfiles } from "../src/core/surface-tuning";
import { classDefaultTuning } from "../src/core/vehicle-class";
import { defaultTuning } from "../src/core/vehicle-tuning";
import type { Routine } from "../src/physics/telemetry/routines";
import { ROUTINES } from "../src/physics/telemetry/routines";
import { runRoutine } from "../src/physics/telemetry/run";
import { runSurfaceSkidpadSweep } from "../src/physics/telemetry/surface-routines";
import {
  measureFullLockTilt,
  measureRestContact,
  measureSettle,
  measureSurfaceSkidpad,
  measureTimeToSpeed,
  measureTopSpeed,
  measureZeroToSixty,
} from "../src/physics/telemetry/vehicle-measure";

const accel = ROUTINES.find((r) => r.id === "accel");
if (!accel) throw new Error("accel routine missing");

describe("RoutineRunOpts", () => {
  it("undefined opts is the old call", () => {
    expect(runRoutine(accel, defaultTuning(), undefined, undefined, undefined).value).toBe(
      runRoutine(accel, defaultTuning()).value,
    );
  });
  it("frontDriveShare changes an AWD accel run", () => {
    // The 0-60 time itself is quantised to the same tick for any drive share
    // (total force is identical), so compare a continuous probe: speed at 1 s.
    const probe: Routine = {
      id: "accel",
      label: "probe",
      drive: (tick) => (tick >= 60 ? null : { steer: 0, throttle: 1, brake: 0, handbrake: false }),
      sample: (_tick, s, acc) => {
        acc.v = s.forwardSpeedMs;
        acc.z = s.position.z;
      },
      evaluate: (acc) => ({
        id: "accel",
        label: "probe",
        value: (acc.v ?? 0) + (acc.z ?? 0) * 1e-3,
        unit: "m/s",
        target: "",
        pass: true,
      }),
    };
    const t = classDefaultTuning("awd");
    expect(runRoutine(probe, t, undefined, undefined, { frontDriveShare: 0.4 }).value).not.toBe(
      runRoutine(probe, t).value,
    );
  });
  it("spawnY 3 still yields a finite accel value", () => {
    const v = runRoutine(accel, defaultTuning(), undefined, undefined, { spawnY: 3 }).value;
    expect(Number.isFinite(v), `v=${v}`).toBe(true);
  });
  it("surface skidpad sweep without opts is unchanged", () => {
    const a = runSurfaceSkidpadSweep(defaultTuning(), defaultSurfaceProfiles()).map((r) => r.value);
    const b = runSurfaceSkidpadSweep(defaultTuning(), defaultSurfaceProfiles(), undefined).map(
      (r) => r.value,
    );
    expect(b).toEqual(a);
  });
});

describe("vehicle-measure helpers", () => {
  it("measureZeroToSixty matches the accel routine", () => {
    expect(measureZeroToSixty(defaultTuning())).toBe(runRoutine(accel, defaultTuning()).value);
  });
  it("measureSettle settles on flat ground", () => {
    const r = measureSettle(defaultTuning());
    expect(r.settleSec).toBeLessThan(2);
    expect(r.bandM).toBeLessThanOrEqual(0.01);
  });
  it("measureRestContact sees all four wheels", () => {
    expect(measureRestContact(defaultTuning())).toBe(4);
  });
  it("measureFullLockTilt returns a finite angle", () => {
    const r = measureFullLockTilt(defaultTuning(), 15);
    expect(Number.isFinite(r.maxTiltDeg)).toBe(true);
    expect(r.maxTiltDeg).toBeGreaterThanOrEqual(0);
    expect(r.maxTiltDeg).toBeLessThan(90);
  });
  it("measureTopSpeed reports a plausible, repeatable top speed", () => {
    // drive.topSpeedMs is a gear/steer-fade scale, not a speed cap: the muscle
    // car actually reaches ~69 m/s, so the plan's "within 15% of topSpeedMs"
    // does not hold. Assert the measured value is finite, above the scale, and
    // deterministic instead.
    const t = defaultTuning();
    const v = measureTopSpeed(t);
    expect(Number.isFinite(v)).toBe(true);
    expect(v).toBeGreaterThan(t.drive.topSpeedMs);
    expect(measureTopSpeed(t)).toBe(v);
  });
  it("measureSurfaceSkidpad returns a finite g", () => {
    expect(
      Number.isFinite(measureSurfaceSkidpad(defaultTuning(), "tarmac", defaultSurfaceProfiles())),
    ).toBe(true);
  });
});

describe("measureTimeToSpeed", () => {
  it("equals measureZeroToSixty at 60 mph", () => {
    expect(measureTimeToSpeed(defaultTuning(), 26.8224)).toBe(measureZeroToSixty(defaultTuning()));
  });
  it("is finite and quicker for a lower speed", () => {
    const t20 = measureTimeToSpeed(defaultTuning(), 20);
    expect(Number.isFinite(t20)).toBe(true);
    expect(t20).toBeLessThan(measureTimeToSpeed(defaultTuning(), 26.8224));
  });
  it("is +Infinity when the speed is unreachable", () => {
    expect(measureTimeToSpeed(defaultTuning(), 1000)).toBe(Number.POSITIVE_INFINITY);
  });
});
