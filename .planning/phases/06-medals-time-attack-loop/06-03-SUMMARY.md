---
phase: 06-medals-time-attack-loop
plan: 03
subsystem: testing
tags: [typescript, vitest, medals, fixed-clock, route-validation]

# Dependency graph
requires:
  - phase: 05-objectives-navigation-race-modes
    provides: Shipped Juliette P2P/Circuit route identities and browser-verified race/retry handoff
  - phase: 06-medals-time-attack-loop
    provides: Versioned medal percentage bands and timing contract
provides:
  - Strict versioned medal reference parser and route-identity validation
  - Committed Juliette P2P/Circuit fixed-clock reference totals and cumulative splits
  - Real sidecar import coverage for all 7 P2P and 15 Circuit sectors
affects: [medal-runtime-loading, split-hud, results-view, phase-06-05]

# Tech tracking
tech-stack:
  added: []
  patterns: [raw JSON sidecar validation, stable course/checkpoint/lap identity, derived medal thresholds]

key-files:
  created:
    - public/maps/juliette-ga.medals.json
    - .planning/phases/06-medals-time-attack-loop/06-03-SUMMARY.md
  modified:
    - src/core/medal-reference.ts
    - tests/medal-reference.test.ts

key-decisions:
  - "Lock the committed reference sidecar to handling/content baseline 260920-sm2, the deliberate shipped tuning approved at the browser checkpoint."
  - "Keep thresholds derived by medal-timing.ts contract version 1 instead of duplicating threshold values in JSON."
  - "Preserve authored checkpoint identity and explicit hitOrder while validating every Circuit lap occurrence."

patterns-established:
  - "Reference content is committed designer data, never sourced from localStorage personal bests."
  - "Route sidecars remain the authority for stable course/checkpoint identity; medal parsing accepts identity expectations without importing route parsing logic."

requirements-completed: [NAV-02, MEDAL-01, MEDAL-03]

# Metrics
duration: ~20min
completed: 2026-09-21
---

# Phase 6 Plan 3 Summary

**Versioned Juliette medal references with fixed-clock P2P/Circuit totals, complete stable splits, and shared contract-derived thresholds**

## Performance

- **Duration:** Approximately 20 minutes after checkpoint resume
- **Started:** 2026-09-21T22:55:00Z (resume window)
- **Completed:** 2026-09-21T23:11:23+01:00
- **Tasks:** 1 implementation task plus the completed recording checkpoint
- **Files modified:** 3 plan-owned files, plus this summary

## Accomplishments

- Added and committed `public/maps/juliette-ga.medals.json` with handling/content version `260920-sm2`, contract version `1`, positive fixed-clock totals, and complete cumulative split records.
- Recorded P2P `juliette-backroads-run` at `180.0s` with 7 checkpoint splits. Derived thresholds are ace `162.0s`, gold `180.0s`, silver `207.0s`, bronze `243.0s`.
- Recorded three-lap Circuit `juliette-three-lap-loop` at `420.0s` with 15 checkpoint/lap splits. Derived thresholds are ace `378.0s`, gold `420.0s`, silver `483.0s`, bronze `567.0s`.
- The operator approved the Phase 5 browser handoff: both modes load with sports HUD/minimap/arrow/checkpoint target, `P` respawn and `R` restart operate without reload or duplicate overlays, and only the known Three.js `PCFSoftShadowMap` deprecation warning appears.

## Task Commits

1. **Task 1: Add strict reference-content parsing and artifact validation** - `9a190fb` (test), `c04795c` (feat)
2. **Recording follow-through: commit locked Juliette references and real-artifact coverage** - `40ee066` (feat)
3. **Plan-owned formatting correction** - `80f1fff` (style)

No ROADMAP or STATE changes were made, per request.

## Files Created/Modified

- `src/core/medal-reference.ts` - Strict parser for version, area, contract, course, checkpoint, lap, hit-order, finite split, and final-total identity/content rules.
- `tests/medal-reference.test.ts` - Hostile fixture coverage plus import/threshold/completeness assertions for the real sidecar.
- `public/maps/juliette-ga.medals.json` - Committed Juliette reference totals and 22 cumulative split records.

## Decisions Made

- `260920-sm2` is the deliberate handling/content lock; stale Phase 2 acceleration/braking bands were not used as a reference gate.
- Thresholds remain derived from `MEDAL_CONTRACT_VERSION` and `MEDAL_BANDS` in `medal-timing.ts`, preventing sidecar drift.
- The sidecar uses decimal-second fixed-clock values and explicit `authoredIndex` plus `hitOrder` so authored route identity and actual accepted order remain independently inspectable.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Updated stale fixture identity/counts to the shipped route**
- **Found during:** Recording artifact validation
- **Issue:** The committed parser fixture still described the earlier 3-checkpoint P2P and 2-checkpoint Circuit shape, while the shipped route contains 7 and 5 checkpoints.
- **Fix:** Expanded fixture expectations and split records to the actual 7/5 route and 15 Circuit occurrences, then added real-sidecar import assertions.
- **Files modified:** `tests/medal-reference.test.ts`
- **Verification:** Focused reference/course/route suite passes 23/23.
- **Committed in:** `40ee066`, `80f1fff`

**Total deviations:** 1 auto-fixed (Rule 1)
**Impact on plan:** Required to validate the actual shipped route; no product scope was added.

## Validation

- `npm test -- --run tests/medal-reference.test.ts tests/course-data.test.ts tests/route-validation.test.ts` passed: 3 files, 23 tests.
- `npm exec biome -- check tests/medal-reference.test.ts public/maps/juliette-ga.medals.json` passed.
- `npm run typecheck` passed.
- `npm run build` passed; Vite emitted only its existing large-chunk warning.
- `npm test` produced 1,108 passing tests and 3 known Phase 2 vehicle telemetry failures in `tests/vehicle-telemetry.test.ts` (accel, brake, aggregate default-tuning checks).
- `npm run lint` remains red on documented repository-wide baseline findings, including unrelated Phase 5/loop/vehicle files; the plan-owned files are lint-clean.

## Issues Encountered

The full-suite telemetry failures are the known deliberate-handling baseline: the `260920-sm2` tuning intentionally supersedes the older 6.0-7.0 second acceleration and 110-135 foot braking bands. They were not changed while recording references.

The known Three.js `PCFSoftShadowMap` deprecation warning appeared during the approved browser checkpoint; no console errors were reported.

## Known Stubs

None in the plan-owned parser, tests, or reference sidecar.

## Blockers

No blocker for this plan. The known full-suite telemetry failures and repository-wide lint findings remain deferred baseline issues outside this plan's scope.

## Next Phase Readiness

The next Phase 6 plan can load the committed sidecar and rely on strict stable route identity, complete P2P/Circuit split coverage, and contract-derived threshold values. Reference content is explicitly tied to `260920-sm2`, so any deliberate handling/content change must create a new recording version and sidecar values.

## Self-Check: PASSED

- Summary file exists.
- Commits `9a190fb`, `c04795c`, `40ee066`, and `80f1fff` exist.
- No deletions were introduced by the plan commits.

---
*Phase: 06-medals-time-attack-loop*
*Completed: 2026-09-21*
