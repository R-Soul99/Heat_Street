/**
 * Chase driver for pursuit cars (first prototype, 2026-11-07).
 *
 * Same control channel as the racing-line driver (`AiDriver` / `InputFrame`):
 * it never touches physics, drives the SAME car and tune as the player, and is
 * a pure function of (own observation, the target it was last told about, the
 * tick). Instead of a racing line it steers straight at where the target will
 * be a moment from now, closes the gap hard, then shadows the target's speed at
 * a standoff distance. If it stops moving while the target is still far it
 * backs out and tries again.
 *
 * Pure by construction: imports only `./ai-driver`, `./input-tape`,
 * `./vehicle-tuning` (types). No renderer, no physics engine, no DOM, no clock.
 */
import { type AiDriver, type AiDriverDebug, type AiObservation, pursuitSteer } from "./ai-driver";
import { type InputFrame, NEUTRAL } from "./input-tape";
import type { VehicleTuning } from "./vehicle-tuning";

/** What the pursuer is chasing (world metres, metres/second). */
export interface PursuitTarget {
  readonly x: number;
  readonly z: number;
  readonly vx: number;
  readonly vz: number;
  /** Unit direction the player's car is facing; used for flank stations while it is nearly stopped. */
  readonly fx?: number;
  readonly fz?: number;
}

export interface PursuerParams {
  readonly wheelbaseM: number;
  readonly maxSteerLockRad: number;
  /** Seconds of target travel the aim point leads by (capped by distance/own speed). */
  readonly leadMaxSec: number;
  /** Distance at which the pursuer stops closing and shadows the target. */
  readonly standoffM: number;
  /** Extra speed over the target's, m/s per metre of gap beyond the standoff. */
  readonly closeGain: number;
  /** Hard cap on the speed the pursuer asks for, m/s. */
  readonly maxSpeedMs: number;
  /** Speed multiplier at 90 deg of heading error (cornering / turn-around). */
  readonly turnSpeedFloor: number;
  readonly throttleGain: number;
  readonly brakeGain: number;
  /** Below this forward speed with the target still far, the car counts as stuck. */
  readonly stuckSpeedMs: number;
  readonly stuckTicks: number;
  readonly reverseTicks: number;
  readonly tickRateHz: number;
  /** Blockers slow to this fraction of the player's speed once they are in its lane ahead of it. */
  readonly blockSpeedFraction: number;
  /** Blockers may go faster than other pursuers so they can overtake a player at speed, m/s. */
  readonly blockerMaxSpeedMs: number;
  /** A blocker only starts its sideways slide once it is at least this far ahead of the player, m. */
  readonly slideMinAlongM: number;
  /** ...and no further ahead than this, m. */
  readonly slideMaxAlongM: number;
  /** ...and within this many metres of the player's line, m. */
  readonly slideLaneM: number;
}

export function defaultPursuerParams(tuning: VehicleTuning): PursuerParams {
  return {
    wheelbaseM: 2 * tuning.wheels.halfWheelbase,
    maxSteerLockRad: tuning.drive.maxSteerLock,
    leadMaxSec: 1.2,
    standoffM: 7,
    closeGain: 0.9,
    maxSpeedMs: 38,
    turnSpeedFloor: 0.3,
    throttleGain: 0.35,
    brakeGain: 0.2,
    stuckSpeedMs: 1.0,
    stuckTicks: 90,
    reverseTicks: 75,
    tickRateHz: 60,
    blockSpeedFraction: 0.55,
    blockerMaxSpeedMs: 52,
    slideMinAlongM: 6,
    slideMaxAlongM: 25,
    slideLaneM: 4,
  };
}

/** Where on the player this pursuer wants to be: metres to the player's right and ahead of it (negative = left / behind). */
export interface FlankSlot {
  readonly lateralM: number;
  readonly alongM: number;
}

/**
 * Station for pursuer `i`: slot 0 tails the player, then left flank, right
 * flank, left-ahead, right-ahead; later pursuers repeat the five stations on
 * wider, further-back rings so a big swarm spreads across the road instead of
 * queueing in one file. Pure and index-only.
 */
export function flankSlot(i: number): FlankSlot {
  const stations: readonly FlankSlot[] = [
    { lateralM: 0, alongM: 0 },
    { lateralM: -7, alongM: 0 },
    { lateralM: 7, alongM: 0 },
    { lateralM: -6, alongM: 14 },
    { lateralM: 6, alongM: 14 },
  ];
  const ring = Math.floor(i / 5);
  const base = stations[i % 5] as FlankSlot;
  return {
    lateralM: base.lateralM * (1 + 0.6 * ring),
    alongM: base.alongM * (1 + 0.3 * ring) - 7 * ring,
  };
}

