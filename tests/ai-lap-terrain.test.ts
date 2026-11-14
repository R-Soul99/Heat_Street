import { describe, expect, it } from "vitest";
import { MEDAL_BANDS } from "../src/core/medal-timing";
import { silverLapTargetSec } from "../src/core/racing-line";
import { DT } from "../src/core/sim-clock";
import { loadTerrainJuliette, runTerrainRace } from "./fixtures/terrain-race-harness";

/**
 * 07-07 pace rework: the shipped AI pace (AI_PACE_CALIBRATION) is calibrated
 * HERE, on the CURRENT terrain Juliette and the current medal reference —
 * the map and reference `?mode=circuit-race` actually runs on. A full
 * 3-AI, 3-lap Circuit Race from a standing start at GO, headless at 60 Hz.
 *
 * Pace target (D-09): the field finishes AT or just slower than the Silver
 * total, so a clean Silver-pace drive just beats it and a messy one loses.
 * Fixed pace, no catch-up: nothing here (or in the driver) reads race order.
 */
describe("ai-lap-terrain: 3 AI race 3 laps of terrain Juliette at just-under-Silver pace (D-09, CIRC-02)", () => {
  it("every AI finishes 3 clean laps between the Silver total and 4% slower", async () => {
    const ctx = await loadTerrainJuliette();
    const silverTotalSec = ctx.reference.totalTimeSec * MEDAL_BANDS.silver;
    const silverLapSec = silverLapTargetSec(ctx.reference);
    const { racers } = runTerrainRace(ctx, {
      cars: 3,
      laps: 3,
      maxSec: silverTotalSec * 1.3,
    });

    for (const [i, racer] of racers.entries()) {
      const lapTimes = racer.lapDoneSec.map(
        (t, lap) => t - (lap === 0 ? 0 : racer.lapDoneSec[lap - 1]),
      );
      // eslint-disable-next-line no-console
      console.info(
        `ai-lap-terrain car ${i}: laps ${lapTimes.map((t) => t.toFixed(2)).join(" / ")}, total ${racer.lapDoneSec.at(-1)?.toFixed(2)}s (Silver ${silverTotalSec.toFixed(2)}s, ${silverLapSec.toFixed(2)}s/lap; Gold ${ctx.reference.totalTimeSec.toFixed(2)}s), tilt ${racer.maxTiltDeg.toFixed(1)}, outside road ${racer.maxOutsideRoadM.toFixed(2)}m`,
      );
      expect(racer.lapDoneSec).toHaveLength(3);
      const totalSec = racer.lapDoneSec[2];
      expect(totalSec).toBeGreaterThanOrEqual(silverTotalSec);
      expect(totalSec).toBeLessThanOrEqual(silverTotalSec * 1.04);
      // Lap 1 (standing start) at or just slower than a Silver lap.
      expect(lapTimes[0] / silverLapSec).toBeGreaterThanOrEqual(1);
      expect(lapTimes[0] / silverLapSec).toBeLessThanOrEqual(1.06);
      // Clean: upright, on the road, never stuck, tidy grip inputs, no weave.
      expect(racer.maxTiltDeg).toBeLessThan(30);
      expect(racer.maxOutsideRoadM).toBeLessThan(2);
      expect(racer.maxLowSpeedRunTicks * DT).toBeLessThan(1);
      expect(racer.sawHandbrake).toBe(false);
      expect(racer.sawThrottleAndBrake).toBe(false);
      expect(racer.straightSteerSum / racer.straightSteerCount).toBeLessThan(0.05);
      expect(racer.straightSteerDeltaSum / racer.straightSteerCount).toBeLessThan(0.002);
    }
  }, 300_000);
});
