import { describe, expect, it } from "vitest";
import {
  DIGIT_TAU_SEC,
  dampStep,
  MAX_MPH,
  mphFromGroundSpeed,
  needleAngleDeg,
  REDLINE_MPH,
  readoutColour,
  SWEEP_DEG,
  SWEEP_START_DEG,
} from "../src/hud/speedometer";

/**
 * Only the pure half of `src/hud/speedometer.ts` is exercised here.
 * `createSpeedometer` needs a DOM that does not exist in Vitest's `node`
 * environment; the browser checkpoint in plan 02-10 covers it, exactly as
 * `tests/profiler-hud.test.ts:6-11` scopes `formatHudText` versus `createHud`.
 */

describe("mphFromGroundSpeed", () => {
  it("converts 0 m/s to 0 mph", () => {
    expect(mphFromGroundSpeed(0)).toBe(0);
  });

  it("converts 26.8224 m/s to 60.0 mph within 1e-6", () => {
    expect(mphFromGroundSpeed(26.8224)).toBeCloseTo(60.0, 6);
  });

  it("converts 53.6448 m/s to 120.0 mph within 1e-6", () => {
    expect(mphFromGroundSpeed(53.6448)).toBeCloseTo(120.0, 6);
  });
});

describe("needleAngleDeg — the four 02-UI-SPEC.md check values", () => {
  it("0 mph -> -120 degrees (lower-left); SWEEP_START_DEG is -120", () => {
    expect(SWEEP_START_DEG).toBe(-120);
    expect(needleAngleDeg(0)).toBe(-120);
  });

  it("80 mph -> 0 degrees (straight up); MAX_MPH is 160", () => {
    expect(MAX_MPH).toBe(160);
    expect(needleAngleDeg(80)).toBe(0);
  });

  it("120 mph -> +60 degrees; SWEEP_DEG is 240", () => {
    expect(SWEEP_DEG).toBe(240);
    expect(needleAngleDeg(120)).toBe(60);
  });

  it("160 mph -> +120 degrees (lower-right)", () => {
    expect(needleAngleDeg(160)).toBe(120);
  });
});

describe("needleAngleDeg — clamping", () => {
  it("clamps 200 mph to +120, not beyond", () => {
    expect(needleAngleDeg(200)).toBe(120);
  });

  it("clamps -5 mph to -120, not below", () => {
    expect(needleAngleDeg(-5)).toBe(-120);
  });
});

describe("damping — framerate independence", () => {
  it("damping reaches within 0.5 mph of the same value whether stepped in 16.7ms or 6.9ms increments over the same elapsed time", () => {
    const TOTAL_MS = 500;

    let dampedAt167 = 0;
    for (let elapsed = 0; elapsed < TOTAL_MS; elapsed += 16.7) {
      dampedAt167 = dampStep(dampedAt167, 100, 16.7);
    }

    let dampedAt69 = 0;
    for (let elapsed = 0; elapsed < TOTAL_MS; elapsed += 6.9) {
      dampedAt69 = dampStep(dampedAt69, 100, 6.9);
    }

    expect(Math.abs(dampedAt167 - dampedAt69)).toBeLessThan(0.5);
  });

  it("damping settles within 95% of target at ~0.36s accumulated dt when driving 0 -> 100 mph; DIGIT_TAU_SEC is 0.12", () => {
    expect(DIGIT_TAU_SEC).toBe(0.12);

    let damped = 0;
    let accumulatedMs = 0;
    const STEP_MS = 16.7;
    while (accumulatedMs < 360) {
      damped = dampStep(damped, 100, STEP_MS);
      accumulatedMs += STEP_MS;
    }

    expect(damped).toBeGreaterThanOrEqual(95);
  });

  it("damping is applied before rounding: returns a non-integer mid-transit", () => {
    const damped = dampStep(0, 100, 16.7);
    expect(Number.isInteger(damped)).toBe(false);
  });
});

describe("readoutColour", () => {
  it("threshold pair: 119.9 mph is off-white", () => {
    expect(readoutColour(119.9)).toBe("#F2EFE6");
  });

  it("threshold pair: 120 mph is amber; REDLINE_MPH is 120", () => {
    expect(REDLINE_MPH).toBe(120);
    expect(readoutColour(120)).toBe("#E8A33D");
  });
});

describe("purity", () => {
  it("is pure: this suite runs in Node with no `document` at all — the fact it runs is itself the proof the pure half touches no DOM", () => {
    expect(typeof mphFromGroundSpeed(10)).toBe("number");
    expect(typeof needleAngleDeg(10)).toBe("number");
    expect(typeof dampStep(0, 10, 16.7)).toBe("number");
    expect(typeof readoutColour(10)).toBe("string");
  });
});
