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
  /** How far ahead of the player a blocker holds once in its line, m. */
  readonly blockHoldM: number;
  /** Beside or just ahead of the player and within this lateral distance, a blocker rams, m. */
  readonly ramLaneM: number;
  /** "That bloke": extra top speed multiplier on top of the usual edge. */
  readonly blokeSpeedEdge: number;
  /** "That bloke" aims this many seconds ahead of the player. */
  readonly blokeLeadSec: number;
  /** ...and this many metres beyond that point along the player's travel, so he drives THROUGH it, m. */
  readonly blokeAimThroughM: number;
  /** Scales his steering look-ahead: small = sharp snap onto the aim point, large = wide lazy arcs. */
  readonly blokeLookAheadScale: number;
  /** How much he lifts for a heading error: 0 = never (flat out), 1 = like everyone else. */
  readonly blokeCornerEase: number;
  /** Heading error beyond which he slows to turn round, degrees. */
  readonly blokeTurnRoundDeg: number;
  /** ...and the speed he slows to, m/s. */
  readonly blokeTurnRoundSpeedMs: number;
  /** Extra catch-up speed fraction when far behind, on top of everyone's. */
  readonly blokeCatchupEdge: number;
  /** Top speed and engine force multiplier every pursuer always has. */
  readonly speedEdge: number;
  /** Speed over the player the rammer runs in at, m/s. */
  readonly tailRamOverspeedMs: number;
  /** Rammer falls back to line up this far behind, m. */
  readonly tailFallbackAimM: number;
  /** Rammer stays in fall-back until this far behind, m. */
  readonly tailRegainM: number;
  /** Minimum ticks the rammer falls back after a hit. */
  readonly tailLiftTicks: number;
  /** Speed below the player the rammer asks for while falling back, m/s. */
  readonly tailLiftSlowdownMs: number;
  /** Rammer this far off the player heading and close in is side-on and backs out, rad. */
  readonly tailSideOnRad: number;
  /** Centre-to-centre distance that counts as a hit, m. */
  readonly hitDistM: number;
  /** Speed over the player a pitter closes on the quarter with, m/s. */
  readonly pitOverspeedMs: number;
  /** PIT contact point: metres behind the player centre. */
  readonly pitQuarterBackM: number;
  /** PIT contact point: metres out to the side. */
  readonly pitQuarterOutM: number;
  /** PIT waiting point: metres behind. */
  readonly pitApproachBackM: number;
  /** PIT waiting point: metres out. */
  readonly pitApproachOutM: number;
  /** Ticks a pitter backs off to its station after a hit. */
  readonly pitBackoffTicks: number;
  /** Extra top speed fraction at full catch-up. */
  readonly catchupEdge: number;
  /** Catch-up starts to bite beyond this distance, m. */
  readonly catchupStartM: number;
  /** Catch-up is full at this distance, m. */
  readonly catchupFullM: number;
  /** Extra speed over the player a far-behind car may ask for, m/s. */
  readonly catchupOverspeedMs: number;
  /** Speed a car slows to while its nose points well away from where it wants to go, m/s. */
  readonly turnSpeedMs: number;
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
    // Handbrake slide-block off: it cleared the lane instead of filling it. Blockers brake-check and ram.
    slideMinAlongM: Number.POSITIVE_INFINITY,
    slideMaxAlongM: 14,
    slideLaneM: 4,
    blockHoldM: BLOCK_HOLD_M,
    ramLaneM: RAM_LANE_M,
    blokeSpeedEdge: 1.1,
    blokeLeadSec: 0.6,
    blokeAimThroughM: 0,
    blokeLookAheadScale: 1,
    blokeCornerEase: 0,
    blokeTurnRoundDeg: 100,
    blokeTurnRoundSpeedMs: 16,
    blokeCatchupEdge: 0,
    speedEdge: BLOCKER_SPEED_EDGE,
    tailRamOverspeedMs: TAIL_RAM_OVERSPEED_MS,
    tailFallbackAimM: TAIL_FALLBACK_AIM_M,
    tailRegainM: TAIL_REGAIN_M,
    tailLiftTicks: TAIL_LIFT_TICKS,
    tailLiftSlowdownMs: TAIL_LIFT_SLOWDOWN_MS,
    tailSideOnRad: TAIL_SIDEON_RAD,
    hitDistM: TAIL_HIT_M,
    pitOverspeedMs: PIT_OVERSPEED_MS,
    pitQuarterBackM: PIT_QUARTER_BACK_M,
    pitQuarterOutM: PIT_QUARTER_OUT_M,
    pitApproachBackM: PIT_APPROACH_BACK_M,
    pitApproachOutM: PIT_APPROACH_OUT_M,
    pitBackoffTicks: TAIL_BACKOFF_TICKS,
    catchupEdge: CATCHUP_EDGE,
    catchupStartM: CATCHUP_START_M,
    catchupFullM: CATCHUP_FULL_M,
    catchupOverspeedMs: CATCHUP_OVERSPEED_MS,
    turnSpeedMs: TURN_SPEED_MS,
  };
}

