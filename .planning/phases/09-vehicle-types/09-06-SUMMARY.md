---
phase: 09-vehicle-types
plan: 06
subsystem: physics
tags: [vehicle-class, rally, medal-gate, debug-menu]
requires: [09-05]
provides:
  - rally class (VehicleClassSpec.savesMedals, searchForVehicle, createVehicleMenu)
  - tests/vehicle-types-targets.test.ts CLASS_TARGETS table
key-files:
  created: [tests/vehicle-types-targets.test.ts]
  modified: [src/core/vehicle-class.ts, src/main.ts, src/debug/map-menu.ts, tests/vehicle-class.test.ts]
key-decisions:
  - "Rally topSpeedMs set to 30 (gear scale); measured top speed is about 1.54x the scale"
requirements-completed: [VEH-06]
duration: 25 min
completed: 2026-11-22
---

# Phase 9 Plan 06: Rally coupe Summary

`?car=rally` loads an orange AWD (0.45 front) Rally Coupe with its own storage key, off-road grip table and no medal saving; the `?debug`/`?feel` menu gains a vehicle drop-down.

## Measured rally numbers (shippedTuning("rally"))

| Metric | Measured | Target |
|---|---|---|
| 0-60 mph | 4.20 s | 3.4-4.6 s |
| Top speed | 46.3 m/s | 46 +-10% |
| Settle | 0.37 s, band 0.0000 m | under 2 s, 1 cm |
| Rest contact | 4 wheels | 4 |
| Full-lock tilt at 15 m/s | 4.1 deg | under 15 |
| Handbrake on gravel (max slip) | 77.2 deg | over 25 |
| Stability (60 mph full lock tilt) | 8.6 deg | under 15 |

Rally tuning: mass 1250, halfExtents 0.90/0.48/2.10, halfTrack 0.80, halfWheelbase 1.35, radius 0.37, stiffness 16, rearSideFriction 0.3, powerOversteerGain 0.5, engineForcePerRearWheel 4800 (per-wheel force of a two-wheel-drive axle, D-04), topSpeedMs 30.

## Deviations from Plan

**1. [Rule 1 - Bad plan assumption] topSpeedMs 46 does not give 46 m/s**: topSpeedMs is a gear/limiter scale; 46 measured 69 m/s. A probe grid showed top is about 1.54x the scale, so topSpeedMs 30 yields 46.3 m/s with 0-60 4.20 s.
**2. [D-08 scope] Race save also gated**: `saveRaceResult` (best finish and best time) is also skipped when `savesMedals` is false, per "no medal or best time".
**3. No-medal value**: `Medal` has `"none"`, so rally completions call `showCompletion({...completion, medal: "none"})`; the panel reads "RESULT NONE <time>" (cosmetic wording could be improved later).
**4. Commits**: Task 1 and Task 3 code share main.ts and vehicle-class.ts, so they were committed together (9e164e8); targets test is 2968fc5.

## Verification
`npm run check`: only the known demo-hills slope failure. Golden test unmodified and green. `.pass` count in targets test: 0.

## Known Stubs
None.

## Self-Check: PASSED
