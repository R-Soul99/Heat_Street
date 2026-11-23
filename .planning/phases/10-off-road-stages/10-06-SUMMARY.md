---
phase: 10-off-road-stages
plan: 06
subsystem: terrain-editor-dev-api
tags: [vite-plugin, stages, routes, validation]
requires: [10-01, 10-03]
provides:
  - resolveRouteFile(root, id, "stages" | "routes")
  - GET/PUT /__terrain/stages/<id> and /__terrain/routes/<id>
  - validateStagesPut, validateRoutesPut, isValidationMessage
affects: [10-09, 10-10, 10-12]
key-files:
  created: [tools/terrain-editor/paths.test.ts, tools/terrain-editor/stages-api.test.ts]
  modified: [tools/terrain-editor/paths.ts, tools/terrain-editor/vite-plugin.ts]
decisions:
  - No medals endpoint and no DELETE verb (empty lists are saved as valid files).
metrics:
  tasks: 2
  files: 4
completed: 2026-11-23
---

# Phase 10 Plan 06: Stages and routes dev API Summary

Dev-server GET/PUT endpoints for `<id>.stages.json` and `<id>.routes.json`, gated by `parseStageData` (against the grid extent) and `parseCourseData` (against the road graph), with an areaId-equals-URL-id check and atomic writes.

## Commits
- d766f6a: resolveRouteFile path resolver (Task 1)
- 8233984: stages/routes endpoints and validators (Task 2)

## Notes
- The routing branch sits before the generic `id/kind` split; unknown area (missing bin/sidecar) returns 404, bad ids 400, parser failures 400 via `isValidationMessage`, oversize 413 via the existing handling. Error bodies still pass through `safeMessage`.
- The plugin change needs the running Vite dev server restarted by the user to take effect.
- No HTTP-level test: validators and classification are unit-tested without a server, as planned.

## Deviations from Plan
None. (A stray missing-space typo from my own edit in paths.ts was fixed before the first commit.)

## Verification
- `npx vitest run tools/terrain-editor/paths.test.ts tools/terrain-editor/stages-api.test.ts`: 10 pass
- `npx tsc --noEmit`: clean; biome clean on touched files
- `npm run check`: only the known pre-existing `tests/demo-hills.test.ts` max-slope failure

## Self-Check: PASSED
