/**
 * Pure, deterministic layout of the "straight-test" map: one 4 km, dead-straight,
 * 24 m wide asphalt road running east-west across flat ground, for testing
 * pursuit behaviour at sustained speed.
 *
 * A 500 m cross road closes each end (a T-junction, with room to turn round).
 * They are not decoration: the converter sizes the ground from the road
 * graph's bounds, so a single straight line would get a ground strip no wider
 * than itself. The cross roads make the ground 4 km x 500 m.
 *
 * The road is two ways joined 150 m in from the west end. The join is there on
 * purpose: the compiler's default spawn is "the junction node (degree >= 2)
 * nearest the map centre, heading along its first road edge", so the long way
 * comes FIRST and starts at the join. The car spawns 150 m from the west end
 * facing east with the other 3.85 km ahead of it.
 *
 * Coordinates are local: x east in [0, STRAIGHT_LENGTH_M], z south in
 * [0, STRAIGHT_DEPTH_M]; conversion to lat/lon recentres on the bbox centre.
 *
 * Layering: no fs, no network, no Math.random, no Date.
 */

import type { Bbox } from "../graph/build-graph.ts";
import { makeProjector } from "../graph/project.ts";
import type { OverpassEnvelope } from "../sources/overpass.ts";
import type { Point, TrackWay } from "./proving-ground.ts";

export const STRAIGHT_LENGTH_M = 4000;
export const STRAIGHT_DEPTH_M = 500;
export const STRAIGHT_ROAD_WIDTH_M = 24;
/** Distance from the west end to the join (and so to the spawn). */
export const STRAIGHT_SPAWN_INSET_M = 150;

export interface StraightRoad {
  readonly ways: readonly TrackWay[];
}

export function buildStraightRoad(): StraightRoad {
  const z = STRAIGHT_DEPTH_M / 2;
  const join: Point = { x: STRAIGHT_SPAWN_INSET_M, z };
  const way = (name: string, points: readonly Point[]): TrackWay => ({
    name,
    highway: "motorway",
    widthM: STRAIGHT_ROAD_WIDTH_M,
    surface: "asphalt",
    points,
  });
  // A N-S road through each end node, split there so the end node is shared.
  const cross = (name: string, x: number): TrackWay[] => {
    const mid: Point = { x, z };
    return [
      way(`${name} north`, [{ x, z: 0 }, mid]),
      way(`${name} south`, [mid, { x, z: STRAIGHT_DEPTH_M }]),
    ];
  };
  return {
    ways: [
      // Long way first: the default spawn heads along the first incident edge.
      way("straight", [join, { x: STRAIGHT_LENGTH_M, z }]),
      way("straight west end", [{ x: 0, z }, join]),
      ...cross("west cross road", 0),
      ...cross("east cross road", STRAIGHT_LENGTH_M),
    ],
  };
}

const NODE_ID_BASE = 8_000_000;
const WAY_ID_BASE = 9_000_000;
const ENDPOINT = "synthetic://heat-street/straight-test";

export function straightToEnvelopes(
  road: StraightRoad,
  bbox: Bbox,
  fetchedAt: string,
): { roads: OverpassEnvelope; buildings: OverpassEnvelope } {
  const projector = makeProjector({
    lat: (bbox.south + bbox.north) / 2,
    lon: (bbox.west + bbox.east) / 2,
  });
  const toLatLon = (p: Point) =>
    projector.unproject(p.x - STRAIGHT_LENGTH_M / 2, p.z - STRAIGHT_DEPTH_M / 2);
  // Shared endpoints (the join) must share a node id; key on rounded coordinates.
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
  const elements = road.ways.map((w, i) => ({
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
    roads: envelope("synthetic straight-test (code-generated, not OSM)", elements),
    buildings: envelope("synthetic straight-test buildings (none)", []),
  };
}
