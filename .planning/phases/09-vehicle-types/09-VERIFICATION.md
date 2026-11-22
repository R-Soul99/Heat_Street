---
phase: 09-vehicle-types
verified: 2026-11-22T22:30:00Z
status: passed
score: 4/4 must-haves verified
overrides_applied: 0
---

# Phase 9: Vehicle Types Verification Report

**Phase Goal:** Several vehicles drive differently because their bodies, wheels and suspension differ. The shipped muscle car's physics stay bit-identical.
**Status:** passed (advisory review warnings noted below)
**Re-verification:** No

## Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | `?car=rally/buggy/truck/monster` each load with own proportions, handling, saved tuning, panel ranges | VERIFIED | `src/core/vehicle-class.ts` registers all four with per-class `storageKey` (`heat-street.tuning.<id>.v1`), per-class default tuning (switch at ~341-410) and `classTuningRanges()` (440-452). `src/main.ts:208-229` resolves `CAR_CLASS` from `?car=` and threads `CAR_RANGES`, class storage key and class defaults into load/feel/panel. |
| 2 | Golden test proves rwd/fwd/awd end a fixed tape in the same state as before the phase | VERIFIED | `tests/vehicle-rwd-golden.test.ts` committed in 09-01 (fac66bb) on the untouched tree and has a single commit, so it was never edited afterwards. Passes now (vitest run, 3 files, 54 tests pass). |
| 3 | Monster spike written up and user saw it before pickup/monster were built | VERIFIED | `.planning/plans-ahead/03-monster-spike-result.md` committed in ed6063f; user "Approved" recorded in ead1117, before 09-09 feature commits (28e1812, 6c1e411). Accepted deviation: monster top speed ~35.8 m/s vs 28 m/s D5. |
| 4 | Each new vehicle meets measured targets (0-60, settle, tilt) and user drove each | VERIFIED | `tests/vehicle-types-targets.test.ts` has per-class 0-60, settleMaxS/settleBandM and tiltSpeedMs targets and passes. User approved the 09-11 drive check: "approved, they all feel like unique vehicles...". |

**Score:** 4/4

## Requirements Coverage

| Requirement | Source Plans | Status | Evidence |
|-------------|--------------|--------|----------|
| VEH-06 (off-road class; per-car drivetrain) | 09-01,02,03,05,06,07,10,11 | SATISFIED | rally and buggy classes with long-travel suspension, larger wheels, loose-surface grip (surfaceGripScale, D-11 per-surface table); drivetrain via frontDriveShare. |
| VEH-07 (heavy class) | 09-01,02,03,04,08,09,10,11 | SATISFIED | truck and monster classes, spike-validated stability, per-class spawn clearance. |
| Pending drivetrain todo | n/a | SATISFIED | No pending todo remains in `.planning/todos/pending`. rwd/fwd/awd drivetrains exist and are locked by the golden test. |

Accounting note: VEH-06 and VEH-07 exist in REQUIREMENTS.md (lines 91-92) only as plain v2 bullets, with no checkbox or traceability row, so they cannot be ticked by tooling (09-11 reported `not_found`). Every PLAN frontmatter `requirements:` entry is VEH-06 and/or VEH-07, and no other IDs are mapped to Phase 9: no orphans. Recommended housekeeping: add checkbox and traceability rows (Phase 9, Complete) to REQUIREMENTS.md.

## Behavioral Spot-Checks

| Check | Result |
|-------|--------|
| `vitest run` golden + targets + vehicle-class tests | PASS (54/54) |
| Full suite (orchestrator) | 2810 pass, 1 fail: `tests/demo-hills.test.ts` max-slope, pre-existing before phase 9 (deferred-items.md), not a phase-9 gap |

No TBD/FIXME/XXX markers in `vehicle-class.ts` or `vehicle.ts`.

## Code Review Warnings (09-REVIEW.md, 0 critical, 6 warnings)

None defeats a must-have. Advisory follow-ups:
- WR-01/02/03 (panel Reset and snapshot import ignore `wheels.rear`; snapshot import defaults from RWD base): affect tuning-panel edge cases. `wheels.rear` is unused by shipped classes, and WR-03 matters only for partial snapshot imports. They don't break SC1 for normal use. Should be fixed.
- WR-04: D-08 says new classes "show a finish time but do not save a medal or best time". Saving is skipped (`main.ts:988`, `1042`), so D-08 holds. Live medal thresholds and PB deltas still show on the HUD, which is a UX inconsistency, not a D-08 violation.
- WR-05 (buggy spawns on the bump stop in-game because it has no `spawnClearanceM`): real risk, but the user drove the buggy and approved. Targets are measured at a different spawn height, so the measurement does not cover this. Recommend a quick fix (`spawnClearanceM: 1.35`) plus a test.
- WR-06: dead `extraLiftM` option, with a double-lift hazard only if someone wires it. Cleanup.

## Human Verification

None outstanding. The 09-11 drive approval covered all five vehicles. Not browser-verified (user noted the flat tarmac map): buggy/monster on loose terrain, monster obstacle climbing and big landings. These are covered only by automated D-11 measurements. This is a follow-up (an off-road test map is expected in Phase 10), not a blocker.

## Gaps Summary

No gaps. All four roadmap success criteria are verified against code, tests and recorded user approvals.

_Verified: 2026-11-22_
_Verifier: Claude (gsd-verifier)_
