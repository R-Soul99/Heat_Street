/**
 * Pure, deterministic layout of the "playground" test map: flat tarmac with
 * (1) a field of closely spaced domes, (2) gap jumps (take-off ramp, gap,
 * landing ramp) and (3) three drivable speedway ovals. The domes and ramps are
 * not roads: they live in `src/core/crest-geometry.ts` (PLAYGROUND_CRESTS) and
 * stand on open ground. This module lays out only what the road graph needs:
 * a perimeter ring (south side gravel, for the required courses), a spine, the
 * ovals with a feeder each, and the launch pads.
 *
 * Coordinates are local: x east in [0, PLAYGROUND_WIDTH_M], z south in
 * [0, PLAYGROUND_DEPTH_M]; world = local - (W/2, D/2).
 *
 * Layering: no fs, no network, no Math.random, no Date.
 */

import {
  PLAYGROUND_DEPTH_M,
  PLAYGROUND_DOME_FIELD,
  PLAYGROUND_RAMP_PAD_X,
  PLAYGROUND_RAMP_PAIRS,
  PLAYGROUND_WIDTH_M,
} from "../../../src/core/crest-geometry.ts";
import type { Bbox } from "../graph/build-graph.ts";
import { makeProjector } from "../graph/project.ts";
import type { OverpassEnvelope } from "../sources/overpass.ts";
import { type Point, type Station, type TrackWay, Turtle } from "./proving-ground.ts";

const ROAD_WIDTH_M = 12;
const RING_INSET_M = 30;
const RING_RADIUS_M = 70;
const SPINE_X = 760;

export interface OvalSpec {
  readonly id: string;
  readonly name: string;
  readonly straightM: number;
  readonly radiusM: number;
  readonly widthM: number;
  /** Left edge of the oval's bounding box. */
  readonly x0: number;
  /** Top edge of the oval's bounding box. */
  readonly top: number;
}

/** Small / medium / large speedway ovals, east of the spine. */
export const OVALS: readonly OvalSpec[] = [
  { id: "large", name: "Large oval", straightM: 300, radiusM: 120, widthM: 24, x0: 830, top: 160 },
  { id: "medium", name: "Medium oval", straightM: 200, radiusM: 70, widthM: 18, x0: 830, top: 480 },
  { id: "small", name: "Small oval", straightM: 120, radiusM: 40, widthM: 14, x0: 830, top: 700 },
];

export interface Playground {
  readonly ways: readonly TrackWay[];
  readonly stations: readonly Station[];
}

/** `points` with `p` spliced in if it lies on one of its segments; undefined if not. */
function spliceOnto(points: readonly Point[], p: Point): Point[] | undefined {
  for (let i = 0; i + 1 < points.length; i++) {
    const a = points[i];
    const b = points[i + 1];
    const cross = (b.x - a.x) * (p.z - a.z) - (b.z - a.z) * (p.x - a.x);
    const within =
      p.x >= Math.min(a.x, b.x) - 1e-6 &&
      p.x <= Math.max(a.x, b.x) + 1e-6 &&
      p.z >= Math.min(a.z, b.z) - 1e-6 &&
      p.z <= Math.max(a.z, b.z) + 1e-6;
    if (Math.abs(cross) < 1e-6 && within) {
      const next = [...points];
      if (!points.some((q) => Math.hypot(q.x - p.x, q.z - p.z) < 1e-6)) next.splice(i + 1, 0, p);
      return next;
    }
  }
  return undefined;
}

function ringWays(): TrackWay[] {
  const x0 = RING_INSET_M;
  const x1 = PLAYGROUND_WIDTH_M - RING_INSET_M;
  const z0 = RING_INSET_M;
  const z1 = PLAYGROUND_DEPTH_M - RING_INSET_M;
  const r = RING_RADIUS_M;
  const along = (a: number, b: number): number => Math.abs(b - a) - 2 * r;
  const way = (name: string, surface: string, t: Turtle): TrackWay => ({
    name,
    highway: "residential",
    widthM: ROAD_WIDTH_M,
    surface,
    points: t.points,
  });
  // Clockwise from the north-west corner; the south side is gravel (every
  // course must touch a gravel or dirt edge).
  return [
    way("ring top", "asphalt", new Turtle(x0 + r, z0, 0).straight(along(x0, x1)).arc(r, 90)),
    way(
      "ring right",
      "asphalt",
      new Turtle(x1, z0 + r, Math.PI / 2).straight(along(z0, z1)).arc(r, 90),
    ),
    way(
      "ring bottom",
      "gravel",
      new Turtle(x1 - r, z1, Math.PI).straight(along(x0, x1)).arc(r, 90),
    ),
    way(
      "ring left",
      "asphalt",
      new Turtle(x0, z1 - r, -Math.PI / 2).straight(along(z0, z1)).arc(r, 90),
    ),
  ];
}

/** Four ways (top, right arc, bottom, left arc) and the left arc's mid point, where the feeder joins. */
function ovalWays(o: OvalSpec): { ways: TrackWay[]; leftMid: Point } {
  const { straightM: s, radiusM: r, x0, top } = o;
  const way = (suffix: string, t: Turtle): TrackWay => ({
    name: `${o.id} oval ${suffix}`,
    highway: "residential",
    widthM: o.widthM,
    surface: "asphalt",
    points: t.points,
  });
  const left = new Turtle(x0 + r, top + 2 * r, Math.PI).arc(r, 180);
  return {
    ways: [
      way("top", new Turtle(x0 + r, top, 0).straight(s)),
      way("turn east", new Turtle(x0 + r + s, top, 0).arc(r, 180)),
      way("bottom", new Turtle(x0 + r + s, top + 2 * r, Math.PI).straight(s)),
      way("turn west", left),
    ],
    // 180 deg in 5 deg steps: index 18 is the exact leftmost point (x0, top + r).
    leftMid: left.points[18],
  };
}

