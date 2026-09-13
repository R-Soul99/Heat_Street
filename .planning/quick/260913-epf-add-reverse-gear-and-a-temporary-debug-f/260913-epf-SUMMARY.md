---
phase: quick
plan: 260913-epf
subsystem: vehicle-physics, debug-tooling, camera
tags: [rapier, vehicle-tuning, three, debug-gate, occlusion, camera-rig]

# Dependency graph
requires:
  - phase: 03-surfaces-helicopter-camera
    provides: DENSE_BUILDINGS canyon test scene, CAM-04 occlusion mitigation (fade/steepen/off), the permanent helicopter CameraRig
provides:
  - Reverse gear on the player vehicle (brake held at rest/low speed drives backward)
  - A temporary, ?debug-only mouse-drag free-look orbit camera (KeyF) that never touches the shipping helicopter rig
  - A definitive, arithmetic-backed verdict on whether the steepen occlusion arm's near-zero density in the DENSE_BUILDINGS canyon is a bug
  - Removal of the uncommitted TEMP diagnostic console-logging scaffolding in src/main.ts
affects: [phase-03-surfaces-helicopter-camera plan 03-12 human playtest]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Reverse gear derived from physics state (chassis-forward dot linvel), never a new InputFrame field — keeps the recorded-tape contract frozen"
    - "Temporary debug camera overrides write camera.position/quaternion strictly after the permanent rig has written and been read for the frame, never touching the rig itself"

key-files:
  created:
    - src/debug/free-look-camera.ts
  modified:
    - src/core/vehicle-tuning.ts
    - src/physics/vehicle.ts
    - src/debug/tuning-panel.ts
    - tests/vehicle.test.ts
    - tests/occlusion.test.ts
    - src/main.ts

key-decisions:
  - "reverseEngageSpeedMs defaults to 0.1 m/s, strictly below telemetry's STOP_SPEED_MS (0.15) so the 60-0 braking routine provably terminates before reverse can engage"
  - "Reverse is derived from this tick's chassis-forward speed rather than a new InputFrame field, preserving the frozen tape contract tests/determinism.test.ts depends on"
  - "Free-look is a gate-free factory (createTuningPanel/createTelemetryHud convention) constructed only under DEBUG_ENABLED at the composition root"
  - "Steepen density verdict: BUG — the fan's outer rays overshoot the DENSE_BUILDINGS corridor's 5 m half-width and land embedded in a building; FrontSide-only building materials silently drop that hit as a back-face exit"
  - "Task 4 branch (a) taken: deleted the TEMP diagnostic scaffolding outright rather than promoting a live readout — Task 3's written, test-anchored verdict already answers the question a live readout would only restate in numbers"

patterns-established:
  - "A debug camera override that must coexist with a damped CameraRig restores the rig's saved pose before rig.update() and re-saves the rig's fresh pose after occlusion reads it, so the rig's own damping state is never poisoned by the override"

requirements-completed: []

# Metrics
duration: ~15min
completed: 2026-09-13
---

# Quick Task 260913-epf: Reverse gear + temporary debug free-look camera Summary

**Reverse gear wired through VehicleTuning (brake at rest drives backward), a `?debug`-only mouse-drag orbit camera that never touches the permanent helicopter rig, and a test-anchored BUG verdict on the steepen occlusion arm's near-zero canyon density.**

## Performance

- **Duration:** ~15 min
- **Tasks:** 4 completed
- **Files modified:** 7 (6 modified, 1 created)

## Accomplishments

- Holding brake at rest (or below 0.1 m/s forward speed, in either direction) now drives the car backward with proportional force from `frame.brake`; braking above that threshold is byte-for-byte unchanged from before this plan
- A hostile `localStorage` tuning blob can no longer push a non-finite or absurd reverse force into Rapier — both new leaves are covered by `TUNING_RANGES.drive` and `clampTuning`/`parseSavedTuning`
- `?debug` now exposes `KeyF`: a mouse-drag orbit camera that lets the developer fly around and inspect the CAM-04 occlusion mitigation from any angle, while the occlusion controller keeps computing against the real, shipping helicopter-rig pose
- Definitively answered the open steepen-arm question with arithmetic, not guesswork: density in the `DENSE_BUILDINGS` canyon measures 0/5, not merely low — a genuine measurement bug, not a subtle-but-real signal
- `src/main.ts` is free of the uncommitted TEMP diagnostic console logging carried over from the prior session

## Task Commits

Each task was committed atomically:

