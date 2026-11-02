/**
 * Pure construction of a flat, empty terrain area for the sculpt page's
 * "New..." flow. No DOM so it is unit-tested.
 *
 * The road graph's bounds equal the grid extent (D-12): graph operations never
 * change them, so any Drive-here coordinate on the grid is accepted and the
 * sidecar passes loadTerrainArea's bounds check.
 *
 * Cells are square, so width/depth snap to a whole number of cells (e.g. a
 * 400 m depth at 3 m cells becomes 133 rows = 399 m); the bounds follow the
 * snapped grid, never the requested size.
 */
import type { RoadGraph } from "../../src/core/road-graph.ts";
import { ROAD_GRAPH_SCHEMA_VERSION } from "../../src/core/road-graph.ts";
import { MAX_TERRAIN_VERTICES, type TerrainArea } from "../../src/core/terrain-format.ts";
import { createTerrainGrid } from "../../src/core/terrain-grid.ts";
import { DEFAULT_PAINT_METRES_PER_PIXEL, MAX_AREA_SIZE_M } from "../../src/core/terrain-limits.ts";
import { createPaintMap, MAX_PAINT_PIXELS } from "../../src/core/terrain-paint.ts";

export interface NewAreaOptions {
  areaId: string;
  widthM: number;
  depthM: number;
  cellSizeM: number;
}

export function createEmptyTerrainArea(opts: NewAreaOptions): TerrainArea {
  const { areaId, widthM, depthM, cellSizeM } = opts;
  for (const [label, v] of [
    ["widthM", widthM],
    ["depthM", depthM],
  ] as const) {
    if (!Number.isFinite(v) || v <= 0 || v > MAX_AREA_SIZE_M) {
      throw new RangeError(`${label} must be in (0, ${MAX_AREA_SIZE_M}] m, got ${v}`);
    }
  }
  if (!Number.isFinite(cellSizeM) || cellSizeM <= 0) {
    throw new RangeError(`cellSizeM must be finite and > 0, got ${cellSizeM}`);
  }
  const cols = Math.max(1, Math.round(widthM / cellSizeM));
  const rows = Math.max(1, Math.round(depthM / cellSizeM));
  // CR-02: refuse grids the encoder can never save (its cap is stricter than
  // createTerrainGrid's), so no sculpting work is ever trapped unsaveable.
  const vertices = (rows + 1) * (cols + 1);
  if (vertices > MAX_TERRAIN_VERTICES) {
    throw new RangeError(
      `${cols}x${rows} cells is ${vertices} vertices, max ${MAX_TERRAIN_VERTICES}; use a larger cell size`,
    );
  }
  const scaleX = cols * cellSizeM;
  const scaleZ = rows * cellSizeM;
  const paintPixels =
    Math.ceil(scaleX / DEFAULT_PAINT_METRES_PER_PIXEL) *
    Math.ceil(scaleZ / DEFAULT_PAINT_METRES_PER_PIXEL);
  if (paintPixels > MAX_PAINT_PIXELS) {
    throw new RangeError(`paint map would be ${paintPixels} pixels, max ${MAX_PAINT_PIXELS}`);
  }
  const originX = -scaleX / 2;
  const originZ = -scaleZ / 2;
  const grid = createTerrainGrid({ rows, cols, cellSizeM, originX, originZ });
  const paint = createPaintMap({
    originX,
    originZ,
    widthM: scaleX,
    depthM: scaleZ,
    metresPerPixel: DEFAULT_PAINT_METRES_PER_PIXEL,
    fill: "grass",
  });
  const graph: RoadGraph = {
    schemaVersion: ROAD_GRAPH_SCHEMA_VERSION,
    areaId,
    name: areaId,
    source: {
      osmExtract: "none",
      osmSnapshot: "none",
      demSource: "authored in terrain editor",
      compilerVersion: "terrain-editor",
    },
    attribution: { osm: "", osmLicense: "", osmLicenseUrl: "", dem: "" },
    origin: { lat: 0, lon: 0, projection: "local" },
    bounds: {
      minX: grid.originX,
      minZ: grid.originZ,
      maxX: grid.originX + grid.scaleX,
      maxZ: grid.originZ + grid.scaleZ,
    },
    nodes: [],
    edges: [],
  };
  return {
    areaId,
    name: areaId,
    grid,
    paint,
    colliderSubdiv: 2,
    groundSurface: "grass",
    legacyGlbBuildings: false,
    nextEdgeId: 0,
    graph,
    objects: [],
    buildings: [],
  };
}
