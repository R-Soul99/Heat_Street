---
phase: 02-vehicle-feel-core
plan: 04
subsystem: vehicle-physics
tags: [rapier, vehicle-controller, physics, arcade-assists, vitest, typescript]

# Dependency graph
requires:
  - phase: 02-vehicle-feel-core
    provides: "src/core/vehicle-tuning.ts's VehicleTuning contract, defaultTuning() Config A/B values, and TUNING_RANGES (plan 02-01)"
provides:
  - "src/physics/vehicle.ts: createVehicle(world, tuning, spawn) -> Vehicle, generic per D-09 (no notion of 'the player'), plus sampleVehicle() and the FL/FR/RL/RR wheel-index contract"
  - "src/physics/vehicle-assists.ts: applyAssists() -- the four clamped, gated arcade assists (auto-level, body-roll, slide-catch, downforce) -- and boxPrincipalInertia()"
  - "tests/vehicle.test.ts: structural, steer-sign, brake-exclusion and assist-clamp regression coverage (14 cases)"
affects: [02-06-scene-and-view, 02-07-telemetry, 02-09-tuning-panel]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Config-in/controller-out factory (createVehicle) with zero reference to 'the player', so Phase 7/8 pursuers reuse it unmodified"
    - "applyAssists as a free function taking every dependency explicitly, mirroring src/render/interpolator.ts's precedent, so it is unit-testable with a synthetic chassis and no scene"
    - "Hand-rolled quaternion rotation (Fabian Giesen's optimised form) in both src/physics/ files -- this layer may not import three"
    - "Mass/CoM/inertia changes are detected by comparing against a stored copy and only reapplied on actual change, never every frame (Pitfall 10)"

key-files:
  created:
    - src/physics/vehicle.ts
    - src/physics/vehicle-assists.ts
    - tests/vehicle.test.ts
  modified: []

key-decisions:
  - "src/physics/vehicle-assists.ts is committed together with vehicle.ts in the first task commit, not split across the two task commits as the plan's <files> annotation suggests, because vehicle.ts's construction (boxPrincipalInertia) and tick() (applyAssists) both call directly into it -- the plan's own action text acknowledges this ('via boxPrincipalInertia (task 2)'). The two commits could not both independently typecheck otherwise."
  - "Rapier@0.20.0's setAdditionalMassProperties only takes effect at the NEXT world.step() unless recomputeMassPropertiesFromColliders() is called explicitly (undocumented in 02-RESEARCH.md, discovered here by a failing test): without it, tick 0's applyTorqueImpulse divides by the tiny collider-default inertia instead of the cached principal inertia, inflating the assists' angular response by roughly two orders of magnitude on the first tick. Fixed by calling recomputeMassPropertiesFromColliders() immediately after every setAdditionalMassProperties call, both at construction and inside applyTuning's mass-changed branch."
  - "The auto-level assist's torque axis in 02-RESEARCH.md's Pattern 3 code and 02-04-PLAN.md's action text, (up.z, 0, -up.x), is the negation of the correct up_local x world_up cross product. Verified empirically: applying the documented sign to a chassis tilted 60deg about X drove it further from level (60deg -> ~90deg) over 30 ticks instead of recovering. Corrected to (-up.z, 0, up.x) in src/physics/vehicle-assists.ts."
  - "boxPrincipalInertia's Config A sanity anchor as stated in 02-RESEARCH.md line 1057 and 02-04-PLAN.md ({3080, 3480, 512} kg*m^2) does not match evaluating the documented formula against Config A's actual shipped mass/halfExtents (which gives {3078.7, 3426.7, 614.7}); I.x matches to three figures but I.y is 1.5% off and I.z is 20% off. The box-inertia tensor for a uniform cuboid is unambiguous, so the doc's arithmetic is what is wrong. The test asserts against the corrected figures."

requirements-completed: [VEH-01, VEH-02, VEH-04]

# Metrics
duration: 40min
completed: 2026-09-09
---

# Phase 02 Plan 04: Vehicle Controller and Arcade Assists Summary

