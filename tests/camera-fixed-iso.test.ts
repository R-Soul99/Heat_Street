import { describe, expect, it } from "vitest";
import { FIXED_ISO, fixedIsoOffset } from "../src/render/camera/camera-math";

/** Pure-geometry tests for the fixed isometric-style rig's offset. */
describe("fixedIsoOffset", () => {
  it("heading north (PI) puts the camera south (+Z) of the target, no X shift", () => {
    const o = fixedIsoOffset(FIXED_ISO.headingRad, FIXED_ISO.pitchRad, FIXED_ISO.armLengthM);
    expect(o.x).toBeCloseTo(0, 9);
    expect(o.z).toBeGreaterThan(0);
    expect(o.y).toBeGreaterThan(0);
  });

  it("preserves the arm length and the pitch", () => {
    const o = fixedIsoOffset(FIXED_ISO.headingRad, FIXED_ISO.pitchRad, FIXED_ISO.armLengthM);
    expect(Math.hypot(o.x, o.y, o.z)).toBeCloseTo(FIXED_ISO.armLengthM, 9);
    expect(Math.atan2(o.y, Math.hypot(o.x, o.z))).toBeCloseTo(FIXED_ISO.pitchRad, 9);
  });

  it("uses the locked constants: 22 deg FOV, 50 deg pitch", () => {
    expect(FIXED_ISO.fovDeg).toBe(22);
    expect((FIXED_ISO.pitchRad * 180) / Math.PI).toBeCloseTo(50, 9);
  });
});
