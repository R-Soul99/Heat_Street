/**
 * Pure, deterministic layout of the "feel-test" proving ground: an empty,
 * building-free handling test bed. Stations are straight lead-ins into one
 * feature each (corners, sweepers, a hairpin, esses, a long straight) plus a
 * big square skid pan, all surrounded by a perimeter ring road that carries
 * the (required) p2p and circuit courses.
 *
 * Every station has a fixed launch pad: the runtime teleports the car there
 * at a chosen speed so a manoeuvre always starts from exactly the same place.
 *
 * Coordinates are local: x in [0, WIDTH_M] east, z in [0, DEPTH_M] southward;
 * conversion to lat/lon recentres on the bbox centre (same as grid-layout.ts).
 *
 * Layering: no fs, no network, no Math.random, no Date.
 */

import type { Bbox } from "../graph/build-graph.ts";
import { makeProjector } from "../graph/project.ts";
import type { OverpassEnvelope } from "../sources/overpass.ts";

export const WIDTH_M = 1400;
export const DEPTH_M = 1100;
export const ROAD_WIDTH_M = 12;
const ARC_STEP_DEG = 5;
const STRAIGHT_STEP_M = 25;

export interface Point {
  readonly x: number;
  readonly z: number;
}

export interface Station {
  readonly id: string;
  readonly key: string;
  readonly name: string;
  readonly note: string;
  /** Local launch point; the car faces east (+x). */
  readonly pad: Point;
  /** Metres from the pad to the feature (corner / take-off); 0 = nothing to count down to. */
  readonly featureAheadM: number;
  readonly widthM: number;
}

export interface TrackWay {
  readonly name: string;
  readonly highway: string;
  readonly widthM: number;
  readonly surface: string;
  readonly points: readonly Point[];
}

/** Minimal turtle: heading `a` radians, 0 = east, +pi/2 = south (a right turn when facing east). */
class Turtle {
  private x: number;
  private z: number;
  private a: number;
  readonly points: Point[];
  constructor(x: number, z: number, headingRad = 0) {
    this.x = x;
    this.z = z;
    this.a = headingRad;
    this.points = [{ x, z }];
  }
  straight(lengthM: number): this {
    const steps = Math.max(1, Math.round(lengthM / STRAIGHT_STEP_M));
    for (let i = 0; i < steps; i++) {
      this.x += (Math.cos(this.a) * lengthM) / steps;
      this.z += (Math.sin(this.a) * lengthM) / steps;
      this.points.push({ x: this.x, z: this.z });
    }
    return this;
  }
  /** `turn` > 0 turns right (clockwise on the map), < 0 left; degrees. */
  arc(radiusM: number, turnDeg: number): this {
    const sign = Math.sign(turnDeg);
    const steps = Math.max(1, Math.round(Math.abs(turnDeg) / ARC_STEP_DEG));
    const step = (turnDeg * Math.PI) / 180 / steps;
    // Centre sits to the side we turn toward.
    const cx = this.x - Math.sin(this.a) * radiusM * sign;
    const cz = this.z + Math.cos(this.a) * radiusM * sign;
    let angle = Math.atan2(this.z - cz, this.x - cx);
    for (let i = 0; i < steps; i++) {
      angle += step;
      this.a += step;
      this.x = cx + Math.cos(angle) * radiusM;
      this.z = cz + Math.sin(angle) * radiusM;
      this.points.push({ x: this.x, z: this.z });
    }
    return this;
  }
}

const LEAD_M = 200;
const COLUMN_A_X = 110;
const COLUMN_B_X = 620;
/** The car is dropped this far past the start of the lead-in. */
const PAD_OFFSET_M = 40;

interface StationSpec {
  readonly key: string;
  readonly id: string;
  readonly name: string;
  readonly note: string;
  readonly x0: number;
  readonly z: number;
  readonly build: (t: Turtle) => void;
  readonly widthM: number;
  /** Set when the station has a corner / take-off to count down to: extra metres past the lead-in's end. */
  readonly countdown?: number;
}

