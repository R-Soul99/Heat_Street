---
phase: 04-map-pipeline-first-area
plan: 02
subsystem: infra
tags: [overpass, osm, node-fetch, disk-cache, tools-tier]

# Dependency graph
requires:
  - phase: 04-map-pipeline-first-area
    plan: 01
    provides: "tools/ tier opened (tsconfig, Google-pipeline grep gate, pinned devDependencies), npm run compile-map CLI entry point, juliette-ga.config.ts confirmed area, src/core/road-graph.ts RoadGraph contract, graph/surface-mapping.ts"
provides:
  - "tools/map-compiler/sources/overpass.ts — roadsQuery/buildingsQuery/parseOverpassResponse/fetchOverpass/loadOrFetchArea, the compiler's only network-touching module"
  - "Committed, timestamped real Juliette, GA Overpass snapshot (roads + buildings), offline-replayable from disk"
  - "juliette-ga.config.ts's osmSnapshot/osmExtract filled with real provenance values ready for the compiled artifact's source block"
  - "fixtures/overpass.juliette-sample.json — real-derived Overpass fixture (closed loop, 3-way junction, gravel/untagged mix) for every later compiler test"
affects: [04-03, 04-04, 04-05, 04-06, 04-07]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Node-fetch retry/backoff with injectable fetchImpl + delayImpl options — the only way to unit-test HTTP retry timing without real waits or real network access"
    - "Disk-cache envelope { fetchedAt, endpoint, bbox, query, response } written via temp-file + rename, so an interrupted fetch can never leave a truncated cache"
    - "A cached payload's bbox is checked against the requested bbox on every load — mismatch is a reported cache miss (console.warn), never a silent reuse"

key-files:
  created:
    - tools/map-compiler/sources/overpass.ts
    - tools/map-compiler/sources/overpass.test.ts
    - tools/map-compiler/areas/juliette-ga.raw-osm.json
    - tools/map-compiler/areas/juliette-ga.raw-buildings.json
  modified:
    - tools/map-compiler/cli.ts
    - tools/map-compiler/areas/juliette-ga.config.ts
    - fixtures/overpass.juliette-sample.json
    - biome.json

key-decisions:
  - "Retry backoff modeled as 3 retries after the initial attempt (4 total HTTP requests worst case) with delays 2s/4s/8s — the plan's '3 attempts, 2s/4s/8s' phrasing is ambiguous between 3 total vs. 3 retries; 3 retries was chosen since three delay values were specified and a single-retry read would leave the third delay unused"
  - "osmSnapshot is copied from the ROADS cache envelope's fetchedAt specifically (not buildings, which differs by a few milliseconds) — roads is the schema-critical topology data; buildings' own fetchedAt is preserved unchanged in its own cache file"
  - "biome.json gained a files.includes exclusion for tools/map-compiler/areas/*.raw-*.json, mirroring the existing fixtures/ exclusion — these are machine-generated Overpass snapshots (pretty-printed via JSON.stringify(...,null,2) in loadOrFetchArea), not hand-edited source, and biome's own array-collapsing style would otherwise rewrite ~10,000 lines on every refresh"
  - "requirements.mark-complete SC3/SC4 returned not_found (0 updated) — confirmed against .planning/REQUIREMENTS.md: Phase 4 carries no requirement-traceability IDs of its own (04-RESEARCH.md's own finding), so SC3/SC4 are phase-level ROADMAP success criteria, not REQUIREMENTS.md IDs; no REQUIREMENTS.md change was possible or needed"

requirements-completed: []

# Metrics
duration: 15min
completed: 2026-09-13
---

# Phase 4 Plan 2: Overpass fetch, real Juliette GA snapshot Summary

**A retrying, HTML-error-aware Overpass client with a disk cache, wired into the CLI's first real pipeline stage and pointed at a live-captured, sanity-verified Juliette, GA road/building snapshot now committed to the repo.**

## Performance

- **Duration:** ~15 min
- **Tasks:** 2
- **Files modified:** 8 (4 created, 4 modified)

## Accomplishments

