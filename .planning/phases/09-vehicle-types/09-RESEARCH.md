# Phase 9: Vehicle Types - Research

**Researched:** 2026-11-22
**Domain:** Rapier raycast-vehicle class system (TypeScript, headless physics tests)
**Confidence:** HIGH for code-structure findings (read directly from the repo today); MEDIUM for monster-truck physics feasibility (unverified, that is the stage 6 spike)

## Summary

The brief (`.planning/plans-ahead/03-vehicle-types.md`, written 2026-11-15) is still accurate on its structural claims. Verified today: `KNOWN_VEHICLE_CLASS_IDS = ["rwd","fwd","awd"]`, `clampTuning(t)` / `parseSavedTuning(raw, base)` take no ranges argument, one set of wheel/suspension values serves all four wheels, `createVehicle(world, tuning, spawn, frontDriveShare = 0)`. No new packages are needed for this phase (Rapier 0.20.0, three 0.185.1, vitest 5.0.0 already installed), so the Package Legitimacy Audit is not applicable.

The brief's stage list needs these corrections and additions, found by reading code today:

1. **D-08 premise is wrong.** Nothing in `src/main.ts` gates medal saving on the car class. `saveMedalResult` (around main.ts:1007-1017) is reached for `fwd` and `awd` exactly as for `rwd`. The brief says "if it saves them today, raise it with the user instead of changing it silently." Raise it (see Open Questions Q1). The new vehicles must not silently save medals either.
2. **Adding a `rear` subtree to `TUNING_RANGES` would break `clampNode`.** `clampNode` (src/core/tuning-utils.ts) walks the RANGES tree, not the value tree. For every range key it creates the missing value subtree and reads `fallbackNode[key]`. If `wheels.rear` is added to `TUNING_RANGES`, every existing tuning object would gain a `rear: {...}` filled from a fallback that does not exist (crash on `undefined[key]`), and serialised/saved blobs would change. D-03 ("absent means same as front") therefore requires a separate, conditional `clampRear` step that only runs when `rear` is present, with ranges taken from the front-wheel leaves.
3. **`runRoutine` cannot drive an AWD car today.** `src/physics/telemetry/run.ts` calls `createVehicle(world, tuning, SPAWN)` with no `frontDriveShare` and a fixed spawn `y: 1`. Rally/truck/monster are AWD, so the headless 0-60/accel measurement needs an optional options argument (`frontDriveShare`, `spawnY`) added to `runRoutine`, default behaviour byte-identical. Spawn at y=1 is also too low for a 0.9 m-radius monster (wheel radius 0.9 plus rest length 1.2).
4. **The AI/pursuer render meshes are built from the PLAYER's tuning in `main.ts`** (lines ~725-738: `createAiVehicleViews(..., tuning.wheels.radius, tuning.wheels.halfTrack, ..., tuning.chassis.halfExtents, ...)` for both `aiViews` and `pursuitViews`). With `?car=monster` the AI muscle cars would be drawn with monster-size bodies while their physics (`aiTuning`) stays car-size. Must change to `aiTuning`. This is a visible bug that the brief's AI trap list ("must never leak into aiTuning") does not cover.
5. **`tuning-snapshot.ts` also calls `parseSavedTuning(JSON.stringify(parsed.vehicle))`** (line 124) with default ranges. Importing a monster-truck snapshot file in the panel would clamp it to car ranges. It needs the active class ranges threaded in too, as do the panel's reset-to-defaults and import paths (tuning-panel.ts ~977, ~1035).
6. **The wheel-ray patch has no car-size constants** (read `src/physics/wheel-ray-patch.ts`: it shadows heightfield cells; window is 32 cells and re-centres at an 8 cell margin). The brief's worry about it assuming car-sized wheels is not borne out by the header and constants; the real car-size assumptions are in `vehicle.ts` (see Pitfalls).
7. **The drivetrain todo is already closed.** `.planning/todos/pending/` contains only an unrelated editor todo; CONTEXT.md says the drivetrain and other-vehicles todos were closed and folded in 2026-11-16. Stage 8 step 4 reduces to a note in docs, not a todo move.

