import { describe, expect, it } from "vitest";
import { defaultTuning, TUNING_RANGES, type VehicleTuning } from "../src/core/vehicle-tuning";

/**
 * Only the pure data half of `vehicle-tuning.ts` is exercised here:
 * `defaultTuning()` and `TUNING_RANGES`. The hostile-blob parse/clamp half
 * (`clampTuning`, `parseSavedTuning`, `serializeTuning`) is task 2's own file,
 * `tests/tuning-persist.test.ts`.
 */

/** Recursively walks two structurally-parallel objects, invoking `visit` at every leaf. */
function walkLeaves(
  value: Record<string, unknown>,
  ranges: Record<string, unknown>,
  path: string[],
  visit: (
    path: string[],
    value: unknown,
    range: { min: number; max: number; step: number },
  ) => void,
): void {
  for (const key of Object.keys(ranges)) {
    const rangeEntry = ranges[key] as Record<string, unknown>;
    const nextPath = [...path, key];
    if (
      typeof rangeEntry === "object" &&
      rangeEntry !== null &&
      "min" in rangeEntry &&
      "max" in rangeEntry &&
      "step" in rangeEntry
    ) {
      visit(
        nextPath,
        value[key],
        rangeEntry as unknown as { min: number; max: number; step: number },
      );
    } else {
      walkLeaves(value[key] as Record<string, unknown>, rangeEntry, nextPath, visit);
    }
  }
}

describe("defaultTuning()", () => {
  it("returns a new object on every call", () => {
    expect(defaultTuning()).not.toBe(defaultTuning());
  });

  it("mutating one call's result does not affect another call's result", () => {
    const a = defaultTuning();
    const b = defaultTuning();
    a.wheels.frictionSlip = 999;
    a.chassis.comOffset.y = 999;
    expect(b.wheels.frictionSlip).toBe(1.2);
    expect(b.chassis.comOffset.y).toBe(-0.15);
  });

  it("has the eight measured load-bearing default values, asserted by literal", () => {
    const t = defaultTuning();
    expect(t.wheels.frictionSlip).toBe(1.2);
    expect(t.wheels.rearSideFriction).toBe(0.12);
    expect(t.drive.handbrakeRearSideFriction).toBe(0.01);
    // Corrected 0.1 -> 0.08 in plan 02-07: at 0.1 the handbrake telemetry
    // routine's own 34deg slide reaches 15.40deg of chassis tilt, over the
    // roll-assist-stability gate's 15deg cutoff (see the doc comment on
    // `bodyRollGain` in src/core/vehicle-tuning.ts).
    expect(t.assists.bodyRollGain).toBe(0.08);
    expect(t.assists.autoLevelGain).toBe(0.4);
    expect(t.assists.downforcePerSpeed2).toBe(0);
    expect(t.chassis.mass).toBe(1600);
    expect(t.wheels.maxSuspensionForce).toBe(20000);
  });

  it("sets maxSteerLock to exactly Math.PI / 4", () => {
    expect(defaultTuning().drive.maxSteerLock).toBe(Math.PI / 4);
  });
});

describe("TUNING_RANGES", () => {
  it("bounds the eight fixed research-locked ranges exactly", () => {
    expect(TUNING_RANGES.chassis.mass).toEqual({ min: 800, max: 2600, step: 10 });
    expect(TUNING_RANGES.wheels.suspensionStiffness).toEqual({ min: 6, max: 40, step: 0.5 });
    expect(TUNING_RANGES.wheels.suspensionCompression).toEqual({ min: 0.2, max: 4, step: 0.05 });
    expect(TUNING_RANGES.wheels.suspensionRelaxation).toEqual({ min: 0.2, max: 4, step: 0.05 });
    expect(TUNING_RANGES.wheels.frictionSlip).toEqual({ min: 0.4, max: 3, step: 0.05 });
    expect(TUNING_RANGES.wheels.rearSideFriction).toEqual({ min: 0, max: 0.3, step: 0.005 });
    expect(TUNING_RANGES.drive.handbrakeRearSideFriction).toEqual({
      min: 0,
      max: 0.05,
      step: 0.001,
    });
    expect(TUNING_RANGES.assists.autoLevelGain).toEqual({ min: 0, max: 2, step: 0.05 });
    expect(TUNING_RANGES.assists.bodyRollGain).toEqual({ min: 0, max: 0.15, step: 0.005 });
    expect(TUNING_RANGES.assists.bodyRollMaxDeg).toEqual({ min: 0, max: 25, step: 1 });
    expect(TUNING_RANGES.assists.slideCatchGain).toEqual({ min: 0, max: 0.6, step: 0.02 });
    expect(TUNING_RANGES.assists.downforcePerSpeed2).toEqual({ min: 0, max: 40, step: 0.5 });
  });

  it("bounds bodyRollGain.max at exactly 0.15 and handbrakeRearSideFriction.max at exactly 0.05", () => {
    // Restated as its own assertion per this plan's acceptance criteria — these
    // two bounds are the ones a hostile blob (tests/tuning-persist.test.ts) is
    // clamped against, so a silent change here would silently weaken that gate.
    expect(TUNING_RANGES.assists.bodyRollGain.max).toBe(0.15);
    expect(TUNING_RANGES.drive.handbrakeRearSideFriction.max).toBe(0.05);
  });

  it("every numeric leaf of defaultTuning() has a matching TUNING_RANGES entry satisfying min <= default <= max", () => {
    // Walked recursively rather than listed field-by-field, so a field added
    // later without a matching range entry fails this test rather than being
    // silently unbounded (and therefore silently untunable/unclampable).
    const t = defaultTuning() as unknown as Record<string, unknown>;
    const ranges = TUNING_RANGES as unknown as Record<string, unknown>;
    let visited = 0;
    walkLeaves(t, ranges, [], (path, value, range) => {
      visited++;
      expect(typeof value, `${path.join(".")} should be a number`).toBe("number");
      expect(
        (value as number) >= range.min && (value as number) <= range.max,
        `${path.join(".")}=${value} should satisfy ${range.min} <= value <= ${range.max}`,
      ).toBe(true);
    });
    // Anti-trivially-green guard: if the walk visited zero leaves (e.g. a
    // broken recursive predicate), every assertion above would vacuously pass.
    expect(visited).toBeGreaterThanOrEqual(30);
  });
});

describe("VehicleTuning shape", () => {
  it("exposes exactly the four top-level groups", () => {
    const t: VehicleTuning = defaultTuning();
    expect(Object.keys(t).sort()).toEqual(["assists", "chassis", "drive", "wheels"]);
  });
});
