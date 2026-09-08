---
phase: 01-engine-foundation
plan: 05
subsystem: render
tags: [three, interpolation, slerp, webgl, shadows, index-contract, sc2, veh-03]

# Dependency graph
requires:
  - 01-01 (three@0.185.1 + @types/three@0.185.4 exact-pinned, vitest.config.ts, biome/tsconfig, index.html canvas#game)
  - 01-04 (TransformCache prev/cur buffers + XFORM_STRIDE, DebugScene.bodies dense order + spinnerIndex)
provides:
  - "src/render/interpolator.ts — applyInterpolated / applyAllInterpolated, alpha lerp+slerp from raw stride-7 buffers onto Object3D, zero allocation per call"
  - "src/render/renderer.ts — createRenderer(canvas) -> RenderContext { renderer, camera, dispose }, sRGB, PCFSoftShadowMap, DPR capped at 2, one resize listener"
  - "src/render/debug-scene.ts — createDebugRenderScene(bodyCount, spinnerIndex) -> DebugRenderScene { scene, meshes }, meshes index-aligned with DebugScene.bodies, ground excluded"
  - "tests/interpolation.test.ts — 15 tests: endpoint equivalence, short-arc proof, index mapping, alpha clamping, zero-step monotonicity, layering guard"
  - "Measured fact: a naive component lerp lands the 175-degree case on EXACTLY 92.5 degrees, so the short-arc test is discriminating"
  - "Measured fact: the debug scene builds in Node with no GL context — 11 scene children, 7 meshes, 86 triangles"
affects: [01-06-profiler-hud, 01-07-composition-root, phase-02-vehicle, phase-03-camera]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Render reads sim, never writes it — asserted by a source-scan test over src/render/, not by convention alone"
    - "Mesh array index i maps onto buffer offset i * XFORM_STRIDE; the ground is excluded from meshes and its transform baked into its geometry so the file contains no mesh pose at all"
    - "Module-scope scratch Vector3/Quaternion reused by every call; the test asserts they are declared before the first export function"
    - "Quaternion interpolation is always THREE.Quaternion.prototype.slerp; the guard is a 175-degree short-arc assertion, proven discriminating by deliberate breakage"
    - "Scene builders take counts as parameters rather than importing the physics scene, keeping the ordering contract explicit at the composition root"

key-files:
  created:
    - src/render/interpolator.ts
    - src/render/renderer.ts
    - src/render/debug-scene.ts
    - tests/interpolation.test.ts
  modified: []

key-decisions:
  - "Interpolation lives in a free function in src/render/, not as a TransformCache method — src/physics/ stays free of three (the placement question 01-PATTERNS.md left open)"
  - "The short-arc test drives cur from the NEGATED quaternion, because a quaternion and its negation are the same rotation but a naive lerp between identity and the negation takes the 185-degree route — measured at exactly 92.5 degrees against slerp's 87.5"
  - "Batched-vs-single equivalence is asserted component-wise, never via angleTo — angleTo is 2*acos(dot) and acos is ill-conditioned near 1, so one-ULP-apart quaternions report ~3e-8 rad"
  - "The ground plane's rotation and 0.5 m lift are baked into the geometry (rotateX/translate), so src/render/debug-scene.ts contains no mesh transform whatsoever"
  - "renderer.info.autoReset is left at its default true, with the multi-pass caveat recorded in-file for the 01-06 HUD and the Phase 3 CAM-04 pre-pass"

patterns-established:
  - "Acceptance greps are design constraints on prose: the renderer's comment was reworded off the literal three/webgpu string, continuing the 01-04 convention"
  - "Deliberate breakage is the proof a guard discriminates — swap slerp for a naive nlerp, confirm the exact failing number, restore"

requirements-completed: [VEH-03]

# Metrics
duration: 7min
completed: 2026-09-08
---

# Phase 01 Plan 05: Render Layer and Interpolation Summary

**A mesh drawn at alpha 0 sits exactly on the previous tick and at alpha 1 exactly on the current one, rotation takes the 87.5-degree short arc rather than the 92.5-degree long one, and the position still advances on frames that ran zero physics steps — which is the whole mechanism that removes 144 Hz judder.**

## Performance

- **Duration:** 7 min
- **Started:** 2026-09-08 14:32 (local)
- **Completed:** 2026-09-08 14:39 (local)
- **Tasks:** 3 (Task 1 TDD: RED commit then GREEN commit)
- **Files created:** 4

## Accomplishments

- **SC2's maths is proven in Node with no browser.** `tests/interpolation.test.ts` is 15 tests over `THREE.Object3D` / `Vector3` / `Quaternion`, which are pure maths classes. No `WebGLRenderer` is constructed anywhere in the suite, so the interpolation proof does not depend on a GL context and will keep running in CI forever.
- **The short-arc guard is proven discriminating, not merely green.** Replacing `.slerp(` with a normalised component lerp turned the 175-degree case red at **exactly 92.5 degrees** — the predicted long-way-round result — and also tripped the `.slerp(` source assertion. Both restored, suite back to 15/15. This is the phase's established probe-then-assert discipline applied to a rotation bug whose only symptom in production would be a body visibly spinning the wrong way once per revolution.
- **The zero-step-frame property is asserted directly.** With `prev` and `cur` held constant and alpha swept across 101 samples, the drawn x is strictly increasing at every step and lands on `cur` exactly. That is the literal thing SC2 observes at 144 Hz, expressed as an assertion rather than as a comment.
- **The index contract is enforced in three independent places.** `applyAllInterpolated` is tested against three targets 100 metres apart (any swap moves a target two orders of magnitude) and against per-index `applyInterpolated` calls; `createDebugRenderScene` takes `bodyCount` as a parameter, range-validates it, and throws on a mesh/body count mismatch; and the ground is excluded from `meshes` with an in-file comment naming that off-by-one as the likely failure (T-01-16).
- **The layering boundary is a test, not a convention.** `tests/interpolation.test.ts` strips comment lines from the interpolator source and asserts it matches none of `world.step`, `applyImpulse`, `setTranslation`, `setRotation`, contains `XFORM_STRIDE` and the physics import path, and contains no bare `* 7` (T-01-15).
- **Debug scene verified constructible in Node:** 11 scene children (ground + 7 body meshes + hemisphere + sun + sun.target), 7 meshes, all shadow-casting, boxes sharing one geometry instance, spinner on its own, **86 triangles** against the Phase 1 target of under 10,000.
- Full gate green: **149 tests passed** across 10 files (134 inherited + 15 new), `tsc --noEmit` exit 0, `biome check .` exit 0 over 27 files, `grep -rn "renderer.render(" src/render/` no output.

## Task Commits

1. **Task 1: Interpolator — alpha lerp and slerp** — RED `185d87b` (test), GREEN `d0450e7` (feat)
2. **Task 2: WebGL renderer and camera setup** — `77a5e15` (feat)
3. **Task 3: Three.js debug scene** — `18a5941` (feat)

No REFACTOR commits were needed.

## Files Created/Modified

- `src/render/interpolator.ts` (98 lines) — `applyInterpolated(target, prev, cur, index, alpha)` and `applyAllInterpolated(targets, cache, alpha)`. Module-scope `TMP_POSITION` / `TMP_ROTATION` scratch objects. Alpha clamped with `alpha > 0 ? (alpha < 1 ? alpha : 1) : 0`, which also sends `NaN` to 0 rather than propagating it into the scene graph. Offset is `index * XFORM_STRIDE` imported from `../physics/transform-cache` — no literal stride anywhere. `applyAllInterpolated` takes a structural `{ prev, cur }` so tests drive it with plain buffers and `src/render/` needs no class import from `src/physics/`.
- `src/render/renderer.ts` (110 lines) — `createRenderer(canvas)` returning `RenderContext`. `WebGLRenderer({ canvas, antialias: true })`, `setPixelRatio(Math.min(devicePixelRatio, 2))`, `SRGBColorSpace`, `shadowMap.enabled = true` with `PCFSoftShadowMap`. `PerspectiveCamera(55, 1, 0.1, 500)` at `(8, 9, 14)` looking at the origin, explicitly marked provisional with Phase 3 named as the owner. One `resize` listener, invoked once at construction and removed in `dispose()`; `setSize(w, h, false)` so three never writes inline styles over the `100vw`/`100vh` CSS. Draws nothing — the single per-frame draw call site belongs to plan 01-07.
- `src/render/debug-scene.ts` (151 lines) — `createDebugRenderScene(bodyCount, spinnerIndex)`. Ground is a `PlaneGeometry(100, 100)` with `rotateX(-PI/2)` and `translate(0, 0.5, 0)` baked into the geometry so its top face matches the physics cuboid's, and so the file contains no mesh transform at all. One shared `BoxGeometry(1,1,1)` + material for the six boxes, one `BoxGeometry(3, 0.3, 0.3)` + a distinct teal emissive material for the spinner. `HemisphereLight` fill plus a shadow-casting `DirectionalLight` with a 2048 map and its orthographic shadow camera framed to ±12 m. Both arguments range-validated; a mesh/body count mismatch throws.
- `tests/interpolation.test.ts` (269 lines, 15 tests) — endpoint equivalence at 0 and 1 to 12 decimal places, pure-translation midpoint, the 175-degree short-arc proof, unit-quaternion preservation across a five-point sweep, alpha clamping above 1 and below 0, the 101-sample monotonic sweep, in-place mutation over 10,000 calls, the module-scope scratch-declaration source check, index mapping with 100 m separation, batched-vs-single agreement, and three layering assertions.

## Decisions Made

- **The negated-quaternion trick is what makes the short-arc test real.** Interpolating between identity and a plain 175-degree rotation is 175 degrees the short way under *both* slerp and a naive lerp, so that test would have been decorative. Driving `cur` from the negation — the same orientation, the opposite hemisphere — is what forces the two implementations apart. Measured: slerp 87.5, naive 92.5 exactly.
- **`angleTo` is unusable as an equality primitive for quaternions.** It is `2 * acos(dot)`, and near `dot = 1` acos is catastrophically ill-conditioned: quaternions one ULP apart report ~3e-8 radians. The batched-vs-single test asserts components instead. `angleTo` is still used where the expected angle is far from zero (5, 35, 65, 87.5 degrees), where its conditioning is fine.
- **Ground transform baked into geometry, not set on the mesh.** The acceptance criterion forbids mesh `.position`/`.quaternion` assignment; baking satisfies it by construction rather than by exception, and removes any chance a future reader copies the ground's pose line onto a body mesh.
- **`renderer.info.autoReset` stays `true`.** Plan 01-06's HUD must read after the draw. The multi-pass caveat (post-processing, minimap target, CAM-04 occlusion pre-pass) is recorded in-file with the consequence spelled out, because the failure mode is a silently under-reporting HUD rather than an error.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] The batched-vs-single test used `angleTo` and failed on float conditioning, not on behaviour**

- **Found during:** Task 1, GREEN phase — 14 of 15 tests passed on the first run.
- **Issue:** `expect(batched[i].quaternion.angleTo(single.quaternion)).toBeCloseTo(0, 12)` reported `2.98e-8` where the tolerance is `5e-13`. The two quaternions are the product of identical arithmetic; the discrepancy is entirely in the measurement. `angleTo` is `2 * acos(clamp(|dot|))`, and a dot product of `1 - 1.11e-16` yields `2 * acos(...) = 2.98e-8`. Loosening the tolerance to accommodate it would have made the assertion blind to a real one-part-in-10^8 interpolation error.
- **Fix:** Assert the four quaternion components individually at 12 decimal places — strictly stronger than the angle form, and immune to the conditioning problem. The reasoning is written into the test as a comment so nobody reverts it.
- **Files modified:** `tests/interpolation.test.ts`
- **Committed in:** `d0450e7`

**2. [Rule 3 - Blocking] Reworded a renderer comment off the literal `three/webgpu` string**

- **Found during:** Task 2, at the acceptance-criteria check.
- **Issue:** The criterion is "contains no import from `three/webgpu`". The header comment explained *why* WebGPU is rejected and named the module path to do it, so a blunt `grep -c "three/webgpu"` returned 1. Same class of problem 01-04 hit with `RAPIER.init(` and `1/60`, and the same resolution applies: a comment that trips a repo guard is a comment a future agent deletes rather than understands.
- **Fix:** Reworded to "three's webgpu entry point". The full rationale — CLAUDE.md's ruling plus r186 removing `PCFSoftShadowMap` from the WebGPU renderer — is preserved verbatim; only the path string changed.
- **Files modified:** `src/render/renderer.ts`
- **Committed in:** `77a5e15`

### Rule 2 Additions

**Range validation on `createDebugRenderScene`'s arguments.** The plan specifies the parameters but not their validation. T-01-16's mitigation depends on `bodyCount` being trustworthy, and a `spinnerIndex` outside `[0, bodyCount)` silently produces a scene with no visually distinct spinner — which would make the SC2 judder check unperformable while looking fine. Both arguments now throw `RangeError` on a non-integer or out-of-range value, and a mesh/body count mismatch throws before the scene is returned.

---

**Total deviations:** 2 auto-fixed (1 bug, 1 blocking), 1 Rule 2 addition. No out-of-scope items discovered.
**Impact on plan:** Every behavior-block item, acceptance criterion, verification step and success criterion is met as written. No new dependencies (T-01-SC holds). The one plan sentence that needed interpretation — "component-wise within 1e-12" for the batched comparison — is now satisfied more literally than the `angleTo` form would have.

## Issues Encountered

- **The pre-existing CRLF/autocrlf mismatch did not bite this session.** `src/core/sim-clock.ts` and `src/physics/debug-scene.ts` still show as modified in `git status` with zero content difference, and `biome check .` passed clean over all 27 files. Left untouched per the carry-forward instruction; it remains logged in `deferred-items.md` and in STATE.md blockers for 01-07 or phase verification. Every commit in this plan staged files individually, so none of it was picked up incidentally.
- **`gsd-sdk query state.*` handlers take named flags, and two of them misplace their output.** `state.add-decision` and `state.record-session` both return `{"error": "... required"}` for positional args; `--summary` / `--phase` and `--stopped-at` / `--resume-file` work. More usefully: `state.record-metric` appends its row *after* the `*Updated after each plan completion*` line rather than into the Per-plan detail table, so P04's row had been orphaned there since last session and P05's joined it. Both were moved into the table by hand, the velocity rollup (5 plans, 49 min, 0.8 h) recomputed, and a note left in STATE.md so 01-06 does the same rather than letting the drift compound.
- **A visual check is genuinely deferred, not skipped.** Nothing in this plan can be seen yet — `src/main.ts` is still the 01-01 bootstrap and there is no draw call anywhere in `src/render/` by design. Shadow framing, resize behaviour, spinner visibility and the actual judder observation all land at plan 01-07's checkpoint. The numbers that *can* be checked headlessly (mesh count, scene children, shared geometry, triangle count) were.

## Known Stubs

| Stub | File | Reason |
|------|------|--------|
| Camera pose is a fixed high three-quarter angle, not a helicopter cam | `src/render/renderer.ts` | Intentional and documented in-file. Phase 3 owns the helicopter camera and its explicit "does 100 mph read as fast?" go/no-go gate, with a low chase-cam fallback kept alive. A camera controller here would be Phase 3 work done blind, before the gate that decides whether the approach survives at all. |
| The debug scene draws boxes, not a car | `src/render/debug-scene.ts` | Intentional and specified by D-01, mirroring the same decision in `src/physics/debug-scene.ts`. Phase 1 proves the loop is correct; a vehicle-shaped placeholder would conflate that with "the car feels right". |

Neither stub blocks this plan's goal. Nothing renders yet at all, so neither is user-visible.

## Threat Flags

None. This plan adds no network surface, no file or user input parsing, no `innerHTML` write and no new packages. Every mitigation in the plan's register is now in place:

| Threat | Status |
|--------|--------|
| T-01-15 (render mutating sim state) | Asserted by a source-scan test in `tests/interpolation.test.ts`; nothing in `src/render/` imports Rapier at all. The broader layering test lands in 01-07. |
| T-01-16 (mesh/body index misalignment) | `bodyCount` is an explicit parameter, range-validated, with a count-mismatch throw; ground excluded from `meshes` with a comment naming the off-by-one; `applyAllInterpolated`'s swap case covered by 100 m-separated targets. |
| T-01-17 (uncapped device pixel ratio) | `setPixelRatio(Math.min(window.devicePixelRatio, 2))`. |
| T-01-18 (rendered content disclosure) | Accepted as planned — offline single-player, no secrets reach the GPU. |
| T-01-SC (npm installs) | No packages added. |

## TDD Gate Compliance

| Task | RED (`test`) | GREEN (`feat`) | RED confirmed failing |
|------|--------------|----------------|------------------------|
| 1 Interpolator | `185d87b` | `d0450e7` | Yes — `Cannot find module '../src/render/interpolator'` |
| 2 Renderer | n/a | `77a5e15` | n/a — not marked `tdd="true"`; requires a GL context, so it is unit-testable only through 01-07's browser checkpoint |
| 3 Debug scene | n/a | `18a5941` | n/a — not marked `tdd="true"` |

Task 1 was the plan's only `tdd="true"` task and its gates are in order. No test passed unexpectedly during the RED phase.

For Tasks 2 and 3 the equivalent rigour was applied by other means: every acceptance-criteria grep was run and recorded, and Task 3's scene was smoke-run under Vitest in Node (mesh count, scene-child count, shared geometry identity, triangle budget, both `RangeError` paths) using a throwaway spec that was deleted rather than committed, since the plan's artifact list does not include a scene test and 01-07 owns the layering suite.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- **Plan 01-06 (profiler HUD)** reads `renderContext.renderer.info.render.calls` and `.triangles` **after** the draw returns, never before. `autoReset` is `true`. The honest Phase 1 readings are roughly 8 draw calls plus the shadow pass, 86 triangles, and `1 / 8` active bodies after ten seconds — all far under the `docs/frame-budget.md` targets.
- **Plan 01-07 (composition root)** wires: `createRenderer(canvas)` on `#game`, then `createDebugRenderScene(scene.bodies.length, scene.spinnerIndex)` — pass those two values from the *physics* scene, never hardcode 7 and 6 — then once per animation frame, after the tick loop, `applyAllInterpolated(render.meshes, transforms, clock.alpha)` followed by exactly one `renderer.render(render.scene, render.camera)`. The draw must sit outside the fixed-tick loop.
- **Carry-forward:** never compare quaternions with `angleTo` when the expected angle is near zero. Compare components. The same applies to any future ghost-car or replay comparison.
- **Carry-forward:** the mesh array order is a contract with `DebugScene.bodies` and `TransformCache`. Anything that adds, removes or reorders bodies must change all three together, and the spinner index must be passed through rather than assumed.
- **Carry-forward for Phase 3:** the camera in `src/render/renderer.ts` is a placeholder with a fixed pose. Phase 3 replaces it; do not build the helicopter cam by mutating this one in place without revisiting the fov, near and far values chosen here for a 100 m debug plane.

## Self-Check: PASSED

All 4 created files verified present on disk (`src/render/interpolator.ts`, `src/render/renderer.ts`, `src/render/debug-scene.ts`, `tests/interpolation.test.ts`). All 4 commit hashes verified present in git history (`185d87b`, `d0450e7`, `77a5e15`, `18a5941`). `git diff --diff-filter=D --name-only HEAD~4 HEAD` is empty — no tracked file was deleted by any commit in this plan. Working tree carries only the pre-existing untracked `screenshots/` directory and the two known CRLF-phantom modifications.

---
*Phase: 01-engine-foundation*
*Completed: 2026-09-08*
