---
phase: 02-vehicle-feel-core
plan: 06
subsystem: vehicle-physics
tags: [rapier, three, convex-hull, vehicle-controller, ramp, vitest, typescript]

# Dependency graph
requires:
  - phase: 02-vehicle-feel-core
    provides: "src/physics/vehicle.ts's createVehicle(world, tuning, spawn) -> Vehicle and the FL/FR/RL/RR wheel-index contract (plan 02-04)"
provides:
  - "src/physics/vehicle-scene.ts: createVehicleScene(world, tuning) -> flat ground + a solved, tested convexHull ramp + one Vehicle, mirroring the shipped DebugScene contract"
  - "src/render/vehicle-view.ts: createVehicleView(wheelRadius, halfTrack, halfWheelbase, chassisHalfExtents) -> chassis mesh + 4 child wheel meshes with a per-frame wheel rig (updateWheels)"
  - "tests/vehicle-scene.test.ts: the ramp-geometry proof (02-RESEARCH.md Open Question 2) -- climb, launch, land, and an anti-trivially-green companion"
affects: [02-07-telemetry, 02-08-main-wiring, 02-09-tuning-panel]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Ramp authored as a ColliderDesc.convexHull wedge: six points forming a triangular-prism cross-section whose leading edge is a knife edge flush with the ground (y=0), eliminating the vertical-face collision the researcher's rotated-cuboid probe hit"
    - "VehicleScene supersedes DebugScene at the composition root only -- both debug-scene.ts files are untouched regression fixtures, never edited or deleted"
    - "src/render/vehicle-view.ts mirrors its physics-side ramp constants by hardcoded duplication plus a 'MUST MATCH' comment, rather than importing from src/physics/vehicle-scene.ts, keeping the render module a pure render concern per this plan's own reasoning for parameterising wheel geometry"
    - "Non-null-assertion-free Rapier wheel-getter reads (?? 0 fallbacks throughout updateWheels) plus module-scope scratch quaternions/vectors for zero per-frame allocation (T-02-16)"

key-files:
  created:
    - src/physics/vehicle-scene.ts
    - src/render/vehicle-view.ts
    - tests/vehicle-scene.test.ts
  modified: []

key-decisions:
  - "Ramp geometry (02-RESEARCH.md Open Question 2, previously unsolved): shipped as a ColliderDesc.convexHull wedge -- 6 points forming a right-triangle cross-section (knife edge at y=0/z=RAMP_APPROACH_Z, crest back-base at y=0/z=RAMP_CREST_Z, crest top at y=1.6/z=RAMP_CREST_Z), extruded along X. Verified empirically via a scripted full-throttle run: the car climbs the 7.6-degree slope with y increasing monotonically, forward speed never drops below 100% of its pre-ramp value (not just the required 60%), launches airborne past the 1.6m crest (measured max height 2.92m), and lands driveable (measured 1.68deg tilt and 42.4mph forward speed 0.5s after touchdown, against the 20deg/40mph gates)."
  - "The ramp's back face (crest-base to crest-top, both at z=RAMP_CREST_Z) is a vertical drop straight to the flat ground beyond -- this is what launches the car airborne at any climbing speed once it clears the crest, not just very high speeds. This was a deliberate geometry choice, not a side effect: it makes VEH-04's airborne assertion true by construction rather than by tuning a jump-trajectory threshold."
  - "src/render/vehicle-view.ts imports nothing from src/physics/ (not even RAMP_APPROACH_Z, which vehicle-scene.ts DOES export) -- ground/ramp visual dimensions are hardcoded constants with a 'MUST MATCH' comment cross-referencing the physics file. This follows the plan's own stated reasoning for why createVehicleView takes wheel geometry as explicit parameters rather than importing VehicleTuning: keep the render module a pure, physics-import-free concern and put the geometry contract at the composition-root call site (deferred to plan 02-08's src/main.ts)."
  - "The ramp visual is a hand-built 6-triangle non-indexed THREE.BufferGeometry (not an addons ConvexGeometry import) matching the physics wedge's own 6 vertices exactly, with winding verified by hand (right-hand-rule cross product) so each face's outward normal is correct without needing THREE.DoubleSide as a safety net."

requirements-completed: [VEH-01, VEH-04]

# Metrics
duration: 23min
completed: 2026-09-09
---

# Phase 02 Plan 06: Vehicle Scene and View Summary

