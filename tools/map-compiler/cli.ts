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
 *      printing a coverage summary (plan 04-02).
 *   3. Build the dense-id `RoadGraph` from OSM ways/nodes, mapping surfaces
 *      via `graph/surface-mapping.ts` (plan 04-01/04-04). `y` is flat (0)
 *      at this point.
 *   4. Fetch/cache the USGS 3DEP DEM raster covering the area's bbox, sample
 *      real elevation for every node and edge centreline point, smooth
 *      interior points with clamped endpoints, and recompute `lengthM`
 *      (plan 04-05).
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
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseRoadGraph } from "../../src/core/road-graph.ts";
import { type AreaConfig, julietteGaConfig } from "./areas/juliette-ga.config.ts";
import { type BuildReport, buildGraph } from "./graph/build-graph.ts";
import { applyElevation, type ElevationReport } from "./graph/elevation.ts";
import { makeProjector } from "./graph/project.ts";
import {
  type DemRaster,
  type LoadOrFetchDemResult,
  loadOrFetchDem,
  makeElevationSampler,
  parseDemRaster,
} from "./sources/dem.ts";
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

/** Above this overall fallback ratio, the compiled surfaces are mostly guesses rather than data — the build is aborted rather than shipping a silently-wrong map. */
const FALLBACK_RATIO_FAIL_THRESHOLD = 0.75;
/** Above this ratio (but at or below the fail threshold), the build proceeds but prints a named warning asking for a human spot-check — 04-RESEARCH.md's recommendation, not an automatic failure. */
const FALLBACK_RATIO_WARN_THRESHOLD = 0.4;

/** Where every area's compiled artifact is written — loaded by URL at runtime, never bundled (STACK.md's "maps go in public/" guidance). */
const MAPS_OUTPUT_DIR = path.join(import.meta.dirname, "..", "..", "public", "maps");

/**
 * Prints `BuildReport` as a readable, complete summary: way counts retained
 * and dropped by reason, node/edge/junction counts, every pruned component
 * (edge id, osm way id, length), the node-identity mode used, and the
 * surface-coverage table with its overall fallback ratio — the compensating
 * control 04-RESEARCH.md's "OSM Surface Tag Reliability" section asks for,
 * since an absent (not wrong) surface tag is not something the schema's
 * BUILD-fail rule catches by design.
 */
function printBuildReport(config: AreaConfig, report: BuildReport): void {
  console.log(`compile-map: build report for "${config.areaId}"`);
  console.log(`  ways retained: ${report.waysRetained}`);
  const dropEntries = Object.entries(report.waysDroppedByReason);
  console.log(
    `  ways dropped by reason: ${
      dropEntries.length === 0
        ? "(none)"
        : dropEntries.map(([reason, count]) => `${reason}:${count}`).join(", ")
    }`,
  );
  console.log(
    `  nodes: ${report.nodeCount} (junctions: ${report.junctionCount}), edges: ${report.edgeCount}`,
  );
  console.log(`  node identity mode: ${report.nodeIdentityMode}`);
  if (report.nodeIdentityMode === "coordinate-keyed") {
    console.warn(
      "  WARNING: at least one way had no OSM `nodes` array — node identity fell back to " +
        "coordinate-keying. This should not happen against plan 04-02's `out body geom qt` " +
        "query; investigate the source snapshot if this is unexpected.",
    );
  }
  if (report.prunedEdges.length === 0) {
    console.log("  pruned components: (none)");
  } else {
    console.log(
      `  pruned components: ${report.prunedEdges.length} edge(s) not connected to the largest component:`,
    );
    for (const pruned of report.prunedEdges) {
      console.log(
        `    edge id=${pruned.id} osmWayId=${pruned.osmWayId} lengthM=${pruned.lengthM.toFixed(1)}`,
      );
    }
  }
  if (report.surfaceCoverage !== null) {
    const { overall, byRoadClass } = report.surfaceCoverage;
    console.log(
      `  surface coverage: explicit=${overall.explicit} fallback=${overall.fallback} ` +
        `fallbackRatio=${overall.fallbackRatio.toFixed(3)}`,
    );
    for (const [roadClass, counts] of Object.entries(byRoadClass)) {
      console.log(
        `    ${roadClass}: explicit=${counts.explicit} fallback=${counts.fallback} ` +
          `fallbackRatio=${counts.fallbackRatio.toFixed(3)}`,
      );
    }
  }
}