/** Where on the player this pursuer wants to be: metres to the player's right and ahead of it (negative = left / behind). */
export interface FlankSlot {
  readonly lateralM: number;
  readonly alongM: number;
  /** "That bloke": the one full-speed rammer per swarm (index 5). Has no station. */
  readonly bloke?: true;
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
  const slot = {
    lateralM: base.lateralM * (1 + 0.6 * ring),
    alongM: base.alongM * (1 + 0.3 * ring) - 7 * ring,
  };
  return i === BLOKE_INDEX ? { ...slot, bloke: true } : slot;
}

/**
 * Top speed and engine force multiplier for blocker cars. Same top speed as the
 * player means a flat-out player is never overtaken, so a blocker never gets in
 * front of it; ~10% lets it creep ahead. Stays under `blockerMaxSpeedMs`.
 */
export const BLOCKER_SPEED_EDGE = 1.1;

/** Extra top speed a pursuer that has fallen far behind may borrow to rejoin (1 + this at full catch-up). */
const CATCHUP_EDGE = 0.25;
/** Speed a pursuer slows to while its nose is pointing well away from where it wants to go, m/s. */
const TURN_SPEED_MS = 16;
/** Catch-up starts to bite beyond this distance from the player, m, and is full at CATCHUP_FULL_M. */
const CATCHUP_START_M = 10;
const CATCHUP_FULL_M = 70;
/** A pursuer may ask for this much more than the player's speed, m/s, when catching up. */
const CATCHUP_OVERSPEED_MS = 8;

/** The tail car of each ring: directly behind the player, rams it from behind. */
export function isTailSlot(slot: FlankSlot): boolean {
  return slot.lateralM === 0 && slot.alongM <= 0;
}

/** Centre-to-centre distance at which a tail car counts as having hit the player's rear, m. */
const TAIL_HIT_M = 5.2;
/** After a hit a pitter drops back for this many ticks before coming in again. */
const TAIL_BACKOFF_TICKS = 70;
/** After a hit the rammer lifts off for this many ticks (still steering at the bumper) and asks for this much less than the player's speed. */
const TAIL_LIFT_TICKS = 40;
const TAIL_LIFT_SLOWDOWN_MS = 12;
/** After a hit the rammer stays in its fall-back (lined up straight behind, braking) until it is at least this far back, m. */
const TAIL_REGAIN_M = 10;
/** While falling back the rammer lines up this far straight behind the player, m. */
const TAIL_FALLBACK_AIM_M = 14;
/** Rammer more than this far off the player's heading and close in is side-on (a T-bone): it must back out, not push, rad. */
const TAIL_SIDEON_RAD = 0.8;
/** The rammer aims this far behind the player's centre, m (just inside its rear bumper). Never backs off on purpose: the collision does that. */
const TAIL_AIM_BACK_M = 1.2;
/** Speed over the player's the tail asks for on its run in, m/s. */
const TAIL_RAM_OVERSPEED_MS = 6;
/** PIT geometry, metres behind / out from the player's centre: the rear-quarter contact point and the waiting point. */
const PIT_QUARTER_BACK_M = 1.9;
const PIT_QUARTER_OUT_M = 0.95;
const PIT_APPROACH_BACK_M = 7;
const PIT_APPROACH_OUT_M = 3;
/** Speed over the player's a pitter closes on the quarter with, m/s. */
const PIT_OVERSPEED_MS = 3;

/** What a pursuer is doing right now. Blockers are fixed by slot; rammer / pitter are handed out each tick by `createRoleAssigner`. */
export type PursuerRole = "blocker" | "rammer" | "pitter" | "bloke";

/** Which pursuer index is "that bloke" (the 6th car, so `?pursuers=6` gets one). */
export const BLOKE_INDEX = 5;

export function isBlokeSlot(slot: FlankSlot): boolean {
  return slot.bloke === true;
}

export function initialRole(slot: FlankSlot): PursuerRole {
  return isBlokeSlot(slot)
    ? "bloke"
    : isBlockerSlot(slot)
      ? "blocker"
      : isTailSlot(slot)
        ? "rammer"
        : "pitter";
}