**Primary recommendation:** Do stage 0 (golden test, literals recorded on the untouched tree and committed before any other change) first, build stages 1-3 as pure additive changes guarded by it, run the monster spike, stop for the user, then finish the pickup and monster.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01:** Extend the existing class system in `src/core/vehicle-class.ts`; no second registry. Existing ids, storage keys and behaviour unchanged.
- **D-02:** Per-class tuning ranges: `classTuningRanges(id)`; `clampTuning` and `parseSavedTuning` take ranges as a parameter defaulting to `TUNING_RANGES`.
- **D-03:** Per-axle suspension as an optional `wheels.rear` override; absent means same as front, so existing tuning objects and saved blobs do not change.
- **D-04:** `engineForcePerRearWheel` is not renamed.
- **D-05:** Roster and starting numbers are the table in the brief (D5). They are starting points; tune headlessly against measured targets, then the user drives.
- **D-06:** Per-vehicle surface grip multipliers (`surfaceGripScale`) on the class spec; all 1.0 for existing classes.
- **D-07:** AI keeps driving the muscle car. **Default pending user confirmation (ASK in brief D7).**
- **D-08:** Non-`rwd` runs show a time but do not save a medal; match how `fwd`/`awd` are treated today and raise it with the user if that differs.
- **D-09:** A golden test (stage 0) pins `rwd`, `fwd`, `awd` end states on a fixed input tape and stays green through the whole phase. Its job is to catch accidental changes, not to protect medal times (user, 2026-11-15: medal times need not be retained at this stage). It may be updated only for a deliberate handling change the user has approved.
- **D-10:** The monster truck is a time-boxed spike (stage 6) with a written result and a stop for the user before the pickup and monster truck are built. If it fails, do not start an arcade-assist layer or a physics-engine change without the user.

### Claude's Discretion
Final tuning values within the measured targets, colours (distinct from the AI paints), wave split.

### Deferred Ideas (OUT OF SCOPE)
- AI racers and pursuers in other vehicle classes
- Per-vehicle medal times
- Vehicle select screen
- Renaming `drive.engineForcePerRearWheel` (`src/core/vehicle-tuning.ts`, `src/core/feel.ts`) to a drivetrain-neutral name: kept out by D-04, revisit once real car classes settle
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| VEH-06 | Multiple vehicle types with distinct handling (promoted from v2) | Class spec extension, per-class ranges, per-axle suspension, `surfaceGripScale`, roster table (brief D5) |
| VEH-07 | Vehicles differ by body/wheels/suspension (promoted from v2) | `wheels.rear` override, `buildCarMeshes` rear radius, widened ranges, monster spike |
| Drivetrain todo | Configurable drivetrain per car class | Already implemented (rwd/fwd/awd via `frontDriveShare`); new classes reuse `frontDriveShare`; todo closed 2026-11-16 per CONTEXT.md |
</phase_requirements>

## Project Constraints (from CLAUDE.md)

- Stack is fixed: Three.js + Rapier (`@dimforge/rapier3d`, non-compat) + TypeScript + Vite; vitest for tests, biome for lint, `lil-gui` tuning panel gated behind `?debug`.
- Fixed-timestep physics at 1/60; never variable-dt (medal-time integrity).
- Do not unit-test feel; test measurable numbers (0-60, settle time, tilt), then ask the user to drive.
- Vanilla TS + DOM, no ECS, no UI framework; plain classes.
- No real manufacturer names or exact vehicle reproductions (generic names: Dune Buggy, Rally Coupe, 4x4 Pickup, Monster Truck).
- CLAUDE.md names the arcade-assist layer as the fallback for handling failures, only then Jolt; D-10 says neither without the user.
- GSD workflow: edits go through GSD commands. Gates: `npm run check` (typecheck, biome lint, vitest).
- Memories cited in CONTEXT: saved browser tuning hides new defaults; fix the car, not the terrain.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Class spec, ranges, default tuning, `wheelParams`, clamp/parse | `src/core/` (pure) | — | No three/rapier imports allowed in core (layering test) |
| Per-axle wheel setup, `surfaceGripScale` application, mass/inertia | `src/physics/vehicle.ts` | `src/physics/telemetry/` | Only place that calls Rapier wheel setters |
| Proportions on screen (body box, wheel radii) | `src/render/vehicle-view.ts`, `ai-vehicle-view.ts` | `main.ts` wiring | Already sized from tuning |
| Panel ranges, persistence, reset | `src/debug/tuning-panel.ts` | `main.ts` passes class ranges | Panel builds sliders from ranges |
| `?car=` selection | `src/core/vehicle-class.ts` allowlist | `main.ts` | Existing allowlist pattern |
| Headless measurement (0-60, settle, tilt) | `tests/` + `src/physics/telemetry/` | `scripts/` | Existing headless Rapier harness |

