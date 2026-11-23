---
phase: 09-vehicle-types
plan: 10
subsystem: physics
tags: [vehicle-class, tuning, rollover, collision, per-surface, D-11]
requires: [09-09]
provides:
  - truck and monster tuned to measured targets (CLASS_TARGETS rows)
  - rollover tests (inside wheels lift at 20 m/s full lock, not at 12 m/s)
  - tests/vehicle-collision.test.ts (monster vs stationary AI car)
  - measureTimeToSpeed and the D-11 per-surface comparison test
key-files:
  created: [tests/vehicle-collision.test.ts]
  modified: [src/core/vehicle-class.ts, src/physics/telemetry/vehicle-measure.ts, tests/vehicle-measure.test.ts, tests/vehicle-types-targets.test.ts]
key-decisions:
  - "Monster top speed target set to the user-accepted ~35.8 m/s (+-10%), not the brief's 28 m/s"
  - "Monster rollover window set with halfTrack 1.4 and comOffset.y 0.5 (1.2 flips at 12 m/s, 1.5 never lifts)"
requirements-completed: [VEH-06, VEH-07]
duration: 45 min
completed: 2026-11-22
---

# Phase 9 Plan 10: Truck/monster targets and D-11 trade-offs Summary

Pickup and monster now meet measured targets and roll only when pushed; a printed per-surface table proves no new vehicle wins everywhere and each wins at least one cell.

## Measured targets (shipped tuning, tarmac)
| Class | 0-60 s | Target | Top m/s | Target | Settle | Contact | Tilt 12 m/s (lifted) | Tilt 20 m/s (lifted) |
|---|---|---|---|---|---|---|---|---|
| truck | 7.80 | 8.0 +-15% | 36.9 | 36 +-10% | 1.23 s, band 0 | 4 | 8.3 deg (no) | 14.6 deg (yes) |
| monster | 9.00 | 9.0 +-15% | 34.7 | 35.8 +-10% (user accepted, see below) | 1.40 s, band ~0 | 4 | 8.0 deg (no) | 13.4 deg (yes) |

Changes: truck topSpeedMs 30 -> 28 (it is a limiter scale: 30 gave 42.6 m/s) and force 6000 -> 5500 (0-60 was 6.53 s, below the band). Monster force 12000 -> 10500 (0-60 was 7.45 s, below the band), comOffset.y 0.1 -> 0.5, halfTrack 1.5 -> 1.4. 09-09's steering lock (pi/6, ramp 4), rearSideFriction 0.3 and powerOversteerGain 0.5 were re-measured as part of these numbers; they stay.

Monster top speed: user approved ~35.8 m/s at 09-08, so the brief's 28 m/s target was NOT chased; the target row is 35.8 +-10% (measured 34.7).

## Collision (monster 15 m/s into stationary AI muscle car)
Impact 15.0 m/s; AI peak speed 15.1 m/s (limit 1.3x = 19.5); peak vertical 1.74 m/s (limit 5); all finite. No mass or code changes needed.

## D-11 per-surface table (skidpad g / time to 20 m/s s)
| surface | class | skidpad g | t20 s |
|---|---|---|---|
| tarmac | rwd | 1.64 | 2.17 |
| tarmac | rally | 1.66 | 2.50 |
| tarmac | buggy | 1.26 | 2.53 |
| tarmac | truck | 1.73 | 4.35 |
| tarmac | monster | 1.56 | 4.72 |
| gravel | rwd | 1.23 | 2.17 |
| gravel | rally | 1.58 | 2.50 |
| gravel | buggy | 1.12 | 2.53 |
| gravel | truck | 1.49 | 4.35 |
| gravel | monster | 1.38 | 4.72 |
| dirt_road | rwd | 1.27 | 2.17 |
| dirt_road | rally | 1.63 | 2.50 |
| dirt_road | buggy | 1.17 | 2.53 |
| dirt_road | truck | 1.53 | 4.35 |
| dirt_road | monster | 1.40 | 4.72 |
| grass | rwd | 0.91 | 2.18 |
| grass | rally | 1.05 | 2.50 |
| grass | buggy | 0.88 | 2.55 |
| grass | truck | 1.13 | 4.35 |
| grass | monster | 1.12 | 4.72 |
| sand | rwd | 0.75 | 2.22 |
| sand | rally | 0.84 | 2.50 |
| sand | buggy | 0.93 | 2.53 |
| sand | truck | 0.79 | 4.35 |
| sand | monster | 0.79 | 4.72 |
| mud | rwd | 0.68 | 2.25 |
| mud | rally | 0.31 | 2.65 |
| mud | buggy | 0.84 | 2.55 |
| mud | truck | 0.77 | 4.35 |
| mud | monster | 0.92 | 4.72 |

Winners among the four new classes. Skidpad: tarmac truck, gravel rally, dirt_road rally, grass truck, sand buggy, mud monster. t20: rally on five surfaces, buggy on mud. Each class wins at least one cell.

Retune for D-11 (tarmac/rally/buggy targets unchanged and still green): rally gravel and dirt_road forward scale 1.15 -> 1.25, rally mud forward 1.08 -> 0.5; buggy sand forward 1.25 -> 1.5, mud 1.15 -> 1.5; monster sand forward 1.2 -> 1.0.

## Deviations from Plan
1. **[Rule 1] Rally mud skidpad is poor (0.31 g).** Time to 20 m/s is power-limited, not traction-limited, on almost every surface (truck/monster/rally constant across surfaces), so the only way to let a different class win t20 on any surface was to make the rally genuinely traction-limited in mud (forward scale 0.5). Consequence: the rally is the worst car in mud by a wide margin. Flag for the 09-11 feel check; if undesirable, the t20 half of D-11 (a) needs a different lever (buggy engine force vs rally) and a re-plan.
2. **[Rule 3] Removed `export` from `CLASS_TARGETS`** in the targets test: biome `noExportsInTest` failed `npm run check` lint (introduced in an earlier plan; no importers).
3. Collision test measures impact speed as the monster speed one tick before the AI car first moves (post-step speed would understate it).
4. Probe files used during tuning (tests/_probe) were deleted, not committed.

## Verification
`npm run check`: only the known tests/demo-hills.test.ts max-slope failure (2810 tests pass). tests/vehicle-rwd-golden.test.ts unmodified (1 commit in history), green. Typecheck and biome clean.

## Known Stubs
None.

## Commits
- 4b57176 truck/monster tuning, rollover and collision tests
- 2b6c872 measureTimeToSpeed and D-11 per-surface tuning

## Self-Check: PASSED
