/**
 * Area config for "feel-test": a SYNTHETIC, building-free proving ground for
 * handling tests (stations with fixed launch pads, a big skid pan and a
 * perimeter ring road). Not OSM data; see
 * `tools/map-compiler/synthetic/proving-ground.ts`.
 *
 * The raw "OSM" caches next to this file are written by
 * `tools/map-compiler/synthetic/generate-feel-test.ts` (`npm run
 * generate-feel-test`); their envelope bbox is this exact object so
 * `loadOrFetchArea`'s strict bbox-equality cache check hits.
 *
 * Layering: plain data module — no I/O, no network, no fs.
 */
import type { AreaConfig } from "./juliette-ga.config.ts";

export const feelTestConfig: AreaConfig = {
  areaId: "feel-test",
  name: "Feel Test Proving Ground (synthetic)",
  // Centred on (33.0, -84.0); encloses the 1400 m x 840 m layout with margin.
  bbox: { south: 32.9945, west: -84.0095, north: 33.0055, east: -83.9905 },
  demSource: "none-flat-authored",
  osmSnapshot: "2026-10-28T00:00:00.000Z",
  osmExtract: "synthetic://heat-street/feel-test",
  excludeHighwayClasses: [],
};
