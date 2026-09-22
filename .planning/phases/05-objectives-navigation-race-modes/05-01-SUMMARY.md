---
phase: 05-objectives-navigation-race-modes
plan: 01
subsystem: navigation
tags: [typescript, ngraph, route-data, vitest]

# Dependency graph
requires:
  - phase: 04.1-flatten-terrain-remove-dem-elevation-drop-real-world-dem-der
    provides: validated Juliette road graph and known defect coordinates
provides:
  - strict hand-authored course data parser
  - directed weighted road navigation adapter
  - validated Juliette P2P and Circuit route sidecar
affects: [race-state, navigation-hud, medals, ai]

# Tech tracking
tech-stack:
  added: []
  patterns: [field-by-field untrusted route parsing, oriented weighted ngraph A*, pure route validation]

key-files:
  created:
    - src/core/course.ts
    - src/core/navigation.ts
    - public/maps/juliette-ga.routes.json
    - tests/course-data.test.ts
    - tests/navigation.test.ts
    - tests/route-validation.test.ts
  modified: []

key-decisions:
  - "Use a JSON sibling sidecar with exactly one P2P course and one three-lap Circuit course."
  - "Normalize ngraph.path results to source-to-target node IDs and enable oriented traversal for one-way roads."
  - "Use a 40m checkpoint clearance margin from the Phase 04.1 defect coordinates."

patterns-established:
  - "Course parsing copies named fields only and rejects malformed or unbounded route input with source-labelled errors."
  - "Navigation links carry edge IDs and length weights, allowing downstream guidance and surface validation to reuse the road graph."

requirements-completed: [NAV-04, NAV-05, P2P-01, CIRC-01]

# Metrics
duration: 18 min
completed: 2026-09-21
---

# Phase 5 Plan 1 Summary

**Strict Juliette course contracts, directed one-way-aware road paths, and two validated mixed-surface race routes**

## Performance

- **Duration:** approximately 18 minutes
- **Started:** 2026-09-21T20:32:00Z
- **Completed:** 2026-09-21T20:36:00Z
- **Tasks:** 3 completed
- **Files modified:** 6

## Accomplishments

- Added a strict `parseCourseData` contract with finite coordinate, count, mode, lap, sensor, ID, and graph-reference validation.
- Added directed weighted navigation using `ngraph.graph` and oriented `ngraph.path` A* queries, plus nearest-node and route-safety helpers.
- Authored one seven-checkpoint P2P course and one five-checkpoint, three-lap Circuit course using real Juliette graph locations, including the west dirt-road branch and defect-clearance checks.

## Task Commits

Each task was executed through the TDD flow. The implementation and route authoring were committed together as one vertical slice because the real-artifact validation depends on both modules and the sidecar.

1. **Task 1: Define and parse the hand-authored course contract** - `673680c` (test RED), `2ae563b` (feat GREEN)
2. **Task 2: Build directed road navigation and route validation** - `2ae563b` (feat GREEN)
3. **Task 3: Author the two Juliette courses against the compiled graph** - `2ae563b` (feat GREEN)

## Files Created/Modified

- `src/core/course.ts` - Pure strict parser and immutable course/checkpoint contracts.
- `src/core/navigation.ts` - Directed ngraph construction, oriented A* path queries, nearest-node lookup, and route validation.
- `public/maps/juliette-ga.routes.json` - The two hand-authored Juliette courses.
- `tests/course-data.test.ts` - Valid, malformed, bounds, and prototype-safety parser coverage.
- `tests/navigation.test.ts` - One-way and weighted-road path coverage.
- `tests/route-validation.test.ts` - Real compiled-map route reachability, mixed-surface, and defect-clearance coverage.

## Decisions Made

- Kept route data in a sibling JSON artifact so the normative road-graph schema remains unchanged.
- Used a 40m minimum clearance from the eight recorded Phase 04.1 defect coordinate groups.
- Used 20m checkpoint sensor widths and heights of 10m so authored volumes exceed local road widths and catch airborne vehicles.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Normalized ngraph A* direction and result order**
- **Found during:** Task 2 focused tests
- **Issue:** The installed ngraph API defaults to non-oriented traversal, and returns paths target-first.
- **Fix:** Enabled `oriented: true` and reversed the returned node IDs to expose source-to-target paths.
- **Files modified:** `src/core/navigation.ts`
- **Verification:** One-way navigation tests and real route validation pass.
- **Committed in:** `2ae563b`

**2. [Rule 1 - Bug] Corrected route XZ distance calculation**
- **Found during:** Task 2 real-artifact validation
- **Issue:** The initial helper read the Y component when comparing a checkpoint to a road point.
- **Fix:** Compute XZ distance explicitly for road polyline points.
- **Files modified:** `src/core/navigation.ts`
- **Verification:** Real Juliette route validation passes with zero failures.
- **Committed in:** `2ae563b`

**3. [Rule 3 - Blocking] Fixed strict typecheck errors**
- **Found during:** Plan-level typecheck
- **Issue:** Defect coordinates were typed as 3D and a test mutator had an implicit return type.
- **Fix:** Corrected the tuple type and annotated the mutator return type.
- **Files modified:** `src/core/navigation.ts`, `tests/course-data.test.ts`
- **Verification:** `npm run typecheck` passes.
- **Committed in:** `2ae563b`

**Total deviations:** 3 auto-fixed (2 bugs, 1 blocking type issue)
**Impact on plan:** All fixes were local correctness repairs; the plan's scope and public contracts remain unchanged.

## Issues Encountered

- The scoped Biome check passes and all focused tests/typechecks pass.
- Repository-wide `npm run lint` remains red on pre-existing unrelated files: an unused `TEST_PROJECTOR` in `tools/map-compiler/author/gltf.test.ts` and formatting in two `vehicleTuning/*.json` snapshots. Those files were not modified.
- No package installation, external service setup, or user action is required.

## Known Stubs

None found in the files created or modified by this plan.

## Next Phase Readiness

The next race-state and HUD plans can load `public/maps/juliette-ga.routes.json` through `parseCourseData`, select ordered or unordered targets from the course mode, and request legal road paths with edge IDs and weights. No blockers remain for this plan.

## Self-Check: PASSED

- `src/core/course.ts` exists.
- `src/core/navigation.ts` exists.
- `public/maps/juliette-ga.routes.json` exists.
- `673680c` and `2ae563b` exist in git history.
- Focused tests: 3 files, 12 tests passed.
- `npm run typecheck` passed.
- Scoped Biome check passed.

---
*Phase: 05-objectives-navigation-race-modes*
*Completed: 2026-09-21*
