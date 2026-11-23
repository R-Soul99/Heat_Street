---
phase: 10-off-road-stages
plan: 08
subsystem: game-composition
tags: [stages, main, url-params, fallback]
requires: [10-04, 10-05]
provides:
  - parseStageRequest / selectStage (pure, src/core/stage-mode.ts)
  - stage-mode composition in src/main.ts
affects: [10-09, 10-10, 10-12]
key-files:
  created:
    - src/core/stage-mode.ts
    - tests/stage-mode.test.ts
  modified:
    - src/main.ts
decisions:
  - "Malformed stages file throws (D-P27); missing file, legacy map, area mismatch or empty list falls back to free drive with console.warn (D-08)"
  - "Stage start beats ?at= and ?start= as spawn override"
  - "Routes and medals files are never fetched in stage mode"
  - "PB saved for every vehicle class (D-07); medals shown only when stage medals.vehicle equals the selected class (D-06); ace maps to gold when stored"
  - "Legacy-map free drive uses heightAt = current body y so respawn stands the car up in place"
metrics:
  tasks: 2
  completed: 2026-11-23
---

# Phase 10 Plan 08: Stage mode composition Summary

`?map=<terrain id>&mode=stage[&stage=<id>]` now runs a stage end to end: spawn at the stage start, gate view, arrow, minimap, HUD info with PB, split flashes, results panel and per-class personal-best save, with warned free-drive fallbacks.

## Tasks

| Task | Commit | Notes |
| ---- | ------ | ----- |
| 1. Pure request parsing and selection | 0d89482 | `tests/stage-mode.test.ts` covers every behavior bullet |
| 2. Compose stage mode in main.ts | e3ff968 | `stageCoordinator ?? freeDriveCoordinator` in the activeCoordinator chain |

## Verification

- `npx tsc --noEmit` clean; biome clean on touched files.
- `npm run check`: only the known `tests/demo-hills.test.ts` max-slope (D-03) failure.
- No stages file was written or committed under `public/maps`; dev server not started, so the in-browser drive was not exercised here.

## Deviations from Plan

None. Plan executed as written.

## Known Stubs

None.

## Self-Check: PASSED
