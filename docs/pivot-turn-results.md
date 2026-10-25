# Pivot turn and power-slide target (2026-10-25)

Branch `pivot-turn`, cut from the detached base `fb59de8` (before the
slide-exit work, which lives on `feel-testing`).

## 1. `drive.powerOversteerRearSideFriction` (default 0.024, range 0..0.05)

The throttle power-oversteer blend and the weight-shift flick blend now head
to their own rear side friction. `handbrakeRearSideFriction` stays 0.005 and
is used by the handbrake alone. Before this the blends shared the handbrake's
value. The one test whose premise changed (a loose rear used to fail the
power-slide recovery band; with the 0.024 target it recovers in ~2.1 s) now
fails the band with `powerOversteerRearSideFriction = 0`.

## 2. Pivot turn (`drive.pivotTurn` 0..1, default 0 = off)

Fields: `pivotTurn`, `pivotYawRate` (4 rad/s), `pivotFrontSpeedCap` (3 m/s).

- **Gate:** ground speed < 12 m/s AND |steer| > 0.8 AND (throttle > 0.8 held
  continuously for 0.3 s OR handbrake held). Smoothed by first-order filters
  (in 0.08 s, out 0.1 s), never a hard switch; the filters snap to exactly 0
  below 0.002 so a gate that never opens leaves no residue.
- **While engaged:** a one-sided torque impulse toward
  `pivotYawRate * pivotTurn * engagement` in the steer direction (it only adds
  rotation, never brakes it), and an `applyImpulseAtPoint` at the front axle
  that pulls the front-axle point velocity back toward `pivotFrontSpeedCap`
  (split along/across the car with the right effective mass for an off-centre
  point), scaled by the same strength. The tail loosens to the power-slide
  value (rear filter 0.05 s).
- **On release:** yaw damped with a 0.15 s time constant (weighted by the
  remaining engagement) and the tail regrips with the 0.05 s filter.

### Verification of "off is inert"

State fingerprints (FNV-style hash over every tick of position, rotation,
linear and angular velocity) of five scripted drives were recorded before the
pivot code existed and matched exactly afterwards with `pivotTurn = 0`.
`tests/pivot-turn.test.ts` also asserts, tick by tick with `toEqual`:
pivotTurn 0 ignores the other two fields; with pivotTurn 1, inputs above
12 m/s, |steer| < 0.8, or no steer are identical to off.

### Pivot routine sweep (`makePivotTurnRoutine`)

From standstill: 1 s full steer + throttle, then steer released with throttle
held, 3 s more. Headings positive in the steer direction.

| Pivot slider | pivotTurn | heading at release | +1 s | overshoot | final | time to 15 m/s | peak yaw (rad/s) | front axle 0.5 / 1.0 s (m/s) | ground speed 1 / 2 / 3 / 4 s (m/s) |
|---|---|---|---|---|---|---|---|---|---|
| 0 | 0 (off) | 43° | 48° | 5° | 48° | 1.03 s | 1.25 | 4.1 / 6.9 | 6.5 / 14.8 / 21.1 / 26.3 |
| 2.5 | 0.25 | 40° | 43° | 3° | 43° | 1.23 s | 0.97 | 4.0 / 5.0 | 4.6 / 13.3 / 19.9 / 25.4 |
| 5 | 0.50 | 54° | 58° | 3° | 58° | 1.28 s | 1.37 | 4.2 / 4.5 | 4.0 / 12.9 / 19.5 / 25.1 |
| 7.5 | 0.75 | 81° | 87° | 6° | 87° | 1.40 s | 2.15 | 4.4 / 3.9 | 2.9 / 12.0 / 18.9 / 24.6 |
| 10 | 1.00 | 117° | 133° | 17° | 133° | 1.68 s | 3.43 | 4.4 / 2.6 | 2.6 / 9.6 / 17.2 / 23.1 |

Reading it:
- Full strength turns 117° in the 1 s hold (2.7x the unassisted 43°), holds
  the front axle to 2.6 m/s, and carries on only 17° after the steer lets go.
- The yaw rate peaks at 3.4 rad/s, short of the 4 rad/s target: the rear
  tyres and the front pin limit it. Raise `pivotYawRate` for more.
- The price is exit speed: time to 15 m/s along the new heading goes from
  1.03 s to 1.68 s, because the car spent the hold turning on the spot.
- The lowest setting (0.25) turns about 3° LESS than off: the front hold
  costs it some speed and the small rotation boost doesn't repay it. From 0.5
  up it is monotonic.
