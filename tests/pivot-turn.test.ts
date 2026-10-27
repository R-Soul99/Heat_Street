import { describe, expect, it } from "vitest";
import type { InputFrame } from "../src/core/input-tape";
import { defaultTuning, type VehicleTuning } from "../src/core/vehicle-tuning";
import { makePivotTurnRoutine } from "../src/physics/telemetry/routines";
import { buildTelemetryScene, runRoutine } from "../src/physics/telemetry/run";
import { createVehicle, RL } from "../src/physics/vehicle";
import { createWorld } from "../src/physics/world";

type Script = (k: number) => InputFrame;

/** Every tick's full rigid-body state as a flat number array, for exact comparison. */
function trace(tuning: VehicleTuning, script: Script, ticks: number, initialSpeed = 0): number[] {
  const world = createWorld();
  buildTelemetryScene(world);
  const vehicle = createVehicle(world, tuning, { x: 0, y: 1, z: 0 });
  // Let it sit on its suspension first (neutral input), then optionally launch it.
  for (let k = 0; k < 40; k++) {
    vehicle.tick({ steer: 0, throttle: 0, brake: 0, handbrake: false }, tuning);
    world.step();
  }
  if (initialSpeed > 0) vehicle.body.setLinvel({ x: 0, y: 0, z: -initialSpeed }, true);
  const out: number[] = [];
  for (let k = 0; k < ticks; k++) {
    vehicle.tick(script(k), tuning);
    world.step();
    const p = vehicle.body.translation();
    const r = vehicle.body.rotation();
    const l = vehicle.body.linvel();
    const a = vehicle.body.angvel();
    out.push(p.x, p.y, p.z, r.x, r.y, r.z, r.w, l.x, l.y, l.z, a.x, a.y, a.z);
  }
  world.free();
  return out;
}

const full = (): InputFrame => ({ steer: 1, throttle: 1, brake: 0, handbrake: false });
const fullHandbrake = (k: number): InputFrame => ({
  steer: -1,
  throttle: 0.3,
  brake: 0,
  handbrake: k > 20,
});
const halfSteer = (k: number): InputFrame => ({
  steer: 0.79,
  throttle: 1,
  brake: 0,
  handbrake: k > 30,
});

function withPivot(pivotTurn: number, mutate?: (t: VehicleTuning) => void): VehicleTuning {
  const t = defaultTuning();
  t.drive.pivotTurn = pivotTurn;
  // These tests isolate the pivot: the slide-exit features (regrip smoothing,
  // slide surge) are on by default and blur the one-tick and speed-fade reads.
  t.drive.rearGripRecoverySec = 0;
  t.drive.slideSurge = 0;
  mutate?.(t);
  return t;
}

describe("pivot turn: off is inert", () => {
  it("pivotTurn 0 ignores the other pivot fields completely (bit-for-bit)", () => {
    const a = trace(withPivot(0), full, 240);
    const b = trace(
      withPivot(0, (t) => {
        t.drive.pivotYawRate = 8;
        t.drive.pivotFrontSpeedCap = 0.5;
        t.drive.pivotEngageSec = 0.6;
      }),
      full,
      240,
    );
    expect(b).toEqual(a);
  });

  it("with pivotTurn 1, any input at or above 8 m/s is bit-for-bit identical to off", () => {
    for (const [script, ticks] of [
      [full, 120],
      [fullHandbrake, 40],
    ] as const) {
      const off = trace(withPivot(0), script, ticks, 25);
      const on = trace(withPivot(1), script, ticks, 25);
      // The claim only holds while the car really is at or above 8 m/s.
      for (let i = 0; i < off.length; i += 13) {
        expect(Math.hypot(off[i + 7], off[i + 9])).toBeGreaterThanOrEqual(8);
      }
      expect(on).toEqual(off);
    }
  });

  it("with pivotTurn 1, any input with |steer| < 0.8 is bit-for-bit identical to off", () => {
    const off = trace(withPivot(0), halfSteer, 240);
    const on = trace(withPivot(1), halfSteer, 240);
    expect(on).toEqual(off);
  });

  it("with pivotTurn 1, no steer at all (straight line, handbrake and throttle) is bit-for-bit identical", () => {
    const straight = (k: number): InputFrame => ({
      steer: 0,
      throttle: 1,
      brake: 0,
      handbrake: k > 60 && k < 120,
    });
    expect(trace(withPivot(1), straight, 240)).toEqual(trace(withPivot(0), straight, 240));
  });
});