1. **Task 1: Reverse gear through VehicleTuning** - `9cf3efe` (feat)
2. **Task 2: Temporary ?debug free-look orbit override** - `d8ff0d3` (feat)
3. **Task 3: Investigate the steepen arm — report, do not fix** - `53efe88` (test)
4. **Task 4: Retire the TEMP diagnostic scaffolding** - `a5166d0` (chore)

_No TDD gate applies to this plan — none of its tasks carry `tdd="true"`._

## Files Created/Modified

- `src/core/vehicle-tuning.ts` - Adds `drive.reverseEngineForcePerRearWheel` (1500 N, `[ASSUMED]`) and `drive.reverseEngageSpeedMs` (0.1 m/s, `[ASSUMED]`), with matching `TUNING_RANGES` entries
- `src/physics/vehicle.ts` - `tick()` derives `forwardSpeedMs` from chassis rotation + linvel (no `sampleVehicle`, no `three` import) and branches engine force/brake impulse into a reverse path when brake is held below the engage threshold
- `src/debug/tuning-panel.ts` - Two new sliders in the Drive folder for the reverse leaves
- `tests/vehicle.test.ts` - New `describe` block covering every reverse behavior (at-rest, above-threshold unchanged, already-reversing, proportional-to-brake, hostile-blob clamping)
- `src/debug/free-look-camera.ts` (new) - Gate-free `createFreeLookCamera` factory: mouse-drag orbit around a target, restore/apply pose bracketing that never mutates the permanent `CameraRig`
- `src/main.ts` - Constructs `freeLook` under `DEBUG_ENABLED`, binds `KeyF`, wires `restoreRigPose()`/`apply()` into the render callback at the load-bearing points; removes the TEMP diagnostic scaffolding; `KeyO` restored to plain `occlusion.cycle()`
- `tests/occlusion.test.ts` - Permanent density-to-pitch anchor for `steepenPitchRad` at all five achievable 5-ray fan densities, with a comment naming the canyon this investigation was derived against

## Decisions Made

- `reverseEngageSpeedMs` default (0.1 m/s) is deliberately below `src/physics/telemetry/routines.ts`'s `STOP_SPEED_MS` (0.15 m/s) so the 60-0 braking telemetry routine provably terminates before reverse could ever engage mid-measurement.
- Reverse is derived from physics state (`forwardSpeedMs < reverseEngageSpeedMs` while braking) rather than a new `InputFrame` field, keeping the tape/determinism contract frozen.
- `reverseEngineForcePerRearWheel` default (1500 N) chosen as roughly 40% of the forward `engineForcePerRearWheel` default (3650 N) — reverse gear in a real car is materially lower-geared than any forward gear, so a docile creep force reads more correctly than acceleration parity.
- Free-look's `apply()` tracks the latest target position every call, even while disengaged, purely so `toggle()` (invoked from a keydown handler outside the render loop) has a target to seed yaw/pitch/distance from on first engage with no jump.
- Task 4's keep-or-delete decision: **deleted**, branch (a). Task 3's investigation already produced a definitive, test-anchored verdict — the SUMMARY and `tests/occlusion.test.ts` carry the finding permanently. A live density/pitch-bias readout would only restate in numbers what the 03-12 playtest can already see visually (the mitigation visibly does nothing in this canyon via the existing `O` key A/B/off cycle), and building one risks drifting into debugging the found bug itself, which this plan explicitly reserves as future, human-directed work.

## Steepen Arm Investigation — Verdict

**BUG: density under-reports in the `DENSE_BUILDINGS` canyon because the fan's outer rays originate embedded inside a building, and `src/render/surface-view.ts`'s `FrontSide`-only building material silently discards that hit as a back-face exit.**

Worked arithmetic, against the canyon's actual geometry (`src/physics/surface-scene.ts`):

