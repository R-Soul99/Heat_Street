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

- **Gate:** |steer| > 0.8 AND throttle > 0.8, held continuously for 0.3 s
  (dwell), scaled by a speed fade: fully active below 5 m/s, fading linearly
  to zero at 8 m/s, never engaged at or above 8 m/s (revised 2026-10-25 from a
  flat 12 m/s cut-off). The handbrake is NOT part of the gate: it does not
  trigger the pivot, shift its dwell timer, or change its strength. Smoothed
  by first-order filters (in 0.08 s, out 0.1 s), never a hard switch; the
  filters snap to exactly 0 below 0.002 so a gate that never opens leaves no
  residue.
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
pivotTurn 0 ignores the other two fields; with pivotTurn 1, inputs at or
above 8 m/s, |steer| < 0.8, or no steer are identical to off.

Revision 2026-10-25 (handbrake removed, speed gate 5 to 8 m/s):
- the handbrake with full steer never triggers it (throttle 0, 0.5, 0.8 and a
  steady full steer all identical to off), and does not move the tick on which
  the pivot starts to act (tick 18 either way, the 0.3 s dwell);
- a test also asserts the gate code contains no reference to the handbrake;
- speed fade, measured as the largest yaw-rate difference vs off with the
  forward speed held constant: strong at 2 m/s, falling through 4.5 / 6.5 /
  7.5 m/s, and exactly 0 (bit-identical) at 8 and 10 m/s;
- hairpin regression: entered at 10 m/s with full lock and full throttle (both
  instant lock and a 5/s keyboard ramp) over 6 s, pivotTurn 1 is bit-for-bit
  identical to pivotTurn 0. At full throttle the car speeds up through the
  hairpin (10 to 13 m/s), so it never drops under 8 m/s; the test asserts
  that. The standstill sweep below is unchanged by the new gate: the car stays
  under 5 m/s for the whole 1 s hold.

### Smoother activation (2026-10-26)

Feel report: the pivot "activates quite suddenly". The yaw trace showed why:
after the 0.3 s dwell, yaw acceleration jumped from about 1.6 to 11 rad/s^2
within 0.15 s, because engagement was a fixed 0.08 s exponential driving a
stiff yaw controller. Now:

- `drive.pivotEngageSec` (default 0.25 s, range 0.02 to 0.6) is the time
  constant of the engagement filter, and everything the pivot does (yaw
  torque target, front-axle hold, tail loosening on the way in) follows a
  smoothstep of it, so the takeover starts with zero slope and finishes flat.
- Releasing is unchanged (filter 0.1 s, yaw damping 0.15 s, tail regrip 0.05 s).
- `?feel` has a "Pivot ease-in (high = smoother)" slider. The player chose 10
  (0.45 s) after trying 5 (0.25 s) and it is now the `?feel` default; the plain
  tuning default `pivotEngageSec` stays 0.25 s.

Onset jolt = largest yaw acceleration between the end of the dwell and 0.8 s
(`onsetPeakYawAccel` from the pivot routine), full strength:

| Ease-in slider | engage time | onset jolt (rad/s^2) | heading at release | peak yaw (rad/s) |
|---|---|---|---|---|
| 0 | 0.05 s | 18.0 | 122 deg | 3.43 |
| 2.5 | 0.15 s | 9.6 | 105 deg | 3.35 |
| 5 (code default) | 0.25 s | 6.5 | 88 deg | 3.15 |
| 7.5 | 0.35 s | 4.7 | 75 deg | 2.84 |
| **10 (`?feel` default)** | **0.45 s** | **3.8** | **65 deg** | **2.50** |

The trade-off is real: a gentler takeover turns less in a fixed 1 s hold
(88 deg at the default against 117 deg when it was abrupt). Raise
`pivotYawRate` or lower the ease-in if you want the rotation back.

Release is not smoothed yet: the yaw falls from 3.4 to 0.7 rad/s in about a
quarter of a second after the steer lets go (about -19 rad/s^2). Say if that
should be eased too.

### Pivot routine sweep (`makePivotTurnRoutine`), default ease-in 0.25 s

From standstill: 1 s full steer + throttle, then steer released with throttle
held, 3 s more. Headings positive in the steer direction.

| Pivot slider | pivotTurn | heading at release | +1 s | overshoot | final | time to 15 m/s | peak yaw (rad/s) | front axle 0.5 / 1.0 s (m/s) | ground speed 1 / 2 / 3 / 4 s (m/s) |
|---|---|---|---|---|---|---|---|---|---|
| 0 | 0 (off) | 43° | 48° | 5° | 48° | 1.03 s | 1.25 | 4.1 / 6.9 | 6.5 / 14.8 / 21.1 / 26.3 |
| 2.5 | 0.25 | 38° | 41° | 3° | 41° | 1.23 s | 0.95 | 4.0 / 5.0 | 4.6 / 13.3 / 19.9 / 25.4 |
| 5 | 0.50 | 48° | 52° | 3° | 52° | 1.28 s | 1.36 | 4.1 / 4.6 | 4.0 / 12.9 / 19.6 / 25.1 |
| 7.5 | 0.75 | 66° | 72° | 6° | 72° | 1.37 s | 2.09 | 4.2 / 4.0 | 3.1 / 12.2 / 19.0 / 24.7 |
| 10 | 1.00 | 88° | 102° | 14° | 102° | 1.58 s | 3.15 | 4.3 / 3.2 | 2.5 / 10.4 / 17.8 / 23.6 |

Reading it:
- Full strength turns 88° in the 1 s hold (2.0x the unassisted 43°), holds
  the front axle to 3.2 m/s, and carries on only 14° after the steer lets go.
- The yaw rate peaks at 3.15 rad/s, short of the 4 rad/s target: the rear
  tyres and the front pin limit it. Raise `pivotYawRate` for more.
- The price is exit speed: time to 15 m/s along the new heading goes from
  1.03 s to 1.58 s, because the car spent the hold turning on the spot.
- The lowest settings (0.25 and 0.5) turn up to 5° LESS than off in the
  hold: the front hold costs some speed and the small, late rotation boost
  doesn't repay it. From 0.75 up it clearly helps.
