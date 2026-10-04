/**
 * Pure, deterministic layout of the synthetic "grid-test" city and its
 * conversion to Overpass-shaped envelopes (the raw-cache format the map
 * compiler already consumes).
 *
 * Layout: 8 block rows (4 north + 4 south of a central motorway). The
 * motorway is street index `motorwayStreetIndex` (4 of 0..8), a wide open
 * tarmac strip running the full width of the map with no buildings beside it
 * (blocks facing it use `motorwaySetbackM`) and no obstacles on it. Every
 * other row has its own block length (base, 1.25x base, base/1.5 cycling by
 * row index) and its own phase offset, so verticals of adjacent rows do not
 * line up: the horizontal streets carry crossroads (where a vertical snaps to
 * the neighbour row's x), staggered T-junctions and short doglegs.
 *
 * Coordinates are local: x in [0, widthM] east, z in [0, depthM] southward;
 * conversion to lat/lon recentres on the bbox centre.
 *
 * Layering: no fs, no network, no Math.random, no Date. NOT mechanically
 * enforced for `tools/**`.
 */

import type { Bbox } from "../graph/build-graph.ts";
import { makeProjector } from "../graph/project.ts";
import type { OverpassEnvelope } from "../sources/overpass.ts";

export interface StreetClass {
  readonly name: string;
  readonly highway: string;
  readonly widthM: number;
  readonly surface: string;
}

export const STREET_CLASSES = {
  motorway: { name: "motorway", highway: "motorway", widthM: 24, surface: "asphalt" },
  boulevard: { name: "boulevard", highway: "primary", widthM: 14, surface: "asphalt" },
  avenue: { name: "avenue", highway: "secondary", widthM: 10.5, surface: "asphalt" },
  street: { name: "street", highway: "residential", widthM: 7, surface: "asphalt" },
  lane: { name: "lane", highway: "residential", widthM: 5, surface: "asphalt" },
  alley: { name: "alley", highway: "unclassified", widthM: 4.5, surface: "gravel" },
} as const satisfies Record<string, StreetClass>;

export type StreetClassName = keyof typeof STREET_CLASSES;

export interface GridLayoutParams {
  /** Total map width (east-west), metres. */
  readonly widthM: number;
  /** Number of block rows (must be even; the motorway sits in the middle). */
  readonly rows: number;
  readonly baseBlockLengthM: number;
  /** Cycled by row index. */
  readonly lengthMultipliers: readonly number[];
  /** Cycled by row index. */
  readonly rowDepthsM: readonly number[];
  /** Cycled by row index; phase = fraction * that row's block length. */
  readonly rowPhaseFractions: readonly number[];
  readonly minIntersectionGapM: number;
  readonly buildingSetbackM: number;
  /** Setback (from the motorway's edge) for blocks facing the motorway. */
  readonly motorwaySetbackM: number;
  /** Horizontal street index carrying the motorway, or -1 for none. */
  readonly motorwayStreetIndex: number;
  /** Cycled by horizontal street index (the motorway index is overridden). */
  readonly horizontalClasses: readonly StreetClassName[];
  /** Cycled by interior column index k within a row. */
  readonly verticalClasses: readonly StreetClassName[];
  readonly eastPerimeterClass: StreetClassName;
  readonly heightSeed: number;
}

export const GRID_TEST_LAYOUT_PARAMS: GridLayoutParams = {
  widthM: 720,
  rows: 8,
  baseBlockLengthM: 90,
  lengthMultipliers: [1, 1.25, 1 / 1.5],
  rowDepthsM: [70, 90, 60],
  rowPhaseFractions: [0.35, 0.8, 0.5, 0.15, 0.6, 0.25, 0.7, 0.45],
  minIntersectionGapM: 22,
  buildingSetbackM: 6,
  motorwaySetbackM: 25,
  motorwayStreetIndex: 4,
  horizontalClasses: [
    "avenue",
    "street",
    "boulevard",
    "lane",
    "motorway",
    "lane",
    "boulevard",
    "street",
    "avenue",
  ],
  verticalClasses: ["street", "lane", "avenue", "street", "lane"],
  eastPerimeterClass: "avenue",
  heightSeed: 7,
};

