---
phase: 04-map-pipeline-first-area
plan: 04
subsystem: infra
tags: [typescript, node-esm, road-graph, osm, projection, junction-detection, tools-tier]

# Dependency graph
requires:
  - phase: 04-map-pipeline-first-area
    plan: 01
    provides: "tools/ tier opened, RoadGraph contract + parseRoadGraph, surface-mapping.ts (mapSurface/surfaceCoverage)"
  - phase: 04-map-pipeline-first-area
    plan: 02
    provides: "committed real Juliette, GA Overpass snapshot, juliette-ga.config.ts's real osmSnapshot/osmExtract, fixtures/overpass.juliette-sample.json"
provides:
  - "tools/map-compiler/graph/project.ts — makeProjector: WGS84 lat/lon -> local ENU metres (X east, Y up, Z south)"
  - "tools/map-compiler/graph/build-graph.ts — buildGraph: Overpass elements -> dense-id RoadGraph with real junction topology, pruned orphan components, resolved edge attributes, and a build report"
  - "public/maps/juliette-ga.map.json — the first real compiled area artifact (50 nodes, 64 edges, 3 surfaces)"
  - "tests/compiled-map.test.ts — schema/topology/attribution assertions against the REAL compiled artifact"
affects: [04-05, 04-06, 04-07, 04-08, 04-09, 04-10]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Node-key-based topology assembly (numeric OSM id or coordinate-key fallback) kept separate from dense-id assignment — dense ids are assigned only AFTER largest-component pruning, so they stay contiguous over the kept graph, not the raw one"
    - "Deterministic ordering by sorting (osmNodeId) and (osmWayId, segmentIndex) before dense-id assignment, independent of Overpass response array order"
    - "buildGraph self-checks its own JSON.stringify output through parseRoadGraph before returning — compiler and runtime can never disagree about what conforms"
    - "biome.json array-formatting exclusion for public/maps/*.json, mirroring the existing tools/map-compiler/areas/*.raw-*.json exclusion for pretty-printed machine-generated JSON"

key-files:
  created:
    - tools/map-compiler/graph/project.ts
    - tools/map-compiler/graph/project.test.ts
    - tools/map-compiler/graph/build-graph.ts
    - tools/map-compiler/graph/build-graph.test.ts
    - public/maps/juliette-ga.map.json
    - tests/compiled-map.test.ts
  modified:
    - tools/map-compiler/cli.ts
    - tests/docs-present.test.ts
    - biome.json

key-decisions:
  - "Tasks 1 (topology) and 2 (attribute resolution) implemented and committed together in build-graph.ts — buildGraph's return type (RoadGraph) requires every edge attribute resolved before a type-valid object exists at all, so there is no clean intermediate compilable state between the two"
  - "Coordinate-keyed fallback nodes (missing OSM `nodes` array) get a synthetic negative osmNodeId (real OSM ids are always positive) — [ASSUMED], documented, never exercised by the real Juliette snapshot (which always carries `nodes`)"
  - "Junction-fan/render/collision geometry authoring (04-RESEARCH.md Pattern 1/2) is explicitly NOT in this plan — only the dense-id graph + attributes; geometry authoring is later plans' job per the plan's own scope"
  - "BuildGraphConfig accepts osmSnapshot/osmExtract as `string | null` (matching AreaConfig's placeholder type) and buildGraph throws a named error if either is still null, rather than narrowing the type and forcing every caller to prove non-null out of band"

requirements-completed: [SC2, SC3, SC4]

# Metrics
duration: 13min
completed: 2026-09-13
---

# Phase 4 Plan 4: Local ENU projection, road-network topology, and the first real compiled map Summary

**One command (`npm run compile-map -- --area juliette-ga`) turns the committed Overpass snapshot into a schema-conforming, reproducible `public/maps/juliette-ga.map.json` — 50 nodes (36 junctions), 64 edges across three real surfaces (tarmac/dirt_road/gravel), with a genuine cycle and OpenStreetMap attribution verified against the real compiled output.**

## Performance

- **Duration:** ~13 min
- **Started:** 2026-09-13T21:19:11+01:00 (approx, first test run)
- **Completed:** 2026-09-13T22:30:59+01:00
- **Tasks:** 3
- **Files modified:** 9 (6 created, 3 modified)