const STATION_SPECS: readonly StationSpec[] = [
  {
    key: "1",
    id: "right-90",
    name: "90 deg right (R25)",
    note: "Tight square-ish right-hander after a 160 m run-up.",
    x0: COLUMN_A_X,
    z: 130,
    widthM: 10,
    countdown: 0,
    build: (t) => t.straight(LEAD_M).arc(25, 90).straight(100),
  },
  {
    key: "2",
    id: "left-90",
    name: "90 deg left (R25)",
    note: "Mirror of station 1.",
    x0: COLUMN_B_X,
    z: 190,
    widthM: 10,
    countdown: 0,
    build: (t) => t.straight(LEAD_M).arc(25, -90).straight(100),
  },
  {
    key: "3",
    id: "sweeper-right",
    name: "Fast sweeper right (R120)",
    note: "Long 90 deg right for high-speed lift-off and throttle-on tests.",
    x0: COLUMN_A_X,
    z: 330,
    widthM: 12,
    countdown: 0,
    build: (t) => t.straight(LEAD_M).arc(120, 90).straight(100),
  },
  {
    key: "4",
    id: "hairpin",
    name: "Hairpin right (R30, 180 deg)",
    note: "Slow 180 for handbrake / pivot work.",
    x0: COLUMN_A_X,
    z: 640,
    widthM: 10,
    countdown: 0,
    build: (t) => t.straight(LEAD_M).arc(30, 180).straight(150),
  },
  {
    key: "5",
    id: "esses",
    name: "Esses (R80 right-left-right)",
    note: "Direction change at speed: weight transfer and recovery.",
    x0: COLUMN_B_X,
    z: 300,
    widthM: 12,
    countdown: 0,
    build: (t) => t.straight(LEAD_M).arc(80, 45).arc(80, -90).arc(80, 45).straight(80),
  },
  {
    key: "6",
    id: "tightening",
    name: "Tightening right (R150 into R50)",
    note: "Decreasing radius: the corner that catches you out.",
    x0: COLUMN_B_X,
    z: 460,
    widthM: 12,
    countdown: 0,
    build: (t) => t.straight(LEAD_M).arc(150, 45).arc(50, 45).straight(40),
  },
  {
    key: "7",
    id: "straight",
    name: "Long straight (330 m)",
    note: "Acceleration, top speed, braking, handbrake from speed.",
    x0: COLUMN_B_X,
    z: 640,
    widthM: 14,
    build: (t) => t.straight(330),
  },
  {
    key: "9",
    id: "jumps-a",
    name: "Hop (45 mph) then crest (50 mph)",
    note: "Two jumps in line: take-off, landing, settle, repeat.",
    x0: COLUMN_A_X,
    z: 870,
    widthM: 12,
    countdown: 8,
    build: (t) => t.straight(LEAD_M),
  },
  {
    key: "0",
    id: "jumps-b",
    name: "Kicker (25 mph) then big air (45 mph)",
    note: "Steep short ramp, then the big one: airborne attitude and landing.",
    x0: COLUMN_B_X,
    z: 980,
    widthM: 12,
    countdown: 8,
    build: (t) => t.straight(LEAD_M),
  },
];

/** Skid pan: a 160 m wide, 160 m long tarmac strip (x 1195..1355) east of column B. */
const SKID_X = 1275;
const SKID_PAD: TrackWay = {
  name: "skid pan",
  highway: "service",
  widthM: 160,
  surface: "asphalt",
  points: [
    { x: SKID_X, z: 340 },
    { x: SKID_X, z: 500 },
  ],
};
/** North-south spine joining the ring's top and bottom; column B hangs off it. */
const SPINE_X = 575;

const RING_INSET_M = 30;
const RING_RADIUS_M = 70;

