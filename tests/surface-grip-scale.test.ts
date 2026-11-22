import { describe, expect, it } from "vitest";
import { defaultSurfaceProfiles } from "../src/core/surface-tuning";
import { SURFACE_TYPES, type SurfaceType } from "../src/core/surface-types";
import { type SurfaceGripScale, UNIT_SURFACE_GRIP_SCALE } from "../src/core/vehicle-class";
import { defaultTuning } from "../src/core/vehicle-tuning";
import { ROUTINES } from "../src/physics/telemetry/routines";
import { runRoutine } from "../src/physics/telemetry/run";
import { measureSurfaceSkidpad } from "../src/physics/telemetry/vehicle-measure";

function scaleWith(surface: SurfaceType, forward: number, lateral: number): SurfaceGripScale {
  const t = {} as Record<SurfaceType, { forward: number; lateral: number }>;
  for (const s of SURFACE_TYPES) t[s] = { forward: 1, lateral: 1 };
  t[surface] = { forward, lateral };
  return t;
}

describe("surfaceGripScale on the skidpad", () => {
  const profiles = defaultSurfaceProfiles();
  it("unit scale equals no scale", () => {
    const none = measureSurfaceSkidpad(defaultTuning(), "tarmac", profiles);
    const unit = measureSurfaceSkidpad(defaultTuning(), "tarmac", profiles, {
      surfaceGripScale: UNIT_SURFACE_GRIP_SCALE,
    });
    expect(unit).toBe(none);
  });
  it("tarmac scale 0.5 lowers skidpad g by at least 10%", () => {
    const unit = measureSurfaceSkidpad(defaultTuning(), "tarmac", profiles);
    const low = measureSurfaceSkidpad(defaultTuning(), "tarmac", profiles, {
      surfaceGripScale: scaleWith("tarmac", 0.5, 0.5),
    });
    expect(low).toBeLessThan(unit * 0.9);
  });
  it("gravel scale 1.3 raises skidpad g on gravel", () => {
    const unit = measureSurfaceSkidpad(defaultTuning(), "gravel", profiles);
    const high = measureSurfaceSkidpad(defaultTuning(), "gravel", profiles, {
      surfaceGripScale: scaleWith("gravel", 1.3, 1.3),
    });
    expect(high).toBeGreaterThan(unit);
  });
  it("lateral scale alone changes the result (stiffness only, a small effect)", () => {
    const unit = measureSurfaceSkidpad(defaultTuning(), "tarmac", profiles);
    const lat = measureSurfaceSkidpad(defaultTuning(), "tarmac", profiles, {
      surfaceGripScale: scaleWith("tarmac", 1, 0.5),
    });
    expect(lat).not.toBe(unit);
  });
  it("rejects non-finite or non-positive scale values", () => {
    const accel = ROUTINES.find((r) => r.id === "accel");
    if (!accel) throw new Error("accel routine missing");
    for (const bad of [Number.NaN, 0, -1]) {
      expect(() =>
        runRoutine(accel, defaultTuning(), undefined, undefined, {
          surfaceGripScale: scaleWith("tarmac", 1, bad),
        }),
      ).toThrow(RangeError);
    }
  });
});