describe("pivot turn: engaged", () => {
  it("full steer + throttle from rest rotates the car much further than with it off", () => {
    const yawOf = (pt: number) => {
      const tr = trace(withPivot(pt), full, 90);
      return Math.abs(tr[tr.length - 2]); // angvel.y of the last tick
    };
    expect(yawOf(1)).toBeGreaterThan(yawOf(0) * 1.8);
  });

  it("holds the front axle slow, and releases cleanly with the yaw rate damped", () => {
    const { routine, metrics } = makePivotTurnRoutine();
    runRoutine(routine, withPivot(1));
    const m = metrics();
    const unassisted = makePivotTurnRoutine();
    runRoutine(unassisted.routine, withPivot(0));
    const frontAt = (series: readonly { t: number; frontAxleSpeedMs: number }[], sec: number) =>
      series.reduce((b, s) => (Math.abs(s.t - sec) < Math.abs(b.t - sec) ? s : b)).frontAxleSpeedMs;
    // By the end of the hold the nose is pinned well below where the
    // unassisted car has it (6.9 m/s), and stays under 5 throughout.
    for (const s of m.series.filter((x) => x.t >= 0.75 && x.t <= 1.0)) {
      expect(s.frontAxleSpeedMs).toBeLessThan(5);
    }
    expect(frontAt(m.series, 1.0)).toBeLessThan(frontAt(unassisted.metrics().series, 1.0) * 0.6);
    // The turn carries on a little after the steer lets go, then stops.
    expect(m.overshootDeg).toBeLessThan(40);
    const last = m.series[m.series.length - 1];
    expect(Math.abs(last.yawRate)).toBeLessThan(0.1);
    expect(m.headingAtReleaseDeg).toBeGreaterThan(60);
  });

  it("the routine is deterministic and re-runnable", () => {
    const once = () => {
      const { routine, metrics } = makePivotTurnRoutine();
      runRoutine(routine, withPivot(0.7));
      return metrics();
    };
    expect(once()).toEqual(once());
  });
});

describe("powerOversteerRearSideFriction", () => {
  it("the throttle blend heads to its own value (0.024) and the handbrake keeps 0.005", () => {
    const tuning = defaultTuning();
    // One-tick reading: needs instant regrip (the slide-exit smoothing is on by default).
    tuning.drive.rearGripRecoverySec = 0;
    expect(tuning.drive.powerOversteerRearSideFriction).toBe(0.024);
    expect(tuning.drive.handbrakeRearSideFriction).toBe(0.005);

    const rearAt = (frame: InputFrame): number => {
      const world = createWorld();
      buildTelemetryScene(world);
      const vehicle = createVehicle(world, tuning, { x: 0, y: 1, z: 0 });
      for (let k = 0; k < 40; k++) {
        vehicle.tick({ steer: 0, throttle: 0, brake: 0, handbrake: false }, tuning);
        world.step();
      }
      vehicle.body.setLinvel({ x: 0, y: 0, z: -15 }, true);
      vehicle.tick(frame, tuning);
      const sfs = vehicle.controller.wheelSideFrictionStiffness(RL) ?? Number.NaN;
      world.free();
      return sfs;
    };
    // Full throttle + steer at 15 m/s: blend saturates at 1 -> the power-slide value.
    expect(rearAt({ steer: 1, throttle: 1, brake: 0, handbrake: false })).toBeCloseTo(0.024, 6);
    expect(rearAt({ steer: 0, throttle: 0, brake: 0, handbrake: true })).toBeCloseTo(0.005, 6);
  });
});

