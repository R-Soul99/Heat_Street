/**
 * Implements `docs/schemas/road-graph.v1.md`'s "OSM -> game surface mapping"
 * table exactly as written — the locked mapping is specified there, not
 * redesigned here. This is the compensating control the schema's design
 * decision 4 requires: an OSM `surface=*` value the table does not
 * recognise fails the BUILD (`mapSurface` throws), rather than silently
 * defaulting an unmapped dirt track to `tarmac`.
 *
 * There is deliberately no `try`/`catch` anywhere in this module and no
 * `??`/`||` fallback to `"tarmac"` — 04-RESEARCH.md names
 * `try { mapSurface(v) } catch { return "tarmac" }` as precisely the bug
 * this schema exists to prevent.
 *
 * `fromFallback` on the returned result is `true` exactly when the `surface`
 * tag was absent and the `highway=*` road-class table supplied the value —
 * `surfaceCoverage` aggregates that flag so the compiler can print a
 * build-time coverage report, the compensating control 04-RESEARCH.md
 * recommends for the documented 39-63% untagged-way rate at the target area
 * (an actually-gravel service track with no `surface` tag would otherwise
 * compile as `tarmac` with no build failure — a gap that is absence, not a
 * wrong value, so the schema's BUILD-fail rule does not catch it by design).
 *
 * Layering: pure data/logic, no I/O, no network, no fs. NOT mechanically
 * enforced — `tests/layering.test.ts` does not scan `tools/**`; this file's
 * own discipline is the only guard.
 */
// Explicit `.ts` extension: Node's native type-stripping (which runs
// `tools/map-compiler/cli.ts` and everything it imports) requires
// fully-specified relative ESM specifiers. Vite, Vitest and `tsc` all
// resolve the explicit form fine, matching `src/core/road-graph.ts`'s same
// deliberate deviation from the extensionless `src/` convention.
import type { SurfaceType } from "../../../src/core/surface-types.ts";

/**
 * OSM `surface=*` value -> game surface, for every explicitly-tagged way.
 * [CITED: docs/schemas/road-graph.v1.md "OSM -> game surface mapping" table]
 */
const SURFACE_BY_OSM_VALUE: Record<string, SurfaceType> = {
  asphalt: "tarmac",
  concrete: "tarmac",
  "concrete:plates": "tarmac",
  paved: "tarmac",
  chipseal: "tarmac",
  paving_stones: "tarmac",
  // [CITED: docs/schemas/road-graph.v1.md "OSM -> game surface mapping"
  // table + its cobblestone paragraph] `sett` is mapped to `tarmac` as the
  // closest of the six available surfaces; if tuning ever shows that reads
  // wrong, the doc says to add a seventh enum value deliberately rather than
  // remap this row silently.
  sett: "tarmac",
  gravel: "gravel",
  fine_gravel: "gravel",
  pebblestone: "gravel",
  compacted: "dirt_road",
  dirt: "dirt_road",
  earth: "dirt_road",
  ground: "dirt_road",
  unpaved: "dirt_road",
  grass: "grass",
  grass_paver: "grass",
  sand: "sand",
  mud: "mud",
};

/**
 * OSM `highway=*` value -> game surface, used only when `surface` is absent.
 * [CITED: docs/schemas/road-graph.v1.md "OSM -> game surface mapping" table]
 */
const SURFACE_BY_HIGHWAY_FALLBACK: Record<string, SurfaceType> = {
  motorway: "tarmac",
  trunk: "tarmac",
  primary: "tarmac",
  secondary: "tarmac",
  tertiary: "tarmac",
  residential: "tarmac",
  unclassified: "tarmac",
  service: "tarmac",
  track: "dirt_road",
};

/**
 * OSM `surface=*` values that ARE documented but are deliberately NOT
 * mapped to any game surface — each with its own explanatory message so a
 * build failure here reads differently from a genuinely-unrecognised value.
 * `docs/schemas/road-graph.v1.md`'s cobblestone paragraph: the OSM wiki
 * flags `cobblestone` itself as "an unclear value" and recommends `sett`/
 * `unhewn_cobblestone` instead; silently lumping it into `tarmac` would give
 * a rough historic street the grip of fresh asphalt.
 */
