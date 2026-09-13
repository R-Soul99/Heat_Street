---
phase: 04-map-pipeline-first-area
plan: 01
subsystem: infra
tags: [typescript, node-esm, ngraph, geotiff, vitest, osm, road-graph, tools-tier]

# Dependency graph
requires:
  - phase: 01-engine-foundation
    provides: "docs/schemas/road-graph.v1.md, fixtures/road-graph.sample.json, docs/adr/0001-map-data-source.md, tests/no-google-pipeline.test.ts, src/core/surface-types.ts"
provides:
  - "tools/ tier opened: tsconfig include, Google-pipeline grep gate extension, exact-pinned devDependencies"
  - "npm run compile-map CLI entry point resolving --area against an explicit area registry"
  - "tools/map-compiler/areas/juliette-ga.config.ts — the confirmed D-01/D-02/D-03 target area"
  - "src/core/road-graph.ts — RoadGraph types + parseRoadGraph hostile-blob parser (shared compiler/runtime contract)"
  - "tools/map-compiler/graph/surface-mapping.ts — OSM surface=*/highway=* -> six-value game enum, throws on unmapped, doc-parity guarded"
affects: [04-02, 04-03, 04-04, 04-05, 04-06, 04-07]

# Tech tracking
tech-stack:
  added: ["ngraph.graph@20.1.2", "ngraph.path@1.6.1", "geotiff@3.0.5", "@types/node@24.13.4"]
  patterns:
    - "Node-executed tools/** files use explicit .ts extensions on relative imports (Node 24 native type-stripping ESM resolver requirement); src/ stays extensionless except where a tools/ file imports it directly"
    - "Field-by-field JSON reconstruction (never spread/merge the parsed value) as the prototype-pollution control for any hostile-blob parser that must THROW rather than default"
    - "Doc-is-the-source/code-is-the-mirror drift guard extended to the OSM surface mapping table via a parsed-table equality test, following the existing SURFACE_ENUM precedent"

key-files:
  created:
    - tools/map-compiler/cli.ts
    - tools/map-compiler/areas/juliette-ga.config.ts
    - src/core/road-graph.ts
    - tests/road-graph-parse.test.ts
    - tools/map-compiler/graph/surface-mapping.ts
    - tools/map-compiler/graph/surface-mapping.test.ts
  modified:
    - tsconfig.json
    - package.json
    - tests/no-google-pipeline.test.ts

key-decisions:
  - "@types/node pinned to 24.13.4, the highest published 24.x release (no 24.14.x exists on the registry, even though the installed Node is 24.14.1)"
  - "RoadGraph parser reconstructs every field individually rather than spreading/Object-merging the JSON.parse result, closing prototype pollution structurally rather than via a deny-list"
  - "surface-mapping.ts imports only the SurfaceType TYPE (not the SURFACE_TYPES runtime array) from src/core/surface-types.ts, since TypeScript's Record<string, SurfaceType> already constrains every literal value at compile time — no separate runtime enum-membership check was needed the way road-graph.ts's parser needs one for untyped JSON input"

requirements-completed: [SC2, SC3, SC4]

# Metrics
duration: 24min
completed: 2026-09-13
---

# Phase 4 Plan 1: Open the tools/ tier — CLI, RoadGraph contract, surface mapping Summary

**Node-executed `tools/map-compiler` CLI resolving a confirmed Juliette, GA area config, plus a shared hostile-blob `RoadGraph` parser and a build-failing OSM surface mapping table, both TDD'd and doc-parity guarded.**

## Performance

- **Duration:** 24 min
- **Started:** 2026-09-13T16:16:47+01:00 (base commit)
- **Completed:** 2026-09-13T16:40:30+01:00
- **Tasks:** 3 (Tasks 2 and 3 each followed RED -> GREEN)
- **Files modified:** 9 (6 created, 3 modified)

## Accomplishments

- `npm run compile-map -- --area juliette-ga` runs, printing the confirmed Juliette, GA bbox, name and DEM source; `--area nope` exits 1 naming both the bad id and the known ids — no dynamic argv-built `import()`, an explicit registry only.
- `docs/schemas/road-graph.v1.md`'s shape now has exactly one code mirror, `src/core/road-graph.ts`, shared by the compiler (`tools/`) and the eventual browser runtime, with a hostile-blob parser that throws (never defaults) on every documented failure mode and cannot be prototype-polluted.
- The OSM surface mapping table is implemented exactly as specified, throws (never silently defaults to tarmac) on an unmapped or deliberately-unmapped value, and is drift-guarded against the schema doc via a parsed-table equality test — verified to genuinely fail when a mapping row is removed.
- The Google-data grep gate (`tests/no-google-pipeline.test.ts`) now scans `tools/**/*.ts`, closing the gap a stray "Google Maps" comment in the new compiler tree would otherwise have slipped through.

