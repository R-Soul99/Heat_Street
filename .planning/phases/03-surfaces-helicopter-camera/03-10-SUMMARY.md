---
phase: 03-surfaces-helicopter-camera
plan: 10
subsystem: rendering
tags: [three.js, particles, decals, surface-fx, points, decal-geometry]

# Dependency graph
requires:
  - phase: 03-surfaces-helicopter-camera (plan 03-03)
    provides: Vehicle.wheelSurfaces (FL/FR/RL/RR SurfaceType array), per-wheel surface grip
  - phase: 03-surfaces-helicopter-camera (plan 03-05)
    provides: src/render/surface-view.ts SurfaceWorldView (zone meshes, building meshes)
  - phase: 03-surfaces-helicopter-camera (plan 03-09)
    provides: occlusion mitigation A/B, the render-callback ordering fx.update slots into
provides:
  - "src/render/surface-fx.ts: SurfaceFx / createSurfaceFx / SURFACE_FX_PROFILES -- six fixed-pool particle systems plus a 48-slot skid-decal ring buffer"
  - "VehicleView.wheelMeshes and SurfaceWorldView.zoneMeshes accessors"
  - "Composition-root wiring in src/main.ts feeding per-wheel surface/grounded/slip/position into fx.update every render frame"
affects: [03-12-feel-session-playtest]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Fixed-capacity Float32Array particle pool (position/colour/velocityY/age), swap-remove compaction on retirement, zero per-frame allocation"
    - "Fixed-size ring buffer of persistent Mesh+material-clone slots, DecalGeometry rebuilt per spawn as the one documented per-spawn allocation, previous geometry disposed before reassignment"
    - "Per-vertex grey-multiplier vertexColors fade as a THREE.PointsMaterial per-vertex-alpha workaround (documented trade-off, not true alpha)"
    - "Emission gated on grounded+slip>threshold, rate scaling with excess slip via a frame-rate-independent carried accumulator"

key-files:
  created:
    - src/render/surface-fx.ts
  modified:
    - src/render/vehicle-view.ts
    - src/render/surface-view.ts
    - src/main.ts
    - docs/frame-budget.md

key-decisions:
  - "Slip thresholds (SLIP_THRESHOLD_HIGH=65/MID=30/LOW=12) calibrated against a headless measurement session against defaultTuning(), not guessed -- full-throttle/full-brake tarmac driving peaks at combined magnitude ~61 (pure engine-force artifact, near-zero side impulse), a handbrake slide peaks at ~89 combined"
  - "Skid-decal spawn condition read as a continuously-checked gate (grounded+slip>threshold), not a one-shot edge trigger, with DECAL_MIN_SPACING_M as the actual repeat-rate limiter -- a strict edge trigger would make the plan's own stated purpose for the distance gate (stopping a stationary spinning wheel from exhausting the pool in one second) unreachable in the first place"
  - "Per-particle fade implemented via vertexColors grey-multiplier rather than a custom ShaderMaterial, since THREE.PointsMaterial has no native per-vertex alpha and a hand-rolled shader is outside this phase's simple-sprite scope -- documented as a visible trade-off (particles darken rather than losing true alpha)"
  - "48 decal material clones (not just the six per-surface templates) are individually disposed in dispose(), beyond this plan's own threat-model shorthand ('six decal materials') -- see Deviations below"

patterns-established:
  - "Idle particle/decal systems toggle Object3D.visible = false to skip their draw call entirely, rather than relying on an empty drawRange alone"

requirements-completed: [SURF-02]

# Metrics
duration: 25min
completed: 2026-09-13
---

# Phase 3 Plan 10: Surface Particle FX and Skid Decals Summary

**Six independently-tuned THREE.Points particle pools (tarmac smoke, gravel/dirt_road/sand dust, grass flecks, mud spray) plus a 48-slot recycled skid-decal ring buffer using the bundled DecalGeometry addon, wired into the composition root and gated on measured slip-impulse thresholds rather than guessed ones.**

## Performance

- **Duration:** ~25 min
- **Tasks:** 3
- **Files modified:** 5 (1 created, 4 modified)

## Accomplishments

