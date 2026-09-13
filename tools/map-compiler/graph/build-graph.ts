/**
 * Turns a cached Overpass roads envelope (plan 04-02's `{ fetchedAt, endpoint,
 * bbox, query, response }` shape) into a dense-id `RoadGraph` — the compiled
 * artifact `docs/schemas/road-graph.v1.md` specifies.
 *
 * This file implements BOTH halves of plan 04-04: Task 1's topology (dense
 * node/edge ids, junction detection via post-build degree, way splitting at
 * shared nodes, undirected-component pruning) and Task 2's per-edge
 * attribute resolution (surface via `mapSurface`, class/lanes/width/oneway/
 * speed/bridge/tunnel/layer, provenance, `spawns`). The split is preserved
 * in the comments below so a reader can see which behavior belongs to which
 * plan task.
 *
 * Node identity: OSM node ids are numbers (D-P… none — this is 04-RESEARCH.md's
 * own topology reasoning, not a locked decision). A way element missing its
 * `nodes` array (should not happen given plan 04-02's `out body geom qt`
 * query, but defended against anyway) falls back to a coordinate-keyed
 * identity — lat/lon rounded to 7 decimal places, joined as a string — so
 * the compiler degrades to "every way is a standalone island" LOUDLY (via
 * `report.nodeIdentityMode`) rather than silently. A silent fallback here
 * would produce a graph with no shared junctions at all.
 *
 * Determinism: node ids are assigned by sorting node keys (numeric OSM ids
 * ascending, before any coordinate-keyed string ids, which sort
 * lexicographically); edge ids are assigned by sorting `(osmWayId,
 * segmentIndex)` ascending. Recompiling the same cached snapshot therefore
 * produces byte-identical `JSON.stringify` output — SC3's "reproducible
 * rebuild" would silently break without this.
 *
 * Layering: pure data transform — reads a plain envelope object and a plain
 * config object, returns a plain `RoadGraph` + `BuildReport`. No `node:fs`,
 * no network, no `three`, no Rapier. NOT mechanically enforced —
 * `tests/layering.test.ts` does not scan `tools/**`; this file's own
 * discipline is the only guard.
 */
import type {
  RoadGraph,
  RoadGraphAttribution,
  RoadGraphEdge,
  RoadGraphNode,
  RoadGraphSpawn,
} from "../../../src/core/road-graph.ts";
import { parseRoadGraph } from "../../../src/core/road-graph.ts";
import type { SurfaceType } from "../../../src/core/surface-types.ts";
import { makeProjector } from "./project.ts";
import { mapSurface, type SurfaceCoverageReport, surfaceCoverage } from "./surface-mapping.ts";

/** Single exported semver constant naming which compiler build produced an artifact. Bump this
 * in any later plan that changes emitted geometry or attribute resolution — the field exists so
 * a stale artifact is detectable (docs/schemas/road-graph.v1.md's `source.compilerVersion`). */
export const COMPILER_VERSION = "0.1.0";

export interface Bbox {
  readonly south: number;
  readonly west: number;
  readonly north: number;
  readonly east: number;
}

/** The subset of `AreaConfig` (tools/map-compiler/areas/*.config.ts) buildGraph needs. */
export interface BuildGraphConfig {
  readonly areaId: string;
  readonly name: string;
  readonly bbox: Bbox;
  readonly demSource: "usgs-3dep-1m" | "copernicus-glo30";
  /** `null` is `AreaConfig`'s placeholder before plan 04-02's Overpass fetch has filled it in — `buildGraph` throws a named error rather than emitting a schema-invalid artifact if either is still null. */
  readonly osmSnapshot: string | null;
  readonly osmExtract: string | null;
  readonly excludeHighwayClasses: readonly string[];
}

interface OverpassWayElement {
  readonly type: string;
  readonly id: number;
  readonly nodes?: readonly number[];
  readonly geometry: readonly { readonly lat: number; readonly lon: number }[];
  readonly tags?: Readonly<Record<string, string>>;
}

export interface RoadsEnvelopeLike {
  readonly response: { readonly elements: readonly unknown[] };
}

export interface PrunedEdgeReportEntry {
  readonly id: number;
  readonly osmWayId: number;
  readonly lengthM: number;
}

