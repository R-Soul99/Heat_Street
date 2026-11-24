// Pure stage-draft operations (Phase 10, D-09). No DOM, no three. Every function
// returns a new array and never mutates its input or the elements in it (undo
// snapshots share element objects). No-ops return the SAME list reference.

import { yawFromTravelDirection } from "../../src/core/heading.ts";
import {
  GATE_WIDTH_MAX_M,
  GATE_WIDTH_MIN_M,
  MAX_GATES,
  MAX_STAGE_NAME_LENGTH,
  MAX_STAGES,
  type StageDraft,
  type StageGate,
  type StageStart,
} from "../../src/core/stage.ts";

export type StageList = readonly StageDraft[];

export const STAGE_GATE_SPACING_WARN_M = 600;
/** Items closer than this give no usable travel direction. */
export const AIM_MIN_M = 1;
/** An auto gate never turns further than this from the line the car arrives on. */
export const AIM_MAX_TURN_RAD = Math.PI / 4;

const STAGE_ID = /^stage-(\d+)$/;
const GATE_ID = /^g(\d+)$/;

function seedOf(ids: readonly string[], pattern: RegExp): number {
  let max = 0;
  for (const id of ids) {
    const m = pattern.exec(id);
    if (!m) continue;
    const n = Number(m[1]);
    if (Number.isFinite(n) && n > max) max = n;
  }
  return max + 1;
}

/** Next stage id counter: max numeric suffix + 1. Lives in editor state, never in the file. */
export function stageIdSeed(list: StageList): number {
  return seedOf(
    list.map((s) => s.id),
    STAGE_ID,
  );
}

/** Next gate id counter within one stage. */
export function gateIdSeed(draft: StageDraft): number {
  return seedOf(
    draft.gates.map((g) => g.id),
    GATE_ID,
  );
}

export type NewStageResult =
  | { list: StageDraft[]; id: string; nextSeed: number; error?: undefined }
  | { error: string; list?: undefined; id?: undefined; nextSeed?: undefined };

export type AddGateResult =
  | { list: StageDraft[]; gateId: string; nextSeed: number; error?: undefined }
  | { error: string; list?: undefined; gateId?: undefined; nextSeed?: undefined };

function clampWidth(widthM: number): number {
  return Math.min(GATE_WIDTH_MAX_M, Math.max(GATE_WIDTH_MIN_M, widthM));
}

function wrapAngle(rad: number): number {
  return Math.atan2(Math.sin(rad), Math.cos(rad));
}

interface AimPoint {
  readonly x: number;
  readonly z: number;
}

function travelYaw(from: AimPoint, to: AimPoint): number | null {
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  return Math.hypot(dx, dz) >= AIM_MIN_M ? yawFromTravelDirection(dx, dz) : null;
}

/**
 * Yaw of a gate on the route: half way between arriving and leaving, at most
 * AIM_MAX_TURN_RAD from the arriving line so a hairpin gate is never edge-on.
 */
export function autoHeading(
  prev: AimPoint & { headingRad: number },
  item: AimPoint,
  next: AimPoint | null,
): number {
  const arrive = travelYaw(prev, item) ?? prev.headingRad;
  const leave = next === null ? null : travelYaw(item, next);
  if (leave === null) return arrive;
  const half = wrapAngle(leave - arrive) / 2;
  return wrapAngle(arrive + Math.max(-AIM_MAX_TURN_RAD, Math.min(AIM_MAX_TURN_RAD, half)));
}

/** Aims every gate and finish without a hand-set heading along the route. */
export function aimAlongRoute(draft: StageDraft): StageDraft {
  let prev: AimPoint & { headingRad: number } = draft.start;
  const aim = <T extends AimPoint & { headingRad: number; headingManual?: true }>(
    item: T,
    next: AimPoint | null,
  ): T => {
    const h = item.headingManual ? item.headingRad : autoHeading(prev, item, next);
    const aimed =
      Math.abs(wrapAngle(h - item.headingRad)) < 1e-9 ? item : { ...item, headingRad: h };
    prev = aimed;
    return aimed;
  };
  const gates = draft.gates.map((g, i) => aim(g, draft.gates[i + 1] ?? draft.finish));
  const finish = draft.finish === null ? null : aim(draft.finish, null);
  return { ...draft, gates, finish };
}

export function newStage(
  list: StageList,
  seed: number,
  start: StageStart,
  name?: string,
): NewStageResult {
  if (list.length >= MAX_STAGES) {
    return { error: `A map can have at most ${MAX_STAGES} stages` };
  }
  const draft: StageDraft = {
    id: `stage-${seed}`,
    name: name ?? `Stage ${seed}`,
    start: { x: start.x, z: start.z, headingRad: start.headingRad },
    gates: [],
    finish: null,
  };
  return { list: [...list, draft], id: draft.id, nextSeed: seed + 1 };
}

