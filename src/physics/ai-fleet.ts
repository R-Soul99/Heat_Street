/**
 * N AI vehicles built through the exact same `createVehicle()` call the
 * player uses (D-01/D-02/D-09/T-07-02), each driven by its own
 * `AiDriver` over a SHARED `RacingLine`.
 *
 * `tick()` never advances the physics solver itself — matching
 * `Vehicle.tick()`'s own contract (it only writes pending Rapier
 * impulses/forces). The caller (a gameplay-tier `onTickBegin` hook, per
 * 07-RESEARCH.md Pattern 2) ticks this fleet BEFORE the loop's own solver
 * step runs, so all cars' impulses land in the SAME physics step —
 * `src/loop.ts` itself needs zero changes.
 *
 * Layering: may import `@dimforge/rapier3d` and `src/core/`. Must not import
 * `three` and must not touch the DOM or any wall clock.
 */
import type * as RAPIER from "@dimforge/rapier3d";
import {
  type AiDriver,
  type AiDriverParams,
  avoidanceThrottleScale,
  composeAiFrame,
  createAiDriver,
  followDistanceM,
} from "../core/ai-driver";
import { headingFromRotation } from "../core/heading";
import { type InputFrame, NEUTRAL } from "../core/input-tape";
import type { RacingLine } from "../core/racing-line";
import type { VehicleTuning } from "../core/vehicle-tuning";
import { probeForwardGapM } from "./ai-avoidance";
import type { SurfaceContext } from "./surface";
import { createVehicle, sampleVehicle, type Vehicle, type VehiclePose } from "./vehicle";

/** Forward probe length cap, metres — the same ceiling `AVOIDANCE_PARAMS.followMaxM` uses, so the ray is never cast further than the slowdown curve could ever need (T-07-10: bounds the per-tick raycast cost). */
const MAX_PROBE_DISTANCE_M = 30;
/** Forward probe origin offset past the chassis's own front face, metres — keeps the ray origin just outside the car's own collider so it is never accidentally the FIRST thing the ray would hit even without the self-exclude filter. */
const PROBE_FORWARD_MARGIN_M = 0.05;
/** Forward probe origin height above the chassis centre, metres — keeps the ray roughly bumper-height rather than at the chassis's vertical centre. */
const PROBE_HEIGHT_OFFSET_M = 0.1;

export interface AiFleetCar {
  readonly vehicle: Vehicle;
  readonly driver: AiDriver;
}

export interface AiFleet {
  readonly cars: readonly AiFleetCar[];
  readonly bodies: readonly RAPIER.RigidBody[];
  /**
   * Advances every car one fixed tick. `shape`, if supplied, transforms each
   * car's own pure-pursuit `InputFrame` before it is applied (the
   * composition point for avoidance/recovery overrides — Patterns 5/6 — that
   * a future plan wires in; Task 3 itself never needs it, so it is optional
   * and unused today).
   */
  tick(tickIndex: number, shape?: (carIndex: number, base: InputFrame) => InputFrame): void;
  /** The frame actually applied to car `carIndex` on the most recent `tick()` call. `NEUTRAL` before the first tick. */
  lastFrame(carIndex: number): InputFrame;
  /** The D-10 avoidance throttle multiplier applied to car `carIndex` on the most recent `tick()` call, in `[0, 1]`. `1` before the first tick and immediately after `resetCar`. */
  avoidanceScale(carIndex: number): number;
  /** Resets car `carIndex`'s chassis in place and forces its driver to re-seed its nearest-line-point search next tick. */
  resetCar(carIndex: number, pose: VehiclePose): void;
  /** D-02: retunes every AI vehicle identically to the player's own live tune — never a second, independent tuning surface. */
  setTuning(t: VehicleTuning): void;
  dispose(): void;
}

/**
 * Builds `gridPoses.length` AI vehicles into `world`, each spawned at its own
 * grid pose and driven by its own `AiDriver` over the SHARED `line` (D-02:
 * identical car, tune and racing line for every AI racer — they differ only
 * by starting grid slot).
 */
