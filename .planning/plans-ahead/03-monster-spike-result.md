# Monster truck spike result (plan 09-08, D-10)

Spike code: `tests/monster-spike.test.ts` on throwaway branch `car/monster-spike` (one commit, never merged). All numbers are headless, fixed 1/60 step, frontDriveShare 0.5, spawn at `radius + rest - connectionY + 0.1`. Each iteration ran in a fresh vitest process. Repeat runs (m2 vs m2b, m6 vs m6b) were bit-identical, so no order-dependence was seen when each measurement had its own process (the 09-07 order-sensitivity was not reproduced).

## Verdict

**Works with recommended values.** Rapier's raycast controller holds a 4500 kg body on 0.9 m wheels with 1.0 m travel: settles in 1.4 s with a 0 m band, 4 wheels in contact, no NaN, no tunnelling, no explosion, max body tilt 12 deg off the ramps, peak suspension force 38 kN (3.4x static load), clears a 0.6 m step. It needs a re-derived suspension, a raised connection point for clearance, and a re-tuned gear limiter (top speed target 28 m/s is not reachable with the gear model, see What did not).

## Numbers

Static sag formula verified: per-wheel static compression = g / (4 * stiffness). Stiffness 7 gives 0.35 m = 35 percent of 1.0 m travel; stiffness 12 gives 0.20 m (29 percent of 0.7).

Iterations (6 time-box iterations; the 4 sub-runs of iteration 3 are a one-parameter sweep):

| # | Vehicle | Parameters changed from D5 start (see Recommended values for base) | Settle s | Band m | Rest contact | Tilt 12/15/20 m/s (deg) | Inside wheel lift | Ramp outcome (s / m at 40 mph, big-air at 60) | Peak susp force N | Obstacle 0.6 m at 5 m/s | 0-60 s | Top m/s |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | monster | connectionY 0.45, topSpeedMs 19, force 9000 | 1.40 | 0.000 | 4 | 4.7 / 5.8 / 4.2 | no | all land upright (end tilt 0.2 / 0.2 / 5.8), no NaN | 33173 | BLOCKED: chassis underside clearance 0.40 m, stalled at z -10.8 | not reached | 18.6 |
| 2 | monster | connectionY 0.10 (clearance 0.75 m), topSpeedMs 25, force 12000 | 1.40 | 0.000 | 4 | 5.8 / 6.8 / 7.9 | no | upright (end tilt 2.8 / 8.3 mid-air / 4.0) | 38211 | passes: peak vy 1.11 m/s, pitch rate 0.99 rad/s, max tilt 9.3 deg, no speed loss | 29.0 | 29.1 |
| 3 | monster | topSpeedMs sweep 19 / 22 / 23.5 / 27 / 30 (connectionY 0.10, force 12000) | 1.40 | 0.000 | 4 | 5.5 / 6.3 / 4.8 (at 19) | no | ok | 32791 (at 19) | passes (vy 1.49 at 19) | null/null/null/26.5/6.55 | 18.7/21.6/24.5/35.0/42.4 |
| 4 | monster | topSpeedMs 30, force 12000, linearDamping 0.12 | 1.37 | 0.000 | 4 | 5.4 / 6.4 / 6.6 | no | ok | 35355 | passes (vy 1.17) | not reached | 23.6 (damping too strong) |
| 5 | monster | topSpeedMs 29, force 12000, linearDamping 0.05 (RECOMMENDED) | 1.40 | 0.000 | 4 | 5.8 / 6.7 / 6.7 | no | ramp-s lands upright (2.0 deg); ramp-m still airborne off ramp-l at tick 600 (not a failure); big-air end tilt 9.5, max 11.4 | 37642 | passes: peak vy 1.37 m/s, pitch rate 0.88 rad/s, max tilt 9.7 deg | 7.65 | 35.8 |
| 6 | truck | D5 start: connectionY 0.10, rest 0.8, travel 0.7, stiffness 12, topSpeedMs 24, force 4500 | 1.13 | 0.000 | 4 | 5.5 / 7.1 / 10.3 | no | upright on all three | 21978 | BLOCKED (clearance 0.30 m, stalled z -10.8) | not reached | 23.8 |
| 6b | truck | stiffness 10, comOffset.y +0.1, topSpeedMs 30, force 6000 | 1.23 | 0.000 | 4 | 7.9 / 10.0 / 13.2 | no | upright (end tilt 0.5 / 1.7 mid-air / 8.1) | 23127 | BLOCKED (clearance 0.25 m) | 6.73 | 42.2 |