**Flat ground plus a ColliderDesc.convexHull ramp wedge that solves 02-RESEARCH.md's previously-open ramp-geometry question, wired to a chassis+four-wheel Three.js view with a per-frame suspension/steer/roll wheel rig**

## Performance

- **Duration:** 23 min
- **Started:** 2026-09-09T20:19:24+01:00 (previous plan's completion commit)
- **Completed:** 2026-09-09T20:41:52+01:00
- **Tasks:** 2 completed
- **Files modified:** 3 (all created)

## Accomplishments
- `src/physics/vehicle-scene.ts` exports `createVehicleScene(world, tuning) -> VehicleScene`, mirroring the shipped `DebugScene` contract (`bodies`/`preTick`/`applyInput`) plus `setTuning`/`dispose`, so `src/loop.ts` needs no change to drive this scene instead of the Phase 1 debug scene.
- Solved 02-RESEARCH.md's Open Question 2 (ramp geometry, previously `[LOW]` confidence): the ramp is a `ColliderDesc.convexHull` wedge whose leading edge is a knife edge flush with the ground at y=0, eliminating the vertical-face collision the researcher's own rotated-cuboid probe hit. Verified headlessly, not by eye: `tests/vehicle-scene.test.ts` drives a scripted full-throttle run from spawn and asserts monotonic climb, airborne launch past the crest, and a driveable landing.
- `src/render/vehicle-view.ts` exports `createVehicleView(wheelRadius, halfTrack, halfWheelbase, chassisHalfExtents) -> VehicleView`: a chassis mesh (`meshes[0]`, posed by the existing interpolator) plus four wheel meshes built from one shared `CylinderGeometry`/material, added as chassis children so the chassis's own interpolated pose carries them for free.
- `updateWheels(vc)` reads `wheelChassisConnectionPointCs`/`wheelSuspensionLength` (vertical travel) and `wheelSteering`/`wheelAxleCs`/`wheelRotation` (steer + spin, composed as `steerQuat * rollQuat`) every frame, with `?? 0` fallbacks throughout (zero non-null assertions) and module-scope scratch quaternions/vectors so it allocates nothing per call.
- 11 test cases in `tests/vehicle-scene.test.ts`: scene structure (body/collider counts, spawn point), rest stability, the four-part ramp proof (climbable / airborne / lands driveable / anti-trivially-green throttle-0 companion), and `createVehicleView` parameter validation.
- `src/physics/debug-scene.ts` and `src/render/debug-scene.ts` were neither edited nor deleted; all three Phase 1 regression suites that import them (`tests/determinism.test.ts`, `tests/transform-cache.test.ts`, `tests/loop.test.ts`, 47 cases total) stay green.

## Task Commits

Each task was committed atomically:

1. **Task 1: Vehicle scene — flat plane plus a ramp the car can actually climb** - `44dc1a5` (feat)
2. **Task 2: Chassis and wheel meshes with the per-frame wheel rig** - `850ca9d` (feat) — includes parameter-validation and structural test cases added to `tests/vehicle-scene.test.ts` per the plan's own note that the executor may add them there

## Files Created/Modified
- `src/physics/vehicle-scene.ts` - `createVehicleScene`, `VehicleScene`, `RAMP_APPROACH_Z`, `SPAWN` (206 lines)
- `src/render/vehicle-view.ts` - `createVehicleView`, `VehicleView` (222 lines)
- `tests/vehicle-scene.test.ts` - 11 cases across 4 `describe` blocks

## Decisions Made
See `key-decisions` in frontmatter for the full rationale on each: the convexHull ramp shape and its empirical verification numbers, the deliberate vertical-drop-at-the-crest design, the hardcoded-not-imported render-side geometry constants, and the hand-built (not addons-imported) ramp visual geometry with hand-verified triangle winding.

Additional measured numbers from the scripted verification run (defaultTuning, full throttle from `SPAWN`), recorded here since they are the actual evidence the ramp works rather than an assumption:
- Ramp foot reached at ~16.5 m/s (~37 mph) after settling and full-throttle approach.
- Airborne at y=2.77m (crest is 1.6m), forward speed 18.9 m/s -- i.e. forward speed INCREASED through the climb, not merely "retained 60%".
- Touchdown tilt 11.4deg; 0.5s (30 ticks) later, tilt had settled to 1.68deg and forward speed was 42.4mph, both comfortably inside the 20deg/40mph gates.
- A throttle-0 companion run of equal tick length never left the ground even once (after the one-tick settle artifact at construction, which the test explicitly settles past first).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Removed a `// prettier-ignore` comment that Biome does not honour**
- **Found during:** Task 1, running `npm run check`
- **Issue:** The ramp's `Float32Array` literal was authored with inline trailing comments per row and a `// prettier-ignore` guard to keep that layout. Biome (this repo's formatter, not Prettier) does not recognize `// prettier-ignore` and reformatted the array onto one value per line, which also invalidated the per-row trailing comments' alignment.
- **Fix:** Removed the `prettier-ignore` comment, accepted Biome's one-value-per-line formatting, and replaced the per-row comments with a single doc comment above the array describing the six points in order (knife edge left/right, crest back-base left/right, crest top left/right).
- **Files modified:** `src/physics/vehicle-scene.ts`
- **Verification:** `npm run check` (lint step) passes with zero formatting diffs.
- **Committed in:** `44dc1a5` (Task 1 commit)