export function createAiFleet(
  world: RAPIER.World,
  tuning: VehicleTuning,
  surfaces: SurfaceContext,
  line: RacingLine,
  gridPoses: readonly VehiclePose[],
  driverParams: AiDriverParams,
  options?: { readonly obstacleBodies?: readonly RAPIER.RigidBody[] },
): AiFleet {
  let currentTuning = tuning;

  const cars: AiFleetCar[] = gridPoses.map((pose) => {
    const vehicle = createVehicle(world, currentTuning, pose);
    vehicle.resetPose(pose);
    const driver = createAiDriver(line, driverParams);
    return { vehicle, driver };
  });

  const lastFrames: InputFrame[] = cars.map(() => NEUTRAL);
  const avoidanceScales: number[] = cars.map(() => 1);

  const bodies: readonly RAPIER.RigidBody[] = cars.map((car) => car.vehicle.body);

  // D-10 avoidance obstacle set: every fleet chassis's own single collider
  // (`createVehicle` always builds exactly one, index 0) plus any
  // externally-supplied obstacle bodies (e.g. the user-controlled car,
  // wired in by a later plan) — a plain `ColliderHandle` set, rebuilt once
  // here since fleet membership and obstacle bodies are fixed for this
  // `AiFleet`'s lifetime.
  const obstacleColliderHandles = new Set<number>();
  for (const car of cars) {
    obstacleColliderHandles.add(car.vehicle.body.collider(0).handle);
  }
  for (const obstacleBody of options?.obstacleBodies ?? []) {
    obstacleColliderHandles.add(obstacleBody.collider(0).handle);
  }

  return {
    cars,
    bodies,

    tick(tickIndex: number, shape?: (carIndex: number, base: InputFrame) => InputFrame): void {
      for (let i = 0; i < cars.length; i++) {
        const car = cars[i];
        // Fresh, not the cached `.telemetry` getter — a `resetCar()` reset
        // (D-13) mutates the body directly via `resetPose`, and the cached
        // telemetry only refreshes on the NEXT `vehicle.tick()` call. Reading
        // fresh here means an AI observes its true post-reset pose the very
        // same tick, not a stale pre-reset one.
        const sample = sampleVehicle(car.vehicle);
        const headingRad = headingFromRotation(sample.rotation);
        car.driver.observe({
          x: sample.position.x,
          z: sample.position.z,
          headingRad,
          forwardSpeedMs: sample.forwardSpeedMs,
        });

        const forwardSpeedMs = Math.max(0, sample.forwardSpeedMs);
        const forward = { x: Math.cos(headingRad), z: Math.sin(headingRad) };
        // currentTuning, not the original `tuning` parameter — D-02 requires
        // every AI reflect the live tune after `setTuning`, and the probe
        // origin offset (half the chassis length) must track a retuned
        // chassis size just like every other per-tick read here does.
        const halfChassisM = currentTuning.chassis.halfExtents.z;
        const origin = {
          x: sample.position.x + forward.x * (halfChassisM + PROBE_FORWARD_MARGIN_M),
          y: sample.position.y + PROBE_HEIGHT_OFFSET_M,
          z: sample.position.z + forward.z * (halfChassisM + PROBE_FORWARD_MARGIN_M),
        };
        const gapM = probeForwardGapM(
          world,
          car.vehicle.body,
          obstacleColliderHandles,
          origin,
          forward,
          Math.min(MAX_PROBE_DISTANCE_M, followDistanceM(forwardSpeedMs)),
        );
        const scale = avoidanceThrottleScale(gapM, forwardSpeedMs);
        avoidanceScales[i] = scale;

        const pursuitFrame = car.driver.sampleForTick(tickIndex);
        const base = composeAiFrame(pursuitFrame, scale);
        const frame = shape ? shape(i, base) : base;
        car.vehicle.tick(frame, currentTuning, surfaces);
        lastFrames[i] = frame;
      }
    },

    lastFrame(carIndex: number): InputFrame {
      return lastFrames[carIndex] ?? NEUTRAL;
    },

    avoidanceScale(carIndex: number): number {
      return avoidanceScales[carIndex] ?? 1;
    },

    resetCar(carIndex: number, pose: VehiclePose): void {
      const car = cars[carIndex];
      if (car === undefined) return;
      car.vehicle.resetPose(pose);
      car.driver.reseed();
      avoidanceScales[carIndex] = 1;
    },

    setTuning(t: VehicleTuning): void {
      currentTuning = t;
      for (const car of cars) {
        car.vehicle.applyTuning(t);
      }
    },

    dispose(): void {
      for (const car of cars) {
        car.vehicle.dispose();
      }
    },
  };
}