Monster targets from brief D5: settle under 2 s (met, 1.4), band under 0.01 m (met), 4 contacts (met), 0-60 about 9 s (7.65 measured), top 28 m/s (35.8 measured, see below). Truck targets: 0-60 8 s (6.7), top 36 (42.2).

## What worked

- Rapier `DynamicRayCastVehicleController` is stable at this scale with no code changes: no jitter, no NaN, no speed above 100 m/s, no tunnelling on the feel-test ramps (CCD already on).
- Stiffness from sag formula (g / (4 * stiffness) = 30-40 percent of travel) gives settle 1.1-1.4 s and 0 band on the first try.
- maxSuspensionForce at 80000 (about 7x static 11 kN) is never reached: peak 38 kN on ramp landings.
- Body roll is small: full lock tilt peaks at 7 deg (monster) at 20 m/s because of low connectionY and wide track. No inside-wheel lift.
- With connectionY 0.10 the underside clearance at static sag is 0.75 m and the monster drives over a 0.6 m box with a 1.4 m/s vertical bump and 0.9 rad/s pitch rate.
- Existing assists (landing cushion, auto level, air pitch) are all mass or inertia relative and behaved on the 4500 kg body; ramp landings end upright.

## What did not

- The gear limiter has a sharp knee near topSpeedMs and is heavy-body sensitive: monster topSpeedMs 25 reaches 29 m/s top but takes 29 s to 60 mph, 27 takes 26 s, 30 takes 6.6 s with top 42. The measured top is roughly 1.0x to 1.4x topSpeedMs for this body (vs 1.5x on the cars), not linear. With topSpeedMs 29 the monster measures 7.65 s and 35.8 m/s, so top speed overshoots the D5 28 m/s.
- linearDamping 0.12 to cap top speed over-shot (top 23.6, 0-60 never reached); 0.05 is the working compromise. A reliable top-speed cap for the monster needs a different mechanism (not built, D-10).
- Truck: inside-wheel lift at full lock at 20 m/s was NOT achieved (tilt 13.2 deg, no lift) even with comOffset.y +0.1 and stiffness 10. The "lifts at 20, not at 12" target needs more roll (higher CoM, narrower track, softer stiffness); not reached in the time box.
- Truck underside clearance at static sag is 0.25-0.30 m: it cannot clear the 0.6 m box (expected for a road pickup; not a physics fault).
- With the first monster connectionY (0.45) the 0.40 m underside clearance made the 0.6 m box a wall.

## Recommended ranges

Widened leaves for `classTuningRanges` (superset of the measured values; brief 6.1 ceilings kept where measurements did not contradict them).

Monster:

| Leaf | min | max |
|---|---|---|
| chassis.mass | 3000 | 6000 |
| chassis.halfExtents.y | 0.6 | 1.4 |
| chassis.comOffset.y | -0.3 | 0.6 |
| wheels.halfTrack | 0.9 | 1.8 |
| wheels.halfWheelbase | 1.4 | 2.6 |
| wheels.connectionY | -0.2 | 0.6 |
| wheels.radius | 0.4 | 1.2 |
| wheels.suspensionRestLength | 0.6 | 1.6 |
| wheels.maxSuspensionTravel | 0.5 | 1.3 |
| wheels.suspensionStiffness | 4 | 16 |
| wheels.maxSuspensionForce | 20000 | 200000 |
| drive.topSpeedMs | 18 | 36 |
| drive.engineForcePerRearWheel | 4000 | 20000 |

Truck:

| Leaf | min | max |
|---|---|---|
| chassis.mass | 1800 | 3200 |
| chassis.halfExtents.y | 0.5 | 1.0 |
| chassis.comOffset.y | -0.3 | 0.5 |
| wheels.halfTrack | 0.8 | 1.3 |
| wheels.halfWheelbase | 1.3 | 2.2 |
| wheels.connectionY | -0.2 | 0.4 |
| wheels.radius | 0.4 | 0.7 |
| wheels.suspensionRestLength | 0.5 | 1.1 |
| wheels.maxSuspensionTravel | 0.4 | 0.9 |
| wheels.suspensionStiffness | 6 | 16 |
| wheels.maxSuspensionForce | 20000 | 80000 |
| drive.topSpeedMs | 18 | 34 |
| drive.engineForcePerRearWheel | 3000 | 9000 |

## Recommended values

Monster (classDefaultTuning overrides; everything not listed stays at defaultTuning()). Measured in iteration 5:

