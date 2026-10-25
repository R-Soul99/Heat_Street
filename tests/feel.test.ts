import { describe, expect, it } from "vitest";
import {
  applyFeel,
  FEEL_CONTROLS,
  FEEL_DEFAULTS,
  type FeelSettings,
  parseFeelFlag,
  parseSavedFeel,
  serializeFeel,
} from "../src/core/feel";
import { classDefaultTuning } from "../src/core/vehicle-class";
import { defaultTuning, TUNING_RANGES } from "../src/core/vehicle-tuning";

const NEUTRAL: FeelSettings = { ...FEEL_DEFAULTS, flick: 0 };

function derived(feel: FeelSettings, id: "rwd" | "fwd" | "awd" = "rwd") {
  const base = classDefaultTuning(id);
  const t = classDefaultTuning(id);
  applyFeel(t, base, feel);
  return { base, t };
}

describe("applyFeel", () => {
  it("mid-scale sliders (flick 0) leave the class base tuning untouched", () => {
    for (const id of ["rwd", "fwd", "awd"] as const) {
      const { base, t } = derived(NEUTRAL, id);
      expect(t).toEqual(base);
    }
  });

  it("the default settings only add the flick on top of the base", () => {
    const { base, t } = derived(FEEL_DEFAULTS);
    expect(t.drive.flickGain).toBeCloseTo(0.4);
    expect({ ...t, drive: { ...t.drive, flickGain: 0 } }).toEqual(base);
  });

  it("is idempotent: reapplying from base never drifts", () => {
    const base = defaultTuning();
    const t = defaultTuning();
    const feel = { ...FEEL_DEFAULTS, grip: 8, accel: 2, looseness: 9 };
    applyFeel(t, base, feel);
    const once = structuredClone(t);
    applyFeel(t, base, feel);
    applyFeel(t, base, { ...feel, grip: 3 });
    applyFeel(t, base, feel);
    expect(t).toEqual(once);
  });

  it("each slider moves its values in the right direction", () => {
    const lo = (k: keyof FeelSettings) => derived({ ...NEUTRAL, [k]: 0 }).t;
    const hi = (k: keyof FeelSettings) => derived({ ...NEUTRAL, [k]: 10 }).t;

    expect(hi("grip").wheels.frictionSlip).toBeGreaterThan(lo("grip").wheels.frictionSlip);
    expect(hi("steerAtSpeed").drive.highSpeedSteerFraction).toBeGreaterThan(
      lo("steerAtSpeed").drive.highSpeedSteerFraction,
    );
    expect(hi("turnIn").drive.steerRampPerSec).toBeGreaterThan(lo("turnIn").drive.steerRampPerSec);
    expect(hi("accel").drive.engineForcePerRearWheel).toBeGreaterThan(
      lo("accel").drive.engineForcePerRearWheel,
    );
    expect(hi("lowGearPunch").drive.lowGearPunch).toBeGreaterThan(
      lo("lowGearPunch").drive.lowGearPunch,
    );
    expect(hi("topSpeed").drive.topSpeedMs).toBeGreaterThan(lo("topSpeed").drive.topSpeedMs);
    expect(hi("looseness").drive.powerOversteerGain).toBeGreaterThan(
      lo("looseness").drive.powerOversteerGain,
    );
    expect(hi("looseness").wheels.rearSideFriction).toBeLessThan(
      lo("looseness").wheels.rearSideFriction,
    );
    expect(hi("pivot").drive.pivotTurn).toBeGreaterThan(lo("pivot").drive.pivotTurn);
    expect(hi("flick").drive.flickGain).toBeGreaterThan(lo("flick").drive.flickGain);
  });

  it("cuts the roll assist when grip is raised, to stay inside the roll gates", () => {
    const { base, t } = derived({ ...NEUTRAL, grip: 10 });
    expect(t.assists.bodyRollGain).toBeLessThan(base.assists.bodyRollGain);
  });

  it("every extreme combination stays inside TUNING_RANGES and finite", () => {
    const keys = FEEL_CONTROLS.map((c) => c.key);
    for (const v of [0, 10, -50, 50, Number.NaN]) {
      const feel = Object.fromEntries(keys.map((k) => [k, v])) as unknown as FeelSettings;
      const { t } = derived(feel);
      for (const [group, ranges] of Object.entries(TUNING_RANGES)) {
        for (const [key, range] of Object.entries(ranges as Record<string, unknown>)) {
          const r = range as { min?: number; max?: number };
          if (typeof r.min !== "number") continue;
          const val = (t as unknown as Record<string, Record<string, number>>)[group][key];
          expect(Number.isFinite(val), `${group}.${key}`).toBe(true);
          expect(val).toBeGreaterThanOrEqual(r.min as number);
          expect(val).toBeLessThanOrEqual(r.max as number);
        }
      }
    }
  });
});

describe("feel persistence", () => {
  it("round-trips", () => {
    const feel = { ...FEEL_DEFAULTS, grip: 7.5, flick: 9 };
    expect(parseSavedFeel(serializeFeel(feel))).toEqual(feel);
  });

  it("returns null for non-objects and bad JSON, never throws", () => {
    expect(parseSavedFeel(null)).toBeNull();
    expect(parseSavedFeel("{")).toBeNull();
    expect(parseSavedFeel("[1,2]")).toBeNull();
    expect(parseSavedFeel("7")).toBeNull();
  });

  it("clamps out-of-range numbers, defaults the rest, and ignores unknown or inherited keys", () => {
    const parsed = parseSavedFeel(
      JSON.stringify({ grip: 99, accel: "NaN", flick: -4, __proto__: { topSpeed: 9 }, extra: 1 }),
    );
    expect(parsed?.grip).toBe(10);
    expect(parsed?.accel).toBe(FEEL_DEFAULTS.accel);
    expect(parsed?.flick).toBe(0);
    expect(parsed?.topSpeed).toBe(FEEL_DEFAULTS.topSpeed);
    expect(parsed).not.toHaveProperty("extra");
  });

  it("the flag is presence-only", () => {
    expect(parseFeelFlag("?feel")).toBe(true);
    expect(parseFeelFlag("?map=grid-test&feel=1")).toBe(true);
    expect(parseFeelFlag("?debug")).toBe(false);
  });
});