## Task Commits

1. **Task 1: Open the tools/ tier — tsconfig, grep gate, pinned deps, CLI entry, area config** - `1b98316` (feat)
2. **Task 2: RoadGraph contract and hostile-blob parser in src/core/** (TDD) - `81845bd` (test, RED) -> `e26feb7` (feat, GREEN)
3. **Task 3: OSM surface mapping with build-failing unmapped values and a fallback-coverage report** (TDD) - `ca2bca0` (test, RED) -> `bf0562d` (feat, GREEN)

**Formatting cleanup:** `459273a` (style) — mechanical `biome check --write` fixes (import order, line wrapping, quote style) across all five touched files; `npm run check` was green both before and after.

**Plan metadata:** commit pending (this SUMMARY + self-check, this commit).

_TDD tasks: each is exactly test -> feat, no refactor commit needed (implementations passed on the first GREEN attempt)._

## Files Created/Modified

- `tsconfig.json` - added `"tools"` to `include`, added `allowImportingTsExtensions: true`
- `package.json` - added `compile-map` script; pinned `ngraph.graph`, `ngraph.path`, `geotiff`, `@types/node` as exact devDependencies
- `tests/no-google-pipeline.test.ts` - widened `SCANNED_GLOBS`/`SCANNED` to a fifth `tools/**/*.ts` leg; updated the scope decision comment and the "scanned the specific files" list
- `tools/map-compiler/cli.ts` - the compiler's composition root; resolves `--area` against an explicit registry, prints the resolved area or a named error
- `tools/map-compiler/areas/juliette-ga.config.ts` - the confirmed Juliette, GA `AreaConfig` (bbox, `usgs-3dep-1m`, `excludeHighwayClasses: ["service"]`, `osmSnapshot: null` placeholder for plan 04-02)
- `src/core/road-graph.ts` - `ROAD_GRAPH_SCHEMA_VERSION`, `RoadGraph`/`RoadGraphNode`/`RoadGraphEdge`/etc. interfaces, `parseRoadGraph` hostile-blob parser
- `tests/road-graph-parse.test.ts` - 35 tests covering every `parseRoadGraph` behavior bullet, including prototype-pollution resistance
- `tools/map-compiler/graph/surface-mapping.ts` - `mapSurface`/`surfaceCoverage`, implementing the schema doc's OSM mapping table
- `tools/map-compiler/graph/surface-mapping.test.ts` - 35 tests including the doc-parity drift guard

## Decisions Made

- `@types/node` pinned to `24.13.4` (highest published 24.x; no 24.14.x exists yet even though the local Node runtime is 24.14.1) — recorded per the plan's own instruction to document which version was chosen and why.
- `parseRoadGraph` never spreads or wholesale-copies the `JSON.parse` result — every field is read and re-assembled individually, which is what makes the prototype-pollution guarantee structural rather than a deny-list of dangerous key names.
- `surface-mapping.ts` imports only the `SurfaceType` type (not the `SURFACE_TYPES` runtime array) — the `Record<string, SurfaceType>` lookup tables are compile-time-constrained to valid game surfaces already, so no separate runtime membership check was needed there the way `road-graph.ts` needs one (its input is untyped JSON, not a TypeScript literal).

## Deviations from Plan

**1. [Rule 3 - Blocking] Fixed a block-comment self-termination bug in `tests/no-google-pipeline.test.ts`**
- **Found during:** Task 1, first `npm run typecheck` after extending the SCOPE DECISION RECORD comment
- **Issue:** The comment as first drafted contained the literal text `` `tools/**/*.ts` `` inside a `/** ... */` JSDoc block. The three-character sequence `**/` is itself a block-comment terminator, so the comment closed early and the remainder of the file was parsed as code, producing a cascade of ~15 `tsc` syntax errors.
- **Fix:** Reworded the comment to describe the change ("a fifth `tools` TypeScript-tree leg") without the literal `**/*.ts` glob substring. The `SCANNED_GLOBS` array entry and the `import.meta.glob` call themselves (string literals and `//` line comments) were unaffected — the bug only applies inside `/** */` block comments.
- **Files modified:** `tests/no-google-pipeline.test.ts`
- **Verification:** `npm run typecheck` clean; `npx vitest run tests/no-google-pipeline.test.ts` passes (12 tests)
- **Committed in:** `1b98316` (Task 1 commit — caught and fixed before that commit was made, not a separate fix commit)

**2. [Rule 3 - Blocking] Reworded `cli.ts`'s registry doc comment to avoid a literal `import(` + template-literal sequence**
- **Found during:** Task 1, self-review against the acceptance criterion "`tools/map-compiler/cli.ts` contains no template-literal or argv-interpolated `import(` expression"
- **Issue:** The doc comment explaining why the area registry is a plain object (not a dynamic import) originally illustrated the forbidden pattern literally: `` `import(`./areas/${id}.config.ts`)` ``. A literal grep for that shape would have matched the explanatory comment itself, a false positive against the acceptance gate.
- **Fix:** Reworded the comment to describe the forbidden pattern in prose ("a path built as `"./areas/" + id + ".config.ts"`") instead of writing the literal syntax.
- **Files modified:** `tools/map-compiler/cli.ts`
- **Verification:** `grep -nE '\bimport\(' tools/map-compiler/cli.ts` returns nothing; `npm run typecheck` clean
- **Committed in:** `1b98316` (Task 1 commit)

**3. [Rule 3 - Blocking] Same block-comment self-termination bug avoided proactively in `src/core/road-graph.ts`'s doc comment**
- **Found during:** Task 2, while writing the module header, after having already hit deviation #1 in Task 1
- **Issue:** An early draft of the header comment stated the design rule using the literal substring `Object.assign` inside prose, which would have tripped the plan's own acceptance-criteria grep (`grep -nE '(\.\.\.[A-Za-z_]*[Pp]arsed|Object\.assign)' src/core/road-graph.ts` must return nothing) as a false positive against a comment, not real spread/merge code.
- **Fix:** Reworded the comment to "never copies it wholesale via any object-merging helper" instead of naming `Object.assign` literally.
- **Files modified:** `src/core/road-graph.ts`
- **Verification:** `grep -nE '(\.\.\.[A-Za-z_]*[Pp]arsed|Object\.assign)' src/core/road-graph.ts` returns nothing; 35/35 tests pass
- **Committed in:** `e26feb7` (Task 2 GREEN commit)

---

**Total deviations:** 3 auto-fixed (all Rule 3 — blocking issues caught before the affected task's commit, not as later fix-up commits)
**Impact on plan:** All three are self-inflicted authoring mistakes (comment text tripping either TypeScript's own parser or this plan's acceptance-criteria greps) caught and fixed during the same task, before any commit. No scope creep, no behavior change to any shipped function.

## Issues Encountered

None beyond the three deviations above (all caught and fixed within the same task, before commit).

## User Setup Required

None - no external service configuration required. (Task 1's `npm install` ran against the public npm registry only; no API keys or accounts needed for this plan.)

## Known Stubs

- `tools/map-compiler/areas/juliette-ga.config.ts`'s `osmSnapshot: null` is an intentional, documented placeholder — the plan's own action text specifies plan 04-02 fills it with the real Overpass retrieval timestamp. Not a UI-facing stub and does not block this plan's goal (a runnable, named `compile-map` command), which is met.

## Next Phase Readiness

- `RoadGraph` and `mapSurface`/`surfaceCoverage` are ready for plan 04-02 (Overpass fetch + graph builder) to consume directly.
- `tools/map-compiler/areas/juliette-ga.config.ts`'s `osmSnapshot: null` placeholder is explicitly plan 04-02's job to fill with a real retrieval timestamp once it performs the live Overpass fetch and caches the raw response (04-RESEARCH.md Pitfall 1).
- No blockers. `npm run check` is green (typecheck + lint + 617 tests across 34 files) at the end of this plan.

---
*Phase: 04-map-pipeline-first-area*
*Completed: 2026-09-13*

## Self-Check: PASSED

All 10 claimed files verified present on disk (`tsconfig.json`, `package.json`,
`tests/no-google-pipeline.test.ts`, `tools/map-compiler/cli.ts`,
`tools/map-compiler/areas/juliette-ga.config.ts`, `src/core/road-graph.ts`,
`tests/road-graph-parse.test.ts`, `tools/map-compiler/graph/surface-mapping.ts`,
`tools/map-compiler/graph/surface-mapping.test.ts`, and this SUMMARY itself).
All 6 claimed commit hashes verified present in `git log --oneline --all`
(`1b98316`, `81845bd`, `e26feb7`, `ca2bca0`, `bf0562d`, `459273a`).
