/**
 * Composition root of the offline map compiler: the single entry point that
 * turns a `--area <id>` argument into a compiled `*.map.json` (and,
 * eventually, `*.glb`) artifact.
 *
 * This is `tools/`'s equivalent of `src/main.ts` — the file that wires every
 * later stage together and is run, not merely imported. Invoked as
 * `npm run compile-map -- --area juliette-ga` (SC3's "one command").
 *
 * Pipeline stages, in the order later plans add them:
 *   1. Resolve `--area` against the known-area registry (plan 04-01).
 *   2. Fetch/cache raw OSM roads + buildings data for the area's bbox,
 *      printing a coverage summary (this plan).
 *   3. Fetch/cache the DEM raster covering the area's bbox (plan 04-03/04-04).
 *   4. Build the dense-id `RoadGraph` from OSM ways/nodes, mapping surfaces
 *      via `graph/surface-mapping.ts` (plan 04-01) and sampling elevation.
 *   5. Author per-edge ribbon/junction geometry (`geometry/`).
 *   6. Author collision buffers and a merged glTF render mesh (`author/`).
 *   7. Validate the result (`validate/`) — fail loudly, name the offending
 *      node/edge id, never a bare stack trace.
 *   8. Write `public/maps/<areaId>.map.json` and `<areaId>.glb`.
 *
 * Layering: `tests/layering.test.ts` does NOT scan `tools/**` — this file's
 * own discipline (an explicit registry, never a dynamic argv-built import;
 * see the `--area` resolution below) is the only guard against a
 * path-traversal- or arbitrary-file-read-shaped bug here.
 */
import { type AreaConfig, julietteGaConfig } from "./areas/juliette-ga.config.ts";
import { type LoadOrFetchAreaResult, loadOrFetchArea } from "./sources/overpass.ts";

/**
 * Explicit registry of every known area, keyed by `areaId`. Deliberately a
 * plain object literal, never a dynamic module import built from a
 * template-literal path interpolating `process.argv` (e.g. a path built as
 * "./areas/" + id + ".config.ts") — an import path constructed from
 * user-controlled argv is an arbitrary-file-read primitive (T-04-08). Adding
 * a new area means adding one line here, not changing the resolution
 * mechanism.
 */
const KNOWN_AREAS: Record<string, AreaConfig> = {
  "juliette-ga": julietteGaConfig,
};

/** Parses `--area <id>` out of an argv-shaped string array. Returns `null` if absent. */
function parseAreaArg(argv: readonly string[]): string | null {
  const flagIndex = argv.indexOf("--area");
  if (flagIndex === -1) {
    return null;
  }
  const value = argv[flagIndex + 1];
  return value === undefined ? null : value;
}

/** A `way` element narrowed enough to read `.tags` off it — the only shape this file's summary needs. */
interface WayElementLike {
  readonly type: "way";
  readonly tags?: Readonly<Record<string, string>>;
}

function isWayElement(element: unknown): element is WayElementLike {
  return (
    typeof element === "object" &&
    element !== null &&
    (element as { type?: unknown }).type === "way"
  );
}

/** Counts how many ways carry each value of `tagKey`, ignoring ways where it is absent. */
function tagFrequency(ways: readonly WayElementLike[], tagKey: string): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const way of ways) {
    const value = way.tags?.[tagKey];
    if (value === undefined) {
      continue;
    }
    counts[value] = (counts[value] ?? 0) + 1;
  }
  return counts;
}

/** Formats a frequency table as `key:count, key:count, ...`, sorted by count descending. */
function formatFrequency(counts: Readonly<Record<string, number>>): string {
  const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  return entries.length === 0
    ? "(none)"
    : entries.map(([key, count]) => `${key}:${count}`).join(", ");
}

/**
 * Prints the build-time coverage signal 04-RESEARCH.md's "OSM Surface Tag
 * Reliability" section asks for: total way count, a `highway=*` breakdown,
 * a `surface=*` breakdown, the count of ways with no explicit `surface`
 * tag, and whether each payload came from the cache or the network.
 */
function printFetchSummary(
  config: AreaConfig,
  roads: LoadOrFetchAreaResult,
  buildings: LoadOrFetchAreaResult,
): void {
  const roadWays = roads.envelope.response.elements.filter(isWayElement);
  const buildingWays = buildings.envelope.response.elements.filter(isWayElement);
  const noSurfaceCount = roadWays.filter((way) => way.tags?.surface === undefined).length;

  console.log(`compile-map: area "${config.areaId}" (${config.name})`);
  console.log(
    `  roads: ${roadWays.length} ways, source=${roads.source}, fetchedAt=${roads.envelope.fetchedAt}`,
  );
  console.log(`    highway breakdown: ${formatFrequency(tagFrequency(roadWays, "highway"))}`);
  console.log(`    surface breakdown: ${formatFrequency(tagFrequency(roadWays, "surface"))}`);
  console.log(`    ways with no surface tag: ${noSurfaceCount} / ${roadWays.length}`);
  console.log(
    `  buildings: ${buildingWays.length} ways, source=${buildings.source}, fetchedAt=${buildings.envelope.fetchedAt}`,
  );
}

async function main(argv: readonly string[]): Promise<void> {
  const areaId = parseAreaArg(argv);

  if (areaId === null) {
    console.error(
      `compile-map: missing --area <id>. Known areas: ${Object.keys(KNOWN_AREAS).join(", ")}`,
    );
    process.exit(1);
    return;
  }

  const config = KNOWN_AREAS[areaId];
  if (config === undefined) {
    console.error(
      `compile-map: unknown area "${areaId}". Known areas: ${Object.keys(KNOWN_AREAS).join(", ")}`,
    );
    process.exit(1);
    return;
  }

  console.log(
    `compile-map: resolved area "${config.areaId}" (${config.name}) — bbox ${JSON.stringify(
      config.bbox,
    )}, demSource "${config.demSource}"`,
  );

  const refresh = argv.includes("--refresh");
  const [roadsResult, buildingsResult] = await Promise.all([
    loadOrFetchArea(config, "roads", { refresh }),
    loadOrFetchArea(config, "buildings", { refresh }),
  ]);

  printFetchSummary(config, roadsResult, buildingsResult);

  // Stages 3-8 (DEM, graph build, geometry, author, validate, write) land in
  // later plans — see this file's own header comment for the full pipeline
  // order.
}

main(process.argv.slice(2)).catch((err: unknown) => {
  console.error(
    `compile-map: unhandled error — ${err instanceof Error ? err.message : String(err)}`,
  );
  process.exit(1);
});
