/**
 * Area config for "playground": a SYNTHETIC, building-free test map (dome
 * field, gap jumps with landing ramps, speedway ovals) on flat tarmac ground.
 * Not OSM data; see `tools/map-compiler/synthetic/playground-layout.ts`.
 *
 * The raw "OSM" caches next to this file are written by
 * `tools/map-compiler/synthetic/generate-playground.ts` (`npm run
 * generate-playground`); their envelope bbox is this exact object so
 * `loadOrFetchArea`'s strict bbox-equality cache check hits.
 *
 * Layering: plain data module — no I/O, no network, no fs.
 */
import type { AreaConfig } from "./juliette-ga.config.ts";

export const playgroundConfig: AreaConfig = {
  areaId: "playground",
  name: "Playground (synthetic)",
  // Centred on (33.0, -84.0); encloses the 1600 m x 1300 m layout with margin.
  bbox: { south: 32.9925, west: -84.0095, north: 33.0075, east: -83.9905 },
  demSource: "none-flat-authored",
  osmSnapshot: "2026-11-04T00:00:00.000Z",
  osmExtract: "synthetic://heat-street/playground",
  excludeHighwayClasses: [],
};