export function isBlockerSlot(slot: FlankSlot): boolean {
  return slot.alongM > 0;
}

export interface PursuerDriver extends AiDriver {
  /** Tell the driver where its target is this tick. */
  setTarget(target: PursuitTarget): void;
  /** Hand this car a role (ignored for blocker slots). Defaults to the role its slot implies. */
  setRole(role: PursuerRole): void;
  /** Top-speed / engine-force multiplier this car wants right now: grows the further it has fallen behind the player. */
  speedEdge(): number;
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** How far ahead of the player a blocker holds once it is in the player's line, m. */
const BLOCK_HOLD_M = 7;
/** Beside or just ahead of the player and within this lateral distance, a blocker rams instead of waiting to be passed. */
const RAM_LANE_M = 9;

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
  let tailBackoff = 0;
  let tailFalling = false;
  let role: PursuerRole = initialRole(slot);
  let edge = 1;
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
    const carAlong = (obs.x - target.x) * fwdX + (obs.z - target.z) * fwdZ;
    const carLat = (obs.x - target.x) * rightX + (obs.z - target.z) * rightZ;
    const blocker = isBlockerSlot(slot);
    // Rammer: lines up on the rear bumper and hits it. Pitter: drops back to a rear quarter
    // and hits that at an angle, to spin the player (PIT). Both back off after a hit.
    const bloke = isBlokeSlot(slot);
    const tail = !blocker && !bloke && role === "rammer";
    const flanker = !blocker && !bloke && role === "pitter";
    const sideOn =
      tail &&
      dist < 8 &&
      Math.abs(wrapAngle(obs.headingRad - Math.atan2(fwdZ, fwdX))) > params.tailSideOnRad &&
      Math.abs(wrapAngle(obs.headingRad - Math.atan2(fwdZ, fwdX))) < Math.PI - params.tailSideOnRad;
    if (tailBackoff > 0) tailBackoff--;
    else if ((flanker || tail) && dist < params.hitDistM && tSpeed > 3) {
      tailBackoff = tail ? params.tailLiftTicks : params.pitBackoffTicks;
    }
    if (tail && sideOn) tailBackoff = Math.max(tailBackoff, params.tailLiftTicks);
    // The rammer falls back until it has real room to run in again, not just for a fixed moment.
    if (tail && tailBackoff > 0) tailFalling = true;
    else if (!tail || dist >= params.tailRegainM) tailFalling = false;
    const tailFallback = tail && tailFalling;
    // Where this car waits between attacks. A car promoted from rammer to pitter has no
    // flank slot of its own, so it takes the side it is already on.
    const stLat = slot.lateralM !== 0 ? slot.lateralM : carLat >= 0 ? 7 : -7;
    const stAlong = Math.min(slot.alongM, blocker ? slot.alongM : 0);
    const pitSide = carLat >= 0 ? 1 : -1;
    const onStation = !tail && (stLat !== 0 || stAlong !== 0);

    // Blockers (stations ahead of the player) reach further ahead the faster the
    // player goes, run up the side, then swing across into the player's lane
    // once they are clear of its nose, and finally slow down in front of it.
    // Swing across into the player's line as soon as the blocker is level with it.
    const cut = blocker ? smoothstep(5, 15, carAlong) : 0;
    // Run well ahead to overtake, then tighten right up to the player once in its
    // line: a blocker cruising 50 m ahead at speed never gets near enough to block.
    const alongEff = blocker
      ? (slot.alongM + 0.8 * tSpeed) * (1 - cut) + params.blockHoldM * cut
      : stAlong;
    const lateralEff = (blocker ? slot.lateralM : stLat) * (1 - cut);

