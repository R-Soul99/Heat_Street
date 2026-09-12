---
phase: 03-surfaces-helicopter-camera
plan: 03
subsystem: physics
tags: [rapier, vehicle-controller, surface-friction, typescript]

# Dependency graph
requires:
  - phase: 03-01
    provides: src/core/surface-types.ts (SurfaceType), src/core/surface-tuning.ts (SurfaceProfiles/defaultSurfaceProfiles)
provides:
  - SurfaceMap side-table (src/physics/surface.ts) mapping ColliderHandle -> SurfaceType with zero per-tick allocation
  - SurfaceContext bundling map + profiles as the single object Vehicle.tick consumes
  - Vehicle.tick's optional third parameter applying per-wheel forward/lateral grip multipliers before the existing friction setters run
  - Vehicle.wheelSurfaces telemetry (readonly SurfaceType[], length 4, FL/FR/RL/RR order)
affects: [03-05 (surface test scene), 03-06 (composition-root wiring), 03-07/03-08 (surface FX/audio consumers of wheelSurfaces), 03-11 (feel-session retuning of SurfaceProfiles)]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "ColliderHandle-keyed Map side-table for physics-object metadata, avoiding collider.parent() WASM-wrapper allocation per wheel per tick"
    - "Optional trailing parameter widening an existing tick() signature so every prior call site keeps compiling and behaving identically when omitted"
    - "Composition, not replacement: a new per-tick multiplier scales an existing blended value in place rather than writing its own setter call that would silently overwrite the blend"

key-files:
  created: [src/physics/surface.ts, tests/surface.test.ts]
  modified: [src/physics/vehicle.ts]

key-decisions:
  - "SurfaceMap is a Map<number, SurfaceType> side-table, not RigidBody.userData via collider.parent() — the shipped @dimforge/rapier3d@0.20.0 Collider/ColliderDesc bindings have no userData slot at all, and .parent() allocates a fresh RigidBody WASM wrapper on every call for every wheel every tick"
  - "The one-tick raycast lag (03-RESEARCH.md Pitfall 2) is real but does NOT manifest in a single-zone test scene as originally assumed: the shipped DynamicRayCastVehicleController's wheelGroundObject raycast is not bounded to wheelIsInContact's suspension-travel range, finding a ground collider even 50m away. The lag test instead teleports the chassis between two separate ground zones; the airborne-fallback test uses a world with no ground collider at all rather than merely a distant one."
  - "Rear side friction's surface lateralGrip multiplier is captured in the new step-0 surface block but APPLIED in the existing step-4 handbrake/power-oversteer blend (rearSfs * rearLateralGrip[i]), never written directly by step 0 — writing it there would let step 4 silently overwrite it, discarding the surface effect on exactly the two wheels the RWD-loose feel depends on"

requirements-completed: [SURF-01]

# Metrics
duration: 10min
completed: 2026-09-12
---

# Phase 3 Plan 3: Per-Wheel Surface Friction Summary

**Each of a vehicle's four wheels independently resolves the collider under it to a surface type and scales its own forward/lateral grip by that surface's tuned multiplier, every fixed tick, with zero behavioural change when no surface context is supplied.**

## Performance

- **Duration:** ~10 min (execution only; context-loading and research review not counted)
- **Started:** 2026-09-12T14:07:00+01:00 (approx, first test write)
- **Completed:** 2026-09-12T14:16:52+01:00
- **Tasks:** 2
- **Files modified:** 3 (1 created source file, 1 created test file, 1 modified source file)

