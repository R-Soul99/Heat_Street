/**
 * Area config for "map-2": a HAND-AUTHORED blank world made with the dev map
 * editor (`/tools/map-editor/index.html`, New world). Its raw caches carry this
 * exact bbox so `loadOrFetchArea` hits the cache.
 *
 * Layering: plain data module - no I/O, no network, no fs.
 */
import type { AreaConfig } from "./juliette-ga.config.ts";

export const map2Config: AreaConfig = {
  areaId: "map-2",
  name: "Map 2 (authored world)",
  bbox: {
    south: 32.995696436832894,
    west: -84.01048653426655,
    north: 33.004303563167106,
    east: -83.98951346573345,
  },
  demSource: "none-flat-authored",
  osmSnapshot: "2026-11-11T15:13:35.028Z",
  osmExtract: "authored://heat-street/map-2",
  excludeHighwayClasses: [],
  surfaceFallbackAcknowledged: true,
};