const DELIBERATELY_UNMAPPED: Readonly<Record<string, string>> = {
  cobblestone:
    'recognised but deliberately unmapped — see docs/schemas/road-graph.v1.md\'s cobblestone paragraph. The OSM wiki flags "cobblestone" itself as an unclear value; use "sett" or "unhewn_cobblestone" on the source data instead.',
  unhewn_cobblestone:
    "recognised but deliberately unmapped — see docs/schemas/road-graph.v1.md. If this ever needs to render distinctly from the mapped surfaces, add a seventh game surface enum value rather than remapping this row.",
};

/** `mapSurface`'s return value. */
export interface MapSurfaceResult {
  readonly surface: SurfaceType;
  /** `true` exactly when `osmSurface` was absent and the road-class fallback table supplied the value. */
  readonly fromFallback: boolean;
}

/**
 * Resolves one edge's OSM tags to a game `SurfaceType`.
 *
 * Throws (never defaults) when `osmSurface` is present but not a mapped
 * value, when `osmSurface` is one of the deliberately-unmapped values, or
 * when `osmSurface` is absent and `osmHighway` has no fallback entry.
 */
export function mapSurface(osmSurface: string | undefined, osmHighway: string): MapSurfaceResult {
  if (osmSurface !== undefined) {
    const unmappedReason = DELIBERATELY_UNMAPPED[osmSurface];
    if (unmappedReason !== undefined) {
      throw new Error(`mapSurface: OSM surface="${osmSurface}" is ${unmappedReason}`);
    }

    const mapped = SURFACE_BY_OSM_VALUE[osmSurface];
    if (mapped === undefined) {
      throw new Error(
        `mapSurface: OSM surface="${osmSurface}" is not a mapped value — see docs/schemas/road-graph.v1.md's "OSM -> game surface mapping" table. Never silently defaulted.`,
      );
    }
    return { surface: mapped, fromFallback: false };
  }

  const fallback = SURFACE_BY_HIGHWAY_FALLBACK[osmHighway];
  if (fallback === undefined) {
    throw new Error(
      `mapSurface: OSM highway="${osmHighway}" has no surface tag and no highway-class fallback — see docs/schemas/road-graph.v1.md's "OSM -> game surface mapping" table.`,
    );
  }
  return { surface: fallback, fromFallback: true };
}

interface CoverageCounts {
  readonly explicit: number;
  readonly fallback: number;
  readonly fallbackRatio: number;
}

export interface SurfaceCoverageReport {
  readonly overall: CoverageCounts;
  readonly byRoadClass: Readonly<Record<string, CoverageCounts>>;
}

/**
 * Aggregates a list of per-edge `{ roadClass, fromFallback }` records into
 * per-road-class explicit-vs-fallback counts plus an overall fallback
 * ratio — the build-time coverage report 04-RESEARCH.md recommends printing
 * alongside the compiled map, so a high fallback ratio on a road class like
 * `service`/`track` (this project's documented accuracy risk) is visible
 * rather than silently baked into the artifact.
 */
export function surfaceCoverage(
  records: readonly { readonly roadClass: string; readonly fromFallback: boolean }[],
): SurfaceCoverageReport {
  const rawByRoadClass = new Map<string, { explicit: number; fallback: number }>();
  let explicitTotal = 0;
  let fallbackTotal = 0;

  for (const record of records) {
    const bucket = rawByRoadClass.get(record.roadClass) ?? { explicit: 0, fallback: 0 };
    if (record.fromFallback) {
      bucket.fallback += 1;
      fallbackTotal += 1;
    } else {
      bucket.explicit += 1;
      explicitTotal += 1;
    }
    rawByRoadClass.set(record.roadClass, bucket);
  }

  const byRoadClass: Record<string, CoverageCounts> = {};
  for (const [roadClass, counts] of rawByRoadClass) {
    const total = counts.explicit + counts.fallback;
    byRoadClass[roadClass] = {
      explicit: counts.explicit,
      fallback: counts.fallback,
      fallbackRatio: total === 0 ? 0 : counts.fallback / total,
    };
  }

  const overallTotal = explicitTotal + fallbackTotal;
  return {
    overall: {
      explicit: explicitTotal,
      fallback: fallbackTotal,
      fallbackRatio: overallTotal === 0 ? 0 : fallbackTotal / overallTotal,
    },
    byRoadClass,
  };
}
