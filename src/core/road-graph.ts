/**
 * The RoadGraph contract: the compiled-map shape shared by the Phase 4 map
 * compiler (`tools/map-compiler/**`) and the browser runtime that will
 * eventually load compiled `*.map.json` artifacts.
 *
 * `docs/schemas/road-graph.v1.md` is the source of truth; this file is the
 * mirror, field-for-field — same key names, same types, `surface` typed as
 * `SurfaceType`.
 *
 * `parseRoadGraph` below THROWS rather than defaulting (D-P3, plan 04-01):
 * the `parseSaved*` family in `src/core/vehicle-tuning.ts` returns
 * `null`/a safe default because user-editable tuning has a harmless
 * fallback. A map does not — a half-parsed map is exactly the "invisible
 * until a medal time is inexplicable" failure mode design decision 4 of the
 * schema doc exists to prevent.
 *
 * `parseRoadGraph` reconstructs its return value FIELD BY FIELD from the
 * `JSON.parse`d value — it never spreads that value into the result and
 * never copies it wholesale via any object-merging helper. This is the
 * prototype-pollution control (threat T-04-01): an injected
 * `__proto__`/`constructor` key in the input is simply never read, because
 * only the named fields below are ever copied across.
 *
 * Layering: pure data, no renderer, no physics engine, no DOM, no wall
 * clock. `tests/layering.test.ts` mechanically enforces this for every file
 * under `src/core/`.
 */
// Explicit `.ts` extension, deliberately unlike every other file under
// `src/`: `tools/map-compiler/**` imports this module directly and is
// executed by Node's native type-stripping, whose ESM resolver requires
// fully-specified relative specifiers. Vite, Vitest and `tsc` all resolve
// the explicit form fine, so the browser tier is unaffected — do not "tidy"
// this back to extensionless, doing so would break `npm run compile-map`.
import { SURFACE_TYPES, type SurfaceType } from "./surface-types.ts";

/** The only `schemaVersion` this parser accepts. Mirrors the schema doc's own "exactly `1`" requirement. */
export const ROAD_GRAPH_SCHEMA_VERSION = 1;

export interface RoadGraphSource {
  readonly osmExtract: string;
  readonly osmSnapshot: string;
  readonly demSource: string;
  readonly compilerVersion: string;
}

export interface RoadGraphAttribution {
  readonly osm: string;
  readonly osmLicense: string;
  readonly osmLicenseUrl: string;
  readonly dem: string;
}

export interface RoadGraphOrigin {
  readonly lat: number;
  readonly lon: number;
  readonly projection: string;
}

export interface RoadGraphBounds {
  readonly minX: number;
  readonly minZ: number;
  readonly maxX: number;
  readonly maxZ: number;
}

export interface RoadGraphNode {
  readonly id: number;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly junction: boolean;
  readonly osmNodeId: number;
}

export interface RoadGraphEdge {
  readonly id: number;
  readonly from: number;
  readonly to: number;
  readonly points: readonly (readonly [number, number, number])[];
  readonly lengthM: number;
  readonly surface: SurfaceType;
  readonly roadClass: string;
  readonly lanes: number;
  readonly widthM: number;
  readonly oneway: boolean;
  readonly speedLimitKph: number;
  readonly bridge: boolean;
  readonly tunnel: boolean;
  readonly layer: number;
  readonly osmWayId: number;
}

export interface RoadGraphSpawn {
  readonly id: string;
  readonly nodeId: number;
  readonly headingRad: number;
}

export interface RoadGraph {
  readonly schemaVersion: number;
  readonly areaId: string;
  readonly name: string;
  readonly source: RoadGraphSource;
  readonly attribution: RoadGraphAttribution;
  readonly origin: RoadGraphOrigin;
  readonly bounds: RoadGraphBounds;
  readonly nodes: readonly RoadGraphNode[];
  readonly edges: readonly RoadGraphEdge[];
  readonly spawns?: readonly RoadGraphSpawn[];
}

const REQUIRED_TOP_LEVEL = [
  "schemaVersion",
  "areaId",
  "name",
  "source",
  "attribution",
  "origin",
  "bounds",
  "nodes",
  "edges",
] as const;

