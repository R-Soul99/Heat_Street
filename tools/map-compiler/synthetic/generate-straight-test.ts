/**
 * Writes the synthetic straight-test raw "OSM" caches
 * (`areas/straight-test.raw-osm.json`, `areas/straight-test.raw-buildings.json`).
 * Deterministic: no clock, no randomness.
 *
 * Run: `npm run generate-straight-test`, then
 * `npm run compile-map -- --area straight-test` and
 * `npm run convert-terrain -- --area straight-test`.
 */
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { straightTestConfig } from "../areas/straight-test.config.ts";
import { buildStraightRoad, straightToEnvelopes } from "./straight-layout.ts";

const AREAS_DIR = path.join(import.meta.dirname, "..", "areas");

async function main(): Promise<void> {
  const road = buildStraightRoad();
  const { roads, buildings } = straightToEnvelopes(
    road,
    straightTestConfig.bbox,
    straightTestConfig.osmSnapshot ?? "1970-01-01T00:00:00.000Z",
  );
  await writeFile(
    path.join(AREAS_DIR, "straight-test.raw-osm.json"),
    `${JSON.stringify(roads, null, 2)}\n`,
    "utf8",
  );
  await writeFile(
    path.join(AREAS_DIR, "straight-test.raw-buildings.json"),
    `${JSON.stringify(buildings, null, 2)}\n`,
    "utf8",
  );
  console.log(`generate-straight-test: ${road.ways.length} ways`);
}

main().catch((err: unknown) => {
  console.error(`generate-straight-test: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
