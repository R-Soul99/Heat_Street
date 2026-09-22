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

/**
 * D-10 avoidance tuning (plan 07-03): a speed-scaled following distance and
 * the minimum gap the AI will coast down to. `followTimeSec` is the number
 * of seconds of travel at the current speed the AI wants to keep clear ahead
 * (a standard time-headway following model), clamped to `[followMinM,
 * followMaxM]` so a stationary or crawling car still keeps a sane minimum
 * gap and a flat-out car does not demand an unreasonably long clear road.
 */
export const AVOIDANCE_PARAMS = Object.freeze({
  followTimeSec: 1.2,
  followMinM: 8,
  followMaxM: 30,
  minGapM: 3,
});

export type AvoidanceParams = typeof AVOIDANCE_PARAMS;

/** Speed-scaled following distance, metres (D-10). */
export function followDistanceM(
  speedMs: number,
  params: AvoidanceParams = AVOIDANCE_PARAMS,
): number {
  return clamp(params.followTimeSec * Math.max(0, speedMs), params.followMinM, params.followMaxM);
}

/**
 * Given a forward gap to the nearest obstacle ahead (`gapM`, metres, or
 * `null` when nothing is within probe range), returns the throttle
 * multiplier in `[0, 1]` the AI should apply. `null` (clear road) is always
 * 1. At or beyond the speed-scaled following distance the AI is also fully
 * clear (1). At or inside `minGapM` the AI eases fully off the throttle
 * (0) — this is a COAST, never a brake (D-10: mild avoidance, not yielding —
 * `composeAiFrame` below only ever scales throttle, so this can never
 * become a brake command). Between the two, the scale ramps linearly.
 */
export function avoidanceThrottleScale(
  gapM: number | null,
  speedMs: number,
  params: AvoidanceParams = AVOIDANCE_PARAMS,
): number {
  if (gapM === null) return 1;
  const followM = followDistanceM(speedMs, params);
  const span = followM - params.minGapM;
  if (span <= 1e-6) return gapM >= followM ? 1 : 0;
  return clamp((gapM - params.minGapM) / span, 0, 1);
}

/**
 * Composes an avoidance throttle multiplier onto `base` (D-10, RESEARCH.md
 * Pattern 5 / Pitfall 1). THROTTLE-ONLY composition — mirrors
 * `src/physics/vehicle.ts`'s own documented "COMPOSITION, not replacement"
 * discipline for surface-grip multipliers (lines 404-412 there): `steer`,
 * `brake` and `handbrake` are always passed through from `base` untouched.
 * Avoidance never steers (steering always comes from pure pursuit against
 * the fixed racing line, so the AI cannot fight its own line: RESEARCH.md
 * Pitfall 1) and never brakes (D-10: mild avoidance, not yielding or
 * blocking). Whichever vehicle is physically ahead — an AI car or the
 * user-controlled car — is an obstacle only in the geometric sense to this
 * function: it reads no race standing, placement or live racer state, so
 * this is not a rubber-banding/catch-up mechanism (CIRC-02).
 */
export function composeAiFrame(base: InputFrame, throttleScale: number): InputFrame {
  return Object.freeze({
    steer: base.steer,
    throttle: base.throttle * clamp(throttleScale, 0, 1),
    brake: base.brake,
    handbrake: base.handbrake,
  });
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