/**
 * Prints the elevation stage's report: DEM source (cache/network) and byte
 * size, the raster's own parsed elevation range, NoData substitution count,
 * min/max/relief across the compiled graph's nodes, and every edge whose
 * gradient exceeds `GRADIENT_WARNING_THRESHOLD` — the same "fail loud, name
 * the offending id" discipline `printBuildReport` already applies to
 * topology, applied here to terrain.
 */
function printElevationReport(
  demResult: LoadOrFetchDemResult,
  raster: DemRaster,
  report: ElevationReport,
): void {
  let rasterMin = Number.POSITIVE_INFINITY;
  let rasterMax = Number.NEGATIVE_INFINITY;
  for (const value of raster.data) {
    if (value < rasterMin) rasterMin = value;
    if (value > rasterMax) rasterMax = value;
  }

  console.log(
    `  DEM: source=${demResult.source} bytes=${demResult.bytes.byteLength} ` +
      `raster=${raster.width}x${raster.height} noDataSubstitutions=${raster.noDataSubstitutions}`,
  );
  console.log(`  DEM raster elevation range: ${rasterMin.toFixed(2)}m to ${rasterMax.toFixed(2)}m`);
  console.log(
    `  compiled node elevation: min=${report.minNodeElevationM.toFixed(2)}m ` +
      `max=${report.maxNodeElevationM.toFixed(2)}m relief=${report.reliefM.toFixed(2)}m`,
  );
  if (report.steepEdges.length === 0) {
    console.log("  edges over gradient threshold: (none)");
  } else {
    console.log(`  edges over gradient threshold: ${report.steepEdges.length}`);
    for (const steep of report.steepEdges) {
      console.log(`    edge id=${steep.edgeId} maxGradient=${steep.maxGradient.toFixed(3)}`);
    }
  }
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

  const { graph, report } = buildGraph(roadsResult.envelope, config);
  printBuildReport(config, report);

  const overallFallbackRatio = report.surfaceCoverage?.overall.fallbackRatio ?? 0;
  if (overallFallbackRatio > FALLBACK_RATIO_FAIL_THRESHOLD) {
    console.error(
      `compile-map: ABORTED — overall surface fallback ratio ${overallFallbackRatio.toFixed(3)} ` +
        `exceeds ${FALLBACK_RATIO_FAIL_THRESHOLD}. The compiled surfaces would be almost entirely ` +
        `guesses rather than data. Investigate the source snapshot's surface tagging before retrying.`,
    );
    process.exit(1);
    return;
  }
  if (overallFallbackRatio > FALLBACK_RATIO_WARN_THRESHOLD) {
    console.warn(
      `compile-map: WARNING — overall surface fallback ratio ${overallFallbackRatio.toFixed(3)} ` +
        `exceeds ${FALLBACK_RATIO_WARN_THRESHOLD}. Proceeding, but a human spot-check of the ` +
        `compiled surfaces (satellite/street-view, or just driving the result) is recommended.`,
    );
  }

  // Elevation stage (plan 04-05): sample real USGS 3DEP terrain for every
  // node (authoritative, never smoothed), smooth each edge's interior
  // centreline with both ends clamped to node height, and recompute lengthM
  // now that y is real. Reuses the graph's OWN recorded origin (rather than
  // recomputing it from config.bbox independently) so the projector here is
  // guaranteed identical to the one `buildGraph` used internally.
  const demResult = await loadOrFetchDem(config, { refresh, maxSizePx: config.demSizePx });
  const raster = await parseDemRaster(demResult.bytes);
  const sampler = makeElevationSampler(raster);
  const projector = makeProjector({ lat: graph.origin.lat, lon: graph.origin.lon });
  const { graph: elevatedGraph, report: elevationReport } = applyElevation(
    graph,
    sampler,
    projector,
  );
  printElevationReport(demResult, raster, elevationReport);

  // Self-check: mirrors buildGraph's own discipline (graph/build-graph.ts) —
  // the compiler must never emit an artifact its own runtime parser rejects.
  parseRoadGraph(JSON.stringify(elevatedGraph), `applyElevation(${config.areaId})`);

  await mkdir(MAPS_OUTPUT_DIR, { recursive: true });
  const outputPath = path.join(MAPS_OUTPUT_DIR, `${config.areaId}.map.json`);
  await writeFile(outputPath, `${JSON.stringify(elevatedGraph, null, 2)}\n`, "utf8");
  console.log(`compile-map: wrote ${outputPath}`);

  // Stages 5-7 (geometry, author, validate against ngraph reachability) land
  // in later plans — see this file's own header comment for the full
  // pipeline order.
}

main(process.argv.slice(2)).catch((err: unknown) => {
  console.error(
    `compile-map: unhandled error — ${err instanceof Error ? err.message : String(err)}`,
  );
  process.exit(1);
});
