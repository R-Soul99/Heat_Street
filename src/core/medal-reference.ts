import { MEDAL_CONTRACT_VERSION, type MedalThresholds, medalThresholds } from "./medal-timing";
import { isPlainObject } from "./tuning-utils";

export const MEDAL_REFERENCE_KIND = "heat-street.medal-reference";
export const MEDAL_REFERENCE_VERSION = 1;

export interface MedalReferenceCourseExpectation {
  readonly courseId: string;
  readonly mode: "p2p" | "circuit";
  readonly laps: number;
  readonly checkpointIds: readonly string[];
}

export interface MedalReferenceSplit {
  readonly checkpointId: string;
  readonly lap: number;
  readonly authoredIndex: number;
  readonly hitOrder: number;
  readonly cumulativeTimeSec: number;
}

export interface MedalReferenceCourse {
  readonly courseId: string;
  readonly mode: "p2p" | "circuit";
  readonly laps: number;
  readonly totalTimeSec: number;
  readonly thresholds: MedalThresholds;
  readonly splits: readonly MedalReferenceSplit[];
}

export interface MedalReferenceData {
  readonly kind: typeof MEDAL_REFERENCE_KIND;
  readonly version: typeof MEDAL_REFERENCE_VERSION;
  readonly areaId: string;
  readonly contractVersion: typeof MEDAL_CONTRACT_VERSION;
  readonly handlingContentVersion: string;
  readonly courses: readonly MedalReferenceCourse[];
}

type RawObject = Record<string, unknown>;

function fail(sourceLabel: string, message: string): never {
  throw new Error(`parseMedalReference: ${sourceLabel}: ${message}`);
}

function required(sourceLabel: string, object: RawObject, key: string, context: string): unknown {
  if (!Object.hasOwn(object, key)) fail(sourceLabel, `${context} missing required key "${key}"`);
  return object[key];
}

function stringField(sourceLabel: string, object: RawObject, key: string, context: string): string {
  const value = required(sourceLabel, object, key, context);
  if (typeof value !== "string" || value.length === 0)
    fail(sourceLabel, `${context}.${key} must be a non-empty string`);
  return value;
}

function positiveNumber(
  sourceLabel: string,
  object: RawObject,
  key: string,
  context: string,
): number {
  const value = required(sourceLabel, object, key, context);
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0)
    fail(sourceLabel, `${context}.${key} must be a positive finite number`);
  return value;
}

function nonNegativeInteger(
  sourceLabel: string,
  object: RawObject,
  key: string,
  context: string,
): number {
  const value = required(sourceLabel, object, key, context);
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0)
    fail(sourceLabel, `${context}.${key} must be a non-negative integer`);
  return value;
}

function positiveInteger(
  sourceLabel: string,
  object: RawObject,
  key: string,
  context: string,
): number {
  const value = required(sourceLabel, object, key, context);
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0)
    fail(sourceLabel, `${context}.${key} must be a positive integer`);
  return value;
}

function parseSplit(
  sourceLabel: string,
  raw: unknown,
  index: number,
  expectation: MedalReferenceCourseExpectation,
): MedalReferenceSplit {
  if (!isPlainObject(raw)) fail(sourceLabel, `splits[${index}] must be an object`);
  const context = `splits[${index}]`;
  const checkpointId = stringField(sourceLabel, raw, "checkpointId", context);
  const authoredIndex = nonNegativeInteger(sourceLabel, raw, "authoredIndex", context);
  if (expectation.checkpointIds[authoredIndex] !== checkpointId)
    fail(sourceLabel, `${context} does not match authored checkpoint identity`);
  const lap = positiveInteger(sourceLabel, raw, "lap", context);
  if (lap > expectation.laps) fail(sourceLabel, `${context}.lap is outside the course lap range`);
  if (expectation.mode === "p2p" && lap !== 1)
    fail(sourceLabel, `${context}.lap must be 1 for a p2p course`);
  const hitOrder = nonNegativeInteger(sourceLabel, raw, "hitOrder", context);
  const cumulativeTimeSec = positiveNumber(sourceLabel, raw, "cumulativeTimeSec", context);
  return { checkpointId, lap, authoredIndex, hitOrder, cumulativeTimeSec };
}

