---
phase: quick-261004-otc
plan: 01
type: tdd
wave: 1
depends_on: []
files_modified:
  - src/core/vehicle-class.ts
  - src/physics/vehicle.ts
  - tests/vehicle-class.test.ts
  - tests/vehicle-drivetrain.test.ts
  - docs/vehicle-tuning-guide.md
autonomous: true
requirements: [QUICK-261004-otc]

must_haves:
  truths:
    - "FWD car on full throttle at half steering lock gains speed vs coasting (25 mph start, 1 s) and does not end slower than it started"
    - "AWD car likewise gains speed on throttle mid-corner vs coasting"
    - "FWD straight-line 0-60 mph time is within about +/-10% of RWD"
    - "FWD/AWD still reverse on brake from standstill, and throttle+brake still slows the car (Pitfall 7)"
    - "An airborne FWD car receives zero front-drive thrust"
    - "RWD (frontDriveShare 0) behaviour is bit-for-bit unchanged; determinism test still passes"
    - "Full suite failures are exactly the known 8 RWD telemetry/recovery band tests"
  artifacts:
    - path: "src/core/vehicle-class.ts"
      provides: "pure frontDriveThrustN helper; FWD engine force retuned"
      exports: ["frontDriveThrustN", "wheelEngineForces", "classDefaultTuning"]
    - path: "src/physics/vehicle.ts"
      provides: "front drive share applied as chassis impulse along heading, front wheel engine force 0"
      contains: "frontDriveThrustN"
    - path: "tests/vehicle-drivetrain.test.ts"
      provides: "cornering-throttle, 0-60 band, airborne tests"
  key_links:
    - from: "src/physics/vehicle.ts tick()"
      to: "body.applyImpulse"
      via: "frontDriveThrustN(engineForce, frontDriveShare, frontContacts) * DT along forward"
      pattern: "frontDriveThrustN"
---

<objective>
Fix FWD/AWD losing acceleration while cornering. Rapier's raycast-vehicle friction solver
scales a steered wheel's forward impulse by maxImpulse/sideImpulse once side slip
saturates the friction circle, so any drive force routed through the steered front
wheels collapses mid-corner (measured: FWD full throttle 25->22 mph vs coast 25->21 at
half lock for 1 s; RWD 25->35; AWD 25->29). Arcade fix: route the FRONT share of drive
force as a chassis impulse along the car's forward axis (gated by front-wheel ground
contact) and give the front wheels zero engine force. Rear share unchanged.

Purpose: front-driven classes must accelerate out of corners on throttle; RWD feel must
not move by a single bit.
Output: pure thrust helper + tests, vehicle.ts tick change, FWD retune, tuning-guide note.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md
@./CLAUDE.md
@.planning/quick/261004-gmu-add-fwd-and-4wd-vehicle-classes-with-col/261004-gmu-SUMMARY.md
@src/physics/vehicle.ts
@src/core/vehicle-class.ts
@tests/vehicle-drivetrain.test.ts

<interfaces>
From src/core/vehicle-class.ts (current):
- `VEHICLE_CLASSES` — rwd frontDriveShare 0, fwd 1, awd 0.4
- `wheelEngineForces(perWheelForce: number, frontShare: number): readonly [FL, FR, RL, RR]`
  — front = perWheelForce*frontShare, rear = perWheelForce*(1-frontShare); zeros normalised to +0.
- `classDefaultTuning(id)` — fwd case sets `t.drive.engineForcePerRearWheel = 6000` (base default 4800),
  powerOversteerGain 0.5, rearSideFriction 0.3, frontSideFriction 1.2. awd: frictionSlip 1.8,
  rearSideFriction 0.3, powerOversteerGain 0.5.

From src/physics/vehicle.ts:
- `createVehicle(world, tuning, spawn, frontDriveShare = 0): Vehicle` (closure captures frontDriveShare)
- tick() order (LOAD-BEARING, do not reorder): 0 surfaces -> 1 steering -> 2 engine force
  (`engineForce` per rear wheel; NEGATIVE = forward because car forward is local -Z;
  0 while braking unless `reversing`, positive = reverse) -> `wheelEngineForces(engineForce, frontDriveShare)`
  -> setWheelEngineForce FL/FR/RL/RR -> 3 brakes -> 4 rear side friction -> 5 `vc.updateVehicle(DT)`
  -> 6 contacts count + telemetry -> 7 `applyAssists(body, vc, contacts, t.assists, inertia)`.