**createVehicle() factory over Rapier's DynamicRayCastVehicleController with the measured Config A/B construction, plus four clamped/gated arcade assists (auto-level, body-roll, slide-catch, downforce) applied as per-tick impulses**

## Performance

- **Duration:** ~40 min
- **Completed:** 2026-09-09
- **Tasks:** 2 completed
- **Files modified:** 3 (all created)

## Accomplishments
- `src/physics/vehicle.ts` exports `createVehicle(world, tuning, spawn) -> Vehicle`, a generic config-in/controller-out factory (D-09) with zero reference to "the player" — the exact shape Phase 7/8 pursuers will reuse.
- `tick()` implements 02-RESEARCH.md Pattern 2's fixed order exactly: steer sign (asserted by test, not discovered in the browser), engine force zeroed while braking (Pitfall 7), brake on all four wheels, handbrake/authored-throttle-oversteer rear side friction, `updateVehicle(DT)`, fresh wheel-contact telemetry, then the assist layer.
- `applyTuning()` retunes every per-wheel property live and only reapplies mass/CoM/inertia when they actually changed (Pitfall 10), so a slider drag never rebuilds the vehicle or produces discontinuities.
- `src/physics/vehicle-assists.ts` implements all four clamped, gated arcade assists as a free function (`applyAssists`) directly unit-testable with a synthetic chassis: auto-level (airborne only, load-bearing per D-07), body-roll (grounded, hard-capped and cut off — the assist that can flip the car), slide-catch (grounded, above a speed floor), and downforce (default zero, kept for later phases).
- 14 tests in `tests/vehicle.test.ts` cover wheel geometry, rest suspension force (within 2% of mg), steer sign in both directions, brake-wins-over-throttle plus its anti-trivially-green companion, handbrake friction drop/restore, the authored throttle-oversteer term, live retuning, and all four assist-clamp/cutoff behaviors.
- Found and fixed two real bugs during implementation (see Deviations): a Rapier mass-properties timing gotcha not documented anywhere in 02-RESEARCH.md, and a sign error in the auto-level torque axis that IS in 02-RESEARCH.md's own verified code sample.

## Task Commits

Each task was committed atomically:

1. **Task 1: createVehicle factory — the measured Rapier construction (D-09)** - `07012d8` (feat) — includes `src/physics/vehicle-assists.ts` (see Deviations for why)
2. **Task 2: The four clamped arcade assists (D-03, D-06, D-07, D-08)** - `f2bf162` (test) — assist-specific test coverage; the implementation file was already committed in Task 1

## Files Created/Modified
- `src/physics/vehicle.ts` - `createVehicle`, `Vehicle`, `VehicleSample`, `sampleVehicle`, `FL`/`FR`/`RL`/`RR` (356 lines)
- `src/physics/vehicle-assists.ts` - `applyAssists`, `boxPrincipalInertia` (203 lines)
- `tests/vehicle.test.ts` - 14 cases across 6 `describe` blocks

