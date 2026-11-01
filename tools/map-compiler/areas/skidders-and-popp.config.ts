/**
 * Area config for "skidders-and-popp": a larger (~8.4 x 5.8 km) real Devon area
 * imported from an AI Studio export (OpenStreetMap-derived, ODbL - see
 * LICENSE-MAPDATA) by `tools/map-compiler/import/geojson-to-raw-osm.ts`
 * (`npm run import-skidders-and-popp`). Roads come from GeoJSON; buildings from
 * the buildings table as area-preserving rectangles.
 *
 * Layering: plain data module - no I/O, no network, no fs.
 */
import type { AreaConfig } from "./juliette-ga.config.ts";

export const skiddersAndPoppConfig: AreaConfig = {
  areaId: "skidders-and-popp",
  name: "Skidders and Popp, Devon",
  bbox: { south: 50.67471, west: -3.31238, north: 50.72668, east: -3.21144 },
  demSource: "none-flat-authored",
  osmSnapshot: "2026-10-30T00:00:00.000Z",
  osmExtract: "aistudio://heat-street/skidders-and-popp",
  excludeHighwayClasses: [],
  // The export has no surface tags; highway class decides surface.
  surfaceFallbackAcknowledged: true,
  // Real relief from the export's 16-bit heightmap. The PNG is normalised, so
  // rangeM is an estimate of the area's real elevation span (coast-side valley
  // floor to the Woodbury/Peak Hill heights, ~160 m); reliefScale/maxReliefM
  // keep the slopes beside the flat roads drivable. Tune these by feel.
  heightmap: {
    file: "fixtures/SkiddersAndPopp/heightmap_16bit_128x128.png",
    rangeM: 160,
    reliefScale: 0.4,
    maxReliefM: 30,
  },
};
