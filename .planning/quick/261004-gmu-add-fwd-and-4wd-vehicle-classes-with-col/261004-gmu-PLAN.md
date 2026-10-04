---
phase: quick-261004-gmu
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - src/core/vehicle-class.ts
  - src/core/vehicle-tuning.ts
  - tests/vehicle-class.test.ts
  - src/physics/vehicle.ts
  - src/physics/map-scene.ts
  - tests/vehicle-drivetrain.test.ts
  - src/render/vehicle-view.ts
  - src/debug/tuning-panel.ts
  - src/main.ts
autonomous: true
requirements: [QUICK-261004-gmu]

must_haves:
  truths:
    - "?car=fwd drives the front wheels only, ?car=awd drives all four, ?car=rwd / no param / any unknown value is the existing RWD car"
    - "The player car is red for RWD, green for FWD, blue for AWD"
    - "Each class has its own default tuning derived from defaultTuning() via overrides; defaultTuning() itself is unchanged"
    - "Saving tuning in the ?debug panel for one class never overwrites another class's saved tuning; RWD still uses heat-street.tuning.v1"
    - "FWD handbrake still unloads the rear (handbrakeRearSideFriction applied to RL/RR)"
    - "Engine force is zero on every wheel while braking (non-reversing) for every class; reverse force uses the same distribution"
    - "Omitting the drivetrain argument produces byte-identical RWD physics; determinism and telemetry baselines do not regress"
  artifacts:
    - path: "src/core/vehicle-class.ts"
      provides: "Class ids, allowlisted ?car= parser, per-class spec (colour, drive share, storage key), wheelEngineForces, classDefaultTuning"
      exports: ["KNOWN_VEHICLE_CLASS_IDS", "VehicleClassId", "DEFAULT_VEHICLE_CLASS_ID", "resolveVehicleClassId", "VEHICLE_CLASSES", "wheelEngineForces", "classDefaultTuning"]
    - path: "tests/vehicle-class.test.ts"
      provides: "Unit tests for parsing, distribution, derived tuning, storage keys"
    - path: "tests/vehicle-drivetrain.test.ts"
      provides: "Headless physics checks: RWD identity, each class accelerates, brake zeroes engine force"
  key_links:
    - from: "src/main.ts"
      to: "resolveVehicleClassId(location.search)"
      via: "class selection at composition root"
      pattern: "resolveVehicleClassId\\(location\\.search\\)"
    - from: "src/physics/vehicle.ts tick()"
      to: "wheelEngineForces"
      via: "per-wheel setWheelEngineForce for FL/FR/RL/RR"
      pattern: "wheelEngineForces\\("
    - from: "src/debug/tuning-panel.ts"
      to: "per-class storage key"
      via: "persist option replacing hardcoded TUNING_STORAGE_KEY in save + reset"
      pattern: "storageKey"
---

<objective>
Add FWD (green) and AWD/4WD (blue) player vehicle classes next to the existing RWD car (red) so the user can A/B handling, selected via an allowlisted `?car=rwd|fwd|awd` URL param.

Purpose: Drivetrain A/B testing without disturbing the hand-tuned RWD car, its tests, or its saved tuning.
Output: new `src/core/vehicle-class.ts` + tests, a drivetrain-aware `Vehicle.tick`, per-class colour, per-class tuning persistence.
</objective>

## Overlap with uncommitted work

The working tree has UNCOMMITTED user edits. This plan touches these files that are ALREADY dirty:

