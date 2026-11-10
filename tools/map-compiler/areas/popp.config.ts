/**
 * Area config for "popp": a HAND-AUTHORED blank world made with the dev map
 * editor (`/tools/map-editor/index.html`, New world). Its raw caches carry this
 * exact bbox so `loadOrFetchArea` hits the cache.
 *
 * Layering: plain data module - no I/O, no network, no fs.
 */
import type { AreaConfig } from "./juliette-ga.config.ts";

export const poppConfig: AreaConfig = {
  areaId: "popp",
  name: "Popp (authored world)",
  bbox: {
    south: 32.9957577441065,
    west: -84.01048653426655,
    north: 33.0042422558935,
    east: -83.98951346573345,
  },
  demSource: "none-flat-authored",
  osmSnapshot: "2026-11-10T00:31:17.419Z",
  osmExtract: "authored://heat-street/popp",
  excludeHighwayClasses: [],
  surfaceFallbackAcknowledged: true,
};