    const leadSec = clamp(dist / Math.max(speed, 6), 0, params.leadMaxSec);
    // Ramming: level with or just ahead of the player and close to its line, a blocker
    // that has not (or cannot) slide drives at the player's nose to shove it, not to
    // sit and wait for it to dodge past.
    const ramming =
      blocker && !sliding && carAlong > -2 && carAlong < 8 && Math.abs(carLat) < params.ramLaneM;
    // Tail: line up on the player's rear bumper (or, just after a hit, a few car lengths back).
    const tailBack = tailFallback ? params.tailFallbackAimM : TAIL_AIM_BACK_M;
    // PIT: stay out to the side and behind the rear quarter until level with it, then come
    // in at an angle onto the quarter itself.
    const pitting = flanker && tailBackoff === 0;
    const quarterT = smoothstep(-9, -4, carAlong);
    const pitBackM =
      params.pitQuarterBackM + (params.pitApproachBackM - params.pitQuarterBackM) * quarterT;
    const pitOutM =
      params.pitQuarterOutM + (params.pitApproachOutM - params.pitQuarterOutM) * quarterT;
    // That bloke: straight at where the player will be, no station, no tact.
    const aimX = bloke
      ? target.x + target.vx * params.blokeLeadSec + fwdX * params.blokeAimThroughM
      : tail
        ? target.x + target.vx * 0.15 - fwdX * tailBack
        : pitting
          ? target.x + target.vx * 0.12 - fwdX * pitBackM + rightX * pitSide * pitOutM
          : ramming
            ? target.x + target.vx * 0.2
            : target.x + target.vx * leadSec + rightX * lateralEff + fwdX * alongEff;
    const aimZ = bloke
      ? target.z + target.vz * params.blokeLeadSec + fwdZ * params.blokeAimThroughM
      : tail
        ? target.z + target.vz * 0.15 - fwdZ * tailBack
        : pitting
          ? target.z + target.vz * 0.12 - fwdZ * pitBackM + rightZ * pitSide * pitOutM
          : ramming
            ? target.z + target.vz * 0.2
            : target.z + target.vz * leadSec + rightZ * lateralEff + fwdZ * alongEff;
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

    const lookAheadScale = bloke ? params.blokeLookAheadScale : 1;
    const lookAheadM = clamp(Math.min(aimDist, Math.max(6, 0.9 * speed)) * lookAheadScale, 3, 40);
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
    // The rammer never swerves away: after a hit it just lifts off for a moment, so the
    // collision plus the lift opens a gap, and then it runs in at the bumper again.
    const closing = tail
      ? tailFallback
        ? -params.tailLiftSlowdownMs
        : dist * params.closeGain + params.tailRamOverspeedMs
      : pitting
        ? carAlong > -4
          ? -6
          : dist * params.closeGain + params.pitOverspeedMs
        : onStation
          ? stationAlong * params.closeGain
          : Math.max(0, dist - params.standoffM) * params.closeGain;
    // A blocker still getting ahead of the player hardly lifts for a heading error:
    // every swerve of the player used to cost it the ground it had gained.
    const turnFloor =
      blocker && carAlong < 18 ? Math.max(params.turnSpeedFloor, 0.75) : params.turnSpeedFloor;
    const turnScale = 1 - (1 - turnFloor) * clamp(Math.abs(alpha) / (Math.PI / 2), 0, 1);
    // Catch-up: the further behind the player, the more top speed it borrows, so a
    // flat-out player cannot simply outrun the pack. Blockers always keep their base edge.
    const catchUp = smoothstep(params.catchupStartM, params.catchupFullM, dist);
    edge = Math.max(params.speedEdge, 1 + params.catchupEdge * catchUp);
    if (bloke) {
      edge = Math.max(
        edge,
        params.speedEdge * params.blokeSpeedEdge,
        1 + (params.catchupEdge + params.blokeCatchupEdge) * catchUp,
      );
    }
    const baseCap = params.blockerMaxSpeedMs;
    const speedCap = Math.max(baseCap, targetSpeed + params.catchupOverspeedMs * catchUp);
    let desired = Math.max(0, Math.min(speedCap, (targetSpeed + closing) * turnScale));
    // That bloke never eases off for corners, gaps or the player: flat out at all times.
    // The only brake is turning round once he has gone past (otherwise he orbits forever).
    if (bloke) {
      const blokeCap = speedCap * params.blokeSpeedEdge;
      const turnRound = (params.blokeTurnRoundDeg * Math.PI) / 180;
      desired =
        Math.abs(alpha) > turnRound
          ? params.blokeTurnRoundSpeedMs
          : blokeCap *
            (1 - params.blokeCornerEase * clamp(Math.abs(alpha) / (Math.PI / 2), 0, 1) * 0.7);
    }
    // Turning round (large heading error) is limited by turning radius, whatever the
    // gap: a car at 50 m/s with its nose pointing away orbits the player at 100 m radius forever.
    if (!bloke && !(blocker && carAlong < 18)) {
      desired = Math.min(
        desired,
        speedCap + (params.turnSpeedMs - speedCap) * smoothstep(0.35, 1.4, Math.abs(alpha)),
      );
    }
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
    setRole(r: PursuerRole): void {
      if (!isBlockerSlot(slot) && !isBlokeSlot(slot)) role = r;
    },
    speedEdge(): number {
      return edge;
    },
    reseed(): void {
      stuckFor = 0;
      reversingFor = 0;
      sliding = false;
      tailBackoff = 0;
      tailFalling = false;
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
