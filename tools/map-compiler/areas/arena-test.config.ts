/**
 * Area config for "arena-test": a COPY of "straight-test" made on 2026-11-08 to be
 * edited by hand in the map editor (`/tools/map-editor/index.html`), e.g. towards
 * the launch-pad arena (GitHub issue #22). Unlike straight-test it is NOT written by
 * a generator: the raw "OSM" caches next to this file are the source of truth and
 * the editor saves over them. Do not run `generate-straight-test` expecting this
 * file to follow it.
 *
 * Layering: plain data module — no I/O, no network, no fs.
 */
import type { AreaConfig } from "./juliette-ga.config.ts";

export const arenaTestConfig: AreaConfig = {
  areaId: "arena-test",
  name: "Arena Test (copy of straight-test, for editing)",
  // Centred on (33.0, -84.0); encloses the 4000 m x 500 m layout with margin
  // (about +-2200 m east-west, +-300 m north-south).
  bbox: { south: 32.9972, west: -84.0236, north: 33.0028, east: -83.9764 },
  demSource: "none-flat-authored",
  osmSnapshot: "2026-11-08T00:00:00.000Z",
  osmExtract: "synthetic://heat-street/arena-test",
  excludeHighwayClasses: [],
};
