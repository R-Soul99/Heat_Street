---
phase: 05-objectives-navigation-race-modes
plan: 03
subsystem: retry-and-loop
tags: [typescript, rapier, fixed-timestep, respawn, restart, input]

# Dependency graph
requires:
  - phase: 05-objectives-navigation-race-modes
    provides: race-state penalty/restart contracts and checkpoint anchors
provides:
  - validated in-place Rapier vehicle pose reset
  - MapScene authored spawn/reset contract
  - one-shot respawn/restart command source
  - fixed-tick retry command seam with interpolation realignment
affects: [race-coordinator, navigation-hud, race-modes]

# Tech tracking
tech-stack:
  added: []
  patterns: [physics-owned reset, fixed-tick command latching, reset-safe interpolation]

key-files:
  created:
    - src/input/race-commands.ts
    - tests/respawn.test.ts
    - tests/restart.test.ts
  modified:
    - src/physics/vehicle.ts
    - src/physics/map-scene.ts
    - src/input/keyboard.ts
    - src/loop.ts
    - tests/loop.test.ts

decisions:
  - "KeyP is the one-shot respawn command and KeyR is the one-shot full restart command."
  - "Reset mutates the existing Rapier body and clears both velocity vectors; no controller, world, asset, or loop recreation is used."
  - "Retry commands are consumed after onTickBegin and before applyInput/world.step; both interpolation buffers are aligned to the reset pose."

metrics:
  duration: 3 min
  completed: 2026-09-21
---

# Phase 5 Plan 3 Summary

**Physics-owned respawn and fixed-tick in-place retry commands without rewinding time or rebuilding the loaded world**

## Accomplishments

- Added finite-value validation and an in-place `Vehicle.resetPose` operation that sets authored translation, upright Y heading, zero linear/angular velocity, and wake state on the existing body.
- Exposed `MapScene.defaultSpawnPose` and `MapScene.resetVehicle` without importing Three.js or reading wall-clock time.
- Added `KeyP` respawn and `KeyR` restart edge capture through a separate race-command latch; held keys cannot repeat each tick.
- Added a loop callback seam that samples commands at fixed-tick boundaries before normal input/physics mutation and realigns transform interpolation buffers after reset.
- Added observable tests proving body/world/loop lifetime is preserved and restart commands are not recreated or reloaded.

## Task Commits

1. **Task 1: Add physics-owned vehicle and map reset operations** - `500db68`
2. **Task 2: Add discrete retry commands and fixed-loop reset seam** - `b2e37b6`

## Verification

- `npm test -- --run tests/respawn.test.ts tests/restart.test.ts tests/loop.test.ts` passed: 3 files, 16 tests.
- `npm run typecheck` passed.
- No browser/manual checkpoint was required; the plan's browser smoke is assigned to Plan 05-04.
- No blockers.

## Deviations from Plan

None - plan executed exactly as written.

## Known Stubs

None found in the files created or modified by this plan.

## Threat Surface Scan

No new network endpoints, authentication paths, file access, or persistence were introduced. Keyboard retry input is edge-latched, and pose values are finite-validated before physics mutation.

## Self-Check: PASSED

- `src/input/race-commands.ts` exists.
- `tests/respawn.test.ts` exists.
- `tests/restart.test.ts` exists.
- Commits `500db68` and `b2e37b6` exist in git history.
- Focused tests and typecheck pass.

---
*Phase: 05-objectives-navigation-race-modes*
*Completed: 2026-09-21*
