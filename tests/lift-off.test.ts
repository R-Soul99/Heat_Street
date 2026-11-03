import { describe, expect, it } from "vitest";
import { runDossier, summarise } from "../scripts/feel-dossier";
import { shippedTuning } from "../src/core/feel";
import { defaultTuning, type VehicleTuning } from "../src/core/vehicle-tuning";

/** A spin is above about 45 deg slip; a lift on a straight / gentle bend must stay well under. */
const NO_SPIN_SLIP_DEG = 20;
/** Heading gained past the lift point. The old curve spun 117 to 200 deg here; slip alone hides it. */
const NO_SPIN_HEADING_DEG = 25;
const HEAVY_TIMEOUT_MS = 60_000;

function summary(tuning: VehicleTuning, id: string) {
  const run = runDossier(tuning, [id]).find((r) => r.id === id);
  if (!run) throw new Error(`no dossier run ${id}`);
  return summarise(run);
}

function peakSlip(id: string, gain: number): number {
  const tuning = defaultTuning();
  tuning.drive.liftOffOversteer = gain;
  return summary(tuning, id).peakSlipDeg;
}

describe("lift-off no-spin on the shipped car (04.3 D-03)", () => {
  for (const id of ["lift-straight-60", "lift-gentle-60", "lift-straight-90"]) {
    it(
      `${id} does not spin`,
      () => {
        const s = summary(shippedTuning(), id);
        expect(s.peakSlipDeg).toBeLessThan(NO_SPIN_SLIP_DEG);
        expect(s.headingOvershootDeg).toBeLessThan(NO_SPIN_HEADING_DEG);
      },
      HEAVY_TIMEOUT_MS,
    );
  }

  it(
    "lift-off-60 still steps the tail out clearly (D-01 lively)",
    () => {
      expect(summary(shippedTuning(), "lift-off-60").peakSlipDeg).toBeGreaterThan(8);
    },
    HEAVY_TIMEOUT_MS,
  );
});

describe("lift-off oversteer", () => {
  it("lifting mid-corner at speed lets the tail step out; holding the throttle does not", () => {
    expect(peakSlip("lift-off-60", 5)).toBeGreaterThan(8);
    expect(peakSlip("hold-60", 5)).toBeLessThan(4);
  });

  it("gain 0 turns it off", () => {
    expect(peakSlip("lift-off-60", 0)).toBeLessThan(4);
  });

  it("does not spin the car at the default gain", () => {
    expect(peakSlip("lift-off-60", defaultTuning().drive.liftOffOversteer)).toBeLessThan(40);
  });
});

describe("tyre grip falloff", () => {
  function slideTime(gain: number): { secs: number; peak: number } {
    const tuning = defaultTuning();
    tuning.drive.tyreFalloff = gain;
    const run = runDossier(tuning).find((r) => r.id === "hold-slide-70");
    if (!run) throw new Error("no dossier run hold-slide-70");
    return {
      secs: run.rows.filter((r) => Math.abs(r.slipDeg) > 20).length / 60,
      peak: summarise(run).peakSlipDeg,
    };
  }

  it("lets a big slide be held longer than a flat grip maximum does", () => {
    expect(slideTime(0.3).secs).toBeGreaterThan(slideTime(0).secs + 0.2);
  });

  it("does not spin the car at the default gain", () => {
    expect(slideTime(defaultTuning().drive.tyreFalloff).peak).toBeLessThan(60);
  });
});
