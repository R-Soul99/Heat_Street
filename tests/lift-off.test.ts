import { describe, expect, it } from "vitest";
import { runDossier, summarise } from "../scripts/feel-dossier";
import { defaultTuning } from "../src/core/vehicle-tuning";

function peakSlip(id: string, gain: number): number {
  const tuning = defaultTuning();
  tuning.drive.liftOffOversteer = gain;
  const run = runDossier(tuning).find((r) => r.id === id);
  if (!run) throw new Error(`no dossier run ${id}`);
  return summarise(run).peakSlipDeg;
}

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
