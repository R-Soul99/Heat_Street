/**
 * Off-road stage file format (Phase 10, D-01/D-02): types, strict hand-rolled
 * parser, serializer, editor draft helpers and the explicit-threshold medal
 * classifier.
 *
 * `headingRad` everywhere in this file is YAW (VehiclePose convention,
 * forward = (-sin h, -cos h)); see `src/core/heading.ts`. No y coordinate is
 * ever stored: height comes from the terrain.
 *
 * Pure: no renderer, no physics engine, no DOM, no wall clock.
 */

import type { Medal } from "./medal-timing";
import type { TerrainExtent } from "./terrain-drive-setup";
import { MAX_COORD_ABS_M } from "./terrain-format";
import { KNOWN_VEHICLE_CLASS_IDS, type VehicleClassId } from "./vehicle-class";

export const STAGE_SCHEMA_VERSION = 1;
export const MAX_STAGES = 20;
export const MIN_GATES = 1;
export const MAX_GATES = 40;
export const GATE_WIDTH_MIN_M = 8;
export const GATE_WIDTH_MAX_M = 60;
export const DEFAULT_GATE_WIDTH_M = 20;
export const MAX_STAGE_NAME_LENGTH = 60;
export const STAGE_ID_PATTERN = /^[a-z0-9-]{1,40}$/;
export const STAGE_AREA_ID_PATTERN = /^[a-z0-9-]{1,64}$/;

export interface StageStart {
  readonly x: number;
  readonly z: number;
  readonly headingRad: number;
}

export interface StageGate {
  readonly id: string;
  readonly x: number;
  readonly z: number;
  readonly headingRad: number;
  readonly widthM: number;
}

export interface StageFinish {
  readonly x: number;
  readonly z: number;
  readonly headingRad: number;
  readonly widthM: number;
}

export interface StageMedals {
  readonly goldSec: number;
  readonly silverSec: number;
  readonly bronzeSec: number;
  readonly vehicle: VehicleClassId;
}

export interface Stage {
  readonly id: string;
  readonly name: string;
  readonly start: StageStart;
  readonly gates: readonly StageGate[];
  readonly finish: StageFinish;
  readonly medals?: StageMedals;
}

export interface StageData {
  readonly schemaVersion: 1;
  readonly areaId: string;
  readonly stages: readonly Stage[];
}

/** The editor's in-progress shape (finish may be unplaced, gates may be empty). */
export interface StageDraft {
  readonly id: string;
  readonly name: string;
  readonly start: StageStart;
  readonly gates: readonly StageGate[];
  readonly finish: StageFinish | null;
  readonly medals?: StageMedals;
}

