---
phase: 09-vehicle-types
reviewed: 2026-11-22T22:26:45Z
depth: standard
files_reviewed: 30
files_reviewed_list:
  - docs/vehicle-tuning-guide.md
  - src/core/feel.ts
  - src/core/tuning-snapshot.ts
  - src/core/vehicle-class.ts
  - src/core/vehicle-tuning.ts
  - src/debug/map-menu.ts
  - src/debug/tuning-panel.ts
  - src/gameplay/free-drive-coordinator.ts
  - src/main.ts
  - src/physics/map-scene.ts
  - src/physics/telemetry/run.ts
  - src/physics/telemetry/surface-routines.ts
  - src/physics/telemetry/vehicle-measure.ts
  - src/physics/terrain-scene.ts
  - src/physics/vehicle.ts
  - src/render/ai-vehicle-view.ts
  - src/render/vehicle-view.ts
  - tests/ai-vehicle-view.test.ts
  - tests/feel.test.ts
  - tests/free-drive-coordinator.test.ts
  - tests/surface-grip-scale.test.ts
  - tests/tuning-persist.test.ts
  - tests/tuning-snapshot.test.ts
  - tests/vehicle-axle.test.ts
  - tests/vehicle-class.test.ts
  - tests/vehicle-collision.test.ts
  - tests/vehicle-measure.test.ts
  - tests/vehicle-rwd-golden.test.ts
  - tests/vehicle-tuning.test.ts
  - tests/vehicle-types-targets.test.ts
findings:
  critical: 0
  warning: 6
  info: 7
  total: 13
status: issues_found
---

# Phase 09: Code Review Report

**Reviewed:** 2026-11-22T22:26:45Z
**Depth:** standard
**Files Reviewed:** 30
**Status:** issues_found

## Narrative Findings (AI reviewer)

## Summary

I reviewed the diff `fedad6b..HEAD`: the four new vehicle classes (rally, buggy, truck, monster), per-class tuning ranges, the optional rear-axle override, the per-class surface grip scale, the spawn-lift wrapper, the D-08 medal gating, the vehicle picker and the headless measurement helpers.

The core physics changes are sound:
- `wheelParams` is applied the same way at construction, live retune and the bump stop.
- The per-wheel bump-stop gate reduces exactly to the old expression when all four wheels share one geometry.
- The grip scale is applied at the single read site. A ×1 multiply keeps rwd/fwd/awd bit-identical.
- The spawn-lift wrapper is installed before any coordinator or handler captures `scene`.

The problems are in three places:
- **Debug tuning panel:** import and reset do not handle the new `wheels.rear` field, and an imported snapshot falls back to the RWD defaults.
- **D-08 medal gating:** it is incomplete. The HUD and split deltas still compare against muscle-car thresholds and personal bests.
- **Buggy spawn:** the buggy has no spawn clearance even though its suspension geometry puts it at full bump travel when it spawns.

None of these is a ship-blocking correctness or security defect in the shipped game path.

## Warnings

### WR-01: Panel Reset does not clear the `wheels.rear` override

**File:** `src/debug/tuning-panel.ts:994-997`
**Issue:** Reset calls `writeLeavesOnto(tuning, persist.defaults(), ranges)`. That function walks only the keys of the range table, and `TuningRanges` has no `rear` key. So any `wheels.rear` object on the live tuning survives the reset. `vehicle.ts` keeps applying it through `wheelParams()`, so the car does not return to class defaults. `store.remove(persist.storageKey)` deletes the blob for now, but the next slider change calls `persistAll()`, and `serializeTuning` is plain `JSON.stringify`. That saves the stale `rear` again. The "Rear axle" sliders also stay bound and keep showing the old values.
**Fix:** Handle the override explicitly after the leaf copy:
```ts
const defaults = persist.defaults();
writeLeavesOnto(tuning as ..., defaults as ..., ranges as ...);
const w = tuning.wheels as { rear?: WheelAxleOverride };
if (defaults.wheels.rear === undefined) delete w.rear;
else w.rear = { ...defaults.wheels.rear };
```
The rear-axle sub-folder then needs to be destroyed or rebuilt, or hidden when `rear` is gone.

