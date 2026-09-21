import type { Medal } from "./medal-timing";
import { isPlainObject } from "./tuning-utils";

export const MEDAL_PROGRESS_KEY = "heat-street.medals.v1";
export const MEDAL_PROGRESS_KIND = "heat-street.medal-progress";
export const MEDAL_PROGRESS_VERSION = 1;

const MEDALS: ReadonlySet<Medal> = new Set(["ace", "gold", "silver", "bronze", "none"]);
const COURSE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

export interface MedalProgressRecord {
  readonly courseId: string;
  readonly bestTimeSec: number;
  readonly medal: Medal;
}

export interface MedalProgress {
  readonly kind: typeof MEDAL_PROGRESS_KIND;
  readonly version: typeof MEDAL_PROGRESS_VERSION;
  readonly courses: Record<string, MedalProgressRecord>;
}

export interface CompletedMedalResult {
  readonly complete: boolean;
  readonly effectiveTimeSec: number;
  readonly medal: Medal;
}

export interface MedalStorage {
  get(key: string): string | null;
  set(key: string, value: string): void;
}

type KnownCourseIds = readonly string[] | ReadonlySet<string> | undefined;

function isSafeCourseId(value: unknown): value is string {
  return typeof value === "string" && COURSE_ID_PATTERN.test(value);
}

function isKnownCourse(courseId: string, knownCourseIds: KnownCourseIds): boolean {
  if (knownCourseIds === undefined) return true;
  if (Array.isArray(knownCourseIds)) return knownCourseIds.includes(courseId);
  return (knownCourseIds as ReadonlySet<string>).has(courseId);
}

function isRecognizedMedal(value: unknown): value is Medal {
  return typeof value === "string" && MEDALS.has(value as Medal);
}

function isValidRecord(
  value: unknown,
  courseId: string,
  knownCourseIds: KnownCourseIds,
): value is MedalProgressRecord {
  if (
    !isPlainObject(value) ||
    value.courseId !== courseId ||
    !isKnownCourse(courseId, knownCourseIds)
  ) {
    return false;
  }
  return (
    Number.isFinite(value.bestTimeSec) &&
    typeof value.bestTimeSec === "number" &&
    value.bestTimeSec > 0 &&
    isRecognizedMedal(value.medal)
  );
}

function copyRecord(value: MedalProgressRecord): MedalProgressRecord {
  return {
    courseId: value.courseId,
    bestTimeSec: value.bestTimeSec,
    medal: value.medal,
  };
}

function copyValidCourses(
  value: unknown,
  knownCourseIds: KnownCourseIds,
): Record<string, MedalProgressRecord> {
  const courses: Record<string, MedalProgressRecord> = {};
  if (!isPlainObject(value)) return courses;

  for (const courseId of Object.keys(value)) {
    const record = value[courseId];
    if (isValidRecord(record, courseId, knownCourseIds)) {
      courses[courseId] = copyRecord(record);
    }
  }
  return courses;
}

export function emptyMedalProgress(): MedalProgress {
  return {
    kind: MEDAL_PROGRESS_KIND,
    version: MEDAL_PROGRESS_VERSION,
    courses: {},
  };
}

export function parseMedalProgress(
  raw: string | null,
  knownCourseIds?: KnownCourseIds,
): MedalProgress {
  if (raw === null) return emptyMedalProgress();

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return emptyMedalProgress();
  }

  if (
    !isPlainObject(parsed) ||
    parsed.kind !== MEDAL_PROGRESS_KIND ||
    parsed.version !== MEDAL_PROGRESS_VERSION
  ) {
    return emptyMedalProgress();
  }

  return {
    kind: MEDAL_PROGRESS_KIND,
    version: MEDAL_PROGRESS_VERSION,
    courses: copyValidCourses(parsed.courses, knownCourseIds),
  };
}

export function serializeMedalProgress(progress: MedalProgress): string {
  return JSON.stringify({
    kind: MEDAL_PROGRESS_KIND,
    version: MEDAL_PROGRESS_VERSION,
    courses: copyValidCourses(progress?.courses, undefined),
  });
}

export function mergeMedalResult(
  progress: MedalProgress,
  courseId: string,
  result: CompletedMedalResult,
  knownCourseIds?: KnownCourseIds,
): MedalProgress {
  if (
    !isSafeCourseId(courseId) ||
    !isKnownCourse(courseId, knownCourseIds) ||
    result.complete !== true ||
    !Number.isFinite(result.effectiveTimeSec) ||
    result.effectiveTimeSec <= 0 ||
    !isRecognizedMedal(result.medal)
  ) {
    return progress;
  }

  const current = progress.courses[courseId];
  if (current !== undefined && result.effectiveTimeSec >= current.bestTimeSec) {
    return progress;
  }

  return {
    kind: MEDAL_PROGRESS_KIND,
    version: MEDAL_PROGRESS_VERSION,
    courses: {
      ...progress.courses,
      [courseId]: {
        courseId,
        bestTimeSec: result.effectiveTimeSec,
        medal: result.medal,
      },
    },
  };
}

export function loadMedalProgress(
  storage: MedalStorage,
  knownCourseIds?: KnownCourseIds,
): MedalProgress {
  try {
    return parseMedalProgress(storage.get(MEDAL_PROGRESS_KEY), knownCourseIds);
  } catch {
    return emptyMedalProgress();
  }
}

export function saveMedalResult(
  storage: MedalStorage,
  courseId: string,
  result: CompletedMedalResult,
  knownCourseIds?: KnownCourseIds,
): boolean {
  const current = loadMedalProgress(storage, knownCourseIds);
  const updated = mergeMedalResult(current, courseId, result, knownCourseIds);
  if (updated === current) return false;

  try {
    storage.set(MEDAL_PROGRESS_KEY, serializeMedalProgress(updated));
    return true;
  } catch {
    return false;
  }
}
