/**
 * Converts one editor-made (authored) map from its compiled files into the
 * terrain format, in-process (no child process). Used by the map editor's dev
 * middleware for "Open in terrain editor". Node-only.
 *
 * The id is matched EXACTLY against the authored manifest before it is used in
 * any path, so nothing outside `public/maps/` can be reached.
 */
import { existsSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { crestsForArea } from "../../../src/core/crest-geometry.ts";
import { parseMapCollision } from "../../../src/core/map-collision.ts";
import { parseRoadGraph } from "../../../src/core/road-graph.ts";
import { encodeTerrainBinary, serializeTerrainSidecar } from "../../../src/core/terrain-format.ts";
import { groundBounds } from "../author/heightfield.ts";
import { readAuthoredManifest } from "../authored-registry.ts";
import { authoredConvertConfig, convertCompiledArea } from "./convert.ts";

export interface AuthoredConvertSummary {
  readonly id: string;
  readonly cols: number;
  readonly rows: number;
  readonly cellSizeM: number;
  readonly vertices: number;
  readonly paintMetresPerPixel: number;
  readonly files: readonly string[];
}

/** The manifest's own id for `id`, or undefined when it is not a registered authored map. */
export function findAuthoredId(root: string, id: string): string | undefined {
  return readAuthoredManifest(root).find((e) => e.id === id)?.id;
}

async function atomicWrite(file: string, data: string | Uint8Array): Promise<void> {
  const tmp = `${file}.tmp`;
  await writeFile(tmp, data);
  await rename(tmp, file);
}

export async function convertAuthoredMap(
  root: string,
  requestedId: string,
): Promise<AuthoredConvertSummary> {
  const id = findAuthoredId(root, requestedId);
  if (id === undefined) throw new Error(`"${requestedId.slice(0, 64)}" is not one of your maps.`);
  const dir = join(root, "public", "maps");
  const graphPath = join(dir, `${id}.map.json`);
  const collisionPath = join(dir, `${id}.collision.json`);
  if (!existsSync(graphPath) || !existsSync(collisionPath)) {
    throw new Error(`${id} has not been compiled yet (no playable map files in public/maps).`);
  }
  const graph = parseRoadGraph(await readFile(graphPath, "utf8"), graphPath);
  const collision = parseMapCollision(await readFile(collisionPath, "utf8"), id, collisionPath);
  // Every road point plus a 40 m margin: graph.bounds covers junctions only,
  // so a road looping out past its end nodes would otherwise run off the ground.
  const b = groundBounds(graph);
  const config = authoredConvertConfig(
    b.maxX - b.minX,
    b.maxZ - b.minZ,
    collision.buildings.length > 0,
  );
  const area = convertCompiledArea({
    areaId: id,
    graph,
    collision,
    crests: crestsForArea(id),
    config,
    bounds: b,
  });
  const bin = await encodeTerrainBinary(area, { paintEncoding: 1 });
  const sidecar = serializeTerrainSidecar(area);
  await mkdir(dir, { recursive: true });
  await atomicWrite(join(dir, `${id}.terrain.bin`), bin);
  await atomicWrite(join(dir, `${id}.terrain.json`), sidecar);
  const g = area.grid;
  return {
    id,
    cols: g.cols,
    rows: g.rows,
    cellSizeM: g.cellSizeM,
    vertices: (g.cols + 1) * (g.rows + 1),
    paintMetresPerPixel: config.paintMetresPerPixel,
    files: [`public/maps/${id}.terrain.bin`, `public/maps/${id}.terrain.json`],
  };
}
