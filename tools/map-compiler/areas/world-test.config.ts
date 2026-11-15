/**
 * Area config for "world-test": a HAND-AUTHORED blank world made with the dev map
 * editor (`/tools/map-editor/index.html`, New world). Its raw caches carry this
 * exact bbox so `loadOrFetchArea` hits the cache.
 *
 * Layering: plain data module - no I/O, no network, no fs.
 */
import type { AreaConfig } from "./juliette-ga.config.ts";

export const worldTestConfig: AreaConfig = {
  areaId: "world-test",
  name: "World Test (authored world)",
  bbox: {
    south: 32.97294968451597,
    west: -84.03210163550982,
    north: 33.02705031548403,
    east: -83.96789836449018,
  },
  demSource: "none-flat-authored",
  osmSnapshot: "2026-11-09T23:19:30.740Z",
  osmExtract: "authored://heat-street/world-test",
  excludeHighwayClasses: [],
  surfaceFallbackAcknowledged: true,
};