- `forward` (unit chassis-forward vector, `rotateVec(q, 0, 0, -1)`) is already computed in step 2.
- Wheel indices: FL=0, FR=1, RL=2, RR=3. `vc.wheelIsInContact(i)`.
- `DT` = 1/60 from src/core/sim-clock.ts (already imported in vehicle.ts).
- Force-application convention (src/physics/vehicle-assists.ts header): every chassis term uses
  `applyImpulse` / `applyTorqueImpulse` with `force * DT`, NEVER `addForce` — impulses are consumed
  by the next `world.step()` and cannot persist/accumulate across ticks or leak into other vehicles.

From tests/vehicle-drivetrain.test.ts: helpers `buildScene(tuning, share?)` (flat 1000x1000 ground,
spawn y=1), `run(scene, tuning, ticks, inputFn)` (tick then world.step), `forwardSpeed(vehicle)`,
`full` InputFrame. Existing tests: RWD bitwise-identity, per-share accelerate/brake/reverse, range check.
</interfaces>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1 (RED): failing tests for the arcade front-drive thrust model</name>
  <files>tests/vehicle-class.test.ts, tests/vehicle-drivetrain.test.ts, src/core/vehicle-class.ts</files>
  <behavior>
    Pure helper `frontDriveThrustN(perWheelEngineForce, frontShare, frontContacts)` (tests/vehicle-class.test.ts):
    - (-4800, 1, 2) -> 9600 (forward thrust positive = chassis forward, newtons)
    - (-4800, 1, 1) -> 4800 (scales with front contact count)
    - (-4800, 1, 0) -> 0 (airborne)
    - (-4800, 0.4, 2) -> 3840
    - (2000, 1, 2) -> -4000 (reverse: positive engine force = backwards thrust)
    - (0, 1, 2) -> 0 and (-4800, 0, 2) -> 0, both Object.is(+0)
    Physics (tests/vehicle-drivetrain.test.ts, new describe block using existing helpers):
    - Corner test, for fwd and awd with classDefaultTuning + VEHICLE_CLASSES share: build scene,
      settle 30 ticks NEUTRAL, setLinvel to 11.176 m/s (25 mph) along chassis forward (-Z), then 60 ticks
      at steer 0.5 with throttle 1 in one scene and throttle 0 in an identical scene. Measure horizontal
      speed sqrt(vx^2+vz^2). Assert throttle end >= 11.176 (not slower than start) and
      throttle end - coast end >= 1.34 m/s (3 mph, "clearly faster").
    - 0-60 band: count ticks from rest (full throttle, straight) until forwardSpeed >= 26.82 m/s, cap 900
      ticks, for rwd and fwd with their class tuning/share. Assert fwd ticks within +/-15% of rwd ticks
      (test band; Task 3 tunes toward +/-10%).
    - Airborne: FWD scene with spawn override is not available, so after building, `body.setTranslation`
      to y=30 and zero linvel, run 20 ticks full throttle; assert |horizontal speed| < 0.05 m/s and no
      front wheel in contact (all four `controller.wheelIsInContact(i)` false).
  </behavior>
  <action>
    Add an exported stub `frontDriveThrustN(perWheelEngineForce: number, frontShare: number, frontContacts: number): number`
    to src/core/vehicle-class.ts that returns 0 (so tests compile and FAIL, not error), with a doc
    comment: returns signed chassis-forward thrust in newtons for the front axle share, positive =
    forward; engine force sign convention is negative = forward (car forward is local -Z); contribution
    is per front wheel in ground contact (0..2). Write the tests described in behavior. Existing
    reverse and throttle+brake tests already cover reverse and Pitfall 7 for all shares — keep them.
    Run the new tests and confirm the helper tests and the FWD corner test fail (the FWD corner test is
    expected to fail on current code per the measured 25->22 vs 25->21). If the corner test unexpectedly
    passes on current code, report the measured numbers in the SUMMARY rather than altering thresholds.
    Commit only these files by explicit path: `test(quick-261004-otc): failing tests for arcade front-drive thrust`.
  </action>
  <verify>
    <automated>npx vitest run tests/vehicle-class.test.ts tests/vehicle-drivetrain.test.ts (expect new tests RED; pre-existing tests in both files still green)</automated>
  </verify>
  <done>New helper and physics tests exist and fail for the right reason; existing drivetrain/class tests unchanged and passing.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 2 (GREEN): implement helper and apply front share as chassis impulse in tick()</name>
  <files>src/core/vehicle-class.ts, src/physics/vehicle.ts</files>
  <behavior>
    - Helper tests from Task 1 pass.
    - RWD bitwise-identity test and tests/determinism.test.ts pass unchanged.
    - FWD/AWD corner tests and airborne test pass.
  </behavior>
  <action>
    Before editing, run `git diff -- src/physics/vehicle.ts src/core/vehicle-class.ts` (vehicle.ts shows
    as modified with an empty diff — line-ending stat quirk); preserve LF line endings.

    1. Implement `frontDriveThrustN`: `-perWheelEngineForce * frontShare * frontContacts`, normalising a
       zero result to +0 (same idiom as wheelEngineForces). Pure, no Math.random/Date.now.

    2. In src/physics/vehicle.ts tick() step 2: keep `const forces = wheelEngineForces(engineForce, frontDriveShare)`
       for the rear values, but set FL and FR engine force to 0 (literal +0) — the front share no longer
       goes through tyre contact. For RWD forces[0]/[1] are already +0, so the calls are identical.
       Replace the existing "With FWD/AWD the front wheels carry engine force too" comment with an
       explanation of the arcade front-drive model: Rapier's updateFriction scales a steered wheel's
       forward impulse by maxImpulse/sideImpulse when side slip saturates the friction circle, so front
       drive collapsed mid-corner (measured FWD 25->22 mph throttle vs 25->21 coast at half lock, 1 s);
       front share is therefore applied as a chassis impulse after updateVehicle. Front brakes now always
       work with throttle held since no front wheel carries engine force (Pitfall 7 still zeroes
       engineForce while braking, so thrust is also 0 then; reverse uses the same split, negative thrust).

    3. After step 5 `vc.updateVehicle(DT)` (so contact state is THIS tick's raycast, not the one-tick-stale
       read), inside a guard `if (frontDriveShare > 0)` — guard is what guarantees RWD performs zero
       extra Rapier calls and stays bit-for-bit identical — count front contacts
       (`vc.wheelIsInContact(FL)`, `(FR)`), compute `thrust = frontDriveThrustN(engineForce, frontDriveShare, frontContacts)`,
       and if thrust !== 0 call `body.applyImpulse({ x: forward.x * thrust * DT, y: forward.y * thrust * DT, z: forward.z * thrust * DT }, true)`.
       Reuse the `forward` vector already computed in step 2 (pre-update orientation; deterministic and
       consistent with how engineForce was chosen). Place this before step 6/7 so it sits alongside the
       other chassis impulses consumed by the caller's next world.step().
       Design choices to document in the code comment (Claude's discretion per brief):
       - applyImpulse(force*DT), NOT addForce: matches the vehicle-assists.ts convention; impulses are
         consumed by the next world.step() so nothing persists between ticks, accumulates, or leaks
         into RWD/other vehicles. addForce would persist until resetForces.
       - Applied at the centre of mass (applyImpulse, not applyImpulseAtPoint): no parasitic yaw/pitch
         torque from the thrust vector; weight transfer (squat/dive) still emerges from the raycast
         suspension reacting to chassis acceleration. Simple and deterministic.
       - Direction = chassis forward (heading), not the steered wheel direction: the steered wheels'
         lateral grip still turns the car; thrust along heading is the arcade simplification.
       - Grip-aware: scaled by front contact count (0..2), zero airborne.

    4. Run the drivetrain, class and determinism tests. Commit by explicit path:
       `feat(quick-261004-otc): apply FWD/AWD front drive share as chassis thrust along heading`.
  </action>
  <verify>
    <automated>npx vitest run tests/vehicle-class.test.ts tests/vehicle-drivetrain.test.ts tests/determinism.test.ts</automated>
  </verify>
  <done>All tests in those three files pass (0-60 band test may still be at the 6000 tuning — must pass at +/-15%; if it does not, proceed to Task 3 retune before declaring green). RWD bitwise test untouched and passing.</done>
</task>

<task type="auto">
  <name>Task 3: retune FWD engine force, update class test and tuning guide, full-suite check</name>
  <files>src/core/vehicle-class.ts, tests/vehicle-class.test.ts, docs/vehicle-tuning-guide.md</files>
  <action>
    1. Measure with a TEMPORARY vitest file (e.g. tests/tmp-otc-measure.test.ts, never committed, deleted
       afterwards): ticks-to-60 mph from rest for rwd, fwd, awd (class tuning + share), and the 25 mph
       half-lock 1 s throttle/coast end speeds for all three. Try FWD engineForcePerRearWheel = 4800 first.
       Target: FWD 0-60 within +/-10% of RWD. If 4800 misses, pick the nearest round value (steps of 200)
       that lands within +/-10% and record the measurements. AWD stays unchanged unless its 0-60 is
       outside +/-10% of RWD (then adjust similarly and record why).
    2. Apply the result in classDefaultTuning("fwd"). If the chosen value equals the base default (4800),
       delete the override line and its comment entirely (so fwd differs from base only in the three
       remaining leaves); otherwise update the value and rewrite the comment with the new measurements
       (and drop the stale "steered front wheels carrying all of it" rationale, which no longer applies).
    3. tests/vehicle-class.test.ts "fwd and awd differ only in the overridden leaves": update the
       `engineForcePerRearWheel` assertion to the new value; if the override was removed, delete both the
       `toBe(6000)` line and the `fwdRest.drive.engineForcePerRearWheel = ...` restore line so the
       `toEqual(base)` check proves engine force is no longer overridden. Mirror any AWD change.
    4. docs/vehicle-tuning-guide.md: add a short subsection under section 4 "Interaction deep-dives"
       titled "Arcade front-drive model (FWD / AWD)": front share of drive is a chassis impulse along
       heading at the centre of mass, scaled by front wheels in contact, zero while braking (reverse
       negative); rear share goes through the rear tyres as before; why (Rapier friction-circle scaling of
       steered-wheel forward impulse); consequence: engineForcePerRearWheel for FWD is no longer
       fighting cornering scrub, and front frictionSlip/frontSideFriction now only affect turning, not
       traction. Keep it to ~10-15 lines.
    5. Delete the temporary measurement file. Run the full suite and confirm the failing set is EXACTLY
       the known 8: tests/vehicle-telemetry.test.ts accel, brake, skidpad, handbrake, roll-stability,
       runAllRoutines; tests/vehicle-recovery.test.ts powerSlideRecovery and highSpeedPulse candidate-band
       tests. Do not loosen any band. Run `npx tsc --noEmit` and `npx biome check` on changed files.
    6. Commit by explicit path (src/core/vehicle-class.ts, tests/vehicle-class.test.ts,
       docs/vehicle-tuning-guide.md): `feat(quick-261004-otc): retune FWD drive force for arcade front-drive model`.
       NEVER stage src/core/racing-line.ts, src/loop.ts, src/input/race-commands.ts,
       .planning/debug/ai-pace-and-handbrake-feel.md, or src/physics/map-scene.ts.
  </action>
  <verify>
    <automated>npx vitest run 2>&1 | tail -40 (exactly the 8 known failures) ; npx tsc --noEmit ; test ! -f tests/tmp-otc-measure.test.ts</automated>
  </verify>
  <done>FWD 0-60 within +/-10% of RWD with measured numbers recorded in SUMMARY; class test updated; guide note added; temp file gone; full suite shows only the known 8 failures; typecheck clean.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| none new | Pure in-process physics change; no new input surface, network, storage or dependency |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-otc-01 | Tampering (determinism / medal-time integrity) | vehicle.ts tick() thrust | mitigate | Thrust is a pure function of engineForce, frontDriveShare and this tick's contact state; applied via applyImpulse(force*DT) consumed by the next fixed step; no Math.random/Date.now; tests/determinism.test.ts run in Task 2 |
| T-otc-02 | Tampering (RWD regression) | vehicle.ts tick() | mitigate | All new Rapier calls inside `if (frontDriveShare > 0)`; front engine force +0 equals current RWD values; bitwise-identity test must pass |
| T-otc-03 | Denial of service (runaway force) | thrust accumulation | mitigate | No addForce (persistent) — impulse per tick only, so no accumulation across ticks or leakage into other vehicles |
</threat_model>

<verification>
- `npx vitest run tests/vehicle-class.test.ts tests/vehicle-drivetrain.test.ts tests/determinism.test.ts` all green
- Full `npx vitest run` fails exactly the known 8 RWD band tests, nothing else
- `npx tsc --noEmit` clean
- `git log -3 --stat` shows only the five planned files across commits
</verification>

<success_criteria>
- FWD and AWD gain speed on throttle at half lock vs coasting (>= 3 mph clearer than coast, not below 25 mph start)
- FWD 0-60 within +/-10% of RWD (measured and recorded)
- Airborne front-drive thrust is zero; reverse and throttle+brake behaviour intact
- RWD bit-for-bit unchanged; determinism preserved
- Tuning guide documents the arcade front-drive model
</success_criteria>

<output>
Create `.planning/quick/261004-otc-arcade-front-drive-thrust-for-fwd-and-aw/261004-otc-SUMMARY.md` when done,
including measured before/after numbers (corner test end speeds, 0-60 ticks for rwd/fwd/awd) and the chosen FWD engine force.
</output>
