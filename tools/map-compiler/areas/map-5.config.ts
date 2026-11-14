/**
 * Area config for "map-5": a HAND-AUTHORED blank world made with the dev map
 * editor (`/tools/map-editor/index.html`, New world). Its raw caches carry this
 * exact bbox so `loadOrFetchArea` hits the cache.
 *
 * Layering: plain data module - no I/O, no network, no fs.
 */
import type { AreaConfig } from "./juliette-ga.config.ts";

export const map5Config: AreaConfig = {
  areaId: "map-5",
  name: "Map 5 (authored world)",
  bbox: {
    south: 32.997745807042996,
    west: -84.00267513629248,
    north: 33.002254192957004,
    east: -83.99732486370752,
  },
  demSource: "none-flat-authored",
  osmSnapshot: "2026-11-13T22:14:44.559Z",
  osmExtract: "authored://heat-street/map-5",
  excludeHighwayClasses: [],
  surfaceFallbackAcknowledged: true,
};