function ringWays(): TrackWay[] {
  const x0 = RING_INSET_M;
  const x1 = WIDTH_M - RING_INSET_M;
  const z0 = RING_INSET_M;
  const z1 = DEPTH_M - RING_INSET_M;
  const r = RING_RADIUS_M;
  const along = (a: number, b: number): number => Math.abs(b - a) - 2 * r;
  const way = (name: string, surface: string, t: Turtle): TrackWay => ({
    name,
    highway: "residential",
    widthM: ROAD_WIDTH_M,
    surface,
    points: t.points,
  });
  // Clockwise from the north-west corner. The south side is gravel (the
  // course validator requires every route to touch a gravel or dirt edge).
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

export interface ProvingGround {
  readonly ways: readonly TrackWay[];
  readonly stations: readonly Station[];
}

export function buildProvingGround(): ProvingGround {
  const ways: TrackWay[] = [...ringWays()];
  const stations: Station[] = [];
  for (const spec of STATION_SPECS) {
    const t = new Turtle(spec.x0, spec.z);
    spec.build(t);
    ways.push({
      name: spec.id,
      highway: "residential",
      widthM: spec.widthM,
      surface: "asphalt",
      points: t.points,
    });
    stations.push({
      id: spec.id,
      key: spec.key,
      name: spec.name,
      note: spec.note,
      pad: { x: spec.x0 + PAD_OFFSET_M, z: spec.z },
      featureAheadM: spec.countdown === undefined ? 0 : LEAD_M - PAD_OFFSET_M + spec.countdown,
      widthM: spec.widthM,
    });
  }
  ways.push(SKID_PAD);
  // Everything must be one connected component or the map compiler prunes it.
  const ring = ways.slice(0, 4);
  const insertOnRing = (p: Point): void => {
    for (let w = 0; w < ring.length; w++) {
      const pts = [...ring[w].points];
      for (let i = 0; i + 1 < pts.length; i++) {
        const a = pts[i];
        const b = pts[i + 1];
        const cross = (b.x - a.x) * (p.z - a.z) - (b.z - a.z) * (p.x - a.x);
        const within =
          p.x >= Math.min(a.x, b.x) - 1e-6 &&
          p.x <= Math.max(a.x, b.x) + 1e-6 &&
          p.z >= Math.min(a.z, b.z) - 1e-6 &&
          p.z <= Math.max(a.z, b.z) + 1e-6;
        if (Math.abs(cross) < 1e-6 && within) {
          const onVertex = pts.some((q) => Math.hypot(q.x - p.x, q.z - p.z) < 1e-6);
          if (!onVertex) pts.splice(i + 1, 0, p);
          ring[w] = { ...ring[w], points: pts };
          ways[w] = ring[w];
          return;
        }
      }
    }
    throw new Error(`proving-ground: ${p.x},${p.z} is not on the ring`);
  };
  const feeder = (name: string, from: Point, to: Point): void => {
    ways.push({
      name,
      highway: "residential",
      widthM: ROAD_WIDTH_M,
      surface: "asphalt",
      points: [from, to],
    });
  };
  const spineZs: number[] = [RING_INSET_M];
  for (const spec of STATION_SPECS) {
    const start = { x: spec.x0, z: spec.z };
    if (spec.x0 === COLUMN_A_X) {
      const joint = { x: RING_INSET_M, z: spec.z };
      insertOnRing(joint);
      feeder(`feeder ${spec.id}`, joint, start);
    } else {
      const joint = { x: SPINE_X, z: spec.z };
      spineZs.push(spec.z);
      feeder(`feeder ${spec.id}`, joint, start);
    }
  }
  spineZs.push(DEPTH_M - RING_INSET_M);
  spineZs.sort((a, b) => a - b);
  ways.push({
    name: "spine",
    highway: "residential",
    widthM: ROAD_WIDTH_M,
    surface: "asphalt",
    points: spineZs.map((z) => ({ x: SPINE_X, z })),
  });
  feeder("feeder skid pan", { x: SKID_X, z: 500 }, { x: SKID_X, z: DEPTH_M - RING_INSET_M });
  stations.push({
    id: "skid-pan",
    key: "8",
    name: "Skid pan (160 x 160 m)",
    note: "Open tarmac: donuts, power slides, steady-state circles.",
    pad: { x: 1205, z: 420 },
    featureAheadM: 0,
    widthM: 12,
  });
  return { ways, stations };
}

const NODE_ID_BASE = 4_000_000;
const WAY_ID_BASE = 5_000_000;
const ENDPOINT = "synthetic://heat-street/feel-test";

export function provingGroundToEnvelopes(
  ground: ProvingGround,
  bbox: Bbox,
  fetchedAt: string,
): { roads: OverpassEnvelope; buildings: OverpassEnvelope } {
  const projector = makeProjector({
    lat: (bbox.south + bbox.north) / 2,
    lon: (bbox.west + bbox.east) / 2,
  });
  const toLatLon = (p: Point) => projector.unproject(p.x - WIDTH_M / 2, p.z - DEPTH_M / 2);
  // Shared endpoints (ring joints) must share a node id; key on rounded coordinates.
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
    roads: envelope("synthetic feel-test proving ground (code-generated, not OSM)", elements),
    buildings: envelope("synthetic feel-test buildings (none)", []),
  };
}
