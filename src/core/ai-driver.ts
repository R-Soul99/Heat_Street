/**
 * Pure-pursuit `InputSource` over a `RacingLine` (plan 07-01 Task 3).
 *
 * This is the AI's ONLY control channel into a vehicle: `sampleForTick`
 * returns an `InputFrame`, exactly the shape `Vehicle.tick()`
 * (`src/physics/vehicle.ts`) accepts from anyone (D-09/T-07-02) — the driver
 * never touches a `RAPIER.RigidBody` directly and cannot write a transform,
 * teleport, or exceed the same friction model the player is bound by.
 *
 * `observe()` feeds the driver its own last-known telemetry (position,
 * bearing heading, forward speed) each tick, PASSED IN by the caller
 * (`src/physics/ai-fleet.ts`) — this file never reads Rapier state itself,
 * which is what keeps it a plain, deterministic function of (own
 * observation, the shared racing line) and vitest-testable with no physics
 * world (`tests/layering.test.ts`'s `src/core/` purity rule).
 *
 * The per-wheel surface-grip block in `vehicle.ts`'s `tick()` reflects the
 * PREVIOUS tick's raycast — a one-tick (~16.6ms) lag between crossing a
 * surface boundary and new friction values taking effect
 * (03-RESEARCH.md Pitfall 2). This is unchanged and intentional for AI cars
 * too; it is not a steering bug to chase if an AI wobbles slightly crossing
 * a tarmac/gravel boundary.
 *
 * Pure by construction: imports only `./input-tape`, `./racing-line` and
 * `./vehicle-tuning` (types). No renderer, no physics engine, no DOM, no
 * wall clock, no `Math.random`/`Date.now`. `tests/layering.test.ts` enforces
 * this mechanically, and this plan's own source-guard test additionally
 * forbids any reference to player/placement/race-standing state or
 * rubber-banding/catch-up terms (D-09/CIRC-02: one fixed pace, never derived
 * from any racer's live state).
 */
import { type InputFrame, type InputSource, NEUTRAL } from "./input-tape";
import { nearestLineIndex, pointAhead, type RacingLine } from "./racing-line";
import type { VehicleTuning } from "./vehicle-tuning";

/** This driver's own last-known telemetry, fed in every tick by the caller. */
export interface AiObservation {
  readonly x: number;
  readonly z: number;
  /** Bearing convention — `headingFromRotation`'s own atan2(forwardZ, forwardX). */
  readonly headingRad: number;
  readonly forwardSpeedMs: number;
}

export interface AiDriverParams {
  readonly lookAheadGainSec: number;
  readonly lookAheadMinM: number;
  readonly lookAheadMaxM: number;
  readonly wheelbaseM: number;
  readonly maxSteerLockRad: number;
  readonly speedLeadSec: number;
  readonly throttleGain: number;
  readonly throttleFloor: number;
  readonly brakeGain: number;
  readonly brakeDeadbandMs: number;
  readonly brakeMinSpeedMs: number;
  readonly searchWindowPoints: number;
}

/**
 * D-02: AI racers drive the exact same car and tune as the player, so the
 * driver's own kinematic constants (`wheelbaseM`, `maxSteerLockRad`) are
 * derived from the SAME `VehicleTuning` object the player's chassis uses,
 * never an independently authored copy.
 */
