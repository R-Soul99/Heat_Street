---
phase: 09-vehicle-types
plan: 05
subsystem: physics
tags: [surface-grip, vehicle-class, skidpad]
requires: [09-03, 09-04]
provides:
  - SurfaceGripScale, UNIT_SURFACE_GRIP_SCALE, VehicleClassSpec.surfaceGripScale
  - CreateVehicleOptions (trailing createVehicle arg), RoutineRunOpts.surfaceGripScale
key-files:
  created: [tests/surface-grip-scale.test.ts]
  modified: [src/core/vehicle-class.ts, src/physics/vehicle.ts, src/physics/map-scene.ts, src/physics/terrain-scene.ts, src/physics/telemetry/run.ts, src/physics/telemetry/vehicle-measure.ts, src/main.ts, tests/vehicle-class.test.ts]
key-decisions:
  - "Scale applied only at the surface-profile read site, null branch means zero new arithmetic"
requirements-completed: [VEH-06]
duration: 20 min
completed: 2026-11-22
---

# Phase 9 Plan 05: Per-surface grip scale Summary

Every class spec carries a frozen per-surface forward/lateral grip multiplier table (all ones for rwd/fwd/awd); `createVehicle` applies it where the surface profile grip is read, only for the player car.

## Commits
- Task 1: spec type, options and RangeError validation
- Task 2: scene/run/main threading and skidpad tests

## Verification
`npm run check`: only the known demo-hills slope failure. Golden test green and unmodified. main.ts counts: `surfaceGripScale: CAR_CLASS.surfaceGripScale` = 2, `CAR_CLASS.frontDriveShare` = 2 (both player calls).

## Deviations from Plan

**1. [Rule 3] Player createVehicle lives in scenes**: main.ts does not call createVehicle directly; `createMapScene` and `createTerrainScene` gained a trailing `vehicleOptions` parameter that main.ts fills for the player.
**2. [Rule 1 - Bad plan assumption] Lateral scale effect is small**: lateral grip only drives side-friction stiffness, so skidpad g barely moves (tarmac lateral 0.5: 1.486 to 1.451, -2.4%, not -10%; gravel lateral 1.3 slightly lowers g). Forward grip (frictionSlip) dominates skidpad g (tarmac forward 0.5: 0.73). Tests use combined forward+lateral scales for the 10% and gravel-raise assertions, plus a test that lateral alone changes the result. Implication for D-11 trade-offs: tune `forward` for a limit-grip change, `lateral` for handling character.
**3. Extra**: `vehicle-measure.ts` withRig also forwards the scale; a fourth test covers RangeError.

## Known Stubs
None.

## Self-Check: PASSED
