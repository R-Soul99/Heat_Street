---
phase: 03-surfaces-helicopter-camera
plan: 05
subsystem: physics
tags: [rapier, three, scene-builder, surface-friction, occlusion-fixture]

# Dependency graph
requires:
  - phase: 03-03
    provides: src/physics/surface.ts (SurfaceMap/SurfaceContext), Vehicle.tick's optional surfaces parameter and Vehicle.wheelSurfaces
  - phase: 02 (vehicle-feel-core)
    provides: src/physics/vehicle-scene.ts / src/render/vehicle-view.ts (the structural template this plan follows)
provides:
  - src/physics/surface-scene.ts -- six contiguous surface zones (D-01 patchwork), two placeholder building clusters (D-06/D-07 sparse + dense/urban-canyon), one Vehicle, headlessly proven by a straight full-throttle drive crossing all six SURFACE_ZONE_ORDER surfaces in order
  - src/render/surface-view.ts -- six coloured zone meshes + both building clusters as one disposable THREE.Group, with buildingMeshes exposed for plan 03-08's occlusion raycast probe
  - src/render/vehicle-view.ts's createVehicleView options.includePhase2Ground parameter -- lets the composition root swap Phase 2's flat ground/ramp for surface-view.ts's zones/buildings while keeping the GridHelper speed-reference grid
