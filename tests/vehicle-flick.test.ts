import { describe, expect, it } from "vitest";
import { defaultTuning } from "../src/core/vehicle-tuning";
import type { Routine } from "../src/physics/telemetry/routines";
import { runRoutine } from "../src/physics/telemetry/run";

/**
 * Feint-and-flick: accelerate to 25 m/s, steer left for 0.5 s with a
 * keyboard-style steer ramp (5/s), then steer right. Reports the largest
 * slip angle after the reversal.
 */
function feintMaxSlipDeg(flickGain: number): number {
  const SPEED = 25;
  let t0 = -1;
  let steer = 0;
  let maxSlip = 0;
  const routine: Routine = {
    id: "flick",
    label: "flick",
    drive(tick, s) {
      if (t0 < 0 && s.forwardSpeedMs >= SPEED) t0 = tick;
      const k = t0 < 0 ? -1 : tick - t0;
      if (k > 240) return null;
      const target = k < 0 ? 0 : k < 30 ? -1 : 1;
      const step = 5 / 60;
      steer += Math.max(-step, Math.min(step, target - steer));
      return { steer, throttle: k < 0 ? 1 : 0.6, brake: 0, handbrake: false };
    },
    sample(tick, s) {
      if (t0 >= 0 && tick - t0 > 40) {
        maxSlip = Math.max(maxSlip, Math.abs((s.slipAngleRad * 180) / Math.PI));
      }
    },
    evaluate: () => ({
      id: "flick",
      label: "flick",
      value: maxSlip,
      unit: "deg",
      target: "",
      pass: true,
    }),
  };
  const tuning = defaultTuning();
  tuning.drive.flickGain = flickGain;
  return runRoutine(routine, tuning).value;
}

describe("weight-shift flick", () => {
  it("is off by default: shipped handling is unchanged", () => {
    expect(defaultTuning().drive.flickGain).toBe(0);
  });

  it("a feint-and-flick slides further the more flick gain there is, and stays controllable", () => {
    const off = feintMaxSlipDeg(0);
    const half = feintMaxSlipDeg(0.5);
    const full = feintMaxSlipDeg(1);
    expect(half).toBeGreaterThan(off + 2);
    expect(full).toBeGreaterThan(half + 2);
    // Re-anchored 2026-10-28 (suspension travel 0.3 -> 0.4): 68 deg now, was <60.
    expect(full).toBeLessThan(75);
  });

  it("two runs give a bit-identical result (the swing state is reset per vehicle)", () => {
    expect(feintMaxSlipDeg(1)).toBe(feintMaxSlipDeg(1));
  });
});
