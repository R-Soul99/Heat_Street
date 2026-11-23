---
phase: 10-off-road-stages
plan: 09
subsystem: terrain-editor
tags: [editor, route-tool, stages, place-menu]
requires: [10-05, 10-06, 10-07]
provides:
  - "createRouteTool (Stage kind): markers, Routes panel, gestures, load/save"
  - "Place menu entry 8 (Route) below a divider"
  - "buildStageTestUrl, buildRouteTestUrl"
affects: [10-10, 10-12]
tech-stack:
  added: []
  patterns: ["self-contained editor tool module behind a narrow Deps interface"]
key-files:
  created: [tools/terrain-editor/route-tool.ts]
  modified:
    - tools/terrain-editor/rail-tools.ts
    - tools/terrain-editor/rail-tools.test.ts
    - tools/terrain-editor/drive-url.ts
    - tools/terrain-editor/drive-url.test.ts
    - tools/terrain-editor/editor.ts
    - tools/terrain-editor/toolbar-state.ts
key-decisions:
  - "Menu divider already supported by top-bar ({kind:'divider'}); used it, no shell change"
  - "Unfinished stages draw gates as yellow width lines (stage-view needs a finish); finished stages use real createStageView gates"
  - "Delete dialog uses openDialog directly because confirmDialog hardcodes the dismiss label 'Cancel' and the spec wants 'Keep route'"
requirements-completed: []
duration: ~25min
completed: 2026-11-23
---

# Phase 10 Plan 09: Editor Route tool (Stage kind) Summary

Route tool module for authoring stages (start, gates, finish) with real gate markers, Routes panel, warnings and Test stage, plus Place entry 8 and tested test-drive URL builders. MODE-04 is not marked complete; the phase is unfinished.

## Tasks
1. Place menu entry 8 and URL builders - ebfe0d4
2. Route tool module - 1b7b444

## Deviations from Plan
- [Rule 3 - Blocking] Adding "route" to PlaceKind broke two exhaustive `Record<PlaceKind, string>` maps (PLACE_HINT in editor.ts, PLACE_LABEL in toolbar-state.ts). Added a route entry to each (one line each). editor.ts hosting is still plan 10-10.
- Test button disabled tip reads "Test stage: place a finish first" when the stage is incomplete.
- Road kinds (Point to point, Circuit) are aria-disabled; commitRoutes is declared in deps for plan 10-12.

## Verification
- tsc --noEmit clean; biome clean on touched files; vitest tools/terrain-editor 371 passed.
- `npm run check`: 3002 passed, 1 failed = the known pre-existing `tests/demo-hills.test.ts` max-slope test (only failure).
- Acceptance greps: no innerHTML, no rapier, `__terrain/stages/` x2.

## Known Stubs
None. The module is not yet mounted in editor.ts (plan 10-10), so the tool is unreachable in the running editor until then; not a stub.

## Notes for review
- D-09 layout sketch is the approved 10-UI-SPEC sketch; user reviews the built tool at the plan 10-13 check.
- Interactive behaviour (drag/turn, markers) is untested in a browser; it needs the 10-10 hookup first.

## Self-Check: PASSED