export interface BuildReport {
  readonly waysRetained: number;
  readonly waysDroppedByReason: Readonly<Record<string, number>>;
  readonly nodeCount: number;
  readonly edgeCount: number;
  readonly junctionCount: number;
  readonly prunedEdges: readonly PrunedEdgeReportEntry[];
  readonly nodeIdentityMode: "osm-id" | "coordinate-keyed";
  readonly surfaceCoverage: SurfaceCoverageReport | null;
}

export interface BuildGraphResult {
  readonly graph: RoadGraph;
  readonly report: BuildReport;
}

/** Task 2: DEM attribution notice per `docs/adr/0001-map-data-source.md`'s selection rule. */
const DEM_ATTRIBUTION: Readonly<Record<BuildGraphConfig["demSource"], string>> = {
  "usgs-3dep-1m": "U.S. Geological Survey 3D Elevation Program (public domain)",
  "copernicus-glo30":
    "© DLR e.V. 2010-2014 and © Airbus Defence and Space GmbH 2014-2018 provided under COPERNICUS by the European Union and ESA; all rights reserved",
};

/** Task 2: fixed ADR 0001 attribution strings, minus the DEM line (which is demSource-dependent). */
function attributionFor(demSource: BuildGraphConfig["demSource"]): RoadGraphAttribution {
  return {
    osm: "© OpenStreetMap contributors",
    osmLicense: "ODbL-1.0",
    osmLicenseUrl: "https://www.openstreetmap.org/copyright",
    dem: DEM_ATTRIBUTION[demSource],
  };
}

/** Task 2: lane-count defaults `[ASSUMED]` per road class, used when `tags.lanes` doesn't parse. */
export const DEFAULT_LANES_BY_CLASS: Readonly<Record<string, number>> = {
  motorway: 2,
  trunk: 2,
  primary: 2,
  secondary: 2,
  tertiary: 2,
  residential: 2,
  unclassified: 2,
  track: 1,
  service: 1,
  living_street: 1,
};

/** Task 2: signposted-speed defaults `[ASSUMED]` per road class, used when `tags.maxspeed` doesn't parse. */
export const DEFAULT_SPEED_KPH_BY_CLASS: Readonly<Record<string, number>> = {
  motorway: 100,
  trunk: 100,
  primary: 90,
  secondary: 80,
  tertiary: 70,
  unclassified: 60,
  residential: 40,
  living_street: 20,
  track: 30,
  service: 20,
};

/** Task 2: per-lane carriageway width `[ASSUMED]` used to derive `widthM` when `tags.width` doesn't parse. */
export const LANE_WIDTH_M = 3.5;
const MIN_WIDTH_M = 3.5;
const MAX_WIDTH_M = 20;
const MIN_EXPLICIT_WIDTH_M = 2;
const MAX_EXPLICIT_WIDTH_M = 30;

const MPH_TO_KPH = 1.609344;

function isWayElement(element: unknown): element is OverpassWayElement {
  return (
    typeof element === "object" &&
    element !== null &&
    (element as { type?: unknown }).type === "way" &&
    Array.isArray((element as { geometry?: unknown }).geometry)
  );
}

/** A node's identity while the graph is being assembled: a real OSM node id, or (fallback) a
 * lat/lon-rounded coordinate key string. */
type NodeKey = number | string;

function coordKey(lat: number, lon: number): string {
  return `${lat.toFixed(7)},${lon.toFixed(7)}`;
}

function compareNodeKeys(a: NodeKey, b: NodeKey): number {
  const aIsNum = typeof a === "number";
  const bIsNum = typeof b === "number";
  if (aIsNum && bIsNum) return (a as number) - (b as number);
  if (aIsNum !== bIsNum) return aIsNum ? -1 : 1;
  const as = a as string;
  const bs = b as string;
  return as < bs ? -1 : as > bs ? 1 : 0;
}

function polylineLengthXZ(points: readonly (readonly [number, number, number])[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    const dx = points[i][0] - points[i - 1][0];
    const dz = points[i][2] - points[i - 1][2];
    total += Math.sqrt(dx * dx + dz * dz);
  }
  return total;
}

interface RawEdge {
  readonly osmWayId: number;
  readonly segmentIndex: number;
  readonly fromKey: NodeKey;
  readonly toKey: NodeKey;
  /** Points in ORIGINAL way direction (not yet reversed for `oneway=-1`). */
  readonly points: [number, number, number][];
  readonly lengthM: number;
  readonly tags: Readonly<Record<string, string>>;
}