const REQUIRED_SOURCE = ["osmExtract", "osmSnapshot", "demSource", "compilerVersion"] as const;
const REQUIRED_ATTRIBUTION = ["osm", "osmLicense", "osmLicenseUrl", "dem"] as const;
const REQUIRED_NODE = ["id", "x", "y", "z", "junction", "osmNodeId"] as const;
const REQUIRED_EDGE = [
  "id",
  "from",
  "to",
  "points",
  "lengthM",
  "surface",
  "roadClass",
  "lanes",
  "widthM",
  "oneway",
  "speedLimitKph",
  "bridge",
  "tunnel",
  "layer",
  "osmWayId",
] as const;

/** Same endpoint tolerance `tests/road-graph-schema.test.ts` already uses. */
const ENDPOINT_TOLERANCE = 1e-6;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function fail(sourceLabel: string, message: string): never {
  throw new Error(`parseRoadGraph: ${sourceLabel}: ${message}`);
}

function requireKeys(
  sourceLabel: string,
  obj: Record<string, unknown>,
  keys: readonly string[],
  context: string,
): void {
  for (const key of keys) {
    if (!Object.hasOwn(obj, key)) {
      fail(sourceLabel, `${context} missing required key "${key}"`);
    }
  }
}

function requireObject(
  sourceLabel: string,
  obj: Record<string, unknown>,
  key: string,
  context: string,
): Record<string, unknown> {
  const value = obj[key];
  if (!isPlainObject(value)) {
    fail(sourceLabel, `${context}.${key} must be an object`);
  }
  return value;
}

function requireString(
  sourceLabel: string,
  obj: Record<string, unknown>,
  key: string,
  context: string,
): string {
  const value = obj[key];
  if (typeof value !== "string") {
    fail(sourceLabel, `${context}.${key} must be a string`);
  }
  return value;
}

function requireFiniteNumber(
  sourceLabel: string,
  obj: Record<string, unknown>,
  key: string,
  context: string,
): number {
  const value = obj[key];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    fail(sourceLabel, `${context}.${key} must be a finite number`);
  }
  return value;
}

function requireBoolean(
  sourceLabel: string,
  obj: Record<string, unknown>,
  key: string,
  context: string,
): boolean {
  const value = obj[key];
  if (typeof value !== "boolean") {
    fail(sourceLabel, `${context}.${key} must be a boolean`);
  }
  return value;
}

function requireInteger(
  sourceLabel: string,
  obj: Record<string, unknown>,
  key: string,
  context: string,
): number {
  const value = requireFiniteNumber(sourceLabel, obj, key, context);
  if (!Number.isInteger(value)) {
    fail(sourceLabel, `${context}.${key} must be an integer`);
  }
  return value;
}

function parseSource(sourceLabel: string, raw: Record<string, unknown>): RoadGraphSource {
  requireKeys(sourceLabel, raw, REQUIRED_SOURCE, "source");
  return {
    osmExtract: requireString(sourceLabel, raw, "osmExtract", "source"),
    osmSnapshot: requireString(sourceLabel, raw, "osmSnapshot", "source"),
    demSource: requireString(sourceLabel, raw, "demSource", "source"),
    compilerVersion: requireString(sourceLabel, raw, "compilerVersion", "source"),
  };
}

function parseAttribution(sourceLabel: string, raw: Record<string, unknown>): RoadGraphAttribution {
  requireKeys(sourceLabel, raw, REQUIRED_ATTRIBUTION, "attribution");
  return {
    osm: requireString(sourceLabel, raw, "osm", "attribution"),
    osmLicense: requireString(sourceLabel, raw, "osmLicense", "attribution"),
    osmLicenseUrl: requireString(sourceLabel, raw, "osmLicenseUrl", "attribution"),
    dem: requireString(sourceLabel, raw, "dem", "attribution"),
  };
}

function parseOrigin(sourceLabel: string, raw: Record<string, unknown>): RoadGraphOrigin {
  return {
    lat: requireFiniteNumber(sourceLabel, raw, "lat", "origin"),
    lon: requireFiniteNumber(sourceLabel, raw, "lon", "origin"),
    projection: requireString(sourceLabel, raw, "projection", "origin"),
  };
}

function parseBounds(sourceLabel: string, raw: Record<string, unknown>): RoadGraphBounds {
  return {
    minX: requireFiniteNumber(sourceLabel, raw, "minX", "bounds"),
    minZ: requireFiniteNumber(sourceLabel, raw, "minZ", "bounds"),
    maxX: requireFiniteNumber(sourceLabel, raw, "maxX", "bounds"),
    maxZ: requireFiniteNumber(sourceLabel, raw, "maxZ", "bounds"),
  };
}