/** Consumed by the race HUD. */
export interface StageHudModel {
  readonly name: string;
  readonly bestSec: number | null;
  readonly medals: StageMedals | null;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function fail(label: string, message: string): never {
  throw new Error(`parseStageData: ${label}: ${message}`);
}

function required(
  label: string,
  object: Record<string, unknown>,
  key: string,
  context: string,
): unknown {
  if (!Object.hasOwn(object, key)) fail(label, `${context} missing required key "${key}"`);
  return object[key];
}

function objectField(
  label: string,
  object: Record<string, unknown>,
  key: string,
  context: string,
): Record<string, unknown> {
  const value = required(label, object, key, context);
  if (!isObject(value)) fail(label, `${context}.${key} must be an object`);
  return value;
}

function stringField(
  label: string,
  object: Record<string, unknown>,
  key: string,
  context: string,
): string {
  const value = required(label, object, key, context);
  if (typeof value !== "string") fail(label, `${context}.${key} must be a string`);
  return value;
}

function finiteNumber(
  label: string,
  object: Record<string, unknown>,
  key: string,
  context: string,
): number {
  const value = required(label, object, key, context);
  if (typeof value !== "number" || !Number.isFinite(value))
    fail(label, `${context}.${key} must be a finite number`);
  return value;
}

function integer(
  label: string,
  object: Record<string, unknown>,
  key: string,
  context: string,
): number {
  const value = finiteNumber(label, object, key, context);
  if (!Number.isInteger(value)) fail(label, `${context}.${key} must be an integer`);
  return value;
}

function coordinate(
  label: string,
  object: Record<string, unknown>,
  key: "x" | "z",
  context: string,
  min: number,
  max: number,
): number {
  const value = finiteNumber(label, object, key, context);
  if (Math.abs(value) > MAX_COORD_ABS_M)
    fail(label, `${context}.${key} out of range, got ${value}`);
  if (value < min || value > max)
    fail(label, `${context}.${key} is outside the terrain extent, got ${value}`);
  return value;
}

function width(label: string, object: Record<string, unknown>, context: string): number {
  const value = finiteNumber(label, object, "widthM", context);
  if (value < GATE_WIDTH_MIN_M || value > GATE_WIDTH_MAX_M)
    fail(
      label,
      `${context}.widthM must be within ${GATE_WIDTH_MIN_M}..${GATE_WIDTH_MAX_M}, got ${value}`,
    );
  return value;
}

function parseStart(
  label: string,
  raw: Record<string, unknown>,
  context: string,
  extent: TerrainExtent,
): StageStart {
  return {
    x: coordinate(label, raw, "x", context, extent.minX, extent.maxX),
    z: coordinate(label, raw, "z", context, extent.minZ, extent.maxZ),
    headingRad: finiteNumber(label, raw, "headingRad", context),
  };
}

function parseGate(
  label: string,
  raw: unknown,
  context: string,
  extent: TerrainExtent,
  ids: Set<string>,
): StageGate {
  if (!isObject(raw)) fail(label, `${context} must be an object`);
  const id = stringField(label, raw, "id", context);
  if (!STAGE_ID_PATTERN.test(id)) fail(label, `${context}.id "${id}" is not a valid id`);
  if (ids.has(id)) fail(label, `${context} duplicate gate id "${id}"`);
  ids.add(id);
  return {
    id,
    x: coordinate(label, raw, "x", context, extent.minX, extent.maxX),
    z: coordinate(label, raw, "z", context, extent.minZ, extent.maxZ),
    headingRad: finiteNumber(label, raw, "headingRad", context),
    widthM: width(label, raw, context),
  };
}

function parseMedals(label: string, raw: unknown, context: string): StageMedals {
  if (!isObject(raw)) fail(label, `${context} must be an object`);
  const goldSec = finiteNumber(label, raw, "goldSec", context);
  const silverSec = finiteNumber(label, raw, "silverSec", context);
  const bronzeSec = finiteNumber(label, raw, "bronzeSec", context);
  if (goldSec <= 0 || silverSec <= 0 || bronzeSec <= 0)
    fail(label, `${context} medal times must be positive`);
  if (!(goldSec < silverSec && silverSec < bronzeSec))
    fail(label, `${context} medals must satisfy gold < silver < bronze`);
  const vehicleRaw = required(label, raw, "vehicle", context);
  const vehicle = KNOWN_VEHICLE_CLASS_IDS.find((id) => id === vehicleRaw);
  if (vehicle === undefined) fail(label, `${context}.vehicle is not a known vehicle class`);
  return { goldSec, silverSec, bronzeSec, vehicle };
}

function parseStage(
  label: string,
  raw: unknown,
  index: number,
  extent: TerrainExtent,
  stageIds: Set<string>,
): Stage {
  const context = `stages[${index}]`;
  if (!isObject(raw)) fail(label, `${context} must be an object`);
  const id = stringField(label, raw, "id", context);
  if (!STAGE_ID_PATTERN.test(id)) fail(label, `${context}.id "${id}" is not a valid id`);
  if (stageIds.has(id)) fail(label, `duplicate stage id "${id}"`);
  stageIds.add(id);
  const name = stringField(label, raw, "name", context).trim();
  if (name.length < 1 || name.length > MAX_STAGE_NAME_LENGTH)
    fail(label, `${context}.name must be 1..${MAX_STAGE_NAME_LENGTH} characters`);
  const start = parseStart(
    label,
    objectField(label, raw, "start", context),
    `${context}.start`,
    extent,
  );
  const gatesRaw = required(label, raw, "gates", context);
  if (!Array.isArray(gatesRaw)) fail(label, `${context}.gates must be an array`);
  if (gatesRaw.length < MIN_GATES || gatesRaw.length > MAX_GATES)
    fail(label, `${context}.gates must have ${MIN_GATES}..${MAX_GATES} gates`);
  const gateIds = new Set<string>();
  const gates = gatesRaw.map((g, i) =>
    parseGate(label, g, `${context}.gates[${i}]`, extent, gateIds),
  );
  const finishRaw = objectField(label, raw, "finish", context);
  const finishContext = `${context}.finish`;
  const finish: StageFinish = {
    x: coordinate(label, finishRaw, "x", finishContext, extent.minX, extent.maxX),
    z: coordinate(label, finishRaw, "z", finishContext, extent.minZ, extent.maxZ),
    headingRad: finiteNumber(label, finishRaw, "headingRad", finishContext),
    widthM: width(label, finishRaw, finishContext),
  };
  if (Object.hasOwn(raw, "medals") && raw.medals !== undefined) {
    return {
      id,
      name,
      start,
      gates,
      finish,
      medals: parseMedals(label, raw.medals, `${context}.medals`),
    };
  }
  return { id, name, start, gates, finish };
}

export function parseStageData(raw: string, sourceLabel: string, extent: TerrainExtent): StageData {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return fail(sourceLabel, "not valid JSON");
  }
  if (!isObject(parsed)) fail(sourceLabel, "root must be an object");
  const version = integer(sourceLabel, parsed, "schemaVersion", "root");
  if (version !== STAGE_SCHEMA_VERSION)
    fail(sourceLabel, `unsupported schemaVersion ${version}, expected ${STAGE_SCHEMA_VERSION}`);
  const areaId = stringField(sourceLabel, parsed, "areaId", "root");
  if (!STAGE_AREA_ID_PATTERN.test(areaId)) fail(sourceLabel, `areaId "${areaId}" is not valid`);
  const stagesRaw = required(sourceLabel, parsed, "stages", "root");
  if (!Array.isArray(stagesRaw)) fail(sourceLabel, "stages must be an array");
  if (stagesRaw.length > MAX_STAGES) fail(sourceLabel, `at most ${MAX_STAGES} stages are allowed`);
  const stageIds = new Set<string>();
  const stages = stagesRaw.map((s, i) => parseStage(sourceLabel, s, i, extent, stageIds));
  return { schemaVersion: STAGE_SCHEMA_VERSION, areaId, stages };
}

