/**
 * Pure model for the dev-only map editor: raw-OSM envelope types, the local
 * metre projection, hit testing, and tag edits. No DOM, no fs — unit tested in
 * `model.test.ts`. The editor edits the same `<areaId>.raw-osm.json` /
 * `<areaId>.raw-buildings.json` files the map compiler reads.
 */

export interface LatLon {
  lat: number;
  lon: number;
}

export interface RawWay {
  type: "way";
  id: number;
  nodes?: number[];
  geometry: LatLon[];
  tags?: Record<string, string>;
}

export interface RawEnvelope {
  fetchedAt: string;
  endpoint: string;
  bbox: { south: number; west: number; north: number; east: number };
  query: string;
  response: { elements: RawWay[] };
}

/** Local metres: x east, y north, relative to the envelope bbox centre. */
export interface Projector {
  toLocal(p: LatLon): { x: number; y: number };
  toLatLon(p: { x: number; y: number }): LatLon;
}

export function makeProjector(bbox: RawEnvelope["bbox"]): Projector {
  const lat0 = (bbox.south + bbox.north) / 2;
  const lon0 = (bbox.west + bbox.east) / 2;
  const mPerDegLon = 111_320 * Math.cos((lat0 * Math.PI) / 180);
  return {
    toLocal: (p) => ({ x: (p.lon - lon0) * mPerDegLon, y: (p.lat - lat0) * 110_540 }),
    toLatLon: (p) => ({ lon: lon0 + p.x / mPerDegLon, lat: lat0 + p.y / 110_540 }),
  };
}

/** The six game surfaces, and the OSM `surface=` value the editor writes for each. */
export const SURFACES = ["tarmac", "gravel", "dirt_road", "grass", "sand", "mud"] as const;
export type Surface = (typeof SURFACES)[number];
const OSM_SURFACE_FOR: Record<Surface, string> = {
  tarmac: "asphalt",
  gravel: "gravel",
  dirt_road: "dirt",
  grass: "grass",
  sand: "sand",
  mud: "mud",
};
const SURFACE_FOR_OSM: Record<string, Surface> = {
  asphalt: "tarmac",
  concrete: "tarmac",
  paved: "tarmac",
  sett: "tarmac",
  gravel: "gravel",
  fine_gravel: "gravel",
  pebblestone: "gravel",
  compacted: "dirt_road",
  dirt: "dirt_road",
  earth: "dirt_road",
  ground: "dirt_road",
  unpaved: "dirt_road",
  grass: "grass",
  sand: "sand",
  mud: "mud",
};

export const HIGHWAY_CLASSES = [
  "primary",
  "secondary",
  "tertiary",
  "unclassified",
  "residential",
  "service",
  "track",
] as const;

/** Mirrors the compiler's highway -> surface fallback when `surface` is absent. */
export function effectiveSurface(tags: Record<string, string> | undefined): Surface {
  const explicit = tags?.surface === undefined ? undefined : SURFACE_FOR_OSM[tags.surface];
  if (explicit !== undefined) return explicit;
  return tags?.highway === "track" ? "dirt_road" : "tarmac";
}

/** Sets (or, for `null`, clears) a road's explicit surface. */
export function setSurface(way: RawWay, surface: Surface | null): void {
  const tags = { ...(way.tags ?? {}) };
  if (surface === null) delete tags.surface;
  else tags.surface = OSM_SURFACE_FOR[surface];
  way.tags = tags;
}

/** Sets or clears (empty/NaN/non-positive) one tag. */
export function setTag(way: RawWay, key: string, value: string | null): void {
  const tags = { ...(way.tags ?? {}) };
  if (value === null || value === "") delete tags[key];
  else tags[key] = value;
  way.tags = tags;
}

export function distanceToSegment(
  p: { x: number; y: number },
  a: { x: number; y: number },
  b: { x: number; y: number },
): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
  return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
}

/** Distance (metres) from `p` to the way's polyline. */
export function distanceToWay(p: { x: number; y: number }, way: RawWay, proj: Projector): number {
  const pts = way.geometry.map((g) => proj.toLocal(g));
  let best = Number.POSITIVE_INFINITY;
  for (let i = 0; i + 1 < pts.length; i++) {
    best = Math.min(best, distanceToSegment(p, pts[i] as never, pts[i + 1] as never));
  }
  return best;
}

export function pointInPolygon(
  p: { x: number; y: number },
  ring: { x: number; y: number }[],
): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i] as { x: number; y: number };
    const b = ring[j] as { x: number; y: number };
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) {
      inside = !inside;
    }
  }
  return inside;
}

/** Nearest road within `toleranceM` of `p`, else `undefined`. */
export function pickRoad(
  p: { x: number; y: number },
  roads: readonly RawWay[],
  proj: Projector,
  toleranceM: number,
): RawWay | undefined {
  let best: RawWay | undefined;
  let bestD = toleranceM;
  for (const way of roads) {
    const d = distanceToWay(p, way, proj);
    if (d <= bestD) {
      best = way;
      bestD = d;
    }
  }
  return best;
}

/** First building whose footprint contains `p`. */
export function pickBuilding(
  p: { x: number; y: number },
  buildings: readonly RawWay[],
  proj: Projector,
): RawWay | undefined {
  return buildings.find((b) =>
    pointInPolygon(
      p,
      b.geometry.map((g) => proj.toLocal(g)),
    ),
  );
}

