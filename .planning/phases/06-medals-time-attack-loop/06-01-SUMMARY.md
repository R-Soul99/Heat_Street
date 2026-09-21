---
phase: 06-medals-time-attack-loop
plan: 01
subsystem: testing
tags: [typescript, vitest, fixed-clock, medals, splits]

# Dependency graph
requires:
  - phase: 05-objectives-navigation-race-modes
    provides: stable race progression, checkpoint identity, respawn penalty, and Circuit lap semantics
provides:
  - pure versioned medal threshold and classification contract
  - fixed-simulation-clock attempt lifecycle with restart, respawn, and frozen completion
  - P2P/Circuit checkpoint split and slowest-sector snapshots
affects: [phase-06-persistence, phase-06-hud, phase-06-race-integration]

# Tech tracking
tech-stack:
  added: []
  patterns: [closure-owned pure state, absolute simTimeSec anchors, immutable snapshots, fixed percentage medal bands]

key-files:
  created:
    - src/core/medal-timing.ts
    - tests/medal-timing.test.ts
  modified: []

key-decisions:
  - "Use a deterministic 0.5 m/s fixed-tick speed threshold for first meaningful movement."
  - "Treat the race-provided penalty as an authoritative cumulative value and synchronize with max semantics to prevent double counting."
  - "Preserve actual accepted checkpoint order and use first-seen tie breaking for the single slowest sector."

patterns-established:
  - "Timing derives elapsed values from simTimeSec minus a fixed start anchor, never render or wall-clock time."
  - "Completion snapshots freeze effective time, medal, sectors, and slowest-sector selection."

requirements-completed: [NAV-02, MEDAL-01, MEDAL-03, MEDAL-04]

# Metrics
duration: 11min
completed: 2026-09-21
---

# Phase 6 Plan 1: Pure Medal Timing Summary

**Deterministic fixed-clock attempt timing with versioned medal bands, checkpoint splits, and frozen P2P/Circuit completion results**

## Performance

- **Duration:** 11 min
- **Started:** 2026-09-21T23:02:00Z
- **Completed:** 2026-09-21T23:03:55Z
- **Tasks:** 2
- **Files modified:** 2 created

## Accomplishments

- Added a pure `medal-timing` contract with Ace/Gold/Silver/Bronze inclusive percentage bands and hostile numeric input handling.
- Added fixed-tick attempt phases, first-movement anchoring, singular respawn-penalty ownership, restart reset, and immutable completion results.
- Added ordered checkpoint sectors with lap/checkpoint identity, comparison source/delta, and deterministic slowest-sector selection.
- Added 11 focused tests covering all planned timing, grading, lifecycle, split, and Circuit-sector behaviors.

## Task Commits

Each task was committed atomically:

1. **Task 1: Define the shared time-attack and medal contracts** - `11a6887` (feat)
2. **Task 2: Prove deterministic timing, grading, splits, and lifecycle behavior** - `84f7134` (test)

No separate planning-metadata commit was made because the user explicitly required `ROADMAP.md` and `STATE.md` to remain untouched; this summary is the only planning-file change.

## Files Created/Modified

- [src/core/medal-timing.ts](../../../src/core/medal-timing.ts) - Pure fixed-clock attempt, medal, split, sector, and frozen-result contract.
- [tests/medal-timing.test.ts](../../../tests/medal-timing.test.ts) - Deterministic contract and lifecycle tests.

## Decisions Made

- The first meaningful movement threshold is `0.5 m/s`, evaluated only on fixed simulation samples.
- Exact medal boundary classification uses ratio comparisons with a scale-aware floating-point tolerance so authored boundaries remain inclusive.
- Completion retains the original result even when later simulation samples arrive.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Stabilized exact percentage-band boundaries**
- **Found during:** Task 2 (deterministic timing, grading, splits, and lifecycle tests)
- **Issue:** Binary floating-point multiplication caused an exact `115%` boundary to classify as Bronze.
- **Fix:** Classify using the elapsed/reference ratio with a scale-aware machine-epsilon tolerance.
- **Files modified:** src/core/medal-timing.ts
- **Verification:** Focused medal suite and combined regression suite pass.
- **Committed in:** `11a6887`

**2. [Rule 1 - Bug] Froze all completion snapshot timing fields**
- **Found during:** Task 2 (completion freeze test)
- **Issue:** The result was frozen, but a later simulation sample changed the projected `baseElapsedSec` field.
- **Fix:** Project completed snapshots from the frozen effective result rather than later simulation time.
- **Files modified:** src/core/medal-timing.ts
- **Verification:** Frozen completion test passes and later snapshots equal the completed snapshot.
- **Committed in:** `11a6887`

**Total deviations:** 2 auto-fixed (2 Rule 1 bugs)
**Impact on plan:** Both fixes were local correctness repairs required by the planned boundary and freeze semantics; no scope expansion.

## Issues Encountered

- Initial scoped Biome validation reported formatter/import-order differences; the scoped formatter fixed them, and the final lint check passed.
- Existing unrelated Phase 5 worktree changes were preserved and not staged.

## Validation

- `npm test -- --run tests/medal-timing.test.ts` passed: 11 tests.
- `npm test -- --run tests/medal-timing.test.ts tests/sim-clock.test.ts tests/race-state.test.ts` passed: 35 tests.
- `npm run typecheck` passed.
- `npx biome check src/core/medal-timing.ts tests/medal-timing.test.ts` passed.
- Source contract contains no DOM, storage, Three.js, Rapier, `Date.now`, `performance.now`, or render-delta dependency.

## Known Stubs

None. The module is intentionally pure and does not include persistence or UI, which are later Phase 6 plans.

## Threat Flags

None. The module is pure and introduces no network, auth, file, storage, or schema trust boundary.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

The pure contract is ready for coordinator integration, persistence, and HUD work. `ROADMAP.md` and `STATE.md` were intentionally not modified per the execution request. No checkpoint or blocker was encountered.

## Self-Check: PASSED

- Summary file exists.
- Implementation and test files exist.
- Task commits `11a6887` and `84f7134` exist in git history.

---
*Phase: 06-medals-time-attack-loop*
*Completed: 2026-09-21*
