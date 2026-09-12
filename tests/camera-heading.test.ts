import { describe, expect, it } from "vitest";
import { blendedHeadingRad, dampFactor, smoothstep01 } from "../src/render/camera/camera-math";

/**
 * Node-only, pure-function tests for the velocity-heading blend (CAM-01).
 * Mirrors `tests/debug-gate.test.ts`'s hand-built-fake style: no THREE, no
 * Rapier, no scene — every input here is a plain object or number.
 */

describe("smoothstep01", () => {
  it("returns 0 at t <= 0", () => {
    expect(smoothstep01(0)).toBe(0);
    expect(smoothstep01(-1)).toBe(0);
    expect(smoothstep01(-100)).toBe(0);
  });

  it("returns 1 at t >= 1", () => {
    expect(smoothstep01(1)).toBe(1);
    expect(smoothstep01(2)).toBe(1);
    expect(smoothstep01(100)).toBe(1);
  });

  it("returns exactly 0.5 at t = 0.5", () => {
    expect(smoothstep01(0.5)).toBe(0.5);
  });

  it("is monotonic non-decreasing across a 21-point sweep of t in [-0.5, 1.5]", () => {
    let prev = -Infinity;
    for (let i = 0; i <= 20; i++) {
      const t = -0.5 + (i / 20) * 2;
      const v = smoothstep01(t);
      expect(v).toBeGreaterThanOrEqual(prev);
      prev = v;
    }
  });
});

describe("dampFactor", () => {
  it("returns 0 at dtSec = 0", () => {
    expect(dampFactor(2, 0)).toBe(0);
  });

  it("returns 0 for a non-positive dtSec (guard)", () => {
    expect(dampFactor(2, -1)).toBe(0);
  });

  it("is strictly increasing in dtSec", () => {
    const a = dampFactor(2, 0.1);
    const b = dampFactor(2, 0.2);
    const c = dampFactor(2, 0.3);
    expect(b).toBeGreaterThan(a);
    expect(c).toBeGreaterThan(b);
  });

  it("is always in [0, 1)", () => {
    // Values kept within double-precision's representable range around 1 —
    // beyond roughly dt=20 at lambda=2, exp(-lambda*dt) underflows below
    // double epsilon and 1 - exp(...) rounds to exactly 1.0, which is a
    // floating-point precision limit, not a behavior of dampFactor itself.
    for (const dt of [0.001, 0.1, 1, 10]) {
      const v = dampFactor(2, dt);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it("dampFactor(2, 0.5) approximately 1 - exp(-1) to within 1e-12", () => {
    expect(Math.abs(dampFactor(2, 0.5) - (1 - Math.exp(-1)))).toBeLessThan(1e-12);
  });
});

describe("blendedHeadingRad", () => {
  it("at zero velocity, returns exactly the chassis-forward heading", () => {
    const velocityXZ = { x: 0, z: 0 };
    const chassisForwardXZ = { x: 1, z: 0 };
    const groundSpeedMs = 0;
    const blendSpeedMs = 1.5;
    const result = blendedHeadingRad(velocityXZ, chassisForwardXZ, groundSpeedMs, blendSpeedMs);
    const expected = Math.atan2(chassisForwardXZ.x, chassisForwardXZ.z);
    expect(result).toBeCloseTo(expected, 9);
  });

  it("well above the blend threshold, resolves to the velocity heading regardless of chassis yaw", () => {
    const velocityXZ = { x: 1, z: 0 };
    const chassisForwardXZ = { x: 0, z: -1 };
    const groundSpeedMs = 30;
    const blendSpeedMs = 1.5;
    const result = blendedHeadingRad(velocityXZ, chassisForwardXZ, groundSpeedMs, blendSpeedMs);
    expect(Math.abs(result - Math.PI / 2)).toBeLessThan(1e-9);
  });

  it("is continuous across the blend threshold — no snap", () => {
    const chassisForwardXZ = { x: 1, z: 0 }; // heading = PI/2
    // velocity at 90 degrees disagreement: pointing along +Z (heading = 0)
    const velocityDirXZ = { x: 0, z: 1 };
    // blendSpeedMs = 3 gives the smoothstep-weighted vector blend enough
    // "speed room" over the 0.05 m/s sweep step that the worst-case combined
    // rate of change (smoothstep's own peak slope times atan2's peak
    // sensitivity at a 90-degree separation, both maximal at the blend
    // midpoint) stays under the 0.08 rad/step ceiling.
    const blendSpeedMs = 3;
    let prev: number | null = null;
    for (let speed = 0; speed <= 3; speed += 0.05) {
      const velocityXZ = {
        x: velocityDirXZ.x * Math.max(speed, 0.0001),
        z: velocityDirXZ.z * Math.max(speed, 0.0001),
      };
      const result = blendedHeadingRad(velocityXZ, chassisForwardXZ, speed, blendSpeedMs);
      if (prev !== null) {
        expect(Math.abs(result - prev)).toBeLessThanOrEqual(0.08);
      }
      prev = result;
    }
  });

  it("wraparound safety: near +/-PI disagreement never crosses through 0", () => {
    // Velocity heading near +PI: pointing along -Z-ish with small +X component
    const velocityXZ = { x: 0.05, z: -1 };
    // Chassis forward near -PI: pointing along -Z-ish with small -X component
    const chassisForwardXZ = { x: -0.05, z: -1 };
    // Mid speed to get a mid blend weight.
    const groundSpeedMs = 0.75;
    const blendSpeedMs = 1.5;
    const result = blendedHeadingRad(velocityXZ, chassisForwardXZ, groundSpeedMs, blendSpeedMs);
    expect(Math.abs(result)).toBeGreaterThan(2.5);
  });

  it("degenerate anti-parallel case produces a finite number, not NaN", () => {
    const velocityXZ = { x: 1, z: 0 }; // heading PI/2
    const chassisForwardXZ = { x: -1, z: 0 }; // heading -PI/2, exactly opposite
    const groundSpeedMs = 0.75; // blend weight 0.5 at blendSpeedMs 1.5
    const blendSpeedMs = 1.5;
    const result = blendedHeadingRad(velocityXZ, chassisForwardXZ, groundSpeedMs, blendSpeedMs);
    expect(Number.isFinite(result)).toBe(true);
  });

  it("guards blendSpeedMs <= 0 by treating the blend weight as 1 (pure velocity heading)", () => {
    const velocityXZ = { x: 1, z: 0 };
    const chassisForwardXZ = { x: 0, z: -1 };
    const result = blendedHeadingRad(velocityXZ, chassisForwardXZ, 5, 0);
    expect(Math.abs(result - Math.PI / 2)).toBeLessThan(1e-9);
  });
});