function replaceStage(
  list: StageList,
  stageId: string,
  edit: (draft: StageDraft) => StageDraft | null,
): StageList {
  const i = list.findIndex((s) => s.id === stageId);
  if (i < 0) return list;
  const next = edit(list[i]);
  if (next === null || next === list[i]) return list;
  const moved =
    next.start !== list[i].start || next.gates !== list[i].gates || next.finish !== list[i].finish;
  const aimed = moved ? aimAlongRoute(next) : next;
  return list.map((s, k) => (k === i ? aimed : s));
}

export function insertGate(
  list: StageList,
  stageId: string,
  index: number,
  seed: number,
  gate: { x: number; z: number; widthM: number },
): AddGateResult {
  const i = list.findIndex((s) => s.id === stageId);
  if (i < 0) return { error: "Stage not found" };
  const draft = list[i];
  if (draft.gates.length >= MAX_GATES) {
    return { error: `A stage can have at most ${MAX_GATES} gates` };
  }
  const entry: StageGate = {
    id: `g${seed}`,
    x: gate.x,
    z: gate.z,
    headingRad: 0, // aimed along the route below
    widthM: clampWidth(gate.widthM),
  };
  const at = Math.min(draft.gates.length, Math.max(0, index));
  const gates = [...draft.gates.slice(0, at), entry, ...draft.gates.slice(at)];
  return {
    list: list.map((s, k) => (k === i ? aimAlongRoute({ ...s, gates }) : s)),
    gateId: entry.id,
    nextSeed: seed + 1,
  };
}

export function addGate(
  list: StageList,
  stageId: string,
  seed: number,
  gate: { x: number; z: number; widthM: number },
): AddGateResult {
  const draft = list.find((s) => s.id === stageId);
  return insertGate(list, stageId, draft ? draft.gates.length : 0, seed, gate);
}

export function moveStageItem(
  list: StageList,
  stageId: string,
  ref: string,
  x: number,
  z: number,
): StageList {
  return replaceStage(list, stageId, (d) => {
    if (ref === "start") return { ...d, start: { ...d.start, x, z } };
    if (ref === "finish") return d.finish === null ? null : { ...d, finish: { ...d.finish, x, z } };
    const g = d.gates.findIndex((gate) => gate.id === ref);
    if (g < 0) return null;
    return { ...d, gates: d.gates.map((gate, k) => (k === g ? { ...gate, x, z } : gate)) };
  });
}

/** Sets a heading by hand; a gate or finish then stops following the route (see autoAimStageItem). */
export function turnStageItem(
  list: StageList,
  stageId: string,
  ref: string,
  headingRad: number,
): StageList {
  return replaceStage(list, stageId, (d) => {
    if (ref === "start") return { ...d, start: { ...d.start, headingRad } };
    if (ref === "finish")
      return d.finish === null
        ? null
        : { ...d, finish: { ...d.finish, headingRad, headingManual: true } };
    const g = d.gates.findIndex((gate) => gate.id === ref);
    if (g < 0) return null;
    return {
      ...d,
      gates: d.gates.map((gate, k) =>
        k === g ? { ...gate, headingRad, headingManual: true } : gate,
      ),
    };
  });
}

/** Back to following the route; a no-op for the start and for items already doing so. */
export function autoAimStageItem(list: StageList, stageId: string, ref: string): StageList {
  return replaceStage(list, stageId, (d) => {
    if (ref === "finish") {
      if (!d.finish?.headingManual) return null;
      const { headingManual: _, ...finish } = d.finish;
      return { ...d, finish };
    }
    if (!d.gates.some((g) => g.id === ref && g.headingManual)) return null;
    return {
      ...d,
      gates: d.gates.map((gate) => {
        if (gate.id !== ref) return gate;
        const { headingManual: _, ...rest } = gate;
        return rest;
      }),
    };
  });
}

/** The start has no width: same reference. */
export function setStageItemWidth(
  list: StageList,
  stageId: string,
  ref: string,
  widthM: number,
): StageList {
  const w = clampWidth(widthM);
  return replaceStage(list, stageId, (d) => {
    if (ref === "start") return null;
    if (ref === "finish")
      return d.finish === null ? null : { ...d, finish: { ...d.finish, widthM: w } };
    const g = d.gates.findIndex((gate) => gate.id === ref);
    if (g < 0) return null;
    return { ...d, gates: d.gates.map((gate, k) => (k === g ? { ...gate, widthM: w } : gate)) };
  });
}