/** Index (in ticks) of the first tick where two traces differ, or -1 if identical. */
function firstDivergence(a: number[], b: number[]): number {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return Math.floor(i / 13);
  return -1;
}

describe("pivot turn: the handbrake is not part of it", () => {
  const hbSteer =
    (throttle: number): Script =>
    (k) => ({
      steer: k % 2 === 0 ? 1 : -1,
      throttle,
      brake: 0,
      handbrake: true,
    });

  it("the handbrake with full steer never triggers it (throttle below the gate)", () => {
    for (const throttle of [0, 0.5, 0.8]) {
      const off = trace(withPivot(0), hbSteer(throttle), 240);
      const on = trace(withPivot(1), hbSteer(throttle), 240);
      expect(on).toEqual(off);
    }
  });

  it("the handbrake with a steady full steer and no throttle never triggers it", () => {
    const hb: Script = () => ({ steer: 1, throttle: 0, brake: 0, handbrake: true });
    expect(trace(withPivot(1), hb, 240)).toEqual(trace(withPivot(0), hb, 240));
  });

  it("the handbrake neither starts the pivot early nor shifts its dwell", () => {
    // Same steer + throttle either way; only the handbrake differs, pressed
    // early and released before the 0.3 s (18 tick) dwell ends. The old
    // handbrake path would open the gate at once (first difference at tick
    // ~2-12); a dwell reset or delay would push it past the plain run's tick.
    const plain: Script = () => ({ steer: 1, throttle: 1, brake: 0, handbrake: false });
    const earlyHandbrake: Script = (k) => ({
      steer: 1,
      throttle: 1,
      brake: 0,
      handbrake: k >= 2 && k < 12,
    });
    const startPlain = firstDivergence(
      trace(withPivot(0), plain, 90),
      trace(withPivot(1), plain, 90),
    );
    const startHandbrake = firstDivergence(
      trace(withPivot(0), earlyHandbrake, 90),
      trace(withPivot(1), earlyHandbrake, 90),
    );
    // The gate now builds up over 0.3 s (18 ticks) rather than switching on
    // after it; the handbrake must not change when the first difference shows.
    expect(startPlain).toBeLessThanOrEqual(19);
    expect(startHandbrake).toBe(startPlain);
  });

  it("a handbrake held through the dwell cannot make the pivot start earlier", () => {
    const plain: Script = () => ({ steer: 1, throttle: 1, brake: 0, handbrake: false });
    const heldHandbrake: Script = (k) => ({ steer: 1, throttle: 1, brake: 0, handbrake: k >= 2 });
    const startPlain = firstDivergence(
      trace(withPivot(0), plain, 90),
      trace(withPivot(1), plain, 90),
    );
    const startHeld = firstDivergence(
      trace(withPivot(0), heldHandbrake, 90),
      trace(withPivot(1), heldHandbrake, 90),
    );
    expect(startHeld).toBeGreaterThanOrEqual(startPlain);
  });

  it("no handbrake reference remains in the pivot gate code", async () => {
    const src = (await import("../src/physics/vehicle.ts?raw")).default as string;
    const gate = src.slice(
      src.indexOf("// Pivot-turn gate and filters"),
      src.indexOf("const rearSfsTarget = frame.handbrake"),
    );
    expect(gate.length).toBeGreaterThan(200);
    // The comment names the handbrake to say it is excluded; no code may read it.
    expect(gate.replace(/\/\/.*$/gm, "")).not.toMatch(/handbrake/);
  });
});

