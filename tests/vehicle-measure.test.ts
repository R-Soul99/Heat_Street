import { describe, expect, it } from "vitest";
import { defaultSurfaceProfiles } from "../src/core/surface-tuning";
import { classDefaultTuning } from "../src/core/vehicle-class";
import { defaultTuning } from "../src/core/vehicle-tuning";
import type { Routine } from "../src/physics/telemetry/routines";
import { ROUTINES } from "../src/physics/telemetry/routines";
import { runRoutine } from "../src/physics/telemetry/run";
import { runSurfaceSkidpadSweep } from "../src/physics/telemetry/surface-routines";

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
    expect(Number.isFinite(v)).toBe(true);
  });
  it("surface skidpad sweep without opts is unchanged", () => {
    const a = runSurfaceSkidpadSweep(defaultTuning(), defaultSurfaceProfiles()).map((r) => r.value);
    const b = runSurfaceSkidpadSweep(defaultTuning(), defaultSurfaceProfiles(), undefined).map(
      (r) => r.value,
    );
    expect(b).toEqual(a);
  });
});