export function moveGateOrder(
  list: StageList,
  stageId: string,
  gateId: string,
  delta: -1 | 1,
): StageList {
  return replaceStage(list, stageId, (d) => {
    const g = d.gates.findIndex((gate) => gate.id === gateId);
    const t = g + delta;
    if (g < 0 || t < 0 || t >= d.gates.length) return null;
    const gates = [...d.gates];
    gates[g] = d.gates[t];
    gates[t] = d.gates[g];
    return { ...d, gates };
  });
}

export function deleteGate(list: StageList, stageId: string, gateId: string): StageList {
  return replaceStage(list, stageId, (d) => {
    if (!d.gates.some((g) => g.id === gateId)) return null;
    return { ...d, gates: d.gates.filter((g) => g.id !== gateId) };
  });
}

export function setStageFinish(
  list: StageList,
  stageId: string,
  finish: { x: number; z: number; widthM: number },
): StageList {
  return replaceStage(list, stageId, (d) => ({
    ...d,
    finish: {
      x: finish.x,
      z: finish.z,
      headingRad: 0, // aimed along the route by replaceStage
      widthM: clampWidth(finish.widthM),
    },
  }));
}

export function clearStageFinish(list: StageList, stageId: string): StageList {
  return replaceStage(list, stageId, (d) => (d.finish === null ? null : { ...d, finish: null }));
}

/** Removes the finish if set, else the last gate, else the stage itself. */
export function deleteLastStageItem(list: StageList, stageId: string): StageList {
  const i = list.findIndex((s) => s.id === stageId);
  if (i < 0) return list;
  const d = list[i];
  if (d.finish !== null) return clearStageFinish(list, stageId) as StageDraft[];
  if (d.gates.length > 0)
    return replaceStage(list, stageId, (s) => ({
      ...s,
      gates: s.gates.slice(0, -1),
    })) as StageDraft[];
  return list.filter((_, k) => k !== i);
}

/** Trims; empty or over-long names are rejected (same reference). */
export function renameStage(list: StageList, stageId: string, name: string): StageList {
  const trimmed = name.trim();
  if (trimmed.length < 1 || trimmed.length > MAX_STAGE_NAME_LENGTH) return list;
  return replaceStage(list, stageId, (d) => (d.name === trimmed ? null : { ...d, name: trimmed }));
}

export function deleteStage(list: StageList, stageId: string): StageList {
  if (!list.some((s) => s.id === stageId)) return list;
  return list.filter((s) => s.id !== stageId);
}

export interface StageItemRow {
  readonly ref: string;
  readonly label: string;
  readonly number: number;
}

export function stageItemRows(draft: StageDraft): StageItemRow[] {
  const rows: StageItemRow[] = [{ ref: "start", label: "Start", number: 1 }];
  draft.gates.forEach((g, i) => {
    rows.push({ ref: g.id, label: `Gate ${i + 1}`, number: i + 2 });
  });
  if (draft.finish !== null) {
    rows.push({ ref: "finish", label: "Finish", number: draft.gates.length + 2 });
  }
  return rows;
}

function orderedPoints(draft: StageDraft): { x: number; z: number }[] {
  const pts: { x: number; z: number }[] = [draft.start, ...draft.gates];
  if (draft.finish !== null) pts.push(draft.finish);
  return pts;
}

export function stageLengthM(draft: StageDraft): number {
  const pts = orderedPoints(draft);
  let total = 0;
  for (let i = 1; i < pts.length; i++) {
    total += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z);
  }
  return total;
}

export function stageWarnings(
  draft: StageDraft,
  slopeDegAt: (x: number, z: number) => number,
  limitDeg: number,
): string[] {
  const out: string[] = [];
  const items: { label: string; x: number; z: number; headingRad: number }[] = draft.gates.map(
    (g, i) => ({ label: `Gate ${i + 1}`, x: g.x, z: g.z, headingRad: g.headingRad }),
  );
  if (draft.finish !== null) items.push({ label: "Finish", ...draft.finish });
  let prev: { x: number; z: number } = draft.start;
  for (const item of items) {
    const d = Math.hypot(item.x - prev.x, item.z - prev.z);
    if (d > STAGE_GATE_SPACING_WARN_M) {
      out.push(`${item.label} is ${Math.round(d)} m from the previous gate`);
    }
    const arrive = travelYaw(prev, item);
    if (arrive !== null && Math.cos(item.headingRad - arrive) < 0) {
      out.push(`${item.label} faces against the route`);
    }
    if (slopeDegAt(item.x, item.z) > limitDeg) {
      out.push(`${item.label} sits on a steep slope`);
    }
    prev = item;
  }
  return out;
}