function parseNode(sourceLabel: string, raw: unknown, index: number): RoadGraphNode {
  if (!isPlainObject(raw)) {
    fail(sourceLabel, `nodes[${index}] must be an object`);
  }
  const context = `nodes[${index}]`;
  requireKeys(sourceLabel, raw, REQUIRED_NODE, context);
  return {
    id: requireInteger(sourceLabel, raw, "id", context),
    x: requireFiniteNumber(sourceLabel, raw, "x", context),
    y: requireFiniteNumber(sourceLabel, raw, "y", context),
    z: requireFiniteNumber(sourceLabel, raw, "z", context),
    junction: requireBoolean(sourceLabel, raw, "junction", context),
    osmNodeId: requireInteger(sourceLabel, raw, "osmNodeId", context),
  };
}

function parsePoints(
  sourceLabel: string,
  raw: unknown,
  edgeId: number,
): readonly (readonly [number, number, number])[] {
  if (!Array.isArray(raw) || raw.length < 2) {
    fail(sourceLabel, `edge id=${edgeId} points must have at least 2 entries`);
  }
  return raw.map((point, i) => {
    if (
      !Array.isArray(point) ||
      point.length !== 3 ||
      point.some((c) => typeof c !== "number" || !Number.isFinite(c))
    ) {
      fail(sourceLabel, `edge id=${edgeId} points[${i}] must be a 3-number tuple`);
    }
    return [point[0], point[1], point[2]] as const;
  });
}

function parseEdge(
  sourceLabel: string,
  raw: unknown,
  index: number,
  nodesById: Map<number, RoadGraphNode>,
): RoadGraphEdge {
  if (!isPlainObject(raw)) {
    fail(sourceLabel, `edges[${index}] must be an object`);
  }
  const context = `edges[${index}]`;
  requireKeys(sourceLabel, raw, REQUIRED_EDGE, context);

  const id = requireInteger(sourceLabel, raw, "id", context);
  const from = requireInteger(sourceLabel, raw, "from", context);
  const to = requireInteger(sourceLabel, raw, "to", context);

  const fromNode = nodesById.get(from);
  if (fromNode === undefined) {
    fail(sourceLabel, `edge id=${id} references unknown "from" node id ${from}`);
  }
  const toNode = nodesById.get(to);
  if (toNode === undefined) {
    fail(sourceLabel, `edge id=${id} references unknown "to" node id ${to}`);
  }

  const points = parsePoints(sourceLabel, raw.points, id);

  const first = points[0];
  if (
    Math.abs(first[0] - fromNode.x) > ENDPOINT_TOLERANCE ||
    Math.abs(first[1] - fromNode.y) > ENDPOINT_TOLERANCE ||
    Math.abs(first[2] - fromNode.z) > ENDPOINT_TOLERANCE
  ) {
    fail(sourceLabel, `edge id=${id} points[0] does not match "from" node ${from}'s coordinates`);
  }
  const last = points[points.length - 1];
  if (
    Math.abs(last[0] - toNode.x) > ENDPOINT_TOLERANCE ||
    Math.abs(last[1] - toNode.y) > ENDPOINT_TOLERANCE ||
    Math.abs(last[2] - toNode.z) > ENDPOINT_TOLERANCE
  ) {
    fail(sourceLabel, `edge id=${id} last point does not match "to" node ${to}'s coordinates`);
  }

  const surfaceRaw = requireString(sourceLabel, raw, "surface", context);
  if (!(SURFACE_TYPES as readonly string[]).includes(surfaceRaw)) {
    fail(sourceLabel, `edge id=${id} surface "${surfaceRaw}" is not one of the six SURFACE_TYPES`);
  }

  return {
    id,
    from,
    to,
    points,
    lengthM: requireFiniteNumber(sourceLabel, raw, "lengthM", context),
    surface: surfaceRaw as SurfaceType,
    roadClass: requireString(sourceLabel, raw, "roadClass", context),
    lanes: requireInteger(sourceLabel, raw, "lanes", context),
    widthM: requireFiniteNumber(sourceLabel, raw, "widthM", context),
    oneway: requireBoolean(sourceLabel, raw, "oneway", context),
    speedLimitKph: requireFiniteNumber(sourceLabel, raw, "speedLimitKph", context),
    bridge: requireBoolean(sourceLabel, raw, "bridge", context),
    tunnel: requireBoolean(sourceLabel, raw, "tunnel", context),
    layer: requireInteger(sourceLabel, raw, "layer", context),
    osmWayId: requireInteger(sourceLabel, raw, "osmWayId", context),
  };
}

