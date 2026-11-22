# Phase 9: Vehicle Types - Pattern Map

**Mapped:** 2026-11-22
**Files analyzed:** 17 (new and modified)
**Analogs found:** 17 / 17 (two have no direct analog for the new behaviour, see end)

Line numbers drift (Phase 7.x still landing in `main.ts`). Re-grep before editing.

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match |
|---|---|---|---|---|
| `tests/vehicle-rwd-golden.test.ts` (new) | test (golden) | batch / transform | `tests/vehicle-drivetrain.test.ts` + `tests/determinism.test.ts` | role-match |
| `tests/vehicle-types-targets.test.ts` (new) | test (telemetry) | batch | `tests/surface-telemetry.test.ts` + `src/physics/telemetry/routines.ts` accel | role-match |
| `tests/vehicle-class.test.ts` (modify) | test | unit | itself | exact |
| `tests/vehicle-tuning.test.ts`, `tests/tuning-persist.test.ts` (extend) | test | unit | themselves | exact |
| `src/core/vehicle-class.ts` (modify) | config / registry | request-response (lookup) | itself (rwd/fwd/awd entries) | exact |
| `src/core/vehicle-tuning.ts` (modify: ranges param, `wheels.rear`, `wheelParams`, `TuningRanges`) | model / config | transform | `clampTuning` / `parseSavedTuning` in same file | exact |
| `src/core/tuning-utils.ts` (maybe: conditional `clampRear`) | utility | transform | `clampNode` / `copyLeaves` | exact |
| `src/core/feel.ts` (`applyFeel` optional ranges) | service | transform | itself, line ~198 | exact |
| `src/core/tuning-snapshot.ts` (thread ranges) | utility | transform | itself, line ~124 | exact |
| `src/physics/vehicle.ts` (per-axle wheels, grip scale, bump-stop, mass) | service | event-driven (per-tick) | itself | exact |
| `src/physics/telemetry/run.ts` (`runRoutine` options) | utility | batch | itself (optional-param precedent `surfaceOpts`, `groundBuilder`) | exact |
| `src/render/vehicle-view.ts` (`buildCarMeshes` rearRadius) | component | transform | itself | exact |
| `src/render/ai-vehicle-view.ts` | component | transform | itself | exact |
| `src/main.ts` (class wiring, ranges, AI views from `aiTuning`, medal gate) | controller / wiring | request-response | itself (lines ~198-221, ~720-741) | exact |
| `src/debug/tuning-panel.ts` (class ranges) | component | request-response | itself | exact |
| `docs/vehicle-tuning-guide.md` | doc | n/a | itself; `tests/tuning-guide-sync.test.ts` enforces | exact |
| `.planning/plans-ahead/03-monster-spike-result.md` (new) | doc | n/a | none | no analog |

## Pattern Assignments

### `tests/vehicle-rwd-golden.test.ts` (test, batch)

**Analog:** `tests/vehicle-drivetrain.test.ts` (scene/run helpers) and `tests/determinism.test.ts` (closed-form tape, no randomness).

**Imports + scene builder** (`vehicle-drivetrain.test.ts` lines 1-33):
```typescript
import * as RAPIER from "@dimforge/rapier3d";
import { describe, expect, it } from "vitest";
import { type InputFrame, NEUTRAL } from "../src/core/input-tape";
import { createVehicle } from "../src/physics/vehicle";
import { createWorld } from "../src/physics/world";

const SPAWN = { x: 0, y: 1, z: 0 };
function buildScene(tuning: VehicleTuning, share?: number) {
  const world = createWorld();
  const ground = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(0, -0.5, 0));
  world.createCollider(RAPIER.ColliderDesc.cuboid(500, 0.5, 500), ground);
  const vehicle = createVehicle(world, tuning, SPAWN, share);
  return { world, vehicle };
}
function run(scene, tuning, ticks, input: (i: number) => InputFrame) {
  for (let i = 0; i < ticks; i++) {
    scene.vehicle.tick(input(i), tuning);
    scene.world.step();
  }
}
```

