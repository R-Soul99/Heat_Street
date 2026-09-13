---
phase: quick
plan: 260913-epf
type: execute
wave: 1
depends_on: []
files_modified:
  - src/core/vehicle-tuning.ts
  - src/physics/vehicle.ts
  - src/debug/tuning-panel.ts
  - src/debug/free-look-camera.ts
  - src/main.ts
  - src/render/camera/occlusion-controller.ts
  - tests/vehicle.test.ts
  - tests/occlusion.test.ts
autonomous: false
requirements: []

user_setup: []

must_haves:
  truths:
    - "Holding brake/down once the car has stopped drives it BACKWARD, so the developer can reverse out of the DENSE_BUILDINGS canyon without reloading the page"
    - "Tapping brake while moving forward still brakes exactly as before — the 60-0 braking telemetry routine still terminates and still lands inside its 110-135 ft gate"
    - "A corrupt or hand-edited localStorage tuning blob cannot push a non-finite or absurd reverse force into Rapier"
    - "With ?debug, one key engages a mouse-drag orbit camera and the same key returns the exact helicopter shot with no snap or drift"
    - "Without ?debug, zero free-look listeners are registered and the helicopter rig's behaviour is byte-for-byte unchanged"
    - "While free-look is engaged, the CAM-04 occlusion mitigation keeps computing against the SHIPPING rig pose, not the developer's flown-to pose"
    - "The developer has a written, evidence-backed answer to whether steepen computes a near-zero density in the canyon (bug) or a real density whose pitch change is simply subtle (not a bug)"
    - "src/main.ts contains no TEMP DIAGNOSTIC / remove-before-commit text"
  artifacts:
    - path: "src/core/vehicle-tuning.ts"
      provides: "reverseEngineForcePerRearWheel + reverseEngageSpeedMs defaults AND matching TUNING_RANGES entries"
      contains: "reverseEngineForcePerRearWheel"
    - path: "src/physics/vehicle.ts"
      provides: "Reverse branch in tick(), derived from chassis forward speed — no InputFrame shape change"
      contains: "reverseEngineForcePerRearWheel"
    - path: "src/debug/free-look-camera.ts"
      provides: "Temporary debug orbit override with restore/apply pose bracketing"
      exports: ["createFreeLookCamera"]
    - path: "tests/occlusion.test.ts"
      provides: "Node test anchoring the measured steepen pitch change at the canyon's real fan-ray density"
  key_links:
    - from: "src/physics/vehicle.ts"
      to: "t.drive.reverseEngineForcePerRearWheel"
      via: "engine force sign flip while brake held below reverseEngageSpeedMs"
      pattern: "reverseEngineForcePerRearWheel"
    - from: "src/main.ts"
      to: "src/debug/free-look-camera.ts"
      via: "restoreRigPose() before activeRig.update, apply() after occlusion.update"
      pattern: "restoreRigPose"
    - from: "src/core/vehicle-tuning.ts"
      to: "clampTuning / copyLeaves"
      via: "TUNING_RANGES.drive entries for both new leaves"
      pattern: "reverseEngageSpeedMs"
---

<objective>
Three small, self-contained additions that unblock the paused Phase 3 plan 03-12 manual
playtest, plus the cleanup of the uncommitted diagnostic scaffolding left in `src/main.ts`.

Purpose: the developer is currently stuck in the `DENSE_BUILDINGS` canyon with no way to
back out, cannot look at the CAM-04 occlusion mitigation from any angle other than the
fixed helicopter shot, and has an unanswered question about whether the `steepen` arm is
broken or merely subtle. All three block a judgement call that plan 03-12 reserves for a
human.

Output: reverse gear wired through `VehicleTuning`; a `?debug`-only, default-off orbit
camera override that never touches the permanent helicopter rig; a written finding on the
steepen arm backed by a permanent Node test; and a `src/main.ts` with no TEMP scaffolding.

NON-GOALS (explicit): do NOT retune any `occlusion` value in `src/core/camera-tuning.ts`.
Do NOT change which mitigation arm `src/main.ts` boots into. Do NOT edit anything under
`.planning/phases/03-surfaces-helicopter-camera/`. Plan 03-12 reserves the mitigation
choice for a human playtest; this plan hands that human better instruments, nothing more.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@CLAUDE.md
@.planning/STATE.md