- `src/core/vehicle-tuning.ts` (user's hand-tuned RWD defaults — this plan only adds an optional parameter to `parseSavedTuning`; `defaultTuning()` body must not be touched)
- `src/main.ts` (user edit present — this plan adds class wiring)

Dirty files this plan must NOT touch at all: `tests/vehicle-tuning.test.ts`, `docs/vehicle-tuning-guide.md`, `src/core/racing-line.ts`, `src/loop.ts`, `src/input/race-commands.ts`, `.planning/debug/ai-pace-and-handbrake-feel.md`. (New tests go in new files specifically to avoid `tests/vehicle-tuning.test.ts`.)

**Recommendation to the orchestrator:** before executing, ask the user to commit their existing tuning edits (at least `src/core/vehicle-tuning.ts`, `tests/vehicle-tuning.test.ts`, `docs/vehicle-tuning-guide.md`, `src/main.ts`) so this task's commits contain only this task's changes. If the user declines, the executor MUST:
- never run `git checkout`, `git restore`, `git stash`, `git reset` or `git add -A`/`git add .`;
- stage by explicit path only;
- for the two overlapping files, stage only its own hunks (e.g. `git add -p <file>` is interactive and unsupported — instead commit those two files only if they were clean at start, otherwise leave this task's edits to them uncommitted and report it in the SUMMARY so the user can commit them together).

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@./CLAUDE.md
@src/core/map-select.ts
@tests/map-select.test.ts

<interfaces>
From src/core/map-select.ts (pattern to mirror exactly — array `find`, never object-key lookup):
  export const KNOWN_MAP_IDS = ["juliette-ga", "grid-test"] as const;
  export function resolveMapId(search: string): MapId  // URLSearchParams(search).get("map"); null/unknown -> default

From src/core/vehicle-tuning.ts:
  export interface VehicleTuning { chassis; wheels{ frictionSlip, frontSideFriction, rearSideFriction, ... }; drive{ engineForcePerRearWheel, brakeImpulsePerWheel, maxSteerLock, steerRampPerSec, steerReturnPerSec, handbrakeRearSideFriction, powerOversteerGain, reverseEngineForcePerRearWheel, reverseEngageSpeedMs }; assists }
  export function defaultTuning(): VehicleTuning        // RWD defaults — DO NOT EDIT
  export const TUNING_RANGES                            // rearSideFriction 0..0.3, frontSideFriction 0.2..1.5, frictionSlip 0.4..3, powerOversteerGain 0..2
  export function clampTuning(t): VehicleTuning         // uses defaultTuning() as non-finite fallback
  export const TUNING_STORAGE_KEY = "heat-street.tuning.v1";
  export function parseSavedTuning(raw: string | null): VehicleTuning | null   // internally: const result = defaultTuning(); copyLeaves(...); clampTuning(result)
  export function serializeTuning(t): string

From src/physics/vehicle.ts:
  export const FL = 0, FR = 1, RL = 2, RR = 3;
  export function createVehicle(world: RAPIER.World, tuning: VehicleTuning, spawn: {x,y,z}): Vehicle
  tick() step 2 (lines ~376-387): braking = frame.brake > 0; reversing = braking && forwardSpeedMs < t.drive.reverseEngageSpeedMs;
    engineForce = !braking ? -frame.throttle * t.drive.engineForcePerRearWheel : reversing ? frame.brake * t.drive.reverseEngineForcePerRearWheel : 0;
    vc.setWheelEngineForce(RL, engineForce); vc.setWheelEngineForce(RR, engineForce);   // fronts never set today (Rapier default 0)
  step 3 brake: brakeImpulse = reversing ? 0 : frame.brake * brakeImpulsePerWheel, all 4 wheels
  step 4 rear side friction: handbrake -> handbrakeRearSideFriction; else lerp(rearSideFriction, handbrakeRearSideFriction, clamp(powerOversteerGain*throttle*|steer|,0,1))

From src/physics/map-scene.ts:
  export function createMapScene(world, graph, collision, tuning: VehicleTuning, profiles: SurfaceProfiles): MapScene   // line ~375: createVehicle(world, tuning, spawn)

From src/render/vehicle-view.ts:
  const COLOUR_CHASSIS = 0xb5321f;   // player paint, passed to buildCarMeshes(..., COLOUR_CHASSIS) at ~line 482
  export function createVehicleView(wheelRadius, halfTrack, halfWheelbase, chassisHalfExtents, options?: { includePhase2Ground?; groundExtents? }): VehicleView

From src/debug/tuning-panel.ts:
  export function createTuningPanel(tuning, surfaces, cameraTuning, handlers: TuningPanelHandlers, storage?: TuningStorage): TuningPanel
  line ~674: store.set(TUNING_STORAGE_KEY, serializeTuning(tuning));
  line ~838-853 (reset): writeLeavesOnto(tuning, defaultTuning(), TUNING_RANGES); store.remove(TUNING_STORAGE_KEY);

From src/main.ts:
  line ~126: const tuning = parseSavedTuning(localStorage.getItem(TUNING_STORAGE_KEY)) ?? defaultTuning();
  line ~227: createMapScene(world, graph, collision, tuning, surfaceProfiles)
  line ~245-252: createAiFleet(... tuning ..., defaultAiDriverParams(tuning))
  line ~295: createVehicleView(tuning.wheels.radius, ..., { includePhase2Ground: false, groundExtents })
  line ~557: createTuningPanel(tuning, surfaceProfiles, cameraTuning, { onApplyVehicle: () => { scene.setTuning(tuning); fleet?.setTuning(tuning); }, ... })

From src/core/race-start.ts: AI_PAINTS = HIGHWAY YELLOW 0xf2c230, HIGHLAND GREEN 0x2e8b57, GRABBER BLUE 0x2f6fd6
</interfaces>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: vehicle-class module (ids, ?car= parser, drive distribution, derived tuning) + per-class parse base</name>
  <files>src/core/vehicle-class.ts, src/core/vehicle-tuning.ts, tests/vehicle-class.test.ts</files>
  <behavior>
    - resolveVehicleClassId("") and "?map=grid-test" -> "rwd"; "?car=fwd" -> "fwd"; "?mode=circuit&car=awd" -> "awd"
    - hostile/unknown "?car=FWD", "?car=", "?car=toString", "?car=__proto__", "?car=constructor", "?car=4wd" -> "rwd"
    - KNOWN_VEHICLE_CLASS_IDS equals exactly ["rwd","fwd","awd"]
    - wheelEngineForces(F, 0) -> [0, 0, F, F] with fronts Object.is-equal to +0 even when F is negative; rear values exactly F
    - wheelEngineForces(F, 1) -> [F, F, 0, 0] (rears +0)
    - wheelEngineForces(F, 0.4) -> fronts F*0.4 each, rears F*0.6 each; sum of all four equals 2*F within 1e-9 for any share
    - classDefaultTuning("rwd") deep-equals defaultTuning()
    - classDefaultTuning("fwd"/"awd") differ from defaultTuning() ONLY in the overridden leaves listed in the action, and clampTuning(structuredClone(x)) deep-equals x (all overrides inside TUNING_RANGES)
    - FWD default keeps handbrakeRearSideFriction == defaultTuning().drive.handbrakeRearSideFriction and has powerOversteerGain 0
    - classDefaultTuning returns a fresh object each call (mutating one does not affect the next)
    - VEHICLE_CLASSES.rwd.storageKey === TUNING_STORAGE_KEY ("heat-street.tuning.v1"); fwd/awd keys are distinct ("heat-street.tuning.fwd.v1", "heat-street.tuning.awd.v1"); all three keys unique
    - chassis colours: rwd 0xb5321f (unchanged red), fwd green, awd blue, all distinct from each other and from AI_PAINTS hex values
    - parseSavedTuning(raw, () => classDefaultTuning("fwd")) fills missing leaves from the FWD defaults; parseSavedTuning(raw) with no second arg behaves exactly as before
  </behavior>
  <action>
RED first: write tests/vehicle-class.test.ts covering every behavior bullet (mirror tests/map-select.test.ts style), run it, confirm it fails, commit `test(quick-261004-gmu): ...`.

GREEN: create src/core/vehicle-class.ts (pure, no three/rapier imports), modeled on src/core/map-select.ts:
- `KNOWN_VEHICLE_CLASS_IDS = ["rwd", "fwd", "awd"] as const`, `VehicleClassId`, `DEFAULT_VEHICLE_CLASS_ID = "rwd"`, `resolveVehicleClassId(search)` reading the `car` param with array `find` (never object-key lookup) per requirement 3.
- `interface VehicleClassSpec { id; label ("RWD"/"FWD"/"AWD"); chassisColor: number; frontDriveShare: number (0..1, fraction of total drive force on the front axle); storageKey: string }` and a frozen `VEHICLE_CLASSES: Readonly<Record<VehicleClassId, VehicleClassSpec>>`. Values: rwd = 0xb5321f / share 0 / TUNING_STORAGE_KEY; fwd = a saturated green such as 0x3fbf3f / share 1 / "heat-street.tuning.fwd.v1"; awd = a saturated blue such as 0x2a4dff / share 0.4 (mild rear bias keeps some muscle-car character; documented as the configurable front/rear bias) / "heat-street.tuning.awd.v1". Pick green/blue hexes that are visibly distinct from AI_PAINTS' HIGHLAND GREEN 0x2e8b57 and GRABBER BLUE 0x2f6fd6 (comment why). Index lookups into VEHICLE_CLASSES only ever use an already-allowlisted VehicleClassId.
- `wheelEngineForces(perWheelForce: number, frontShare: number): readonly [number, number, number, number]` in FL/FR/RL/RR order. Semantics: `perWheelForce` is today's per-rear-wheel value, i.e. total drive force is 2*perWheelForce, split frontShare to the front axle and 1-frontShare to the rear, halved per wheel: front each = perWheelForce*frontShare, rear each = perWheelForce*(1-frontShare). Normalize a zero result to +0 (e.g. `x === 0 ? 0 : x`) so RWD fronts are exactly the Rapier default 0 and RWD rears are exactly `perWheelForce` (x*1 is exact). Same function serves forward, reverse and the braking zero (0 in -> all zeros out), satisfying requirement 1.
- `classDefaultTuning(id): VehicleTuning` = `defaultTuning()` then apply overrides (requirement 2; no copied tuning objects):
  - rwd: no overrides.
  - fwd: `drive.powerOversteerGain = 0` (FWD cannot power-oversteer; this is the main neutral-to-understeer lever), `wheels.rearSideFriction = 0.3` (max of TUNING_RANGES, more rear grip than RWD's 0.28), `wheels.frontSideFriction = 1.2` (slightly less front bite -> understeer bias). Keep `handbrakeRearSideFriction` untouched so the handbrake still unloads the rear for handbrake turns.
  - awd: `wheels.frictionSlip = 1.8` (grippier), `wheels.rearSideFriction = 0.3`, `drive.powerOversteerGain = 0.5` (some throttle rotation from the rear-biased split, much less than RWD's 1.1). `engineForcePerRearWheel` unchanged: the distribution keeps total force at 2x it, so acceleration stays comparable.
  All override values must sit inside TUNING_RANGES (do not widen any range). Add a short doc comment on each override explaining intent.
- In src/core/vehicle-tuning.ts make ONE additive change: `parseSavedTuning(raw: string | null, base: () => VehicleTuning = defaultTuning)` and replace its internal `const result = defaultTuning();` with `const result = base();`. Do NOT touch `defaultTuning()`, TUNING_RANGES, or any other hunk (this file has uncommitted user edits — see "Overlap with uncommitted work"). Do not import vehicle-class.ts from vehicle-tuning.ts (avoid a cycle; vehicle-class imports vehicle-tuning).

Run tests until green; commit by explicit path.
  </action>
  <verify>
    <automated>npx vitest run tests/vehicle-class.test.ts tests/vehicle-tuning.test.ts tests/tuning-persist.test.ts tests/map-select.test.ts && npx tsc --noEmit</automated>
  </verify>
  <done>All new tests pass; existing vehicle-tuning / tuning-persist tests unchanged and still pass; defaultTuning() body untouched (git diff of vehicle-tuning.ts shows only the parseSavedTuning signature + one line beyond the user's pre-existing hunks).</done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: drivetrain-aware Vehicle.tick + map-scene pass-through</name>
  <files>src/physics/vehicle.ts, src/physics/map-scene.ts, tests/vehicle-drivetrain.test.ts</files>
  <behavior>
    - RWD identity: two worlds, one with createVehicle(world, t, spawn) and one with createVehicle(world, t, spawn, 0) (explicit RWD share), same scripted input sequence (throttle, steer, brake, handbrake, reverse) for ~300 ticks -> chassis translation/rotation/linvel bitwise equal (toBe on each component)
    - Each of share 0 / 1 / 0.4 with its classDefaultTuning reaches a forward speed > 10 m/s after 4 s of full throttle on flat ground (comparable acceleration, sanity only)
    - FWD (share 1) under full throttle on a straight moves forward without spinning out (yaw rate stays small); per-wheel split itself is covered by the pure wheelEngineForces tests in Task 1
    - Braking above reverseEngageSpeedMs with throttle also held stops the car for every share (Pitfall 7 preserved: engine force zeroed on all four wheels)
    - Reverse from standstill (brake held) produces negative forward speed for every share
  </behavior>
  <action>
Before editing, record the telemetry baseline on the CURRENT working tree: run `npx vitest run tests/vehicle-telemetry.test.ts tests/vehicle-recovery.test.ts` and note the failing test names (expected baseline: 8 failures — accel, brake, skidpad, handbrake, roll-stability, runAllRoutines in vehicle-telemetry; powerSlideRecovery and highSpeedPulse candidate-band tests in vehicle-recovery). Put the list in the SUMMARY.

Write tests/vehicle-drivetrain.test.ts first (RED), reusing the flat-ground headless harness pattern already used by tests/vehicle.test.ts / tests/determinism.test.ts (createWorld + a ground collider, DT-stepped loop: vehicle.tick(frame, tuning) then world.step()). Import FL..RR and classDefaultTuning/VEHICLE_CLASSES.

Then in src/physics/vehicle.ts:
- `createVehicle(world, tuning, spawn, frontDriveShare = 0)` — new optional 4th param, captured once in the closure (constant per vehicle, so tick stays a pure function of frame + tuning + physics state; no InputFrame change, per requirement 7 and the input-tape contract). Validate it is finite and within 0..1, throw RangeError otherwise.
- In tick step 2, keep the existing `braking`/`reversing`/`engineForce` computation exactly as is (engine force still zeroed while braking — Pitfall 7, requirement 1), then replace the two RL/RR setWheelEngineForce calls with `const forces = wheelEngineForces(engineForce, frontDriveShare)` and set all four wheels FL, FR, RL, RR. Reverse uses the same distribution automatically. Update the step-2 comment: with FWD/AWD the front wheels now carry engine force, so Pitfall 7 applies to them too — which is why engine force must stay zero on ALL wheels while braking, and why reverse zeroes the brake on all four (already true).
- Step 4 (rear side friction / handbrake) unchanged — the per-class tuning (powerOversteerGain 0 for FWD) shapes it; handbrake still drives RL/RR to handbrakeRearSideFriction for every class.
- Import wheelEngineForces from ../core/vehicle-class (core -> physics direction is already used for vehicle-tuning; confirm tests/layering.test.ts still passes).

In src/physics/map-scene.ts add optional trailing `frontDriveShare = 0` to createMapScene and forward it to its createVehicle call. Existing callers (tests, ai-fleet, vehicle-scene, surface-scene, telemetry run.ts) stay untouched and therefore RWD.

Re-run telemetry/recovery: failing set must be identical to the baseline (same names, no new failures). Do NOT edit or loosen any band.
  </action>
  <verify>
    <automated>npx vitest run tests/vehicle-drivetrain.test.ts tests/vehicle.test.ts tests/determinism.test.ts tests/map-scene.test.ts tests/layering.test.ts && npx vitest run tests/vehicle-telemetry.test.ts tests/vehicle-recovery.test.ts</automated>
  </verify>
  <done>New drivetrain tests pass; determinism, vehicle, map-scene, layering pass; telemetry+recovery failing set exactly matches the recorded 8-test baseline (the second command is expected to exit non-zero only with those 8).</done>
</task>

<task type="auto">
  <name>Task 3: wire class into composition root, paint, and per-class tuning persistence</name>
  <files>src/render/vehicle-view.ts, src/debug/tuning-panel.ts, src/main.ts</files>
  <action>
src/render/vehicle-view.ts: add optional `chassisColor?: number` to createVehicleView's `options`; use `options?.chassisColor ?? COLOUR_CHASSIS` where COLOUR_CHASSIS is passed to buildCarMeshes. Default stays red (requirement 4).

src/debug/tuning-panel.ts: add an optional 6th parameter `persist?: { readonly storageKey: string; readonly defaults: () => VehicleTuning }`, defaulting to `{ storageKey: TUNING_STORAGE_KEY, defaults: defaultTuning }`. Replace the hardcoded vehicle key in the save (`store.set(TUNING_STORAGE_KEY, ...)`) and reset (`store.remove(TUNING_STORAGE_KEY)`) with `persist.storageKey`, and the reset's `defaultTuning()` with `persist.defaults()`. Surface and camera keys stay shared and unchanged. Optionally append the class label to the GUI title only if a label is passed — not required; keep "Vehicle Tuning [DEV]" otherwise.

src/main.ts (dirty file — keep the user's existing hunk intact):
- `import { resolveVehicleClassId, VEHICLE_CLASSES, classDefaultTuning } from "./core/vehicle-class"`; `const CAR_CLASS = VEHICLE_CLASSES[resolveVehicleClassId(location.search)]` next to `AREA_ID`/the tuning load (must be computed before `tuning`).
- Load player tuning per requirement 5: `parseSavedTuning(localStorage.getItem(CAR_CLASS.storageKey), () => classDefaultTuning(CAR_CLASS.id)) ?? classDefaultTuning(CAR_CLASS.id)`. For RWD this is exactly the old expression's behavior (same key, same defaults).
- AI fleet stays RWD: when CAR_CLASS.id === "rwd", pass the same `tuning` object as today (zero behavior change, and panel edits still reach the fleet). Otherwise build a separate `aiTuning` from the RWD key/defaults (`parseSavedTuning(localStorage.getItem(TUNING_STORAGE_KEY)) ?? defaultTuning()`) and use it for createAiFleet, defaultAiDriverParams, and `fleet?.setTuning` — the panel's onApplyVehicle then calls `fleet?.setTuning(aiTuning)` (a no-op change) so FWD/AWD edits never leak into RWD AI cars.
- `createMapScene(world, graph, collision, tuning, surfaceProfiles, CAR_CLASS.frontDriveShare)`.
- `createVehicleView(..., { includePhase2Ground: false, groundExtents, chassisColor: CAR_CLASS.chassisColor })`.
- `createTuningPanel(tuning, surfaceProfiles, cameraTuning, handlers, undefined, { storageKey: CAR_CLASS.storageKey, defaults: () => classDefaultTuning(CAR_CLASS.id) })`.
- Do not touch src/loop.ts or other dirty files.

Then run the full check. Stage by explicit path only; for src/main.ts follow the "Overlap with uncommitted work" rule (commit only if the user committed their edits first, otherwise leave uncommitted and report).
  </action>
  <verify>
    <automated>npx tsc --noEmit && npx biome check src tests && npx vitest run</automated>
  </verify>
  <done>Typecheck and lint clean; full vitest run fails only on the recorded 8-test telemetry baseline; `?car=fwd` / `?car=awd` load green / blue cars with their own storage keys; no param, `?car=rwd`, or junk loads the red RWD car with heat-street.tuning.v1.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| URL query -> class selection | `?car=` is attacker/user-controlled text |
| localStorage -> VehicleTuning | per-class saved tuning blobs are user-editable |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-gmu-01 | Tampering | resolveVehicleClassId | mitigate | Array `find` exact match against KNOWN_VEHICLE_CLASS_IDS, default "rwd"; prototype keys tested |
| T-gmu-02 | Tampering | per-class saved tuning | mitigate | Every class blob goes through parseSavedTuning (clampTuning, finite/in-range leaves); class defaults stay inside TUNING_RANGES (tested) |
| T-gmu-03 | Denial of Service | createVehicle frontDriveShare | mitigate | RangeError on non-finite or out-of-0..1 share; value only ever comes from the frozen VEHICLE_CLASSES table |
| T-gmu-04 | Tampering | medal-time comparability | accept | Debug/dev A/B feature; tuning panel stays ?debug-gated as before |
</threat_model>

<verification>
- `npx vitest run tests/vehicle-class.test.ts tests/vehicle-drivetrain.test.ts tests/determinism.test.ts` green
- Telemetry/recovery failing set identical to the pre-change baseline (8 tests), no band edited
- `git diff src/core/vehicle-tuning.ts` shows `defaultTuning()` untouched
- `npx tsc --noEmit && npx biome check src tests` clean
</verification>

<success_criteria>
- Three classes selectable via allowlisted `?car=`, red/green/blue paint
- Drive force distributed per class (rear / front / 40:60 split), zeroed while braking, reverse uses same split
- Per-class tuning derived from defaultTuning() via overrides, per-class storage keys, RWD key unchanged
- RWD path byte-identical; determinism and telemetry baselines unchanged
- No user uncommitted hunks reverted or committed by the executor
</success_criteria>

<output>
Create `.planning/quick/261004-gmu-add-fwd-and-4wd-vehicle-classes-with-col/261004-gmu-SUMMARY.md` when done (include the recorded telemetry baseline and which overlapping files were or were not committed).
</output>
