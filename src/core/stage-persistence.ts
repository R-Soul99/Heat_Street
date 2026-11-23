import type { MedalStorage } from "./medal-persistence";
import { isPlainObject } from "./tuning-utils";
import { KNOWN_VEHICLE_CLASS_IDS, type VehicleClassId } from "./vehicle-class";

export const STAGE_BESTS_KEY = "heat-street.stage-bests.v1";
export const STAGE_BESTS_KIND = "heat-street.stage-bests";
export const STAGE_BESTS_VERSION = 1;

/** area:stage:class. A "__proto__" segment cannot match the character class. */
const KEY_PATTERN = /^[a-z0-9-]{1,64}:[a-z0-9-]{1,40}:[a-z0-9-]{1,32}$/;
const MAX_SPLITS = 41;
const STAGE_MEDALS = ["gold", "silver", "bronze", "none"] as const;

export type StageBestMedal = (typeof STAGE_MEDALS)[number];

export interface StageBestRecord {
  readonly bestTimeSec: number;
  readonly medal: StageBestMedal;
  /** Cumulative seconds at each gate (and the finish). */
  readonly splitsSec: readonly number[];
}

export interface StageBests {
  readonly kind: typeof STAGE_BESTS_KIND;
  readonly version: typeof STAGE_BESTS_VERSION;
  readonly bests: Readonly<Record<string, StageBestRecord>>;
}

export function stageBestKey(areaId: string, stageId: string, classId: VehicleClassId): string {
  return `${areaId}:${stageId}:${classId}`;
}

export function emptyStageBests(): StageBests {
  return { kind: STAGE_BESTS_KIND, version: STAGE_BESTS_VERSION, bests: {} };
}

function isValidKey(key: unknown): key is string {
  if (typeof key !== "string" || !KEY_PATTERN.test(key)) return false;
  const classSegment = key.slice(key.lastIndexOf(":") + 1);
  return KNOWN_VEHICLE_CLASS_IDS.find((id) => id === classSegment) !== undefined;
}

function isValidRecord(value: unknown): value is StageBestRecord {
  if (!isPlainObject(value)) return false;
  const { bestTimeSec, medal, splitsSec } = value;
  if (typeof bestTimeSec !== "number" || !Number.isFinite(bestTimeSec) || bestTimeSec <= 0) {
    return false;
  }
  if (typeof medal !== "string" || !STAGE_MEDALS.some((m) => m === medal)) return false;
  if (!Array.isArray(splitsSec) || splitsSec.length > MAX_SPLITS) return false;
  return splitsSec.every((s) => typeof s === "number" && Number.isFinite(s) && s >= 0);
}

function copyRecord(value: StageBestRecord): StageBestRecord {
  return {
    bestTimeSec: value.bestTimeSec,
    medal: value.medal,
    splitsSec: [...value.splitsSec],
  };
}

function copyValidBests(value: unknown): Record<string, StageBestRecord> {
  const bests: Record<string, StageBestRecord> = {};
  if (!isPlainObject(value)) return bests;
  for (const key of Object.keys(value)) {
    const record = value[key];
    if (isValidKey(key) && isValidRecord(record)) bests[key] = copyRecord(record);
  }
  return bests;
}

export function parseStageBests(raw: string | null): StageBests {
  if (raw === null) return emptyStageBests();
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return emptyStageBests();
  }
  if (
    !isPlainObject(parsed) ||
    parsed.kind !== STAGE_BESTS_KIND ||
    parsed.version !== STAGE_BESTS_VERSION
  ) {
    return emptyStageBests();
  }
  return {
    kind: STAGE_BESTS_KIND,
    version: STAGE_BESTS_VERSION,
    bests: copyValidBests(parsed.bests),
  };
}

export function serializeStageBests(bests: StageBests): string {
  return JSON.stringify({
    kind: STAGE_BESTS_KIND,
    version: STAGE_BESTS_VERSION,
    bests: copyValidBests(bests?.bests),
  });
}

/** Returns the SAME object when the result is invalid or not strictly faster. */
export function mergeStageBest(
  current: StageBests,
  key: string,
  result: StageBestRecord,
): StageBests {
  if (!isValidKey(key) || !isValidRecord(result)) return current;
  const existing = Object.hasOwn(current.bests, key) ? current.bests[key] : undefined;
  if (existing !== undefined && result.bestTimeSec >= existing.bestTimeSec) return current;
  return {
    kind: STAGE_BESTS_KIND,
    version: STAGE_BESTS_VERSION,
    bests: { ...current.bests, [key]: copyRecord(result) },
  };
}

export function loadStageBests(storage: MedalStorage): StageBests {
  try {
    return parseStageBests(storage.get(STAGE_BESTS_KEY));
  } catch {
    return emptyStageBests();
  }
}

export function saveStageBest(
  storage: MedalStorage,
  key: string,
  result: StageBestRecord,
): boolean {
  const current = loadStageBests(storage);
  const updated = mergeStageBest(current, key, result);
  if (updated === current) return false;
  try {
    storage.set(STAGE_BESTS_KEY, serializeStageBests(updated));
    return true;
  } catch {
    return false;
  }
}