// ---------- drawing / moving ----------

type XY = { x: number; y: number };

/** Where a drawn point lands: on an existing node, on a road segment, or free. */
export type Snap =
  | { kind: "node"; nodeId: number; at: LatLon }
  | { kind: "segment"; way: RawWay; index: number; at: LatLon }
  | { kind: "free"; at: LatLon };

export function nextNodeId(roads: RawEnvelope): number {
  let max = 1_000_000_000;
  for (const w of roads.response.elements) for (const n of w.nodes ?? []) max = Math.max(max, n);
  return max + 1;
}

export function nextWayId(env: RawEnvelope): number {
  let max = 4_000_000_000;
  for (const w of env.response.elements) max = Math.max(max, w.id);
  return max + 1;
}

/** Nearest road node within `tolM` of `p`. */
export function pickNode(
  p: XY,
  roads: RawEnvelope,
  proj: Projector,
  tolM: number,
): { nodeId: number; at: LatLon } | undefined {
  let best: { nodeId: number; at: LatLon } | undefined;
  let bestD = tolM;
  for (const w of roads.response.elements) {
    w.geometry.forEach((g, i) => {
      const id = w.nodes?.[i];
      if (id === undefined) return;
      const q = proj.toLocal(g);
      const d = Math.hypot(q.x - p.x, q.y - p.y);
      if (d <= bestD) {
        best = { nodeId: id, at: g };
        bestD = d;
      }
    });
  }
  return best;
}

/** Snap `p` to a node (preferred), else a segment, else leave it free. */
export function snapPoint(p: XY, roads: RawEnvelope, proj: Projector, tolM: number): Snap {
  const node = pickNode(p, roads, proj, tolM);
  if (node !== undefined) return { kind: "node", ...node };
  let best: Snap | undefined;
  let bestD = tolM;
  for (const way of roads.response.elements) {
    if (way.nodes === undefined) continue;
    const pts = way.geometry.map((g) => proj.toLocal(g));
    for (let i = 0; i + 1 < pts.length; i++) {
      const a = pts[i] as XY;
      const b = pts[i + 1] as XY;
      const d = distanceToSegment(p, a, b);
      if (d > bestD) continue;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const len2 = dx * dx + dy * dy;
      const t =
        len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
      best = {
        kind: "segment",
        way,
        index: i,
        at: proj.toLatLon({ x: a.x + t * dx, y: a.y + t * dy }),
      };
      bestD = d;
    }
  }
  return best ?? { kind: "free", at: proj.toLatLon(p) };
}

/**
 * Commits a drawn polyline as a new road way. Points snapped to a segment split
 * that road (a new shared node is inserted into it) so the compiler sees a
 * junction; points snapped to a node reuse its id. Returns the new way.
 */
export function addRoad(
  roads: RawEnvelope,
  proj: Projector,
  snaps: readonly Snap[],
  tags: Record<string, string>,
): RawWay | undefined {
  if (snaps.length < 2) return undefined;
  let next = nextNodeId(roads);
  const nodes: number[] = [];
  const geometry: LatLon[] = [];
  for (const snap of snaps) {
    let id: number;
    if (snap.kind === "node") id = snap.nodeId;
    else {
      id = next++;
      if (snap.kind === "segment") splitWayAt(snap.way, proj, snap.at, id);
    }
    if (nodes[nodes.length - 1] === id) continue;
    nodes.push(id);
    geometry.push(snap.at);
  }
  if (nodes.length < 2) return undefined;
  const way: RawWay = { type: "way", id: nextWayId(roads), nodes, geometry, tags: { ...tags } };
  roads.response.elements.push(way);
  return way;
}

/** Inserts node `id` at `at` into the segment of `way` nearest to it. */
function splitWayAt(way: RawWay, proj: Projector, at: LatLon, id: number): void {
  const p = proj.toLocal(at);
  const pts = way.geometry.map((g) => proj.toLocal(g));
  let bestI = 0;
  let bestD = Number.POSITIVE_INFINITY;
  for (let i = 0; i + 1 < pts.length; i++) {
    const d = distanceToSegment(p, pts[i] as XY, pts[i + 1] as XY);
    if (d < bestD) {
      bestD = d;
      bestI = i;
    }
  }
  way.geometry.splice(bestI + 1, 0, at);
  way.nodes?.splice(bestI + 1, 0, id);
}

/** Moves a node (in every way that shares it) to `to`. */
export function moveNode(roads: RawEnvelope, nodeId: number, to: LatLon): void {
  for (const w of roads.response.elements) {
    w.nodes?.forEach((id, i) => {
      if (id === nodeId) w.geometry[i] = { ...to };
    });
  }
}

/** Axis-aligned rectangular building between two opposite corners. */
export function addBuildingRect(
  buildings: RawEnvelope,
  a: LatLon,
  b: LatLon,
  heightM: number,
): RawWay {
  const ring: LatLon[] = [
    { lat: a.lat, lon: a.lon },
    { lat: a.lat, lon: b.lon },
    { lat: b.lat, lon: b.lon },
    { lat: b.lat, lon: a.lon },
    { lat: a.lat, lon: a.lon },
  ];
  const way: RawWay = {
    type: "way",
    id: nextWayId(buildings),
    geometry: ring,
    tags: { building: "yes", height: String(heightM) },
  };
  buildings.response.elements.push(way);
  return way;
}
