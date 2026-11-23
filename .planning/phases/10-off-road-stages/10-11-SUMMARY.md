---
phase: 10-off-road-stages
plan: 11
subsystem: gameplay
tags: [routes, medals, main, race-coordinator]
requires: [10-03, 10-08]
provides:
  - "parseRouteRequest/selectCourse: ?route=<courseId> and ?mode pick any of N routes"
  - "Race coordinator runs without a medal reference (time-only)"
  - "main.ts: optional medals, soft validation on terrain maps, spawn at route start"
affects: [10-12]
key-files:
  created: [src/core/route-select.ts, tests/route-select.test.ts]
  modified: [src/gameplay/race-coordinator.ts, tests/race-coordinator.test.ts, src/main.ts]
key-decisions:
  - "Spawn priority: stage start > route start x/z > resolveStartPose"
  - "Terrain maps: empty routes file = free drive; stale/missing medals = warning + time-only; validation = warning"
requirements-completed: []
duration: ~15min
completed: 2026-11-23
---

# Phase 10 Plan 11: Race any authored route Summary

The game now races any authored road route chosen by `?route=<courseId>` (id validated against the course id pattern), with optional per-route medals and softer validation on terrain maps. MODE-04 is not marked complete; the phase is unfinished.

## Tasks
1. Pure route-select + optional reference in race coordinator (tests first) - 535352b
2. main.ts: selectCourse, `allowMissing`/`authored` on terrain maps, medalCourses, time-only timing, route start spawn - 907d94f

## Deviations
- [Rule 3] Python edit initially corrupted src/main.ts encoding; the file was restored and the edit redone as UTF-8 before committing. No effect on committed content.
- Legacy maps keep strict fetch/parse/throw; the medal parse try/catch rethrows for non-terrain.

## Verification
tsc clean; biome clean; targeted vitest green (50 tests); `npm run check`: only tests/demo-hills.test.ts D-03 max slope fails (known, pre-existing): 3015 passed, 1 failed. Not exercised in a live browser.

## Self-Check: PASSED