export interface HorizontalStreet {
  readonly index: number;
  readonly z: number;
  readonly cls: StreetClass;
  /** All intersection x positions on this street, sorted ascending, including 0 and widthM. */
  readonly xs: readonly number[];
}

export interface VerticalSegment {
  readonly row: number;
  readonly x: number;
  readonly zTop: number;
  readonly zBottom: number;
  readonly cls: StreetClass;
  readonly isPerimeter: boolean;
}

export interface BlockRect {
  readonly row: number;
  readonly col: number;
  readonly xMin: number;
  readonly xMax: number;
  readonly zMin: number;
  readonly zMax: number;
  readonly westClass: StreetClass;
  readonly eastClass: StreetClass;
  readonly northClass: StreetClass;
  readonly southClass: StreetClass;
  readonly northIsMotorway: boolean;
  readonly southIsMotorway: boolean;
}

export interface GridLayout {
  readonly params: GridLayoutParams;
  readonly widthM: number;
  readonly depthM: number;
  readonly rowBlockLengthsM: readonly number[];
  readonly horizontals: readonly HorizontalStreet[];
  readonly verticals: readonly VerticalSegment[];
  readonly blocks: readonly BlockRect[];
}

function cycle<T>(values: readonly T[], index: number): T {
  return values[index % values.length];
}

export function buildGridLayout(params: GridLayoutParams): GridLayout {
  const { widthM: W, rows, minIntersectionGapM: gap } = params;

  const rowDepths: number[] = [];
  for (let r = 0; r < rows; r++) rowDepths.push(cycle(params.rowDepthsM, r));
  const streetZ: number[] = [0];
  for (let r = 0; r < rows; r++) streetZ.push(streetZ[r] + rowDepths[r]);
  const depthM = streetZ[rows];

  const rowBlockLengthsM: number[] = [];
  /** Interior vertical xs (+ their column index k) per row, after snapping. */
  const interior: { x: number; k: number }[][] = [];
  for (let r = 0; r < rows; r++) {
    const len = params.baseBlockLengthM * cycle(params.lengthMultipliers, r);
    rowBlockLengthsM.push(len);
    const phase = cycle(params.rowPhaseFractions, r) * len;
    const list: { x: number; k: number }[] = [];
    for (let k = 0; phase + k * len < W - gap; k++) {
      let x = phase + k * len;
      if (x <= gap) continue;
      if (r > 0) {
        for (const prev of interior[r - 1]) {
          if (Math.abs(x - prev.x) < gap) {
            x = prev.x;
            break;
          }
        }
      }
      list.push({ x, k });
    }
    interior.push(list);
  }

  const horizontals: HorizontalStreet[] = [];
  for (let h = 0; h <= rows; h++) {
    const set = new Set<number>([0, W]);
    if (h > 0) for (const v of interior[h - 1]) set.add(v.x);
    if (h < rows) for (const v of interior[h]) set.add(v.x);
    const xs = [...set].sort((a, b) => a - b);
    for (let i = 1; i < xs.length; i++) {
      if (xs[i] - xs[i - 1] < gap) {
        throw new Error(
          `buildGridLayout: street ${h} has intersections ${xs[i - 1]} and ${xs[i]} closer than ${gap}m`,
        );
      }
    }
    const className =
      h === params.motorwayStreetIndex ? "motorway" : cycle(params.horizontalClasses, h);
    horizontals.push({ index: h, z: streetZ[h], cls: STREET_CLASSES[className], xs });
  }

  const verticals: VerticalSegment[] = [];
  const blocks: BlockRect[] = [];
  for (let r = 0; r < rows; r++) {
    const zTop = streetZ[r];
    const zBottom = streetZ[r + 1];
    const west: VerticalSegment = {
      row: r,
      x: 0,
      zTop,
      zBottom,
      cls: STREET_CLASSES.alley,
      isPerimeter: true,
    };
    const east: VerticalSegment = {
      row: r,
      x: W,
      zTop,
      zBottom,
      cls: STREET_CLASSES[params.eastPerimeterClass],
      isPerimeter: true,
    };
    const inner: VerticalSegment[] = interior[r].map((v) => ({
      row: r,
      x: v.x,
      zTop,
      zBottom,
      cls: STREET_CLASSES[cycle(params.verticalClasses, v.k)],
      isPerimeter: false,
    }));
    const rowVerticals = [west, ...inner, east];
    verticals.push(...rowVerticals);
    for (let c = 0; c + 1 < rowVerticals.length; c++) {
      blocks.push({
        row: r,
        col: c,
        xMin: rowVerticals[c].x,
        xMax: rowVerticals[c + 1].x,
        zMin: zTop,
        zMax: zBottom,
        westClass: rowVerticals[c].cls,
        eastClass: rowVerticals[c + 1].cls,
        northClass: horizontals[r].cls,
        southClass: horizontals[r + 1].cls,
        northIsMotorway: r === params.motorwayStreetIndex,
        southIsMotorway: r + 1 === params.motorwayStreetIndex,
      });
    }
  }

  return { params, widthM: W, depthM, rowBlockLengthsM, horizontals, verticals, blocks };
}

