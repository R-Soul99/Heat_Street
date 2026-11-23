---
phase: 09-vehicle-types
plan: 03
subsystem: telemetry
tags: [telemetry, measurement, awd, headless]
requires: [09-01]
provides:
  - RoutineRunOpts (frontDriveShare, spawnY) as fifth runRoutine parameter
  - vehicle-measure.ts helpers (measureZeroToSixty, measureTopSpeed, measureSettle, measureFullLockTilt, measureRestContact, measureSurfaceSkidpad)
affects: [09-04, 09-05]
tech-stack:
  added: []
  patterns: [byte-identical default path when opts undefined]
key-files:
  created: [src/physics/telemetry/vehicle-measure.ts, tests/vehicle-measure.test.ts]
  modified: [src/physics/telemetry/run.ts, src/physics/telemetry/surface-routines.ts]
key-decisions:
  - "makeSurfaceSkidpadRoutine is now exported from surface-routines.ts so measureSurfaceSkidpad reuses the same routine as the sweeps"
requirements-completed: [VEH-06, VEH-07]
duration: 20 min
completed: 2026-11-22
---

# Phase 9 Plan 03: Measurement infrastructure Summary

`runRoutine` and the surface sweeps accept optional `RoutineRunOpts` (drive share, spawn height) with the default path still the literal 3-argument `createVehicle(world, tuning, SPAWN)`; a new `vehicle-measure.ts` measures 0-60, top speed, settle, full-lock tilt, rest contact and surface skidpad headlessly.

## Commits
- Task 1: 8e9fe16 RoutineRunOpts on runRoutine and sweeps
- Task 2: vehicle-measure helpers (61844dd)

## Verification
`npm run check`: only the known demo-hills slope failure; golden test green and unmodified.

## Deviations from Plan

**1. [Rule 1 - Bad plan assumption] AWD accel test**
- Plan expected `runRoutine(accel, awd, ..., {frontDriveShare: 0.4}).value` to differ from the RWD-path value. Measured: the 0-60 time is 3.70 s for every drive share 0, 0.4 and 1 (total force identical, quantised to the same tick). The test instead compares a continuous probe routine (speed and position at 1 s), which does differ.
- Consequence for later plans: 0-60 alone cannot reveal drive-share bugs; use a continuous measure.

**2. [Rule 1 - Bad plan assumption] measureTopSpeed within 15% of drive.topSpeedMs**
- `drive.topSpeedMs` (48) is a gear and steer-fade scale, not a cap; the muscle car measures about 69.4 m/s. The test asserts finite, greater than the scale, and deterministic instead.

**3. [Rule 3] Exported `makeSurfaceSkidpadRoutine`** (was module-private) so the helper can reuse it.

## Known Stubs
None.

## Self-Check: PASSED
