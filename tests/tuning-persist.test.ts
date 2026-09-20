import { describe, expect, it } from "vitest";
import {
  clampTuning,
  defaultTuning,
  parseSavedTuning,
  serializeTuning,
  TUNING_RANGES,
} from "../src/core/vehicle-tuning";

/**
 * `localStorage` does not exist in Vitest's `node` environment (see
 * `vitest.config.ts`, `test.environment: "node"`, shared by every Rapier test
 * in this repo). This is precisely why `parseSavedTuning`/`clampTuning` take
 * `raw: string | null` / a plain `VehicleTuning` object rather than reading
 * storage themselves — the validation logic is pure and fully exercisable
 * here without a DOM, exactly as `tests/debug-gate.test.ts` exercises
 * `parseDebugFlag` without one.
 *
 * Every case in this file asserts a NON-THROWING return. This module is the
 * ASVS V5 boundary a hostile or corrupt `localStorage` blob crosses on its
 * way into `world.step()` (T-02-01) — a thrown exception here would be as bad
 * as a `NaN` getting through, since either one breaks the tick.
 */

/** Recursively asserts every numeric leaf of `t` is `Number.isFinite`. */
function assertAllLeavesFinite(node: Record<string, unknown>, path: string[] = []): void {
  for (const key of Object.keys(node)) {
    const value = node[key];
    const nextPath = [...path, key];
    if (typeof value === "number") {
      expect(Number.isFinite(value), `${nextPath.join(".")} should be finite, got ${value}`).toBe(
        true,
      );
    } else if (typeof value === "object" && value !== null) {
      assertAllLeavesFinite(value as Record<string, unknown>, nextPath);
    }
  }
}

describe("serializeTuning + parseSavedTuning round trip", () => {
  it("round-trips defaultTuning() through serialize/parse unchanged", () => {
    const original = defaultTuning();
    const result = parseSavedTuning(serializeTuning(original));
    expect(result).toEqual(original);
  });
});

describe("parseSavedTuning — structural rejection, never throws", () => {
  it("returns null for null input", () => {
    expect(parseSavedTuning(null)).toBeNull();
  });

  it("returns null for truncated JSON", () => {
    expect(parseSavedTuning('{"wheels":{')).toBeNull();
  });

  it.each(["[]", '"hello"', "7"])("returns null for a non-object top level: %s", (raw) => {
    expect(parseSavedTuning(raw)).toBeNull();
  });

  it("returns null for an object missing the assists group", () => {
    const blob = JSON.stringify({ chassis: {}, wheels: {}, drive: {} });
    expect(parseSavedTuning(blob)).toBeNull();
  });
});

describe("parseSavedTuning — hostile leaf values are clamped or defaulted, never propagated", () => {
  it("replaces a null mass with the default (1390), not with the range minimum", () => {
    const blob = '{"chassis":{"mass":null},"wheels":{},"drive":{},"assists":{}}';
    const result = parseSavedTuning(blob);
    expect(result).not.toBeNull();
    expect(result?.chassis.mass).toBe(1390);
  });

  it("clamps an absurd mass of 1e9 to TUNING_RANGES.chassis.mass.max", () => {
    const blob = JSON.stringify({
      chassis: { mass: 1e9 },
      wheels: {},
      drive: {},
      assists: {},
    });
    const result = parseSavedTuning(blob);
    expect(result?.chassis.mass).toBe(TUNING_RANGES.chassis.mass.max);
  });

  it("clamps a bodyRollGain of 5 to 0.15 — the measured flip threshold is 0.20, so this is the value that turns a hostile blob into a car on its roof", () => {
    const blob = JSON.stringify({
      chassis: {},
      wheels: {},
      drive: {},
      assists: { bodyRollGain: 5 },
    });
    const result = parseSavedTuning(blob);
    expect(result?.assists.bodyRollGain).toBe(0.15);
  });

  it("clamps a frictionSlip of -3 to TUNING_RANGES.wheels.frictionSlip.min", () => {
    const blob = JSON.stringify({
      chassis: {},
      wheels: { frictionSlip: -3 },
      drive: {},
      assists: {},
    });
    const result = parseSavedTuning(blob);
    expect(result?.wheels.frictionSlip).toBe(TUNING_RANGES.wheels.frictionSlip.min);
  });

  it("returns the default for a script-tag string in a numeric field, and the result is typeof number", () => {
    const blob = JSON.stringify({
      chassis: { mass: "<script>alert(1)</script>" },
      wheels: {},
      drive: {},
      assists: {},
    });
    const result = parseSavedTuning(blob);
    expect(result?.chassis.mass).toBe(1390);
    expect(typeof result?.chassis.mass).toBe("number");
  });

  it('every leaf of the result is Number.isFinite when every value in the blob was the string "NaN"', () => {
    // JSON has no NaN/Infinity literal, so the hostile case that matters is a
    // string "NaN" landing in a numeric field — walked recursively so a field
    // added later is covered automatically.
    const poisoned = JSON.parse(JSON.stringify(defaultTuning()));
    function poison(node: Record<string, unknown>): void {
      for (const key of Object.keys(node)) {
        if (typeof node[key] === "number") {
          node[key] = "NaN";
        } else if (typeof node[key] === "object" && node[key] !== null) {
          poison(node[key] as Record<string, unknown>);
        }
      }
    }
    poison(poisoned);
    const result = parseSavedTuning(JSON.stringify(poisoned));
    expect(result).not.toBeNull();
    assertAllLeavesFinite(result as unknown as Record<string, unknown>);
  });
});

describe("clampTuning", () => {
  it("mutates in place and returns the same object reference", () => {
    const t = defaultTuning();
    t.chassis.mass = 1e9;
    const result = clampTuning(t);
    expect(result).toBe(t);
    expect(result.chassis.mass).toBe(TUNING_RANGES.chassis.mass.max);
  });

  it("leaves an already-valid tuning object unchanged", () => {
    const t = defaultTuning();
    const before = JSON.parse(JSON.stringify(t));
    clampTuning(t);
    expect(t).toEqual(before);
  });
});