export function buildPlayground(): Playground {
  const ways: TrackWay[] = ringWays();
  const ovalJoints: Point[] = [];
  for (const o of OVALS) {
    const built = ovalWays(o);
    // The feeder ends on the left arc's mid point; split that arc there.
    const arc = built.ways[3];
    const arcPoints = spliceOnto(arc.points, built.leftMid);
    if (arcPoints === undefined) throw new Error(`playground: ${o.id} mid point is off its arc`);
    built.ways[3] = { ...arc, points: arcPoints };
    ways.push(...built.ways);
    ovalJoints.push(built.leftMid);
  }
  // Spine joins ring top to ring bottom; each oval's feeder branches off it.
  const spineEnds: Point[] = [
    { x: SPINE_X, z: RING_INSET_M },
    { x: SPINE_X, z: PLAYGROUND_DEPTH_M - RING_INSET_M },
  ];
  for (const end of spineEnds) {
    let placed = false;
    for (let w = 0; w < 4 && !placed; w++) {
      const spliced = spliceOnto(ways[w].points, end);
      if (spliced !== undefined) {
        ways[w] = { ...ways[w], points: spliced };
        placed = true;
      }
    }
    if (!placed) throw new Error(`playground: spine end ${end.x},${end.z} is not on the ring`);
  }
  const spineZs = [spineEnds[0].z, ...ovalJoints.map((p) => p.z), spineEnds[1].z].sort(
    (a, b) => a - b,
  );
  ways.push({
    name: "spine",
    highway: "residential",
    widthM: ROAD_WIDTH_M,
    surface: "asphalt",
    points: spineZs.map((z) => ({ x: SPINE_X, z })),
  });
  for (const [i, joint] of ovalJoints.entries()) {
    ways.push({
      name: `feeder ${OVALS[i].id} oval`,
      highway: "residential",
      widthM: ROAD_WIDTH_M,
      surface: "asphalt",
      points: [{ x: SPINE_X, z: joint.z }, joint],
    });
  }

  const stations: Station[] = [];
  const field = PLAYGROUND_DOME_FIELD;
  stations.push({
    id: "dome-field",
    key: "1",
    name: "Dome field (5 x 4 domes, 18-44 m)",
    note: "Drive in from the west edge, any line. Domes of varied size, closely spaced.",
    pad: { x: 70, z: field.originZ + (field.rows * field.cellM) / 2 },
    featureAheadM: field.originX - 70,
    widthM: 12,
  });
  PLAYGROUND_RAMP_PAIRS.forEach((pair, i) => {
    stations.push({
      id: `gap-jump-${pair.id}`,
      key: String(i + 2),
      name: pair.name,
      note: "Take-off ramp, gap, landing ramp. Launch at 55 mph or more and hold throttle (82+ mph at the lip). Slower comes up short into the lip wall.",
      pad: { x: PLAYGROUND_RAMP_PAD_X, z: pair.localZ },
      featureAheadM: 70,
      widthM: 16,
    });
  });
  OVALS.forEach((o, i) => {
    stations.push({
      id: `oval-${o.id}`,
      key: String(i + 5),
      name: `${o.name} (${o.straightM} m straights, R${o.radiusM})`,
      note: "Launched on the top straight, heading east into the first turn.",
      pad: { x: o.x0 + o.radiusM + 20, z: o.top },
      featureAheadM: 0,
      widthM: o.widthM,
    });
  });
  return { ways, stations };
}

const NODE_ID_BASE = 6_000_000;
const WAY_ID_BASE = 7_000_000;
const ENDPOINT = "synthetic://heat-street/playground";

export function playgroundToEnvelopes(
  ground: Playground,
  bbox: Bbox,
  fetchedAt: string,
): { roads: OverpassEnvelope; buildings: OverpassEnvelope } {
  const projector = makeProjector({
    lat: (bbox.south + bbox.north) / 2,
    lon: (bbox.west + bbox.east) / 2,
  });
  const toLatLon = (p: Point) =>
    projector.unproject(p.x - PLAYGROUND_WIDTH_M / 2, p.z - PLAYGROUND_DEPTH_M / 2);
  // Shared endpoints (joints) must share a node id; key on rounded coordinates.
  const nodeIds = new Map<string, number>();
  let nextNode = NODE_ID_BASE;
  const nodeId = (p: Point): number => {
    const key = `${p.x.toFixed(3)}:${p.z.toFixed(3)}`;
    let id = nodeIds.get(key);
    if (id === undefined) {
      id = nextNode++;
      nodeIds.set(key, id);
    }
    return id;
  };
  const elements = ground.ways.map((w, i) => ({
    type: "way",
    id: WAY_ID_BASE + i,
    nodes: w.points.map(nodeId),
    geometry: w.points.map(toLatLon),
    tags: {
      highway: w.highway,
      width: String(w.widthM),
      surface: w.surface,
      name: w.name,
    },
  }));
  const envelope = (query: string, els: unknown[]): OverpassEnvelope => ({
    fetchedAt,
    endpoint: ENDPOINT,
    bbox,
    query,
    response: { elements: els },
  });
  return {
    roads: envelope("synthetic playground (code-generated, not OSM)", elements),
    buildings: envelope("synthetic playground buildings (none)", []),
  };
}