export function serializeStageData(data: StageData): string {
  const out = {
    schemaVersion: data.schemaVersion,
    areaId: data.areaId,
    stages: data.stages.map((s) => ({
      id: s.id,
      name: s.name,
      start: { x: s.start.x, z: s.start.z, headingRad: s.start.headingRad },
      gates: s.gates.map((g) => ({
        id: g.id,
        x: g.x,
        z: g.z,
        headingRad: g.headingRad,
        widthM: g.widthM,
      })),
      finish: {
        x: s.finish.x,
        z: s.finish.z,
        headingRad: s.finish.headingRad,
        widthM: s.finish.widthM,
      },
      ...(s.medals === undefined
        ? {}
        : {
            medals: {
              goldSec: s.medals.goldSec,
              silverSec: s.medals.silverSec,
              bronzeSec: s.medals.bronzeSec,
              vehicle: s.medals.vehicle,
            },
          }),
    })),
  };
  return `${JSON.stringify(out, null, 2)}\n`;
}

/** Classifies against explicit thresholds; never returns "ace". */
export function classifyStageMedal(timeSec: number, medals: StageMedals | undefined): Medal {
  if (medals === undefined || !Number.isFinite(timeSec) || timeSec <= 0) return "none";
  if (timeSec <= medals.goldSec) return "gold";
  if (timeSec <= medals.silverSec) return "silver";
  if (timeSec <= medals.bronzeSec) return "bronze";
  return "none";
}

export function stageFromDraft(draft: StageDraft): Stage | null {
  if (draft.finish === null || draft.gates.length === 0) return null;
  const base = {
    id: draft.id,
    name: draft.name,
    start: draft.start,
    gates: draft.gates,
    finish: draft.finish,
  };
  return draft.medals === undefined ? base : { ...base, medals: draft.medals };
}

export function draftFromStage(stage: Stage): StageDraft {
  const base = {
    id: stage.id,
    name: stage.name,
    start: stage.start,
    gates: stage.gates,
    finish: stage.finish,
  };
  return stage.medals === undefined ? base : { ...base, medals: stage.medals };
}
