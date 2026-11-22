/**
 * Headless measurement helpers for vehicle-class targets (plan 09-03): 0-60,
 * top speed, settle, full-lock tilt, at-rest wheel contact and per-surface
 * skidpad, for ANY tuning / drive share / spawn height.
 *
 * Every helper builds its OWN throwaway world and frees it in `finally`
 * (T-09-06, T-09-07): nothing here can leak WASM memory or perturb the live
 * game world. Layering: rapier + src/core + sibling physics modules only; no
 * three, no DOM, no wall clock.
 */
import type { InputFrame } from "../../core/input-tape";
import { DT } from "../../core/sim-clock";
import type { SurfaceProfiles } from "../../core/surface-tuning";
import type { SurfaceType } from "../../core/surface-types";
import type { VehicleTuning } from "../../core/vehicle-tuning";
import type { SurfaceContext } from "../surface";
import { createSurfaceMap } from "../surface";
import type { Vehicle, VehicleSample } from "../vehicle";
import { createVehicle, FL, FR, RL, RR, sampleVehicle } from "../vehicle";
import { createWorld } from "../world";
import { ROUTINES } from "./routines";
import type { RoutineRunOpts } from "./run";
import { buildTelemetryScene, runRoutine } from "./run";
import { makeSurfaceSkidpadRoutine } from "./surface-routines";

export type MeasureOpts = RoutineRunOpts & {
  readonly surface?: SurfaceType;
  readonly profiles?: SurfaceProfiles;
};

const RAD_TO_DEG = 180 / Math.PI;
const IDLE: InputFrame = { steer: 0, throttle: 0, brake: 0, handbrake: false };

interface Rig {
  readonly vehicle: Vehicle;
  /** Advance one tick with `frame`, returning the post-step sample. */
  step(frame: InputFrame): VehicleSample;
}

function withRig<T>(tuning: VehicleTuning, opts: MeasureOpts | undefined, run: (rig: Rig) => T): T {
  const world = createWorld();
  try {
    const ground = buildTelemetryScene(world);
    const vehicle = createVehicle(
      world,
      tuning,
      { x: 0, y: opts?.spawnY ?? 1, z: 0 },
      opts?.frontDriveShare ?? 0,
      opts?.surfaceGripScale === undefined
        ? undefined
        : { surfaceGripScale: opts.surfaceGripScale },
    );
    let surfaces: SurfaceContext | undefined;
    if (opts?.surface !== undefined && opts.profiles !== undefined) {
      const map = createSurfaceMap();
      map.register(ground.handle, opts.surface);
      surfaces = { map, profiles: opts.profiles };
    }
    return run({
      vehicle,
      step(frame) {
        if (surfaces) {
          vehicle.tick(frame, tuning, surfaces);
        } else {
          vehicle.tick(frame, tuning);
        }
        world.step();
        return sampleVehicle(vehicle);
      },
    });
  } finally {
    world.free();
  }
}

function contactCount(v: Vehicle, ...wheels: number[]): number {
  let n = 0;
  for (const i of wheels) {
    if (v.controller.wheelIsInContact(i)) n++;
  }
  return n;
}

/** Seconds to 60 mph (accel routine); +Infinity if never reached. */
export function measureZeroToSixty(tuning: VehicleTuning, opts?: MeasureOpts): number {
  const accel = ROUTINES.find((r) => r.id === "accel");
  if (!accel) throw new Error("accel routine missing");
  const surfaceOpts =
    opts?.surface !== undefined && opts.profiles !== undefined
      ? { surface: opts.surface, profiles: opts.profiles }
      : undefined;
  return runRoutine(accel, tuning, surfaceOpts, undefined, opts).value;
}

/** Idle ticks before throttle, matching the accel routine's SETTLE_TICKS. */
const TIME_TO_SPEED_SETTLE_TICKS = 40;

/**
 * Seconds of full throttle (straight, after the same 40-tick settle as the accel
 * routine) until forward speed reaches `speedMs`; +Infinity if not reached within
 * 1800 ticks. Supports surface opts. `measureTimeToSpeed(t, 26.8224)` equals
 * `measureZeroToSixty(t)`.
 */