- `src/render/surface-fx.ts`: `SURFACE_FX_PROFILES`, one entry per `SurfaceType`, differing across five independent axes (colour, particle size, lifetime, emission rate, rise/gravity fall behaviour) per D-09's literal "all six fully distinct" reading. Gravel and dirt_road carry the D-05 Dukes-of-Hazzard anchor: the lowest slip threshold and the biggest, heaviest, longest-lived plumes.
- Each of the six particle systems has a FIXED 96-particle pool (Float32Array position/colour/velocityY/age buffers allocated once at construction), emitting only when a grounded wheel on that surface exceeds a per-surface slip threshold, at a rate that scales with how far slip exceeds it (frame-rate-independent via a carried fractional accumulator). Idle systems toggle `points.visible = false` to skip their draw call.
- A soft round puff sprite is generated once at runtime from an offscreen canvas radial gradient (no shipped PNG, no network fetch), shared by all six materials.
- A 48-slot skid-decal ring buffer projects `three/addons/geometries/DecalGeometry.js` onto the matching zone mesh, gated by grounded+slip>threshold and a `DECAL_MIN_SPACING_M` (1.2 m) per-wheel travel gate, fading opacity to zero over `decalLifetimeSec` before toggling invisible.
- `src/render/vehicle-view.ts`/`src/render/surface-view.ts` gained `wheelMeshes`/`zoneMeshes` accessors so `surface-fx.ts` can be fed world positions and decal projection targets without reaching across tiers.
- `src/main.ts` constructs `fx` unconditionally (player-facing, like the speedometer/camera), builds the per-wheel FX input array once outside the render callback, and calls `fx.update` after `activeRig.update`/`occlusion.update` and before `renderer.render`.
- `docs/frame-budget.md` documents what Phase 3 actually added, the CSS-filter blind spot (03-RESEARCH.md Pitfall 4), and that a tuned shadow-quality pass is still outstanding.

## Task Commits

1. **Task 1: Per-surface particle systems with fixed pools** - `e0e2e91` (feat)
2. **Task 2: Skid decals as a fixed-size recycled pool** - `eba8165` (feat)
3. **Task 3: Wire the FX at the composition root and revise the frame budget** - `2fac15b` (feat)

**Plan metadata:** (this commit) `docs(03-10): complete surface FX and skid decal plan`

## Files Created/Modified

- `src/render/surface-fx.ts` - new: `SurfaceFx`/`createSurfaceFx`/`SURFACE_FX_PROFILES`, six particle pools + 48-slot decal ring buffer
- `src/render/vehicle-view.ts` - added `wheelMeshes` accessor (FL/FR/RL/RR order)
- `src/render/surface-view.ts` - added `zoneMeshes` accessor (SURFACE_ZONE_ORDER order)
- `src/main.ts` - constructs `fx`, builds the per-wheel FX input array once, calls `fx.update` in the render callback; forces a `matrixWorld` update before reading wheel world positions
- `docs/frame-budget.md` - documents Phase 3's FX/occlusion/camera additions, the CSS-filter blind spot, and the outstanding shadow-quality-pass revision

## Decisions Made

