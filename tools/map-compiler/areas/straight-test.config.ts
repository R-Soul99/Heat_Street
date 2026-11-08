/**
 * Area config for "straight-test": a SYNTHETIC, building-free test map that is
 * one long, dead-straight, wide road (4 km) on flat ground. It exists to test
 * pursuit behaviour (blockers, bust, PIT) at sustained speed, which the other
 * maps are too short for. Not OSM data; see
 * `tools/map-compiler/synthetic/straight-layout.ts`.
 *
 * The raw "OSM" caches next to this file are written by
 * `tools/map-compiler/synthetic/generate-straight-test.ts` (`npm run
 * generate-straight-test`); their envelope bbox is this exact object so
 * `loadOrFetchArea`'s strict bbox-equality cache check hits.
 *
 * Layering: plain data module — no I/O, no network, no fs.
 */
import type { AreaConfig } from "./juliette-ga.config.ts";

export const straightTestConfig: AreaConfig = {
  areaId: "straight-test",
  name: "Straight Test (synthetic)",
  // Centred on (33.0, -84.0); encloses the 4000 m x 500 m layout with margin
  // (about +-2200 m east-west, +-300 m north-south).
  bbox: { south: 32.9972, west: -84.0236, north: 33.0028, east: -83.9764 },
  demSource: "none-flat-authored",
  osmSnapshot: "2026-11-08T00:00:00.000Z",
  osmExtract: "synthetic://heat-street/straight-test",
  excludeHighwayClasses: [],
};