- **Fan-ray geometry.** `fanOffsetsRad(5)` yields offsets at exactly `-30°, -15°, 0°, +15°, +30°`. At the low-speed framing (altitude 14 m, distance 16 m), `computeOffset`'s `horizontalDistM` at zero pitch bias equals `distanceM` exactly (`cos(atan2(alt, dist)) = dist / hypot(alt, dist)`), so the camera's XZ offset from the target has magnitude **16 m**. `occludedFanRayCount` rotates that 16 m offset by each fan angle about the target, so each ray's origin lands `16 * sin(θ)` lateral of the car: `0 m` (center), `±4.14 m` (±15°), `±8.0 m` (±30°).
- **The corridor is only 10 m wide** (`x ∈ [-36, -26]`, i.e. a 5 m half-width from centerline). `8.0 m` of lateral offset always exceeds that 5 m half-width regardless of where the car sits inside the corridor — so **at least one of the two ±30° rays is always embedded inside a building** for any car position, and at extreme positions (car close to one wall) a ±15° ray can be embedded too, as worked for a car parked 1 m from the row-1 wall (`x = -35`): the `-15°` ray then also lands at `x = -39.14`, inside row 1's box.
- **The front-face-culling question.** `src/render/surface-view.ts`'s building material uses THREE's default `side` (front faces only). A fan ray whose origin sits inside a box, travelling outward toward the target, crosses the box's boundary face moving in the SAME general direction as that face's outward normal — the raycaster classifies this as a back-face hit and `intersectObjects` returns nothing for it. The ray then continues through the (now unobstructed, since the corridor itself contains no geometry) remaining segment to the target with zero registered hits.
- **Every ray whose origin stays within the 10 m corridor genuinely cannot cross a building at all** — worked by convexity: if both the ray's origin and its target (the car, always inside the corridor) have `x ∈ [-36, -26]`, the entire straight-line segment's `x` stays inside that interval too (checked explicitly for the `0°`/`±15°` rays at both a centered and a near-wall car position), so it never reaches either building row's boundary. These rays correctly report zero hits — there is genuinely nothing in their path.
- **Combined result:** every one of the 5 rays reports zero hits in every car position tried (centered in the corridor, and 1 m from one wall) — three because they are genuinely unobstructed, and up to two because their embedded origin is invisible to the `FrontSide`-only raycast. Density therefore measures **exactly 0/5**, not merely low, in this canyon, even though the player is visibly boxed in by 28 m tall buildings 5–9 m away on either side.
- **The smoothstep squash, worked at all 5 achievable densities** (`steepenPitchRad(41°, 78°, d)`, now permanently anchored in `tests/occlusion.test.ts`): `1/5 → smoothstep(0.2) = 0.104 → 44.848°` (+3.848° from base); `2/5 → 0.352 → 54.024°`; `3/5 → 0.648 → 64.976°`; `4/5 → 0.896 → 74.152°`; `5/5 → 1 → 78°` exactly. The curve itself is NOT the problem — a real 1/5 density would already be a noticeable ~3.85° pitch change, and higher densities produce large, clearly perceptible swings. The bug is entirely upstream, in density measurement always landing at 0, never in how that density is converted to pitch.
- **The bias-path mismatch is negligible.** `updateSteepen` biases against `tuning.occlusion.basePitchDeg` (a fixed 41°), while the rig's real geometric base pitch (`atan2(altitudeM, distanceM)`) is 41.19° at low framing and 40.91° at high framing — at most a ~0.2° discrepancy, two orders of magnitude smaller than the pitch changes the mitigation is meant to produce. Not material.

**Plan 03-12's mitigation choice (fade vs. steepen vs. off) remains open and unresolved by this work.** This investigation only establishes WHY steepen currently reads as doing nothing in the `DENSE_BUILDINGS` canyon specifically — it does not fix the underlying fan-ray/front-face-culling limitation (explicitly out of scope per the plan's hard constraints), and it does not touch `src/core/camera-tuning.ts`, `src/render/camera/occlusion.ts`, `occlusion-controller.ts`, or the boot mitigation arm (still `"fade"`). The human playtest session still needs to make the real fade/steepen/off call, now with a documented, test-anchored understanding of one specific arm's behavior in one specific test canyon.

## Deviations from Plan

None — plan executed exactly as written. No Rule 1-4 auto-fixes were needed; the only judgment calls (Task 3's verdict and Task 4's keep-or-delete branch) were both explicitly reserved for the executor by the plan itself and are documented above.

## Issues Encountered

The worktree had no `node_modules` (gitignored, as expected for a fresh worktree) — restored via `npm ci` (matches `package-lock.json` exactly, no `package.json` change) before any test/typecheck command could run.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

Plan 03-12's human playtest is now unblocked on all three fronts this quick task existed to address: the developer can reverse out of the `DENSE_BUILDINGS` canyon without reloading, can fly a free-look camera around to inspect CAM-04 from any angle without disturbing the shipping rig or the mitigation's own inputs, and has a written, arithmetic-backed answer to the steepen-arm question instead of an open mystery. The actual fade/steepen/off mitigation decision itself is still reserved for that human session, as designed.

---
*Phase: quick*
*Completed: 2026-09-13*

## Self-Check: PASSED

All 8 claimed files found on disk; all 4 task commit hashes (`9cf3efe`, `d8ff0d3`, `53efe88`, `a5166d0`) found in `git log --oneline --all`.
