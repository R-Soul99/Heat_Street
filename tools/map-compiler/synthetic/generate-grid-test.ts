/**
 * Writes the synthetic grid-test raw "OSM" caches
 * (`areas/grid-test.raw-osm.json`, `areas/grid-test.raw-buildings.json`) from
 * the pure layout. Deterministic: no clock, no randomness. The envelopes use
 * `gridTestConfig.bbox` (the exact object) so `loadOrFetchArea` hits the cache.
 *
 * Run: `npm run generate-grid-test`, then `npm run compile-map -- --area grid-test`.
 */
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { gridTestConfig } from "../areas/grid-test.config.ts";
import {
  buildGridLayout,
  classifyIntersections,
  GRID_TEST_LAYOUT_PARAMS,
  gridLayoutToEnvelopes,
} from "./grid-layout.ts";

const AREAS_DIR = path.join(import.meta.dirname, "..", "areas");

async function main(): Promise<void> {
  const layout = buildGridLayout(GRID_TEST_LAYOUT_PARAMS);
  const { roads, buildings } = gridLayoutToEnvelopes(
    layout,
    gridTestConfig.bbox,
    gridTestConfig.osmSnapshot ?? "1970-01-01T00:00:00.000Z",
  );
  await writeFile(
    path.join(AREAS_DIR, "grid-test.raw-osm.json"),
    `${JSON.stringify(roads, null, 2)}\n`,
    "utf8",
  );
  await writeFile(
    path.join(AREAS_DIR, "grid-test.raw-buildings.json"),
    `${JSON.stringify(buildings, null, 2)}\n`,
    "utf8",
  );
  const summary = classifyIntersections(layout);
  console.log(
    `generate-grid-test: ${roads.response.elements.length} road ways, ` +
      `${buildings.response.elements.length} building ways; ` +
      `crossroads=${summary.crossroads} T=${summary.tJunctions} doglegs=${summary.doglegs}`,
  );
}

main().catch((err: unknown) => {
  console.error(`generate-grid-test: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
