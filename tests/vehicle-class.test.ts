import { describe, expect, it } from "vitest";
import { AI_PAINTS } from "../src/core/race-start";
import {
  classDefaultTuning,
  frontDriveThrustN,
  KNOWN_VEHICLE_CLASS_IDS,
  resolveVehicleClassId,
  VEHICLE_CLASSES,
  wheelEngineForces,
} from "../src/core/vehicle-class";
import {
  clampTuning,
  defaultTuning,
  parseSavedTuning,
  serializeTuning,
  TUNING_STORAGE_KEY,
} from "../src/core/vehicle-tuning";

describe("resolveVehicleClassId", () => {
  it("defaults to rwd", () => {
    expect(resolveVehicleClassId("")).toBe("rwd");
    expect(resolveVehicleClassId("?map=grid-test")).toBe("rwd");
    expect(resolveVehicleClassId("?car=rwd")).toBe("rwd");
  });
  it("accepts fwd and awd", () => {
    expect(resolveVehicleClassId("?car=fwd")).toBe("fwd");
    expect(resolveVehicleClassId("?mode=circuit&car=awd")).toBe("awd");
  });
  it("falls back for unknown or hostile values", () => {
    for (const s of [
      "?car=FWD",
      "?car=",
      "?car=toString",
      "?car=__proto__",
      "?car=constructor",
      "?car=4wd",
    ]) {
      expect(resolveVehicleClassId(s)).toBe("rwd");
    }
  });
  it("lists exactly the known classes", () => {
    expect([...KNOWN_VEHICLE_CLASS_IDS]).toEqual(["rwd", "fwd", "awd"]);
  });
});

describe("wheelEngineForces", () => {
  it("rwd share puts all force on the rears with exact +0 fronts", () => {
    const f = wheelEngineForces(-30000, 0);
    expect(Object.is(f[0], 0)).toBe(true);
    expect(Object.is(f[1], 0)).toBe(true);
    expect(f[2]).toBe(-30000);
    expect(f[3]).toBe(-30000);
  });
  it("fwd share puts all force on the fronts with exact +0 rears", () => {
    const f = wheelEngineForces(-30000, 1);
    expect(f[0]).toBe(-30000);
    expect(f[1]).toBe(-30000);
    expect(Object.is(f[2], 0)).toBe(true);
    expect(Object.is(f[3], 0)).toBe(true);
  });
  it("splits by share and conserves total force", () => {
    const f = wheelEngineForces(1000, 0.4);
    expect(f[0]).toBeCloseTo(400, 9);
    expect(f[1]).toBeCloseTo(400, 9);
    expect(f[2]).toBeCloseTo(600, 9);
    expect(f[3]).toBeCloseTo(600, 9);
    for (const share of [0, 0.1, 0.4, 0.5, 0.9, 1]) {
      const g = wheelEngineForces(777, share);
      expect(Math.abs(g[0] + g[1] + g[2] + g[3] - 1554)).toBeLessThan(1e-9);
    }
  });
  it("zero in gives all zeros out", () => {
    for (const share of [0, 0.4, 1]) {
      for (const v of wheelEngineForces(0, share)) {
        expect(Object.is(v, 0)).toBe(true);
      }
    }
  });
});

describe("frontDriveThrustN", () => {
  it("returns forward thrust for the front share, scaled by front contacts", () => {
    expect(frontDriveThrustN(-4800, 1, 2)).toBe(9600);
    expect(frontDriveThrustN(-4800, 1, 1)).toBe(4800);
    expect(frontDriveThrustN(-4800, 1, 0)).toBe(0);
    expect(frontDriveThrustN(-4800, 0.4, 2)).toBeCloseTo(3840, 9);
  });

  it("reverse (positive engine force) is backwards thrust", () => {
    expect(frontDriveThrustN(2000, 1, 2)).toBe(-4000);
  });

  it("normalises zero results to +0", () => {
    expect(Object.is(frontDriveThrustN(0, 1, 2), 0)).toBe(true);
    expect(Object.is(frontDriveThrustN(-4800, 0, 2), 0)).toBe(true);
  });
});