function parseSpawn(
  sourceLabel: string,
  raw: unknown,
  index: number,
  nodeIds: ReadonlySet<number>,
): RoadGraphSpawn {
  if (!isPlainObject(raw)) {
    fail(sourceLabel, `spawns[${index}] must be an object`);
  }
  const context = `spawns[${index}]`;
  const id = requireString(sourceLabel, raw, "id", context);
  const nodeId = requireInteger(sourceLabel, raw, "nodeId", context);
  if (!nodeIds.has(nodeId)) {
    fail(sourceLabel, `spawns[${index}] references unknown node id ${nodeId}`);
  }
  const headingRad = requireFiniteNumber(sourceLabel, raw, "headingRad", context);
  return { id, nodeId, headingRad };
}

/**
 * Parses `raw` (the text of a `*.map.json` artifact) into a fully-validated
 * `RoadGraph`, or throws. `sourceLabel` names the artifact in every thrown
 * message — a caller typically passes the file path or URL it read `raw`
 * from, so a failure is traceable to a specific file without the caller
 * needing to wrap this call in its own try/catch just to add that context.
 *
 * Never returns a partially-populated graph: every required field is
 * present and validated, or this function throws before returning anything.
 */
export function parseRoadGraph(raw: string, sourceLabel: string): RoadGraph {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // The original SyntaxError is intentionally not rethrown/wrapped — its
    // message ("Unexpected token...") names neither the artifact nor
    // anything actionable. Naming `sourceLabel` here is strictly more useful.
    throw new Error(`parseRoadGraph: ${sourceLabel}: not valid JSON`);
  }

  if (!isPlainObject(parsed)) {
    fail(sourceLabel, "root value must be a JSON object");
  }

  requireKeys(sourceLabel, parsed, REQUIRED_TOP_LEVEL, "root");

  const schemaVersion = parsed.schemaVersion;
  if (schemaVersion !== ROAD_GRAPH_SCHEMA_VERSION) {
    fail(
      sourceLabel,
      `schemaVersion must be exactly the number ${ROAD_GRAPH_SCHEMA_VERSION}, got ${JSON.stringify(schemaVersion)}`,
    );
  }

  const areaId = requireString(sourceLabel, parsed, "areaId", "root");
  const name = requireString(sourceLabel, parsed, "name", "root");
  const source = parseSource(sourceLabel, requireObject(sourceLabel, parsed, "source", "root"));
  const attribution = parseAttribution(
    sourceLabel,
    requireObject(sourceLabel, parsed, "attribution", "root"),
  );
  const origin = parseOrigin(sourceLabel, requireObject(sourceLabel, parsed, "origin", "root"));
  const bounds = parseBounds(sourceLabel, requireObject(sourceLabel, parsed, "bounds", "root"));

  const rawNodes = parsed.nodes;
  if (!Array.isArray(rawNodes)) {
    fail(sourceLabel, "root.nodes must be an array");
  }
  const nodes = rawNodes.map((n, i) => parseNode(sourceLabel, n, i));

  const nodeIdSet = new Set(nodes.map((n) => n.id));
  for (let i = 0; i < nodes.length; i++) {
    if (!nodeIdSet.has(i)) {
      fail(sourceLabel, `node ids are not dense/contiguous from 0 — missing id ${i}`);
    }
  }
  const nodesById = new Map(nodes.map((n) => [n.id, n]));

  const rawEdges = parsed.edges;
  if (!Array.isArray(rawEdges)) {
    fail(sourceLabel, "root.edges must be an array");
  }
  const edges = rawEdges.map((e, i) => parseEdge(sourceLabel, e, i, nodesById));

  let spawns: readonly RoadGraphSpawn[] | undefined;
  if (Object.hasOwn(parsed, "spawns")) {
    const rawSpawns = parsed.spawns;
    if (!Array.isArray(rawSpawns)) {
      fail(sourceLabel, "root.spawns must be an array");
    }
    spawns = rawSpawns.map((s, i) => parseSpawn(sourceLabel, s, i, nodeIdSet));
  }

  return spawns !== undefined
    ? { schemaVersion, areaId, name, source, attribution, origin, bounds, nodes, edges, spawns }
    : { schemaVersion, areaId, name, source, attribution, origin, bounds, nodes, edges };
}
