# Slide-exit results (2026-10-23)

Work from `prompts/slide-exit-handling-spec.md`, branch `feel-testing`. Numbers
come from the `slide-exit` telemetry routine (`makeSlideExitRoutine` in
`src/physics/telemetry/routines.ts`): 45 mph, 0.25 s coasting turn-in, 0.3 s
handbrake, then full throttle with counter-steer against the slip angle.

## What was actually wrong

1. **Counter-steering under power freed the tail.** The power-oversteer blend
   is keyed on `|steer|`, so steering AGAINST the slide (catching it) loosened
   the rear further. Baseline: the car spun to ~130 deg of slip and never
   recovered. Not in the spec's diagnosis; found by the Task 1 trace.
2. **Rear grip snapped back in one tick**, scrubbing speed as the slide ended
   (spec diagnosis 2, confirmed).
3. **Traction-circle saturation** (spec diagnosis 1): little drive got through
   while sliding. Addressed with the slip-gated surge.

## Results (slide-exit routine, default tuning)

| | Baseline | + counter-steer fade | + regrip 0.15 s | + surge 0.3 (shipped) |
|---|---|---|---|---|
| Speed drawdown (m/s) | 17.1 (spun) | 12.0 | 9.1 | 7.5 |
| Recovery to <5 deg (s) | 2.5 (spun, ~130 deg) | 1.10 | 0.95 | 0.95 |
| Ground speed at +1.5 s (m/s) | n/a (spun) | 9.8 | 13.7 | 15.1 |
| Ground speed at +3 s (m/s) | 6.7 | 20.4 | 23.2 | 24.2 |

Regrip sweep (surge 0): 0 s -> 9.8 m/s at +1.5 s; 0.15 s -> 13.7; 0.25 s -> 13.6;
0.4 s -> 13.3. 0.15 s is the smallest value that removes the scrub.

## Shipped defaults

- `drive.rearGripRecoverySec` 0.15 (opt-in knob, now on by default).
- `drive.slideSurge` 0.3.
- Counter-steer fade: always on, active only above ~6 deg of slip while
  steering against it.
- Feel panel: *Slide-exit surge* and *Slide regrip* sliders (5 = these defaults).

## Slider coupling (Task 4, measured, no change made)

Steering-at-speed 0 -> 10 moves the slide by 0.6 m/s (speed at +1.5 s) and
0.05 s of recovery. Rear-looseness 0 -> 10 moves it by 0.2 m/s and 0.03 s.
Both are negligible, so the intentional `lockScale` coupling stays.

## 90 mph stability (Task 4)

`highSpeedPulse` had been reporting Infinity at every setting. Cause: the
telemetry ground strip was 120 m wide and the car drove off its side edge
during the settle (slip never exceeded 2.2 deg). Strip widened to 1200 m.
Now measured, max post-pulse slip vs `rearSideFriction`:

| rearSideFriction | 0.12 | 0.16 | 0.20 | 0.224 | 0.24 | 0.26 | 0.28 | 0.30 |
|---|---|---|---|---|---|---|---|---|
| slip (deg) | 18.7 | 11.6 | 4.9 | 3.5 | 3.0 | 2.5 | 2.2 | 1.9 |

The whole *Rear looseness* range (rear friction 0.224 at 10) stays under
4.1 deg at 90 mph, so the slider floor is unchanged. The older "needs 0.28"
finding predates speed-sensitive steering and no longer applies.

## Still failing (intentionally stale bands)

accel (3.7 s vs 6-7 s), brake (107 ft vs 110-135), skidpad (1.5 g vs
0.75-1.05), ramp roll (17.7 deg vs 15), and `runAllRoutines` (their sum).
`highSpeedPulse` now passes.
