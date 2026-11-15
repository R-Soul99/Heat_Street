/**
 * Area config for "map-3": a HAND-AUTHORED blank world made with the dev map
 * editor (`/tools/map-editor/index.html`, New world). Its raw caches carry this
 * exact bbox so `loadOrFetchArea` hits the cache.
 *
 * Layering: plain data module - no I/O, no network, no fs.
 */
import type { AreaConfig } from "./juliette-ga.config.ts";

export const map3Config: AreaConfig = {
  areaId: "map-3",
  name: "Map 3 (authored world)",
  bbox: {
    south: 32.9963617325674,
    west: -84.00886540167329,
    north: 33.0036382674326,
    east: -83.99113459832671,
  },
  demSource: "none-flat-authored",
  osmSnapshot: "2026-11-11T16:44:00.078Z",
  osmExtract: "authored://heat-street/map-3",
  excludeHighwayClasses: [],
  surfaceFallbackAcknowledged: true,
};
