---
phase: quick-261004-otc
plan: 01
subsystem: vehicle-physics
tags: [fwd, awd, drivetrain, rapier]
key-files:
  modified:
    - src/core/vehicle-class.ts
    - src/physics/vehicle.ts
    - tests/vehicle-class.test.ts
    - tests/vehicle-drivetrain.test.ts
    - docs/vehicle-tuning-guide.md
metrics:
  completed: 2026-10-04
---

# Quick 261004-otc: Arcade front-drive thrust for FWD and AWD

Front share of drive force is now a chassis impulse along heading (gated by front-wheel contact, zero airborne) instead of engine force on the steered front wheels; FWD engine-force override (6000) removed.

## Commits
- 444449d test: failing tests (RED)
- ca9daae feat: helper + tick() change + FWD retune (GREEN, see deviation)
- 4a61adb docs: tuning guide subsection

## Measured numbers (flat ground, 25 mph start, half lock, 1 s; 0-60 = 26.82 m/s)

| | 0-60 before (ticks / s) | 0-60 after | corner throttle before | after | coast |
|---|---|---|---|---|---|
| RWD | 251 / 4.18 | 251 / 4.18 | 15.68 m/s | 15.68 (unchanged) | 9.13 m/s |
| FWD | 199 / 3.32 (at 6000) | 251 / 4.18 (at 4800) | 9.95 m/s (below 11.176 start) | 15.00 | 9.18 |
| AWD | 251 / 4.18 | 251 / 4.18 | 12.94 m/s | 15.30 | 9.12 |

FWD at 5000: 240 ticks; at 5200: 231 ticks (corner 15.26 / 15.52). 4800 gives exact parity with RWD, so the override was deleted.
Note: the plan's quoted 25->22 mph (FWD) was approximate; measured pre-change FWD end speed was 9.95 m/s (22.3 mph), coast 9.18 (20.5 mph).

## Deviations
- **[Rule 3 - ordering]** The FWD 0-60 band test could not be green after the thrust change alone (FWD at 6000 was 20.7% faster than RWD once thrust worked). To keep every commit after RED green, the FWD retune (delete override, update class test, tighten band test to 10%) was folded into the GREEN commit instead of Task 3. Docs went in their own commit.
- RED: the AWD corner test already passed on old code (12.94 end, +3.8 m/s vs coast); the FWD corner test, helper tests and 0-60 test failed as expected.
- Temporary measurement test deleted before finishing.

## Verification
- tests/vehicle-class, vehicle-drivetrain (incl. RWD bitwise test), determinism: pass.
- Full suite: exactly the same 8 baseline failures (vehicle-telemetry x6, vehicle-recovery x2) before and after; no band changed.
- `tsc --noEmit` clean, biome clean on changed files.
- vehicle.ts had no pre-existing real diff; committed with LF/UTF-8 preserved. Unrelated dirty files untouched.

## Caveats
- Feel NOT judged and no browser check run. 
- Players with a saved FWD tuning (localStorage `heat-street.tuning.fwd.v1`) may still hold engineForcePerRearWheel 6000 from the previous default; it will persist until reset.
- AWD 0-60 equals RWD exactly (251 ticks), within band; left unchanged.

## Self-Check: PASSED
