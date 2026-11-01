/**
 * Area config for "my-map": a HAND-AUTHORED map, edited with the dev map
 * editor (`/tools/map-editor/index.html`). It was seeded from the grid-test
 * layout so it compiles and has routes from the start; edit it freely. Its raw
 * caches carry this exact bbox so `loadOrFetchArea` hits the cache.
 *
 * Layering: plain data module - no I/O, no network, no fs.
 */
import type { AreaConfig } from "./juliette-ga.config.ts";

export const myMapConfig: AreaConfig = {
  areaId: "my-map",
  name: "My Map (hand-authored)",
  bbox: { south: 32.996, west: -84.005, north: 33.004, east: -83.995 },
  demSource: "none-flat-authored",
  osmSnapshot: "2026-10-30T00:00:00.000Z",
  osmExtract: "authored://heat-street/my-map",
  excludeHighwayClasses: [],
  surfaceFallbackAcknowledged: true,
};
