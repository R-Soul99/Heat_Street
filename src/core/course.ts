import type { RoadGraph } from "./road-graph";

export const COURSE_SCHEMA_VERSION = 1;
export type CourseMode = "p2p" | "circuit";
export type LocalPoint = readonly [number, number, number];

export interface CheckpointSensor {
  readonly widthM: number;
  readonly depthM: number;
  readonly heightM: number;
}

export interface CourseCheckpoint {
  readonly id: string;
  readonly nodeId: number;
  readonly edgeId: number;
  readonly position: LocalPoint;
  readonly sensor: CheckpointSensor;
}

export interface CourseStart {
  readonly nodeId: number;
  readonly headingRad: number;
}

export interface Course {
  readonly id: string;
  readonly name: string;
  readonly mode: CourseMode;
  readonly laps: number;
  readonly checkpoints: readonly CourseCheckpoint[];
  readonly start: CourseStart;
}

export interface CourseData {
  readonly schemaVersion: number;
  readonly areaId: string;
  readonly courses: readonly Course[];
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function fail(sourceLabel: string, message: string): never {
  throw new Error(`parseCourseData: ${sourceLabel}: ${message}`);
}

function required(
  sourceLabel: string,
  object: Record<string, unknown>,
  key: string,
  context: string,
): unknown {
  if (!Object.hasOwn(object, key)) fail(sourceLabel, `${context} missing required key "${key}"`);
  return object[key];
}

function stringField(
  sourceLabel: string,
  object: Record<string, unknown>,
  key: string,
  context: string,
): string {
  const value = required(sourceLabel, object, key, context);
  if (typeof value !== "string" || value.length === 0)
    fail(sourceLabel, `${context}.${key} must be a non-empty string`);
  return value;
}

function finiteNumber(
  sourceLabel: string,
  object: Record<string, unknown>,
  key: string,
  context: string,
): number {
  const value = required(sourceLabel, object, key, context);
  if (typeof value !== "number" || !Number.isFinite(value))
    fail(sourceLabel, `${context}.${key} must be a finite number`);
  return value;
}

function integer(
  sourceLabel: string,
  object: Record<string, unknown>,
  key: string,
  context: string,
): number {
  const value = finiteNumber(sourceLabel, object, key, context);
  if (!Number.isInteger(value)) fail(sourceLabel, `${context}.${key} must be an integer`);
  return value;
}

function objectField(
  sourceLabel: string,
  object: Record<string, unknown>,
  key: string,
  context: string,
): Record<string, unknown> {
  const value = required(sourceLabel, object, key, context);
  if (!isObject(value)) fail(sourceLabel, `${context}.${key} must be an object`);
  return value;
}

function parsePoint(sourceLabel: string, value: unknown, context: string): LocalPoint {
  if (
    !Array.isArray(value) ||
    value.length !== 3 ||
    value.some((component) => typeof component !== "number" || !Number.isFinite(component))
  ) {
    fail(sourceLabel, `${context} coordinate must be a finite [x, y, z] tuple`);
  }
  return [value[0], value[1], value[2]] as LocalPoint;
}

function parseSensor(sourceLabel: string, raw: unknown, context: string): CheckpointSensor {
  if (!isObject(raw)) fail(sourceLabel, `${context} must be an object`);
  const widthM = finiteNumber(sourceLabel, raw, "widthM", context);
  const depthM = finiteNumber(sourceLabel, raw, "depthM", context);
  const heightM = finiteNumber(sourceLabel, raw, "heightM", context);
  if (widthM <= 0 || depthM <= 0 || heightM < 6)
    fail(sourceLabel, `${context} must be positive and at least 6m tall`);
  return { widthM, depthM, heightM };
}

function parseCheckpoint(
  sourceLabel: string,
  raw: unknown,
  index: number,
  graph: RoadGraph,
  checkpointIds: Set<string>,
): CourseCheckpoint {
  if (!isObject(raw)) fail(sourceLabel, `checkpoints[${index}] must be an object`);
  const context = `checkpoints[${index}]`;
  const id = stringField(sourceLabel, raw, "id", context);
  if (checkpointIds.has(id)) fail(sourceLabel, `duplicate checkpoint id "${id}"`);
  checkpointIds.add(id);
  const nodeId = integer(sourceLabel, raw, "nodeId", context);
  const node = graph.nodes.find((candidate) => candidate.id === nodeId);
  if (node === undefined)
    fail(sourceLabel, `${context} node reference ${nodeId} is not a graph node`);
  const edgeId = integer(sourceLabel, raw, "edgeId", context);
  const edge = graph.edges.find((candidate) => candidate.id === edgeId);
  if (edge === undefined) fail(sourceLabel, `${context}.edgeId ${edgeId} is not a graph edge`);
  if (edge.from !== nodeId && edge.to !== nodeId)
    fail(sourceLabel, `${context}.edgeId ${edgeId} does not touch node ${nodeId}`);
  return {
    id,
    nodeId,
    edgeId,
    position: parsePoint(
      sourceLabel,
      required(sourceLabel, raw, "position", context),
      `${context}.position`,
    ),
    sensor: parseSensor(
      sourceLabel,
      required(sourceLabel, raw, "sensor", context),
      `${context}.sensor`,
    ),
  };
}

function parseCourse(
  sourceLabel: string,
  raw: unknown,
  index: number,
  graph: RoadGraph,
  courseIds: Set<string>,
  checkpointIds: Set<string>,
): Course {
  if (!isObject(raw)) fail(sourceLabel, `courses[${index}] must be an object`);
  const context = `courses[${index}]`;
  const id = stringField(sourceLabel, raw, "id", context);
  if (courseIds.has(id)) fail(sourceLabel, `duplicate course id "${id}"`);
  courseIds.add(id);
  const name = stringField(sourceLabel, raw, "name", context);
  const mode = stringField(sourceLabel, raw, "mode", context);
  if (mode !== "p2p" && mode !== "circuit")
    fail(sourceLabel, `${context}.mode must be "p2p" or "circuit"`);
  const rawCheckpoints = required(sourceLabel, raw, "checkpoints", context);
  if (!Array.isArray(rawCheckpoints)) fail(sourceLabel, `${context}.checkpoints must be an array`);
  const minimum = mode === "p2p" ? 5 : 4;
  const maximum = mode === "p2p" ? 8 : 6;
  if (rawCheckpoints.length < minimum || rawCheckpoints.length > maximum)
    fail(sourceLabel, `${context}.checkpoint count must be ${minimum}-${maximum}`);
  const checkpoints = rawCheckpoints.map((checkpoint, checkpointIndex) =>
    parseCheckpoint(sourceLabel, checkpoint, checkpointIndex, graph, checkpointIds),
  );
  const laps = mode === "circuit" ? integer(sourceLabel, raw, "laps", context) : 1;
  if (mode === "circuit" && laps !== 3) fail(sourceLabel, `${context}.laps must be exactly 3`);
  const startRaw = objectField(sourceLabel, raw, "start", context);
  const startNodeId = integer(sourceLabel, startRaw, "nodeId", `${context}.start`);
  if (!graph.nodes.some((node) => node.id === startNodeId))
    fail(sourceLabel, `${context}.start.nodeId ${startNodeId} is not a graph node`);
  return {
    id,
    name,
    mode,
    laps,
    checkpoints,
    start: {
      nodeId: startNodeId,
      headingRad: finiteNumber(sourceLabel, startRaw, "headingRad", `${context}.start`),
    },
  };
}

export function parseCourseData(raw: string, sourceLabel: string, graph: RoadGraph): CourseData {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`parseCourseData: ${sourceLabel}: not valid JSON`);
  }
  if (!isObject(parsed)) fail(sourceLabel, "root value must be a JSON object");
  const schemaVersion = integer(sourceLabel, parsed, "schemaVersion", "root");
  if (schemaVersion !== COURSE_SCHEMA_VERSION)
    fail(sourceLabel, `schemaVersion must be exactly ${COURSE_SCHEMA_VERSION}`);
  const areaId = stringField(sourceLabel, parsed, "areaId", "root");
  const rawCourses = required(sourceLabel, parsed, "courses", "root");
  if (!Array.isArray(rawCourses) || rawCourses.length !== 2)
    fail(sourceLabel, "root.courses must contain exactly two courses");
  const courseIds = new Set<string>();
  const checkpointIds = new Set<string>();
  const courses = rawCourses.map((course, index) =>
    parseCourse(sourceLabel, course, index, graph, courseIds, checkpointIds),
  );
  if (
    courses.filter((course) => course.mode === "p2p").length !== 1 ||
    courses.filter((course) => course.mode === "circuit").length !== 1
  )
    fail(sourceLabel, "courses must contain exactly one p2p and one circuit course");
  return { schemaVersion, areaId, courses };
}
