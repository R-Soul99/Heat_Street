/**
 * The collision-sidecar contract: non-road collision data (currently just
 * building boxes) for one compiled area, shipped as `<areaId>.collision.json`
 * alongside its `.map.json` twin (plan 04-08, decision D-P22).
 *
 * `docs/schemas/road-graph.v1.md` is normative and closed at v1 — its own
 * "Versioning" section states a breaking change to any required field gets a
 * NEW document (`road-graph.v2.md`), never an edit to this one. Adding a
 * `buildings` key to that schema would be exactly such a breaking change, so
 * non-road collision data ships as this separate sidecar instead. Road
 * collision itself still derives from the road graph via
 * `buildRoadGeometry(graph)` (SC3's "collision geometry derives from the same
 * road graph" is unaffected) — this sidecar carries only what the road graph
 * does not describe.
 *
 * `parseMapCollision` follows `src/core/road-graph.ts`'s established
 * discipline EXACTLY: throw with a named field, reconstruct the return value
 * FIELD BY FIELD from the `JSON.parse`d value, never spread it and never copy
 * it wholesale via any object-merging helper (threat T-04-01 — an injected
 * `__proto__`/`constructor` key is simply never read, because only the named
 * fields below are ever copied across).
 *
 * `parseMapCollision` ALSO requires `expectedAreaId` to match the sidecar's
 * own `areaId` (T-04-30): a stale or mismatched `.collision.json` paired with
 * a fresh `.map.json` is a silent "buildings from the wrong town" bug
 * otherwise — the car would drive through what should be solid walls, or
 * collide with buildings that aren't really there, with no error anywhere.
 *
 * Layering: pure data, no renderer, no physics engine, no DOM, no wall clock.
 * `tests/layering.test.ts` mechanically enforces this for every file under
 * `src/core/`.
 */
// Explicit `.ts` extension: this file has no relative imports today, but
// `tools/map-compiler/**` imports it directly and is executed by Node's
// native type-stripping, whose ESM resolver requires fully-specified
// relative specifiers for every module in the import graph — matching
// `src/core/road-graph.ts`'s own documented convention, kept here for
// consistency even though this particular file has nothing to import yet.

/** The only `collisionVersion` this parser accepts. Mirrors `road-graph.ts`'s `ROAD_GRAPH_SCHEMA_VERSION` pattern. */
export const MAP_COLLISION_VERSION = 1;

export interface MapCollisionVec3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/**
 * One building's collider description. `center` is the box's vertical
 * MIDPOINT (not its ground-level base) — a collider placed at `center` with
 * `halfExtents` therefore sits exactly on the sampled ground with no runtime
 * adjustment. `rotationY` (radians) is the box's yaw about the world Y axis;
 * `halfExtents.x`/`halfExtents.z` are the box's own LOCAL half-extents along
 * its (rotated) axes, matching `RAPIER.ColliderDesc.cuboid`'s own convention.
 */
export interface MapCollisionBuilding {
  readonly center: MapCollisionVec3;
  readonly halfExtents: MapCollisionVec3;
  readonly rotationY: number;
}

export interface MapCollision {
  readonly collisionVersion: number;
  readonly areaId: string;
  readonly buildings: readonly MapCollisionBuilding[];
}

const REQUIRED_TOP_LEVEL = ["collisionVersion", "areaId", "buildings"] as const;
const REQUIRED_VEC3 = ["x", "y", "z"] as const;
const REQUIRED_BUILDING = ["center", "halfExtents", "rotationY"] as const;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function fail(sourceLabel: string, message: string): never {
  throw new Error(`parseMapCollision: ${sourceLabel}: ${message}`);
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

function parseVec3(
  sourceLabel: string,
  obj: Record<string, unknown>,
  context: string,
): MapCollisionVec3 {
  requireKeys(sourceLabel, obj, REQUIRED_VEC3, context);
  return {
    x: requireFiniteNumber(sourceLabel, obj, "x", context),
    y: requireFiniteNumber(sourceLabel, obj, "y", context),
    z: requireFiniteNumber(sourceLabel, obj, "z", context),
  };
}

function parseBuilding(sourceLabel: string, raw: unknown, index: number): MapCollisionBuilding {
  if (!isPlainObject(raw)) {
    fail(sourceLabel, `buildings[${index}] must be an object`);
  }
  const context = `buildings[${index}]`;
  requireKeys(sourceLabel, raw, REQUIRED_BUILDING, context);

  const centerRaw = requireObject(sourceLabel, raw, "center", context);
  const halfExtentsRaw = requireObject(sourceLabel, raw, "halfExtents", context);

  return {
    center: parseVec3(sourceLabel, centerRaw, `${context}.center`),
    halfExtents: parseVec3(sourceLabel, halfExtentsRaw, `${context}.halfExtents`),
    rotationY: requireFiniteNumber(sourceLabel, raw, "rotationY", context),
  };
}

/**
 * Parses `raw` (the text of a `*.collision.json` artifact) into a
 * fully-validated `MapCollision`, or throws. `expectedAreaId` MUST match the
 * sidecar's own `areaId` — see this file's header comment (T-04-30).
 * `sourceLabel` names the artifact in every thrown message, matching
 * `parseRoadGraph`'s own convention.
 *
 * Never returns a partially-populated result: every required field is
 * present and validated, or this function throws before returning anything.
 */
export function parseMapCollision(
  raw: string,
  expectedAreaId: string,
  sourceLabel: string,
): MapCollision {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // The original SyntaxError is intentionally not rethrown/wrapped — its
    // message ("Unexpected token...") names neither the artifact nor
    // anything actionable. Naming `sourceLabel` here is strictly more useful.
    throw new Error(`parseMapCollision: ${sourceLabel}: not valid JSON`);
  }

  if (!isPlainObject(parsed)) {
    fail(sourceLabel, "root value must be a JSON object");
  }

  requireKeys(sourceLabel, parsed, REQUIRED_TOP_LEVEL, "root");

  const collisionVersion = parsed.collisionVersion;
  if (collisionVersion !== MAP_COLLISION_VERSION) {
    fail(
      sourceLabel,
      `collisionVersion must be exactly the number ${MAP_COLLISION_VERSION}, got ${JSON.stringify(collisionVersion)}`,
    );
  }

  const areaId = requireString(sourceLabel, parsed, "areaId", "root");
  if (areaId !== expectedAreaId) {
    fail(sourceLabel, `areaId mismatch: expected "${expectedAreaId}", found "${areaId}"`);
  }

  const rawBuildings = parsed.buildings;
  if (!Array.isArray(rawBuildings)) {
    fail(sourceLabel, "root.buildings must be an array");
  }
  const buildings = rawBuildings.map((b, i) => parseBuilding(sourceLabel, b, i));

  return { collisionVersion, areaId, buildings };
}