**Closed-form tape** (`vehicle-drivetrain.test.ts` lines 52-57):
```typescript
const script = (i: number): InputFrame => ({
  steer: Math.sin(i / 20),
  throttle: i < 150 ? 1 : 0,
  brake: i >= 150 && i < 200 ? 1 : i >= 250 ? 0.6 : 0,
  handbrake: i >= 100 && i < 130,
});
```
**Bitwise compare** (lines 60-70): `expect(pa[k]).toBe(pb[k])` for x/y/z, linvel, rotation x/y/z/w. For the golden use `toBeCloseTo(LITERAL, 6)` on translation, rotation, linvel, angvel.

**Differences to apply:**
- Use `shippedTuning(id)` from `src/core/feel` (not `classDefaultTuning`, which the analog uses). `frontDriveShare` from `VEHICLE_CLASSES[id]`.
- Loop over `["rwd","fwd","awd"]`, 600 ticks. Record literals from the UNTOUCHED tree and commit before any other source change.
- Second golden run WITH surfaces, to protect the grip-scale change (the flat no-surface path never executes it). Copy the surface wiring from `run.ts` lines 133-138:
```typescript
const map = createSurfaceMap();
map.register(ground.handle, surfaceOpts.surface);
surfaces = { map, profiles: surfaceOpts.profiles };
// then vehicle.tick(frame, tuning, surfaces);
```
  with `defaultSurfaceProfiles()` from `src/core/surface-tuning`, and `createSurfaceMap` from `src/physics/surface`. Use a loose surface (e.g. gravel) so the grip path is exercised.
- Call `tick` with exactly 2 args when no surfaces (as `run.ts` 147-155 deliberately does).
- Always `world.free()` is optional in the analog tests; they do not free.

---

### `tests/vehicle-types-targets.test.ts` (test, batch)

**Analog:** `tests/surface-telemetry.test.ts` (sweep + per-surface comparison) and `src/physics/telemetry/routines.ts` accel routine.

**Test style** (`surface-telemetry.test.ts` lines 1-47):
```typescript
import { defaultSurfaceProfiles } from "../src/core/surface-tuning";
import { SURFACE_TYPES } from "../src/core/surface-types";
import { runSurfaceSkidpadSweep } from "../src/physics/telemetry/surface-routines";

const results = runSurfaceSkidpadSweep(defaultTuning(), defaultSurfaceProfiles());
const byId = new Map(results.map((r) => [r.id, r.value]));
expect(results[i].id).toBe(`skidpad:${SURFACE_TYPES[i]}`);
```
`runSurfaceSkidpadSweep(tuning, profiles)` (surface-routines.ts:198) is the per-surface table source for D-11 ("no single vehicle best on every surface"). It calls `runRoutine(routine, tuning, { surface, profiles })`, so it also needs the new `runRoutine` options (spawnY, frontDriveShare) threaded through, or the monster spawns inside the ground and AWD classes are measured as RWD.

