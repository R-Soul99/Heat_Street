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

const NAME_RULE = /^[a-z0-9-]{1,64}$/;

/**
 * Pure validation for the New popup. Returns a readable message or null.
 * The real builder is tried last so its own limits (vertex cap, paint cap)
 * are reported verbatim.
 */
export function validateNewTerrainArea(
  input: { name: string; widthM: number; depthM: number; cellSizeM: number },
  existingNames: readonly string[],
): string | null {
  if (!NAME_RULE.test(input.name)) {
    return "Give the area a name: 1-64 characters, a-z, 0-9 and - only.";
  }
  const sizeOk = (v: number) => Number.isFinite(v) && v > 0 && v <= MAX_AREA_SIZE_M;
  if (!sizeOk(input.widthM)) {
    return `Width must be more than 0 and at most ${MAX_AREA_SIZE_M} m.`;
  }
  if (!sizeOk(input.depthM)) {
    return `Height (north-south) must be more than 0 and at most ${MAX_AREA_SIZE_M} m.`;
  }
  if (!Number.isFinite(input.cellSizeM) || input.cellSizeM <= 0) {
    return "Cell size must be a positive number of metres.";
  }
  if (existingNames.includes(input.name)) {
    return `An area called "${input.name}" already exists. Pick another name or load it from the list.`;
  }
  try {
    createEmptyTerrainArea({
      areaId: input.name,
      widthM: input.widthM,
      depthM: input.depthM,
      cellSizeM: input.cellSizeM,
    });
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
  return null;
}

/** First free "new-area", "new-area-2", ... name. */
export function suggestAreaName(existingNames: readonly string[]): string {
  if (!existingNames.includes("new-area")) return "new-area";
  for (let i = 2; ; i++) {
    const n = `new-area-${i}`;
    if (!existingNames.includes(n)) return n;
  }
}
