import { describe, expect, it } from "vitest";
import { shadowLook } from "../src/render/car-shadow";

describe("shadowLook", () => {
  it("is full strength and base size on the ground", () => {
    const look = shadowLook(0);
    expect(look.scale).toBe(1);
    expect(look.opacity).toBeCloseTo(0.6, 9);
  });

  it("is clearly visible from 2 to 10 m", () => {
    for (const air of [2, 5, 10]) {
      expect(shadowLook(air).opacity).toBeGreaterThan(0.25);
    }
  });

  it("is faint but still visible at 30 m and beyond", () => {
    expect(shadowLook(30).opacity).toBeGreaterThan(0.1);
    expect(shadowLook(30).opacity).toBeLessThan(shadowLook(10).opacity);
    expect(shadowLook(200).opacity).toBeGreaterThan(0.1);
  });

  it("fades and grows monotonically with height, scale capped", () => {
    let lastOpacity = Number.POSITIVE_INFINITY;
    let lastScale = 0;
    for (let air = 0; air <= 60; air += 1) {
      const look = shadowLook(air);
      expect(look.opacity).toBeLessThanOrEqual(lastOpacity);
      expect(look.scale).toBeGreaterThanOrEqual(lastScale);
      lastOpacity = look.opacity;
      lastScale = look.scale;
    }
    expect(shadowLook(1000).scale).toBeLessThanOrEqual(3.5);
  });

  it("treats negative or non-finite height as on the ground", () => {
    expect(shadowLook(-3)).toEqual(shadowLook(0));
    expect(shadowLook(Number.NaN)).toEqual(shadowLook(0));
  });
});