affects: [03-06 (composition-root wiring of createSurfaceScene/createSurfaceWorld), 03-07/03-08 (surface FX / occlusion mitigations consuming SURFACE_ZONE_ORDER, wheelSurfaces and buildingMeshes), 03-11 (feel-session retuning against this scene)]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Physics/render geometry duplication with MUST MATCH comments, never cross-imported between tiers (vehicle-scene.ts/vehicle-view.ts's existing convention, extended to the new zone/building geometry)"
    - "Hand-placed layout tables (SPARSE_BUILDINGS/DENSE_BUILDINGS) as literal, fully-enumerated arrays rather than loop-synthesised positions, so a deliberate layout stays legible to a human reader"
    - "Nullable-resource dispose pattern (createVehicleView's ground/ramp) for an optional construction branch, so dispose() never calls .dispose() on a resource that was never created"

key-files:
  created: [src/physics/surface-scene.ts, src/render/surface-view.ts, tests/surface-scene.test.ts]
  modified: [src/render/vehicle-view.ts]

key-decisions:
  - "SC1's headless straight-drive test stops as soon as the collapsed surface sequence reaches all six surfaces, rather than running a fixed 1800-tick loop unconditionally -- past the mud zone's far edge (z=-240) the world has no collider, and SurfaceMap's documented absent-handle default would otherwise append a spurious trailing 'tarmac' entry unrelated to D-01's six-surface crossing"
  - "Zone materials (six) and their dispose() calls are unrolled as explicitly named constants (tarmacMaterial..mudMaterial) rather than built via a loop over a data array, matching vehicle-view.ts's own explicit 'one line per resource' dispose convention (lines 338-349) the plan's <action> names verbatim"
  - "Building layout tables (SPARSE_BUILDINGS/DENSE_BUILDINGS) are fully literal arrays, not synthesised via nested loops over row/column indices, so the D-06/D-07 hand-placed layout stays legible as data a human can read directly"

patterns-established:
  - "createVehicleView's options.includePhase2Ground parameter: an optional trailing options object widening an existing factory signature so every prior call site keeps compiling and behaving identically when omitted -- same shape as plan 03-03's Vehicle.tick surfaces? parameter"

requirements-completed: [SURF-01, CAM-04]

# Metrics
duration: 6min
completed: 2026-09-12
---

# Phase 3 Plan 5: Surface Test Scene and Building Clusters Summary

**Six contiguous surface zones (tarmac through mud) and two deliberately different building clusters (sparse + urban-canyon), proven headlessly by a single straight drive that crosses all six surfaces in order, plus their matching render-tier visuals.**

## Performance

- **Duration:** ~6 min (execution only; context-loading and research review not counted)
- **Started:** 2026-09-12T14:27:18+01:00 (first commit, RED test)
- **Completed:** 2026-09-12T14:33:15+01:00
- **Tasks:** 2
- **Files modified:** 4 (2 created source files, 1 created test file, 1 modified source file)

## Accomplishments
- `src/physics/surface-scene.ts`: `createSurfaceScene(world, tuning, profiles)` builds D-01's patchwork of six 120x2x80m surface bands tiled contiguously along Z (tarmac at +200 down to mud at -200, no gap/overlap), registers each into a fresh `SurfaceMap`, builds D-06/D-07's sparse (4 buildings, +X side, clear of the drive line) and dense/urban-canyon (10 buildings, two rows 10m apart) clusters, and spawns exactly one `Vehicle` on tarmac 45m clear of the first surface boundary. `applyInput` passes the scene's `SurfaceContext` into `vehicle.tick`, making per-wheel surface grip (plan 03-03) live in this scene for the first time. `setSurfaceProfiles` lets a future tuning panel swap grip tables with no scene rebuild.
- `tests/surface-scene.test.ts` (13 tests): mechanically proves registration/contiguity/order/spawn-clearance, the D-06/D-07 building-cluster layout contract (count, cluster separation, 8-14m canyon corridor, 20m+ building height), scene structure (`bodies` chassis-only, `dispose()` safety, tarmac rest state) -- and the SC1 headless proof itself: a full-throttle, zero-steer drive whose collapsed `wheelSurfaces[0]` sequence exactly equals `SURFACE_ZONE_ORDER`.
- `src/render/surface-view.ts`: `createSurfaceWorld()` builds six coloured zone meshes (one shared geometry, one material per surface) and both building clusters (one shared geometry per cluster, one base material cloned per instance so plan 03-08 can set per-building fade opacity later) as one disposable `THREE.Group`. Every geometry constant is a literal duplicate of `surface-scene.ts`'s values with a `MUST MATCH` comment -- no cross-tier import, continuing `vehicle-view.ts`'s established convention.
- `src/render/vehicle-view.ts`: `createVehicleView` gained an optional `options.includePhase2Ground` parameter (default `true`, every existing call site unaffected) so the composition root can omit the Phase 2 flat ground/ramp meshes while still building the `GridHelper` speed-reference grid on both branches.
- Zero regression: `tests/vehicle-scene.test.ts`, `tests/determinism.test.ts`, `tests/transform-cache.test.ts`, `tests/loop.test.ts`, `tests/layering.test.ts` all pass unchanged. Full repo suite: 30 files, 477 tests, all passing.

## Task Commits

Each task was committed atomically, TDD RED then GREEN:

1. **Task 1: The six-zone surface scene with two building clusters**
   - `5589784` test(03-05): add failing test for the six-zone surface scene
   - `fb372c9` feat(03-05): add the six-zone surface test scene with two building clusters
2. **Task 2: Visual zone planes and building meshes matching the physics scene**
   - `84e8066` feat(03-05): add surface-view render tier and vehicle-view ground option

_Note: this plan required no plan-level metadata commit -- STATE.md/ROADMAP.md are updated centrally by the orchestrator after all Wave 3 worktree agents merge (worktree isolation mode)._

## Files Created/Modified
- `src/physics/surface-scene.ts` -- `SURFACE_ZONE_ORDER`/`SURFACE_SCENE_SPAWN`/`SPARSE_BUILDINGS`/`DENSE_BUILDINGS`/`SurfaceScene`/`createSurfaceScene`; pure, no `three` import, no ramp
- `tests/surface-scene.test.ts` -- 13 tests: zone registration/contiguity/order/spawn clearance, D-02 structural proxy, SC1 headless proof, D-06/D-07 building layout, scene structure
- `src/render/surface-view.ts` -- `SurfaceWorldView`/`createSurfaceWorld`; six zone meshes + 14 building meshes as one disposable group; zero Rapier import (not even `import type`)
- `src/render/vehicle-view.ts` -- `createVehicleView` gained `options?.includePhase2Ground`; ground/ramp geometry/material now nullable and conditionally built/disposed; `GridHelper` unconditional. Also normalized from CRLF to LF (pre-existing repo-wide checkout artifact, same fix already applied to `vehicle.ts` in plan 03-03).

## Decisions Made
- SC1's headless test stops once all six surfaces have been observed rather than running a fixed 1800-tick loop -- see key-decisions above.
- Zone materials (six) are explicitly named constants with individually-written `dispose()` calls, matching `vehicle-view.ts`'s existing per-resource dispose convention rather than a data-driven loop.
- `SPARSE_BUILDINGS`/`DENSE_BUILDINGS` are fully literal, hand-enumerated tables (not loop-synthesised), per D-07's "not hidden in a loop" intent for a deliberately legible layout.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Corrected the SC1 test's stop condition to avoid a spurious trailing surface**
- **Found during:** Task 1, first GREEN run of `tests/surface-scene.test.ts`
- **Issue:** The plan's `<behavior>` text describes driving "up to 1800 ticks" and asserting the collapsed sequence equals `SURFACE_ZONE_ORDER`. Running the full 1800 ticks unconditionally drives the car past the mud zone's far edge (z = -240) into open world with no collider there, where `SurfaceMap.lookup`'s documented absent-handle fallback resolves to the map's default surface (`"tarmac"`), appending a spurious seventh entry (`[..., "mud", "tarmac"]`) that has nothing to do with the six-surface crossing.
- **Fix:** Changed the loop to stop as soon as the collapsed sequence reaches `SURFACE_ZONE_ORDER.length` (6), consistent with "up to 1800 ticks" as an upper bound rather than a mandatory fixed duration.
- **Files modified:** `tests/surface-scene.test.ts`
- **Verification:** Test passes; collapsed sequence is exactly `["tarmac","gravel","dirt_road","grass","sand","mud"]`
- **Committed in:** `fb372c9` (Task 1 GREEN commit)

**2. [Rule 3 - Blocking] Normalized `src/render/vehicle-view.ts` from CRLF to LF line endings**
- **Found during:** Task 2, running `npx biome check` on the files this task edits
- **Issue:** The working-tree checkout of `src/render/vehicle-view.ts` had CRLF line terminators throughout the whole (pre-existing) file despite the committed blob being LF -- the same repo-wide `core.autocrlf=true` artifact already documented in `.planning/STATE.md`'s Blockers/Concerns and previously fixed for `src/physics/vehicle.ts` in plan 03-03. Untouched, this made Biome report the entire file as a formatting diff, masking any genuine formatting issue in this task's own edits.
- **Fix:** Converted the file's line endings to LF via a Node one-liner (`\r\n` -> `\n`, no content change).
- **Files modified:** `src/render/vehicle-view.ts` (whitespace-only for the CRLF conversion; the `options.includePhase2Ground` feature edits are separate content changes in the same commit)
- **Verification:** `npx biome check src/render/vehicle-view.ts src/render/surface-view.ts` passes clean; `npm run typecheck` passes; full repo test suite (477 tests) passes
- **Committed in:** `84e8066` (Task 2 commit)

### Acknowledged, Not Fixed

**3. Acceptance criterion "`grep -c \"setFriction(1.0)\"` returns 6" not satisfied (actual: 1)**
- **Context:** The plan's `<action>` for Task 1 explicitly specifies a single reusable `buildSurfaceZone(world, surfaceMap, surface, centerZ)` function ("mirroring `buildGround`") called once per zone, which by construction produces exactly ONE literal `.setFriction(1.0)` occurrence in the source text regardless of how many times the function runs. The acceptance criterion's literal grep count of 6 is only achievable by duplicating the `.setFriction(1.0)` call six times (once per zone, unrolled) -- which directly contradicts the same task's explicit DRY-function directive, and the codebase's established `vehicle-scene.ts` precedent of one function per distinct geometry, not one call site per invocation.
- **Decision:** Kept the shared `buildSurfaceZone` function. The underlying invariant this criterion protects -- "every band shares the exact same ground-collider friction value" -- is enforced structurally (one function, one literal `1.0`, incapable of drifting per-band) rather than by six independent text occurrences that could themselves silently diverge from each other. This is a stronger guarantee of the stated intent, not a weaker one.
- **Verification of the underlying intent:** `tests/surface-scene.test.ts`'s registration/contiguity tests exercise the actual runtime friction behavior indirectly via the SC1 straight-drive proof (grip differences come only from per-wheel friction, never the ground collider); no test depends on the literal count.
- **Not committed as a fix** -- documented here per this session's deviation-tracking requirement instead.

---

**Total deviations:** 2 auto-fixed (1 test-logic bug, 1 blocking line-ending fix), 1 acknowledged-but-not-fixed acceptance-criterion conflict (documented above, not a code change).
**Impact on plan:** No scope creep. The acceptance-criterion conflict is a plan-authoring inconsistency between two directives in the same task (a DRY function vs. a literal-count grep), resolved in favor of the codebase's established DRY convention and the plan's own explicit `<action>` text.

## Issues Encountered
- `node_modules` did not exist in this worktree at spawn time (fresh worktree checkout). Ran `npm install` once at the start of execution to restore it -- infrastructure setup, not a code change.
- `npm run check`'s lint step fails on ~48 pre-existing files this plan never touched (`vite.config.ts`, `src/loop.ts`, `src/main.ts`, `tests/vehicle.test.ts`, etc.) -- the same pre-existing repo-wide CRLF-vs-LF checkout mismatch already tracked in `.planning/STATE.md`'s Blockers/Concerns and `.planning/phases/02-vehicle-feel-core/deferred-items.md`. Confirmed out of scope per the deviation rules' Scope Boundary: `npx biome check` limited to this plan's four touched files passes clean, `npm run typecheck` passes, and the full `npx vitest run` (30 files, 477 tests) passes. Not a regression introduced here.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- `SURFACE_ZONE_ORDER`, `SURFACE_SCENE_SPAWN`, `SPARSE_BUILDINGS`/`DENSE_BUILDINGS`, `createSurfaceScene` and `createSurfaceWorld` are ready for plan 03-06 to wire into the composition root (`src/main.ts`), replacing `createVehicleScene`/`createVehicleView`'s Phase 2 defaults with `includePhase2Ground: false`.
- `SurfaceWorldView.buildingMeshes` (14 meshes, sparse-then-dense order) is ready for plan 03-08's `THREE.Raycaster` occlusion probe to consume directly via `intersectObjects`.
- `Vehicle.wheelSurfaces` is now exercised end-to-end in a real multi-surface scene for the first time (previously only unit-tested in plan 03-03's isolated two-zone scenarios) -- ready for plans 03-07/03-08's FX/audio consumers.
- No blockers for 03-06 (the sibling parallel plan in this wave) -- no `files_modified` overlap, confirmed by the plan frontmatter.

---
*Phase: 03-surfaces-helicopter-camera*
*Completed: 2026-09-12*

## Self-Check: PASSED

- FOUND: src/physics/surface-scene.ts
- FOUND: src/render/surface-view.ts
- FOUND: tests/surface-scene.test.ts
- FOUND: src/render/vehicle-view.ts (modified)
- FOUND: 5589784 (test(03-05): add failing test for the six-zone surface scene)
- FOUND: fb372c9 (feat(03-05): add the six-zone surface test scene with two building clusters)
- FOUND: 84e8066 (feat(03-05): add surface-view render tier and vehicle-view ground option)