/**
 * Task 2: resolves every `RoadGraphEdge` attribute field (everything except
 * id/from/to/points/lengthM, which topology already produced) from one raw
 * way's OSM tags, per `docs/schemas/road-graph.v1.md`'s Edge field table.
 * Throws (via `mapSurface`) on an unmapped `surface=*` value — this is the
 * one place in the compiler a silent default is the bug, not the safety net.
 */
function resolveEdgeAttributes(
  tags: Readonly<Record<string, string>>,
  osmWayId: number,
): {
  readonly surface: SurfaceType;
  readonly fromFallback: boolean;
  readonly roadClass: string;
  readonly lanes: number;
  readonly widthM: number;
  readonly oneway: boolean;
  readonly reverseDirection: boolean;
  readonly speedLimitKph: number;
  readonly bridge: boolean;
  readonly tunnel: boolean;
  readonly layer: number;
} {
  const roadClass = tags.highway ?? "unclassified";

  let surfaceResult: { surface: SurfaceType; fromFallback: boolean };
  try {
    surfaceResult = mapSurface(tags.surface, roadClass);
  } catch (err) {
    throw new Error(
      `resolveEdgeAttributes: osmWayId=${osmWayId} roadClass="${roadClass}": ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }

  const parsedLanes = Number.parseInt(tags.lanes ?? "", 10);
  const lanes =
    Number.isInteger(parsedLanes) && parsedLanes > 0
      ? parsedLanes
      : (DEFAULT_LANES_BY_CLASS[roadClass] ?? 2);

  const parsedWidth = Number.parseFloat(tags.width ?? "");
  const explicitWidthValid =
    Number.isFinite(parsedWidth) &&
    parsedWidth >= MIN_EXPLICIT_WIDTH_M &&
    parsedWidth <= MAX_EXPLICIT_WIDTH_M;
  const widthM = explicitWidthValid
    ? parsedWidth
    : Math.min(MAX_WIDTH_M, Math.max(MIN_WIDTH_M, lanes * LANE_WIDTH_M));

  const onewayTag = tags.oneway;
  const oneway =
    onewayTag === "yes" || onewayTag === "true" || onewayTag === "1" || onewayTag === "-1";
  const reverseDirection = onewayTag === "-1";

  const speedLimitKph = parseSpeedLimit(tags.maxspeed, roadClass);

  const bridge = tags.bridge !== undefined && tags.bridge !== "no";
  const tunnel = tags.tunnel !== undefined && tags.tunnel !== "no";
  const parsedLayer = Number.parseInt(tags.layer ?? "", 10);
  const layer = Number.isInteger(parsedLayer) ? parsedLayer : 0;

  return {
    surface: surfaceResult.surface,
    fromFallback: surfaceResult.fromFallback,
    roadClass,
    lanes,
    widthM,
    oneway,
    reverseDirection,
    speedLimitKph,
    bridge,
    tunnel,
    layer,
  };
}

/** Task 2: `tags.maxspeed` -> kph. A bare number is kph; an `N mph` form converts; anything else
 * (including absence) falls back to the per-class default. */
function parseSpeedLimit(maxspeed: string | undefined, roadClass: string): number {
  const fallback = DEFAULT_SPEED_KPH_BY_CLASS[roadClass] ?? 50;
  if (maxspeed === undefined) return fallback;

  const mphMatch = maxspeed.match(/^(\d+(?:\.\d+)?)\s*mph$/i);
  if (mphMatch !== null) {
    return Math.round(Number.parseFloat(mphMatch[1]) * MPH_TO_KPH);
  }

  const bare = Number.parseFloat(maxspeed);
  if (Number.isFinite(bare) && bare > 0) {
    return bare;
  }

  return fallback;
}

export function buildGraph(
  roadsEnvelope: RoadsEnvelopeLike,
  config: BuildGraphConfig,
): BuildGraphResult {
  const { osmSnapshot, osmExtract } = config;
  if (osmSnapshot === null || osmExtract === null) {
    throw new Error(
      `buildGraph: area "${config.areaId}" is missing osmSnapshot/osmExtract — run the ` +
        `Overpass fetch stage (loadOrFetchArea) before building the graph.`,
    );
  }

  const allElements = roadsEnvelope.response.elements;
  const waysDroppedByReason: Record<string, number> = {};
  const retainedWays: OverpassWayElement[] = [];

  for (const element of allElements) {
    if (!isWayElement(element)) continue;
    const tags = element.tags ?? {};
    const highway = tags.highway;
    if (highway === undefined) {
      waysDroppedByReason["no-highway-tag"] = (waysDroppedByReason["no-highway-tag"] ?? 0) + 1;
      continue;
    }
    if (config.excludeHighwayClasses.includes(highway) && tags.surface === undefined) {
      waysDroppedByReason["excluded-highway-no-surface"] =
        (waysDroppedByReason["excluded-highway-no-surface"] ?? 0) + 1;
      continue;
    }
    retainedWays.push(element);
  }

  // --- Task 1: topology ---

  let usedCoordinateFallback = false;
  const nodeKeysPerWay: NodeKey[][] = retainedWays.map((way) => {
    if (way.nodes !== undefined && way.nodes.length === way.geometry.length) {
      return way.nodes.slice();
    }
    usedCoordinateFallback = true;
    return way.geometry.map((pt) => coordKey(pt.lat, pt.lon));
  });

  const wayIndexSetByNodeKey = new Map<NodeKey, Set<number>>();
  for (let wayIdx = 0; wayIdx < retainedWays.length; wayIdx++) {
    const keys = nodeKeysPerWay[wayIdx];
    const seenInThisWay = new Set<NodeKey>();
    for (const key of keys) {
      if (seenInThisWay.has(key)) continue;
      seenInThisWay.add(key);
      let set = wayIndexSetByNodeKey.get(key);
      if (set === undefined) {
        set = new Set();
        wayIndexSetByNodeKey.set(key, set);
      }
      set.add(wayIdx);
    }
  }

  const graphNodeKeys = new Set<NodeKey>();
  for (const keys of nodeKeysPerWay) {
    graphNodeKeys.add(keys[0]);
    graphNodeKeys.add(keys[keys.length - 1]);
  }
  for (const [key, waySet] of wayIndexSetByNodeKey) {
    if (waySet.size >= 2) graphNodeKeys.add(key);
  }

  const latLonByNodeKey = new Map<NodeKey, { lat: number; lon: number }>();
  for (let wayIdx = 0; wayIdx < retainedWays.length; wayIdx++) {
    const way = retainedWays[wayIdx];
    const keys = nodeKeysPerWay[wayIdx];
    for (let i = 0; i < keys.length; i++) {
      if (!latLonByNodeKey.has(keys[i])) {
        latLonByNodeKey.set(keys[i], way.geometry[i]);
      }
    }
  }

  const origin = {
    lat: (config.bbox.south + config.bbox.north) / 2,
    lon: (config.bbox.west + config.bbox.east) / 2,
  };
  const projector = makeProjector(origin);

  const rawEdges: RawEdge[] = [];
  for (let wayIdx = 0; wayIdx < retainedWays.length; wayIdx++) {
    const way = retainedWays[wayIdx];
    const keys = nodeKeysPerWay[wayIdx];

    const splitIndices: number[] = [];
    for (let i = 0; i < keys.length; i++) {
      if (graphNodeKeys.has(keys[i])) splitIndices.push(i);
    }

    let segmentIndex = 0;
    for (let s = 0; s < splitIndices.length - 1; s++) {
      const startIdx = splitIndices[s];
      const endIdx = splitIndices[s + 1];
      const points: [number, number, number][] = [];
      for (let i = startIdx; i <= endIdx; i++) {
        const { x, z } = projector.project(way.geometry[i].lat, way.geometry[i].lon);
        points.push([x, 0, z]);
      }
      rawEdges.push({
        osmWayId: way.id,
        segmentIndex,
        fromKey: keys[startIdx],
        toKey: keys[endIdx],
        points,
        lengthM: polylineLengthXZ(points),
        tags: way.tags ?? {},
      });
      segmentIndex++;
    }
  }

  // Deterministic order for both provisional (pre-prune) and final id assignment.
  const sortedRawEdges = [...rawEdges].sort(
    (a, b) => a.osmWayId - b.osmWayId || a.segmentIndex - b.segmentIndex,
  );

  // Undirected connectivity over node keys (ignoring oneway, per schema design decision 3).
  const adjacency = new Map<NodeKey, Set<NodeKey>>();
  for (const key of graphNodeKeys) adjacency.set(key, new Set());
  for (const edge of sortedRawEdges) {
    adjacency.get(edge.fromKey)?.add(edge.toKey);
    adjacency.get(edge.toKey)?.add(edge.fromKey);
  }

  const componentByNodeKey = new Map<NodeKey, number>();
  const componentNodeKeys: NodeKey[][] = [];
  const orderedNodeKeys = [...graphNodeKeys].sort(compareNodeKeys);
  for (const startKey of orderedNodeKeys) {
    if (componentByNodeKey.has(startKey)) continue;
    const componentIndex = componentNodeKeys.length;
    const members: NodeKey[] = [];
    const queue: NodeKey[] = [startKey];
    componentByNodeKey.set(startKey, componentIndex);
    while (queue.length > 0) {
      // biome-ignore lint/style/noNonNullAssertion: queue.length > 0 guarantees shift() returns a value
      const current = queue.shift()!;
      members.push(current);
      for (const neighbor of adjacency.get(current) ?? []) {
        if (!componentByNodeKey.has(neighbor)) {
          componentByNodeKey.set(neighbor, componentIndex);
          queue.push(neighbor);
        }
      }
    }
    componentNodeKeys.push(members);
  }

  let largestComponentIndex = 0;
  for (let i = 1; i < componentNodeKeys.length; i++) {
    if (componentNodeKeys[i].length > componentNodeKeys[largestComponentIndex].length) {
      largestComponentIndex = i;
    }
  }
  const keptNodeKeys = new Set(componentNodeKeys[largestComponentIndex] ?? []);

  const prunedEdges: PrunedEdgeReportEntry[] = [];
  const keptSortedRawEdges: RawEdge[] = [];
  sortedRawEdges.forEach((edge, provisionalId) => {
    if (keptNodeKeys.has(edge.fromKey) && keptNodeKeys.has(edge.toKey)) {
      keptSortedRawEdges.push(edge);
    } else {
      prunedEdges.push({ id: provisionalId, osmWayId: edge.osmWayId, lengthM: edge.lengthM });
    }
  });

  const keptNodeKeysSorted = [...keptNodeKeys].sort(compareNodeKeys);
  const nodeIdByKey = new Map<NodeKey, number>();
  keptNodeKeysSorted.forEach((key, id) => {
    nodeIdByKey.set(key, id);
  });

  const degreeByNodeKey = new Map<NodeKey, number>();
  for (const edge of keptSortedRawEdges) {
    degreeByNodeKey.set(edge.fromKey, (degreeByNodeKey.get(edge.fromKey) ?? 0) + 1);
    degreeByNodeKey.set(edge.toKey, (degreeByNodeKey.get(edge.toKey) ?? 0) + 1);
  }

  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minZ = Number.POSITIVE_INFINITY;
  let maxZ = Number.NEGATIVE_INFINITY;

  const nodes: RoadGraphNode[] = keptNodeKeysSorted.map((key, id) => {
    const latLon = latLonByNodeKey.get(key);
    // latLon is always populated for a kept node — every graph node key was
    // recorded in latLonByNodeKey while building nodeKeysPerWay above.
    const { x, z } =
      latLon !== undefined ? projector.project(latLon.lat, latLon.lon) : { x: 0, z: 0 };
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minZ = Math.min(minZ, z);
    maxZ = Math.max(maxZ, z);
    const junction = (degreeByNodeKey.get(key) ?? 0) >= 3;
    // [ASSUMED] Coordinate-keyed fallback nodes have no real OSM node id;
    // synthesize a negative sequential id (real OSM ids are always
    // positive), documented and reported via report.nodeIdentityMode.
    const osmNodeId = typeof key === "number" ? key : -(id + 1);
    return { id, x, y: 0, z, junction, osmNodeId };
  });

  if (nodes.length === 0) {
    minX = 0;
    maxX = 0;
    minZ = 0;
    maxZ = 0;
  }

  // --- Task 2: per-edge attribute resolution + full artifact assembly ---

  const surfaceCoverageRecords: { roadClass: string; fromFallback: boolean }[] = [];

  const edges: RoadGraphEdge[] = keptSortedRawEdges.map((edge, id) => {
    const attrs = resolveEdgeAttributes(edge.tags, edge.osmWayId);
    surfaceCoverageRecords.push({ roadClass: attrs.roadClass, fromFallback: attrs.fromFallback });

    const fromKey = attrs.reverseDirection ? edge.toKey : edge.fromKey;
    const toKey = attrs.reverseDirection ? edge.fromKey : edge.toKey;
    const points = attrs.reverseDirection ? [...edge.points].reverse() : edge.points;

    // biome-ignore lint/style/noNonNullAssertion: fromKey/toKey are always kept graph node keys
    const from = nodeIdByKey.get(fromKey)!;
    // biome-ignore lint/style/noNonNullAssertion: fromKey/toKey are always kept graph node keys
    const to = nodeIdByKey.get(toKey)!;

    return {
      id,
      from,
      to,
      points,
      lengthM: edge.lengthM,
      surface: attrs.surface,
      roadClass: attrs.roadClass,
      lanes: attrs.lanes,
      widthM: attrs.widthM,
      oneway: attrs.oneway,
      speedLimitKph: attrs.speedLimitKph,
      bridge: attrs.bridge,
      tunnel: attrs.tunnel,
      layer: attrs.layer,
      osmWayId: edge.osmWayId,
    };
  });

  const junctionCount = nodes.filter((n) => n.junction).length;
  const coverage = surfaceCoverage(surfaceCoverageRecords);

  // Default spawn: the node nearest the bbox centre with degree >= 2,
  // heading along its first incident edge's second point — so the car
  // spawns pointing along a road rather than into a hedge.
  const spawns = buildDefaultSpawn(nodes, edges, origin, projector);

  const graph: RoadGraph = {
    schemaVersion: 1,
    areaId: config.areaId,
    name: config.name,
    source: {
      osmExtract,
      osmSnapshot,
      demSource: config.demSource,
      compilerVersion: COMPILER_VERSION,
    },
    attribution: attributionFor(config.demSource),
    origin: { lat: origin.lat, lon: origin.lon, projection: "local-enu-metres" },
    bounds: { minX, minZ, maxX, maxZ },
    nodes,
    edges,
    ...(spawns.length > 0 ? { spawns } : {}),
  };

  // Self-check: the compiler must never emit an artifact its own runtime
  // parser rejects. Throws (never swallowed) so a compiler/runtime
  // disagreement fails the BUILD, not a later `npm run dev` session.
  parseRoadGraph(JSON.stringify(graph), `buildGraph(${config.areaId})`);

  const report: BuildReport = {
    waysRetained: retainedWays.length,
    waysDroppedByReason,
    nodeCount: nodes.length,
    edgeCount: edges.length,
    junctionCount,
    prunedEdges,
    nodeIdentityMode: usedCoordinateFallback ? "coordinate-keyed" : "osm-id",
    surfaceCoverage: coverage,
  };

  return { graph, report };
}

function buildDefaultSpawn(
  nodes: readonly RoadGraphNode[],
  edges: readonly RoadGraphEdge[],
  origin: { readonly lat: number; readonly lon: number },
  projector: ReturnType<typeof makeProjector>,
): RoadGraphSpawn[] {
  if (nodes.length === 0) return [];
  const { x: centreX, z: centreZ } = projector.project(origin.lat, origin.lon);

  const degree = new Map<number, number>();
  for (const edge of edges) {
    degree.set(edge.from, (degree.get(edge.from) ?? 0) + 1);
    degree.set(edge.to, (degree.get(edge.to) ?? 0) + 1);
  }

  let best: RoadGraphNode | undefined;
  let bestDistSq = Number.POSITIVE_INFINITY;
  for (const node of nodes) {
    if ((degree.get(node.id) ?? 0) < 2) continue;
    const dx = node.x - centreX;
    const dz = node.z - centreZ;
    const distSq = dx * dx + dz * dz;
    if (distSq < bestDistSq) {
      bestDistSq = distSq;
      best = node;
    }
  }
  if (best === undefined) return [];

  const firstIncident = edges.find((e) => e.from === best.id || e.to === best.id);
  if (firstIncident === undefined) return [];

  // Direction from `best` toward the incident edge's "next" point along
  // travel away from `best`, so the spawn heading points along the road.
  const awayFromBest =
    firstIncident.from === best.id
      ? firstIncident.points[1]
      : firstIncident.points[firstIncident.points.length - 2];
  const headingRad = Math.atan2(awayFromBest[0] - best.x, -(awayFromBest[2] - best.z));

  return [{ id: "default", nodeId: best.id, headingRad }];
}
