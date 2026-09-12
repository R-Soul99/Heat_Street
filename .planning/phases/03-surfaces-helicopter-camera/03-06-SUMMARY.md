---
phase: 03-surfaces-helicopter-camera
plan: 06
subsystem: physics
tags: [rapier, vehicle-controller, surface-friction, telemetry, vitest, typescript]

# Dependency graph
requires:
  - phase: 03-03
    provides: src/physics/surface.ts (SurfaceMap/createSurfaceMap/SurfaceContext), src/physics/vehicle.ts (Vehicle.tick's optional SurfaceContext parameter)
  - phase: 03-01
    provides: src/core/surface-types.ts (SURFACE_TYPES/SurfaceType), src/core/surface-tuning.ts (SurfaceProfiles/defaultSurfaceProfiles)
provides:
  - src/physics/telemetry/run.ts extended with an optional SurfaceRunOpts third parameter on runRoutine and a groundFriction-aware buildTelemetryScene, so ONE harness now serves both the Vitest gate and the plan 03-07 browser panel for surface sweeps
  - src/physics/telemetry/surface-routines.ts: runSurfaceSkidpadSweep, runSurfaceStabilitySweep, runSkidpadAtGroundFriction, SURFACE_SEPARATION_MIN_G
  - tests/surface-telemetry.test.ts: the Wave-0 automated proof of SC1 (03-VALIDATION.md's named command)
  - Empirical answer to 03-RESEARCH.md Assumption A1 / Open Question 1: ground-collider friction does NOT participate in the raycast tire model (measured 0.000% relative difference)
  - Empirical re-verification that the plan-02-10 straight-line spin-out finding does not reopen on any of the six surfaces at current tuning
affects: [03-07 (surface FX/audio and the browser telemetry panel, which can now sweep surfaces with the same runRoutine call), 03-11/03-12 (feel-session retuning of SurfaceProfiles, which SURFACE_SEPARATION_MIN_G may need raising alongside)]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Parameterize an existing scripted Routine by copying its drive/sample shape with per-source-line copy comments, rather than importing/wrapping it, so a per-surface variant can report a different (relative, not tarmac-authored-absolute) pass criterion"
    - "A telemetry harness's optional third parameter (SurfaceRunOpts) is built and registered INSIDE the same try block as the throwaway world, so a sweep of N surfaces still frees N worlds through the one existing finally block — no new leak surface"
    - "When acceptance criteria grep source files for the ABSENCE of a literal identifier, doc comments must describe that identifier's referent by behavior, not name it directly (mirrors Phase 02-03's established convention)"

key-files:
  created: [src/physics/telemetry/surface-routines.ts, tests/surface-telemetry.test.ts]
  modified: [src/physics/telemetry/run.ts]

key-decisions:
  - "buildTelemetryScene now returns the created ground Collider instead of void, and takes an optional groundFriction — existing callers that ignore the return value and never pass groundFriction keep compiling and measuring byte-identical numbers (verified: tests/vehicle-telemetry.test.ts's full suite passes unchanged)"
  - "runRoutine's surfaceOpts branch calls vehicle.tick(frame, tuning, surfaces) only when surfaces is truthy, and vehicle.tick(frame, tuning) with no third argument otherwise -- an explicit two-branch call rather than always passing a possibly-undefined third argument, matching the plan's literal 'byte-for-byte... with no third argument' requirement"
  - "Straight-line stability routine intentionally does NOT mirror routines.ts's own full-lock-steer 'stability' routine -- it re-verifies a DIFFERENT regression target (STATE.md's plan-02-10 zero-steer sustained-throttle spin-out finding), so it is a new routine shape, not a surface-scoped copy of the existing one"
  - "SURFACE_SEPARATION_MIN_G kept at its planned starting value of 0.02 g -- the measured tightest pair (gravel 0.7862 g vs dirt_road 0.8186 g, diff 0.0324 g) clears it with margin, so no adjustment was needed this plan"

requirements-completed: [SURF-01]

# Metrics
duration: 10min
completed: 2026-09-12
---

# Phase 3 Plan 6: Per-Surface Telemetry Sweep Summary

**Six-surface skidpad and straight-line-stability sweeps extend the existing Vitest/browser-panel telemetry harness with an optional surface context, turning SC1's grip-change claim into a passing automated test and empirically settling two open questions (ground-collider friction does not affect the tire model; the plan-02-10 spin-out does not reopen on any surface).**

## Performance

- **Duration:** ~10 min (execution only; context-loading and research review not counted)
- **Started:** 2026-09-12T14:24:12+01:00 (Task 1 commit)
- **Completed:** 2026-09-12T14:29:00+01:00 (Task 2 GREEN commit)
- **Tasks:** 2
- **Files modified:** 3 (1 created source file, 1 created test file, 1 modified source file)

## Accomplishments
- `src/physics/telemetry/run.ts`: `buildTelemetryScene` now returns the ground `Collider` and accepts an optional `groundFriction`; `runRoutine` gained an optional `SurfaceRunOpts` third parameter that builds a fresh `SurfaceMap`, registers the ground collider, and drives every `vehicle.tick` call with the resulting `SurfaceContext` — the SAME harness `tests/vehicle-telemetry.test.ts` and the plan 02-09/03-07 browser panels already call, not a second runner.
- `src/physics/telemetry/surface-routines.ts`: `runSurfaceSkidpadSweep`/`runSurfaceStabilitySweep`/`runSkidpadAtGroundFriction`, built by parameterizing `./routines.ts`'s existing `skidpad` shape per surface (same 45 mph entry, 15/45 steer fraction, 0.3 hold throttle, 4 s hold / 2 s averaging window) with a relative rather than tarmac-authored-absolute pass criterion, plus a new straight-line-stability routine shape for the STATE.md carry-forward re-verification.
- `tests/surface-telemetry.test.ts`: the exact `npx vitest run tests/surface-telemetry.test.ts -t skidpad` command 03-VALIDATION.md names as SURF-01's automated proof, covering the six-surface sweep, cross-surface separation, the A1 friction control, and the stability re-verification — 9 tests, all passing.
- **SC1 proven with measured numbers** (`defaultTuning()`, `defaultSurfaceProfiles()`): skidpad lateral-g — tarmac 1.0270 g, gravel 0.7862 g, dirt_road 0.8186 g, grass 0.5670 g, sand 0.4607 g, mud 0.4112 g. Tarmac is highest, mud is lowest, every pair differs by at least 0.0324 g (above the 0.02 g `SURFACE_SEPARATION_MIN_G` floor), and tarmac→gravel differs by 23.5% relative (well above the 10% SC1 names).
- **03-RESEARCH.md Assumption A1 / Open Question 1 answered empirically**: running the tarmac skidpad routine at `groundFriction` 1.0 and 0.1 both measured 1.0270 g — a **0.000%** relative difference. The raycast vehicle's tire model does NOT read the ground collider's own friction coefficient; SURF-01's "not ground-collider friction" wording is confirmed correct, not assumed.
- **STATE.md's Phase 3 carry-forward re-verified**: 20 s of sustained full throttle with zero steer, from rest, on every one of the six surfaces stays well under the 30 deg re-verification threshold (worst case: gravel at 8.8 deg; tarmac itself only 2.3 deg) and every run ends still moving forward. The plan-02-10 `rearSideFriction` spin-out does not reopen on any surface at the current shipped tuning.
- Zero behavioural change proven for the pre-existing path: `tests/vehicle-telemetry.test.ts` (51 assertions across its file) and `tests/determinism.test.ts` both pass unchanged, same counts as before this plan.

## Task Commits

Each task was committed atomically, TDD RED then GREEN for Task 2:

1. **Task 1: Teach the existing telemetry harness about surfaces, without forking it**
   - `693a0fc` feat(03-06): extend telemetry harness with optional surface context
2. **Task 2: Per-surface skidpad sweep, the collider-friction control, and the stability re-verification**
   - `3783782` test(03-06): add failing test for per-surface skidpad sweep and A1 control
   - `0d63a1f` feat(03-06): add per-surface skidpad/stability sweeps and the A1 friction control

_Note: this plan required no plan-level metadata commit here — STATE.md/ROADMAP.md are updated centrally by the orchestrator after all Wave 3 worktree agents merge (worktree isolation mode). Only this SUMMARY.md is committed by this agent._

## Files Created/Modified
- `src/physics/telemetry/run.ts` — `buildTelemetryScene` returns the ground `Collider` and takes an optional `groundFriction`; `runRoutine` gains an optional `SurfaceRunOpts` third parameter; `runAllRoutines` untouched
- `src/physics/telemetry/surface-routines.ts` — new: per-surface skidpad/stability routine factories, the three sweep/control exports, `SURFACE_SEPARATION_MIN_G`
- `tests/surface-telemetry.test.ts` — new: 9 tests covering every `<behavior>` bullet in the plan (six-surface sweep shape, tarmac-highest/mud-lowest ordering, minimum pairwise separation, tarmac→gravel 10% relative, determinism, the A1 control, the six-surface stability re-verification)

## Decisions Made
- `buildTelemetryScene`'s `groundFriction` parameter only calls `.setFriction` when explicitly supplied — every existing caller that never passes it keeps measuring Rapier's own default, preserving `tests/vehicle-telemetry.test.ts`'s exact numbers (T-03-09, verified by that suite's unchanged pass).
- `runRoutine`'s surface branch is an explicit `if (surfaces) { ...3-arg call... } else { ...2-arg call... }` rather than always passing a (possibly `undefined`) third argument — chosen to satisfy the plan's literal "byte-for-byte... with no third argument" requirement rather than relying on `undefined`'s functional equivalence inside `vehicle.tick`.
- The per-surface skidpad routine's `evaluate` reports `pass: Number.isFinite(avgG) && avgG > 0` — a relative, per-routine sanity check — rather than reusing `TELEMETRY_TARGETS.skidpad`'s tarmac-authored 0.75-1.05 g absolute band; the real "measurable and distinct" claim is checked by the SWEEP test's pairwise-separation assertions, not by any single routine's own `pass` flag.
- The straight-line stability routine is a genuinely new shape (sustained full throttle, zero steer, 20 s, tracking max `|slipAngleRad|`) rather than a surface-scoped clone of `./routines.ts`'s own `stability` routine (full-LOCK steer, a different D-06/D-08 regression target entirely) — the plan's `<behavior>` text specifies "zero steering input," which the existing `stability` routine does not use.
- `SURFACE_SEPARATION_MIN_G` kept at the plan's starting value of 0.02 g; the measured tightest pair (gravel vs dirt_road, 0.0324 g apart) clears it with ~60% margin, so no immediate raise was needed. Flagged in the routine's own doc comment for plan 03-12's feel session, per the plan's original guidance.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Rewrote two doc-comment sentences that accidentally contained the literal identifiers their own acceptance greps required to be absent**
- **Found during:** Task 2, running the acceptance-criteria greps after the first GREEN pass
- **Issue:** `src/physics/telemetry/surface-routines.ts`'s module doc comment and the skidpad-routine doc comment referenced `defaultSurfaceProfiles` and `TELEMETRY_TARGETS.skidpad` by their literal identifier names (explaining what the code deliberately does NOT import/reuse), which made `grep -c "defaultSurfaceProfiles" src/physics/telemetry/surface-routines.ts` and `grep -c "TELEMETRY_TARGETS.skidpad" src/physics/telemetry/surface-routines.ts` both return 1 instead of the required 0.
- **Fix:** Reworded both comments to describe the same referents by behavior ("the project's factory for a fresh default profiles object," "`./routines.ts`'s tarmac-authored absolute pass band for its own `skidpad` routine") instead of by literal name — the same convention `src/hud/speedometer.ts` already establishes per Phase 02-03's decision log for exactly this situation (a doc comment that must describe a forbidden/avoided technique without containing the literal token an acceptance grep checks for).
- **Files modified:** `src/physics/telemetry/surface-routines.ts` (comments only, no logic change)
- **Verification:** Both greps now return 0; `npx vitest run tests/surface-telemetry.test.ts` still passes all 9 tests; `npm run typecheck` passes
- **Committed in:** `0d63a1f` (Task 2 GREEN commit)

**2. [Rule 3 - Blocking] Normalized `src/physics/telemetry/run.ts`'s working-tree line endings back to LF**
- **Found during:** Task 2, running `npm run check`'s lint step after the Task 1 edit
- **Issue:** The same repo-wide, already-tracked `core.autocrlf=true` working-tree artifact documented in `.planning/STATE.md`'s Blockers/Concerns and plan 03-03's own Summary: the on-disk copy of `run.ts` (a file this plan substantively edits) had CRLF line terminators throughout even though the committed blob is LF, producing spurious Biome formatting diffs that would have masked any real formatting issue in the new code.
- **Fix:** Converted the working-tree file's line endings to LF via a Node one-liner (`\r\n` -> `\n`, no content change) — confirmed by `git diff` afterward showing only the genuine one-line import-reorder change from `biome check --write`, zero net line-ending diff against the already-LF committed blob.
- **Files modified:** `src/physics/telemetry/run.ts` (working-tree line-ending normalization only; the committed diff is exactly the import-order fix below)
- **Verification:** `npx biome check src/physics/telemetry/run.ts src/physics/telemetry/surface-routines.ts tests/surface-telemetry.test.ts` passes clean; full targeted test suite and `npm run typecheck` pass
- **Committed in:** `0d63a1f` (Task 2 GREEN commit)

**3. [Rule 3 - Blocking] Fixed import ordering in `run.ts` and `surface-routines.ts` via `biome check --write`**
- **Found during:** Task 2, same lint pass as above
- **Issue:** Biome's `assist/source/organizeImports` rule flagged both files' new import lines as out of the project's sorted order.
- **Fix:** Ran `npx biome check --write` scoped to this plan's three files only.
- **Files modified:** `src/physics/telemetry/run.ts`, `src/physics/telemetry/surface-routines.ts` (import order only, no logic change)
- **Verification:** `npx biome check` on the three files returns clean; full targeted test suite passes
- **Committed in:** `0d63a1f` (Task 2 GREEN commit)

---

**Total deviations:** 3 auto-fixed (1 bug in doc-comment acceptance-grep compliance, 1 blocking line-ending normalization, 1 blocking import-order fix)
**Impact on plan:** None changed the shipped runtime behavior of `src/physics/telemetry/run.ts` or `src/physics/telemetry/surface-routines.ts` — all three were corrections to make the acceptance greps and existing toolchain pass cleanly on this plan's own files. No scope creep.

## Issues Encountered
- `node_modules` did not exist in this worktree at spawn time (a fresh worktree checkout); ran `npm install` once at the start of execution to restore it. Not a plan deviation — infrastructure setup, not a code change.
- This worktree branch was stale at spawn (forked before Wave 2's merge commit `a114564`) and had to be hard-reset to the expected base per the mandatory pre-execution branch check; working tree was clean at the time, so this was safe and is not a deviation from plan content.
- `npm run check`'s lint step still fails repo-wide on ~15 pre-existing files this plan never touched (`src/core/frame-budget.ts`, `src/loop.ts`, `src/main.ts`, `vite.config.ts`, `vitest.config.ts`, etc.) — the same pre-existing CRLF-vs-LF working-directory mismatch already documented in `.planning/STATE.md`'s Blockers/Concerns and `.planning/phases/02-vehicle-feel-core/deferred-items.md`, and already flagged as out-of-scope in plan 03-03's own Summary. Confirmed out of scope per the deviation rules' Scope Boundary. `npx biome check` limited to this plan's three files (`src/physics/telemetry/run.ts`, `src/physics/telemetry/surface-routines.ts`, `tests/surface-telemetry.test.ts`) passes clean. `npm run typecheck` and every targeted `npx vitest run` invocation in the plan's `<verification>` section pass.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- `runSurfaceSkidpadSweep`/`runSurfaceStabilitySweep`/`runSkidpadAtGroundFriction` are ready for plan 03-07's browser telemetry panel to call directly against live-tuned `VehicleTuning`/`SurfaceProfiles` objects, with no code edit — the same SC5 property `src/physics/telemetry/run.ts`'s two-runner design already guarantees for vehicle tuning.
- `SURFACE_SEPARATION_MIN_G` (0.02 g) and the measured six skidpad values are recorded here for plan 03-12's feel session to compare against once `SurfaceProfiles`' grass/sand/mud multipliers (currently `[ASSUMED]` per 03-RESEARCH.md) are retuned against real play.
- The A1 finding (ground-collider friction inert) means `src/physics/surface-scene.ts`'s uniform `.setFriction(1.0)` (if it exists by that name in a sibling plan) has zero effect on driving feel either way — future plans do not need to treat that value as tunable.
- No blockers for 03-05 (the sibling parallel plan in this wave) — no `files_modified` overlap, confirmed by the plan frontmatter.

---
*Phase: 03-surfaces-helicopter-camera*
*Completed: 2026-09-12*