## Standard Stack

No new dependencies. Everything below is already in `package.json`.

| Library | Version | Purpose | Source |
|---------|---------|---------|--------|
| `@dimforge/rapier3d` | 0.20.0 | `DynamicRayCastVehicleController` | [VERIFIED: package.json] |
| `three` | 0.185.1 | Body/wheel meshes | [VERIFIED: package.json] |
| `vitest` | 5.0.0 (v5.0.0 ran today, 9 tests pass in 1.23 s) | Headless physics tests | [VERIFIED: ran `npx vitest run tests/vehicle-drivetrain.test.ts`] |
| `lil-gui` | existing | Tuning panel | [VERIFIED: codebase] |

## Package Legitimacy Audit

Not applicable: this phase installs no external packages. Packages removed: none. Packages flagged: none.

## Architecture Patterns

### Data flow
```
?car=<id> --resolveVehicleClassId (allowlist)--> VEHICLE_CLASSES[id]
  spec: label, colour, frontDriveShare, storageKey, surfaceGripScale
  classDefaultTuning(id) --> shippedTuning(id) (+ FEEL_DEFAULTS via applyFeel)
  classTuningRanges(id) --> parseSavedTuning(saved, base, ranges) --> tuning
        |                                 |-> tuning-panel sliders (ranges)
        |                                 |-> panel reset / import / tuning-snapshot import
        v
  createVehicle(world, tuning, spawn, frontDriveShare, { surfaceGripScale })
    wheelParams(tuning, i) -> addWheel / applyTuning / per-tick stiffness write
  buildCarMeshes(radius, halfTrack, halfWheelbase, halfExtents, colour, rearRadius?)
AI fleet + pursuers: aiTuning (RWD) for BOTH physics and meshes
```

### Stage-to-code map (verified call sites)

| Stage | Files and exact touch points |
|-------|------------------------------|
| 1 ranges | `vehicle-tuning.ts`: `clampTuning` (line ~990), `parseSavedTuning` (~1031), export `TuningRanges` type; `feel.ts:198` `applyFeel` calls `clampTuning(target)` (must clamp to the class ranges or feel-panel values for monster get clamped to car ranges; give `applyFeel` an optional ranges argument defaulting to `TUNING_RANGES`); `main.ts:207` and `:220` (the second is the AI blob, keep default ranges); `tuning-snapshot.ts:124`; `tuning-panel.ts` (~70 `addNumber` calls each hard-coding `TUNING_RANGES.x.y`, plus 977, 1035) |
| 2 per-axle | `vehicle.ts`: `w0`/`restLength` init (~line 360-371), `applyTuning` loop (378-391, including `setWheelChassisConnectionPointCs` which uses `w.connectionY`), bump-stop block (~540-560: uses `w.maxSuspensionTravel`, `w.suspensionRestLength`, `w.suspensionStiffness` for all four wheels together and gates `heavy` on the minimum compression of all four) , `lastSuspensionLength` seed; `vehicle-view.ts:278` `buildCarMeshes`; `ai-vehicle-view.ts`; `main.ts:682-738` |
| 3 grip scale | `vehicle.ts` ~594-608: multiply `profile.lateralGrip` / `profile.forwardGrip` by the class scale at the point they are read into `blendLateral/blendForward`. Multiplying by exactly `1` is IEEE-exact so all-ones keeps rwd/fwd/awd bit-identical; no scale applied when `surfaces` is undefined. Scale must be keyed by wheel surface (`wheelSurfaces[i]`) |
| 4-5 rally, buggy | `vehicle-class.ts` only (+ ranges for buggy mass min 500) |
| 6-7 | spike branch, then pickup/monster |

