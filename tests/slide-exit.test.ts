import { describe, expect, it } from "vitest";
import type { VehicleTuning } from "../src/core/vehicle-tuning";
import { defaultTuning } from "../src/core/vehicle-tuning";
import { makeSlideExitRoutine } from "../src/physics/telemetry/routines";
import { runRoutine } from "../src/physics/telemetry/run";

function slideExit(mutate?: (t: VehicleTuning) => void) {
  const tuning = defaultTuning();
  mutate?.(tuning);
  const run = makeSlideExitRoutine();
  runRoutine(run.routine, tuning);
  return { ...run.metrics(), trace: run.trace };
}

describe("slide-exit diagnostic routine", () => {
  it("is deterministic and re-runnable", () => {
    const a = slideExit();
    const b = slideExit();
    expect(b.speedDropMs).toBe(a.speedDropMs);
    expect(b.recoverSec).toBe(a.recoverSec);
    expect(a.trace.length).toBeGreaterThan(300);
    expect(a.trace.some((r) => r.term === "handbrake")).toBe(true);
  });

  it("catches the slide: counter-steering under full throttle does not spin the car", () => {
    const m = slideExit();
    expect(Number.isFinite(m.recoverSec)).toBe(true);
    expect(m.recoverSec).toBeLessThan(2);
    const maxSlip = Math.max(...m.trace.map((r) => r.slipDeg));
    expect(maxSlip).toBeLessThan(90);
  });

  it("regrip smoothing keeps more speed out of the slide than an instant regrip", () => {
    const instant = slideExit((t) => {
      t.drive.rearGripRecoverySec = 0;
      t.drive.slideSurge = 0;
      t.drive.liftOffOversteer = 0;
    });
    const smooth = slideExit((t) => {
      t.drive.rearGripRecoverySec = 0.15;
      t.drive.slideSurge = 0;
      t.drive.liftOffOversteer = 0;
    });
    expect(smooth.speedDropMs).toBeLessThan(instant.speedDropMs - 1);
  });

  it("slide surge adds speed while sliding", () => {
    const off = slideExit((t) => {
      t.drive.slideSurge = 0;
      t.drive.liftOffOversteer = 0;
    });
    const on = slideExit((t) => {
      t.drive.slideSurge = 0.6;
      t.drive.liftOffOversteer = 0;
    });
    expect(on.speedDropMs).toBeLessThan(off.speedDropMs);
  });
});