## Accomplishments

- `makeProjector` implements the standard WGS84 local-tangent metres-per-degree series with Z deliberately inverted to point south (matching the schema's X-east/Y-up/Z-south convention); round-trips within 1e-9 degrees and is explicitly tested for the north-gives-negative-z sign, not just visually inspected.
- `buildGraph` turns Overpass `way` elements into real topology: node ids shared by 3+ ways become `junction: true` (computed from post-build edge degree, not raw occurrence count, so a self-looping way's double contribution is handled correctly); ways split into multiple edges wherever they pass through a node shared with another way; dense node/edge ids assigned deterministically (sorted by `osmNodeId` / `(osmWayId, segmentIndex)`) so two builds of the same snapshot are byte-identical; components disconnected from the largest one are pruned and reported by edge id, `osmWayId` and length (D-P12).
- Every edge attribute resolved per the schema: `surface` via `mapSurface` (throws, never defaults, naming the OSM value and `osmWayId`), `roadClass`/`lanes`/`widthM`/`oneway` (with `-1` direction+point reversal)/`speedLimitKph` (bare/`N mph`/class-default)/`bridge`/`tunnel`/`layer`, full `source`/`attribution` provenance from ADR 0001, and a derived `spawns[0]` at the degree>=2 node nearest the bbox centre, heading along its first incident edge.
- `buildGraph` self-checks its own output through `parseRoadGraph` before returning — the compiler cannot emit an artifact its own runtime would reject.
- `npm run compile-map -- --area juliette-ga` really ran: 36 of 56 ways retained (20 dropped as `service` with no explicit surface — D-P13), compiling to **50 nodes (36 junctions) / 64 edges**, surfaces `tarmac:47, dirt_road:9, gravel:8`, 7 pruned edges from 4 ways exiting the bbox, overall surface fallback ratio 0.031 (well under both the 0.4 warn and 0.75 fail thresholds). Run twice, the output file is byte-identical (verified via `sha256sum`).
- `tests/compiled-map.test.ts` asserts against the REAL committed artifact (not the hand fixture): schema conformance, dense ids, endpoint coincidence, closed surface enum, exact ADR 0001 attribution strings, parseable `osmSnapshot`, bounds containment, >=2 surfaces (SC2), a >=20-edge/>=3-junction sanity floor, and `edges.length >= nodes.length` (D-08's cycle requirement — 64 >= 50 holds).

## Task Commits

1. **Task 1 + Task 2: Local ENU projection, road-network topology, and edge attribute resolution** (TDD) — `ec81091` (feat; topology and attribute resolution committed together, see TDD Gate Compliance below)
2. **Task 3: CLI emits the real Juliette map; conformance test runs against the real output** — `abb0240` (feat)

**Plan metadata:** commit pending (this SUMMARY + self-check, this commit).

## TDD Gate Compliance

Tasks 1 and 2 are both marked `tdd="true"` in the plan and share the same target file (`build-graph.ts`). A genuine RED phase was verified for `project.ts`/`project.test.ts` (implementation temporarily removed, `npx vitest run` confirmed `Cannot find module`, then restored and re-verified GREEN — see commit `ec81091`'s test file for the covered behavior). For `build-graph.ts`, Tasks 1 (topology) and 2 (attribute resolution) were implemented together rather than as two separately-compilable RED/GREEN cycles: `buildGraph`'s return type is `RoadGraph`, and every field on `RoadGraphEdge` (surface, lanes, widthM, oneway, speedLimitKph, bridge, tunnel, layer) is non-optional — there is no type-valid intermediate `RoadGraph` that has real topology but placeholder attributes without either fabricating a second, throwaway type just for Task 1's commit boundary or hand-stubbing attribute fields in a way that would misrepresent the work as "done" when it wasn't. Both tasks' full test coverage (`build-graph.test.ts`'s "Task 1: topology" and "Task 2: edge attribute resolution and artifact assembly" describe blocks, 25 tests total) was written and verified together before the single combined commit. No functional gap — every behavior bullet from both tasks has a passing, focused test; the gap is in commit-history granularity only, not in test coverage or correctness.

## Files Created/Modified

- `tools/map-compiler/graph/project.ts` - `makeProjector(origin)`: WGS84 lat/lon -> local ENU metres (X east, Z south), `project`/`unproject`
- `tools/map-compiler/graph/project.test.ts` - 7 tests: origin identity, east/north/south sign and magnitude, round-trip, linear scaling
- `tools/map-compiler/graph/build-graph.ts` - `buildGraph`, `COMPILER_VERSION`, `DEFAULT_LANES_BY_CLASS`, `DEFAULT_SPEED_KPH_BY_CLASS`, `LANE_WIDTH_M` — topology + attribute resolution + artifact assembly + self-check
- `tools/map-compiler/graph/build-graph.test.ts` - 25 tests covering every Task 1 and Task 2 behavior bullet, plus real-fixture and determinism cases
- `tools/map-compiler/cli.ts` - wires `buildGraph`, prints the full `BuildReport`, writes `public/maps/<areaId>.map.json`, aborts/warns on high surface-fallback ratio
- `public/maps/juliette-ga.map.json` - the first real compiled area artifact (50 nodes / 64 edges / 3 surfaces)
- `tests/compiled-map.test.ts` - 11 tests asserting the real committed artifact's schema conformance, topology and provenance
- `tests/docs-present.test.ts` - registers `public/maps/juliette-ga.map.json` in `REQUIRED` (5000-char floor), widens `import.meta.glob` to `../public/maps/*.json`
- `biome.json` - excludes `public/maps/*.json` from formatting (pretty-printed, diffable machine-generated artifact)

## Decisions Made

- Tasks 1 and 2 committed together (see TDD Gate Compliance) — `buildGraph` is a single cohesive function whose output type structurally requires both halves to exist simultaneously.
- Coordinate-keyed fallback nodes get a synthetic negative `osmNodeId` (`-(id+1)`) since they have no real OSM id — `[ASSUMED]`, documented in code, exercised only by a hand-authored test case (the real Juliette snapshot always carries a `nodes` array, per plan 04-02's `out body geom qt` query).
- `BuildGraphConfig.osmSnapshot`/`osmExtract` typed `string | null` (matching `AreaConfig`'s placeholder type) rather than requiring the caller to narrow first — `buildGraph` throws a named, actionable error if either is still `null` at build time.
- Default lane/speed/width tables (`DEFAULT_LANES_BY_CLASS`, `DEFAULT_SPEED_KPH_BY_CLASS`, `LANE_WIDTH_M`) are named, exported constants rather than inline literals, per the plan's own instruction — ready for plan 04-10's feel-session retuning in one place.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Added a `biome.json` exclusion for `public/maps/*.json`**
- **Found during:** Task 3, `npm run check`
- **Issue:** `npm run check`'s lint step wanted to collapse the pretty-printed (`JSON.stringify(..., null, 2)`) edge `points` arrays onto single lines per biome's own array-formatting rule — the same class of conflict plan 04-02 hit with the raw Overpass cache files, now recurring for the compiled map artifact.
- **Fix:** Added `"!public/maps/*.json"` to `biome.json`'s `files.includes`, mirroring the existing `tools/map-compiler/areas/*.raw-*.json` exclusion.
- **Files modified:** `biome.json`
- **Verification:** `npm run check` green (typecheck + lint + 702 tests / 39 files)
- **Committed in:** `abb0240` (Task 3 commit)

**2. [Rule 3 - Blocking] `BuildGraphConfig.osmSnapshot`/`osmExtract` widened to `string | null`**
- **Found during:** Task 1/2, `npm run typecheck`
- **Issue:** `julietteGaConfig` is typed as `AreaConfig`, whose `osmSnapshot`/`osmExtract` fields are `string | null` (the `null` covers the pre-Overpass-fetch placeholder state). The initial `BuildGraphConfig` required plain `string`, so passing the real config object into `buildGraph`/tests failed to typecheck even though the runtime values are real, non-null strings.
- **Fix:** Widened `BuildGraphConfig`'s two fields to `string | null` and added an explicit, named throw at the top of `buildGraph` if either is still `null` — fail loud rather than silently emit a schema-invalid artifact.
- **Files modified:** `tools/map-compiler/graph/build-graph.ts`
- **Verification:** `npm run typecheck` clean; `build-graph.test.ts` unaffected (uses real non-null values)
- **Committed in:** `ec81091` (Task 1+2 commit)

**3. [Rule 1 - Bug] Test-design fix: isolated single-way `buildGraph` calls for independent attribute-resolution assertions**
- **Found during:** Task 2 test authoring, first `npx vitest run`
- **Issue:** Several attribute-resolution tests originally combined two unrelated, topologically-disconnected ways in one `buildGraph` call to check two attribute values at once (e.g. lanes-present vs. lanes-absent). Since Task 1's largest-component pruning keeps only the single largest connected component, the two single-edge components ended up competing and one was arbitrarily pruned, making the pruned way's edge `undefined` in the test.
- **Fix:** Split those tests into separate `buildGraph` calls (one way per call, each trivially its own largest component), or connected the two ways via a shared node where the test's intent genuinely needed both edges in one graph (the `surfaceCoverage` aggregate test).
- **Files modified:** `tools/map-compiler/graph/build-graph.test.ts`
- **Verification:** all 25 `build-graph.test.ts` tests pass
- **Committed in:** `ec81091` (Task 1+2 commit)

---

**Total deviations:** 3 auto-fixed (2 Rule 3 blocking, 1 Rule 1 bug — all caught and fixed within the same task, before commit).
**Impact on plan:** All three are self-contained correctness fixes (a formatter conflict, a type-narrowing gap, and a test-design bug). No scope creep, no change to any documented behavior bullet.

## Issues Encountered

None beyond the three deviations above.

## User Setup Required

None — no external service configuration required. `npm run compile-map` read the already-committed, cached Overpass snapshot from plan 04-02; no network calls were made this session.

## Known Stubs

None. `public/maps/juliette-ga.map.json` is a real compiled artifact from real OSM data, not a placeholder — every `y` is `0` by design (D-P11; plan 04-05 owns elevation), which is documented as a legitimate flat intermediate, not a stub.

## Observations for Later Plans

- **Compiled bounds are larger than the query bbox.** `bounds` spans roughly 5.5km (X) x 5.7km (Z), noticeably larger than the ~2.9km x 2.4km query box, because Overpass returns a way's FULL geometry even when only part of it intersects the bbox (a documented, correct characteristic of `way[bbox]` queries, not a compiler bug). This plan's behavior bullets and acceptance criteria do not call for bbox-clipping way geometry, so none was added — flagging this for plan 04-06 (validation) or a later plan to decide whether trimming is worth the added complexity against D-07's "1-2 minute drive" framing.
- **Junction density (36 of 50 nodes) is high** but arithmetically consistent (sum of degrees = 128 = 2×64 edges; 36 nodes at degree>=3 account for >=108 of that, leaving the rest as low-degree dead ends/pass-throughs) — plausible for a dense small-town core with several T/4-way intersections plus the interconnected gravel slipway/boat-ramp cluster noted in plan 04-02's SUMMARY, not inspected further as no acceptance criterion questions it.

## Next Phase Readiness

- `public/maps/juliette-ga.map.json` is the real, committed, reproducible artifact plan 04-05 (elevation) will read and rewrite `y` values into — every node/point currently has `y: 0`.
- `buildGraph`'s `RawEdge`/topology internals are not exported beyond what `BuildGraphResult` exposes — plan 04-05 should extend `buildGraph` (or a wrapping stage) directly rather than re-deriving topology.
- No blockers. `npm run check` is green (typecheck + lint + 702 tests across 39 files) at the end of this plan.

---
*Phase: 04-map-pipeline-first-area*
*Completed: 2026-09-13*

## Self-Check: PASSED

All 9 claimed files verified present on disk (`tools/map-compiler/graph/project.ts`,
`tools/map-compiler/graph/project.test.ts`, `tools/map-compiler/graph/build-graph.ts`,
`tools/map-compiler/graph/build-graph.test.ts`, `public/maps/juliette-ga.map.json`,
`tests/compiled-map.test.ts`, `tools/map-compiler/cli.ts`, `tests/docs-present.test.ts`,
`biome.json`), plus this SUMMARY itself. Both claimed commit hashes verified present in
`git log --oneline --all` (`ec81091`, `abb0240`).