export interface IntersectionSummary {
  readonly crossroads: number;
  readonly tJunctions: number;
  readonly doglegs: number;
  readonly byStreet: readonly {
    readonly crossroads: number;
    readonly tJunctions: number;
    readonly doglegs: number;
  }[];
}

/** Classifies INTERIOR intersections (perimeter verticals excluded) per horizontal street. */
export function classifyIntersections(layout: GridLayout): IntersectionSummary {
  const byStreet: { crossroads: number; tJunctions: number; doglegs: number }[] = [];
  const gap = layout.params.minIntersectionGapM;
  for (const h of layout.horizontals) {
    const above = new Set(
      layout.verticals.filter((v) => v.row === h.index - 1 && !v.isPerimeter).map((v) => v.x),
    );
    const below = new Set(
      layout.verticals.filter((v) => v.row === h.index && !v.isPerimeter).map((v) => v.x),
    );
    let crossroads = 0;
    let tJunctions = 0;
    const aboveOnly: number[] = [];
    const belowOnly: number[] = [];
    for (const x of new Set([...above, ...below])) {
      if (above.has(x) && below.has(x)) crossroads++;
      else {
        tJunctions++;
        (above.has(x) ? aboveOnly : belowOnly).push(x);
      }
    }
    let doglegs = 0;
    for (const a of aboveOnly) {
      if (belowOnly.some((b) => Math.abs(a - b) <= 2 * gap)) doglegs++;
    }
    byStreet.push({ crossroads, tJunctions, doglegs });
  }
  return {
    crossroads: byStreet.reduce((s, b) => s + b.crossroads, 0),
    tJunctions: byStreet.reduce((s, b) => s + b.tJunctions, 0),
    doglegs: byStreet.reduce((s, b) => s + b.doglegs, 0),
    byStreet,
  };
}

function hash32(a: number, b: number, c: number): number {
  let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x7f4a7c15, 0xc2b2ae35);
  h ^= Math.imul(c + 1, 0x27d4eb2f);
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 12;
  return h >>> 0;
}

const NODE_ID_BASE = 1_000_000;
export const HORIZONTAL_WAY_ID_BASE = 2_000_000;
export const VERTICAL_WAY_ID_BASE = 2_100_000;
const BUILDING_WAY_ID_BASE = 3_000_000;
const ENDPOINT = "synthetic://heat-street/grid-test";

interface LatLon {
  lat: number;
  lon: number;
}

