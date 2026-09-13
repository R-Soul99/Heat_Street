import { describe, expect, it } from "vitest";
import {
  classifyOcclusion,
  densityFrom,
  fadeTargetOpacity,
  fanOffsetsRad,
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

describe("steepenPitchRad — density-to-pitch anchor for the DENSE_BUILDINGS canyon (260913-epf investigation)", () => {
  // Derived against src/physics/surface-scene.ts's DENSE_BUILDINGS canyon: a
  // 10 m drivable corridor (x in [-36, -26]) between two rows of 28 m tall
  // buildings. At the low-speed framing (basePitchDeg 41, altitude 14 m /
  // distance 16 m, src/core/camera-tuning.ts), the fan's horizontal radius
  // is 16 m, so its outermost rays (+/-30 deg) originate 16*sin(30deg) = 8 m
  // lateral of the car — past the corridor's 5 m half-width, i.e. INSIDE a
  // building. This 260913-epf investigation found the fan-ray density
  // measured in that canyon is 0/5, NOT a low-but-nonzero value (see
  // 260913-epf-SUMMARY.md for the full ray-by-ray arithmetic and verdict),
  // so this block anchors the CURVE ITSELF at every density a 5-ray fan can
  // possibly produce (1/5 .. 5/5) — a permanent regression anchor for the
  // smoothstep squash, independent of whatever any one canyon's geometry
  // happens to measure.
  const DEG_TO_RAD = Math.PI / 180;
  const RAD_TO_DEG = 180 / Math.PI;
  const basePitchRad = 41 * DEG_TO_RAD;
  const maxPitchRad = 78 * DEG_TO_RAD;

  it("1/5 (smoothstep(0.2) = 0.104) produces ~44.85 deg — only ~3.85 deg of pitch change from base", () => {
    const pitchDeg = steepenPitchRad(basePitchRad, maxPitchRad, 1 / 5) * RAD_TO_DEG;
    expect(pitchDeg).toBeCloseTo(44.848, 2);
    expect(pitchDeg - 41).toBeCloseTo(3.848, 2);
  });

  it("2/5 (smoothstep(0.4) = 0.352) produces ~54.02 deg", () => {
    const pitchDeg = steepenPitchRad(basePitchRad, maxPitchRad, 2 / 5) * RAD_TO_DEG;
    expect(pitchDeg).toBeCloseTo(54.024, 2);
  });

  it("3/5 (smoothstep(0.6) = 0.648) produces ~64.98 deg", () => {
    const pitchDeg = steepenPitchRad(basePitchRad, maxPitchRad, 3 / 5) * RAD_TO_DEG;
    expect(pitchDeg).toBeCloseTo(64.976, 2);
  });

  it("4/5 (smoothstep(0.8) = 0.896) produces ~74.15 deg", () => {
    const pitchDeg = steepenPitchRad(basePitchRad, maxPitchRad, 4 / 5) * RAD_TO_DEG;
    expect(pitchDeg).toBeCloseTo(74.152, 2);
  });

  it("5/5 (smoothstep(1) = 1) produces exactly maxPitchDeg (78 deg)", () => {
    const pitchDeg = steepenPitchRad(basePitchRad, maxPitchRad, 5 / 5) * RAD_TO_DEG;
    expect(pitchDeg).toBeCloseTo(78, 6);
  });
});

describe("fanOffsetsRad", () => {
  const HALF_SPREAD_RAD = Math.PI / 6;

  it("returns exactly count values, symmetric about 0, sorted ascending", () => {
    const offsets = fanOffsetsRad(5);
    expect(offsets).toHaveLength(5);
    const sorted = [...offsets].sort((a, b) => a - b);
    expect(offsets).toEqual(sorted);
    // Symmetric about 0: offsets[i] === -offsets[length - 1 - i], to
    // floating-point tolerance (two independently-summed float paths from
    // opposite ends of the spread need not be bit-identical).
    for (let i = 0; i < offsets.length; i++) {
      expect(offsets[i]).toBeCloseTo(-offsets[offsets.length - 1 - i], 12);
    }
  });

  it("the middle element is exactly 0 when count is odd", () => {
    const offsets = fanOffsetsRad(5);
    expect(offsets[2]).toBe(0);
    const offsets7 = fanOffsetsRad(7);
    expect(offsets7[3]).toBe(0);
  });

  it("fanOffsetsRad(1) returns [0] — a fan of one degenerates to the centre ray", () => {
    expect(fanOffsetsRad(1)).toEqual([0]);
  });

  it("fanOffsetsRad(0) returns [0] rather than an empty array", () => {
    expect(fanOffsetsRad(0)).toEqual([0]);
  });

  it("the outermost offsets do not exceed the documented PI/6 half-spread", () => {
    for (const count of [2, 3, 5, 9]) {
      const offsets = fanOffsetsRad(count);
      for (const o of offsets) {
        expect(Math.abs(o)).toBeLessThanOrEqual(HALF_SPREAD_RAD + 1e-12);
      }
      expect(Math.max(...offsets.map(Math.abs))).toBeCloseTo(HALF_SPREAD_RAD, 12);
    }
  });

  it("offsets are evenly spaced across the spread", () => {
    const offsets = fanOffsetsRad(5);
    const steps: number[] = [];
    for (let i = 1; i < offsets.length; i++) {
      steps.push(offsets[i] - offsets[i - 1]);
    }
    for (const step of steps) {
      expect(step).toBeCloseTo(steps[0], 12);
    }
  });
});
