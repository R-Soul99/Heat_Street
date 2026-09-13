/**
 * Composition root of the offline map compiler: the single entry point that
 * turns a `--area <id>` argument into a compiled `*.map.json` (and,
 * eventually, `*.glb`) artifact.
 *
 * This is `tools/`'s equivalent of `src/main.ts` — the file that wires every
 * later stage together and is run, not merely imported. Invoked as
 * `npm run compile-map -- --area juliette-ga` (SC3's "one command").
 *
 * Pipeline stages, in the order later plans add them (none of this exists
 * yet beyond stage 0 — this file is deliberately a composition root from day
 * one, not a placeholder that later becomes one):
 *   1. Resolve `--area` against the known-area registry (this plan).
 *   2. Fetch/cache raw OSM data for the area's bbox (plan 04-02).
 *   3. Fetch/cache the DEM raster covering the area's bbox (plan 04-03/04-04).
 *   4. Build the dense-id `RoadGraph` from OSM ways/nodes, mapping surfaces
 *      via `graph/surface-mapping.ts` (this plan) and sampling elevation.
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
import { julietteGaConfig, type AreaConfig } from "./areas/juliette-ga.config.ts";

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

function main(argv: readonly string[]): void {
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

  // Stages 2-8 (fetch, build, author, validate, write) land in later plans —
  // see this file's own header comment for the full pipeline order.
}

main(process.argv.slice(2));
