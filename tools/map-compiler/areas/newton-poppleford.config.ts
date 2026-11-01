/**
 * Area config for "newton-poppleford": a real Devon village, imported from an
 * AI Studio GeoJSON export (OpenStreetMap-derived, ODbL — see LICENSE-MAPDATA)
 * by `tools/map-compiler/import/geojson-to-raw-osm.ts` (`npm run
 * import-newton-poppleford`). The raw caches next to this file carry this exact
 * bbox so `loadOrFetchArea`'s cache check hits and the network is never touched.
 *
 * Layering: plain data module — no I/O, no network, no fs.
 */
import type { AreaConfig } from "./juliette-ga.config.ts";

export const newtonPopplefordConfig: AreaConfig = {
  areaId: "newton-poppleford",
  name: "Newton Poppleford, Devon",
  bbox: { south: 50.69222, west: -3.32593, north: 50.70711, east: -3.27586 },
  demSource: "none-flat-authored",
  // Constant on purpose so re-import is byte-identical.
  osmSnapshot: "2026-10-30T00:00:00.000Z",
  osmExtract: "aistudio://heat-street/newton-poppleford",
  excludeHighwayClasses: [],
  // The export has no surface tags; highway class decides surface.
  surfaceFallbackAcknowledged: true,
};