export function defaultAiDriverParams(tuning: VehicleTuning): AiDriverParams {
  return {
    lookAheadGainSec: 0.9,
    lookAheadMinM: 6,
    lookAheadMaxM: 40,
    wheelbaseM: 2 * tuning.wheels.halfWheelbase,
    maxSteerLockRad: tuning.drive.maxSteerLock,
    speedLeadSec: 0.5,
    throttleGain: 0.35,
    throttleFloor: 0.25,
    brakeGain: 0.2,
    brakeDeadbandMs: 1.0,
    brakeMinSpeedMs: 1.5,
    searchWindowPoints: 40,
  };
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** Velocity-scaled look-ahead distance (RESEARCH.md Pitfall 3 fix: a fixed distance oscillates on straights). */
export function lookAheadDistanceM(speedMs: number, params: AiDriverParams): number {
  return clamp(params.lookAheadGainSec * speedMs, params.lookAheadMinM, params.lookAheadMaxM);
}

/**
 * Pure-pursuit steering (R. Craig Coulter, CMU-RI-TR-92-01), adapted to this
 * codebase's `InputFrame.steer` sign convention (positive = RIGHT, matching
 * `vehicle.ts`'s `steerAngle = -frame.steer * maxSteerLock`). `headingRad` is
 * the BEARING convention (`headingFromRotation`), matching the bearing this
 * codebase already uses for "current heading" everywhere else.
 */
export function pursuitSteer(
  carX: number,
  carZ: number,
  headingRad: number,
  targetX: number,
  targetZ: number,
  lookAheadM: number,
  wheelbaseM: number,
  maxSteerLockRad: number,
): number {
  const dx = targetX - carX;
  const dz = targetZ - carZ;
  const bearingToTarget = Math.atan2(dz, dx);
  const alpha = bearingToTarget - headingRad;
  const wrapped = Math.atan2(Math.sin(alpha), Math.cos(alpha));
  const safeLookAheadM = lookAheadM > 1e-6 ? lookAheadM : 1e-6;
  const curvature = (2 * Math.sin(wrapped)) / safeLookAheadM;
  const steerAngleRad = Math.atan(wheelbaseM * curvature);
  return clamp(steerAngleRad / maxSteerLockRad, -1, 1);
}

export interface AiDriverDebug {
  readonly lineIndex: number;
  readonly targetIndex: number;
  readonly targetX: number;
  readonly targetZ: number;
  readonly targetSpeedMs: number;
  readonly lookAheadM: number;
  readonly frame: InputFrame;
}

export interface AiDriver extends InputSource {
  observe(obs: AiObservation): void;
  /** Forces the next `sampleForTick` to do a full (unhinted) nearest-point search — used after a checkpoint-anchored reset (D-13) moves the car far from its last known line position. */
  reseed(): void;
  debug(): AiDriverDebug;
}

const INITIAL_OBSERVATION: AiObservation = Object.freeze({
  x: 0,
  z: 0,
  headingRad: 0,
  forwardSpeedMs: 0,
});

const INITIAL_DEBUG: AiDriverDebug = Object.freeze({
  lineIndex: 0,
  targetIndex: 0,
  targetX: 0,
  targetZ: 0,
  targetSpeedMs: 0,
  lookAheadM: 0,
  frame: NEUTRAL,
});

/** Builds a pure-pursuit `AiDriver` over `line`, tuned by `params`. */
export function createAiDriver(line: RacingLine, params: AiDriverParams): AiDriver {
  let lastObservation: AiObservation = INITIAL_OBSERVATION;
  let lastIndex = 0;
  let reseedPending = true;
  let cachedTick: number | null = null;
  let cachedFrame: InputFrame = NEUTRAL;
  let cachedDebug: AiDriverDebug = INITIAL_DEBUG;

  function compute(tick: number): void {
    const obs = lastObservation;
    const forwardSpeedMs = Math.max(0, obs.forwardSpeedMs);

    const lineIndex = nearestLineIndex(
      line,
      obs.x,
      obs.z,
      reseedPending ? null : lastIndex,
      params.searchWindowPoints,
    );
    reseedPending = false;
    lastIndex = lineIndex;

    const lookAheadM = lookAheadDistanceM(forwardSpeedMs, params);
    const targetIndex = pointAhead(line, lineIndex, lookAheadM);
    const targetPoint = line.points[targetIndex];

    const steer = pursuitSteer(
      obs.x,
      obs.z,
      obs.headingRad,
      targetPoint.x,
      targetPoint.z,
      lookAheadM,
      params.wheelbaseM,
      params.maxSteerLockRad,
    );

    const speedTargetIndex = pointAhead(line, lineIndex, forwardSpeedMs * params.speedLeadSec);
    const targetSpeedMs = line.points[speedTargetIndex].targetSpeedMs;

    // Braking near standstill would engage REVERSE in vehicle.ts's own
    // `tick()` (any brake > 0 while forwardSpeedMs < reverseEngageSpeedMs
    // drives the car backward) — brakeMinSpeedMs guards against an AI that
    // is merely slow (not stuck) commanding a brake that accidentally
    // reverses it.
    const err = targetSpeedMs - obs.forwardSpeedMs;
    let throttle: number;
    let brake: number;
    if (err >= -params.brakeDeadbandMs) {
      throttle = clamp(params.throttleFloor + err * params.throttleGain, 0, 1);
      brake = 0;
    } else {
      throttle = 0;
      brake =
        obs.forwardSpeedMs > params.brakeMinSpeedMs ? clamp(-err * params.brakeGain, 0, 1) : 0;
    }

    // D-12: tidy grip driving — no deliberate handbrake or power-oversteer.
    const frame: InputFrame = Object.freeze({ steer, throttle, brake, handbrake: false });

    cachedTick = tick;
    cachedFrame = frame;
    cachedDebug = Object.freeze({
      lineIndex,
      targetIndex,
      targetX: targetPoint.x,
      targetZ: targetPoint.z,
      targetSpeedMs,
      lookAheadM,
      frame,
    });
  }

  return {
    observe(obs: AiObservation): void {
      lastObservation = obs;
    },
    reseed(): void {
      reseedPending = true;
    },
    sampleForTick(tick: number): InputFrame {
      if (cachedTick !== tick) {
        compute(tick);
      }
      return cachedFrame;
    },
    debug(): AiDriverDebug {
      return cachedDebug;
    },
  };
}
