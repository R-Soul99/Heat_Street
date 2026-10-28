/**
 * Writes the synthetic feel-test raw "OSM" caches
 * (`areas/feel-test.raw-osm.json`, `areas/feel-test.raw-buildings.json`) and
 * the station list the game reads (`public/maps/feel-test.stations.json`).
 * Deterministic: no clock, no randomness.
 *
 * Run: `npm run generate-feel-test`, then `npm run compile-map -- --area feel-test`,
 * then `node tools/map-compiler/synthetic/author-feel-test-routes.ts`.
 */
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { feelTestConfig } from "../areas/feel-test.config.ts";
import {
  buildProvingGround,
  DEPTH_M,
  provingGroundToEnvelopes,
  WIDTH_M,
} from "./proving-ground.ts";

const AREAS_DIR = path.join(import.meta.dirname, "..", "areas");
const MAPS_DIR = path.join(import.meta.dirname, "..", "..", "..", "public", "maps");

async function main(): Promise<void> {
  const ground = buildProvingGround();
  const { roads, buildings } = provingGroundToEnvelopes(
    ground,
    feelTestConfig.bbox,
    feelTestConfig.osmSnapshot ?? "1970-01-01T00:00:00.000Z",
  );
  await writeFile(
    path.join(AREAS_DIR, "feel-test.raw-osm.json"),
    `${JSON.stringify(roads, null, 2)}\n`,
    "utf8",
  );
  await writeFile(
    path.join(AREAS_DIR, "feel-test.raw-buildings.json"),
    `${JSON.stringify(buildings, null, 2)}\n`,
    "utf8",
  );
  // World coordinates (recentred like the map): east x, south z. Launch faces east.
  const stations = ground.stations.map((s) => ({
    id: s.id,
    key: s.key,
    name: s.name,
    note: s.note,
    featureAheadM: s.featureAheadM,
    widthM: s.widthM,
    x: s.pad.x - WIDTH_M / 2,
    z: s.pad.z - DEPTH_M / 2,
    headingRad: -Math.PI / 2,
  }));
  await writeFile(
    path.join(MAPS_DIR, "feel-test.stations.json"),
    `${JSON.stringify({ areaId: "feel-test", stations }, null, 2)}\n`,
    "utf8",
  );
  console.log(`generate-feel-test: ${ground.ways.length} ways, ${stations.length} stations`);
}

main().catch((err: unknown) => {
  console.error(`generate-feel-test: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
