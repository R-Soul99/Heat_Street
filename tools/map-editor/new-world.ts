/**
 * Writes a blank authored world: `<id>.raw-osm.json`, `<id>.raw-buildings.json`
 * (empty raw-OSM envelopes with a synthetic bbox, like the synthetic generators)
 * and `<id>.config.ts`. The map compiler is unchanged; the caller registers
 * the world via `registerAuthoredMap` (authored-maps.json -> generated registries).
 *
 * Shared by the editor's `POST /__editor/new-world` endpoint and this CLI:
 *   node tools/map-editor/new-world.ts --id world-test --km 6 [--km-north 4]
 */
import { existsSync, writeFileSync } from "node:fs";
import path from "node:path";
import { registerAuthoredMap } from "../map-compiler/authored-registry.ts";
import { blankWorld, worldConfigSource } from "./world.ts";

const ROOT = path.resolve(import.meta.dirname, "..", "..");
export const AREAS_DIR = path.resolve(import.meta.dirname, "..", "map-compiler", "areas");

export class WorldExistsError extends Error {}

/** Writes the three files, refusing to overwrite. */
export function writeNewWorld(
  areasDir: string,
  id: string,
  widthKm: number,
  heightKm: number,
  now: string,
): void {
  // blankWorld validates id and sizes before any path is built.
  const { roads, buildings } = blankWorld(id, widthKm, heightKm, now);
  const roadsFile = path.join(areasDir, `${id}.raw-osm.json`);
  const buildingsFile = path.join(areasDir, `${id}.raw-buildings.json`);
  const configFile = path.join(areasDir, `${id}.config.ts`);
  for (const f of [roadsFile, buildingsFile, configFile]) {
    if (existsSync(f)) throw new WorldExistsError(`${path.basename(f)} already exists`);
  }
  const json = (env: unknown) => `${JSON.stringify(env, null, 2)}\n`;
  writeFileSync(roadsFile, json(roads), "utf8");
  writeFileSync(buildingsFile, json(buildings), "utf8");
  writeFileSync(configFile, worldConfigSource(id, roads.bbox, now), "utf8");
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

if (import.meta.filename === path.resolve(process.argv[1] ?? "")) {
  const id = arg("--id") ?? "";
  const widthKm = Number(arg("--km"));
  const heightKm = arg("--km-north") === undefined ? widthKm : Number(arg("--km-north"));
  try {
    writeNewWorld(AREAS_DIR, id, widthKm, heightKm, new Date().toISOString());
    await registerAuthoredMap(ROOT, { id, format: "legacy" });
    console.log(`Wrote and registered world ${id}`);
  } catch (err) {
    console.error(`new-world: ${String(err)}`);
    process.exit(1);
  }
}
