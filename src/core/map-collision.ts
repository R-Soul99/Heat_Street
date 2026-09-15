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
 * `collisionVersion` 2 (plan 04-10) adds a `heightfield` block: the DEM-derived
 * off-road ground grid `tools/map-compiler/author/heightfield.ts` builds
 * (D-P28/D-P29). Version 1 sidecars (buildings only, no heightfield) are no
 * longer accepted — `parseMapCollision` rejects them naming both versions, the
 * same "a stale format fails loudly rather than silently under-parsing" rule
 * `ROAD_GRAPH_SCHEMA_VERSION`'s own exact-match check already applies.
 * `heights` is copied element-wise into a FRESH `Float32Array` with every
 * value range-checked (finite, `-500` to `9000` metres) — never taken by
 * reference from the parsed array (threat T-04-35) — mirroring this file's
 * own "reconstruct field by field, never spread" discipline for the rest of
 * the sidecar.
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

/** The only `collisionVersion` this parser accepts. Mirrors `road-graph.ts`'s `ROAD_GRAPH_SCHEMA_VERSION` pattern. Bumped 1 -> 2 in plan 04-10 for the `heightfield` block. */
export const MAP_COLLISION_VERSION = 2;

/** A height value at or below this is not a physically plausible metre elevation on Earth — reject rather than silently accepting corrupted data (threat T-04-35). */
const HEIGHTFIELD_HEIGHT_MIN_M = -500;
/** A height value at or above this is not a physically plausible metre elevation on Earth — see `HEIGHTFIELD_HEIGHT_MIN_M`. */
const HEIGHTFIELD_HEIGHT_MAX_M = 9000;

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

/**
 * The DEM-derived off-road heightfield grid (plan 04-10, D-P28/D-P29):
 * `tools/map-compiler/author/heightfield.ts`'s `HeightfieldGrid`, field for
 * field, EXCEPT `heights` — here it's a plain `number[]`, not a
 * `Float32Array`. `JSON.stringify` on a `Float32Array` does not produce a
 * JSON array (it serialises as an index-keyed object, `{"0":1,"1":2,...}`),
 * verified empirically; this sidecar is a JSON artifact, and every other
 * numeric array in this codebase's on-disk schemas (`road-graph.ts`'s node/
 * edge geometry) is a plain array for the same reason. `heights[row + col *
 * (rows + 1)]`, already sunk by `sinkM`, in real-world metres — the exact
 * storage order Rapier's `ColliderDesc.heightfield` expects, verified
 * empirically (see `heightfield.ts`'s own header comment). The one-time
 * `Float32Array` conversion Rapier's constructor wants happens at the point
 * of collider construction (`src/physics/map-scene.ts`), not here.
 */
export interface MapCollisionHeightfield {
  readonly rows: number;
  readonly cols: number;
  readonly heights: readonly number[];
  readonly originX: number;
  readonly originZ: number;
  readonly scaleX: number;
  readonly scaleZ: number;
  readonly sinkM: number;
}

export interface MapCollision {
  readonly collisionVersion: number;
  readonly areaId: string;
  readonly buildings: readonly MapCollisionBuilding[];
  /**
   * Optional at the TYPE level (mirroring `RoadGraph.spawns`'s own optional
   * pattern) so a hand-built test fixture can omit it to exercise a
   * defensive "no heightfield" runtime path (`src/physics/map-scene.ts`'s
   * own such test) without an unsafe cast. Every REAL `collisionVersion: 2`
   * sidecar `parseMapCollision` accepts always has one — the key is in
   * `REQUIRED_TOP_LEVEL` below.
   */
  readonly heightfield?: MapCollisionHeightfield;
}

// Deliberately EXCLUDES "heightfield" — that key is checked separately, AFTER
// the collisionVersion check below, so a version-1 sidecar (which never had a
// "heightfield" key) fails with a message naming the version mismatch rather
// than a "missing key" message that would not contain "2" and could not
// satisfy this parser's own version-mismatch acceptance criterion.
const REQUIRED_TOP_LEVEL = ["collisionVersion", "areaId", "buildings"] as const;
const REQUIRED_VEC3 = ["x", "y", "z"] as const;
const REQUIRED_BUILDING = ["center", "halfExtents", "rotationY"] as const;
const REQUIRED_HEIGHTFIELD = [
  "rows",
  "cols",
  "heights",
  "originX",
  "originZ",
  "scaleX",
  "scaleZ",
  "sinkM",
] as const;

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

/**
 * Parses the `heightfield` block: `rows`/`cols` as integers, `heights` as an
 * array of EXACTLY `(rows + 1) * (cols + 1)` finite numbers each within
 * `[HEIGHTFIELD_HEIGHT_MIN_M, HEIGHTFIELD_HEIGHT_MAX_M]`, copied element-wise
 * into a fresh array (T-04-35 — never taken by reference from the parsed
 * array), plus the four `originX`/`originZ`/`scaleX`/`scaleZ`/`sinkM`
 * finite-number fields.
 */
function parseHeightfield(
  sourceLabel: string,
  raw: Record<string, unknown>,
): MapCollisionHeightfield {
  const context = "heightfield";
  requireKeys(sourceLabel, raw, REQUIRED_HEIGHTFIELD, context);

  const rows = requireInteger(sourceLabel, raw, "rows", context);
  const cols = requireInteger(sourceLabel, raw, "cols", context);

  const rawHeights = raw.heights;
  if (!Array.isArray(rawHeights)) {
    fail(sourceLabel, `${context}.heights must be an array`);
  }
  const expectedLength = (rows + 1) * (cols + 1);
  if (rawHeights.length !== expectedLength) {
    fail(
      sourceLabel,
      `${context}.heights length must equal (rows + 1) * (cols + 1) = ${expectedLength}, got ${rawHeights.length}`,
    );
  }

  const heights = new Array<number>(expectedLength);
  for (let i = 0; i < rawHeights.length; i++) {
    const value = rawHeights[i];
    if (
      typeof value !== "number" ||
      !Number.isFinite(value) ||
      value < HEIGHTFIELD_HEIGHT_MIN_M ||
      value > HEIGHTFIELD_HEIGHT_MAX_M
    ) {
      fail(
        sourceLabel,
        `${context}.heights[${i}] must be a finite number between ${HEIGHTFIELD_HEIGHT_MIN_M} and ${HEIGHTFIELD_HEIGHT_MAX_M}, got ${JSON.stringify(value)}`,
      );
    }
    heights[i] = value;
  }

  return {
    rows,
    cols,
    heights,
    originX: requireFiniteNumber(sourceLabel, raw, "originX", context),
    originZ: requireFiniteNumber(sourceLabel, raw, "originZ", context),
    scaleX: requireFiniteNumber(sourceLabel, raw, "scaleX", context),
    scaleZ: requireFiniteNumber(sourceLabel, raw, "scaleZ", context),
    sinkM: requireFiniteNumber(sourceLabel, raw, "sinkM", context),
  };
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

  // Checked AFTER the version check above (see REQUIRED_TOP_LEVEL's own
  // comment) — every real collisionVersion 2 sidecar has this key.
  requireKeys(sourceLabel, parsed, ["heightfield"], "root");
  const heightfieldRaw = requireObject(sourceLabel, parsed, "heightfield", "root");
  const heightfield = parseHeightfield(sourceLabel, heightfieldRaw);

  return { collisionVersion, areaId, buildings, heightfield };
}