### Anti-patterns
- Adding `rear` to `TUNING_RANGES` (see Summary item 2).
- Deleting or restructuring the rear-only oversteer terms (brief trap; they assume rear-drive).
- Applying `surfaceGripScale` anywhere other than the single place where surface profile grip is read.
- Calling `setAdditionalMassProperties` anywhere except through the existing `lastMass/lastHalfExtents` path in `applyTuning`.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead |
|---------|-------------|-------------|
| Clamp and sanitise saved tuning | A second validator | Existing `clampNode`/`copyLeaves` with a ranges parameter; one small conditional rear clamp |
| Headless physics harness | New world builder | `createWorld()` + flat cuboid ground as in `tests/vehicle-drivetrain.test.ts`, or `runRoutine`/`buildTelemetryScene` |
| Input tapes | New format | `ReplayInput`/`InputFrame` (`src/core/input-tape.ts`), closed-form tapes as in `tests/determinism.test.ts` |
| 0-60 measurement | Custom timer | The `accel` routine's logic (`runRoutine`), with the options extension |
| Class registry | Second table | `VEHICLE_CLASSES` |

## Runtime State Inventory

Not a rename/migration phase, but note persisted state:

| Category | Items Found | Action |
|----------|-------------|--------|
| Stored data | localStorage per-class tuning blobs: `heat-street.tuning.v1` (rwd), `.fwd.v1`, `.awd.v1`; new keys `heat-street.tuning.<id>.v1` for rally/buggy/truck/monster. Feel blob `heat-street.feel.v1` is shared by ALL classes. | Code edit only. Shared feel blob: `?feel` sliders are 0-10 multipliers on the class base, so sharing is workable, but note it in the guide. Human check must use a private window (rule 7). |
| Live service config | None | None |
| OS-registered state | None | None |
| Secrets/env | None | None |
| Build artifacts | None | None |

## Common Pitfalls

### Pitfall 1: Silent range clamping (and `applyFeel` clamping)
Values outside the active ranges are clamped on load, by the panel, and by `applyFeel`. If a new class "ignores" a default, check ranges at all three. **Check:** a test per class that `clampTuning(classDefaultTuning(id), classTuningRanges(id))` returns an unchanged object (deep equal), and the same through `shippedTuning(id)`.

### Pitfall 2: `shippedTuning` vs `classDefaultTuning`
The shipped car is `shippedTuning(id)` (class default plus `FEEL_DEFAULTS` through `applyFeel`). `tests/vehicle-drivetrain.test.ts` uses `classDefaultTuning`. The golden test must use `shippedTuning` (brief says so; the dossier also uses it with `FEEL_DOSSIER_CAR=shipped`).

### Pitfall 3: `runRoutine` is RWD-only and flat-spawn-only
See Summary item 3. Without the options extension, an AWD "0-60" reading is a front-wheels-do-nothing RWD number.

### Pitfall 4: Spawn height for tall/large-wheel vehicles
`runRoutine` spawns at y=1; `SPAWN_CLEARANCE_M = 0.6` above the node in map-scene and terrain-scene (`map-scene.ts:74`, terrain-scene.ts:142). Wheel bottom with suspension at full droop is `connectionY - restLength - radius` relative to the chassis origin. For the monster (rest 1.2 + radius 0.9 = 2.1 m below the connection point) the car spawns with the wheels below the ground or the chassis inside it. Need class-dependent spawn clearance (derive from tuning: `radius + restLength + connectionY` style) for the non-golden path only; `resetPose` / respawn / `resolveStartPose` paths also need review. Keep the existing 0.6 for existing classes.

### Pitfall 5: Hard-coded car-scale constants in `vehicle.ts`
Not wheel-ray-patch. Known: `BUMP_STOP_ONSET = 0.75`, `BUMP_STOP_GATE_M = 0.06` (absolute 6 cm gate, meaningful for car travel; a 1.0 m travel monster should scale it), `CHASSIS_FRICTION = 0.15`, `ROLL_GUARD_ONSET_DEG/FULL_DEG`, `LANDING_CUSHION_GAIN = 30` and `GRAVITY` in `vehicle-assists.ts` (mass-relative via cached inertia per the brief but unverified for 4500 kg). Report absolute constants rather than guessing; if one must become class-relative, express it as `constant * classScale` where the class scale is exactly 1 for existing classes.

### Pitfall 6: AI meshes from player tuning (Summary item 4)
### Pitfall 7: `driftHold`, `looseTraction`, `pivotTurn` and the other assists were authored for the muscle car
They act on rear friction and yaw; for AWD trucks turn them down through tuning (as `fwd`/`awd` do) rather than editing code. `looseTraction` (the loose-ground assist) is newer than the brief and applies on mud/sand/gravel/grass/dirt; check its effect on the new vehicles in the skidpad-per-surface routines.

