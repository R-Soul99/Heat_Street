/**
 * Compiled map -> terrain area converter (phase 04.2, plan 11; D-05, D-06, D-07).
 *
 * Takes the legacy compiled artifacts of a map (road graph + collision sidecar
 * with its DEM heightfield) and produces the same map in the terrain format:
 * a uniform height grid whose road bands are levelled to the graph's own
 * heights, a surface paint map with every road rasterised into it, and a
 * sidecar that carries the graph VERBATIM (ids preserved so routes and
 * checkpoints resolve unchanged), crests as objects and buildings as boxes.
 *
 * Pure and deterministic: no filesystem, no clock, no randomness. The CLI
 * (`cli.ts`) owns all I/O.
 */

import type { AuthoredCrest } from "../../../src/core/crest-geometry.ts";
import { groundSurfaceForArea, isFlatTestArea } from "../../../src/core/ground-surface.ts";
import { sampleHeightfieldBilinear } from "../../../src/core/heightfield-sample.ts";
import type { MapCollision } from "../../../src/core/map-collision.ts";
import type { RoadGraph, RoadGraphBounds, RoadGraphEdge } from "../../../src/core/road-graph.ts";
import type { TerrainArea } from "../../../src/core/terrain-format.ts";
import { createTerrainGrid, type TerrainGrid } from "../../../src/core/terrain-grid.ts";
import { DEFAULT_COLLIDER_SUBDIV } from "../../../src/core/terrain-limits.ts";
import {
  createPaintMap,
  decodePaintSurface,
  encodePaintValue,
  PAINT_ROAD_FLAG,
  type PaintMap,
} from "../../../src/core/terrain-paint.ts";
import { levelRoadBand, roadLevelRadiusM } from "../../../src/core/terrain-road.ts";

export type ConvertibleAreaId =
  | "feel-test"
  | "grid-test"
  | "juliette-ga"
  | "playground"
  | "straight-test"
  | "arena-test";

export interface ConvertConfig {
  readonly cellSizeM: number;
  readonly paintMetresPerPixel: number;
  readonly legacyGlbBuildings: boolean;
  /**
   * Extra total road width (metres) applied to the levelled band and the paint,
   * half on each side (04.3 D-11). The graph's own widthM is never changed.
   */
  readonly roadWidenM: number;
}

/**
 * D-02: 3 m cells by default, coarser for big maps. Juliette at 8 m gives about
 * 487k vertices (closest to the D-04 envelope); paint stays 0.5 m/px.
 */
export const CONVERT_CONFIG: Readonly<Record<ConvertibleAreaId, ConvertConfig>> = {
  "feel-test": { cellSizeM: 3, paintMetresPerPixel: 0.5, legacyGlbBuildings: false, roadWidenM: 0 },
  playground: { cellSizeM: 3, paintMetresPerPixel: 0.5, legacyGlbBuildings: false, roadWidenM: 0 },
  "straight-test": {
    cellSizeM: 3,
    paintMetresPerPixel: 0.5,
    legacyGlbBuildings: false,
    roadWidenM: 0,
  },
  "arena-test": {
    cellSizeM: 3,
    paintMetresPerPixel: 0.5,
    legacyGlbBuildings: false,
    roadWidenM: 0,
  },
  "grid-test": { cellSizeM: 3, paintMetresPerPixel: 0.5, legacyGlbBuildings: true, roadWidenM: 2 },
  "juliette-ga": {
    cellSizeM: 8,
    paintMetresPerPixel: 0.5,
    legacyGlbBuildings: true,
    roadWidenM: 2,
  },
};

/** Most grid vertices an authored map's default grid aims for (Juliette at 8 m is ~487k). */
export const AUTHORED_TARGET_VERTICES = 450_000;
/** Most paint pixels an authored map's default paint map aims for (a 2 km square at 0.5 m). */
export const AUTHORED_TARGET_PAINT_PIXELS = 16_000_000;

const roundUpToHalf = (v: number): number => Math.ceil(v * 2) / 2;

/**
 * Default conversion settings for a map made in the editors (any id on the
 * authored list). 3 m cells for anything up to about 2 km square (about 445k
 * vertices there); bigger maps get coarser cells so the grid stays near
 * AUTHORED_TARGET_VERTICES. Paint is 0.5 m per pixel unless that would pass
 * AUTHORED_TARGET_PAINT_PIXELS. Pure: depends only on the extents.
 */
