---
phase: 09-vehicle-types
fixed_at: 2026-11-23T01:05:00Z
review_path: .planning/phases/09-vehicle-types/09-REVIEW.md
iteration: 1
findings_in_scope: 6
fixed: 6
skipped: 0
status: all_fixed
---

# Phase 09: Code Review Fix Report

**Fixed at:** 2026-11-23T01:05:00Z
**Source review:** .planning/phases/09-vehicle-types/09-REVIEW.md
**Iteration:** 1

**Summary:**
- Findings in scope: 6 (Critical + Warning; Info IN-01..IN-07 out of scope)
- Fixed: 6
- Skipped: 0

Verification after all fixes: `npm run check` passes typecheck and biome. Tests show 2819 passed and 1 failed. The failure is the known pre-existing `tests/demo-hills.test.ts` max-slope D-03 test. `tests/vehicle-rwd-golden.test.ts` was not modified and still passes.

## Fixed Issues

### WR-01: Panel Reset does not clear the `wheels.rear` override

**Files modified:** `src/core/vehicle-tuning.ts`, `src/debug/tuning-panel.ts`, `tests/vehicle-axle.test.ts`
**Commit:** c1f55a8
**Applied fix:** Added a pure helper, `copyRearOverride(target, source)`, to core. It deletes `wheels.rear` when the source has none and otherwise sets a shallow copy. Reset now calls it with the class defaults. The "Rear axle" sub-folder is built by `rebuildRearFolder()`, which destroys and rebuilds it. The folder is the last child of Suspension, so it comes back in the same place. Tests cover the helper.

### WR-03: Imported snapshot fills missing vehicle leaves from RWD defaults

**Files modified:** `src/core/tuning-snapshot.ts`, `src/debug/tuning-panel.ts`, `tests/tuning-snapshot.test.ts`
**Commit:** f8ae7ca
**Applied fix:** `parseTuningSnapshot(raw, ranges = TUNING_RANGES, base = defaultTuning)` now takes a `base` argument. It was added as the third parameter, not the second as the review suggested, so the existing `(raw, ranges)` callers and tests keep working. The panel passes `persist.defaults`. A test checks that a partial snapshot parsed with the monster ranges and defaults gets the monster mass, radius and rest length.

### WR-02: Snapshot import ignores `wheels.rear`

**Files modified:** `src/debug/tuning-panel.ts`, `tests/tuning-snapshot.test.ts`
**Commit:** 6802eec
**Applied fix:** The import path now walks the class `ranges` instead of `TUNING_RANGES`. It then calls `copyRearOverride(tuning, snapshot.vehicle)` and `rebuildRearFolder()`. Tests check that an exported override replaces the session's own override, and that importing a snapshot with no override clears it.

### WR-04: D-08 only half-applied (HUD/splits still compared against muscle-car medals)

**Files modified:** `src/core/medal-timing.ts`, `src/main.ts`, `tests/medal-timing.test.ts`
**Commit:** bdfc38f
**Applied fix:** Added `medals?: boolean` to `MedalTimingConfig`. It defaults to true. When false, `thresholds` is null, so the HUD prints its existing "no medals" text. `liveMedal` and the completion medal are `"none"`. Checkpoint comparisons are dropped, so `deltaSec` and `comparisonSource` are null in the HUD splits and in the completion rows. `main.ts` passes `medals: CAR_CLASS.savesMedals`, and passes `personalBest: undefined` for classes that do not save medals. The old `{...completion, medal: "none"}` rewrite is no longer needed. Tests cover the time-only mode and confirm medals stay on by default.
**Status:** fixed: requires human verification. This is a logic and behaviour change. Drive a race with `?car=monster` to confirm the HUD shows no thresholds or deltas.

### WR-05: Buggy spawns at full suspension travel

**Files modified:** `src/core/vehicle-class.ts`, `tests/vehicle-class.test.ts`, `docs/vehicle-tuning-guide.md`
**Commit:** af5a7ed
**Applied fix:** Added `spawnClearanceM: 1.35` to the buggy spec. This uses the truck/monster rule: 0.4 + 0.7 + 0.15 + 0.1. The clearance test now covers the buggy with the rule `≈ radius + rest − connectionY + 0.1`. A new test checks that no class's spawn compression at `spawnClearanceM ?? SPAWN_CLEARANCE_M` reaches `maxSuspensionTravel`. Without the fix it fails for the buggy. `vehicle-types-targets.test.ts` already spawns at `spawnClearanceM`, so the buggy's measured targets now start from the in-game height, and they still pass. The guide's buggy section now notes the clearance. Rally (0.52 of 0.55) was not changed, because that part of the review was only a "consider".
**Status:** fixed: requires human verification. Check the buggy's spawn and respawn feel in-game.

### WR-06: `extraLiftM` on the free-drive coordinator is dead and invites a double lift

**Files modified:** `src/gameplay/free-drive-coordinator.ts`, `tests/free-drive-coordinator.test.ts`
**Commit:** c4dc9ee
**Applied fix:** Removed the `extraLiftM` option, the code that used it, and its unit test. The `RESPAWN_CLEARANCE_M` doc comment now says that the tall-class lift comes from main.ts's `scene.resetVehicle` wrapper.

---

_Fixed: 2026-11-23T01:05:00Z_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_
