import { describe, expect, it } from "vitest";
import {
  type CameraSpeedCurve,
  framingForSpeed,
  speedFactor01,
} from "../src/render/camera/camera-math";

/**
 * Node-only, pure-function tests for the speed-driven altitude/distance/FOV
 * curve (CAM-02). Builds its own literal curve for the monotonicity/clamp
 * assertions; the SC4 separation assertion below uses a curve declared
 * locally in this test with a comment pointing at plan 03-04 as the file
 * that will own the shipped default values — 03-04 re-asserts the same
 * separation against the real defaults.
 */

describe("speedFactor01", () => {
  it("returns 0 at or below lowMs", () => {
    expect(speedFactor01(10, 10, 20)).toBe(0);
    expect(speedFactor01(5, 10, 20)).toBe(0);
    expect(speedFactor01(-100, 10, 20)).toBe(0);
  });

  it("returns 1 at or above highMs", () => {
    expect(speedFactor01(20, 10, 20)).toBe(1);
    expect(speedFactor01(25, 10, 20)).toBe(1);
    expect(speedFactor01(1000, 10, 20)).toBe(1);
  });

  it("is monotonic non-decreasing across a 40-point sweep from lowMs - 5 to highMs + 20", () => {
    const lowMs = 10;
    const highMs = 20;
    let prev = -Infinity;
    for (let i = 0; i <= 39; i++) {
      const speedMs = lowMs - 5 + (i / 39) * (highMs + 20 - (lowMs - 5));
      const v = speedFactor01(speedMs, lowMs, highMs);
      expect(v).toBeGreaterThanOrEqual(prev);
      prev = v;
    }
  });

  it("returns a finite number when highMs === lowMs (degenerate range)", () => {
    const v = speedFactor01(15, 10, 10);
    expect(Number.isFinite(v)).toBe(true);
  });
});

const testCurve: CameraSpeedCurve = {
  lowSpeedMs: 0,
  highSpeedMs: 53.64, // aligned to the speedometer's 120 mph amber transition
  low: { altitudeM: 12, distanceM: 10, fovDeg: 50 },
  high: { altitudeM: 30, distanceM: 24, fovDeg: 70 },
};

describe("framingForSpeed", () => {
  it("returns an { altitudeM, distanceM, fovDeg } triple", () => {
    const result = framingForSpeed(20, testCurve);
    expect(typeof result.altitudeM).toBe("number");
    expect(typeof result.distanceM).toBe("number");
    expect(typeof result.fovDeg).toBe("number");
  });

  it("is monotonic non-decreasing in speed across a 60-point sweep from 0 to 80 m/s", () => {
    let prevAlt = -Infinity;
    let prevDist = -Infinity;
    let prevFov = -Infinity;
    for (let i = 0; i <= 59; i++) {
      const speedMs = (i / 59) * 80;
      const result = framingForSpeed(speedMs, testCurve);
      expect(result.altitudeM).toBeGreaterThanOrEqual(prevAlt);
      expect(result.distanceM).toBeGreaterThanOrEqual(prevDist);
      expect(result.fovDeg).toBeGreaterThanOrEqual(prevFov);
      prevAlt = result.altitudeM;
      prevDist = result.distanceM;
      prevFov = result.fovDeg;
    }
  });

  it("clamps at speedMs = 0 to the curve's low-speed triple", () => {
    const result = framingForSpeed(0, testCurve);
    expect(result).toEqual(testCurve.low);
  });

  it("clamps at speedMs = 1000 to the curve's high-speed triple", () => {
    const result = framingForSpeed(1000, testCurve);
    expect(result).toEqual(testCurve.high);
  });

  it("SC4 separation: 60 mph vs 110 mph differ by >= 6 degrees FOV and >= 5m altitude", () => {
    const mphToMs = 0.44704;
    const at60 = framingForSpeed(60 * mphToMs, testCurve);
    const at110 = framingForSpeed(110 * mphToMs, testCurve);
    expect(at110.fovDeg - at60.fovDeg).toBeGreaterThanOrEqual(6);
    expect(at110.altitudeM - at60.altitudeM).toBeGreaterThanOrEqual(5);
  });

  it("non-finite speedMs returns the low-speed triple, not NaN", () => {
    const result = framingForSpeed(NaN, testCurve);
    expect(result).toEqual(testCurve.low);
    expect(Number.isFinite(result.fovDeg)).toBe(true);
  });
});