@src/core/vehicle-tuning.ts
@src/physics/vehicle.ts
@src/main.ts
@src/render/camera/occlusion.ts
@src/render/camera/occlusion-controller.ts
@src/render/camera/occlusion-probe.ts
@src/render/camera/helicopter-camera.ts

<interfaces>
<!-- Contracts the executor needs. Extracted from the codebase — do not go hunting. -->

From `src/core/input-tape.ts` (via its consumers) — `InputFrame` is
`{ steer: number; throttle: number; brake: number; handbrake: boolean }`. This shape is
FROZEN by this plan: `tests/determinism.test.ts` and the recorded-tape machinery depend on
it. Reverse is derived from physics state inside `vehicle.ts`, never from a new input field.

From `src/physics/vehicle.ts` (current behaviour, the line this plan changes):
  const braking = frame.brake > 0;
  const engineForce = braking ? 0 : -frame.throttle * t.drive.engineForcePerRearWheel;
Forward is chassis-local -Z, so DRIVING FORWARD USES NEGATIVE ENGINE FORCE. Reverse is
therefore POSITIVE engine force. `rotateVec(q, 0, 0, -1)` (already in the file) gives the
chassis forward vector; `sampleVehicle` shows the exact `linvel · forward` dot product.

From `src/core/vehicle-tuning.ts`:
  export interface VehicleTuning { readonly drive: { engineForcePerRearWheel: number; ... } }
  export const TUNING_RANGES: { readonly drive: { engineForcePerRearWheel: TuningRange; ... } }
  export function clampTuning(t: VehicleTuning): VehicleTuning
`clampTuning` and `parseSavedTuning`'s `copyLeaves` both WALK `TUNING_RANGES`. A tuning leaf
with no range entry is silently uncopied and unclamped. `tests/vehicle-tuning.test.ts:108`
already asserts every `defaultTuning()` numeric leaf has a matching range entry.

From `src/physics/telemetry/routines.ts`:
  const STOP_SPEED_MS = 0.15;   // the `brake` routine returns null (run ends) at/below this
The 60-0 routine holds `brake: 1` until forward speed reaches 0.15 m/s. A reverse-engage
threshold at or above 0.15 would release the brakes before the routine can terminate.

From `src/render/camera/helicopter-camera.ts`:
  export interface CameraRig { readonly kind: "helicopter" | "chase";
    update(dtMs: number): void; snap(): void; setPitchBiasRad(rad: number): void; dispose(): void }
`update` DAMPS `camera.position` toward the desired pose using `camera.position` itself as
state. Anything that overwrites `camera.position` and leaves it overwritten poisons the
rig's own damping on the following frame.

