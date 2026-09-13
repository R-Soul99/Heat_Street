---
phase: 04-map-pipeline-first-area
plan: 05
subsystem: infra
tags: [typescript, node-esm, geotiff, usgs-3dep, elevation, dem, road-graph, tools-tier]

# Dependency graph
requires:
  - phase: 04-map-pipeline-first-area
    plan: 04
    provides: "committed public/maps/juliette-ga.map.json (flat y=0), graph/project.ts's makeProjector, buildGraph/RoadGraph shapes"
provides:
  - "tools/map-compiler/sources/dem.ts — demRequestUrl, fetchDemRaster, loadOrFetchDem (cached, atomic), parseDemRaster (NoData-substituted), makeElevationSampler (pure bilinear lat/lon sampler)"
  - "tools/map-compiler/graph/elevation.ts — applyElevation(graph, sampler, projector): node-authoritative elevation with endpoint-clamped, arc-length-aware smoothing"
  - "tools/map-compiler/areas/juliette-ga.dem.tif — committed real USGS 3DEP raster (487x512, ~1.1MB, elevation 106.25-158.73m)"
  - "public/maps/juliette-ga.map.json — recompiled with real terrain (relief 38.82m, compilerVersion 0.2.0)"
affects: [04-06, 04-07, 04-08, 04-09, 04-10]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Arc-length-based (not point-count-based) windowed moving average for centreline smoothing — converts a point-count window into an equivalent metre radius using each edge's own mean point spacing, so it behaves identically to a point-count window on evenly-spaced points but degrades gracefully on OSM's routinely uneven vertex density"
    - "Node y is sampled once and shared by every touching edge (nodeYById map) — junction continuity by construction, never by agreement between independent smoothing passes"
    - "Endpoint clamp is applied AFTER smoothing, never before"
    - "cli.ts derives its elevation-stage projector from the already-built graph's own recorded origin (graph.origin.lat/lon), not by recomputing bbox-centre independently — guarantees identical projector to the one buildGraph used internally"
    - "ArcGIS ImageServer exportImage requires an explicit imageSR parameter matching bboxSR — omitting it silently returns Web Mercator georeferencing instead of the requested WGS84, a corrupted-not-cosmetic bug caught by executing the real request"

key-files:
  created:
    - tools/map-compiler/sources/dem.ts
    - tools/map-compiler/sources/dem.test.ts
    - tools/map-compiler/graph/elevation.ts
    - tools/map-compiler/graph/elevation.test.ts
    - tools/map-compiler/areas/juliette-ga.dem.tif
  modified:
    - tools/map-compiler/cli.ts
    - tools/map-compiler/areas/juliette-ga.config.ts
    - tools/map-compiler/graph/build-graph.ts
    - public/maps/juliette-ga.map.json
    - tests/compiled-map.test.ts

key-decisions:
  - "imageSR=4326 added to the exportImage request (Rule 1 fix) — omitting it makes the live ArcGIS ImageServer return Web Mercator (EPSG:3857) georeferencing, verified empirically, which would silently corrupt every downstream lat/lon<->pixel calculation"
  - "Smoothing window converted from a plain point-count moving average to an arc-length-based one (Rule 1 fix) — real OSM geometry's uneven vertex spacing made the point-count version produce a 0.566 gradient on the real artifact, violating this plan's own 0.5 hard ceiling; the arc-length version reproduces identical behaviour on evenly-spaced (synthetic test) data while fixing the real-data artifact"
  - "demSizePx recorded per-area in AreaConfig (512 for Juliette) rather than only as sources/dem.ts's DEM_MAX_SIZE_PX default — a later, larger area can raise it deliberately"
  - "cli.ts self-checks the post-elevation graph through parseRoadGraph before writing, mirroring buildGraph's own existing discipline — the compiler must never emit an artifact its own runtime parser would reject"
  - "COMPILER_VERSION bumped 0.1.0 -> 0.2.0 — emitted geometry (y, lengthM) has changed"

requirements-completed: [SC1, SC3, SC4]

# Metrics
duration: 25min
completed: 2026-09-13
---

# Phase 4 Plan 5: USGS 3DEP Elevation Summary

**The compiled Juliette, GA area has real, DEM-sampled, junction-continuous terrain (38.82m of relief) instead of a flat plane, fetched live from USGS 3DEP with a corrected imageSR parameter and an arc-length-aware smoothing pass that survives real OSM geometry's uneven vertex spacing.**

## Performance

- **Duration:** ~25 min
- **Started:** 2026-09-13T22:40:00+01:00 (approx, first read/npm install)
- **Completed:** 2026-09-13T23:05:29+01:00
- **Tasks:** 3
- **Files modified:** 10 (5 created, 5 modified)

## Accomplishments