describe("classDefaultTuning", () => {
  it("rwd equals defaultTuning()", () => {
    expect(classDefaultTuning("rwd")).toEqual(defaultTuning());
  });
  it("fwd and awd differ only in the overridden leaves", () => {
    const base = defaultTuning();
    const fwd = classDefaultTuning("fwd");
    expect(fwd.drive.powerOversteerGain).toBe(0.5);
    expect(fwd.wheels.rearSideFriction).toBe(0.3);
    expect(fwd.wheels.frontSideFriction).toBe(1.2);
    const fwdRest = structuredClone(fwd);
    fwdRest.drive.powerOversteerGain = base.drive.powerOversteerGain;
    fwdRest.wheels.rearSideFriction = base.wheels.rearSideFriction;
    fwdRest.wheels.frontSideFriction = base.wheels.frontSideFriction;
    expect(fwdRest).toEqual(base);

    const awd = classDefaultTuning("awd");
    expect(awd.wheels.frictionSlip).toBe(1.8);
    expect(awd.wheels.rearSideFriction).toBe(0.3);
    expect(awd.drive.powerOversteerGain).toBe(0.5);
    const awdRest = structuredClone(awd);
    awdRest.wheels.frictionSlip = base.wheels.frictionSlip;
    awdRest.wheels.rearSideFriction = base.wheels.rearSideFriction;
    awdRest.drive.powerOversteerGain = base.drive.powerOversteerGain;
    expect(awdRest).toEqual(base);
  });
  it("overrides are inside TUNING_RANGES", () => {
    for (const id of KNOWN_VEHICLE_CLASS_IDS) {
      const t = classDefaultTuning(id);
      expect(clampTuning(structuredClone(t))).toEqual(t);
    }
  });
  it("fwd keeps the handbrake rear friction", () => {
    expect(classDefaultTuning("fwd").drive.handbrakeRearSideFriction).toBe(
      defaultTuning().drive.handbrakeRearSideFriction,
    );
  });
  it("returns a fresh object each call", () => {
    const a = classDefaultTuning("fwd");
    a.wheels.frictionSlip = 2.5;
    expect(classDefaultTuning("fwd").wheels.frictionSlip).toBe(defaultTuning().wheels.frictionSlip);
  });
});

describe("VEHICLE_CLASSES", () => {
  it("storage keys are per class and rwd keeps the legacy key", () => {
    expect(VEHICLE_CLASSES.rwd.storageKey).toBe(TUNING_STORAGE_KEY);
    expect(VEHICLE_CLASSES.rwd.storageKey).toBe("heat-street.tuning.v1");
    expect(VEHICLE_CLASSES.fwd.storageKey).toBe("heat-street.tuning.fwd.v1");
    expect(VEHICLE_CLASSES.awd.storageKey).toBe("heat-street.tuning.awd.v1");
    const keys = new Set(KNOWN_VEHICLE_CLASS_IDS.map((id) => VEHICLE_CLASSES[id].storageKey));
    expect(keys.size).toBe(3);
  });
  it("colours are distinct and clear of the AI paints", () => {
    expect(VEHICLE_CLASSES.rwd.chassisColor).toBe(0xb5321f);
    const colours = KNOWN_VEHICLE_CLASS_IDS.map((id) => VEHICLE_CLASSES[id].chassisColor);
    expect(new Set(colours).size).toBe(3);
    const ai = (AI_PAINTS as readonly { hex?: number; color?: number }[]).map(
      (p) => p.hex ?? p.color,
    );
    for (const c of [VEHICLE_CLASSES.fwd.chassisColor, VEHICLE_CLASSES.awd.chassisColor]) {
      expect(ai).not.toContain(c);
    }
  });
  it("drive shares", () => {
    expect(VEHICLE_CLASSES.rwd.frontDriveShare).toBe(0);
    expect(VEHICLE_CLASSES.fwd.frontDriveShare).toBe(1);
    expect(VEHICLE_CLASSES.awd.frontDriveShare).toBe(0.4);
  });
});

describe("parseSavedTuning base", () => {
  it("fills missing leaves from the supplied base", () => {
    const fwdDefaults = classDefaultTuning("fwd");
    const full = JSON.parse(serializeTuning(fwdDefaults));
    delete full.drive.powerOversteerGain;
    const raw = JSON.stringify(full);
    const viaBase = parseSavedTuning(raw, () => classDefaultTuning("fwd"));
    expect(viaBase?.drive.powerOversteerGain).toBe(0.5);
    const viaDefault = parseSavedTuning(raw);
    expect(viaDefault?.drive.powerOversteerGain).toBe(defaultTuning().drive.powerOversteerGain);
  });
});
