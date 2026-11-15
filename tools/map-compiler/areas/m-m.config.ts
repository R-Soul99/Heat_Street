/**
 * Area config for "m-m": a HAND-AUTHORED blank world made with the dev map
 * editor (`/tools/map-editor/index.html`, New world). Its raw caches carry this
 * exact bbox so `loadOrFetchArea` hits the cache.
 *
 * Layering: plain data module - no I/O, no network, no fs.
 */
import type { AreaConfig } from "./juliette-ga.config.ts";

export const mMConfig: AreaConfig = {
  areaId: "m-m",
  name: "M M (authored world)",
  bbox: {
    south: 32.99098322817199,
    west: -84.00267513629248,
    north: 33.00901677182801,
    east: -83.99732486370752,
  },
  demSource: "none-flat-authored",
  osmSnapshot: "2026-11-13T21:03:53.417Z",
  osmExtract: "authored://heat-street/m-m",
  excludeHighwayClasses: [],
  surfaceFallbackAcknowledged: true,
};
