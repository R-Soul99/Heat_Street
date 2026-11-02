/**
 * Pure terrain boot steps used by the composition root (src/main.ts), kept
 * here so they are tested headlessly instead of only by typecheck.
 *
 * Layering: pure core -- no three/rapier/DOM.
 */
import type { AuthoredCrest } from "./crest-geometry.ts";
import { yawFromTravelDirection } from "./heading.ts";
import { parseDriveAt } from "./map-select.ts";
import type { RoadGraph } from "./road-graph.ts";
import type { TerrainArea, TerrainObject } from "./terrain-format.ts";
import { type TerrainGrid, upsampleTerrainGrid } from "./terrain-grid.ts";

export interface TerrainExtent {
  readonly minX: number;
  readonly minZ: number;
  readonly maxX: number;
  readonly maxZ: number;
}

/** World-space XZ extent of the height grid. */
export function terrainGridExtent(grid: TerrainGrid): TerrainExtent {
  return {
    minX: grid.originX,
    minZ: grid.originZ,
    maxX: grid.originX + grid.scaleX,
    maxZ: grid.originZ + grid.scaleZ,
  };
}

/**
 * YAW heading (VehiclePose / RoadGraphSpawn convention) along the nearest
 * graph edge segment to (x, z), or undefined when the graph has no segments.
 */
export function nearestEdgeHeading(graph: RoadGraph, x: number, z: number): number | undefined {
  let bestD2 = Number.POSITIVE_INFINITY;
  let bestDx = 0;
  let bestDz = 0;
  for (const edge of graph.edges) {
    for (let i = 0; i + 1 < edge.points.length; i++) {
      const a = edge.points[i];
      const b = edge.points[i + 1];
      if (a === undefined || b === undefined) continue;
      const sx = b[0] - a[0];
      const sz = b[2] - a[2];
      const len2 = sx * sx + sz * sz;
      if (len2 === 0) continue;
      const t = Math.max(0, Math.min(1, ((x - a[0]) * sx + (z - a[2]) * sz) / len2));
      const px = a[0] + t * sx - x;
      const pz = a[2] + t * sz - z;
      const d2 = px * px + pz * pz;
      if (d2 < bestD2) {
        bestD2 = d2;
        bestDx = sx;
        bestDz = sz;
      }
    }
  }
  if (!Number.isFinite(bestD2)) return undefined;
  return yawFromTravelDirection(bestDx, bestDz);
}

/**
 * `?at=x,z` drive-here pose. Validated against the terrain GRID extent (never
 * the graph's own bounds: on a freshly created area those are only the
 * Create-time extent, D-12). Heading follows the nearest road, else 0.
 */
export function resolveDriveHerePose(
  search: string,
  grid: TerrainGrid,
  graph: RoadGraph,
): { x: number; z: number; headingRad: number } | undefined {
  const at = parseDriveAt(search, terrainGridExtent(grid));
  if (at === undefined) return undefined;
  return { x: at.x, z: at.z, headingRad: nearestEdgeHeading(graph, at.x, at.z) ?? 0 };
}

/** The grid used for BOTH the collider and the view (same triangles). */
export function physicsGridForArea(
  area: Pick<TerrainArea, "grid" | "colliderSubdiv">,
): TerrainGrid {
  return area.colliderSubdiv === 2 ? upsampleTerrainGrid(area.grid, 2) : area.grid;
}

export function crestsFromObjects(objects: readonly TerrainObject[]): AuthoredCrest[] {
  const out: AuthoredCrest[] = [];
  for (const o of objects) if (o.kind === "crest") out.push(o.crest);
  return out;
}