### Pitfall 8: Rapier `maxSuspensionForce` and stiffness for heavy bodies
Static load per wheel for 4500 kg is about 11 kN; brief says allow 5-10x. Stiffness is mass-normalised by Rapier, so re-derive from target static sag (30-40 percent of travel) [CITED: brief stage 6; Rapier behaviour per `vehicle-tuning.ts` comment "Mass-normalised by Rapier's own solver"]. Treat as spike input, not as verified.

## Code Examples

### Golden test skeleton (stage 0)
```typescript
// tests/vehicle-rwd-golden.test.ts  (pattern from tests/vehicle-drivetrain.test.ts)
import * as RAPIER from "@dimforge/rapier3d";
import { describe, expect, it } from "vitest";
import { shippedTuning } from "../src/core/feel";
import type { InputFrame } from "../src/core/input-tape";
import { VEHICLE_CLASSES, type VehicleClassId } from "../src/core/vehicle-class";
import { createVehicle } from "../src/physics/vehicle";
import { createWorld } from "../src/physics/world";

const TAPE = (i: number): InputFrame => ({ /* closed-form segments over 600 ticks:
  throttle, steer left, handbrake, brake — no randomness */ } as InputFrame);

function endState(id: VehicleClassId) {
  const tuning = shippedTuning(id);
  const world = createWorld();
  const g = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(0, -0.5, 0));
  world.createCollider(RAPIER.ColliderDesc.cuboid(500, 0.5, 500), g);
  const v = createVehicle(world, tuning, { x: 0, y: 1, z: 0 }, VEHICLE_CLASSES[id].frontDriveShare);
  for (let i = 0; i < 600; i++) { v.tick(TAPE(i), tuning); world.step(); }
  return { p: v.body.translation(), q: v.body.rotation(), lv: v.body.linvel(), av: v.body.angvel() };
}
// expect(...).toBeCloseTo(LITERAL, 6) per component, literals recorded from the untouched tree
```
Record literals with a one-off script on the clean checkout and commit the test in the first plan before any other source change. Also pin `av` (angular velocity) since it is a cheap extra tripwire. The tape must exercise the surface path too? The surface path only runs when `surfaces` is supplied to `tick`; to protect the Stage 3 `surfaceGripScale` change, add a second golden run on a painted/registered surface (use `createSurfaceMap` + default `SurfaceProfiles` as `runRoutine` does with `SurfaceRunOpts`). Without it, stage 3 is unprotected because the flat-ground-no-surface path never executes the changed lines.

### Headless measurement helpers (stage 4+)
```typescript
// tilt (deg) from body quaternion: angle between chassis up and world up
const upY = 1 - 2 * (q.x * q.x + q.z * q.z);       // y component of rotated (0,1,0)
const tiltDeg = (Math.acos(Math.min(1, Math.max(-1, upY))) * 180) / Math.PI;
// settle time: tick at which chassis y stays within +-0.01 m of its tick-300 value to the end
// 0-60: forwardSpeedMs >= 26.8224 (MPH_60_MS); via runRoutine(accelRoutine, tuning, undefined, undefined, { frontDriveShare, spawnY })
```
Source: the repo's own routines (`routines.ts` accel/ramp/stability use the same quantities).

## State of the Art

Not applicable (no library choices). Note Rapier 0.20.0 index-based vehicle API is authoritative (CLAUDE.md).

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Rapier raycast vehicle can hold a 4500 kg body on 0.9 m wheels with 1 m travel | Pitfall 8 / stage 6 | This is the spike's question; failure means user decision (D-10) |
| A2 | Static sag target 30-40 percent of travel is reasonable | Pitfall 8 | Spike retunes |
| A3 | Rapier golden literals are reproducible across machines to 1e-6 | Code Examples | Rapier non-deterministic build is not cross-platform guaranteed; a literal recorded on this machine may differ on CI. Mitigate: this project is single-dev/local; if a second machine is used, loosen to 1e-4 and say so |
| A4 | Multiplying surface grip by exactly 1.0 is bit-identical | Stage-to-code map | IEEE-754 guarantees x*1 === x for finite x; the golden-with-surface test proves it |