## Decisions Made
- See `key-decisions` in frontmatter for the full rationale on each: the vehicle-assists.ts commit placement, the `recomputeMassPropertiesFromColliders()` fix, the auto-level torque-axis sign correction, and the `boxPrincipalInertia` test-anchor correction.
- Kept `dispose()` calling `world.removeVehicleController(vc)` (the documented public API) rather than the internal, `@internal`-tagged `vc.free()`.
- `applyAssists`'s unused `vc` parameter is retained in the signature (matching the plan's interface contract exactly, prefixed `_vc`) even though the current four terms never dereference it — `contacts` is passed in precomputed instead, matching 02-RESEARCH.md's own Pattern 3 code shape.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] `src/physics/vehicle-assists.ts` committed alongside `vehicle.ts` in Task 1, not Task 2**
- **Found during:** Task 1 (createVehicle factory)
- **Issue:** The plan's own action text requires `vehicle.ts`'s construction to call `boxPrincipalInertia` "(task 2)" and its `tick()` to call `applyAssists` — both exported only from `vehicle-assists.ts`, which the plan's `<files>` annotation assigns to Task 2. A strict per-task split would make Task 1's commit fail `npm run typecheck` on its own (missing module).
- **Fix:** Wrote `vehicle-assists.ts` fully (Task 2's complete implementation) before Task 1's commit, and included it in Task 1's commit alongside `vehicle.ts` and the Task-1-scoped subset of `tests/vehicle.test.ts`. Task 2's commit then adds only the assist-specific test coverage — no further source changes were needed.
- **Files modified:** `src/physics/vehicle-assists.ts` (created), `src/physics/vehicle.ts`, `tests/vehicle.test.ts`
- **Verification:** `npm run check` green at both commits (265 tests after Task 1, 270 after Task 2).
- **Committed in:** `07012d8` (Task 1 commit)

**2. [Rule 1 - Bug] Vehicle mass/inertia not in effect until the next `world.step()`**
- **Found during:** Task 2, while writing the "body-roll torque is capped" test — the measured applied impulse was ~180x the expected cap.
- **Issue:** `@dimforge/rapier3d@0.20.0`'s `setAdditionalMassProperties` `.d.ts` states the TOTAL mass properties (additional + collider-derived) are only recomputed "at the next physics step" unless `recomputeMassPropertiesFromColliders()` is called manually. Without it, any `applyTorqueImpulse`/`applyImpulse` call before the first `world.step()` divides by the tiny collider-default inertia (from the collider's own default density) instead of the intended cached inertia — inflating angular response by roughly two orders of magnitude on tick 0.
- **Fix:** Reordered `createVehicle` to create the collider before setting additional mass properties, and added `body.recomputeMassPropertiesFromColliders()` immediately after every `setAdditionalMassProperties` call (construction and `applyTuning`'s mass-changed branch). Added the same call to the test helper `makeFreeChassis`.
- **Files modified:** `src/physics/vehicle.ts`, `tests/vehicle.test.ts`
- **Verification:** "body-roll torque is capped" and "auto-level assist is gated to airborne only" tests pass; full suite green.
- **Committed in:** `07012d8` (Task 1 commit)

**3. [Rule 1 - Bug] Auto-level torque axis sign was inverted**
- **Found during:** Task 2, while writing the "auto-level assist is gated to airborne only" test — a chassis tilted 60deg about X grew to ~90deg over 30 ticks instead of recovering toward level.
- **Issue:** 02-RESEARCH.md's Pattern 3 code and 02-04-PLAN.md's action text both state the auto-level torque axis as `up_local x world_up = (up.z, 0, -up.x)`. That is the negation of the actual cross product (`up_local x world_up = (-up.z, 0, up.x)`); applying the documented sign drives the chassis AWAY from level, the opposite of D-07's intent.
- **Fix:** Negated the `x` and `z` torque components in `applyAssists`'s auto-level term, with an inline comment documenting the correction and the empirical evidence.
- **Files modified:** `src/physics/vehicle-assists.ts`
- **Verification:** "auto-level assist is gated to airborne only" passes (tilt recovers under the corrected sign); full suite green.
- **Committed in:** `07012d8` (Task 1 commit)

**4. [Rule 1 - Bug] `boxPrincipalInertia` test anchor corrected from the plan's stated figures**
- **Found during:** Task 2, writing "boxPrincipalInertia matches the Config A anchor".
- **Issue:** 02-RESEARCH.md line 1057 and 02-04-PLAN.md both state the box-inertia formula yields `{3080, 3480, 512}` kg·m² at Config A. Evaluating the documented formula (copied verbatim) against Config A's actual shipped `mass`/`halfExtents` gives `{3078.7, 3426.7, 614.7}` — `I.x` matches to three figures, but `I.y` is 1.5% off and `I.z` is 20% off. The box-inertia tensor for a uniform-density cuboid is unambiguous physics.
- **Fix:** Documented the discrepancy in `boxPrincipalInertia`'s doc comment and asserted the test against the corrected `{3078.7, 3426.7, 614.7}` figures instead of the doc's stated anchor.
- **Files modified:** `src/physics/vehicle-assists.ts`, `tests/vehicle.test.ts`
- **Verification:** Test passes within 1% on all three axes.
- **Committed in:** `f2bf162` (Task 2 commit)

**5. [Rule 3 - Blocking] Removed a literal `1/60` from a code comment**
- **Found during:** Task 1's own acceptance-criteria grep (`grep -c "1 / 60\|1/60\|0\.0167" src/physics/vehicle.ts` must return 0).
- **Issue:** An explanatory comment for `setCcdEnabled(true)` originally wrote out "at DT = 1/60", tripping the plan's literal (non-comment-aware) grep.
- **Fix:** Reworded the comment to say "at the imported DT" instead of spelling out the fraction.
- **Files modified:** `src/physics/vehicle.ts`
- **Verification:** `grep -c` now returns 0.
- **Committed in:** `07012d8` (Task 1 commit)

**6. [Rule 3 - Blocking] Reworded a doc comment to avoid the literal `addForce`/`addTorque(` substrings**
- **Found during:** Task 2's acceptance-criteria grep (`grep -c "addForce\|addTorque(" src/physics/vehicle-assists.ts` must return 0).
- **Issue:** The module doc comment explained why impulses are used instead of the persistent-force accumulator variants, naming them literally — tripping the plan's own literal grep, which does not exempt comment lines (unlike `tests/layering.test.ts`'s scanner).
- **Fix:** Reworded the paragraph to describe the forbidden technique by behavior ("the persistent-force-accumulator variants... that require an explicit per-tick reset") rather than by literal identifier, following the precedent recorded in STATE.md's `[Phase 02-03]` decision.
- **Files modified:** `src/physics/vehicle-assists.ts`
- **Verification:** `grep -c` now returns 0; full suite still green.
- **Committed in:** `07012d8` (Task 1 commit, prior to the vehicle-assists.ts commit boundary described in item 1)