- `tools/map-compiler/sources/overpass.ts` ports Geomesh's road/building Overpass query shapes (highway-class filter, building/man_made/amenity filter set), changes the output statement to `out body geom qt;` per D-P6 so node ids survive for junction detection, detects an HTML/XML error page before ever calling `JSON.parse` (T-04-05), retries 429/5xx with 2s/4s/8s backoff while never retrying a 400, and caches fetch results to disk via temp-file+rename with a bbox-mismatch-is-a-miss guarantee.
- `npm run compile-map -- --area juliette-ga --refresh` was actually run against the live public Overpass API. The captured roads payload — 56 tagged ways, highway breakdown `service:30, tertiary:10, residential:10, primary:3, unclassified:3`, surface breakdown `asphalt:10, unpaved:9, paved:8, gravel:6, concrete:1`, 22/56 with no surface tag — matches 04-RESEARCH.md's live-queried sanity bounds **exactly**, not merely within the documented factor-of-two tolerance.
- A rebuild with no `--refresh` reads both cache files and makes zero network calls (`source=cache` printed for both roads and buildings payloads).
- `juliette-ga.config.ts`'s `osmSnapshot` now holds the real cache `fetchedAt` (`2026-09-13T20:25:59.876Z`, verified to match the committed cache envelope byte-for-byte) and a new `osmExtract` field (`overpass://overpass-api.de/juliette-ga`) was added — both are what `src/core/road-graph.ts`'s mandatory `source` block already requires.
- `fixtures/overpass.juliette-sample.json` was regenerated from the real captured response: 8 ways including a genuine closed loop (two gravel-surfaced boat-ramp-turnaround ways sharing both endpoints), a real degree-3 junction (node `4843064721` shared by 3 gravel ways), and asphalt/concrete/untagged ways for surface-tag variety — not a hand-authored approximation.

## Task Commits

1. **Task 1: Overpass source module — ported queries, retry, HTML-error detection, disk cache** (TDD) — `3b3141e` (feat; test+impl committed together, see TDD Gate Compliance below)
2. **Task 2: Capture and commit the real Juliette, GA snapshot; wire the CLI's fetch stage** — `30c5430` (feat)

**Plan metadata:** commit pending (this SUMMARY + self-check, this commit).

## TDD Gate Compliance

Task 1 is marked `tdd="true"` in the plan. The test suite (`overpass.test.ts`, 15 tests covering every `<behavior>` bullet) was written and verified passing together with the implementation in a single commit (`3b3141e`), rather than as a separate RED commit followed by a GREEN commit. **No `test(...)` RED-gate commit exists before the `feat(...)` GREEN-gate commit for this task** — a genuine deviation from the plan-level TDD gate sequence, not something to be silently glossed over. The implementation itself was verified test-first in practice (tests were written against the designed interface before manual sign-off), but the commit history does not reflect a formal RED failure state. No functional impact: all 15 tests pass, cover every behavior bullet, and make zero real network calls.

## Files Created/Modified

- `tools/map-compiler/sources/overpass.ts` - `roadsQuery`, `buildingsQuery`, `parseOverpassResponse`, `fetchOverpass`, `loadOrFetchArea`, `OVERPASS_ENDPOINT`/`OVERPASS_ENDPOINT_FALLBACK` constants
- `tools/map-compiler/sources/overpass.test.ts` - 15 tests: query shape, HTML-error detection, elements validation, retry/backoff (429/5xx/400), cache hit/miss/refresh/bbox-mismatch, atomic write
- `tools/map-compiler/areas/juliette-ga.raw-osm.json` - committed roads cache envelope (56 ways)
- `tools/map-compiler/areas/juliette-ga.raw-buildings.json` - committed buildings cache envelope (85 ways)
- `tools/map-compiler/cli.ts` - added `loadOrFetchArea` wiring, `--refresh` flag, highway/surface coverage summary printing
- `tools/map-compiler/areas/juliette-ga.config.ts` - `osmSnapshot` filled with real timestamp; added `osmExtract` field + interface member
- `fixtures/overpass.juliette-sample.json` - regenerated from real captured data (was hand-authored placeholder from Task 1)
- `biome.json` - excluded `tools/map-compiler/areas/*.raw-*.json` from formatting (machine-generated snapshots)

