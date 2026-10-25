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

const full = (k: number): InputFrame => ({ steer: 1, throttle: 1, brake: 0, handbrake: false });
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
    const holdSamples = m.series.filter((s) => s.t >= 0.75 && s.t <= 1.0);
    for (const s of holdSamples) expect(s.frontAxleSpeedMs).toBeLessThan(4);
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

  it("the handbrake does not move the moment the pivot starts acting", () => {
    // Same steer + throttle either way; the handbrake only differs. The pivot
    // must begin to matter on the same tick (dwell is throttle + steer only),
    // and the handbrake must not start it early or reset its dwell.
    const plain: Script = () => ({ steer: 1, throttle: 1, brake: 0, handbrake: false });
    const withHandbrake: Script = (k) => ({
      steer: 1,
      throttle: 1,
      brake: 0,
      handbrake: k >= 4 && k < 40,
    });
    const startPlain = firstDivergence(
      trace(withPivot(0), plain, 90),
      trace(withPivot(1), plain, 90),
    );
    const startHandbrake = firstDivergence(
      trace(withPivot(0), withHandbrake, 90),
      trace(withPivot(1), withHandbrake, 90),
    );
    // 0.3 s dwell = 18 ticks.
    expect(startPlain).toBeGreaterThanOrEqual(17);
    expect(startPlain).toBeLessThanOrEqual(20);
    expect(startHandbrake).toBe(startPlain);
  });

  it("no handbrake reference remains in the pivot gate code", async () => {
    const src = (await import("../src/physics/vehicle.ts?raw")).default as string;
    const gate = src.slice(
      src.indexOf("// Pivot-turn gate and filters"),
      src.indexOf("const rearSfs = frame.handbrake"),
    );
    expect(gate.length).toBeGreaterThan(200);
    // The comment names the handbrake to say it is excluded; no code may read it.
    expect(gate.replace(/\/\/.*$/gm, "")).not.toMatch(/handbrake/);
  });
});

describe("pivot turn: speed gate (full below 5 m/s, zero at 8 m/s)", () => {
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

  it("is fully active below 5 m/s, fades between 5 and 8, and is exactly inert at 8 m/s and above", () => {
    const e2 = pivotEffect(2);
    const e4 = pivotEffect(4.5);
    const e6 = pivotEffect(6.5);
    const e7 = pivotEffect(7.5);
    expect(e2).toBeGreaterThan(0.3);
    expect(e6).toBeGreaterThan(0);
    // Monotonic fade across the band.
    expect(e4).toBeGreaterThan(e6);
    expect(e6).toBeGreaterThan(e7);
    // Inert at the fade end and beyond: identical, not merely small.
    expect(pivotEffect(8)).toBe(0);
    expect(pivotEffect(10)).toBe(0);
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
      const off = trace(withPivot(0), hairpin, 360, 10);
      const on = trace(withPivot(1), hairpin, 360, 10);
      // Guard: the car really does stay in the inert band the whole way round
      // (full throttle drives it up from 10 m/s, it never drops under 8).
      let minSpeed = Number.POSITIVE_INFINITY;
      for (let i = 0; i < off.length; i += 13) {
        minSpeed = Math.min(minSpeed, Math.hypot(off[i + 7], off[i + 9]));
      }
      expect(minSpeed).toBeGreaterThanOrEqual(8);
      expect(on).toEqual(off);
    }
  });
});
