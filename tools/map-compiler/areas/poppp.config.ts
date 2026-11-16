/**
 * Area config for "poppp": a HAND-AUTHORED blank world made with the dev map
 * editor (`/tools/map-editor/index.html`, New world). Its raw caches carry this
 * exact bbox so `loadOrFetchArea` hits the cache.
 *
 * Layering: plain data module - no I/O, no network, no fs.
 */
import type { AreaConfig } from "./juliette-ga.config.ts";

export const popppConfig: AreaConfig = {
  areaId: "poppp",
  name: "Poppp (authored world)",
  bbox: {
    south: 32.99578426465263,
    west: -84.01027252336314,
    north: 33.00421573534737,
    east: -83.98972747663686,
  },
  demSource: "none-flat-authored",
  osmSnapshot: "2026-11-15T20:18:24.186Z",
  osmExtract: "authored://heat-street/poppp",
  excludeHighwayClasses: [],
  surfaceFallbackAcknowledged: true,
};
