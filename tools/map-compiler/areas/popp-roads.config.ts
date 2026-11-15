/**
 * Area config for "popp-roads": a HAND-AUTHORED blank world made with the dev map
 * editor (`/tools/map-editor/index.html`, New world). Its raw caches carry this
 * exact bbox so `loadOrFetchArea` hits the cache.
 *
 * Layering: plain data module - no I/O, no network, no fs.
 */
import type { AreaConfig } from "./juliette-ga.config.ts";

export const poppRoadsConfig: AreaConfig = {
  areaId: "popp-roads",
  name: "Popp Roads (authored world)",
  bbox: {
    south: 32.995696436832894,
    west: -84.01048653426655,
    north: 33.004303563167106,
    east: -83.98951346573345,
  },
  demSource: "none-flat-authored",
  osmSnapshot: "2026-11-13T00:05:56.955Z",
  osmExtract: "authored://heat-street/popp-roads",
  excludeHighwayClasses: [],
  surfaceFallbackAcknowledged: true,
};
