---
phase: 06-medals-time-attack-loop
plan: 02
subsystem: testing
tags: [typescript, vitest, local-storage, validation, medals]

# Dependency graph
requires:
  - phase: 06-medals-time-attack-loop
    provides: pure medal timing contract and frozen completed results from 06-01
provides:
  - versioned course-keyed medal progress schema and parser
  - injected storage adapter with safe load/save behavior
  - hostile-input and improvement-only persistence coverage
affects: [phase-06-reference-content, phase-06-results-ui]

# Tech tracking
tech-stack:
  added: []
  patterns: [allowlisted versioned envelope, independent record validation, injected raw-string storage]

key-files:
  created:
    - src/core/medal-persistence.ts
    - tests/medal-persistence.test.ts
  modified: []

key-decisions:
  - "Persist only stable course IDs, positive finite effective times, and recognized historical medals."
  - "Use an injected raw-string adapter so core persistence remains browser-independent and testable in Node."
  - "Reject unsafe course keys and copy only allowlisted record fields to protect the returned store from prototype/extra-key input."

patterns-established:
  - "Malformed envelopes fall back to an empty safe store while valid sibling course records survive invalid records."
  - "A completed result writes only when its effective time strictly improves the existing course best."

requirements-completed: [MEDAL-02]

# Metrics
duration: 3min
completed: 2026-09-21
---

# Phase 6 Plan 2: Versioned Medal Persistence Summary

**Validated, course-keyed local best-time persistence with hostile-input isolation and improvement-only writes**

## Performance

- **Duration:** 3 min
- **Started:** 2026-09-21T23:05:00Z
- **Completed:** 2026-09-21T23:08:00Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments

- Added a pure versioned medal-progress envelope with explicit kind, schema version, stable course IDs, positive finite best times, and recognized medals.
- Added independent per-course validation that drops malformed, unknown, extra-key, and unsafe records without erasing valid siblings.
- Added injected load/save helpers that never require browser globals and write only valid completed improvements.
- Added focused hostile-input, migration/fallback, prototype-safety, no-fake-zero, and slower-result tests.

## Task Commits

Each TDD task was committed atomically:

1. **Task 1 RED: Define persistence behavior tests** - `178d34d` (test)
2. **Task 1 GREEN / Task 2: Implement and exercise medal persistence** - `b233675` (feat)

No `ROADMAP.md` or `STATE.md` commit was made, per the user request.

## Files Created/Modified

- [src/core/medal-persistence.ts](../../../src/core/medal-persistence.ts) - Pure schema, parser, serializer, merge, and injected storage helpers.
- [tests/medal-persistence.test.ts](../../../tests/medal-persistence.test.ts) - Focused persistence and hostile-input coverage.

## Decisions Made

- Used `heat-street.medals.v1` as the storage key and `heat-street.medal-progress` with schema version `1` as the envelope identity.
- Kept `none` as a recognized historical medal while requiring the best time itself to be strictly positive and finite.
- Preserved an existing course record when a new completed result is slower or equal, including its previously awarded medal.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Fixed TypeScript narrowing in known-course validation**
- **Found during:** Task 1 GREEN validation
- **Issue:** TypeScript did not narrow the union of readonly course-ID arrays and sets after `Array.isArray`.
- **Fix:** Added an explicit readonly-set cast at the narrow adapter boundary.
- **Files modified:** `src/core/medal-persistence.ts`
- **Verification:** `npm run typecheck` passed.
- **Committed in:** `b233675`

**Total deviations:** 1 auto-fixed (1 blocking type issue)
**Impact on plan:** Local type correction only; no scope expansion or API change.

## Issues Encountered

- The initial RED run failed because the planned module did not yet exist, as required by the TDD sequence.
- Scoped Biome formatting/import-order differences were applied mechanically to the two plan files and then rechecked successfully.
- Existing Phase 5 worktree edits and unrelated untracked files were preserved and not staged.

## Validation

- `npm test -- --run tests/medal-persistence.test.ts` passed: 19 tests.
- `npm test -- --run tests/medal-persistence.test.ts tests/tuning-persist.test.ts tests/tuning-snapshot.test.ts` passed: 53 tests.
- `npm run typecheck` passed.
- `npx biome check src/core/medal-persistence.ts tests/medal-persistence.test.ts` passed.
- `src/core/medal-persistence.ts` contains no `localStorage`, DOM, wall-clock, renderer, or physics dependency.

## Known Stubs

None. The module intentionally stops at the injected storage boundary; composition-root wiring is owned by the later integration plan.

## Threat Flags

None. The planned local-storage trust boundary is explicitly validated and introduces no network, auth, or file-access surface.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

Ready for reference-content and results integration plans. `main.ts` can inject a browser-edge adapter, pass known stable course IDs, load validated progress, and persist only frozen completed improvements. `ROADMAP.md` and `STATE.md` remain untouched as requested.

## Self-Check: PASSED

- Summary file exists.
- Implementation and test files exist.
- Task commits `178d34d` and `b233675` exist in git history.

---
*Phase: 06-medals-time-attack-loop*
*Completed: 2026-09-21*
