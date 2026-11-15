/**
 * Area config for "new-map2": a HAND-AUTHORED blank world made with the dev map
 * editor (`/tools/map-editor/index.html`, New world). Its raw caches carry this
 * exact bbox so `loadOrFetchArea` hits the cache.
 *
 * Layering: plain data module - no I/O, no network, no fs.
 */
import type { AreaConfig } from "./juliette-ga.config.ts";

export const newMap2Config: AreaConfig = {
  areaId: "new-map2",
  name: "New Map2 (authored world)",
  bbox: {
    south: 32.99098322817199,
    west: -84.0535027258497,
    north: 33.00901677182801,
    east: -83.9464972741503,
  },
  demSource: "none-flat-authored",
  osmSnapshot: "2026-11-12T23:50:37.117Z",
  osmExtract: "authored://heat-street/new-map2",
  excludeHighwayClasses: [],
  surfaceFallbackAcknowledged: true,
};
