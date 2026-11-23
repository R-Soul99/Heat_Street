import { describe, expect, it } from "vitest";
import { shippedTuning } from "../src/core/feel";
import { AI_PAINTS } from "../src/core/race-start";
import { SURFACE_TYPES } from "../src/core/surface-types";
import {
  classDefaultTuning,
  classTuningRanges,
  frontDriveThrustN,
  KNOWN_VEHICLE_CLASS_IDS,
  resolveVehicleClassId,
  searchForVehicle,
  UNIT_SURFACE_GRIP_SCALE,
  VEHICLE_CLASSES,
  wheelEngineForces,
  widenRanges,
} from "../src/core/vehicle-class";
import {
  clampTuning,
  defaultTuning,
  parseSavedTuning,
  serializeTuning,
  TUNING_RANGES,
  TUNING_STORAGE_KEY,
} from "../src/core/vehicle-tuning";
import { SPAWN_CLEARANCE_M } from "../src/physics/map-scene";

describe("resolveVehicleClassId", () => {
  it("defaults to rwd", () => {
    expect(resolveVehicleClassId("")).toBe("rwd");
    expect(resolveVehicleClassId("?map=grid-test")).toBe("rwd");
    expect(resolveVehicleClassId("?car=rwd")).toBe("rwd");
  });
  it("accepts rally and rejects hostile variants", () => {
    expect(resolveVehicleClassId("?car=rally")).toBe("rally");
    for (const s of ["?car=RALLY", "?car=rally%00", "?car=__proto__", "?car=constructor"]) {
      expect(resolveVehicleClassId(s)).toBe("rwd");
    }
  });
  it("accepts buggy", () => {
    expect(resolveVehicleClassId("?car=buggy")).toBe("buggy");
  });
  it("accepts truck and monster, rejects hostile variants", () => {
    expect(resolveVehicleClassId("?car=truck")).toBe("truck");
    expect(resolveVehicleClassId("?car=monster")).toBe("monster");
    for (const x of ["?car=TRUCK", "?car=monster%00", "?car=trucks", "?car=__proto__"]) {
      expect(resolveVehicleClassId(x)).toBe("rwd");
    }
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
    expect([...KNOWN_VEHICLE_CLASS_IDS]).toEqual([
      "rwd",
      "fwd",
      "awd",
      "rally",
      "buggy",
      "truck",
      "monster",
    ]);
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
    expect(awd.wheels.frictionSlip).toBe(2.0);
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
      expect(clampTuning(structuredClone(t), classTuningRanges(id))).toEqual(t);
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
    expect(keys.size).toBe(KNOWN_VEHICLE_CLASS_IDS.length);
    expect(VEHICLE_CLASSES.rally.storageKey).toBe("heat-street.tuning.rally.v1");
  });
  it("colours are distinct and clear of the AI paints", () => {
    expect(VEHICLE_CLASSES.rwd.chassisColor).toBe(0xb5321f);
    const colours = KNOWN_VEHICLE_CLASS_IDS.map((id) => VEHICLE_CLASSES[id].chassisColor);
    expect(new Set(colours).size).toBe(KNOWN_VEHICLE_CLASS_IDS.length);
    const ai = (AI_PAINTS as readonly { hex?: number; color?: number }[]).map(
      (p) => p.hex ?? p.color,
    );
    for (const c of colours.filter((x) => x !== VEHICLE_CLASSES.rwd.chassisColor)) {
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

describe("classTuningRanges", () => {
  it("returns the TUNING_RANGES object itself for rwd, fwd, awd and rally (D-02)", () => {
    for (const id of ["rwd", "fwd", "awd", "rally"] as const) {
      expect(classTuningRanges(id)).toBe(TUNING_RANGES);
    }
  });
  it("buggy gets a widened frozen copy and TUNING_RANGES is not mutated", () => {
    const a = classTuningRanges("buggy");
    const b = classTuningRanges("buggy");
    expect(a).not.toBe(TUNING_RANGES);
    expect(a).toBe(b);
    expect(Object.isFrozen(a)).toBe(true);
    expect(a.chassis.mass.min).toBe(500);
    expect(a.wheels.maxSuspensionTravel.max).toBeGreaterThanOrEqual(0.7);
    expect(TUNING_RANGES.chassis.mass.min).toBe(800);
    expect(TUNING_RANGES.wheels.maxSuspensionTravel.max).toBe(0.6);
    const widened = widenRanges(TUNING_RANGES, () => {});
    expect(widened).toEqual(TUNING_RANGES);
    expect(widened).not.toBe(TUNING_RANGES);
  });
});

describe("rally class", () => {
  it("savesMedals is true for rwd/fwd/awd and false for rally (D-08)", () => {
    expect(VEHICLE_CLASSES.rwd.savesMedals).toBe(true);
    expect(VEHICLE_CLASSES.fwd.savesMedals).toBe(true);
    expect(VEHICLE_CLASSES.awd.savesMedals).toBe(true);
    expect(VEHICLE_CLASSES.rally.savesMedals).toBe(false);
  });
  it("tuning is inside TUNING_RANGES and survives a clamp", () => {
    expect(classTuningRanges("rally")).toBe(TUNING_RANGES);
    const t = classDefaultTuning("rally");
    expect(clampTuning(structuredClone(t), classTuningRanges("rally"))).toEqual(t);
    const s = shippedTuning("rally");
    expect(clampTuning(structuredClone(s), classTuningRanges("rally"))).toEqual(s);
  });
  it("grips more off-road and slightly less on tarmac (D-06)", () => {
    const g = VEHICLE_CLASSES.rally.surfaceGripScale;
    expect(g.gravel.lateral).toBeGreaterThan(1);
    expect(g.tarmac.lateral).toBeLessThan(1);
    expect(VEHICLE_CLASSES.rally.frontDriveShare).toBe(0.45);
  });
});

describe("buggy class", () => {
  it("is a light RWD class without medals and clamps clean with its own ranges (D-05, D-08)", () => {
    const v = VEHICLE_CLASSES.buggy;
    expect(v.frontDriveShare).toBe(0);
    expect(v.savesMedals).toBe(false);
    expect(v.storageKey).toBe("heat-street.tuning.buggy.v1");
    const t = classDefaultTuning("buggy");
    expect(t.chassis.mass).toBe(750);
    const r = classTuningRanges("buggy");
    expect(clampTuning(structuredClone(t), r)).toEqual(t);
    const s = shippedTuning("buggy");
    expect(clampTuning(structuredClone(s), r)).toEqual(s);
  });
  it("grips better off-road and worse on tarmac (D-06)", () => {
    const g = VEHICLE_CLASSES.buggy.surfaceGripScale;
    for (const k of ["sand", "grass", "mud"] as const) expect(g[k].lateral).toBeGreaterThan(1);
    expect(g.tarmac.lateral).toBeLessThan(1);
  });
});

describe("searchForVehicle", () => {
  it("sets car and keeps other params", () => {
    const p = new URLSearchParams(searchForVehicle("?map=feel-test&debug", "rally"));
    expect(p.get("car")).toBe("rally");
    expect(p.get("map")).toBe("feel-test");
    expect(p.has("debug")).toBe(true);
  });
  it("replaces an existing car", () => {
    const p = new URLSearchParams(searchForVehicle("?car=rally", "rwd"));
    expect(p.getAll("car")).toEqual(["rwd"]);
  });
});

describe("surfaceGripScale", () => {
  it("rwd/fwd/awd use the frozen all-ones table", () => {
    for (const id of ["rwd", "fwd", "awd"] as const) {
      expect(VEHICLE_CLASSES[id].surfaceGripScale).toBe(UNIT_SURFACE_GRIP_SCALE);
    }
    expect(Object.isFrozen(UNIT_SURFACE_GRIP_SCALE)).toBe(true);
    for (const s of SURFACE_TYPES) {
      expect(UNIT_SURFACE_GRIP_SCALE[s]).toEqual({ forward: 1, lateral: 1 });
      expect(Object.isFrozen(UNIT_SURFACE_GRIP_SCALE[s])).toBe(true);
    }
  });
});

describe("truck and monster classes", () => {
  it("are AWD 0.5 with their own keys, no medals (D-05, D-08)", () => {
    for (const [id, key] of [
      ["truck", "heat-street.tuning.truck.v1"],
      ["monster", "heat-street.tuning.monster.v1"],
    ] as const) {
      const v = VEHICLE_CLASSES[id];
      expect(v.frontDriveShare).toBe(0.5);
      expect(v.storageKey).toBe(key);
      expect(v.savesMedals).toBe(false);
    }
  });
  it("have distinct frozen ranges and TUNING_RANGES is untouched (D-02)", () => {
    const t = classTuningRanges("truck");
    const m = classTuningRanges("monster");
    expect(t).not.toBe(m);
    expect(t).not.toBe(TUNING_RANGES);
    expect(Object.isFrozen(t)).toBe(true);
    expect(Object.isFrozen(m)).toBe(true);
    expect(m.chassis.mass.max).toBe(6000);
    expect(t.chassis.mass.max).toBe(3200);
    expect(TUNING_RANGES.chassis.mass.min).toBe(800);
  });
  it("every class default and shipped tuning is inside its own ranges", () => {
    for (const id of KNOWN_VEHICLE_CLASS_IDS) {
      const r = classTuningRanges(id);
      const d = classDefaultTuning(id);
      expect(clampTuning(structuredClone(d), r)).toEqual(d);
      const s = shippedTuning(id);
      expect(clampTuning(structuredClone(s), r)).toEqual(s);
    }
  });
  it("spawn clearance is per class for tall vehicles only", () => {
    for (const id of ["rwd", "fwd", "awd"] as const) {
      expect(VEHICLE_CLASSES[id].spawnClearanceM).toBeUndefined();
    }
    expect(VEHICLE_CLASSES.truck.spawnClearanceM).toBeCloseTo(1.3, 9);
    expect(VEHICLE_CLASSES.monster.spawnClearanceM).toBeCloseTo(2.1, 9);
    expect(VEHICLE_CLASSES.buggy.spawnClearanceM).toBeCloseTo(1.35, 9);
    for (const id of ["buggy", "truck", "monster"] as const) {
      const w = classDefaultTuning(id).wheels;
      const expected = w.radius + w.suspensionRestLength - w.connectionY + 0.1;
      expect(VEHICLE_CLASSES[id].spawnClearanceM).toBeCloseTo(expected, 9);
    }
  });
  it("no class spawns on its bump stop at the in-game spawn height", () => {
    for (const id of KNOWN_VEHICLE_CLASS_IDS) {
      const w = classDefaultTuning(id).wheels;
      const clearance = VEHICLE_CLASSES[id].spawnClearanceM ?? SPAWN_CLEARANCE_M;
      // Wheel-bottom depth below the chassis origin minus the spawn height.
      const compression = w.radius + w.suspensionRestLength - w.connectionY - clearance;
      expect(compression, id).toBeLessThan(w.maxSuspensionTravel);
    }
  });
});