**2. [Rule 3 - Blocking] Same Biome-reformatting issue in the ramp's visual geometry array**
- **Found during:** Task 2, running `npm run check`
- **Issue:** `src/render/vehicle-view.ts`'s triangle-vertex array had the same per-row-comment layout and hit the same Biome reformatting as item 1.
- **Fix:** Let Biome reformat the array (one vertex per line); the per-triangle trailing comments (`// top slope`, `// left side`, etc.) survived the reformat unchanged since they attach to the last token of each triangle's third vertex.
- **Files modified:** `src/render/vehicle-view.ts`
- **Verification:** `npm run check` passes with zero formatting diffs.
- **Committed in:** `850ca9d` (Task 2 commit)

---

**Total deviations:** 2 auto-fixed (both blocking formatting issues caught by the plan's own `npm run check` verification step, not real logic changes)
**Impact on plan:** No scope creep — no new files, no new dependencies, no architectural changes. Both fixes were required for the plan's own acceptance criteria (a clean `npm run check`) to pass.

## Issues Encountered

None beyond the deviations documented above. The ramp geometry itself — the piece 02-RESEARCH.md flagged as `[LOW]` confidence and explicitly unsolved — worked on the first empirically-verified attempt with no iteration needed on the point layout; the only iteration was on the test file's climb-window slicing (an early draft accidentally included post-landing samples in the "monotonic climb" check, caught immediately by a failing assertion and fixed before commit, not a runtime physics issue).

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- `createVehicleScene`, `VehicleScene`, `RAMP_APPROACH_Z`, `SPAWN` are exported and ready for plan 02-07's telemetry routines to drive scripted runs against a known ramp position without duplicating literals.
- `createVehicleView`, `VehicleView` are exported and ready for plan 02-08 to wire into `src/main.ts` alongside `applyAllInterpolated`, replacing the Phase 1 debug render scene at the composition root.
- `npm run check` is green: typecheck + Biome + full 297-test suite across 20 files. `tests/layering.test.ts` confirms `src/physics/vehicle-scene.ts` stays free of `three`, and `src/render/vehicle-view.ts` reads the Rapier vehicle controller without tripping the `src/render/` write-ban scan.
- `src/physics/debug-scene.ts` and `src/render/debug-scene.ts` remain untouched regression fixtures; retiring them (and rewriting `tests/determinism.test.ts`/`tests/transform-cache.test.ts`/`tests/loop.test.ts` onto the vehicle scene) is still a deliberately separate, unplanned future task, not something this plan or its successor should do as a side effect.
- No blockers for downstream Phase 2 plans. One item worth a note at phase verification: `src/core/sim-clock.ts` and `src/physics/debug-scene.ts` show as locally modified in `git status` with no actual content diff (CRLF/LF line-ending normalization only, pre-existing before this plan's work began) — not something this plan introduced or needed to resolve.

---
*Phase: 02-vehicle-feel-core*
*Completed: 2026-09-09*

## Self-Check: PASSED

- FOUND: src/physics/vehicle-scene.ts
- FOUND: src/render/vehicle-view.ts
- FOUND: tests/vehicle-scene.test.ts
- FOUND: .planning/phases/02-vehicle-feel-core/02-06-SUMMARY.md
- FOUND: 44dc1a5 (Task 1 commit)
- FOUND: 850ca9d (Task 2 commit)