## Accomplishments
- `src/physics/surface.ts`: `createSurfaceMap()`/`register()`/`lookup()` — a `ColliderHandle -> SurfaceType` side-table that never throws, defaults unregistered/absent handles safely, and treats handle `0` as legitimate (never a truthiness test). Closes CLAUDE.md's open "surface-type-to-collider mapping" gap in code, with the rejected `.parent()` alternative documented and its allocation cost cited.
- `src/physics/vehicle.ts`: `Vehicle.tick()` gained an optional `SurfaceContext` third parameter. When supplied, a new step 0 (top of tick, before steering) reads each wheel's ground collider, resolves its surface, and scales `frictionSlip`/`frontSideFriction` before the existing setters run. Rear side friction's surface multiplier composes onto (never replaces) the existing handbrake/power-oversteer blend.
- `Vehicle.wheelSurfaces`: a length-4, allocate-once, mutate-in-place array (matching `TransformCache`'s discipline) reporting each wheel's currently-resolved surface for future FX/audio consumers (plans 03-07/03-08).
- Zero behavioural change proven: `tests/determinism.test.ts`, `tests/vehicle-telemetry.test.ts`, `tests/vehicle.test.ts`, `tests/vehicle-scene.test.ts` all pass unchanged, same test counts as before this plan (no existing test file edited).

## Task Commits

Each task was committed atomically, TDD RED then GREEN:

1. **Task 1: SurfaceMap side-table keyed on ColliderHandle**
   - `79aee2a` test(03-03): add failing SurfaceMap test for surface.ts
   - `b809091` feat(03-03): add SurfaceMap side-table keyed on ColliderHandle
2. **Task 2: Apply per-wheel surface grip inside the fixed tick**
   - `b3b382e` test(03-03): add failing Vehicle.tick surface-integration tests
   - `9bd3842` feat(03-03): apply per-wheel surface grip inside Vehicle.tick

_Note: this plan required no plan-level metadata commit — STATE.md/ROADMAP.md are updated centrally by the orchestrator after all Wave 2 worktree agents merge (worktree isolation mode)._

## Files Created/Modified
- `src/physics/surface.ts` — `SurfaceMap`/`createSurfaceMap`/`SurfaceContext`; pure, no `three` import, zero per-tick allocation
- `tests/surface.test.ts` — Wave-0 gate: 6 `SurfaceMap` unit tests + 8 `Vehicle.tick` integration tests (real `createWorld()`/`createVehicle()`, no mocks)
- `src/physics/vehicle.ts` — `tick()` widened with an optional `surfaces?: SurfaceContext` parameter; `Vehicle.wheelSurfaces` added; new step 0 surface-grip block; step 4's rear side friction now composes the surface's `lateralGrip`

## Decisions Made
- `SurfaceMap` implemented as a `Map<ColliderHandle, SurfaceType>` per 03-RESEARCH.md's recommendation, not `RigidBody.userData` — the shipped Rapier binding has no collider-level userData, and the `.parent()` alternative allocates per wheel per tick.
- One-tick raycast lag and airborne fallback both required rethinking the test scenarios from the plan's literal `<behavior>` text after empirically measuring that `wheelGroundObject`'s raycast is not range-limited to `wheelIsInContact`'s suspension-travel window — see Deviations below.
- Rear side friction's surface scaling is composed in step 4 (multiplying the existing blended value), never written by the new step 0, per the plan's explicit anti-pattern warning.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Corrected two integration test scenarios that made incorrect assumptions about Rapier's raycast range**
- **Found during:** Task 2 (writing the surface-integration tests before the `vehicle.ts` edit)
- **Issue:** The plan's `<behavior>` text implied a single-zone scene, spawned fresh, would demonstrate the one-tick lag on tick 1 (wheelGroundObject null before any prior `updateVehicle` call) and that a vehicle spawned 50m above a registered ground collider would report the map's default surface (implying no raycast hit that far away). Both assumptions were empirically false: the shipped `DynamicRayCastVehicleController`'s wheel raycast finds a ground collider even 50m away and even before any prior `tick()` call for that vehicle (contact establishment happens earlier than assumed, and the ray is not bounded to suspension-travel range the way `wheelIsInContact` is).
- **Fix:** Rewrote the one-tick-lag test to teleport the chassis between two separate, non-overlapping ground zones (tarmac then mud) and assert the OLD surface is still reported for exactly one tick after the teleport, then the new surface on the tick after. Rewrote the airborne-fallback test to use a world with no ground collider at all, guaranteeing a true `null` raycast result rather than depending on raycast range.
- **Files modified:** `tests/surface.test.ts` (test-only; no `src/physics/vehicle.ts` behavior changed as a result — the implementation matches 03-RESEARCH.md Pattern 1 and Pitfall 2 exactly as written)
- **Verification:** All 8 integration tests plus the 6 `SurfaceMap` unit tests pass; the corrected tests still exercise the exact behaviors 03-VALIDATION.md requires (lag exists, is one tick, and the airborne path never throws)
- **Committed in:** `b3b382e` (Task 2 RED commit)

**2. [Rule 3 - Blocking] Normalized `src/physics/vehicle.ts` from CRLF to LF line endings**
- **Found during:** Task 2, running `npm run check`'s lint step after the implementation
- **Issue:** The working-tree checkout of `src/physics/vehicle.ts` had CRLF line terminators throughout the whole (pre-existing) file despite the committed blob being LF — a repo-wide, pre-existing `core.autocrlf=true` artifact already tracked in `.planning/STATE.md`'s Blockers/Concerns (logged during Phase 2). Untouched, this made Biome report ~700 lines of spurious formatting diffs on a file this plan needed to edit, and one genuine formatting issue in the new test code was masked by the noise.
- **Fix:** Converted the file's line endings to LF via a Node one-liner (`\r\n` -> `\n`, no content change), then let `npx biome check --write` fix one genuine over-long test assertion in `tests/surface.test.ts`.
- **Files modified:** `src/physics/vehicle.ts` (whitespace-only for the CRLF conversion), `tests/surface.test.ts` (one assertion reformatted)
- **Verification:** `npx biome check src/physics/surface.ts src/physics/vehicle.ts tests/surface.test.ts` passes clean; `npm run typecheck` passes; the full target test suite passes
- **Committed in:** `9bd3842` (Task 2 GREEN commit, noted explicitly in the commit body)

---

**Total deviations:** 2 auto-fixed (1 bug-in-test-assumption, 1 blocking line-ending fix)
**Impact on plan:** Neither changed the shipped `src/physics/vehicle.ts` behavior versus 03-RESEARCH.md/03-PATTERNS.md's specification — both were corrections to get the test suite itself to accurately describe real, measured Rapier behavior and to make the existing toolchain runnable on a file this plan had to touch. No scope creep.

## Issues Encountered
- `node_modules` did not exist in this worktree at spawn time (a fresh worktree checkout, not a copy of an installed one); ran `npm install` once at the start of execution to restore it. Not a plan deviation — infrastructure setup, not a code change.
- `npm run check`'s lint step fails repo-wide on ~19 pre-existing files this plan never touched (`src/core/frame-budget.ts`, `src/loop.ts`, `src/main.ts`, `vite.config.ts`, `tsconfig.json`, etc.) — the same pre-existing CRLF-vs-LF working-directory mismatch already documented in `.planning/STATE.md`'s Blockers/Concerns and `.planning/phases/02-vehicle-feel-core/deferred-items.md`. Confirmed out of scope per the deviation rules' Scope Boundary (only fix issues directly caused by this plan's own changes) and per this session's explicit parallel-execution guidance not to hand-edit stale-CRLF files outside this plan's own touched files. `npx biome check` limited to this plan's three files (`src/physics/surface.ts`, `src/physics/vehicle.ts`, `tests/surface.test.ts`) passes clean. `npm run typecheck` and every targeted `npx vitest run` invocation in the plan's `<verification>` section pass. This is a pre-existing, already-tracked repo-wide issue, not a regression introduced here.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- `SurfaceMap`/`SurfaceContext`/`Vehicle.wheelSurfaces` are ready for plan 03-05 (surface test scene, which will call `surfaceMap.register()` per zone collider) and plans 03-07/03-08 (surface FX/audio, which will read `vehicle.wheelSurfaces` each render frame).
- `SurfaceProfiles`' starting multiplier values (from plan 03-01's `defaultSurfaceProfiles()`) are unretuned research estimates for grass/sand/mud per 03-RESEARCH.md's own `[ASSUMED]` tagging — flagged there for plan 03-11's feel session, not a blocker for this plan or its immediate dependents.
- No blockers for 03-04 (the sibling parallel plan in this wave) — no `files_modified` overlap, confirmed by the plan frontmatter.

---
*Phase: 03-surfaces-helicopter-camera*
*Completed: 2026-09-12*

## Self-Check: PASSED

- FOUND: src/physics/surface.ts
- FOUND: tests/surface.test.ts
- FOUND: src/physics/vehicle.ts
- FOUND: 79aee2a (test(03-03): add failing SurfaceMap test for surface.ts)
- FOUND: b809091 (feat(03-03): add SurfaceMap side-table keyed on ColliderHandle)
- FOUND: b3b382e (test(03-03): add failing Vehicle.tick surface-integration tests)
- FOUND: 9bd3842 (feat(03-03): apply per-wheel surface grip inside Vehicle.tick)
