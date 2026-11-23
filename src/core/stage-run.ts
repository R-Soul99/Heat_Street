import { forwardFromYaw } from "./heading";
import { RESPAWN_PENALTY_SEC } from "./medal-timing";

export const FINISH_GATE_ID = "finish";
export const STAGE_RESPAWN_CLEARANCE_M = 0.6;
/** Height window around the terrain at the crossing point (brief D4: 12 m tall gate box). */
export const GATE_BELOW_M = 2;
export const GATE_ABOVE_M = 12;

export interface StageRunPoint {
  readonly x: number;
  readonly z: number;
  readonly headingRad: number;
}

export interface StageRunGate extends StageRunPoint {
  readonly id: string;
  readonly widthM: number;
}

export interface StageRunCourse {
  readonly start: StageRunPoint;
  readonly gates: readonly StageRunGate[];
  readonly finish: StageRunPoint & { readonly widthM: number };
}

export interface StageRunInput {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly vx: number;
  readonly vz: number;
}

export interface StageRunUpdate {
  readonly passedGateId?: string;
  readonly finished?: boolean;
}

export interface StageRunSnapshot {
  /** 0..gates.length; gates.length means the finish is next. */
  readonly nextGateIndex: number;
  readonly gatesPassed: number;
  readonly complete: boolean;
  readonly penaltySec: number;
  readonly lastPassed: (StageRunPoint & { readonly id: string }) | null;
  readonly targetPosition: { readonly x: number; readonly z: number } | null;
  readonly targetId: string | null;
}

export type StageSplitTone = "faster" | "slower" | "neutral";

export interface StageRunPose {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly headingRad: number;
}

export interface StageRun {
  snapshot(): StageRunSnapshot;
  update(input: StageRunInput): StageRunUpdate;
  reset(): void;
  respawn(): void;
  respawnPose(heightAt: (x: number, z: number) => number): StageRunPose;
  startPose(heightAt: (x: number, z: number) => number): StageRunPose;
}

/**
 * Stateless plane-crossing test. The car must go from behind the gate plane to
 * at/in front of it, within the gate width at the interpolated crossing point,
 * and (when velocity is given) be moving forward. Sliding sideways still counts.
 */
export function crossedGateForward(
  gate: { x: number; z: number; headingRad: number; widthM: number },
  prev: { x: number; z: number },
  cur: { x: number; z: number },
  velocity?: { vx: number; vz: number },
): boolean {
  const f = forwardFromYaw(gate.headingRad);
  const rx = Math.cos(gate.headingRad);
  const rz = -Math.sin(gate.headingRad);
  const sp = (prev.x - gate.x) * f.x + (prev.z - gate.z) * f.z;
  const sc = (cur.x - gate.x) * f.x + (cur.z - gate.z) * f.z;
  if (!(sp < 0 && sc >= 0)) return false;
  if (velocity !== undefined && !(velocity.vx * f.x + velocity.vz * f.z > 0)) return false;
  const t = sp / (sp - sc);
  const px = prev.x + (cur.x - prev.x) * t;
  const pz = prev.z + (cur.z - prev.z) * t;
  return Math.abs((px - gate.x) * rx + (pz - gate.z) * rz) <= gate.widthM / 2;
}

export function createStageRun(
  course: StageRunCourse,
  heightAt?: (x: number, z: number) => number,
): StageRun {
  let nextGateIndex = 0;
  let complete = false;
  let penaltySec = 0;
  let prev: { x: number; z: number } | null = null;

  function lastPassed(): (StageRunPoint & { id: string }) | null {
    if (nextGateIndex === 0) return null;
    const gate = course.gates[nextGateIndex - 1];
    return gate === undefined
      ? null
      : { id: gate.id, x: gate.x, z: gate.z, headingRad: gate.headingRad };
  }

  function snapshot(): StageRunSnapshot {
    const gate = course.gates[nextGateIndex];
    let targetPosition: { x: number; z: number } | null = null;
    let targetId: string | null = null;
    if (!complete) {
      if (gate !== undefined) {
        targetPosition = { x: gate.x, z: gate.z };
        targetId = gate.id;
      } else {
        targetPosition = { x: course.finish.x, z: course.finish.z };
        targetId = FINISH_GATE_ID;
      }
    }
    return Object.freeze({
      nextGateIndex,
      gatesPassed: nextGateIndex,
      complete,
      penaltySec,
      lastPassed: lastPassed(),
      targetPosition: targetPosition === null ? null : Object.freeze(targetPosition),
      targetId,
    });
  }

  function update(input: StageRunInput): StageRunUpdate {
    const cur = { x: input.x, z: input.z };
    const before = prev;
    prev = cur;
    if (complete || before === null) return {};
    const gate = course.gates[nextGateIndex];
    const target = gate ?? course.finish;
    if (!crossedGateForward(target, before, cur, { vx: input.vx, vz: input.vz })) return {};
    if (heightAt !== undefined) {
      const ground = heightAt(cur.x, cur.z);
      if (input.y < ground - GATE_BELOW_M || input.y > ground + GATE_ABOVE_M) return {};
    }
    if (gate !== undefined) {
      nextGateIndex++;
      return { passedGateId: gate.id };
    }
    complete = true;
    return { finished: true };
  }

  function reset(): void {
    nextGateIndex = 0;
    complete = false;
    penaltySec = 0;
    prev = null;
  }

  function respawn(): void {
    penaltySec += RESPAWN_PENALTY_SEC;
    prev = null;
  }

  function poseAt(point: StageRunPoint, sampler: (x: number, z: number) => number): StageRunPose {
    return {
      x: point.x,
      y: sampler(point.x, point.z) + STAGE_RESPAWN_CLEARANCE_M,
      z: point.z,
      headingRad: point.headingRad,
    };
  }

  return {
    snapshot,
    update,
    reset,
    respawn,
    respawnPose: (sampler) => poseAt(lastPassed() ?? course.start, sampler),
    startPose: (sampler) => poseAt(course.start, sampler),
  };
}

/** "mm:ss.cc"; "--:--.--" for non-finite or negative input. */
export function formatStageTime(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return "--:--.--";
  const totalCs = Math.round(sec * 100);
  const cs = totalCs % 100;
  const totalSec = Math.floor(totalCs / 100);
  const s = totalSec % 60;
  const m = Math.floor(totalSec / 60);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(m)}:${pad(s)}.${pad(cs)}`;
}

export function stageSplitLine(
  label: string,
  cumulativeSec: number,
  bestCumulativeSec: number | undefined,
): { text: string; tone: StageSplitTone } {
  const base = `${label}  ${formatStageTime(cumulativeSec)}`;
  if (bestCumulativeSec === undefined || !Number.isFinite(bestCumulativeSec)) {
    return { text: base, tone: "neutral" };
  }
  const delta = cumulativeSec - bestCumulativeSec;
  const sign = delta < 0 ? "-" : "+";
  const tone: StageSplitTone = delta < 0 ? "faster" : delta > 0 ? "slower" : "neutral";
  return { text: `${base}  (${sign}${Math.abs(delta).toFixed(1)})`, tone };
}
