---
phase: 10-off-road-stages
plan: 03
subsystem: core
tags: [courses, routes, route-draft, navigation, medals]
requires: []
provides:
  - "parseCourseData accepting 0..20 routes, relaxed counts/laps, optional start x/z"
  - "serializeCourseData"
  - "RouteDraft shape and nearest node/edge derivation (src/core/route-draft.ts)"
  - "empty-graph-safe nearestRoadNode; validateCourseRoutes authored option; parseMedalReference allowMissing"
affects: [10-07, 10-11, 10-12]
key-files:
  created: [src/core/route-draft.ts, tests/route-draft.test.ts]
  modified: [src/core/course.ts, src/core/navigation.ts, src/core/medal-reference.ts, tests/course-data.test.ts, tests/navigation.test.ts, tests/route-validation.test.ts, tests/medal-reference.test.ts]
decisions:
  - "Limits: 20 courses, p2p 2..40 / circuit 3..40 checkpoints, laps 1..20"
  - "Authored validation keeps only the directed-path check; defect list only for juliette-ga"
metrics:
  tasks: 3
  completed: 2026-11-23
---

# Phase 10 Plan 03: Authored road routes core Summary

Core support for hand-authored road routes: relaxed course parsing (0..20 routes, optional start x/z, serializer), a pure RouteDraft converter that binds hand-placed checkpoints to the nearest road node and touching edge, an empty-graph-safe `nearestRoadNode` (returns -1), soft validation for authored routes, and partial medal references.

## Tasks

1. Relax parseCourseData, add start x/z and serializeCourseData (c50152f)
2. RouteDraft with nearest node/edge derivation (04aeba6)
3. Empty-graph nearestRoadNode, authored validation, allowMissing medals (8fdacab)
4. Typecheck fix for route-draft test (follow-up commit)

## Deviations from Plan

- [Rule 1] Test fixture in route-draft.test.ts initially lacked `finish.id`; fixed after typecheck caught it.
- Route-draft errors for an over-40-checkpoint route and an isolated node were added as extra guards.

## Known Stubs

None.

## Verification

`npm run check`: typecheck and lint pass; 2919 tests pass, only the known pre-existing failure `tests/demo-hills.test.ts` "respects the max slope over the whole grid (D-03)" remains.

## Self-Check: PASSED
