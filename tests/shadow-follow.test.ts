import { describe, expect, it } from "vitest";
import { snapShadowTarget } from "../src/render/shadow-follow";

const DIR = { x: 20, y: 30, z: 20 };

describe("snapShadowTarget", () => {
  it("moves the target by less than a texel", () => {
    const t = { x: 123.456, y: 7.89, z: -45.67 };
    const s = snapShadowTarget(t, DIR, 0.03);
    expect(Math.hypot(s.x - t.x, s.y - t.y, s.z - t.z)).toBeLessThan(0.03 * Math.SQRT2);
  });

  it("ignores movement along the light direction (only the sideways part snaps)", () => {
    const base = { x: 100.1, y: 5.2, z: 50.3 };
    const k = 0.37;
    const moved = { x: base.x + DIR.x * k, y: base.y + DIR.y * k, z: base.z + DIR.z * k };
    const a = snapShadowTarget(base, DIR, 0.5);
    const b = snapShadowTarget(moved, DIR, 0.5);
    expect(b.x - a.x).toBeCloseTo(DIR.x * k, 9);
    expect(b.y - a.y).toBeCloseTo(DIR.y * k, 9);
    expect(b.z - a.z).toBeCloseTo(DIR.z * k, 9);
  });

  it("is idempotent", () => {
    const once = snapShadowTarget({ x: 3.3, y: 1.1, z: -9.9 }, DIR, 0.25);
    const twice = snapShadowTarget(once, DIR, 0.25);
    expect(twice.x).toBeCloseTo(once.x, 9);
    expect(twice.y).toBeCloseTo(once.y, 9);
    expect(twice.z).toBeCloseTo(once.z, 9);
  });

  it("keeps the depth along the light unchanged", () => {
    const t = { x: 12.3, y: 4.5, z: 6.7 };
    const s = snapShadowTarget(t, DIR, 0.1);
    const len = Math.hypot(DIR.x, DIR.y, DIR.z);
    const depth = (p: { x: number; y: number; z: number }) =>
      (p.x * DIR.x + p.y * DIR.y + p.z * DIR.z) / len;
    expect(depth(s)).toBeCloseTo(depth(t), 9);
  });

  it("returns the target unchanged for degenerate input", () => {
    const t = { x: 1, y: 2, z: 3 };
    expect(snapShadowTarget(t, { x: 0, y: 1, z: 0 }, 0.1)).toBe(t);
    expect(snapShadowTarget(t, DIR, 0)).toBe(t);
  });
});