---

**Total deviations:** 6 auto-fixed (1 blocking file-ordering, 3 bugs, 2 blocking literal-grep rewordings)
**Impact on plan:** All auto-fixes were necessary for correctness (items 2, 3) or for the plan's own stated acceptance criteria to be met (items 1, 4, 5, 6). No scope creep — no new files, no new dependencies, no architectural changes.

## Issues Encountered

None beyond the deviations documented above — all were discovered and resolved during test-writing, before any commit.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- `createVehicle`, `Vehicle`, `VehicleSample`, `sampleVehicle`, `FL`/`FR`/`RL`/`RR` are exported and ready for plan 02-06 (scene/view) to build a `vehicle-scene.ts` and wheel meshes around.
- `applyAssists`, `boxPrincipalInertia` are ready for plan 02-07's telemetry routines to drive the same vehicle headlessly.
- `npm run check` is green (typecheck + biome + full 270-test suite across 19 files); `tests/layering.test.ts` confirms `src/physics/vehicle.ts` and `src/physics/vehicle-assists.ts` stay free of `three`; `tests/determinism.test.ts` (the Phase 1 VEH-03 proof) is unchanged and still green; `src/physics/debug-scene.ts` was not edited.
- Two corrections to 02-RESEARCH.md's own claims (the auto-level torque-axis sign and the `boxPrincipalInertia` anchor numbers) should be folded back into that document if it is ever revised, so a future reader copying its code sample verbatim does not reintroduce the same bug.
- No blockers for downstream Phase 2 plans.

---
*Phase: 02-vehicle-feel-core*
*Completed: 2026-09-09*

## Self-Check: PASSED

- FOUND: src/physics/vehicle.ts
- FOUND: src/physics/vehicle-assists.ts
- FOUND: tests/vehicle.test.ts
- FOUND: .planning/phases/02-vehicle-feel-core/02-04-SUMMARY.md
- FOUND: 07012d8 (Task 1 commit)
- FOUND: f2bf162 (Task 2 commit)
