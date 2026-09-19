---
phase: quick
plan: 260919-cam
type: execute
wave: 1
depends_on: []
files_modified:
  - src/render/camera/camera-math.ts
  - src/core/camera-tuning.ts
  - tests/camera-tuning.test.ts
  - .planning/STATE.md
autonomous: false
requirements: []

user_setup: []

must_haves:
  truths:
    - "The permanent helicopter rig's baseline pitch (atan(altitudeM/distanceM)) sits in the 75-85 degree band at both ends of the speed curve, not ~41 degrees"
    - "occlusion.basePitchDeg stays aligned (within ~1 degree) with the new geometric baseline pitch"
    - "occlusion.maxPitchDeg stays strictly above occlusion.basePitchDeg so the steepen mitigation still has headroom toward vertical"
    - "The speed-curve/damping/occlusion MECHANICS are unchanged — only framing.*AltitudeM/*DistanceM and occlusion.basePitchDeg/maxPitchDeg values move"
    - "camera-math.ts's stale 'high ANGLE, not a top-down' doc comment no longer contradicts the shipped near-overhead framing"
    - "tests/camera-tuning.test.ts's pitch-separation assertions test the NEW 75-85 degree target, not deleted or left silently passing against the old target"
  artifacts:
    - path: "src/core/camera-tuning.ts"
      provides: "framing altitude/distance values retuned to a constant ~79.9 degree pitch; occlusion.basePitchDeg/maxPitchDeg raised to 80/88"
      contains: "basePitchDeg: 80"
    - path: "tests/camera-tuning.test.ts"
      provides: "an explicit 75-85 degree band assertion plus alignment/headroom assertions for the occlusion pitch fields"
  key_links:
    - from: "src/core/camera-tuning.ts"
      to: "src/render/camera/occlusion-controller.ts"
      via: "tuning.occlusion.basePitchDeg / tuning.occlusion.maxPitchDeg read live, no hardcoded assumption of their old values"
      pattern: "basePitchDeg"
---

<objective>
Retune the permanent helicopter camera rig from a ~41 degree "high chase-cam angle" to a
~75-85 degree near-overhead "news helicopter" pitch, per the developer's direction: the point
of the permanent cam is seeing the surrounding area and planning routes, not a low chase angle.

The occlusion system's `steepen` mitigation already proves a near-overhead pitch (78 degrees)
works mechanically, so this is a values-only retune of the baseline, not new mechanics.

