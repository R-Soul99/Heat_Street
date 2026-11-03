import { describe, expect, it } from "vitest";
import { runDossier, summarise, TAP_STARTS_SEC, tapMetrics } from "../scripts/feel-dossier";
import { steerLockScale } from "../src/core/drivetrain";
import { shippedTuning } from "../src/core/feel";

/**
 * 04.3-05 (retargeted 2026-11-03): the "unwanted spin" is a high-speed
 * tap-correction oscillation. Keyboard taps at 70-105 mph over-corrected, each
 * swing bigger than the last, until the car spun (logs/tap-correction-spin-
 * 2026-11-03.csv). The tap routines replay taps through the live keyboard steer
 * ramp (`LiveInputSource`) with throttle held on a flat straight, on the car
 * players drive (`shippedTuning()`).
 */

const MPH = 0.44704;
const DEG = 180 / Math.PI;

function tap(id: string, kind: "single" | "seq" | "equal") {
  const run = runDossier(shippedTuning(), [id])[0];
  return tapMetrics(run, TAP_STARTS_SEC[kind]);
}

function peakSlip(id: string): number {
  return summarise(runDossier(shippedTuning(), [id])[0]).peakSlipDeg;
}

describe("tap corrections at speed do not spin the car", () => {
  for (const mph of [70, 100]) {
    it(`${mph} mph: a single 3-tick tap is small, settles and does not turn the car away`, () => {
      const m = tap(`tap-single-${mph}`, "single");
      expect(m.peakHeadingDeg).toBeLessThan(15);
      expect(m.peakSlipDeg).toBeLessThan(5);
      expect(m.settleSec).not.toBeNull();
      expect(m.settleSec as number).toBeLessThanOrEqual(1.0);
    });

    it(`${mph} mph: the R3, L5, R5 tap sequence from the drive log does not spin`, () => {
      const m = tap(`tap-seq-${mph}`, "seq");
      expect(m.peakHeadingDeg).toBeLessThan(30);
      expect(m.peakSlipDeg).toBeLessThan(6);
      expect(m.settleSec).not.toBeNull();
      expect(m.settleSec as number).toBeLessThanOrEqual(1.0);
    });

    it(`${mph} mph: equal alternating taps do not grow the oscillation`, () => {
      const m = tap(`tap-equal-${mph}`, "equal");
      for (let i = 1; i < m.yawPeaks.length; i++) {
        expect(m.yawPeaks[i]).toBeLessThanOrEqual(m.yawPeaks[i - 1] * 1.05 + 0.02);
      }
      expect(m.settleSec).not.toBeNull();
      expect(m.settleSec as number).toBeLessThanOrEqual(1.0);
    });
  }
});

describe("speed-sensitive steering lock", () => {
  const t = shippedTuning();
  const lockDeg = (mph: number): number =>
    t.drive.maxSteerLock *
    steerLockScale(mph * MPH, t.drive.topSpeedMs, t.drive.highSpeedSteerFraction) *
    DEG;

  it("full lock at 100 mph is about 6-8 degrees of front wheel angle", () => {
    expect(lockDeg(100)).toBeGreaterThanOrEqual(6);
    expect(lockDeg(100)).toBeLessThanOrEqual(8);
  });

  it("lock falls monotonically with speed", () => {
    let prev = Number.POSITIVE_INFINITY;
    for (let mph = 0; mph <= 110; mph += 5) {
      const d = lockDeg(mph);
      expect(d).toBeLessThanOrEqual(prev + 1e-9);
      prev = d;
    }
  });

  it("low-speed lock is unchanged (full lock up to ~27 mph)", () => {
    for (const mph of [0, 10, 20, 26]) {
      expect(lockDeg(mph)).toBeCloseTo(t.drive.maxSteerLock * DEG, 6);
    }
  });
});

describe("liveliness guards on the shipped car", () => {
  it("a deliberate power slide at 30-40 mph still develops a solid slip angle", () => {
    expect(peakSlip("power-slide-30")).toBeGreaterThan(18);
    expect(peakSlip("power-slide-40")).toBeGreaterThan(18);
  });

  it("lift-off-60 is still lively", () => {
    expect(peakSlip("lift-off-60")).toBeGreaterThan(8);
  });

  it("hold-slide-70 still develops and holds a big slide", () => {
    const run = runDossier(shippedTuning(), ["hold-slide-70"])[0];
    expect(summarise(run).peakSlipDeg).toBeGreaterThan(25);
    expect(run.rows.filter((r) => Math.abs(r.slipDeg) > 20).length / 60).toBeGreaterThan(0.3);
  });
});