## Open Questions

1. **D-08: fwd/awd save medals today.** No class gate exists in `main.ts`. Options: (a) leave as is for fwd/awd and gate only the four new classes to "show time, no medal"; (b) gate everything non-rwd. Needs the user because it changes current behaviour for fwd/awd under (b). Recommend (a): zero change to shipped behaviour, new classes (which cannot be compared against rwd medal times) do not save. Where to gate: the `saveMedalResult` call site (~main.ts:1007) and the solo coordinator's medal path; confirm how a "show time without medal" result displays (results view) before planning.
2. **D-07 AI stays muscle cars** is still a default awaiting confirmation; research assumes yes. The leak fix in Summary item 4 is needed either way.
3. **Camera framing** for the tall/long vehicles (`camera-tuning.ts`): decide after the spike with a visual check; the class spec field is conditional.
4. **Collision with AI at 4500 kg** (stage 7.5): measure headlessly; mitigation is restitution, not mass.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node | everything | yes | >=24 (project engines; vitest ran) | — |
| vitest | tests, dossier | yes | 5.0.0 | — |
| Rapier WASM in Node | headless tests | yes | 0.20.0 (existing tests pass) | — |
| Browser + gamepad/keyboard | human check | user-provided | — | — |

Missing dependencies: none.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest 5.0.0, `environment: node`, Rapier inlined via `server.deps.inline` |
| Config file | `vitest.config.ts`; dossier config `vitest.dossier.config.ts` |
| Quick run command | `npx vitest run tests/vehicle-rwd-golden.test.ts tests/vehicle-class.test.ts tests/vehicle-tuning.test.ts` |
| Full suite command | `npm run check` (typecheck, biome, vitest run) |
| Handling report | `npm run feel-dossier` (use `FEEL_DOSSIER_CAR=shipped`; output dir `out/feel-dossier`) |

Note the dossier script only builds `shippedTuning()` for the default class (rwd) and `defaultTuning()` otherwise; stage 8's "identical output to stage 0" check applies to the rwd shipped run. Save the stage 0 output outside the repo (scratchpad) and diff.

### Phase Requirements to Test Map
| Req / SC | Behavior | Test Type | Automated Command | File Exists? |
|----------|----------|-----------|-------------------|-------------|
| SC2 / D-09 | rwd/fwd/awd end state on a 600-tick tape unchanged (flat, plus painted-surface run) | golden | `npx vitest run tests/vehicle-rwd-golden.test.ts` | Wave 0 |
| VEH-06 | `resolveVehicleClassId` accepts the 4 new ids, rejects hostile values; ids list updated | unit | `npx vitest run tests/vehicle-class.test.ts` | exists, update the exact-list assertion |
| VEH-06 | `classTuningRanges`: existing ids return `TUNING_RANGES` (same reference); new ids widened; every class default and shipped tuning is inside its own ranges | unit | `npx vitest run tests/vehicle-class.test.ts` | extend |
| VEH-06 | `clampTuning`/`parseSavedTuning` default-arg behaviour unchanged; custom range clamps to own bounds; blob without `rear` parses as before and gains no `rear` key | unit | `npx vitest run tests/vehicle-tuning.test.ts tests/tuning-persist.test.ts` | exists, extend |
| VEH-07 | `wheelParams(t, i)`: no rear → front values for all 4; rear.radius → wheels 2,3 differ; hostile rear values clamped | unit | `npx vitest run tests/vehicle-tuning.test.ts` | extend |
| VEH-07 | `surfaceGripScale` lateral 0.5 on tarmac lowers steady skidpad g; all-ones identical | integration | `npx vitest run tests/surface-telemetry.test.ts` (or new file) | Wave 0 |
| SC4 | Per vehicle: 0-60 within +-15% of target (rally 4, buggy 5, truck 8, monster 9 s); settle < 2 s and stable within 1 cm; max tilt in full-lock turn at 15 m/s; no wheel loses contact on flat ground | integration | `npx vitest run tests/vehicle-types-targets.test.ts` | Wave 0 |
| SC3 | Spike result file exists with numbers | doc | `test -f .planning/plans-ahead/03-monster-spike-result.md` | Wave 0 (human gate: user reads it) |
| SC1 | Each `?car=` loads with proportions/ranges/storage key; storage keys unique and distinct from existing; colours distinct from `AI_PAINTS` | unit | `npx vitest run tests/vehicle-class.test.ts` (existing test already imports `AI_PAINTS`) | extend |
| Docs | New panel controls (if any) named in guide | unit | `npx vitest run tests/tuning-guide-sync.test.ts` | exists; fails if guide misses a bound control |
| SC4 human | One minute per vehicle on `?map=feel-test` | manual | — | manual only (feel) |

