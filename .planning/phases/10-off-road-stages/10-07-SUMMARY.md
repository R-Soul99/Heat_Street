---
phase: 10-off-road-stages
plan: 07
subsystem: terrain-editor
tags: [stages, routes, undo, pure-ops]
requires: [10-01, 10-03]
provides:
  - pure stage-draft ops (stages.ts)
  - pure road-route ops (route-ops.ts)
  - StrokeDiff stages/routes parts and dispatcher commitStages/commitRoutes
affects: [10-09, 10-10, 10-12]
key-files:
  created:
    - tools/terrain-editor/stages.ts
    - tools/terrain-editor/stages.test.ts
    - tools/terrain-editor/route-ops.ts
    - tools/terrain-editor/route-ops.test.ts
  modified:
    - src/core/terrain-brush.ts
    - src/core/terrain-undo.ts
    - tests/terrain-undo.test.ts
    - tools/terrain-editor/tool-dispatch.ts
    - tools/terrain-editor/tool-dispatch.test.ts
decisions:
  - "Stages/routes ride the shared 50-deep undo stack as whole-array snapshots, never in the terrain sidecar (tested)"
  - "Route checkpoint cap of 40 counts the finish"
metrics:
  tasks: 3
  completed: 2026-11-23
---

# Phase 10 Plan 07: Editor stage/route model Summary

Pure, capped, non-mutating stage and road-route editing ops plus stages/routes parts on the shared undo diff (one undo step per edit).

## Commits
- 9b8d5f3 feat(10-07): pure stage-draft operations
- 8e86dd8 feat(10-07): pure road-route draft operations
- c6a9ec4 feat(10-07): stages and routes undo diff parts and dispatcher commits

## Deviations from Plan
None. Beyond the plan, mergeDiffs in tool-dispatch.ts also merges the stages/routes parts so stroke merging stays lossless.

## Verification
All new tests, tsc and layering pass. Full `npm run check`: 224 files pass; the only failure is the known pre-existing `tests/demo-hills.test.ts` max-slope test.

## Self-Check: PASSED
