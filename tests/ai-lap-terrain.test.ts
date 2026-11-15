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
 * Pace target (user decision, 07-07 re-test 2): as fast as the car can go
 * while driving clean laps, beating Gold. Fixed pace, no catch-up, no speed
 * edge: nothing here (or in the driver) reads race order or the player.
 */
describe("ai-lap-terrain: 3 AI race 3 clean laps of terrain Juliette faster than Gold (D-09, CIRC-02)", () => {
  it("every AI finishes 3 clean laps faster than the Gold total", async () => {
    const ctx = await loadTerrainJuliette();
    const goldTotalSec = ctx.reference.totalTimeSec * MEDAL_BANDS.gold;
    const silverLapSec = silverLapTargetSec(ctx.reference);
    const { racers } = runTerrainRace(ctx, {
      cars: 3,
      laps: 3,
      maxSec: goldTotalSec * 1.3,
    });

    for (const [i, racer] of racers.entries()) {
      const lapTimes = racer.lapDoneSec.map(
        (t, lap) => t - (lap === 0 ? 0 : racer.lapDoneSec[lap - 1]),
      );
      // eslint-disable-next-line no-console
      console.info(
        `ai-lap-terrain car ${i}: laps ${lapTimes.map((t) => t.toFixed(2)).join(" / ")}, total ${racer.lapDoneSec.at(-1)?.toFixed(2)}s (Gold ${goldTotalSec.toFixed(2)}s; Silver lap ${silverLapSec.toFixed(2)}s), tilt ${racer.maxTiltDeg.toFixed(1)}, outside road ${racer.maxOutsideRoadM.toFixed(2)}m`,
      );
      expect(racer.lapDoneSec).toHaveLength(3);
      const totalSec = racer.lapDoneSec[2];
      // Faster than Gold, but not absurdly so (a broken lap counter or a
      // shortcut would show up as an implausibly short time).
      expect(totalSec).toBeLessThan(goldTotalSec);
      expect(totalSec).toBeGreaterThan(goldTotalSec * 0.8);
      // Clean: upright, on the road, never stuck, tidy grip inputs, no weave.
      expect(racer.maxTiltDeg).toBeLessThan(30);
      expect(racer.maxOutsideRoadM).toBeLessThan(2);
      expect(racer.maxLowSpeedRunTicks * DT).toBeLessThan(1);
      expect(racer.sawHandbrake).toBe(false);
      expect(racer.sawThrottleAndBrake).toBe(false);
      expect(racer.straightSteerSum / racer.straightSteerCount).toBeLessThan(0.06);
      expect(racer.straightSteerDeltaSum / racer.straightSteerCount).toBeLessThan(0.004);
    }
  }, 300_000);
});