export function measureTimeToSpeed(
  tuning: VehicleTuning,
  speedMs: number,
  opts?: MeasureOpts,
): number {
  return withRig(tuning, opts, ({ step }) => {
    for (let tick = 0; tick < 1800; tick++) {
      const s = step(
        tick < TIME_TO_SPEED_SETTLE_TICKS
          ? IDLE
          : { steer: 0, throttle: 1, brake: 0, handbrake: false },
      );
      if (tick >= TIME_TO_SPEED_SETTLE_TICKS && s.forwardSpeedMs >= speedMs) {
        return (tick - TIME_TO_SPEED_SETTLE_TICKS) * DT;
      }
    }
    return Number.POSITIVE_INFINITY;
  });
}

/** Max forward speed (m/s) at full throttle, straight, over 1800 ticks. */
export function measureTopSpeed(tuning: VehicleTuning, opts?: MeasureOpts): number {
  return withRig(tuning, opts, ({ step }) => {
    let max = 0;
    for (let tick = 0; tick < 1800; tick++) {
      const s = step({ steer: 0, throttle: 1, brake: 0, handbrake: false });
      max = Math.max(max, s.forwardSpeedMs);
    }
    return max;
  });
}

/** Zero input 600 ticks; settle time to within 0.01 m of the tick-300 height. */
export function measureSettle(
  tuning: VehicleTuning,
  opts?: MeasureOpts,
): { settleSec: number; bandM: number } {
  return withRig(tuning, opts, ({ step }) => {
    const ys: number[] = [];
    for (let tick = 0; tick < 600; tick++) {
      ys.push(step(IDLE).position.y);
    }
    const ref = ys[300];
    let lastOutside = -1;
    let bandM = 0;
    for (let i = 0; i < 600; i++) {
      const d = Math.abs(ys[i] - ref);
      if (d > 0.01) lastOutside = i;
      if (i >= 300) bandM = Math.max(bandM, d);
    }
    return { settleSec: (lastOutside + 1) * DT, bandM };
  });
}

/** Wheels in contact (0..4) after 300 idle ticks. */
export function measureRestContact(tuning: VehicleTuning, opts?: MeasureOpts): number {
  return withRig(tuning, opts, ({ vehicle, step }) => {
    for (let tick = 0; tick < 300; tick++) {
      step(IDLE);
    }
    return contactCount(vehicle, FL, FR, RL, RR);
  });
}

/**
 * Reach `speedMs`, then hold full lock (steer +1) at that speed for 300 ticks.
 * Returns peak chassis tilt and whether both inside wheels were airborne on
 * the same tick. Inside = the side the car yaws toward (angvel.y > 0 is a
 * left turn: FL/RL are the left wheels, forward is -Z).
 */
export function measureFullLockTilt(
  tuning: VehicleTuning,
  speedMs: number,
  opts?: MeasureOpts,
): { maxTiltDeg: number; insideWheelsLifted: boolean } {
  return withRig(tuning, opts, ({ vehicle, step }) => {
    let s = sampleVehicle(vehicle);
    for (let tick = 0; tick < 1200 && s.forwardSpeedMs < speedMs; tick++) {
      s = step({ steer: 0, throttle: 1, brake: 0, handbrake: false });
    }
    let maxTiltDeg = 0;
    let insideWheelsLifted = false;
    for (let tick = 0; tick < 300; tick++) {
      s = step({
        steer: 1,
        throttle: s.forwardSpeedMs < speedMs ? 1 : 0,
        brake: 0,
        handbrake: false,
      });
      const q = s.rotation;
      const upY = 1 - 2 * (q.x * q.x + q.z * q.z);
      maxTiltDeg = Math.max(maxTiltDeg, Math.acos(Math.max(-1, Math.min(1, upY))) * RAD_TO_DEG);
      const inside = s.angvel.y >= 0 ? [FL, RL] : [FR, RR];
      if (contactCount(vehicle, ...inside) === 0) insideWheelsLifted = true;
    }
    return { maxTiltDeg, insideWheelsLifted };
  });
}

/** Sustained skidpad lateral g on `surface` (the skidpad routine's value). */
export function measureSurfaceSkidpad(
  tuning: VehicleTuning,
  surface: SurfaceType,
  profiles: SurfaceProfiles,
  opts?: MeasureOpts,
): number {
  return runRoutine(
    makeSurfaceSkidpadRoutine(surface),
    tuning,
    { surface, profiles },
    undefined,
    opts,
  ).value;
}