- chassis.mass 4500; halfExtents {1.25, 0.90, 2.70}; comOffset.y +0.10; linearDamping 0.05
- wheels.halfTrack 1.5; halfWheelbase 2.0; connectionY 0.10; radius 0.90
- wheels.suspensionRestLength 1.2; maxSuspensionTravel 1.0; suspensionStiffness 7
- suspensionCompression 1.3 and suspensionRelaxation 1.4 (defaults, untouched, settle fine)
- bumpStopStiffness 4 (default, untouched; bump stop never separately exercised, see Car-size constants)
- maxSuspensionForce 80000
- drive.topSpeedMs 29; engineForcePerRearWheel 12000 (0-60 7.65 s, top 35.8 m/s; tune topSpeedMs 27.5-29 if a lower top is wanted, the knee is sharp)
- steering lock: defaults (maxSteerLock pi/4, steerRampPerSec 5). Full-lock tilt is only 7 deg, so no reduction was needed; not independently tuned.

Truck (iteration 6b, not final for the roll target):

- chassis.mass 2300; halfExtents {1.0, 0.7, 2.7}; comOffset.y +0.10 (spike) or -0.10 (brief D5); linearDamping default
- wheels.halfTrack 1.0; halfWheelbase 1.7; connectionY 0.10; radius 0.50
- wheels.suspensionRestLength 0.8; maxSuspensionTravel 0.7; suspensionStiffness 10 (12 also stable)
- compression/relaxation and bumpStop: defaults
- maxSuspensionForce 40000
- drive.topSpeedMs 30; engineForcePerRearWheel 6000 (0-60 6.7 s, top 42 m/s; lower topSpeedMs to about 26-28 for the 36 m/s D5 target, same knee behaviour)
- steering: defaults
- To lift inside wheels at 20 m/s but not 12: not found; plan 09-09 should widen the CoM range upward and/or narrow halfTrack and re-measure.

## Spawn clearance

Chassis origin height above ground for a settled-ready spawn: `spawnClearanceM = radius + suspensionRestLength - connectionY + 0.1`.

- Monster: 0.9 + 1.2 - 0.10 + 0.1 = 2.1 m
- Truck: 0.5 + 0.8 - 0.10 + 0.1 = 1.3 m

The current shared `SPAWN_CLEARANCE_M = 0.6` (map-scene) was not tested for these classes; with halfExtents.y 0.9 the monster chassis box would start inside the ground at 0.6 m. This was verified only on the flat telemetry ground and the feel-test scene reset (which used `defaultSpawnPose.y + 1.5`). Treat per-class spawn clearance as required, and measure on the real map in 09-09.

## Car-size constants

- Gear limiter / `engineForceScale` plus `drive.topSpeedMs` (vehicle.ts lines about 659-700): the knee between starving and free acceleration moves with mass; the top speed is not 1.5 x topSpeedMs for heavy bodies. Numbers above. Not changed.
- `BUMP_STOP_ONSET` 0.75, `BUMP_STOP_GATE_M` 0.06: no misbehaviour seen, but I did not isolate bump-stop engagement (peak force 38 kN vs a 80 kN cap suggests it rarely triggers). Unverified, not changed.
- `CHASSIS_FRICTION` 0.15 and `ROLL_GUARD_ONSET_DEG` 12 / `FULL` 25: roll never exceeded 13 deg here so the roll guard was barely exercised. Not changed.
- `LANDING_CUSHION_GAIN` 30 /s and the other assists: mass/inertia relative (09-07 audit); ramp landings were upright, no change needed.
- `wheel-ray-patch.ts` (heightfield shadowing): ran on the feel-test map ramps with 0.9 m wheels with no anomaly; no car-size constants triggered.
- `powerFadeStartMs/EndMs` (25/40 m/s) only gate power-oversteer, not thrust; not relevant to the monster acceleration limit.

## Obstacle verdict

The 0.6 m step-up is acceptable for the monster once the underside clears it (connectionY 0.10, clearance 0.75 m): peak chassis vertical speed 1.1-1.5 m/s, pitch rate under 1 rad/s, max tilt under 10 deg, no stall. This is smooth enough with one ray per wheel, so no multi-ray wheel patch is recommended for the monster. The truck (clearance 0.25-0.30 m) is blocked by a 0.6 m box, which is the correct behaviour for a pickup. Nothing was implemented (D-10).

## Decision needed

Choose one:

1. Continue with plan 09-09 using the Recommended values above, with the open items: truck inside-wheel lift at 20 m/s still to be found, monster top speed 35.8 versus the D5 28 m/s (either accept a higher top speed or add a speed cap), and per-class spawn clearance to be verified on a real map.
2. Continue with changes you specify (for example relax the monster top-speed target to about 36 m/s, change the 0-60 target to about 8 s).
3. Stop.

An arcade-assist layer or a Jolt evaluation was not needed by anything measured and will only be started if you ask (D-10).
