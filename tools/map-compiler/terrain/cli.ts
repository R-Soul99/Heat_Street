/**
 * `npm run convert-terrain -- --area <feel-test|grid-test|juliette-ga|all>`
 *
 * Converts compiled legacy map artifacts (`public/maps/<id>.map.json` +
 * `.collision.json`) into the terrain format (`<id>.terrain.bin` + `.json`).
 * Deterministic: running it twice yields byte-identical outputs (D-06).
 * The legacy artifacts are left in place (converter inputs, building meshes).
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { crestsForArea } from "../../../src/core/crest-geometry.ts";
import { parseMapCollision } from "../../../src/core/map-collision.ts";
import { parseRoadGraph } from "../../../src/core/road-graph.ts";
import { encodeTerrainBinary, serializeTerrainSidecar } from "../../../src/core/terrain-format.ts";
import { CONVERT_CONFIG, type ConvertibleAreaId, convertCompiledArea } from "./convert.ts";

const MAPS_DIR = path.join(import.meta.dirname, "..", "..", "..", "public", "maps");
const AREAS = Object.keys(CONVERT_CONFIG) as ConvertibleAreaId[];

function parseArea(argv: readonly string[]): ConvertibleAreaId[] | undefined {
  const i = argv.indexOf("--area");
  const value = i >= 0 ? argv[i + 1] : undefined;
  if (value === "all") return AREAS;
  // Exact literal match only: the value never reaches a path unless it is an allowlisted id (T-04.2-30).
  const match = AREAS.find((id) => id === value);
  return match === undefined ? undefined : [match];
}

async function convertOne(areaId: ConvertibleAreaId): Promise<void> {
  const graphPath = path.join(MAPS_DIR, `${areaId}.map.json`);
  const collisionPath = path.join(MAPS_DIR, `${areaId}.collision.json`);
  const graph = parseRoadGraph(await readFile(graphPath, "utf8"), graphPath);
  const collision = parseMapCollision(await readFile(collisionPath, "utf8"), areaId, collisionPath);
  const area = convertCompiledArea({ areaId, graph, collision, crests: crestsForArea(areaId) });
  const bin = await encodeTerrainBinary(area, { paintEncoding: 1 });
  const sidecar = serializeTerrainSidecar(area);
  await mkdir(MAPS_DIR, { recursive: true });
  await writeFile(path.join(MAPS_DIR, `${areaId}.terrain.bin`), bin);
  await writeFile(path.join(MAPS_DIR, `${areaId}.terrain.json`), sidecar, "utf8");
  const g = area.grid;
  console.log(
    `${areaId}: ${bin.length} bytes bin, ${sidecar.length} bytes json, ` +
      `${(g.rows + 1) * (g.cols + 1)} vertices (${g.rows}x${g.cols} @ ${g.cellSizeM} m), ` +
      `${area.paint.width * area.paint.height} paint pixels (${area.paint.width}x${area.paint.height})`,
  );
}

async function main(): Promise<void> {
  const areas = parseArea(process.argv.slice(2));
  if (areas === undefined) {
    console.error("usage: convert-terrain --area <feel-test|grid-test|juliette-ga|all>");
    process.exit(2);
  }
  for (const id of areas) await convertOne(id);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
