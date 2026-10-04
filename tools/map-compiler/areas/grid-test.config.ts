/**
 * Area config for "grid-test": a SYNTHETIC, code-generated test city — not OSM
 * data. It exists as a controlled handling test bed (staggered block rows,
 * varied road widths, a gravel perimeter alley) that the rural Juliette map
 * lacks.
 *
 * The raw "OSM" caches `grid-test.raw-osm.json` / `grid-test.raw-buildings.json`
 * next to this file are written by
 * `tools/map-compiler/synthetic/generate-grid-test.ts` (`npm run
 * generate-grid-test`) from the pure layout in
 * `tools/map-compiler/synthetic/grid-layout.ts`. Their envelope bbox is this
 * exact object, so `loadOrFetchArea`'s strict bbox-equality cache check hits
 * and the network is never touched.
 *
 * The bbox is centred on a fictitious origin (33.0, -84.0) and encloses the
 * 720 m x 670 m layout (8 block rows around a central motorway) plus at least
 * 60 m of margin on each side (checked in `grid-layout.test.ts`).
 *
 * Layering: plain data module — no I/O, no network, no fs.
 */
import type { AreaConfig } from "./juliette-ga.config.ts";

export const gridTestConfig: AreaConfig = {
  areaId: "grid-test",
  name: "Grid Test City (synthetic)",
  bbox: { south: 32.996, west: -84.005, north: 33.004, east: -83.995 },
  demSource: "none-flat-authored",
  // Constant on purpose (never Date.now) so regeneration is byte-identical.
  osmSnapshot: "2026-10-04T00:00:00.000Z",
  osmExtract: "synthetic://heat-street/grid-test",
  excludeHighwayClasses: [],
};
