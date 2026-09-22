import { describe, expect, it } from "vitest";
import {
  forwardFromYaw,
  headingFromRotation,
  yawFromTravelDirection,
} from "../src/core/heading";

/** Builds the exact rotation `src/physics/vehicle.ts`'s `resetPose` builds for `headingRad`. */
function rotationFromYaw(headingRad: number): { x: number; y: number; z: number; w: number } {
  return { x: 0, y: Math.sin(headingRad / 2), z: 0, w: Math.cos(headingRad / 2) };
}

/** Wraps `angle` into `(-pi, pi]`, matching `race-state.ts`'s own wrap convention in spirit. */
function wrapAngle(angle: number): number {
  return Math.atan2(Math.sin(angle), Math.cos(angle));
}

describe("headingFromRotation (bearing convention)", () => {
  it("returns atan2(-1, 0) for the identity rotation (car facing -Z)", () => {
    expect(headingFromRotation({ x: 0, y: 0, z: 0, w: 1 })).toBeCloseTo(Math.atan2(-1, 0), 9);
  });

  it("has direction equal to forwardFromYaw(h) for a rotation built from yaw h", () => {
    for (const h of [0, 0.5, -1.2, 2.7, -Math.PI + 0.01, Math.PI - 0.01]) {
      const bearing = headingFromRotation(rotationFromYaw(h));
      const forward = forwardFromYaw(h);
      expect(Math.cos(bearing)).toBeCloseTo(forward.x, 9);
      expect(Math.sin(bearing)).toBeCloseTo(forward.z, 9);
    }
  });
});

describe("yawFromTravelDirection / forwardFromYaw", () => {
  it("yawFromTravelDirection(0.985, +0.170) is within 0.01 rad of -1.7419882003637046 (course.start.headingRad, node 16)", () => {
    // NOTE (deviation, see src/core/heading.ts's own doc comment): the plan's
    // illustrative anchor used dz = -0.170 (the raw edge-19->16 tangent's own
    // sign). That value does not satisfy this function's round-trip contract
    // with forwardFromYaw (verified against vehicle.ts's rotateVec). The
    // sign-corrected input below is exactly forwardFromYaw(-1.7419882...),
    // so it is simultaneously round-trip-consistent AND numerically close to
    // the real authored value the plan wanted this anchored against.
    const yaw = yawFromTravelDirection(0.985, 0.17);
    expect(Math.abs(yaw - -1.7419882003637046)).toBeLessThanOrEqual(0.01);
  });

  it("forwardFromYaw(h) equals (-sin h, -cos h) for representative h", () => {
    for (const h of [0, 0.5, -1.2, 2.7, -1.7419882003637046]) {
      const forward = forwardFromYaw(h);
      expect(forward.x).toBeCloseTo(-Math.sin(h), 12);
      expect(forward.z).toBeCloseTo(-Math.cos(h), 12);
    }
  });

  it("yawFromTravelDirection(forwardFromYaw(h)) round-trips h, wrapped", () => {
    for (const h of [0, 0.5, -1.2, 2.7, -3.0, 3.0, -1.7419882003637046]) {
      const forward = forwardFromYaw(h);
      const roundTripped = yawFromTravelDirection(forward.x, forward.z);
      expect(roundTripped).toBeCloseTo(wrapAngle(h), 9);
    }
  });

  it("headingFromRotation(resetPose-built rotation from yaw h) has direction matching forwardFromYaw(h) within 1e-9", () => {
    for (const h of [0.3, -2.1, 1.9, -0.001]) {
      const bearing = headingFromRotation(rotationFromYaw(h));
      const forward = forwardFromYaw(h);
      expect(Math.abs(Math.cos(bearing) - forward.x)).toBeLessThanOrEqual(1e-9);
      expect(Math.abs(Math.sin(bearing) - forward.z)).toBeLessThanOrEqual(1e-9);
    }
  });
});