function parseCourse(
  sourceLabel: string,
  raw: unknown,
  index: number,
  expectation: MedalReferenceCourseExpectation,
): MedalReferenceCourse {
  if (!isPlainObject(raw)) fail(sourceLabel, `courses[${index}] must be an object`);
  const context = `courses[${index}]`;
  const courseId = stringField(sourceLabel, raw, "courseId", context);
  if (courseId !== expectation.courseId)
    fail(sourceLabel, `${context}.courseId is not a known course`);
  const mode = stringField(sourceLabel, raw, "mode", context);
  if (mode !== expectation.mode) fail(sourceLabel, `${context}.mode does not match route identity`);
  const laps = positiveInteger(sourceLabel, raw, "laps", context);
  if (laps !== expectation.laps) fail(sourceLabel, `${context}.laps does not match route identity`);
  const totalTimeSec = positiveNumber(sourceLabel, raw, "totalTimeSec", context);
  const rawSplits = required(sourceLabel, raw, "splits", context);
  if (!Array.isArray(rawSplits)) fail(sourceLabel, `${context}.splits must be an array`);
  const expectedSplitCount = expectation.laps * expectation.checkpointIds.length;
  if (rawSplits.length !== expectedSplitCount)
    fail(sourceLabel, `${context}.splits must contain ${expectedSplitCount} entries`);
  const splits = rawSplits.map((split, splitIndex) =>
    parseSplit(sourceLabel, split, splitIndex, expectation),
  );
  const seenKeys = new Set<string>();
  const seenHitOrders = new Set<number>();
  let previousCumulative = 0;
  for (const split of splits) {
    const key = `${split.lap}:${split.checkpointId}`;
    if (seenKeys.has(key)) fail(sourceLabel, `${context}.splits contains duplicate ${key}`);
    seenKeys.add(key);
    if (seenHitOrders.has(split.hitOrder))
      fail(sourceLabel, `${context}.splits contains duplicate hitOrder`);
    seenHitOrders.add(split.hitOrder);
    if (split.cumulativeTimeSec <= previousCumulative)
      fail(sourceLabel, `${context}.splits must be strictly increasing`);
    previousCumulative = split.cumulativeTimeSec;
  }
  for (let lap = 1; lap <= expectation.laps; lap += 1) {
    for (const checkpointId of expectation.checkpointIds) {
      if (!seenKeys.has(`${lap}:${checkpointId}`))
        fail(sourceLabel, `${context}.splits is missing ${lap}:${checkpointId}`);
    }
  }
  if (Math.abs(previousCumulative - totalTimeSec) > Number.EPSILON * Math.max(1, totalTimeSec) * 8)
    fail(sourceLabel, `${context}.splits final cumulative time must equal totalTimeSec`);
  return {
    courseId,
    mode,
    laps,
    totalTimeSec,
    thresholds: medalThresholds(totalTimeSec) as MedalThresholds,
    splits,
  };
}

export function parseMedalReference(
  raw: string,
  sourceLabel: string,
  expectedAreaId: string,
  expectedCourses: readonly MedalReferenceCourseExpectation[],
): MedalReferenceData {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    fail(sourceLabel, "not valid JSON");
  }
  if (!isPlainObject(parsed)) fail(sourceLabel, "root value must be an object");
  if (parsed.kind !== MEDAL_REFERENCE_KIND) fail(sourceLabel, "kind is not recognized");
  if (parsed.version !== MEDAL_REFERENCE_VERSION)
    fail(sourceLabel, `version must be exactly ${MEDAL_REFERENCE_VERSION}`);
  const areaId = stringField(sourceLabel, parsed, "areaId", "root");
  if (areaId !== expectedAreaId) fail(sourceLabel, "areaId does not match the shipped route area");
  if (parsed.contractVersion !== MEDAL_CONTRACT_VERSION)
    fail(sourceLabel, `contractVersion must be exactly ${MEDAL_CONTRACT_VERSION}`);
  const handlingContentVersion = stringField(sourceLabel, parsed, "handlingContentVersion", "root");
  const rawCourses = required(sourceLabel, parsed, "courses", "root");
  if (!Array.isArray(rawCourses) || rawCourses.length !== expectedCourses.length)
    fail(sourceLabel, "root.courses must contain exactly the expected courses");
  const expectations = new Map(expectedCourses.map((course) => [course.courseId, course]));
  if (expectations.size !== expectedCourses.length)
    fail(sourceLabel, "expected course identities must be unique");
  const seenCourses = new Set<string>();
  const courses = rawCourses.map((course, index) => {
    if (!isPlainObject(course)) fail(sourceLabel, `courses[${index}] must be an object`);
    const courseId = stringField(sourceLabel, course, "courseId", `courses[${index}]`);
    const expectation = expectations.get(courseId);
    if (expectation === undefined || seenCourses.has(courseId))
      fail(sourceLabel, `courses[${index}] has an unknown or duplicate courseId`);
    seenCourses.add(courseId);
    return parseCourse(sourceLabel, course, index, expectation);
  });
  if (seenCourses.size !== expectedCourses.length)
    fail(sourceLabel, "reference is missing a course");
  return {
    kind: MEDAL_REFERENCE_KIND,
    version: MEDAL_REFERENCE_VERSION,
    areaId,
    contractVersion: MEDAL_CONTRACT_VERSION,
    handlingContentVersion,
    courses,
  };
}
