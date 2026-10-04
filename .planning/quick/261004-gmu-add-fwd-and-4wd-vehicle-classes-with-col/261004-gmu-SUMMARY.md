---
phase: quick-261004-gmu
plan: 01
subsystem: vehicle
tags: [drivetrain, fwd, awd, tuning, rapier]
key-files:
  created: [src/core/vehicle-class.ts, tests/vehicle-class.test.ts, tests/vehicle-drivetrain.test.ts]
  modified: [src/core/vehicle-tuning.ts, src/physics/vehicle.ts, src/physics/map-scene.ts, src/render/vehicle-view.ts, src/debug/tuning-panel.ts, src/main.ts]
metrics:
  completed: 2026-10-04
---

# Quick 261004-gmu: FWD and AWD vehicle classes

Allowlisted `?car=rwd|fwd|awd` selects the player drivetrain (red / green 0x3fbf3f / blue 0x2a4dff). Engine force is distributed per wheel through `wheelEngineForces` (RWD share 0, FWD 1, AWD 0.4 front), zeroed while braking, same split in reverse. Each class has derived default tuning (overrides on `defaultTuning()`) and its own localStorage key (RWD keeps `heat-street.tuning.v1`).

## Commits
- cb5783e test: failing vehicle-class tests
- b1029ab feat: vehicle-class module, `parseSavedTuning(raw, base?)`
- (test) drivetrain physics tests (RED)
- feat: `createVehicle(..., frontDriveShare = 0)` and `createMapScene(..., frontDriveShare = 0)`
- feat: composition-root wiring, `chassisColor` option, per-class persist option in tuning panel

(Use `git log --oneline` for the exact hashes of the last three.)

## Baseline
The 8 failing tests before the change, and the identical 8 after (no band edited):
- vehicle-recovery: powerSlideRecoveryRoutine candidate band; highSpeedPulseRoutine candidate band
- vehicle-telemetry: accel, brake, skidpad, handbrake, roll assist stability, runAllRoutines

Final full run: 8 failed, 1339 passed. tsc clean; biome clean on every file touched.

## Overlap
The user's tuning edits were already committed (81b7b63), so all edits were committed normally. The dirty unrelated files (racing-line.ts, loop.ts, race-commands.ts, debug note) were not touched or staged. Biome reports formatting errors only in those pre-existing dirty files.

## Decisions
- AI fleet stays RWD: in non-RWD modes it uses a separate `aiTuning` loaded from the RWD key, so panel edits never reach AI cars.
- RWD identity tested bitwise (explicit share 0 vs omitted argument). One caveat: rear forces are now normalised to +0 where they were previously -0 at zero throttle; Rapier treats both as zero and the test shows identical bodies.

## Deviations
None of substance. Note: python edits converted two LF files to CRLF in the working copy; normalised back to LF before the final checks (commits were unaffected).

## Manual browser check
NOT performed. I did not open a browser, so the visual colours and `?car=` loading in the live page are unverified; only headless tests, typecheck and lint were run.

## Orchestrator notes

- Class colours (red RWD / green FWD / blue AWD) are TEMPORARY visual markers for handling A/B testing only, per the user (2026-10-04). Not a permanent design decision; they will be replaced when the car models stop being boxes. Overlap with the AI cars green/blue is not a concern.
- Browser check by orchestrator: `?map=grid-test&car=fwd` loads with a green car, `&car=awd` with a blue car, no console check run. Driving feel of FWD/AWD NOT yet tested.