export function authoredConvertConfig(
  extentXM: number,
  extentZM: number,
  hasBuildings: boolean,
): ConvertConfig {
  const area = Math.max(1, extentXM) * Math.max(1, extentZM);
  return {
    cellSizeM: Math.max(3, roundUpToHalf(Math.sqrt(area / AUTHORED_TARGET_VERTICES))),
    paintMetresPerPixel: Math.max(
      0.5,
      roundUpToHalf(Math.sqrt(area / AUTHORED_TARGET_PAINT_PIXELS)),
    ),
    legacyGlbBuildings: hasBuildings,
    roadWidenM: 2,
  };
}

export interface ConvertInput {
  readonly areaId: string;
  /**
   * Settings for a map that is not in CONVERT_CONFIG. Only the authored-map
   * wrapper (convert-authored.ts) passes this, after an exact registry match.
   */
  readonly config?: ConvertConfig;
  /**
   * Ground extent override. Authored maps pass groundBounds(graph) (every road
   * point plus a margin) so no road runs off the ground; builtin maps omit it
   * and keep graph.bounds, so their committed terrain stays byte-identical.
   */
  readonly bounds?: RoadGraphBounds;
  readonly graph: RoadGraph;
  readonly collision: MapCollision;
  readonly crests: readonly AuthoredCrest[];
}

function configFor(areaId: string, override?: ConvertConfig): ConvertConfig {
  if (override !== undefined) return override;
  const cfg = (CONVERT_CONFIG as Readonly<Record<string, ConvertConfig | undefined>>)[areaId];
  if (cfg === undefined || !Object.hasOwn(CONVERT_CONFIG, areaId)) {
    throw new RangeError(`convert: no CONVERT_CONFIG for area "${areaId}"`);
  }
  return cfg;
}

interface XZ {
  x: number;
  z: number;
}

function edgeXZ(e: RoadGraphEdge): XZ[] {
  return e.points.map((p) => ({ x: p[0], z: p[2] }));
}

/** Road width used for levelling and paint: graph width plus the area's roadWidenM. */
function bandWidthM(e: RoadGraphEdge, cfg: ConvertConfig): number {
  return e.widthM + cfg.roadWidenM;
}

/** Largest half width of the edges touching `nodeId`. */
function incidentHalfWidth(graph: RoadGraph, nodeId: number, cfg: ConvertConfig): number {
  let w = 0;
  for (const e of graph.edges)
    if (e.from === nodeId || e.to === nodeId) w = Math.max(w, bandWidthM(e, cfg));
  return w / 2;
}

/**
 * Steps (1), (2) and (4) of the conversion, without paint: grid over the graph
 * bounds, base heights (flat areas exactly 0, otherwise legacy heightfield with
 * its sink removed), then every road band levelled to the graph heights.
 */
export function convertHeights(input: ConvertInput): TerrainGrid {
  const { areaId, graph, collision } = input;
  const cfg = configFor(areaId, input.config);
  const cell = cfg.cellSizeM;
  const b = input.bounds ?? graph.bounds;
  const cols = Math.max(1, Math.ceil((b.maxX - b.minX) / cell));
  const rows = Math.max(1, Math.ceil((b.maxZ - b.minZ) / cell));
  const grid = createTerrainGrid({ rows, cols, cellSizeM: cell, originX: b.minX, originZ: b.minZ });

  const stride = rows + 1;
  const flat = isFlatTestArea(areaId);
  const legacy = collision.heightfield;
  if (!flat && legacy !== undefined) {
    for (let c = 0; c <= cols; c++) {
      const x = grid.originX + c * cell;
      for (let r = 0; r <= rows; r++) {
        const z = grid.originZ + r * cell;
        grid.heights[r + c * stride] = sampleHeightfieldBilinear(legacy, x, z) + legacy.sinkM;
      }
    }
  }

  const shoulder = 2 * cell;
  const protect = new Uint8Array(grid.heights.length);
  const mergeProtect = (mask: Uint8Array): void => {
    for (let i = 0; i < mask.length; i++) if (mask[i] !== 0) protect[i] = 1;
  };

  const edges = graph.edges.slice().sort((a, c) => a.id - c.id);
  for (const e of edges) {
    if (e.points.length < 2) continue;
    const pts = edgeXZ(e);
    const heights = e.points.map((p) => p[1]);
    const banks = e.points.map(() => 0);
    const res = levelRoadBand(grid, pts, heights, banks, bandWidthM(e, cfg) / 2, shoulder, {
      protect,
    });
    mergeProtect(res.mask);
  }

  for (const n of graph.nodes) {
    if (!n.junction) continue;
    const half = incidentHalfWidth(graph, n.id, cfg);
    if (!(half > 0)) continue;
    const eps = 0.01;
    const res = levelRoadBand(
      grid,
      [
        { x: n.x - eps, z: n.z },
        { x: n.x + eps, z: n.z },
      ],
      [n.y, n.y],
      [0, 0],
      roadLevelRadiusM(half, cell),
      shoulder,
      { protect },
    );
    mergeProtect(res.mask);
  }

  // Normalise negative zero so flat areas are exactly +0 (Object.is).
  for (let i = 0; i < grid.heights.length; i++) if (grid.heights[i] === 0) grid.heights[i] = 0;
  return grid;
}

