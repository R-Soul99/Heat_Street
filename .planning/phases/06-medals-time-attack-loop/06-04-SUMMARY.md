---
phase: 06-medals-time-attack-loop
plan: 04
subsystem: gameplay-ui
tags: [typescript, fixed-clock, race-coordinator, hud, medals, splits]

# Dependency graph
requires:
  - phase: 06-medals-time-attack-loop
    provides: pure fixed-clock medal timing, validated PB persistence, and committed reference splits
  - phase: 05-objectives-navigation-race-modes
    provides: fixed-tick checkpoint acceptance, retry commands, navigation, and race HUD placement
provides:
  - fixed-tick coordinator integration for timing, checkpoint splits, retry lifecycle, and frozen completion
  - live timer/threshold/split HUD and post-run sector result presentation
  - composition-root wiring for reference data, local PBs, vehicle telemetry, and SimClock
affects: [phase-06-05, results-ui, race-loop]

# Tech tracking
tech-stack:
  added: []
  patterns: [fixed-tick timing snapshots, accepted-checkpoint event boundary, snapshot-only DOM HUD]

key-files:
  created: []
  modified:
    - src/gameplay/race-coordinator.ts
    - src/hud/race-hud.ts
    - src/main.ts
    - src/physics/vehicle.ts
    - tests/race-coordinator.test.ts

key-decisions:
  - "Read simulation time through the returned LoopHandle.clock instead of introducing a second clock or render-time accumulator."
  - "Use cached vehicle groundSpeedMs produced after each fixed vehicle tick as the deterministic first-movement signal."
  - "Use committed reference cumulative splits for split deltas, labelling the source as BEST when a personal best exists and REFERENCE otherwise."

patterns-established:
  - "Coordinator records timing only after RaceState accepts a checkpoint, preventing sustained sensor occupancy from duplicating sectors."
  - "RaceHud receives plain RaceSnapshot and MedalTimingSnapshot values and performs no medal, storage, or timing decisions."

requirements-completed: [NAV-02, MEDAL-01, MEDAL-03, MEDAL-04]

# Metrics
duration: 18min
completed: 2026-09-21
---

# Phase 6 Plan 4: Fixed-Tick Race Loop Summary

**Fixed-clock race attempts now publish live timer/split feedback and frozen medal sector results through the existing coordinator and DOM HUD.**

## Performance

- **Duration:** 18 min
- **Started:** 2026-09-21T23:00:00Z
- **Completed:** 2026-09-21T23:14:30Z
- **Tasks:** 2
- **Files modified:** 5

## Accomplishments

- Wired `MedalTiming` to post-step accepted checkpoint events, fixed simulation time, vehicle ground speed, and existing restart/respawn command ordering.
- Added one-shot completion publication with frozen sectors, lap/checkpoint identity, slowest-sector selection, and improvement-only local PB persistence.
- Extended the player HUD with a pre-drive/active timer, all four derived thresholds, source-labelled split deltas, and a completion sector table with exactly one highlighted slowest sector.
- Preserved Phase 5 navigation/minimap/arrow behavior and added coordinator regression coverage for occupancy deduplication and retry/completion lifecycle.

## Task Commits

Each task was committed atomically:

1. **Task 1: Integrate timing at the fixed-tick coordinator boundary** - `9eece86` (feat)
2. **Task 2: Extend the race HUD with live timing and sector results** - `155871f` (feat)

**Plan metadata:** `aa4c34d` (docs: complete plan)

## Files Created/Modified

- [src/gameplay/race-coordinator.ts](../../../src/gameplay/race-coordinator.ts) - Fixed-tick timing updates, accepted split capture, retry lifecycle, and completion sink.
- [src/hud/race-hud.ts](../../../src/hud/race-hud.ts) - Live timer/threshold/split and frozen result DOM presentation.
- [src/main.ts](../../../src/main.ts) - Reference sidecar parsing, PB loading/saving, timing construction, and LoopHandle clock wiring.
- [src/physics/vehicle.ts](../../../src/physics/vehicle.ts) - Cached fixed-tick `telemetry` sample exposing ground speed to gameplay.
- [tests/race-coordinator.test.ts](../../../tests/race-coordinator.test.ts) - Coordinator event-boundary, retry, completion-freeze, and restart regression coverage.

## Decisions Made

- The coordinator reads `loopHandle.clock.simTimeSec`; HUD refreshes never advance timing.
- A cached post-`updateVehicle` telemetry sample supplies ground speed without reading render `dtMs`.
- Reference cumulative splits remain the comparison data source; a loaded PB changes only the displayed source label until PB split history exists.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical] Added the composition and telemetry seams required for live fixed-tick integration**
- **Found during:** Task 1 (fixed-tick coordinator integration)
- **Issue:** The plan-owned coordinator contract had a `simTimeSec` stub returning `0`, while `main.ts` did not load reference/PB data and `Vehicle` exposed no fixed-tick ground-speed sample.
- **Fix:** Wired the returned `LoopHandle.clock`, parsed the committed medal sidecar, injected validated local progress, persisted valid completion improvements, and exposed cached post-tick vehicle telemetry.
- **Files modified:** `src/main.ts`, `src/physics/vehicle.ts`
- **Verification:** Typecheck, build, scoped lint, and focused Phase 6 suites passed.
- **Committed in:** `9eece86`

**Total deviations:** 1 auto-fixed (Rule 2)
**Impact on plan:** Required composition-root work stayed within the planned integration boundary; no new dependency or gameplay system was added.

## Issues Encountered

- The existing worktree contained unrelated Phase 5 navigation/minimap edits and untracked planning/screenshots; they were preserved and left unstaged.
- The production build retains the existing large JavaScript chunk warning; no new build error was introduced.
- No browser checkpoint was present in 06-04-PLAN.md, so execution continued through automated validation.

## Validation

- `npm test -- --run tests/race-coordinator.test.ts tests/minimap.test.ts tests/medal-timing.test.ts tests/medal-reference.test.ts tests/medal-persistence.test.ts` passed: 52 tests.
- `npm run typecheck` passed.
- `npm run build` passed; Vite emitted only the existing large-chunk warning.
- `npx biome check src/gameplay/race-coordinator.ts src/hud/race-hud.ts src/physics/vehicle.ts src/main.ts tests/race-coordinator.test.ts` passed.
- HUD source contains no `Date.now`, `performance.now`, render `dtMs`, Rapier, or Three.js dependency.

## Known Stubs

None in the plan-owned implementation. The next plan owns broader course-card/results navigation beyond the completion overlay.

## Threat Flags

None. The HUD consumes snapshots only, accepted checkpoint events are deduplicated through `RaceState`, and PB/reference parsing remains in the validated existing boundaries.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

The fixed-tick gameplay/UI vertical slice is ready for the remaining results/course-card work. Browser verification of the live timer, split labels, persistence reload, and Circuit result layout remains part of the later Phase 6 browser gate.

## Self-Check: PASSED

- Summary file exists.
- Task commits `9eece86` and `155871f` exist in git history.
- No files were deleted by either task commit.

---
*Phase: 06-medals-time-attack-loop*
*Completed: 2026-09-21*
