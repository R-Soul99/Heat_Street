---
phase: 06-medals-time-attack-loop
plan: 05
subsystem: gameplay-ui
tags: [typescript, dom, localstorage, medals, results-view, composition-root]

# Dependency graph
requires:
  - phase: 06-medals-time-attack-loop
    provides: fixed-clock medal timing, validated PB persistence, committed reference splits, and race-coordinator/HUD timing integration
  - phase: 05-objectives-navigation-race-modes
    provides: fixed-tick checkpoint acceptance, retry commands, navigation, and race HUD placement
provides:
  - minimal DOM course-card medal grid (both stable Juliette courses, best time or explicit unearned state, medal, all four thresholds)
  - post-run frozen sector-results table with slowest-sector highlight
  - composition-root wiring: validated medals.json fetch/parse, versioned localStorage progress adapter, course-card/results mounting without duplicate HUD overlays
affects: [phase-07, phase-08, race-loop, hud]

# Tech tracking
tech-stack:
  added: []
  patterns: [textContent-only DOM results surface with no localStorage/classification inside the view, card refresh only on validated PB improvement]

key-files:
  created:
    - src/hud/results-view.ts
    - tests/results-view.test.ts
  modified:
    - src/main.ts
    - src/gameplay/race-coordinator.ts
    - src/hud/race-hud.ts

key-decisions:
  - "Removed a duplicate results overlay from src/hud/race-hud.ts (32 lines) in favor of the single course-card/results surface in results-view.ts, rather than maintaining two independent result renderers."

patterns-established:
  - "Results/course-card DOM surface is pure view-model + textContent rendering; medal-persistence and medal-timing own classification/storage, the view only formats."

requirements-completed: [NAV-02, MEDAL-01, MEDAL-02, MEDAL-03, MEDAL-04]

# Metrics
duration: not tracked (paperwork closed out retroactively; implementation commits landed 2026-09-21T23:18 UTC+1)
completed: 2026-09-22
---

# Phase 6, Plan 5: Course Cards & Composition-Root Results Wiring Summary

**Minimal DOM course-card medal grid plus frozen post-run sector results, wired into main.ts with validated medals.json loading and versioned localStorage progress — closing the replayable time-attack loop for both Juliette courses.**

## Performance

- **Duration:** not precisely tracked — implementation was completed and committed in a prior session; this summary and the human-verify checkpoint were closed out in a follow-up session (2026-09-22).
- **Tasks:** 3 (2 automated implementation tasks + 1 blocking human-verify checkpoint)
- **Files modified:** 5 (2 created, 3 modified)

## Accomplishments
- `src/hud/results-view.ts`: pure view-model/formatting functions (`buildCourseCardModels`, result-row builders, `formatResultTime`) rendering both stable course cards (mode label, best time or explicit "UNAVAILABLE" state, medal, all four Ace/Gold/Silver/Bronze thresholds) and the frozen sector-results table with one slowest-row highlight.
- `src/main.ts`: loads `juliette-ga.medals.json` with the same named-fetch/strict-parse discipline as the map/routes artifacts, cross-checks area/course/mode/checkpoint identity before constructing the live race, reads/writes progress through the validated localStorage adapter, and mounts the course-card/results view without a second overlay.
- Removed a duplicate, now-redundant results overlay from `race-hud.ts`, consolidating all post-run/medal-grid rendering into `results-view.ts`.

## Task Commits

1. **Task 1: Add course cards and result view models** - `aadd5f4` (feat)
2. **Task 2: Wire validated reference/progress/results into the composition root** - `c9868ca` (feat)
3. **Task 3: Human-verify checkpoint** - approved by developer 2026-09-22 (see Issues Encountered below for the one finding during this pass)

_Note: both feat commits were made in the same prior session (2026-09-21T23:18 UTC+1); no separate plan-metadata commit was made until this retroactive close-out._

## Files Created/Modified
- `src/hud/results-view.ts` - course-card and result-row view models, pure formatting, no storage/classification
- `tests/results-view.test.ts` - view-model tests: both modes, threshold formatting, absent-PB/unearned state, medal labels, slowest-sector selection
- `src/main.ts` - validated medals.json loading, localStorage progress wiring, course-card/results mounting at the composition root
- `src/gameplay/race-coordinator.ts` - small integration hook for results/progress wiring (+2 lines)
- `src/hud/race-hud.ts` - removed the duplicate results overlay (-32 lines) now superseded by `results-view.ts`

## Decisions Made
- Consolidated on a single results/course-card renderer (`results-view.ts`) rather than keeping `race-hud.ts`'s pre-existing overlay alongside it — avoids two independent surfaces drifting out of sync on restart.

## Deviations from Plan

The plan's `files_modified` frontmatter listed only `src/main.ts`, `src/hud/results-view.ts`, and `tests/results-view.test.ts`. The actual commits also touched `src/gameplay/race-coordinator.ts` (+2 lines, a small wiring hook) and `src/hud/race-hud.ts` (-32 lines, removing the now-duplicate overlay this plan's task description explicitly called for: "mount the course-card/results view without duplicating DOM overlays on restart"). Both are within the plan's stated intent, not scope creep.

**Total deviations:** 2 additional files touched, both required by the plan's own "no duplicate overlays" requirement.
**Impact on plan:** None — necessary to satisfy the plan's own must-have, not unrelated work.

## Issues Encountered

During the human-verify checkpoint pass, the developer found the minimap's car-heading marker rotating opposite to the car's actual turn direction (unrelated to this plan's own results/course-card surface — root-caused to a pre-existing left-right mirrored projection in `src/hud/minimap.ts`'s `projectMinimapPoint`, exposed by an earlier session's `projectCarRotation` fix that was only algebraically verified, not browser-tested for continuous turning). Fixed and verified separately via `/gsd-debug` (session `minimap-arrow-moves-in-the-op`, commit `bcb963e`) before this plan's checkpoint was re-confirmed as approved. Not a defect in this plan's own deliverables.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

Phase 6's medal/time-attack loop is now fully closed: fixed-clock timing, splits, persistence, medals, course-card grid, and post-run results are all wired and browser-verified for both P2P and Circuit modes on the Juliette map. Phase 7 (NPC Driving AI & Circuit Racers) can proceed — no known blockers from this plan. The Phase 4/4.1 open visual-defect items (oblique-junction surface bug, road-texture gap, ragged road-edge geometry, one building's degenerate geometry) and the still-undecided art-direction-phase question remain outstanding but are pre-existing and out of this plan's scope.

---
*Phase: 06-medals-time-attack-loop*
*Completed: 2026-09-22*