- **Slip-threshold measurement session** (recorded in `src/render/surface-fx.ts`'s own doc comments): a throwaway headless Vitest script drove `createVehicle`/`createWorld` directly (not the `Routine` harness, since raw `wheelSideImpulse`/`wheelForwardImpulse` reads were wanted) through three scenarios against `defaultTuning()` on flat tarmac:
  - Straight-line full throttle (zero steer): forward impulse alone peaks at 60.83 (== `engineForcePerRearWheel` (3650 N) × `DT`), side impulse stays at ~0 (1e-6 to 1e-8) — forward impulse tracks COMMANDED engine force, not slip.
  - Scripted handbrake slide (full lock + handbrake): side impulse climbs to a peak of 87.98, forward impulse simultaneously drops to 15.45 at that peak (friction-circle clamp trading forward for lateral grip) — combined magnitude peaks at ~89.3.
  - Sustained gentle cornering (0.15 steer fraction, throttle 0.5): side impulse reaches 68.29.
  `SLIP_THRESHOLD_HIGH = 65` (tarmac) sits above the measured ~61 full-throttle/full-brake ceiling so ordinary driving never trips it. `SLIP_THRESHOLD_LOW = 12` (gravel/dirt_road/sand/mud) sits well above the near-zero idle floor but low enough to catch ordinary throttle application early (D-05's "starts early"). `SLIP_THRESHOLD_MID = 30` (grass) sits between the two. The measurement script and its log output were deleted before the Task 1 commit — they are not part of the shipped suite.
- **Decal spawn semantics**: interpreted the plan's "crosses its surface's slipThreshold upward" as the qualifying condition (grounded + slip > threshold), with `DECAL_MIN_SPACING_M` as the actual repeat-spawn limiter, rather than a strict one-shot edge trigger. A literal edge trigger would cap a continuously-slipping stationary wheel at exactly one decal on its own, making the distance gate's own stated purpose ("stops a stationary spinning wheel from consuming the whole ring buffer in ONE SECOND") unreachable — that purpose only makes sense if the condition is checked repeatedly. This reading also produces the more useful visual result: a continuous dotted skid-mark trail while a car slides, rather than a single dot at slide onset.
- **Per-particle fade via vertexColors, not a custom shader**: `THREE.PointsMaterial` has no native per-vertex alpha, only one material-wide `opacity`, which cannot independently fade multiple simultaneously-live particles by age. Implemented fade as a per-vertex grey multiplier (1 at spawn → 0 at end of life) on top of the material's flat `color`, under normal blending — a particle visibly darkens rather than losing true alpha. This is a documented, visible trade-off, not a hidden shortcut; a real per-vertex-alpha shader is the concrete upgrade path if a playtest finds the darkening reads wrong. This could not be visually verified in this session (no browser/WebGL available — see Issues Encountered).
- **48 decal material clones disposed individually**, not just the six per-surface templates: the plan's own threat register (T-03-31) describes the mitigation as disposing "all 48 decal geometries, all six decal materials," but independent per-decal opacity fade (explicitly required by the plan's action text) is only possible if every simultaneously-active decal owns its own material instance — sharing six materials across potentially many concurrent same-surface decals would synchronize their fade incorrectly. Implemented as: six BASE templates (seed colour/settings only, never assigned to a mesh) plus 48 persistent per-slot clones (allocated once at construction, mutated in place at every spawn, never re-cloned). `dispose()` releases all 48 per-slot clones plus the six templates — a superset of the threat register's literal wording, judged the correct behaviour for the register's own stated goal (no leaked GPU material state).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] matrixWorld staleness would have spawned FX one frame behind the wheels**
- **Found during:** Task 3 (composition-root wiring)
- **Issue:** `view.updateWheels(vc)` and `applyAllInterpolated(...)` only write LOCAL transforms; nothing recomputes `matrixWorld` until `renderer.render()`'s own scene traversal, which had not run yet at the point `fx.update` needed each wheel's WORLD position via `getWorldPosition`. Reading world position before that traversal would silently use last frame's transform.
- **Fix:** Added `view.meshes[0].updateMatrixWorld(true)` (cascades to the four wheel children) immediately before the per-wheel `getWorldPosition` calls, with a comment explaining why.
- **Files modified:** `src/main.ts`
- **Verification:** `npm run typecheck`, `npx vitest run tests/layering.test.ts`, `npm run build` all pass; the fix is a correctness requirement inferrable from reading `interpolator.ts`'s own doc comments, not independently browser-verified (no browser available this session).
- **Committed in:** `2fac15b` (Task 3 commit)

**2. [Rule 1 - Bug] Biome import-order errors after adding new imports**
- **Found during:** Tasks 2 and 3 (lint step)
- **Issue:** Biome's `organizeImports` assist flagged import ordering in `src/render/surface-fx.ts` (the new `three/addons/geometries/DecalGeometry.js` import sorted after `"three"`) and `src/main.ts` (new `SurfaceType`/`createSurfaceFx` imports).
- **Fix:** Reordered imports to satisfy Biome's assist, and ran `npx biome check --write src/main.ts` for the mechanical reorder.
- **Files modified:** `src/render/surface-fx.ts`, `src/main.ts`
- **Verification:** `npx biome check` clean on both files.
- **Committed in:** `eba8165`, `2fac15b`

---

**Total deviations:** 2 auto-fixed (both Rule 1 bugs — one a real correctness fix, one a lint-mechanical fix). No scope creep.

## Issues Encountered

