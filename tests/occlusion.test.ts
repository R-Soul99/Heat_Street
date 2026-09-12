import { describe, expect, it } from "vitest";
import {
  classifyOcclusion,
  densityFrom,
  fadeTargetOpacity,
  type OcclusionHit,
  steepenPitchRad,
} from "../src/render/camera/occlusion";

/**
 * Node-only tests for occlusion classification and both CAM-04 mitigation
 * curves. Every input is a hand-built plain object array — no
 * `THREE.Raycaster`, no scene, no WebGL — mirroring `tests/debug-gate.test.ts`'s
 * hand-built-fake style.
 */

describe("classifyOcclusion", () => {
  it("returns not-occluded with no occluder ids for an empty hit array", () => {
    const result = classifyOcclusion([], 50, 0.5);
    expect(result).toEqual({ occluded: false, occluderIds: [] });
  });

  it("a hit closer than the target classifies as occluded and reports its id", () => {
    const hits: OcclusionHit[] = [{ distance: 20, id: 7 }];
    const result = classifyOcclusion(hits, 50, 0.5);
    expect(result.occluded).toBe(true);
    expect(result.occluderIds).toEqual([7]);
  });

  it("a hit behind the target (distance > targetDistanceM) is NOT an occluder", () => {
    const hits: OcclusionHit[] = [{ distance: 51, id: 3 }];
    const result = classifyOcclusion(hits, 50, 0.5);
    expect(result.occluded).toBe(false);
    expect(result.occluderIds).toEqual([]);
  });

  it("a hit within nearTargetMarginM of the target is NOT an occluder", () => {
    const hits: OcclusionHit[] = [{ distance: 49.99, id: 4 }];
    const result = classifyOcclusion(hits, 50, 0.5);
    expect(result.occluded).toBe(false);
    expect(result.occluderIds).toEqual([]);
  });

  it("multiple hits return every occluder id, de-duplicated, in ascending distance order", () => {
    const hits: OcclusionHit[] = [
      { distance: 30, id: 2 },
      { distance: 10, id: 1 },
      { distance: 10, id: 1 }, // duplicate
      { distance: 20, id: 3 },
    ];
    const result = classifyOcclusion(hits, 50, 0.5);
    expect(result.occluded).toBe(true);
    // Ascending by distance: id 1 (10), id 3 (20), id 2 (30) — not insertion
    // order and not numeric id order.
    expect(result.occluderIds).toEqual([1, 3, 2]);
  });
});

describe("fadeTargetOpacity", () => {
  it("returns the floor when occluded", () => {
    expect(fadeTargetOpacity(true, 1, 0.15)).toBe(0.15);
  });

  it("returns baseOpacity when not occluded", () => {
    expect(fadeTargetOpacity(false, 1, 0.15)).toBe(1);
  });

  it("the floor is never 0 in practice — a caller-supplied non-zero floor is honored, not overridden", () => {
    expect(fadeTargetOpacity(true, 1, 0.1)).toBeGreaterThan(0);
  });
});

describe("densityFrom", () => {
  it("returns 0 for 0/8", () => {
    expect(densityFrom(0, 8)).toBe(0);
  });

  it("returns 1 for 8/8", () => {
    expect(densityFrom(8, 8)).toBe(1);
  });

  it("returns 0.5 for 4/8", () => {
    expect(densityFrom(4, 8)).toBe(0.5);
  });

  it("returns 0 (not NaN) for totalRayCount of 0", () => {
    const result = densityFrom(0, 0);
    expect(result).toBe(0);
    expect(Number.isFinite(result)).toBe(true);
  });
});

describe("steepenPitchRad", () => {
  const basePitchRad = 0.6;
  const maxPitchRad = 1.5;

  it("returns basePitchRad at density 0", () => {
    expect(steepenPitchRad(basePitchRad, maxPitchRad, 0)).toBeCloseTo(basePitchRad, 12);
  });

  it("returns maxPitchRad at density 1", () => {
    expect(steepenPitchRad(basePitchRad, maxPitchRad, 1)).toBeCloseTo(maxPitchRad, 12);
  });

  it("is monotonic non-decreasing across a 20-point density sweep", () => {
    let prev = -Infinity;
    for (let i = 0; i <= 19; i++) {
      const density = i / 19;
      const v = steepenPitchRad(basePitchRad, maxPitchRad, density);
      expect(v).toBeGreaterThanOrEqual(prev);
      prev = v;
    }
  });

  it("clamps a density outside [0,1] rather than extrapolating", () => {
    expect(steepenPitchRad(basePitchRad, maxPitchRad, -1)).toBeCloseTo(basePitchRad, 12);
    expect(steepenPitchRad(basePitchRad, maxPitchRad, 2)).toBeCloseTo(maxPitchRad, 12);
  });

  it("the transition has no visible corner — uses smoothstep, not a linear ramp", () => {
    // A linear ramp has a constant derivative; smoothstep's derivative is 0
    // at both ends and peaks in the middle. Assert the step size near the
    // ends is smaller than the step size at the midpoint, which only holds
    // for an eased (non-linear) curve.
    const range = maxPitchRad - basePitchRad;
    const stepNearStart = steepenPitchRad(basePitchRad, maxPitchRad, 0.05) - basePitchRad;
    const stepNearMid =
      steepenPitchRad(basePitchRad, maxPitchRad, 0.55) -
      steepenPitchRad(basePitchRad, maxPitchRad, 0.5);
    expect(stepNearStart).toBeLessThan(stepNearMid);
    expect(stepNearMid).toBeLessThan(range);
  });
});