export function gridLayoutToEnvelopes(
  layout: GridLayout,
  bbox: Bbox,
  fetchedAt: string,
): { roads: OverpassEnvelope; buildings: OverpassEnvelope } {
  const projector = makeProjector({
    lat: (bbox.south + bbox.north) / 2,
    lon: (bbox.west + bbox.east) / 2,
  });
  const toLatLon = (x: number, z: number): LatLon =>
    projector.unproject(x - layout.widthM / 2, z - layout.depthM / 2);

  const nodeIds = new Map<string, number>();
  let nextNode = NODE_ID_BASE;
  const nodeId = (street: number, x: number): number => {
    const key = `${street}:${x}`;
    let id = nodeIds.get(key);
    if (id === undefined) {
      id = nextNode++;
      nodeIds.set(key, id);
    }
    return id;
  };

  const roadElements: unknown[] = [];
  for (const h of layout.horizontals) {
    roadElements.push({
      type: "way",
      id: HORIZONTAL_WAY_ID_BASE + h.index,
      nodes: h.xs.map((x) => nodeId(h.index, x)),
      geometry: h.xs.map((x) => toLatLon(x, h.z)),
      tags: {
        highway: h.cls.highway,
        width: String(h.cls.widthM),
        surface: h.cls.surface,
        name: `${h.cls.name} ${h.index}`,
      },
    });
  }
  layout.verticals.forEach((v, i) => {
    roadElements.push({
      type: "way",
      id: VERTICAL_WAY_ID_BASE + i,
      nodes: [nodeId(v.row, v.x), nodeId(v.row + 1, v.x)],
      geometry: [toLatLon(v.x, v.zTop), toLatLon(v.x, v.zBottom)],
      tags: {
        highway: v.cls.highway,
        width: String(v.cls.widthM),
        surface: v.cls.surface,
        name: `${v.cls.name} r${v.row} x${Math.round(v.x)}`,
      },
    });
  });

  const buildingElements: unknown[] = [];
  let nextBuilding = BUILDING_WAY_ID_BASE;
  const seed = layout.params.heightSeed;
  layout.blocks.forEach((b, blockIndex) => {
    const set = layout.params.buildingSetbackM;
    const mset = layout.params.motorwaySetbackM;
    const x0 = b.xMin + b.westClass.widthM / 2 + set;
    const x1 = b.xMax - b.eastClass.widthM / 2 - set;
    const z0 = b.zMin + b.northClass.widthM / 2 + (b.northIsMotorway ? mset : set);
    const z1 = b.zMax - b.southClass.widthM / 2 - (b.southIsMotorway ? mset : set);
    const w = x1 - x0;
    const d = z1 - z0;
    if (w < 8 || d < 8) return;
    const alongX = w >= d;
    const longLen = alongX ? w : d;
    const count = Math.max(1, Math.min(3, Math.floor(longLen / 30)));
    const gapM = 4;
    const boxLen = (longLen - gapM * (count - 1)) / count;
    for (let i = 0; i < count; i++) {
      const off = i * (boxLen + gapM);
      const bx0 = alongX ? x0 + off : x0;
      const bx1 = alongX ? bx0 + boxLen : x1;
      const bz0 = alongX ? z0 : z0 + off;
      const bz1 = alongX ? z1 : bz0 + boxLen;
      if (bx1 - bx0 < 8 || bz1 - bz0 < 8) continue;
      const height = 6 + (hash32(seed, blockIndex, i) % 19);
      const ring = [
        toLatLon(bx0, bz0),
        toLatLon(bx1, bz0),
        toLatLon(bx1, bz1),
        toLatLon(bx0, bz1),
        toLatLon(bx0, bz0),
      ];
      buildingElements.push({
        type: "way",
        id: nextBuilding++,
        geometry: ring,
        tags: { building: "yes", height: String(height) },
      });
    }
  });

  const envelope = (query: string, elements: unknown[]): OverpassEnvelope => ({
    fetchedAt,
    endpoint: ENDPOINT,
    bbox,
    query,
    response: { elements },
  });
  return {
    roads: envelope("synthetic grid-test road network (code-generated, not OSM)", roadElements),
    buildings: envelope(
      "synthetic grid-test buildings (code-generated, not OSM)",
      buildingElements,
    ),
  };
}