/**
 * Writes `value` into a pixel unless a road already holds it: paved (tarmac)
 * wins over unpaved on overlap, ties keep the first.
 */
function putRoadPixel(paint: PaintMap, index: number, value: number): void {
  const cur = paint.data[index];
  if ((cur & PAINT_ROAD_FLAG) === 0) {
    paint.data[index] = value;
    return;
  }
  const curTarmac = decodePaintSurface(cur) === "tarmac";
  const newTarmac = decodePaintSurface(value) === "tarmac";
  if (newTarmac && !curTarmac) paint.data[index] = value;
}

function rasteriseCapsule(paint: PaintMap, p: XZ, q: XZ, radius: number, value: number): void {
  const m = paint.metresPerPixel;
  const minPx = Math.max(0, Math.floor((Math.min(p.x, q.x) - radius - paint.originX) / m));
  const maxPx = Math.min(
    paint.width - 1,
    Math.ceil((Math.max(p.x, q.x) + radius - paint.originX) / m),
  );
  const minPz = Math.max(0, Math.floor((Math.min(p.z, q.z) - radius - paint.originZ) / m));
  const maxPz = Math.min(
    paint.height - 1,
    Math.ceil((Math.max(p.z, q.z) + radius - paint.originZ) / m),
  );
  const dx = q.x - p.x;
  const dz = q.z - p.z;
  const len2 = dx * dx + dz * dz;
  const r2 = radius * radius;
  for (let pz = minPz; pz <= maxPz; pz++) {
    const z = paint.originZ + (pz + 0.5) * m;
    for (let px = minPx; px <= maxPx; px++) {
      const x = paint.originX + (px + 0.5) * m;
      const t = len2 > 0 ? Math.min(1, Math.max(0, ((x - p.x) * dx + (z - p.z) * dz) / len2)) : 0;
      const ex = x - (p.x + dx * t);
      const ez = z - (p.z + dz * t);
      if (ex * ex + ez * ez <= r2) putRoadPixel(paint, pz * paint.width + px, value);
    }
  }
}

function rasteriseRoads(paint: PaintMap, graph: RoadGraph, cfg: ConvertConfig): void {
  const edges = graph.edges.slice().sort((a, c) => a.id - c.id);
  for (const e of edges) {
    const value = encodePaintValue(e.surface, true);
    const pts = edgeXZ(e);
    for (let k = 0; k + 1 < pts.length; k++) {
      rasteriseCapsule(paint, pts[k], pts[k + 1], bandWidthM(e, cfg) / 2, value);
    }
  }
  for (const n of graph.nodes) {
    if (!n.junction) continue;
    const half = incidentHalfWidth(graph, n.id, cfg);
    if (!(half > 0)) continue;
    let surface = null as RoadGraphEdge["surface"] | null;
    for (const e of edges) {
      if (e.from !== n.id && e.to !== n.id) continue;
      if (surface === null) surface = e.surface;
      if (e.surface === "tarmac") surface = "tarmac";
    }
    if (surface === null) continue;
    const p = { x: n.x, z: n.z };
    rasteriseCapsule(paint, p, p, half, encodePaintValue(surface, true));
  }
}

export function convertCompiledArea(input: ConvertInput): TerrainArea {
  const { areaId, graph, collision, crests } = input;
  const cfg = configFor(areaId, input.config);
  const grid = convertHeights(input);
  const groundSurface = groundSurfaceForArea(areaId);
  const paint = createPaintMap({
    originX: grid.originX,
    originZ: grid.originZ,
    widthM: grid.scaleX,
    depthM: grid.scaleZ,
    metresPerPixel: cfg.paintMetresPerPixel,
    fill: groundSurface,
  });
  rasteriseRoads(paint, graph, cfg);

  let maxEdgeId = -1;
  for (const e of graph.edges) if (e.id > maxEdgeId) maxEdgeId = e.id;

  return {
    areaId,
    name: graph.name,
    grid,
    paint,
    colliderSubdiv: DEFAULT_COLLIDER_SUBDIV,
    groundSurface,
    graph,
    objects: crests.map((crest) => ({ kind: "crest" as const, crest })),
    buildings: collision.buildings,
    legacyGlbBuildings: cfg.legacyGlbBuildings,
    nextEdgeId: maxEdgeId + 1,
  };
}
