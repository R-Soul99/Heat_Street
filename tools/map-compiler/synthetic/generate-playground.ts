/**
 * Writes the synthetic playground raw "OSM" caches
 * (`areas/playground.raw-osm.json`, `areas/playground.raw-buildings.json`) and
 * the launch pads the game reads (`public/maps/playground.stations.json`).
 * Deterministic: no clock, no randomness.
 *
 * Run: `npm run generate-playground`, then `npm run compile-map -- --area playground`,
 * `npm run convert-terrain -- --area playground`, then `npm run author-playground-routes`.
 */
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { PLAYGROUND_DEPTH_M, PLAYGROUND_WIDTH_M } from "../../../src/core/crest-geometry.ts";
import { playgroundConfig } from "../areas/playground.config.ts";
import { buildPlayground, playgroundToEnvelopes } from "./playground-layout.ts";

const AREAS_DIR = path.join(import.meta.dirname, "..", "areas");
const MAPS_DIR = path.join(import.meta.dirname, "..", "..", "..", "public", "maps");

async function main(): Promise<void> {
  const ground = buildPlayground();
  const { roads, buildings } = playgroundToEnvelopes(
    ground,
    playgroundConfig.bbox,
    playgroundConfig.osmSnapshot ?? "1970-01-01T00:00:00.000Z",
  );
  await writeFile(
    path.join(AREAS_DIR, "playground.raw-osm.json"),
    `${JSON.stringify(roads, null, 2)}\n`,
    "utf8",
  );
  await writeFile(
    path.join(AREAS_DIR, "playground.raw-buildings.json"),
    `${JSON.stringify(buildings, null, 2)}\n`,
    "utf8",
  );
  // World coordinates (recentred like the map): east x, south z. Every pad faces east.
  const stations = ground.stations.map((s) => ({
    id: s.id,
    key: s.key,
    name: s.name,
    note: s.note,
    featureAheadM: s.featureAheadM,
    widthM: s.widthM,
    x: s.pad.x - PLAYGROUND_WIDTH_M / 2,
    z: s.pad.z - PLAYGROUND_DEPTH_M / 2,
    headingRad: -Math.PI / 2,
  }));
  await writeFile(
    path.join(MAPS_DIR, "playground.stations.json"),
    `${JSON.stringify({ areaId: "playground", stations }, null, 2)}\n`,
    "utf8",
  );
  console.log(`generate-playground: ${ground.ways.length} ways, ${stations.length} stations`);
}

main().catch((err: unknown) => {
  console.error(`generate-playground: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