### WR-02: Snapshot import ignores `wheels.rear`

**File:** `src/debug/tuning-panel.ts:935-941`
**Issue:** `parseTuningSnapshot` → `parseSavedTuning` now validates and returns `snapshot.vehicle.wheels.rear`. The import path then copies only range-table leaves, using `TUNING_RANGES` rather than `ranges`, so the imported override is thrown away and any existing override is kept. If you export a car with a rear override and import it into a fresh session, you get a different car. The importing session's own `rear` then leaks into the next `persistAll()`.
**Fix:** After `writeLeavesOnto`, mirror the override:
```ts
const w = tuning.wheels as { rear?: WheelAxleOverride };
if (snapshot.vehicle.wheels.rear === undefined) delete w.rear;
else w.rear = { ...snapshot.vehicle.wheels.rear };
```
Use `ranges` instead of `TUNING_RANGES` here so the code matches the reset path.

### WR-03: Imported snapshot fills missing vehicle leaves from RWD defaults, not class defaults

**File:** `src/core/tuning-snapshot.ts:136`, `src/debug/tuning-panel.ts:917`
**Issue:** `parseTuningSnapshot(raw, ranges)` always passes `defaultTuning` (the RWD muscle car) as the base. The class's `persist.defaults` is not available to it. If a partial or older snapshot is imported while running `?car=monster`, every missing leaf becomes the muscle-car value and is then clamped into `MONSTER_RANGES`. For example, mass 1390 becomes 3000, radius 0.36 becomes 0.4 and rest length 0.6 stays 0.6. The result is a wrong, possibly unstable monster with no warning. `main.ts` gets this right for localStorage by passing `() => shippedTuning(CAR_CLASS.id)`. The snapshot path does not.
**Fix:** Add a `base` parameter to `parseTuningSnapshot(raw, base = defaultTuning, ranges = TUNING_RANGES)` and pass `persist.defaults` from the panel.

### WR-04: D-08 is only half-applied; new classes still race against muscle-car medals and personal bests

**File:** `src/main.ts:1024-1026`, `src/main.ts:1042-1045`
**Issue:**
- For `savesMedals: false` classes, only the save step is skipped and the final medal is rewritten to `"none"`.
- The race coordinator still gets `createMedalTiming({ referenceTimeSec })` and `personalBest: medalProgress.courses[...]`. So the live race HUD shows ACE/GOLD/SILVER/BRONZE thresholds (`race-hud.ts:104-107`), and sector splits are deltas against the muscle-car personal best (`race-coordinator.ts:55`).
- The completion rows from `showCompletion` still print those deltas.

A monster truck run is therefore shown splits against an RWD best it can never match. That contradicts "new classes show time only" in the guide.
**Fix:** When `!CAR_CLASS.savesMedals`:
- pass `personalBest: undefined`
- give the timing a null-threshold mode so `snapshot.thresholds === null` and the HUD prints "no medals"
- strip `deltaSec`/`comparisonSource` from the completion before `showCompletion`.

### WR-05: Buggy spawns at full suspension travel (no `spawnClearanceM`)

**File:** `src/core/vehicle-class.ts:251-259` (spec), `src/core/vehicle-class.ts:369-371` (geometry)
**Issue:** The in-game spawn height is `SPAWN_CLEARANCE_M` = 0.6 m above the node. The buggy's wheel-bottom depth is 0.15 (−connectionY) + 0.7 (rest) + 0.4 (radius) = 1.25 m. Spawned at 0.6 m, that is 0.65 m of compression, which is exactly its `maxSuspensionTravel` of 0.65. So every spawn, race restart and respawn starts the buggy on the bump stop, and the suspension fires the light 750 kg body upward. The muscle car starts at 0.51 of 0.55, and rally at 0.52 of 0.55.

The measured targets do not cover this. `withRig`/`runRoutine` spawn at `y = 1` when `spawnY` is undefined, so the buggy is measured at only 0.25 m compression. The truck and monster use a "rest + 0.1 m" rule. Applied to the buggy, that rule gives about 1.35 m.
**Fix:** Add `spawnClearanceM: 1.35` to the buggy spec, and consider the same rule for rally (about 1.22). Add a test that measures settle and pitch from `spawnY = spawnClearanceM ?? SPAWN_CLEARANCE_M`, so the headless numbers use the same spawn height as the game.