export interface PursuerDriver extends AiDriver {
  /** Tell the driver where its target is this tick. */
  setTarget(target: PursuitTarget): void;
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** How far ahead of the player a blocker holds once it is in the player's line, m. */
const BLOCK_HOLD_M = 12;

function wrapAngle(a: number): number {
  return Math.atan2(Math.sin(a), Math.cos(a));
}

function smoothstep(lo: number, hi: number, x: number): number {
  const t = clamp((x - lo) / (hi - lo), 0, 1);
  return t * t * (3 - 2 * t);
}

const INITIAL_OBS: AiObservation = Object.freeze({ x: 0, z: 0, headingRad: 0, forwardSpeedMs: 0 });
const INITIAL_TARGET: PursuitTarget = Object.freeze({ x: 0, z: 0, vx: 0, vz: 0 });

export function createPursuerDriver(
  params: PursuerParams,
  slot: FlankSlot = { lateralM: 0, alongM: 0 },
): PursuerDriver {
  let obs: AiObservation = INITIAL_OBS;
  let target: PursuitTarget = INITIAL_TARGET;
  let cachedTick: number | null = null;
  let frame: InputFrame = NEUTRAL;
  let debug: AiDriverDebug = Object.freeze({
    lineIndex: 0,
    targetIndex: 0,
    targetX: 0,
    targetZ: 0,
    targetSpeedMs: 0,
    lookAheadM: 0,
    frame: NEUTRAL,
  });
  let stuckFor = 0;
  let reversingFor = 0;
  // Player's direction of travel, kept from the last tick it was moving.
  let fwdX = 0;
  let fwdZ = -1;
  let reverseSteer = 0;
  // Blocker slide: latched once started so it commits until the player is past or gone.
  let sliding = false;
  let slideSide = 1;

  function compute(tick: number): void {
    const speed = Math.max(0, obs.forwardSpeedMs);
    const dx0 = target.x - obs.x;
    const dz0 = target.z - obs.z;
    const dist = Math.hypot(dx0, dz0);

    // Aim at this pursuer's station on the target, where the target will be a
    // moment from now: lead by travel time, never more than leadMaxSec, then
    // offset to the player's right/ahead (a flank slot) along its direction of travel.
    const tSpeed = Math.hypot(target.vx, target.vz);
    if (tSpeed > 3) {
      fwdX = target.vx / tSpeed;
      fwdZ = target.vz / tSpeed;
    } else if (target.fx !== undefined && target.fz !== undefined) {
      fwdX = target.fx;
      fwdZ = target.fz;
    }
    const rightX = -fwdZ;
    const rightZ = fwdX;
    const onStation = slot.lateralM !== 0 || slot.alongM !== 0;

    // Blockers (stations ahead of the player) reach further ahead the faster the
    // player goes, run up the side, then swing across into the player's lane
    // once they are clear of its nose, and finally slow down in front of it.
    const carAlong = (obs.x - target.x) * fwdX + (obs.z - target.z) * fwdZ;
    const carLat = (obs.x - target.x) * rightX + (obs.z - target.z) * rightZ;
    const blocker = slot.alongM > 0;
    // Swing across into the player's line as soon as the blocker is level with it.
    const cut = blocker ? smoothstep(0, 10, carAlong) : 0;
    // Run well ahead to overtake, then tighten right up to the player once in its
    // line: a blocker cruising 50 m ahead at speed never gets near enough to block.
    const alongEff = blocker
      ? (slot.alongM + 0.8 * tSpeed) * (1 - cut) + BLOCK_HOLD_M * cut
      : slot.alongM;
    const lateralEff = slot.lateralM * (1 - cut);

    const leadSec = clamp(dist / Math.max(speed, 6), 0, params.leadMaxSec);
    const aimX = target.x + target.vx * leadSec + rightX * lateralEff + fwdX * alongEff;
    const aimZ = target.z + target.vz * leadSec + rightZ * lateralEff + fwdZ * alongEff;
    const aimDist = Math.hypot(aimX - obs.x, aimZ - obs.z);
    // Signed along-track gap to the station (positive = the car is behind its
    // station and must speed up; negative = it is ahead and must ease off).
    const stationAlong =
      (target.x + rightX * lateralEff + fwdX * alongEff - obs.x) * fwdX +
      (target.z + rightZ * lateralEff + fwdZ * alongEff - obs.z) * fwdZ;

    const bearing = Math.atan2(aimZ - obs.z, aimX - obs.x);
    const alpha = Math.atan2(
      Math.sin(bearing - obs.headingRad),
      Math.cos(bearing - obs.headingRad),
    );

    const lookAheadM = clamp(Math.min(aimDist, Math.max(6, 0.9 * speed)), 3, 40);
    let steer = pursuitSteer(
      obs.x,
      obs.z,
      obs.headingRad,
      aimX,
      aimZ,
      lookAheadM,
      params.wheelbaseM,
      params.maxSteerLockRad,
    );

    // Speed: the target's own speed plus a closing bonus beyond the standoff,
    // eased down when the nose is pointing well away from the aim point.
    const targetSpeed = Math.hypot(target.vx, target.vz);
    // Tail cars hold a standoff behind the player; cars on a flank station run right up to it.
    const closing = onStation
      ? stationAlong * params.closeGain
      : Math.max(0, dist - params.standoffM) * params.closeGain;
    // A blocker still getting ahead of the player hardly lifts for a heading error:
    // every swerve of the player used to cost it the ground it had gained.
    const turnFloor =
      blocker && carAlong < 18 ? Math.max(params.turnSpeedFloor, 0.75) : params.turnSpeedFloor;
    const turnScale = 1 - (1 - turnFloor) * clamp(Math.abs(alpha) / (Math.PI / 2), 0, 1);
    const speedCap = blocker ? params.blockerMaxSpeedMs : params.maxSpeedMs;
    let desired = Math.max(0, Math.min(speedCap, (targetSpeed + closing) * turnScale));
    // In the player's way: ease off to a fraction of its speed so it has to brake or swerve.
    if (blocker && carAlong > 2 && carAlong < 40 && Math.abs(carLat) < 5) {
      desired = Math.min(desired, targetSpeed * params.blockSpeedFraction);
    }

    const err = desired - speed;
    let throttle = 0;
    let brake = 0;
    if (err >= -1) {
      throttle = clamp(0.25 + err * params.throttleGain, 0, 1);
    } else if (speed > 1.5) {
      brake = clamp(-err * params.brakeGain, 0, 1);
    }

    // Stuck recovery: crawling while the target is still far -> back out with
    // opposite lock for a moment, then try again.
    if (reversingFor > 0) {
      reversingFor--;
      throttle = 0;
      brake = 1;
      steer = reverseSteer;
    } else if (speed < params.stuckSpeedMs && dist > params.standoffM * 2) {
      stuckFor++;
      if (stuckFor >= params.stuckTicks) {
        stuckFor = 0;
        reversingFor = params.reverseTicks;
        reverseSteer = steer >= 0 ? -1 : 1;
      }
    } else {
      stuckFor = 0;
    }

    // Sideways block: a blocker that has pulled ahead into the player's line while
    // the player is closing on it lifts, pulls the handbrake and swings its nose
    // across the road, then sits broadside on the brakes. Committed until the
    // player is past it, has stopped, or has dropped well back.
    const ownRel = wrapAngle(obs.headingRad - Math.atan2(fwdZ, fwdX));
    if (sliding) {
      if (!blocker || carAlong < 0 || tSpeed < 3 || carAlong > params.slideMaxAlongM + 15) {
        sliding = false;
      }
    } else if (
      blocker &&
      tSpeed > 5 &&
      tSpeed - speed > 1 &&
      carAlong > params.slideMinAlongM &&
      carAlong < params.slideMaxAlongM &&
      Math.abs(carLat) < params.slideLaneM
    ) {
      sliding = true;
      slideSide = Math.abs(ownRel) > 0.05 ? Math.sign(ownRel) : carLat >= 0 ? 1 : -1;
    }
    let handbrake = false;
    if (sliding) {
      const relErr = slideSide * (Math.PI / 2) - ownRel;
      throttle = 0;
      if (Math.abs(relErr) > 0.3) {
        steer = clamp(relErr * 2, -1, 1);
        brake = 0;
        handbrake = true;
      } else {
        steer = 0;
        brake = 1;
      }
    }

    cachedTick = tick;
    frame = Object.freeze({ steer, throttle, brake, handbrake });
    debug = Object.freeze({
      lineIndex: 0,
      targetIndex: 0,
      targetX: aimX,
      targetZ: aimZ,
      targetSpeedMs: desired,
      lookAheadM,
      frame,
    });
  }

  return {
    observe(o: AiObservation): void {
      obs = o;
    },
    setTarget(t: PursuitTarget): void {
      target = t;
    },
    reseed(): void {
      stuckFor = 0;
      reversingFor = 0;
      sliding = false;
    },
    sampleForTick(tick: number): InputFrame {
      if (cachedTick !== tick) compute(tick);
      return frame;
    },
    debug(): AiDriverDebug {
      return debug;
    },
  };
}