describe("pivot turn: speed gate (full below 5 m/s, zero at 12 m/s)", () => {
  /** Max |yaw-rate difference| between pivot on and off with forward speed held constant. */
  function pivotEffect(speed: number): number {
    const run = (pivot: number): number[] => {
      const tuning = withPivot(pivot);
      const world = createWorld();
      buildTelemetryScene(world);
      const vehicle = createVehicle(world, tuning, { x: 0, y: 1, z: 0 });
      for (let k = 0; k < 40; k++) {
        vehicle.tick({ steer: 0, throttle: 0, brake: 0, handbrake: false }, tuning);
        world.step();
      }
      const yaw: number[] = [];
      for (let k = 0; k < 90; k++) {
        // Hold the speed so the gate sees exactly `speed`.
        vehicle.body.setLinvel({ x: 0, y: vehicle.body.linvel().y, z: -speed }, true);
        vehicle.tick({ steer: 1, throttle: 1, brake: 0, handbrake: false }, tuning);
        world.step();
        yaw.push(vehicle.body.angvel().y);
      }
      world.free();
      return yaw;
    };
    const off = run(0);
    const on = run(1);
    return Math.max(...on.map((y, i) => Math.abs(y - off[i])));
  }

  it("is fully active below 5 m/s, fades between 5 and 12, and is exactly inert at 12 m/s and above", () => {
    const e2 = pivotEffect(2);
    const e4 = pivotEffect(4.5);
    const e6 = pivotEffect(7);
    const e7 = pivotEffect(10);
    expect(e2).toBeGreaterThan(0.3);
    expect(e6).toBeGreaterThan(0);
    // Monotonic fade across the band.
    expect(e4).toBeGreaterThan(e6);
    expect(e6).toBeGreaterThan(e7);
    // Inert at the fade end and beyond: identical, not merely small.
    expect(pivotEffect(12)).toBe(0);
    expect(pivotEffect(15)).toBe(0);
  });
});

describe("pivot turn: hairpin regression", () => {
  it("a hairpin entered at 10 m/s with full lock and throttle is identical with pivotTurn on and off", () => {
    for (const ramp of [false, true]) {
      // Keyboard-style steer ramp (5/s) and an instant full lock, both.
      const hairpin: Script = (k) => ({
        steer: ramp ? Math.min(1, (k * 5) / 60) : 1,
        throttle: 1,
        brake: 0,
        handbrake: false,
      });
      const off = trace(withPivot(0), hairpin, 360, 16);
      const on = trace(withPivot(1), hairpin, 360, 16);
      // Guard: the car really does stay in the inert band the whole way round
      // (full throttle drives it up from 16 m/s, it never drops under 12).
      let minSpeed = Number.POSITIVE_INFINITY;
      for (let i = 0; i < off.length; i += 13) {
        minSpeed = Math.min(minSpeed, Math.hypot(off[i + 7], off[i + 9]));
      }
      expect(minSpeed).toBeGreaterThanOrEqual(12);
      expect(on).toEqual(off);
    }
  });
});

describe("pivot turn: eases in", () => {
  function onsetJolt(engageSec: number, pivotTurn = 1): number {
    const tuning = withPivot(pivotTurn, (t) => {
      t.drive.pivotEngageSec = engageSec;
    });
    const { routine, metrics } = makePivotTurnRoutine();
    runRoutine(routine, tuning);
    return metrics().onsetPeakYawAccel;
  }

  it("a longer ease-in gives a gentler onset (peak yaw acceleration falls monotonically)", () => {
    const j = [0.05, 0.15, 0.25, 0.4].map((e) => onsetJolt(e));
    for (let i = 1; i < j.length; i++) expect(j[i]).toBeLessThan(j[i - 1]);
  });

  it("the default onset is at least a third gentler than a near-instant ramp", () => {
    const def = defaultTuning().drive.pivotEngageSec;
    expect(onsetJolt(def)).toBeLessThan(onsetJolt(0.02) * 0.67);
  });

  it("the default onset stays under 8 rad/s^2 and the pivot still turns the car well past the unassisted turn", () => {
    const { routine, metrics } = makePivotTurnRoutine();
    runRoutine(routine, withPivot(1));
    const m = metrics();
    expect(m.onsetPeakYawAccel).toBeLessThan(8);
    const off = makePivotTurnRoutine();
    runRoutine(off.routine, withPivot(0));
    expect(m.headingAtReleaseDeg).toBeGreaterThan(off.metrics().headingAtReleaseDeg * 1.8);
  });
});
