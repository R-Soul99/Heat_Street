# Spec: Slide-exit handling and handling-feel tuning (Heat Street)

Hand this file to Claude Code (GSD workflow). It is self-contained.

## Goal

After a slide (handbrake, power-oversteer, flick), the car **bogs down** instead of surging out of the slide. Fix that, make rear-grip transitions smooth, and remove a few places where the `?feel` sliders secretly affect each other. The player wants the *illusion* of physics, not strict realism. Fun and predictability beat fidelity.

## Constraints (do not violate)

- Layering: `core/` is pure (no three, no Rapier, no DOM, no clock). `physics/` may import Rapier and `core/`, never three. `tests/layering.test.ts` enforces this.
- Determinism: everything must be a pure function of the input tape and fixed `DT`. Any new per-vehicle state must be reset in `resetPose`.
- RWD must stay bitwise identical when new features are off: new tuning fields default to values that add no extra Rapier calls and no numeric change. `tests/vehicle-drivetrain.test.ts` ("explicit RWD share is bitwise identical") and the 0-60 gate must still pass.
- Every new tuning field needs: an entry in `VehicleTuning`, `defaultTuning()`, `TUNING_RANGES`, and a doc comment in the existing `[MEASURED]` / `[TUNED]` style. `clampTuning` and `parseSavedTuning` must handle it (old saved blobs lack the field and must fall back to the default).
- Impulses only (`applyImpulse` / `applyTorqueImpulse`), never persistent forces.
- There may be a stale duplicate of `vehicle-tuning.ts` (an older version without `topSpeedMs`, `flickGain` etc.). Edit only the real one under `src/core/`.

## Diagnosis so far (from code reading, not yet measured)

1. **Traction-circle saturation in slides.** Estimated static load per rear wheel is about 3.4 kN (1390 kg), friction limit about 5.8 kN at `frictionSlip` 1.7, and engine force is 4.8 kN per wheel at gear multiplier 1.0 (about 8 kN in 1st). Rapier scales forward and side impulses down together once combined demand exceeds the circle. During slide exit the rear wheels spend the circle cancelling lateral velocity, so little drive force gets through. Raising the Acceleration slider cannot fix this. This is the same collapse already found and worked around for FWD with a chassis impulse (step 5b in `vehicle.ts`).
2. **Rear grip snaps back in one tick.** `rearSfs` goes from the handbrake/blend value to `rearSideFriction` instantly on release or lift. The sudden side impulse deletes lateral velocity as friction loss, not forward motion, so speed drops right as the slide ends. Only the flick has any smoothing.
3. **Cross-coupling in the sliders** (to verify, not assume):
   - `lockScale` multiplies both the power-oversteer blend and the flick blend, so the *Steering at speed* slider (via `highSpeedSteerFraction`) also changes how loose the tail gets at speed. A code comment says the coupling is deliberate (blend follows real wheel angle), so measure first, then decide.
   - The *Rear looseness* slider maps `rearSideFriction` down to 0.8x of base (about 0.224). An earlier measurement found the 90 mph steer-pulse routine diverges at 0.20 to 0.26 and settles at 0.28 (measured at `frictionSlip` 1.5 and front 1.35, not the current 1.7). Top speed is now about 107 mph, so the top half of that slider may be unstable at speed.
   - The *Grip* slider scales `frictionSlip` 0.6x to 1.0x below 5 but only 1.0x to 1.12x above 5. This looks deliberate (above about 1.8 roll and ramp landings fail the gates), so do not change it. Just note that the slider has little range above 5.

## Tasks (do in this order; stop at the decision gates)

### Task 1: Diagnostic telemetry (no behaviour change)

- Add a scripted telemetry routine in `src/physics/telemetry/routines.ts`, e.g. `slide-exit`: build speed to about 45 mph, steer into a corner, pull the handbrake for about 0.5 s, release it with throttle held at 1.0 and steer easing to neutral, run for about 3 s more.
- Log per tick: `groundSpeedMs`, `forwardSpeedMs`, `slipAngleRad`, yaw rate (`angvel.y`), effective rear side friction, and which term is dominant (handbrake / power-oversteer / flick).
- Report: (a) ground-speed drop across the regrip, (b) forward acceleration while slip is above 10 degrees at full throttle, (c) time from release to slip below 5 degrees.
- Surface the effective rear grip and dominant term in the `?feel` panel as read-only readouts, if cheap.
- Record the baseline numbers in the commit message or a doc comment. Everything below is judged against them.

**Decision gate:** if ground speed drops sharply at regrip, do Task 3 first (scrub). If speed holds but forward acceleration is low while slip is above 10 degrees, Task 2 is the main fix. Expect both.

### Task 2: Slip-gated slide surge

Add `drive.slideSurge` (0..1, default 0 = off, range step 0.05). In `physics/vehicle.ts`, after step 5b, add a heading-direction drive impulse that exists only while the car is sliding:

```ts
// slip from this tick's lateral/forward speed (reuse `right`, `forward`, `linvel`)
const right = rotateVec(q, 1, 0, 0);
const lat = linvel.x * right.x + linvel.y * right.y + linvel.z * right.z;
const slip = Math.atan2(Math.abs(lat), Math.max(forwardSpeedMs, 0.1));
const gate =
  smoothstep(0.14, 0.45, slip) *               // about 8 to 26 degrees
  clamp((Math.hypot(lv.x, lv.z) - 4) / 6, 0, 1);
const rearContacts = (vc.wheelIsInContact(RL) ? 1 : 0) + (vc.wheelIsInContact(RR) ? 1 : 0);
if (t.drive.slideSurge > 0 && gate > 0 && rearContacts > 0 && engineForce < 0) {
  const thrust = -engineForce * rearContacts * t.drive.slideSurge * gate; // N, forward
  body.applyImpulse(
    { x: forward.x * thrust * DT, y: forward.y * thrust * DT, z: forward.z * thrust * DT },
    true,
  );
}
```

Notes:
- `engineForce` is negative for forward and already includes gear curve, limiter, and the zero-while-braking rule, so the surge fades to nothing at top speed and under brake.
- Add a local `smoothstep` helper (none exists in the file).
- Check the sign convention against `frontDriveThrustN` in `core/vehicle-class.ts` (not reviewed here). Add a unit test that a sliding car with `slideSurge > 0` gains more forward speed over 1 s than with 0, and that a straight-line car (slip about 0) is unaffected (0-60 unchanged).
- Add to `?feel` as a new slider *Slide-exit surge* in `core/feel.ts` (`FEEL_DEFAULTS`, `FEEL_CONTROLS`, `applyFeel`, `parseSavedFeel` all need updating). Map 0..10 to roughly 0..0.6. Default the slider so base handling is unchanged. Open decision for the developer: hide the *Weight-shift flick* slider from the panel (keep it in tuning) to keep the panel small.

### Task 3: Smoothed rear-grip transitions

Add `drive.rearGripRecoverySec` (default 0 = off, range roughly 0..0.6). Keep a per-vehicle `rearSfsSmoothed`, reset in `resetPose`. Slew-limit the final rear side friction before the two `setWheelSideFrictionStiffness` calls: loosen fast (about 0.05 s), regrip slowly (`rearGripRecoverySec`).

```ts
// rename current rearSfs -> rearSfsTarget
const tau = rearSfsTarget < rearSfsSmoothed ? 0.05 : Math.max(0.01, t.drive.rearGripRecoverySec);
rearSfsSmoothed += (rearSfsTarget - rearSfsSmoothed) * (1 - Math.exp(-DT / tau));
```

- Only engage when `rearGripRecoverySec > 0`, so the default path stays numerically unchanged.
- Initialise `rearSfsSmoothed` to `t.wheels.rearSideFriction`.
- Compose the surface `rearLateralGrip` multiplier after smoothing, as today.
- Sweep 0, 0.15, 0.25, 0.4 s on the `slide-exit` routine. Pick the smallest value that removes the regrip speed drop. Make it the default only if all existing telemetry gates still pass or are consciously re-baselined.
- If regrip still scrubs speed, consider converting a fraction of lateral velocity into forward velocity during the recovery. Propose it, do not implement without approval.

### Task 4: Slider coupling and stability (measure, then decide)

- Sweep *Steering at speed* with *Rear looseness* fixed at the `slide-exit` routine and report slip-angle and slide-duration changes. If the effect is large, propose either a compensation in `feel.ts` or a decoupled speed fade for the oversteer blend. Do not change it silently, since the code comment says the coupling is intentional.
- Re-run the 90 mph steer-pulse stability routine at current `frictionSlip` 1.7 / front 1.35 for `rearSideFriction` 0.20 to 0.30. If values below 0.28 still diverge, either raise the floor of the *Rear looseness* mapping in `feel.ts` (`anchored(f.looseness, 1.07, 1, 0.8)`) to keep rear friction at or above the stable minimum, or fade the extra looseness out with speed.

## Acceptance criteria

- With `slideSurge` and `rearGripRecoverySec` at 0, all existing tests pass unchanged (including the bitwise-RWD test, 0-60 gate, roll-assist stability gate, layering test).
- New `slide-exit` routine: after the handbrake is released with full throttle, ground speed does not fall during regrip (monotonic non-decreasing, or a drop under a threshold agreed from the Task 1 baseline), and slip is back under 5 degrees within about the baseline time or better.
- Roll-assist gate: no routine exceeds 15 degrees of tilt with the new defaults.
- No new feel-panel slider changes more than one behaviour (verify with sweeps, report results).
- A short results note lists baseline vs final numbers for each routine, so the developer can tune by numbers rather than by feel.

## Out of scope

- Replacing Rapier's tyre model, or adding a custom per-axle slip-angle curve (revisit only if Tasks 2 and 3 are not enough).
- Closed-loop drift assist (hold a target slip angle). Possible later phase once the above lands.
- Changing the *Grip* slider's upper range or `frictionSlip` (limited by roll and ramp-landing gates).
- Camera and visual exaggeration of slides (separate task: rotate the mesh more than the body, earlier skid marks, camera led by velocity direction).

## Open questions for the developer

- Hide the *Weight-shift flick* slider from the panel to make room for *Slide-exit surge*?
- Should `rearGripRecoverySec` become a non-zero default once proven, or stay opt-in via the feel panel?