Test-design note: `ROUTINES` pass bands in `TELEMETRY_TARGETS` (accel 3.0-4.5 s etc.) are the muscle car's. Do not use `RoutineResult.pass` for new classes; read `.value` and compare to a per-class target table kept in the new test or as data in `vehicle-class.ts`.

### Sampling Rate
- Per task commit: golden test plus the touched module's test file
- Per wave merge: `npm run check`
- Phase gate: `npm run check` green with the golden test unmodified, rwd dossier identical, spike note read by the user, human check done

### Wave 0 Gaps
- [ ] `tests/vehicle-rwd-golden.test.ts` — literals recorded from the untouched tree (flat run and a painted-surface run, for rwd/fwd/awd)
- [ ] `runRoutine` options extension (`frontDriveShare`, `spawnY`), default call byte-identical
- [ ] `tests/vehicle-types-targets.test.ts` — per-class 0-60 / settle / tilt measurement
- [ ] Optional skidpad scale test for `surfaceGripScale`

## Security Domain

Applicable: localStorage blobs and imported tuning files are untrusted input (ASVS V5), already guarded by `clampNode`/`copyLeaves`.

| ASVS Category | Applies | Control |
|---------------|---------|---------|
| V5 Input validation | yes | Existing `parseSavedTuning` boundary; the new `rear` override and class ranges must go through the same finite-number + range clamp; `?car=` stays an exact-match array `find` allowlist (existing test covers `__proto__`, `constructor`) |
| V2/V3/V4/V6 | no | n/a (no auth, sessions, crypto) |

| Threat | STRIDE | Mitigation |
|--------|--------|------------|
| NaN/Infinity mass or rear radius reaching `world.step()` | Tampering | Clamp with finite fallback to class default; test hostile `rear` blob |
| Prototype-pollution via `rear` or `__proto__` key in blob | Tampering | `copyLeaves` only copies keys named in the ranges tree; keep the rear copy keyed by the explicit seven field names |
| Unknown `?car=` value | Tampering | Existing allowlist |

## Sources

### Primary (HIGH confidence, read directly in this session)
- `src/core/vehicle-class.ts`, `vehicle-tuning.ts` (clamp/parse/ranges), `feel.ts`, `tuning-utils.ts`, `tuning-snapshot.ts`
- `src/physics/vehicle.ts` (createVehicle, applyTuning, bump stop, surface path), `wheel-ray-patch.ts` header, `telemetry/run.ts`, `telemetry/routines.ts` (accel, targets)
- `src/main.ts` (class wiring 198-221, view creation 680-740, panel 1100-1150, medal save)
- `tests/determinism.test.ts`, `tests/vehicle-drivetrain.test.ts`, `tests/vehicle-class.test.ts`, `tests/tuning-guide-sync.test.ts`, `vitest.config.ts`, `vitest.dossier.config.ts`, `scripts/feel-dossier.run.ts`
- `.planning/plans-ahead/03-vehicle-types.md`, `09-CONTEXT.md`, `CLAUDE.md`
- Ran `npx vitest run tests/vehicle-drivetrain.test.ts` today: 9 passed.

### Not verified
- Monster-truck physical feasibility (spike), exact line numbers will drift; re-grep before editing.
- Did not read `docs/vehicle-tuning-guide.md`, the `offroad-point-to-point-stages` seed, `vehicle-assists.ts` in full, or `surface-tuning.ts` profile values; the planner should read the guide before the docs stage (the sync test requires every bound panel control to be named in it).

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH (no change)
- Architecture and call sites: HIGH (read from code today)
- Pitfalls: MEDIUM (heavy-body physics is unknown until the spike)

**Research date:** 2026-11-22
**Valid until:** about 14 days; Phase 7.x work is still landing in `main.ts`, so re-grep line numbers.
