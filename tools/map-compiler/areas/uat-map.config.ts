/**
 * Area config for "uat-map": a HAND-AUTHORED blank world made with the dev map
 * editor (`/tools/map-editor/index.html`, New world). Its raw caches carry this
 * exact bbox so `loadOrFetchArea` hits the cache.
 *
 * Layering: plain data module - no I/O, no network, no fs.
 */
import type { AreaConfig } from "./juliette-ga.config.ts";

export const uatMapConfig: AreaConfig = {
  areaId: "uat-map",
  name: "Uat Map (authored world)",
  bbox: {
    south: 32.997745807042996,
    west: -84.00267513629248,
    north: 33.002254192957004,
    east: -83.99732486370752,
  },
  demSource: "none-flat-authored",
  osmSnapshot: "2026-11-12T23:53:23.444Z",
  osmExtract: "authored://heat-street/uat-map",
  excludeHighwayClasses: [],
  surfaceFallbackAcknowledged: true,
};