### WR-06: `extraLiftM` on the free-drive coordinator is dead and invites a double lift

**File:** `src/gameplay/free-drive-coordinator.ts:16-17, 51`; `src/main.ts:1070`
**Issue:** The new `extraLiftM` option is documented as the "Extra respawn height for tall vehicles". `main.ts` never passes it, because the lift is already added by the `scene.resetVehicle` wrapper (`main.ts:510-514`), which this coordinator calls. Anyone who wires it up as its doc comment suggests will raise tall vehicles twice on every free-drive respawn: 0.7 m extra for the truck, 1.5 m for the monster. Only the unit test exercises the option.
**Fix:** Remove `extraLiftM` and its test. If you keep it, change its doc comment to say it must not be combined with the main.ts wrapper.

## Info

### IN-01: `createVehicle` JSDoc now attaches to `CreateVehicleOptions`

**File:** `src/physics/vehicle.ts:281-284`
**Issue:** The new interface was inserted between `createVehicle`'s doc comment and the function. The long D-09 doc now describes the options interface, and `createVehicle` has none.
**Fix:** Move `CreateVehicleOptions` above the doc block.

### IN-02: Stale `classTuningRanges` doc comment

**File:** `src/core/vehicle-class.ts:440`
**Issue:** The comment says "buggy has a widened copy", but truck and monster also have widened copies.
**Fix:** Change it to "buggy/truck/monster get widened copies".

### IN-03: Rear-axle override doc is inaccurate; the override has no creation path

**File:** `docs/vehicle-tuning-guide.md:512-520`, `src/debug/tuning-panel.ts:348-361`
**Issue:**
- The doc says the sub-folder appears "only when the class sets `wheels.rear`". In fact it appears whenever the loaded tuning has `rear`, which can only come from a hand-edited localStorage blob, since class defaults never set it.
- Snapshot import cannot introduce it either (WR-02).
- The folder is built once at panel construction. A later `clampRearOverride` replaces the `wheels.rear` object (`vehicle-tuning.ts:1035`), which would leave the sliders editing a detached object.

**Fix:** Correct the doc. In `clampRearOverride`, mutate the existing object in place instead of reassigning it.

### IN-04: Buggy measurement numbers disagree between code and guide

**File:** `src/core/vehicle-class.ts:382` vs `docs/vehicle-tuning-guide.md:593`
**Issue:** The code comment says 0-60 is 5.13 s and top speed 39.5 m/s. The guide says 5.02 s and about 39.8 m/s.
**Fix:** Re-measure and make both say the same number.

### IN-05: `spawnClearanceM` is per-class static, not derived from the live tuning

**File:** `src/core/vehicle-class.ts:270, 281`; `src/main.ts:211`
**Issue:** The clearance is hard-coded from the spike geometry, as the comments show (radius + rest − connectionY + 0.1). The truck/monster ranges let radius, rest and connectionY grow a lot: monster radius up to 1.2 and rest up to 1.6. A saved tuning at the top of those ranges would spawn wheels-in-ground.
**Fix:** Compute the lift from `wheelParams(tuning, i)` at spawn time, taking the max over all wheels.

### IN-06: Duplicated grip-scale table builders

**File:** `src/core/vehicle-class.ts:43-121`
**Issue:** Five builders repeat the same "fill all-ones, then override" loop.
**Fix:** Use one `gripScale(overrides: Partial<Record<SurfaceType, {forward; lateral}>>)` helper.

### IN-07: `surfaceGripScale` validation dereferences missing entries

**File:** `src/physics/vehicle.ts:298-308`
**Issue:** If a table is missing a surface (for example after a new `SurfaceType` is added and a hand-built table is not updated), `e.forward` throws a `TypeError` instead of the intended `RangeError`.
**Fix:** Add `if (e === undefined) throw new RangeError(...)` before the finiteness checks.

---

_Reviewed: 2026-11-22T22:26:45Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