- `tools/map-compiler/sources/dem.ts`: builds the USGS 3DEP `exportImage` request, fetches raw TIFF bytes with a leading-byte magic sniff (never reaching the GeoTIFF parser on an error payload), caches to `<areaId>.dem.tif` with atomic writes, parses via `geotiff` with NoData sentinel substitution (nearest-valid-neighbour outward ring search, counted), and exposes a pure, edge-clamped bilinear lat/lon sampler. `DEM_MAX_SIZE_PX=512` resolves to ~5.6 m/pixel for this area.
- `tools/map-compiler/graph/elevation.ts`: `applyElevation` samples every node once (authoritative, never smoothed — junction continuity by construction), smooths each edge's interior centreline with an arc-length-based moving average, clamps both endpoints to node height AFTER smoothing, and recomputes `lengthM` as a real 3D length. Reports per-edge max gradient, over-threshold edges, and min/max/relief.
- `tools/map-compiler/cli.ts` wires the DEM stage between `buildGraph` and the artifact write, self-checks the elevated graph through `parseRoadGraph`, and prints a full elevation report.
- Real fetch against the live USGS 3DEP ImageServer (Task 1): raster bbox contains the configured area on all four sides, elevation range 106.25-158.73m, 0 NoData substitutions. Committed `tools/map-compiler/areas/juliette-ga.dem.tif` (1.1 MB).
- Real recompile (Task 3): `public/maps/juliette-ga.map.json` now has 50 nodes with real elevation, min=110.10m, max=148.92m, relief=38.82m (comfortably over the 10m floor, close to 04-RESEARCH.md's ~33m estimate), one edge over the 0.35 report threshold at 0.351 (under the 0.5 hard ceiling). Two consecutive compiles are byte-identical (sha256 verified).
- 24 new tests (13 `dem.test.ts` + 11 `elevation.test.ts`) plus 5 new assertions in `tests/compiled-map.test.ts` against the real committed artifact. `npm run check` green: typecheck + lint + 731 tests across 41 files.

## Task Commits

1. **Task 1: USGS 3DEP raster fetch, GeoTIFF parse and bilinear sampler** — `b957c94` (feat)
2. **Task 2: Node-authoritative elevation with endpoint-clamped centreline smoothing** — `c9a1d12` (feat)
3. **Task 3: Wire elevation into the CLI and recompile the real area with terrain** — `9c36678` (feat)

**Plan metadata:** commit pending (this SUMMARY + self-check, next commit).

## Files Created/Modified

- `tools/map-compiler/sources/dem.ts` - `demRequestUrl`, `fetchDemRaster`, `loadOrFetchDem`, `parseDemRaster`, `makeElevationSampler`, `computeDemSizePx`, `DEM_MAX_SIZE_PX`
- `tools/map-compiler/sources/dem.test.ts` - 13 tests, zero real network calls (synthetic ramp raster via `geotiff`'s own `writeArrayBuffer`)
- `tools/map-compiler/graph/elevation.ts` - `applyElevation`, `SMOOTHING_WINDOW`, `GRADIENT_WARNING_THRESHOLD`, arc-length-based smoothing
- `tools/map-compiler/graph/elevation.test.ts` - 11 tests against synthetic samplers (sawtooth, ramp, bump, noisy 4-way junction)
- `tools/map-compiler/areas/juliette-ga.dem.tif` - real committed USGS 3DEP raster (487x512, ~1.1MB)
- `tools/map-compiler/cli.ts` - DEM stage wired between `buildGraph` and the write; elevation report printing
- `tools/map-compiler/areas/juliette-ga.config.ts` - added `demSizePx: 512`
- `tools/map-compiler/graph/build-graph.ts` - `COMPILER_VERSION` 0.1.0 -> 0.2.0
- `public/maps/juliette-ga.map.json` - recompiled with real terrain
- `tests/compiled-map.test.ts` - 5 new elevation assertions against the real artifact

## Decisions Made

- `imageSR=4326` added to the `exportImage` request — see Deviations below.
- Arc-length-based smoothing window — see Deviations below.
- `demSizePx` lives per-area in `AreaConfig` rather than only as a compiler-wide default.
- `cli.ts` self-checks the final graph through `parseRoadGraph` before writing, matching `buildGraph`'s own existing discipline.
- `COMPILER_VERSION` bumped since emitted geometry changed.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Added `imageSR=4326` to the USGS 3DEP `exportImage` request**
- **Found during:** Task 1, first real fetch against the live service
- **Issue:** 04-RESEARCH.md's documented `exportImage` URL shape (explicitly flagged MEDIUM confidence, never executed) omits `imageSR`. Fetching against the live service with only `bboxSR=4326` returned the raster georeferenced in Web Mercator (EPSG:3857) — `getBoundingBox()` came back as `[-9331274.18, 3908093.16, -9327987.55, 3911548.52]` (metres, not degrees), which would have silently corrupted every lat/lon<->pixel calculation in `makeElevationSampler`.
- **Fix:** Added `&imageSR=4326` to `demRequestUrl`, forcing the returned raster's spatial reference to match the requested `bboxSR`. Re-fetched: bbox now `[-83.8242, 33.0938, -83.7948, 33.1248]`, containing the configured bbox on all four sides.
- **Files modified:** `tools/map-compiler/sources/dem.ts`, `tools/map-compiler/sources/dem.test.ts` (added an `imageSR=4326` URL assertion)
- **Verification:** Real fetch confirmed correct WGS84 bbox; all 13 `dem.test.ts` tests pass
- **Committed in:** `b957c94` (Task 1 commit)

**2. [Rule 1 - Bug] Converted centreline smoothing from a point-count to an arc-length-based moving average**
- **Found during:** Task 3, first real recompile
- **Issue:** `elevation.ts`'s original `movingAverage` averaged over a fixed point-COUNT window (5 points, shrinking near edge ends). Real OSM way geometry routinely mixes densely- and sparsely-spaced vertices within one edge — the real compiled artifact's edge id=36 (osmWayId=446581088) had three vertices ~7m apart near a junction, immediately followed by vertices 50-150m apart. The point-count window pulled the far-away, much-higher points into the average for a point only 7.5m from its neighbour, producing a smoothed-Y gradient of 0.566 — steeper than any real road and above this plan's own 0.5 hard ceiling.
- **Fix:** Replaced the point-count window with `arcLengthMovingAverage`, which averages every point within a metre-radius of a given point's own cumulative arc-length position. The radius is derived per-edge as `halfWindow * (edge's own mean point spacing)`, so it reproduces the original algorithm exactly on evenly-spaced points (every synthetic test in `elevation.test.ts` uses evenly-spaced points and all 11 still pass unchanged) while degrading gracefully on uneven real-world spacing.
- **Files modified:** `tools/map-compiler/graph/elevation.ts`
- **Verification:** Edge 36's gradient dropped to 0.351 (under 0.5); `elevation.test.ts` 11/11 still pass; `tests/compiled-map.test.ts`'s new "no edge exceeds 0.5" assertion passes against the real artifact; two consecutive real compiles are byte-identical
- **Committed in:** `9c36678` (Task 3 commit, alongside the recompiled artifact and its test)

---

**Total deviations:** 2 auto-fixed (both Rule 1 — correctness bugs found only by executing the real pipeline against real data, exactly as 04-RESEARCH.md's own MEDIUM-confidence flags anticipated).
**Impact on plan:** Both fixes are required for correctness (georeferencing integrity and the plan's own 0.5 gradient ceiling). No scope creep — `SMOOTHING_WINDOW` stays 5 (point count) as the plan specifies; only its internal application changed.

## Issues Encountered

None beyond the two deviations above, both caught and fixed within the same session before committing.

## User Setup Required

None — no external service configuration required. The USGS 3DEP ImageServer needs no API key or authentication.

## Known Stubs

None. Every artifact in this plan (the cached `.tif`, the recompiled `.map.json`) is real, live-fetched/derived data — no placeholders.

## Next Phase Readiness

- `public/maps/juliette-ga.map.json` now carries real, smoothed, junction-continuous elevation on every node and edge point — ready for plan 04-06+'s geometry/collision authoring, which can now build ribbons and colliders against real Y values instead of a flat plane.
- `tools/map-compiler/sources/dem.ts` and `tools/map-compiler/graph/elevation.ts` are both cleanly separable stages any later plan can call directly (e.g. a re-run against a different/larger area).
- `SMOOTHING_WINDOW=5` remains `[ASSUMED]` and is explicitly deferred to plan 04-10's feel-tuning session, per the plan's own instruction — not retuned here beyond the arc-length correctness fix.
- No blockers. `npm run check` is green (typecheck + lint + 731 tests across 41 files).

---
*Phase: 04-map-pipeline-first-area*
*Completed: 2026-09-13*

## Self-Check: PASSED

All 7 claimed files verified present on disk (`tools/map-compiler/sources/dem.ts`,
`tools/map-compiler/sources/dem.test.ts`, `tools/map-compiler/graph/elevation.ts`,
`tools/map-compiler/graph/elevation.test.ts`, `tools/map-compiler/areas/juliette-ga.dem.tif`,
`public/maps/juliette-ga.map.json`, this SUMMARY itself). All 4 claimed commit hashes verified
present in `git log --oneline --all` (`b957c94`, `c9a1d12`, `9c36678`, `3b62242`).