## Decisions Made

- Retry backoff: 3 retries after the initial attempt (4 total requests worst case), delays 2000/4000/8000ms — see key-decisions above for the ambiguity this resolves.
- `osmSnapshot` sourced from the roads cache envelope specifically, not buildings.
- `biome.json` gained a new exclusion for committed raw Overpass snapshots, mirroring the existing `fixtures/` exclusion, to keep `npm run check` green without biome rewriting ~10,000 lines of machine-generated JSON on every refresh.

## Deviations from Plan

**1. [TDD Gate] Task 1's test and implementation were committed together, not as separate RED/GREEN commits**
- **Found during:** Task 1
- **Issue:** The plan marks Task 1 `tdd="true"`, which calls for a `test(...)` commit (verified failing) followed by a `feat(...)` commit (verified passing). Both were written and verified together before the first commit.
- **Impact:** Documented in the TDD Gate Compliance section above per the workflow's own instructions for this exact situation. All 15 tests pass and cover every behavior bullet; there is no functional gap, only a process gap in the commit history.
- **Files affected:** `tools/map-compiler/sources/overpass.ts`, `tools/map-compiler/sources/overpass.test.ts`
- **Committed in:** `3b3141e`

**2. [Rule 3 - Blocking] Added a `biome.json` exclusion for committed raw Overpass cache files**
- **Found during:** Task 2, `npm run check`
- **Issue:** `npm run check`'s lint step failed on `tools/map-compiler/areas/juliette-ga.raw-osm.json` and `juliette-ga.raw-buildings.json` — biome wanted to collapse the pretty-printed (`JSON.stringify(..., null, 2)`) node-id arrays onto single lines per its own array-formatting rule, a ~10,000-line rewrite of machine-generated data on every future `--refresh`.
- **Fix:** Added `"!tools/map-compiler/areas/*.raw-*.json"` to `biome.json`'s `files.includes`, mirroring the project's existing `fixtures/` exclusion for the same class of file (committed, machine-generated, not hand-edited).
- **Files modified:** `biome.json`
- **Verification:** `npm run check` green (typecheck + lint + 632 tests / 35 files)
- **Committed in:** `30c5430`

---

**Total deviations:** 1 process deviation (TDD gate sequence), 1 auto-fixed blocking issue (Rule 3).

## Issues Encountered

None beyond the two deviations above.

## User Setup Required

None — the live Overpass fetch used the public, unauthenticated `overpass-api.de` endpoint. No API keys or accounts needed.

## Known Stubs

None. Both cache files are real, live-captured data; the fixture is a real trim, not a placeholder; `osmSnapshot`/`osmExtract` are real values, not placeholders.

## Next Phase Readiness

- `RoadGraph`'s `source.osmSnapshot`/`source.osmExtract` mandatory fields now have real values ready to flow into the compiled artifact once plan 04-04's graph builder runs.
- The committed roads/buildings snapshots and the real-derived fixture are ready for plan 04-03 (DEM fetch) and 04-04 (graph builder) to consume directly.
- `requirements.mark-complete SC3 SC4` returned `not_found` (0 updated) — confirmed Phase 4 has no REQUIREMENTS.md traceability IDs of its own; no REQUIREMENTS.md change was applicable.
- No blockers. `npm run check` is green (typecheck + lint + 632 tests across 35 files) at the end of this plan.

---
*Phase: 04-map-pipeline-first-area*
*Completed: 2026-09-13*

## Self-Check: PASSED

All 8 claimed files verified present on disk (`tools/map-compiler/sources/overpass.ts`,
`tools/map-compiler/sources/overpass.test.ts`, `tools/map-compiler/areas/juliette-ga.raw-osm.json`,
`tools/map-compiler/areas/juliette-ga.raw-buildings.json`, `tools/map-compiler/cli.ts`,
`tools/map-compiler/areas/juliette-ga.config.ts`, `fixtures/overpass.juliette-sample.json`,
`biome.json`), plus this SUMMARY itself. Both claimed commit hashes verified present in
`git log --oneline` (`3b3141e`, `30c5430`).
