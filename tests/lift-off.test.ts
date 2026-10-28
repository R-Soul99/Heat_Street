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