- **This plan's own action text asks for measured `renderer.info.render.calls` and triangle counts "from a `?debug` session ... do not estimate them."** This plan was executed in a headless worktree with no browser/WebGL/display available, so no real `?debug` session could be driven. `docs/frame-budget.md`'s new section is explicitly labelled as an ENGINEERING ESTIMATE from the scene's known object/material counts, not a measured reading, with a follow-up action recorded in the doc itself to replace it with real numbers the next time someone drives the game in a browser (plan 03-12's playtest already needs a `?debug` session for its own SC6 comparison and is the natural place to fill this in for real). This does not block plan 03-10's own automated verification (`tests/frame-budget.test.ts` checks textual mirroring of the `BUDGET`/`PHASE1_DEBUG_SCENE_TARGETS` constants, not the new prose's numeric claims), but is an honest, carried-forward gap rather than a fabricated "measured" claim.
- **The per-particle vertexColors fade and the overall visual distinctness of the six particle systems could not be visually verified** for the same reason (no browser). Structural/textual acceptance criteria all pass; the actual on-screen look is unverified until plan 03-12's playtest.
- **Two of this plan's own acceptance-criteria greps are ambiguous by construction, not satisfiable as literally counted:**
  - `grep -v '^\s*[*/]' src/render/surface-fx.ts | grep -c "new THREE.Points"` returns 2, not "exactly 1 or exactly 6" — because the literal string `"new THREE.Points"` is also a substring of `"new THREE.PointsMaterial"`, and the file legitimately constructs one of each (both inside the six-iteration construction loop, neither inside `update`). Manually confirmed: `new THREE.Points(` appears at exactly one call site (`createParticleSystem`), `new THREE.PointsMaterial(` at exactly one call site, and `update()` contains neither substring.
  - `grep -c "createSurfaceFx" src/main.ts` returns 2 (the import statement plus the one call site), not "1" — any normal `import { createSurfaceFx } from ...` plus a single call necessarily produces 2 matches of the bare identifier. Manually confirmed `createSurfaceFx(...)` is called exactly once, not per-frame.
  Both are documented here per this project's established precedent (plan 02-03/03-09) for acceptance-criteria wording that self-contradicts against literal file content; the underlying INTENT of both criteria (no per-frame `Points` construction; `createSurfaceFx` called once, not per-frame) is fully satisfied.
- `npm run check`'s lint step (`biome check .`) fails repo-wide on the same pre-existing CRLF-vs-LF formatting issue already logged in `.planning/STATE.md`'s Blockers/Concerns and re-confirmed in plan 03-09's own SUMMARY — 46 errors across ~44 files this plan did not touch (`vite.config.ts`, `vitest.config.ts`, most of `src/core/`, `src/physics/`, `src/input/`, `tests/`, and their tests). `npx biome check` scoped to only this plan's five touched files (`surface-fx.ts`, `vehicle-view.ts`, `surface-view.ts`, `main.ts`; `docs/frame-budget.md` is markdown and outside Biome's configured scope) reports zero errors. `npm run typecheck`, the full `npx vitest run` suite (516/516 passing), and `npm run build` all exit 0 independently.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- SURF-02's visual half is delivered for all six surfaces, with five independent distinctness axes per system, satisfying D-09's "not grouped" reading.
- D-05's Dukes-of-Hazzard dust anchor is implemented as the lowest slip thresholds and the biggest/heaviest/longest-lived plumes on gravel and dirt_road specifically.
- Every pool (96 particles × 6 surfaces, 48 decal slots) is fixed-size; the one unavoidable per-spawn allocation (`DecalGeometry`'s fresh `BufferGeometry`) is documented with a disposal path and a flat-quad fallback.
- `npm run build`, `npm run typecheck`, and the full Vitest suite (516/516) all pass. `git diff --stat package.json` is empty — no new dependency (`DecalGeometry` is the bundled `three` addon).
- **Open item for plan 03-12's playtest:** an actual `?debug` browser session should (a) confirm the six particle systems and skid decals genuinely read as visually distinct and match the D-05 anchor's "heavy, obviously dusty" feel, (b) replace `docs/frame-budget.md`'s estimated `renderer.info` figures with real measured ones, and (c) sanity-check the vertexColors-darkening fade approximation doesn't read as a bug.
- `src/render/surface-fx.ts`'s `SURFACE_FX_PROFILES` table is the single place plan 03-12 edits to retune colours/sizes/rates/thresholds by feel; Vite's HMR makes changes visible instantly.

---
*Phase: 03-surfaces-helicopter-camera*
*Completed: 2026-09-13*

## Self-Check: PASSED

All created/modified files verified present on disk (`src/render/surface-fx.ts`,
`src/render/vehicle-view.ts`, `src/render/surface-view.ts`, `src/main.ts`,
`docs/frame-budget.md`, this SUMMARY.md). All three task commits (`e0e2e91`, `eba8165`,
`2fac15b`) confirmed present in `git log`.
