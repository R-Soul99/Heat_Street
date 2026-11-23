---
phase: 09-vehicle-types
plan: 07
subsystem: physics
tags: [vehicle-class, buggy, widened-ranges, assists-audit]
requires: [09-06]
provides:
  - buggy class (`?car=buggy`), widenRanges helper, BUGGY_RANGES
  - buggy row in tests/vehicle-types-targets.test.ts
key-files:
  modified: [src/core/vehicle-class.ts, tests/vehicle-class.test.ts, tests/vehicle-types-targets.test.ts]
key-decisions:
  - "classTuningRanges(\"buggy\") is a deep-frozen widened copy (mass min 500, travel max 0.7); TUNING_RANGES is never mutated"
  - "Buggy deviates from brief D5 on stiffness (12), wheelbase (1.4), frictionSlip (1.4), CoM y (-0.25): the brief values roll or wheelie the 750 kg body"
requirements-completed: [VEH-06]
duration: 40 min
completed: 2026-11-22
---

# Phase 9 Plan 07: Dune buggy Summary

`?car=buggy` loads a teal (0x2ec4b6) 750 kg RWD Dune Buggy with its own storage key (`heat-street.tuning.buggy.v1`), widened ranges (mass min 500, suspension travel max 0.7), a sand/grass/mud-favouring grip table, worse tarmac grip, and no medal saving.

## Measured buggy numbers (shippedTuning("buggy"))

| Metric | Measured | Target |
|---|---|---|
| 0-60 mph | 5.02 s | 5.0 +-15% (4.25-5.75) |
| Top speed | 39.8 m/s | 38 +-10% |
| Settle | 0.63 s, band 0.0000 m | under 2 s, 1 cm |
| Rest contact | 4 wheels | 4 |
| Full-lock tilt at 15 m/s | 4.6 deg | under 15 |
| Stability routine (60 mph full lock) | 8.0 deg | under 15 |
| Ramp routine landing tilt (0.5 s after landing) | 5.8 deg | under 30 (routine pass) |

Buggy tuning: mass 750, halfExtents 0.80/0.35/1.60, comOffset.y -0.25, halfTrack 0.85, halfWheelbase 1.4, radius 0.40, rest 0.70, travel 0.65, stiffness 12, maxSuspensionForce 12000 (static load 1.84 kN per wheel, 6.5x), frictionSlip 1.4, topSpeedMs 27.3, engineForcePerRearWheel 3000. Rear-only oversteer terms left at the RWD defaults.

## Deviations from Plan

**1. [Rule 1 - Bug] Brief D5 values flip or wheelie the car**:
- stiffness 9 and CoM y -0.15 rolled the car 56 deg at full lock at 15 m/s. CoM y -0.25 plus stiffness 12 fixed it (8 deg).
- frictionSlip 1.7 rolled it at 60 mph full lock (59-92 deg); 1.4 slides instead (10 deg).
- halfWheelbase 1.15 plus punchy low gear wheelied the car to 69 deg in the stability routine launch; wheelbase 1.4 gives 8 deg. Higher engine force re-introduces the wheelie (5000+ at hw 1.15), so force stays 3000.
- All values remain inside BUGGY_RANGES / TUNING_RANGES except mass and travel, which use the widened ones.

**2. [Rule 1 - Bad plan assumption] topSpeedMs is a scale**: topSpeedMs 27.3 yields 39.8 m/s (about 1.45x). Below about 26.8 the gear limiter starves 0-60 completely (stalls at 24+ s).

**3. Extra assertions**: the stability routine check is now also asserted for the buggy (shared with rally); ramp landing check added for the buggy only.

**4. Existing test edits**: `tests/vehicle-class.test.ts` "overrides inside ranges" now clamps with `classTuningRanges(id)`, and the "TUNING_RANGES itself" test is limited to rwd/fwd/awd/rally (buggy has its own test).

## Absolute (non mass-relative) forces in vehicle-assists.ts

Every torque assist scales with the cached inertia (`I.x`/`I.y`), and the landing cushion scales with `body.mass()`, so those track the 750 kg body automatically. The only absolute terms:

| Name | Value | Effect on a 750 kg body (measured, ramp routine landing tilt) |
|---|---|---|
| `downforcePerSpeed2` (tuning, impulse in N, not mass scaled) | default 0 | inert; at coefficient 1 it adds 1.4 kN at 38 m/s (about 0.19 g on 750 kg vs 0.06 g on 2500 kg), ramp tilt 5.8 -> 8.5 deg. Left at 0 |
| `LANDING_CUSHION_GAIN` | 30 /s (accel per m/s of excess sink, capped by `landingCushionG` x g) | mass-relative (impulse = mass x accel); ramp tilt with cushion 5.8 deg vs 7.4 deg without. No change needed |
| `GRAVITY` | 9.81 | constant; used in the air-pitch flight-path term, mass independent |
| `AIR_PITCH_*` constants | angles (0.6, 0.3 follow, 80 and 60 deg caps) | dimensionless; air pitch off makes the ramp routine FAIL (tilt 6.0 but forward speed gate), on keeps it passing |
| `autoLevelGain` 0.4 | inertia scaled | ramp tilt 5.8 deg on vs 2.9 deg off (this launch spin is mild for the buggy) |

No assist code was changed; golden test is bit-identical and unmodified (1 commit in its history).

## Verification
`npm run check`: only the known demo-hills slope failure (2795 tests pass). Golden test unmodified and green.

Observation (not fixed): measurement results in a long vitest process looked order-sensitive for marginal-tuning cases (the same tuning gave 0-60 4.57 s in one run and 24 s in another when preceded by different routines). The shipped tuning is now well away from the limiter-stall edge and measured consistently, but the physics rig may carry some hidden state between runs.

## Known Stubs
None.

## Self-Check: PASSED