From `src/render/camera/occlusion.ts` (pure, Node-testable — the investigation's material):
  export function densityFrom(occludedRayCount: number, totalRayCount: number): number
  export function steepenPitchRad(basePitchRad: number, maxPitchRad: number, density01: number): number
  export function fanOffsetsRad(count: number): readonly number[]   // half-spread PI/6
`steepenPitchRad` runs `density01` through `smoothstep01` (`c*c*(3-2*c)`) before lerping.

From `src/render/camera/occlusion-controller.ts`:
  export interface OcclusionController { mitigation(); setMitigation(m); cycle();
    update(cameraPos, targetPos, dtMs); dispose() }
`updateSteepen` reads `tuning.occlusion.{fanRayCount, basePitchDeg, maxPitchDeg, fadeLambda}`
and calls `rig.setPitchBiasRad(dampedPitchRad - basePitchRad)`.

From `src/debug/debug-gate.ts`:
  export const DEBUG_ENABLED: boolean
  export function onDebugKey(code: string, fn: () => void): void   // registers NOTHING when !DEBUG_ENABLED
Keys already taken: Backquote (profiler HUD), G (tuning panel), T (telemetry), C (rig swap),
V (camera skin), O (occlusion cycle).

From `src/input/keyboard.ts` — Arrow keys and WASD are DRIVING keys and are `preventDefault`ed.
They are unavailable to any camera control.

From `src/physics/surface-scene.ts` — the canyon under investigation:
  DENSE_BUILDINGS: 10 boxes, halfExtents { x: 5, y: 14, z: 9 }, at x=-41 and x=-21,
  z = 30/10/-10/-30/-50. Bodies sit at y = halfExtents.y, so each box spans 0..28 m tall
  and 18 m along z with 2 m gaps. The drivable corridor is x ∈ [-36, -26] — 10 m wide.

From `src/render/surface-view.ts` — building meshes use a `MeshStandardMaterial` with
`transparent: true` and the THREE default `side` (front faces only).

From `src/core/camera-tuning.ts` — `framing` low = altitude 14 m / distance 16 m,
high = altitude 26 m / distance 30 m; `occlusion` = { nearTargetMarginM 2.0,
fadeFloorOpacity 0.15, fadeLambda 8.0, basePitchDeg 41, maxPitchDeg 78, fanRayCount 5 }.
</interfaces>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Reverse gear through VehicleTuning</name>
  <files>src/core/vehicle-tuning.ts, src/physics/vehicle.ts, src/debug/tuning-panel.ts, tests/vehicle.test.ts</files>
  <behavior>
    - Held brake with the car at rest produces POSITIVE rear engine force (chassis forward is -Z, so positive = backward) and ZERO brake impulse on all four wheels.
    - Held brake while moving forward above the engage threshold produces ZERO engine force and full brake impulse — unchanged from today.
    - Held brake while ALREADY moving backward keeps producing reverse engine force (it does not re-brake itself to a standstill).
    - Reverse force scales with `frame.brake`, so a gamepad's analog trigger gives proportional reverse.
    - A saved tuning blob containing `reverseEngineForcePerRearWheel: 1e9` (or `NaN`, or `-5`) is clamped into range by `parseSavedTuning`.
  </behavior>
  <action>
    Add two leaves to `VehicleTuning.drive` in `src/core/vehicle-tuning.ts`:
    `reverseEngineForcePerRearWheel` (default 1500) and `reverseEngageSpeedMs` (default 0.1).
    Give each a doc comment in this file's established `[MEASURED]`/`[ASSUMED]` house style —
    mark both `[ASSUMED]` (they are starting values, not swept), and on `reverseEngageSpeedMs`
    state explicitly that its default is deliberately BELOW
    `src/physics/telemetry/routines.ts`'s `STOP_SPEED_MS` (0.15) so the 60-0 braking routine
    provably terminates before reverse can engage — a threshold above it releases the brakes
    mid-measurement and the routine never reaches its stop condition.

    Add the MATCHING `TUNING_RANGES.drive` entries in the same edit — this is mandatory, not
    cosmetic: `clampTuning` and `parseSavedTuning`'s `copyLeaves` both walk that table, so a
    leaf with no range entry is neither copied from a saved blob nor clamped, which is exactly
    the localStorage-to-Rapier path threat T-Q-02 covers. Use
    `reverseEngineForcePerRearWheel: { min: 0, max: 6000, step: 50 }` and
    `reverseEngageSpeedMs: { min: 0, max: 1, step: 0.01 }` (max 1 m/s keeps the engage window
    at walking pace or below; a larger max would let a slider release the brakes at real speed).
    Extend the `TUNING_RANGES` type literal above the table for both leaves.

    In `src/physics/vehicle.ts`'s `tick`, replace the step-2/step-3 engine-force and brake
    block. Compute the chassis forward speed with the file's existing hand-rolled
    `rotateVec(body.rotation(), 0, 0, -1)` and a dot product against `body.linvel()` — do NOT
    call `sampleVehicle` (it allocates four objects per tick) and do NOT import `three`.
    Then: `const reversing = frame.brake > 0 && forwardSpeedMs < t.drive.reverseEngageSpeedMs;`
    When reversing, engine force is `+frame.brake * t.drive.reverseEngineForcePerRearWheel` and
    the per-wheel brake impulse is 0; otherwise both are exactly today's expressions. Keep the
    existing Pitfall 7 comment (engine force must be zero while braking) intact and extend it to
    say why reverse must also zero the BRAKE: Pitfall 7 only disables the brake on wheels
    carrying engine force (the rears), so leaving front brake impulse on would hold the car
    against its own reverse drive.

    State in a comment that reverse is derived from physics state rather than from a new
    `InputFrame` field, because `InputFrame`'s shape is frozen by `tests/determinism.test.ts`
    and the recorded-tape contract — and that this keeps reverse a pure function of the same
    inputs, so determinism is preserved.

    Add the two sliders to `src/debug/tuning-panel.ts`'s `driveFolder` alongside the existing
    `engineForcePerRearWheel`/`brakeImpulsePerWheel` `addNumber` calls, following that file's
    exact per-field call shape (the panel enumerates drive fields explicitly; a new leaf does
    not appear on its own).

    Write the tests in `tests/vehicle.test.ts` first, matching that file's existing harness
    style. Cover every bullet in `<behavior>` above. Assert the brake-while-moving-forward case
    against the literal pre-change behaviour so a regression is caught by value, not by feel.
  </action>
  <verify>
    <automated>cd "D:/Projects 2/Heat Street" && npx vitest run tests/vehicle.test.ts tests/vehicle-tuning.test.ts tests/tuning-persist.test.ts tests/vehicle-telemetry.test.ts tests/determinism.test.ts && npm run typecheck</automated>
    <human-check>With `npm run dev`, drive into the DENSE_BUILDINGS canyon, stop against a wall, hold S/Down: the car reverses out. Tapping S at speed still brakes without lurching backward.</human-check>
  </verify>
  <done>Reverse drives the car backward from rest; `tests/vehicle-telemetry.test.ts`'s `brake` routine still terminates and still lands in its 110-135 ft band; the tuning-shape and persistence suites pass unchanged.</done>
</task>

<task type="auto">
  <name>Task 2: Temporary ?debug free-look orbit override</name>
  <files>src/debug/free-look-camera.ts, src/main.ts</files>
  <action>
    Create `src/debug/free-look-camera.ts`. Head the file with a comment marking it a
    TEMPORARY DEBUG TOOL added to assist the Phase 3 plan 03-12 manual occlusion playtest,
    stating that it must never be reachable outside `DEBUG_ENABLED` and that it deliberately
    does not modify the permanent helicopter rig (CLAUDE.md's non-negotiable camera design
    constraint) — it only overwrites the camera pose AFTER the rig has already written and
    been read.

    Export `createFreeLookCamera(camera: THREE.PerspectiveCamera, canvas: HTMLCanvasElement)`
    returning `{ engaged(): boolean; toggle(): void; restoreRigPose(): void;
    apply(targetX: number, targetY: number, targetZ: number): void; dispose(): void }`.

    Follow the repo's gate-free-factory convention (`createTuningPanel`/`createTelemetryHud`):
    this factory never reads `DEBUG_ENABLED` itself — `src/main.ts` owns the gate, so a normal
    build constructs nothing and registers zero listeners.

    Internal state: `yawRad`, `pitchRad`, `distanceM`, plus a saved `THREE.Vector3` and
    `THREE.Quaternion` holding the rig's pose. Reuse module- or closure-scope scratch objects;
    allocate nothing per frame (`src/render/camera/occlusion-probe.ts`'s SCRATCH convention).

    Controls, all registered on `canvas`, all inert while disengaged: `pointerdown` starts a
    drag, `pointermove` maps dx/dy to yaw/pitch, `pointerup`/`pointercancel` ends it, `wheel`
    changes `distanceM`. Clamp pitch to roughly `[0.05, PI/2 - 0.05]` rad and distance to
    something like `[4, 120]` m. Call `preventDefault` on `wheel` only while engaged so the
    page does not scroll. Comment explicitly that arrow keys and WASD are NOT used because
    `src/input/keyboard.ts` owns them as driving keys and `preventDefault`s them.

    `toggle()` on first engage seeds `yawRad`/`pitchRad`/`distanceM` from the camera's CURRENT
    pose relative to the target so engaging produces no jump; on disengage it calls
    `restoreRigPose()` once so the very next frame starts from the rig's own pose.

    `restoreRigPose()` is a no-op while disengaged; while engaged it writes the saved rig pose
    back onto the camera. `apply(...)` is a no-op while disengaged; while engaged it SAVES the
    camera's current position+quaternion, then writes the orbit pose (spherical offset around
    the target, then `lookAt`).

    Wire into `src/main.ts`'s `render(alpha, dtMs)` callback with this exact ordering, and
    comment the ordering as load-bearing:
      1. `freeLook?.restoreRigPose()` — BEFORE `activeRig.update(dtMs)`, because the rig damps
         `camera.position` using `camera.position` as its own state; leaving last frame's
         free-look pose there would poison the rig's damping and make it snap on disengage.
      2. `activeRig.update(dtMs)` — unchanged.
      3. `occlusion.update(camera.position, view.meshes[0].position, dtMs)` — unchanged, and
         therefore still sampling the SHIPPING rig pose. This is the whole point: the developer
         flies around to LOOK at a mitigation that is still being computed for the real camera.
      4. `freeLook?.apply(...)` with the car's position — AFTER occlusion, BEFORE
         `renderer.render`.
    Construct it as `const freeLook = DEBUG_ENABLED ? createFreeLookCamera(camera, canvas) : null;`
    and register `onDebugKey("KeyF", () => freeLook.toggle())` inside the existing
    `if (DEBUG_ENABLED)` style used for `KeyC`/`KeyV`/`KeyO`.

    Update the key-map comment block in `src/main.ts` (the one listing Backquote/G/T/C/V/O) to
    include `F = temporary free-look orbit (debug only)`.

    Log one line via `console.info` on each toggle naming the new state, so a playtester can
    tell from the console which mode they are in. Nothing else should print per frame.
  </action>
  <verify>
    <automated>cd "D:/Projects 2/Heat Street" && npm run typecheck && npx vitest run tests/layering.test.ts tests/debug-gate.test.ts</automated>
    <human-check>`npm run dev` with `?debug`: press F, drag the mouse — the camera orbits the car; buildings still fade in/out based on the helicopter shot, not the flown-to shot. Press F again — the helicopter view returns immediately with no swoop. Reload WITHOUT `?debug`: F does nothing and the camera is unchanged.</human-check>
  </verify>
  <done>Free-look engages/disengages on F under `?debug` only, orbits on mouse drag, and the helicopter rig resumes with no snap; no free-look listener exists in a non-debug build.</done>
</task>

<task type="auto">
  <name>Task 3: Investigate the steepen arm — report, do not fix</name>
  <files>tests/occlusion.test.ts</files>
  <action>
    ANSWER ONE QUESTION: in the DENSE_BUILDINGS canyon, is `steepen` computing a near-zero
    occlusion density (a real bug), or a real density whose resulting pitch change is simply
    too small to perceive from a fixed camera angle (not a bug)?

    Do this by derivation from the code plus a Node test — the existing `[occlusion-diag]`
    console logging in `src/main.ts` may be used as corroboration if the dev server is already
    running, but it is not required and it is deleted in Task 4 either way.

    Work the arithmetic explicitly and record it in the SUMMARY:
    - The fan-ray geometry. `fanOffsetsRad(5)` yields offsets at -30/-15/0/+15/+30 degrees.
      `occludedFanRayCount` rotates the camera's XZ offset about the target, holding
      `originY = cameraPos.y`. At the low-speed framing (altitude 14 m, distance 16 m) the
      horizontal radius is 16 m, so the +/-30 degree rays originate ~8 m lateral of the car —
      inside the 10 m corridor's walls. Work out how many of the five rays actually cross a
      building face given the 28 m tall boxes and the 2 m z-gaps.
    - The front-face culling question. `src/render/surface-view.ts`'s building material uses
      THREE's default `side` (front faces only), so a fan ray ORIGINATING INSIDE a box exits
      through a back face and reports NO hit. Determine whether any of the five ray origins
      land inside a building at the canyon's geometry, and whether that under-reports density.
    - The smoothstep squash. `steepenPitchRad` runs density through `smoothstep01`
      (`c*c*(3-2*c)`) before lerping 41 -> 78 degrees. Compute the resulting pitch for
      density = 1/5, 2/5, 3/5, 4/5, 5/5. Note that 1/5 gives smoothstep(0.2) = 0.104 and
      therefore only about 3.9 degrees of pitch change — state the exact numbers you compute.
    - The bias path. `updateSteepen` sets `rig.setPitchBiasRad(dampedPitchRad - basePitchRad)`
      against `tuning.occlusion.basePitchDeg` (41), while the rig's real base pitch is
      `atan2(altitudeM, distanceM)` — 41.2 degrees at low framing, 40.9 at high. Confirm
      whether that mismatch is material or negligible.

    Add a permanent, hand-built-input test block to `tests/occlusion.test.ts` (that file's
    existing pure, no-scene, no-WebGL style) anchoring whatever you find: assert the pitch in
    degrees that `steepenPitchRad(degToRad(41), degToRad(78), d)` produces at each of the five
    achievable fan densities, with a comment naming the canyon this was derived against. This
    turns the finding into a regression anchor rather than a note that decays.

    HARD CONSTRAINTS: change NO value in `src/core/camera-tuning.ts`. Change NO logic in
    `src/render/camera/occlusion.ts` or `occlusion-controller.ts` in this task. Do not switch
    the boot mitigation arm in `src/main.ts`. Plan 03-12 reserves the mitigation choice for a
    human; if the investigation surfaces a genuine bug, write it up as a finding with a
    proposed fix and STOP — do not apply it.

    Report the verdict in the SUMMARY in one of exactly two forms, with the numbers behind it:
    "BUG: density under-reports in the canyon because X", or "NOT A BUG: density is real
    (measured N/5) but produces only D degrees of pitch change, which is below perceptual
    threshold from the fixed helicopter angle."
  </action>
  <verify>
    <automated>cd "D:/Projects 2/Heat Street" && npx vitest run tests/occlusion.test.ts && npm run typecheck</automated>
  </verify>
  <done>`tests/occlusion.test.ts` contains the density-to-pitch anchor block and passes; the SUMMARY carries a BUG/NOT-A-BUG verdict with the supporting arithmetic; no tuning value and no occlusion logic changed.</done>
</task>

<task type="auto">
  <name>Task 4: Retire the TEMP diagnostic scaffolding</name>
  <files>src/main.ts, src/render/camera/occlusion-controller.ts, src/debug/free-look-camera.ts</files>
  <action>
    Remove the uncommitted TEMP scaffolding from `src/main.ts`: the `diagFrame` counter, the
    `% 30` per-frame `console.log` block inside `render`, the `console.log` inside the `KeyO`
    handler, and both `TEMP DIAGNOSTIC (03-12 playtest debugging) — remove before commit`
    comments. Restore the `KeyO` handler to its plain `occlusion.cycle()` form. After this
    edit, `grep -n "TEMP DIAGNOSTIC\|occlusion-diag\|remove before commit" src/main.ts` must
    return nothing.

    Then make ONE decision, informed by Task 3's verdict, and record it in the SUMMARY with
    its reasoning:

    (a) If Task 3 concluded the live numbers are NOT needed for the 03-12 playtest, stop here —
        deletion is the whole change.

    (b) If Task 3 concluded a live density/pitch-bias readout is genuinely needed to complete
        that playtest, promote it properly rather than leaving TEMP language in place. Add a
        read-only `debugSample(): { mitigation: OcclusionMitigation; density01: number;
        pitchBiasRad: number; occluderCount: number }` to `OcclusionController` that returns
        state the controller ALREADY computes — cache the values at the end of `updateFade`/
        `updateSteepen` and return them; add no new raycasts and change no behaviour. Then have
        `src/main.ts` pass a `readout: () => string` callback into `createFreeLookCamera`, and
        have the free-look tool render that one line into a small absolutely-positioned DOM
        element with `pointer-events: none`, shown only while engaged. Use `textContent` only,
        never `innerHTML` (the repo's standing DOM-XSS rule). This pairs the readout with the
        one tool that needs it and adds no new hotkey.

    Whichever branch you take, the outcome must read like the other `DEBUG_ENABLED`-gated
    tools in this file — no "TEMP", no "remove before commit", no throwaway framing.
  </action>
  <verify>
    <automated>cd "D:/Projects 2/Heat Street" && ! grep -n "TEMP DIAGNOSTIC\|occlusion-diag\|remove before commit" src/main.ts && npm run typecheck && npx vitest run</automated>
    <human-check>`npm run dev` with `?debug`: pressing O still cycles fade -> steepen -> off with no console spam, and a normal (non-debug) reload prints nothing to the console.</human-check>
  </verify>
  <done>`src/main.ts` is free of TEMP diagnostic text and per-frame logging; the keep-or-delete decision and its reasoning are recorded in the SUMMARY; full `npm run test` passes.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| localStorage -> Rapier | The saved tuning blob is user-editable from devtools and is fed into per-wheel physics setters on the next fixed tick |
| URL query string -> debug surface | `?debug` presence is the only gate between a normal build and every dev tool |
| Browser input events -> camera | Pointer/wheel listeners added by the free-look tool |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-Q-01 | Elevation of Privilege | `src/debug/free-look-camera.ts` | mitigate | Factory is gate-free; `src/main.ts` constructs it only under `DEBUG_ENABLED` and binds `KeyF` via `onDebugKey`, which registers nothing when the flag is absent — a normal build has zero free-look listeners |
| T-Q-02 | Denial of Service | `reverseEngineForcePerRearWheel` / `reverseEngageSpeedMs` from localStorage | mitigate | Both leaves get `TUNING_RANGES.drive` entries in the SAME edit as the defaults, so `clampTuning`/`copyLeaves` cover them; `tests/vehicle-tuning.test.ts:108` mechanically fails if a range entry is missing |
| T-Q-03 | Tampering | Camera pose state shared between rig and free-look | mitigate | `restoreRigPose()` runs before `activeRig.update` every frame, so the rig's damping state is never seeded from a free-look pose; disengaging restores the rig pose exactly once |
| T-Q-04 | Information Disclosure | Per-frame `console.log` shipped to a non-debug build | mitigate | Task 4 deletes the TEMP logging outright; any retained readout is DOM `textContent` inside a `DEBUG_ENABLED`-gated tool |
| T-Q-SC | Tampering | npm/pip/cargo installs | mitigate | This plan installs NOTHING — `package.json` must be byte-identical after execution. No legitimacy checkpoint is required because no package is added |
</threat_model>

<verification>
1. `npm run typecheck` clean.
2. `npx vitest run` — full suite green, including `tests/determinism.test.ts` (the VEH-03
   proof CLAUDE.md constraint 3 says must not regress) and `tests/vehicle-telemetry.test.ts`'s
   `brake` routine gate.
3. `grep -n "TEMP DIAGNOSTIC\|occlusion-diag\|remove before commit" src/main.ts` returns nothing.
4. `git diff --stat package.json package-lock.json` shows no change.
5. `git diff --stat .planning/phases/` shows no change — this plan does not touch Phase 3
   artifacts.
6. `git diff src/core/camera-tuning.ts` is empty — no occlusion value was retuned.
7. Biome caveat: `npm run lint` is known to fail repo-wide on a pre-existing CRLF/LF
   mismatch (`.planning/STATE.md`, Phase 2 blockers). Run `npx biome check src/physics/vehicle.ts
   src/core/vehicle-tuning.ts src/debug/free-look-camera.ts src/main.ts` scoped to this plan's
   files instead, and report any failure that is NOT that known line-ending issue.
</verification>

<success_criteria>
- Holding brake at rest reverses the car; tapping brake at speed brakes exactly as before.
- Both new tuning leaves are range-bounded and appear in the `?debug` tuning panel.
- `F` under `?debug` toggles a mouse-drag orbit camera that leaves the helicopter rig's own
  state and the occlusion mitigation's inputs untouched; nothing exists without `?debug`.
- The SUMMARY carries a BUG / NOT-A-BUG verdict on the steepen arm with the supporting
  numbers, and `tests/occlusion.test.ts` anchors it.
- `src/main.ts` has no TEMP diagnostic scaffolding; the keep-or-delete reasoning is recorded.
- No occlusion tuning value changed, no boot mitigation arm changed, no `.planning/phases/`
  file touched, no package added.
</success_criteria>

<output>
Create `.planning/quick/260913-epf-add-reverse-gear-and-a-temporary-debug-f/260913-epf-SUMMARY.md` when done.

The SUMMARY must contain, in addition to the standard template sections:
- The steepen investigation verdict in the exact BUG / NOT-A-BUG form Task 3 specifies, with
  the fan-ray density and degrees-of-pitch-change numbers behind it.
- The Task 4 keep-or-delete decision for the diagnostic readout, and why.
- An explicit statement that plan 03-12's mitigation choice remains open and unresolved by
  this work.
</output>
