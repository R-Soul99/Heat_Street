---
phase: 09-vehicle-types
plan: 09
subsystem: physics
tags: [vehicle-class, truck, monster, spawn-clearance]
requires: [09-08]
provides:
  - truck and monster classes (`?car=truck`, `?car=monster`), TRUCK_RANGES, MONSTER_RANGES
  - VehicleClassSpec.spawnClearanceM and player spawn lift in main.ts
key-files:
  modified: [src/core/vehicle-class.ts, src/main.ts, src/gameplay/free-drive-coordinator.ts, tests/vehicle-class.test.ts, tests/free-drive-coordinator.test.ts]
key-decisions:
  - "Player spawn lift is applied by wrapping scene.resetVehicle in main.ts (only when the lift is non-zero), covering every player reset site including the race coordinators"
requirements-completed: [VEH-07]
duration: 30 min
completed: 2026-11-22
---

# Phase 9 Plan 09: Truck and monster registration Summary

`?car=truck` (4x4 Pickup, 0x8a6a2f) and `?car=monster` (Monster Truck, 0xd4c21a) load as AWD (front share 0.5) classes with spike-approved ranges and defaults, own storage keys, no medals, and per-class spawn clearance (truck 1.3 m, monster 2.1 m).

## What was built
- Specs, grip tables (starting values, retuned in 09-10), TRUCK_RANGES / MONSTER_RANGES (exactly the spike's Recommended ranges), defaults from the approved Recommended values (monster iteration 5, truck iteration 6b).
- `spawnClearanceM` optional spec field; undefined for rwd/fwd/awd. A test asserts it equals radius + rest - connectionY + 0.1 from the defaults.
- main.ts: `PLAYER_SPAWN_LIFT_M` and `liftPlayerPose`; scene.resetVehicle is wrapped only when lift is non-zero, then the initial spawn is re-posed. rwd/fwd/awd take no new code path.
- free-drive coordinator: optional `extraLiftM` dep (tested).

## Deviations from Plan
1. **[Rule 2] Lift applied centrally instead of per site.** The race and circuit coordinators (outside the plan's file list) call `scene.resetVehicle` for restart, checkpoint respawn and grid reset; per-site lifting would have left those spawning a 2.1 m monster at 0.6 m. Wrapping `scene.resetVehicle` covers all player sites; AI uses `fleet.resetCar`/createAiFleet and is unchanged. Consequence: main.ts does not pass `extraLiftM` (would double-lift); the dep exists and is tested but is unused by main.
2. **Steering lock** lowered for both trucks (maxSteerLock pi/6, steerRampPerSec 4) per plan/brief 7.3, although the spike measured with default steering. Within ranges; not re-measured, steering only reduces roll, but 09-10 should confirm.
3. rearSideFriction 0.3 and powerOversteerGain 0.5 set on both (awd-like, per plan), also not part of the spike measurements.
4. Files were briefly rewritten with CRLF by tooling and normalised back to LF; a formatting-only commit followed.

## Open items (carried)
- Truck inside-wheel lift at 20 m/s but not 12 m/s: belongs to 09-10.
- Monster top speed about 35.8 m/s accepted (user approval); truck about 42 m/s vs 36 target, 09-10.
- Spawn clearance not yet verified on a real map in a browser (unit-tested value only).

## Verification
`npm run check`: only the known demo-hills slope failure (2801 tests pass). tests/vehicle-rwd-golden.test.ts unmodified and green.

## Known Stubs
None.

## Self-Check: PASSED
