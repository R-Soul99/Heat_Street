import { describe, expect, it } from "vitest";
import { shippedTuning } from "../src/core/feel";
import { defaultSurfaceProfiles } from "../src/core/surface-tuning";
import { VEHICLE_CLASSES, type VehicleClassId } from "../src/core/vehicle-class";
import { handbrakeRoutine, ROUTINES, TELEMETRY_TARGETS } from "../src/physics/telemetry/routines";
import { runRoutine } from "../src/physics/telemetry/run";
import {
  type MeasureOpts,
  measureFullLockTilt,
  measureRestContact,
  measureSettle,
  measureTopSpeed,
  measureZeroToSixty,
} from "../src/physics/telemetry/vehicle-measure";

/** Per new class measured targets (D-05). Later plans add one row each. */
interface ClassTargets {
  readonly zeroToSixtyS: number;
  readonly zeroToSixtyTol: number;
  readonly topSpeedMs: number;
  readonly topSpeedTol: number;
  readonly settleMaxS: number;
  readonly settleBandM: number;
  readonly restContact: number;
  readonly tiltSpeedMs: number;
  readonly maxTiltDeg: number;
}

export const CLASS_TARGETS: Partial<Record<VehicleClassId, ClassTargets>> = {
  rally: {
    zeroToSixtyS: 4.0,
    zeroToSixtyTol: 0.15,
    topSpeedMs: 46,
    topSpeedTol: 0.1,
    settleMaxS: 2,
    settleBandM: 0.01,
    restContact: 4,
    tiltSpeedMs: 15,
    maxTiltDeg: 15,
  },
  buggy: {
    zeroToSixtyS: 5.0,
    zeroToSixtyTol: 0.15,
    topSpeedMs: 38,
    topSpeedTol: 0.1,
    settleMaxS: 2,
    settleBandM: 0.01,
    restContact: 4,
    tiltSpeedMs: 15,
    maxTiltDeg: 15,
  },
  truck: {
    zeroToSixtyS: 8.0,
    zeroToSixtyTol: 0.15,
    topSpeedMs: 36,
    topSpeedTol: 0.1,
    settleMaxS: 2,
    settleBandM: 0.01,
    restContact: 4,
    tiltSpeedMs: 12,
    maxTiltDeg: 15,
  },
  monster: {
    zeroToSixtyS: 9.0,
    zeroToSixtyTol: 0.15,
    // User-accepted at 09-08: measured top about 35 m/s, NOT the 28 m/s of the
    // brief (the gear-limiter knee is sharp and mass dependent).
    topSpeedMs: 35.8,
    topSpeedTol: 0.1,
    settleMaxS: 2,
    settleBandM: 0.01,
    restContact: 4,
    tiltSpeedMs: 12,
    maxTiltDeg: 15,
  },
};

const ROLLOVER_CLASSES: readonly VehicleClassId[] = ["truck", "monster"];

function optsFor(id: VehicleClassId): MeasureOpts {
  return {
    frontDriveShare: VEHICLE_CLASSES[id].frontDriveShare,
    surfaceGripScale: VEHICLE_CLASSES[id].surfaceGripScale,
    spawnY: VEHICLE_CLASSES[id].spawnClearanceM,
  };
}

for (const [rawId, target] of Object.entries(CLASS_TARGETS) as [VehicleClassId, ClassTargets][]) {
  describe(`${rawId} measured targets`, () => {
    const tuning = shippedTuning(rawId);
    const opts = optsFor(rawId);

    it("0-60 mph, top speed, settle, rest contact, tilt", () => {
      const zeroToSixty = measureZeroToSixty(tuning, opts);
      const top = measureTopSpeed(tuning, opts);
      const settle = measureSettle(tuning, opts);
      const contact = measureRestContact(tuning, opts);
      const tilt = measureFullLockTilt(tuning, target.tiltSpeedMs, opts);
      console.info(
        `[targets] ${rawId}: 0-60 ${zeroToSixty.toFixed(2)} s, top ${top.toFixed(1)} m/s, settle ${settle.settleSec.toFixed(2)} s band ${settle.bandM.toFixed(4)} m, contact ${contact}, tilt ${tilt.maxTiltDeg.toFixed(1)} deg`,
      );
      expect(Math.abs(zeroToSixty - target.zeroToSixtyS)).toBeLessThanOrEqual(
        target.zeroToSixtyS * target.zeroToSixtyTol,
      );
      expect(Math.abs(top - target.topSpeedMs)).toBeLessThanOrEqual(
        target.topSpeedMs * target.topSpeedTol,
      );
      expect(settle.settleSec).toBeLessThan(target.settleMaxS);
      expect(settle.bandM).toBeLessThanOrEqual(target.settleBandM);
      expect(contact).toBe(target.restContact);
      expect(tilt.maxTiltDeg).toBeLessThan(target.maxTiltDeg);
    });

    if (ROLLOVER_CLASSES.includes(rawId)) {
      it("rolls when pushed: inside wheels lift at 20 m/s full lock, not at 12 m/s", () => {
        const hard = measureFullLockTilt(tuning, 20, opts);
        const gentle = measureFullLockTilt(tuning, 12, opts);
        console.info(
          `[targets] ${rawId}: tilt 20 m/s ${hard.maxTiltDeg.toFixed(1)} deg lifted ${hard.insideWheelsLifted}; 12 m/s ${gentle.maxTiltDeg.toFixed(1)} deg lifted ${gentle.insideWheelsLifted}`,
        );
        expect(hard.insideWheelsLifted).toBe(true);
        expect(gentle.insideWheelsLifted).toBe(false);
      });
    }

    if (rawId === "buggy") {
      it("lands the ramp routine upright", () => {
        const ramp = ROUTINES.find((x) => x.id === "ramp");
        if (ramp === undefined) throw new Error("ramp routine missing");
        // routine value = tilt 0.5 s after landing (Infinity when it never lands).
        const r = runRoutine(ramp, tuning, undefined, undefined, opts);
        console.info(`[targets] ${rawId}: ramp landing tilt ${r.value.toFixed(1)} deg`);
        expect(r.value).toBeLessThan(30);
      });
    }

    if (rawId === "rally") {
      it("handbrake on gravel slides at least the muscle-car minimum", () => {
        // routine value = max slip angle (deg) during the handbrake hold.
        const profiles = defaultSurfaceProfiles();
        const r = runRoutine(
          handbrakeRoutine,
          tuning,
          { surface: "gravel", profiles },
          undefined,
          opts,
        );
        console.info(`[targets] ${rawId}: handbrake gravel max slip ${r.value.toFixed(1)} deg`);
        expect(r.value).toBeGreaterThan(TELEMETRY_TARGETS.handbrake.minMaxSlipDeg);
      });
    }

    if (rawId === "rally" || rawId === "buggy") {
      it("hands-off-style full-lock stability stays inside the muscle-car band", () => {
        const stability = ROUTINES.find((x) => x.id === "stability");
        if (stability === undefined) throw new Error("stability routine missing");
        const r = runRoutine(stability, tuning, undefined, undefined, opts);
        console.info(`[targets] ${rawId}: stability tilt ${r.value.toFixed(1)} deg`);
        expect(r.value).toBeLessThan(TELEMETRY_TARGETS.stability.maxTiltDeg);
      });
    }
  });
}