NON-GOALS (explicit): do NOT change the speed-curve/damping/occlusion MECHANISM (no new fields,
no new interpolation shape). Do NOT touch `chaseFallback` (D-12's debug fallback rig) — it
exists to reproduce Phase 2 plan 02-10's signed-off feel-session view byte-for-byte and is
intentionally decoupled from the permanent rig's angle. Do NOT touch
`tests/occlusion.test.ts`'s DENSE_BUILDINGS density-to-pitch anchor (quick task 260913-epf) —
it hardcodes its own literal degree inputs to document a historical investigation snapshot and
does not read live tuning, so it is correctly out of scope and unaffected by this retune.
</objective>

<context>
@CLAUDE.md
@.planning/STATE.md

@src/render/camera/camera-math.ts
@src/core/camera-tuning.ts
@tests/camera-tuning.test.ts
@src/render/camera/occlusion-controller.ts

<interfaces>
From `src/core/camera-tuning.ts` (before this plan) —
  framing: { lowAltitudeM: 14, lowDistanceM: 16, lowFovDeg: 48,
             highAltitudeM: 26, highDistanceM: 30, highFovDeg: 62, ... }
  occlusion: { basePitchDeg: 41, maxPitchDeg: 78, ... }
Both `low` and `high` legs held pitch (`atan(altitudeM/distanceM)`) near-constant at ~41 degrees
(41.19 deg low, 40.91 deg high) — a DELIBERATE property (see `CameraTuning.framing.highFovDeg`'s
own doc comment and `tests/camera-tuning.test.ts`'s "near-constant pitch" test), not an accident.
This plan preserves that "held constant across the speed curve" property while moving the target
angle to 75-85 degrees.

From `src/render/camera/occlusion-controller.ts:108-126` — `basePitchRad`/`maxPitchRad` are read
live from `tuning.occlusion.{basePitchDeg,maxPitchDeg}` every call; nothing in this file
hardcodes their old values, so retuning them requires no change to occlusion-controller.ts or
occlusion.ts.

From `CAMERA_TUNING_RANGES.framing` (before this plan): `highAltitudeM: { min: 3, max: 80 }` —
too narrow for a target altitude above 80m; widened as part of this plan.
</interfaces>
</context>

<tasks>

<task type="auto">
  <name>Task 1: Retune framing altitude/distance and align occlusion pitch fields</name>
  <files>src/render/camera/camera-math.ts, src/core/camera-tuning.ts, tests/camera-tuning.test.ts</files>
  <action>
    Pick a low:high altitude/distance pair that (a) holds pitch constant across the whole speed
    curve (not just close at the two endpoints) and (b) lands the pitch in 75-85 degrees, with
    materially more absolute altitude than the old 14-26m range for genuine area visibility.

    Use a fixed altitude:distance RATIO and scale both `low*` and `high*` by the same factor, so
    `atan(altitude/distance)` is IDENTICAL at every point `framingForSpeed` interpolates, not
    merely similar at the two ends: `lowAltitudeM: 45, lowDistanceM: 8` (ratio 5.625, pitch
    ~79.9 deg), `highAltitudeM: 90, highDistanceM: 16` (same 5.625 ratio, same ~79.9 deg) — an
    exact 2x scale-up between low and high, closely matching the old curve's own ~1.86x/1.875x
    scale-up. Leave `lowFovDeg`/`highFovDeg` untouched — the resulting larger 3D camera-to-target
    distance (`hypot(altitude, distance)`, ~46m to ~91m vs. the old ~21m to ~40m) making the car
    read smaller on screen is the INTENDED effect of a genuine area/route-visibility helicopter
    shot, not a regression to compensate for.

    Widen `CAMERA_TUNING_RANGES.framing.{lowAltitudeM,highAltitudeM}.max` from 80 to 120 so the
    new 90m default (and headroom for the developer's own future tuning) fits inside its range —
    required, not cosmetic: `clampCameraTuning`/`parseSavedCameraTuning` both clamp any
    out-of-range leaf, so a default outside its own declared range would be silently clamped away
    on the very next load/save round-trip.

    Set `occlusion.basePitchDeg` to 80 (aligned to the new geometric baseline, same "round number
    close to the geometric value" convention the old 41 already used against 41.19/40.91) and
    `occlusion.maxPitchDeg` to 88 (inside its existing 10-89 range, strictly above the new
    `basePitchDeg` so `steepen` still has headroom toward vertical — it is now the last ~8 degrees
    to true overhead rather than the old 41->78 degree swing, which is expected: the baseline
    itself is now already near-overhead).

    Update `CameraTuning.framing.highFovDeg`'s doc comment (the one carrying the "SC4 separation
    proof" arithmetic) and `defaultCameraTuning()`'s inline comment above `lowAltitudeM` to state
    the new numbers: 7.0 degree FOV / 22.5m altitude separation between 60-110mph, and a CONSTANT
    ~79.9 degree pitch across the whole curve (not "roughly 41 degrees at both ends"). Update the
    `basePitchDeg`/`maxPitchDeg` field doc comments to state the new alignment/headroom
    relationship in place of the old 41/78 framing.

    Update `camera-math.ts`'s `CameraSpeedCurve` doc comment: it currently states the rig is "a
    high ANGLE, not a top-down" — no longer accurate framing at ~80 degrees. Restate it as a
    near-overhead "news chopper" shot (still not a literal fixed top-down, since `distanceM` is
    still nonzero and pitch could still in principle drift if the two legs were ever detuned
    independently) while keeping the surrounding sentence's actual point (both legs must scale
    together or pitch drifts with speed) intact.

    In `tests/camera-tuning.test.ts`, ADD an explicit assertion that both `lowPitchDeg` and
    `highPitchDeg` fall inside [75, 85] (do not just leave the existing "differ by less than 3
    degrees" test as the only signal — that test alone would pass just as well at the OLD ~41
    degree target, so it does not anchor the new intent). Keep the existing near-constant-pitch
    test as-is (it becomes a near-zero-drift assertion at the new target, which is a stronger,
    strictly better proof than before, not a weaker one). Add two more small tests: one asserting
    `occlusion.basePitchDeg` stays within 1 degree of the geometric `atan(lowAltitudeM/
    lowDistanceM)` pitch, and one asserting `occlusion.maxPitchDeg > occlusion.basePitchDeg`, so a
    future value-only retune of either side cannot silently drift them apart without a test
    failure.
  </action>
  <verify>
    <automated>cd /home/user/Heat_Street && npm run typecheck && npx vitest run && npx biome check src/render/camera/camera-math.ts src/core/camera-tuning.ts tests/camera-tuning.test.ts</automated>
  </verify>
  <done>`defaultCameraTuning()`'s framing pitch is a constant ~79.9 degrees across the whole speed curve; `occlusion.basePitchDeg`/`maxPitchDeg` are 80/88; all doc comments describing the old ~41 degree/78 degree numbers are updated; the full test suite (857 tests) and scoped Biome check both pass clean.</done>
</task>

</tasks>

<verification>
1. `npm run typecheck` clean.
2. `npx vitest run` — full suite green (857 tests), including the new/updated `tests/camera-tuning.test.ts` assertions.
3. `npx biome check <this plan's 3 files>` clean (repo-wide `npm run lint` has a known pre-existing CRLF issue per `.planning/STATE.md`, unrelated to this plan).
4. `git diff --stat tests/occlusion.test.ts` shows no change — the DENSE_BUILDINGS anchor test is untouched, confirmed decoupled (hardcodes its own literal degree inputs).
5. `git diff --stat src/render/camera/occlusion-controller.ts src/render/camera/occlusion.ts` shows no change — mechanics untouched, only tuning values moved.
</verification>

<success_criteria>
- The permanent helicopter rig's baseline pitch is ~79.9 degrees, constant across the whole speed
  curve, inside the developer's requested 75-85 degree band.
- `occlusion.basePitchDeg`/`maxPitchDeg` (80/88) stay aligned/headroomed against the new baseline.
- No change to `chaseFallback`, `occlusion-controller.ts`, `occlusion.ts`, or
  `tests/occlusion.test.ts`.
- Full test suite and scoped lint pass clean.
</success_criteria>

<output>
Create `.planning/quick/260919-cam-retune-helicopter-camera-to-near-overhead/260919-cam-SUMMARY.md` when done.
</output>
