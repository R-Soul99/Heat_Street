---
phase: quick-261004-3zw
plan: 01
subsystem: map-compiler
tags: [synthetic-map, grid-test, map-select]
key-files:
  created:
    - tools/map-compiler/synthetic/grid-layout.ts
    - tools/map-compiler/synthetic/grid-layout.test.ts
    - tools/map-compiler/synthetic/generate-grid-test.ts
    - tools/map-compiler/synthetic/author-grid-routes.ts
    - tools/map-compiler/areas/grid-test.config.ts
    - src/core/map-select.ts
    - tests/map-select.test.ts
    - tests/grid-test-routes.test.ts
    - public/maps/grid-test.{map,collision,routes,medals}.json
    - public/maps/grid-test.glb
  modified: [tools/map-compiler/cli.ts, package.json, src/main.ts]
completed: 2026-10-04
---

# Quick 261004-3zw: Synthetic grid-test city

Code-generated test city compiled through the unchanged map pipeline (raw envelopes written as cache files with the config's exact bbox, so the compiler reads `source=cache`), plus an allowlisted `?map=` selector.

## Commits
- 3a16348 layout + envelope builder + tests + config
- 1a3e146 generator, registry line, package script, compiled artifacts
- 9884ef9 routes, medals, map-select, main.ts

## Layout change requested mid-task (coordinator/user)
Layout was changed to 8 block rows (4 north, 4 south of a central motorway):
- Motorway = horizontal street index 4, 24 m wide, highway=motorway, asphalt, full map width, no kerbs/obstacles. Blocks facing it use a 25 m building setback so no buildings sit beside it.
- 720 m wide, 600 m deep; row depths cycle 70/90/60 m. Because depths are uneven the motorway is at z=290 of 600 (roughly, not exactly, central).
- Block lengths cycle base 90 / 1.25x / base/1.5 per row with per-row phase offsets, so columns per row are not a uniform 8 (row length 90 m gives about 8 blocks, 112 m about 6, 60 m about 12). "8x8" is therefore 8 rows by nominally 8 columns.
- Widths: motorway 24, boulevard 14, avenue 10.5, street 7, lane 5, gravel alley 4.5. West perimeter vertical is the gravel alley.
- Result: 89 road ways, 124 buildings, 29 crossroads, 70 T-junctions, 14 doglegs. Validation PASSED.
- Checkpoints are kept off the motorway (simpler; the 18 m sensor-width cap is unchanged, sensors are 20 m). Routes still cross it.

## Deviations
- [Rule 1 - test premise] The plan's "at least one adjacent row pair shares no interior x" is infeasible with a 22 m snap gap (brute-force search of 20k phase sets found none). Replaced by: adjacent rows never identical and staggered T-junctions outnumber crossroads.
- [Rule 3] Node type stripping cannot load `medal-reference.ts` (extensionless imports), so the author script validates routes itself (parseCourseData + validateCourseRoutes) and medal-reference validation lives in `tests/grid-test-routes.test.ts`.
- Compiled attribution still prints the OSM credit (accepted limitation per plan).

## Verification
- generate-grid-test twice: raw files byte-identical.
- compile-map: validation PASSED, inputs from cache.
- vitest: map-select, grid-test-routes, route-validation, course-data, medal-reference, tools/map-compiler (218 tests) all pass; `tsc --noEmit` clean; biome clean on new files; `npm run build` succeeds.
- Manual browser check (?map=grid-test in p2p/circuit/circuit-race, default load): NOT RUN (no browser available to the executor). Needs human verification.

## Self-Check: PASSED
All listed files exist; commits 3a16348, 1a3e146, 9884ef9 present. Unrelated dirty files were not staged.