**0-60 logic to reuse** (`routines.ts` 62, 153-192): `MPH_60_MS = 26.8224`; accel waits `SETTLE_TICKS` at zero input, then full throttle; value = `(hitTick - SETTLE_TICKS) * DT`, `+Infinity` if never reached.
```typescript
const accelRoutine: Routine = { id: "accel", drive(tick, s) { if (tick < SETTLE_TICKS) return {steer:0,throttle:0,brake:0,handbrake:false}; if (s.forwardSpeedMs >= MPH_60_MS) return null; return {steer:0,throttle:1,brake:0,handbrake:false}; }, ... }
```
**Rule:** do NOT use `RoutineResult.pass` for new classes (bands in `TELEMETRY_TARGETS` are the muscle car's, accel 3.0-4.5 s). Read `.value` and compare with a per-class target table in the test (rally 4, buggy 5, truck 8, monster 9 s, +-15%).

**Helpers** (from RESEARCH, derived from the repo's own routines): tilt `upY = 1 - 2*(q.x*q.x + q.z*q.z)`; settle = tick where chassis y stays within 1 cm of its tick-300 value.

**Per-class loop:** `classDefaultTuning(id)` or `shippedTuning(id)`, `VEHICLE_CLASSES[id].frontDriveShare`, `classTuningRanges(id)`; add the in-range check (`clampTuning(classDefaultTuning(id), classTuningRanges(id))` deep-equals the input).

---

### `src/core/vehicle-class.ts` (registry, add 4 classes)

**Analog:** itself.

**Id list + allowlist** (lines 10-20): extend the tuple; `resolveVehicleClassId` stays exact-match `find`:
```typescript
export const KNOWN_VEHICLE_CLASS_IDS = ["rwd", "fwd", "awd"] as const;
const match = KNOWN_VEHICLE_CLASS_IDS.find((id) => id === requested);
```
**Spec entry** (lines 36-59): `Object.freeze({ id, label, chassisColor, frontDriveShare, storageKey })` inside `Object.freeze<Record<VehicleClassId, VehicleClassSpec>>`. Add optional `surfaceGripScale` (all-ones/absent for rwd/fwd/awd), storage key pattern `heat-street.tuning.<id>.v1`. Colours must differ from `AI_PAINTS` (existing test imports it).
**Class default** (lines 94-119): `switch (id)` mutating `defaultTuning()`, with a comment per override explaining why. Add cases rally/buggy/truck/monster; `rwd` stays `break`. Add `classTuningRanges(id)` returning the same `TUNING_RANGES` reference for rwd/fwd/awd (test requires reference equality).
**Layering:** pure module, no three/rapier imports.

---

### `src/core/vehicle-tuning.ts` (ranges parameter, rear override)

**Analog:** `clampTuning` (990-998) and `parseSavedTuning` (1031-1064).
```typescript
export function clampTuning(t: VehicleTuning): VehicleTuning {
  const fallback = defaultTuning() as unknown as Record<string, unknown>;
  clampNode(t as unknown as Record<string, unknown>, TUNING_RANGES as unknown as Record<string, unknown>, fallback);
  return t;
}
export function parseSavedTuning(raw: string | null, base: () => VehicleTuning = defaultTuning): VehicleTuning | null {
  ... const result = base();
  copyLeaves(parsed, result as unknown as Record<string, unknown>, TUNING_RANGES as unknown as Record<string, unknown>);
  clampTuning(result);
  return result;
}
```
**Change (D-02):** add trailing `ranges: TuningRanges = TUNING_RANGES` to both; export `TuningRanges` type. `parseSavedTuning` must pass `ranges` to BOTH `copyLeaves` and `clampTuning`. Default-arg callers (main.ts:220 AI blob, tests) stay byte-identical.

**Trap (D-03):** do NOT add `rear` to `TUNING_RANGES`. `clampNode` (tuning-utils.ts 50-70) walks the RANGES tree and creates missing value subtrees, reading `fallbackNode[key]` (crash on `undefined[key]`). Instead write a separate conditional step that runs only when `isPlainObject(t.wheels.rear)`, clamping an explicit list of field names against the front-wheel leaves of the active ranges, with finite fallback (the `clampNode` rule at line 60):
```typescript
const safe = typeof raw === "number" && Number.isFinite(raw) ? raw : (fallback as number);
valueNode[key] = Math.min(rangeEntry.max, Math.max(rangeEntry.min, safe));
```
Copy only the named keys (never iterate parsed keys; prototype-pollution control, `copyLeaves` comment lines 73-82).
**`wheelParams(t, i)`:** new helper; no `rear` -> front values for all four wheels; `rear` present -> wheels 2,3 use overrides. Replaces `w0`/`w` reads in `vehicle.ts`.

---

### `src/physics/vehicle.ts` (per-axle, grip scale)

**Analog:** itself.

**Signature** (284-289): `createVehicle(world, tuning, spawn, frontDriveShare = 0)`; validation throws `RangeError` for out-of-range share. Add a trailing optional options object `{ surfaceGripScale }`; absent must keep behaviour byte-identical.

**Wheel setup** (349-361) and **`applyTuning`** (369-392) currently read one `w` for all wheels:
```typescript
vc.addWheel(conn[i], DIRECTION, AXLE, w0.suspensionRestLength, w0.radius);
...
vc.setWheelSuspensionStiffness(i, w.suspensionStiffness);
vc.setWheelSideFrictionStiffness(i, i < 2 ? w.frontSideFriction : w.rearSideFriction);
```
Replace with `const p = wheelParams(t, i)` per wheel, including `connectionY` in `setWheelChassisConnectionPointCs`. Keep all seven setters explicit (comment 363-368: never rely on Rapier defaults). The `restLength` variable (361) and `lastSuspensionLength` seed must become per-wheel.

**Bump-stop** (541-562): uses `w.maxSuspensionTravel`, `w.suspensionRestLength`, `w.suspensionStiffness` for all four wheels together; `heavy` gated on min compression of all four with `BUMP_STOP_GATE_M = 0.06` (line 85). Make these per-wheel via `wheelParams`; if the gate must scale for 1 m travel express as `BUMP_STOP_GATE_M * classScale` with scale exactly 1 for existing classes.

**Grip scale site (D-06)** (589-609), the single place profile grip is read:
```typescript
const profile = surfaces.profiles[surface];
if (!blendSeeded) { blendLateral[i] = profile.lateralGrip; blendForward[i] = profile.forwardGrip; }
else { blendLateral[i] = blendToward(blendLateral[i] as number, profile.lateralGrip, t.wheels); ... }
vc.setWheelFrictionSlip(i, t.wheels.frictionSlip * forwardGrip);
vc.setWheelSideFrictionStiffness(i, t.wheels.frontSideFriction * lateralGrip);
```
Multiply `profile.lateralGrip` / `profile.forwardGrip` by the class scale keyed by `surface` here, only inside `if (surfaces)`. x*1 is IEEE-exact so all-ones is bit-identical (golden-with-surface test proves it).
**Mass:** only via the existing `lastMass/lastHalfExtents` path (lines 324-339, 394+); never call `setAdditionalMassProperties` elsewhere. Rear-only oversteer terms stay.

---

### `src/physics/telemetry/run.ts` (`runRoutine` options)

**Analog:** itself; precedent is the optional `surfaceOpts` and `groundBuilder` params (lines 114-119) with the comment "when omitted the call is exactly the pre-04.2 one".
```typescript
export function runRoutine(routine, tuning, surfaceOpts?, groundBuilder?): RoutineResult {
  ...
  const vehicle = createVehicle(world, tuning, SPAWN);
```
**Change:** add a fifth optional `opts?: { frontDriveShare?: number; spawnY?: number }`. When undefined, the createVehicle call must stay literally `createVehicle(world, tuning, SPAWN)` (do not pass `undefined` explicitly; mirror the T-03-09 "byte-for-byte" discipline at 147-155). `SPAWN` is fixed y 1 (line 43); monster needs `spawnY` about wheel radius + rest length + connectionY. `surface-routines.ts` sweeps (198-233) should forward the same options.

---

### `src/core/feel.ts`, `src/core/tuning-snapshot.ts` (thread ranges)

`feel.ts:198` `clampTuning(target);` at the end of `applyFeel`: add optional `ranges` param defaulting to `TUNING_RANGES`, pass through.
`tuning-snapshot.ts:124`:
```typescript
const vehicle = "vehicle" in parsed ? parseSavedTuning(JSON.stringify(parsed.vehicle)) : null;
```
Pass class ranges here (caller supplies). Also thread through `tuning-panel.ts` reset (~977) and import (~1035); the panel has ~70 `addNumber` calls hard-coding `TUNING_RANGES.x.y` (import at line 72).

---

### `src/render/vehicle-view.ts` / `src/render/ai-vehicle-view.ts` / `src/main.ts` views

`buildCarMeshes(wheelRadius, halfTrack, halfWheelbase, chassisHalfExtents, chassisColor)` (vehicle-view.ts 278-285) validates each arg with `RangeError` for non-positive/non-finite; add optional trailing `rearWheelRadius`, validated the same way, default = front radius. `createAiVehicleViews(scene, radius, halfTrack, halfWheelbase, halfExtents, colors)` (ai-vehicle-view.ts 42-49) forwards to it unchanged.

**D-07 leak fix** (`main.ts` 720-741): both `aiViews` and `pursuitViews` read the player's `tuning`:
```typescript
createAiVehicleViews(view.scene, tuning.wheels.radius, tuning.wheels.halfTrack, tuning.wheels.halfWheelbase, tuning.chassis.halfExtents, AI_PAINTS.map(...))
```
Change `tuning.` to `aiTuning.` in both. `aiTuning` (main.ts 217-221) is built with default ranges and `defaultTuning()` fallback; keep that.

**Class wiring** (`main.ts` 198-221): replace
```typescript
parseSavedTuning(localStorage.getItem(CAR_CLASS.storageKey), () => shippedTuning(CAR_CLASS.id))
```
by adding `classTuningRanges(CAR_CLASS.id)` as third arg; `applyFeel(tuning, classDefaultTuning(...), feelSettings, ranges)`.

**Medal gate (D-08):** `saveMedalResult` call site (~main.ts:1007-1017) and solo coordinator medal path: skip save for rally/buggy/truck/monster only; rwd/fwd/awd unchanged. Check the results view (`src/hud/results-view.ts`) for how a time-without-medal displays. No existing gate to copy; closest is the existing `saveMedalResult` condition code.

---

### Tests to extend (exact analogs: themselves)

- `tests/vehicle-class.test.ts` line 41-43: exact-list assertion `expect([...KNOWN_VEHICLE_CLASS_IDS]).toEqual(["rwd", "fwd", "awd"])` must be updated; hostile-values list (lines 30-40) stays rwd fallback. Add: unique storage keys, colours not in `AI_PAINTS`, `classTuningRanges` reference equality for existing ids.
- `tests/vehicle-tuning.test.ts`, `tests/tuning-persist.test.ts`: blob without `rear` parses unchanged and gains no `rear` key; hostile `rear` (NaN, `__proto__`) clamped.
- `tests/tuning-guide-sync.test.ts`: fails if a bound panel control is not named in `docs/vehicle-tuning-guide.md`; read the guide before the docs plan.

## Shared Patterns

### Optional-param extension must keep default path byte-identical
**Source:** `src/physics/telemetry/run.ts` 114-155 (`surfaceOpts`, `groundBuilder`, `tick` called with 2 args when no surfaces). **Apply to:** `runRoutine`, `createVehicle` options, `clampTuning`/`parseSavedTuning`/`applyFeel` ranges defaults, `buildCarMeshes` rear radius.

### Input sanitising boundary
**Source:** `src/core/tuning-utils.ts` `clampNode` (50-70) and `copyLeaves` (83-106); `parseSavedTuning` never throws, returns null for bad input. **Apply to:** per-class ranges, `wheels.rear`, tuning-snapshot import.

### Frozen registries, allowlisted lookup
**Source:** `src/core/vehicle-class.ts` 14-20, 36-59. **Apply to:** new class entries and any new per-class table.

### Headless Rapier test harness
**Source:** `tests/vehicle-drivetrain.test.ts` 9-33; `runRoutine`/`buildTelemetryScene` for telemetry. Free worlds in `finally` when you create them manually (run.ts 160-167).

### Layering
`src/core/` imports no three/rapier. `src/physics/telemetry/` may import rapier and core, not three/DOM/wall clock.

## No Analog Found

| File | Role | Reason |
|---|---|---|
| `.planning/plans-ahead/03-monster-spike-result.md` | doc | Written spike result with numbers; use the brief's stage 6 list as the template |
| Per-class spawn clearance (monster) | physics/config | Spawn height is a fixed `0.6` (`map-scene.ts:74`, `terrain-scene.ts:142`) and `y: 1` in `run.ts`; nothing derives it from wheel geometry. Planner designs a class-dependent clearance with existing value kept for old classes |
| Medal gate for new classes | wiring | No class gate exists today in `main.ts` |

## Metadata

**Analog search scope:** `src/core`, `src/physics`, `src/physics/telemetry`, `src/render`, `src/main.ts`, `tests/`
**Files read:** vehicle-class.ts, vehicle-tuning.ts (clamp/parse), tuning-utils.ts, vehicle.ts (284-398, 535-615), run.ts, routines.ts (accel), main.ts (198-221, 718-741), vehicle-view.ts/ai-vehicle-view.ts (signatures), three test files
**Pattern extraction date:** 2026-11-22
