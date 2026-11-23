---
phase: 09-vehicle-types
plan: 01
subsystem: testing
tags: [golden-test, rapier, vehicle, regression]
requires: []
provides:
  - tests/vehicle-rwd-golden.test.ts golden end-state tripwire for rwd/fwd/awd
  - out/feel-dossier-baseline-09/ baseline rwd shipped dossier (local, gitignored)
affects: [09-02, 09-11]
tech-stack:
  added: []
  patterns: [closed-form input tape, recorded literals at 1e-6]
key-files:
  created: [tests/vehicle-rwd-golden.test.ts]
  modified: []
key-decisions:
  - "Steer -1 is full left (input-tape.ts), used in the tape"
requirements-completed: [VEH-06, VEH-07]
duration: 10 min
completed: 2026-11-22
---

# Phase 9 Plan 01: Golden vehicle test Summary

Golden end-state test pins shipped rwd, fwd and awd cars (13 numbers each) after a 600-tick tape on flat ground and registered gravel; literals recorded on the untouched tree.

## Accomplishments
- Created branch `car/vehicle-types` from main.
- Baseline `npm run check`: 2735 passed, 1 failed (pre-existing `tests/demo-hills.test.ts` max slope, 80.0 vs 35.5; logged in deferred-items.md, not touched).
- Baseline dossier captured at `out/feel-dossier-baseline-09/` (summary.txt present).
- Golden test: 6 cases pass, typecheck and biome clean, no record branch left.

## Commits
- Task 1: no commit (dossier is gitignored)
- Task 2: fac66bb `test(09-01): golden end-state test for rwd/fwd/awd`

## Deviations from Plan
None. Note: `npm run check` is not fully green on the untouched tree because of the pre-existing demo-hills failure, so the acceptance "check exits 0" cannot be met by this plan; it is out of scope.

## Self-Check: PASSED
