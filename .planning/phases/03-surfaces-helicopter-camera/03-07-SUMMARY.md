---
phase: 03-surfaces-helicopter-camera
plan: 07
subsystem: ui
tags: [three.js, lil-gui, camera, composition-root, localStorage]

# Dependency graph
requires:
  - phase: 03-surfaces-helicopter-camera (plan 03-04)
    provides: createHelicopterCameraRig/createChaseCameraRig, CameraTarget/CameraRig contracts, camera-tuning.ts
  - phase: 03-surfaces-helicopter-camera (plan 03-05)
    provides: createSurfaceScene, createSurfaceWorld, the six-surface test scene
  - phase: 03-surfaces-helicopter-camera (plan 03-06)
    provides: runSurfaceSkidpadSweep and the surface telemetry harness
provides:
  - src/main.ts rewired onto createSurfaceScene + the permanent helicopter camera rig, with the D-12 chase fallback and CAM-03 skin both one debug keypress away
  - createObjectCameraTarget, a physics-free THREE.Object3D-to-CameraTarget adapter for D-13 reuse
  - Surfaces and Camera folders in the lil-gui tuning panel, live-bound to SurfaceProfiles/CameraTuning
  - A second "Run surface sweep" button in the telemetry panel
  - Three new mechanical layering rules (T-03-20/21/22) guarding the camera tier
affects: [03-08, 03-09, 03-10, 03-11, 03-12]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Camera target adapter pattern: createObjectCameraTarget binds any THREE.Object3D + velocity callback to CameraTarget, keeping src/render/camera/ physics-free"
    - "Three-way tuning-panel handlers object (onApplyVehicle/onApplySurfaces/onApplyCamera) replacing a single onApply callback, so a future fourth tuning domain is an additive change"

key-files:
  created:
    - src/render/camera/object-camera-target.ts
  modified:
    - src/main.ts
    - src/debug/tuning-panel.ts
    - src/debug/telemetry-hud.ts
    - tests/layering.test.ts

key-decisions:
  - "Camera target follows the chassis mesh's INTERPOLATED transform (view.meshes[0]), never the rigid body's raw fixed-tick position, to avoid reintroducing sub-tick camera jitter"
  - "activeRig.update(dtMs) runs after applyAllInterpolated in the render callback, never before, for the same interpolation reason"
  - "Both camera rigs (helicopter + chase fallback) are constructed unconditionally and are player-facing; only the KeyC swap and KeyV skin-preview toggle are DEBUG_ENABLED-gated"

patterns-established:
  - "Composition-root persisted-tuning pattern: three independent localStorage blobs (vehicle/surface/camera), each through its own parseSavedX-or-default function, so a corrupt blob in one domain never corrupts another"

requirements-completed: [SURF-01, CAM-01, CAM-02, CAM-03]

# Metrics
duration: 25min
completed: 2026-09-12
---

# Phase 03 Plan 07: Composition Root Wiring Summary

**Rewired `src/main.ts` onto the six-surface scene and the permanent helicopter camera rig (with the D-12 chase fallback and CAM-03 police/sports skin one debug keypress away), extended the lil-gui/telemetry dev panels with live Surfaces/Camera controls and a six-surface skidpad sweep button, and added three mechanical layering rules guarding the new camera tier.**

## Performance

- **Duration:** ~25 min
- **Completed:** 2026-09-12
- **Tasks:** 3
- **Files modified:** 5 (1 created, 4 modified)

## Accomplishments
- The default page load is now the six-surface test scene, viewed through the permanent helicopter camera, with the police skin applied — the first moment Phase 3's two halves (surfaces + camera) are a playable game rather than two headless test suites
- Every per-surface grip multiplier and every camera tunable (~33 controls total) is a live lil-gui slider under `?debug` + `G`, persisted to its own `localStorage` key
- The six-surface skidpad sweep is one click away in the telemetry panel under `?debug` + `T`, using the exact same `runSurfaceSkidpadSweep` harness the Vitest suite runs
- `tests/layering.test.ts` now mechanically guards the camera tier against physics imports, tick-based smoothing, and stray `three` imports in the two Node-tested camera-math files

## Task Commits

Each task was committed atomically:

1. **Task 1: Rewire the composition root onto the surface scene and the helicopter camera** - `ea02c0f` (feat)
2. **Task 2: Surfaces and Camera folders in the tuning panel, surface sweep in the telemetry panel** - `09bcc28` (feat)
3. **Task 3: Mechanical layering rules for the new camera tier** - `67148d3` (test)

_Task 3 is a regression-guard test addition for already-compliant source landed in prior plans (03-04/03-05/03-06) — see "Deviations from Plan" below for why it is a single `test(...)` commit rather than a RED-then-GREEN pair._

## Files Created/Modified
- `src/render/camera/object-camera-target.ts` - New: adapts any `THREE.Object3D` + velocity callback to the `CameraTarget` contract, importing nothing from `src/physics/`
- `src/main.ts` - Composition root now boots `createSurfaceScene`, loads three persisted tuning blobs, follows the chassis with the helicopter/chase camera rigs and the camera skin, deletes the Phase 2 placeholder chase camera entirely
- `src/debug/tuning-panel.ts` - `createTuningPanel` widened to a three-object + `TuningPanelHandlers` signature; adds `Surfaces` (12 controls) and `Camera` (~21 controls across 5 sub-folders) after the existing six folders; persistence and reset now cover all three `localStorage` keys
- `src/debug/telemetry-hud.ts` - `createTelemetryHud` gains a `getSurfaceProfiles` callback and a second "Run surface sweep" button
- `tests/layering.test.ts` - Raises the source-file floor to 28; adds T-03-20/21/22 camera-tier rules; adds a forward-reference comment for plan 03-11's `src/audio/**` tier

## Decisions Made
- Camera target reads `view.meshes[0]`'s INTERPOLATED transform, never `scene.vehicle.body.translation()`'s raw fixed-tick position — avoids reintroducing sub-60Hz camera jitter at any refresh rate other than exactly 60 Hz (documented inline in `src/main.ts`)
- `activeRig.update(dtMs)` is called strictly after `applyAllInterpolated` in the render callback, for the same interpolation reason
- Both camera rigs are built unconditionally (player-facing, like the speedometer); only the `KeyC` rig-swap and `KeyV` skin-preview toggle are gated on `DEBUG_ENABLED`

## Deviations from Plan

### Auto-fixed Issues

None — no bugs, missing functionality, or blocking issues were found. All three tasks matched their `<action>` blocks directly.

### Other Deviations

**1. Two acceptance-criteria greps cannot be satisfied literally without an inconsistent import style**
- **Found during:** Task 1 (`grep -c "createSurfaceScene" src/main.ts` expects `1`) and Task 2 (`grep -c "runSurfaceSkidpadSweep" src/debug/telemetry-hud.ts` expects `1`)
- **Issue:** Both identifiers necessarily appear on two lines in normal, idiomatic TypeScript — the named `import { X } from "..."` line and the `X(...)` call-site line — so `grep -c` (which counts matching *lines*, not occurrences) returns 2, not 1. The only way to force a count of 1 is a namespace import (`import * as Y from "..."` then `Y.createSurfaceScene(...)`), which is inconsistent with every other import in this codebase (including the very `createVehicleScene` import this plan replaces, which was also always 2 occurrences) and would read as an unexplained style outlier.
- **Resolution:** Kept the codebase's established named-import convention (2 occurrences each) rather than introducing a one-off namespace import purely to satisfy a literal grep count. Removed the *comment-only* mentions of `createVehicleScene`/`runSurfaceSkidpadSweep` that were pushing other counts (`createVehicleScene`, `onFinishChange`) above their required thresholds, since those were genuinely avoidable without a style change — only the unavoidable import+call-site pair remains for these two identifiers.
- **Files affected:** `src/main.ts`, `src/debug/telemetry-hud.ts`
- **Verification:** `npm run check` and `npm run build` both pass; every other acceptance-criteria grep (14 of 16 across the three tasks) matches exactly
- **Committed in:** `ea02c0f` (Task 1), `09bcc28` (Task 2)

**2. Task 3 committed as a single `test(...)` commit rather than a RED-then-GREEN pair**
- **Found during:** Task 3 (`tdd="true"`)
- **Issue:** The task's `<behavior>`/`<action>` blocks describe adding mechanical regression-guard rules to `tests/layering.test.ts` for source files that ALREADY comply (landed correctly in plans 03-04/03-05/03-06). There is no separate `<implementation>` step and no production code to change — writing the new rules is expected to pass immediately (58 tests green on first run, no RED phase possible by design).
- **Resolution:** Verified this expectation empirically via a temporary `git stash push -u -m` / `stash apply <sha>` / `stash drop` round-trip (never a bare `stash pop`, per this session's git-stash safety rule) to measure the pre-task baseline: 43 tests. The Task 3 version runs 58 — strictly more, and every new assertion was green from the moment it was written, confirming the guarded code was already compliant rather than the test being vacuously true. Committed as a single `test(03-07): add mechanical layering rules for the camera tier` commit.
- **Files affected:** `tests/layering.test.ts`
- **Verification:** `npx vitest run tests/layering.test.ts` (58 passed, up from a measured baseline of 43) and `npm run check`
- **Committed in:** `67148d3`

---

**Total deviations:** 2 (both process/verification notes, zero functional deviations)
**Impact on plan:** No scope creep, no bugs found. Both deviations are about how two specific acceptance-criteria greps and one TDD gate were interpreted given the plan's own internal constraints (idiomatic import style; a regression-guard test for already-compliant code) — every functional acceptance criterion and every automated verification command in the plan passes.

## TDD Gate Compliance

Task 3 (`tdd="true"`) produced a single `test(03-07): ...` commit (`67148d3`) with no following `feat(...)`/`refactor(...)` commit, because this task adds regression-guard mechanical rules for already-shipped, already-compliant camera-tier code from prior plans — there is no corresponding implementation step in this task's own `<action>` block. See "Deviations from Plan" item 2 above for the empirical verification (pre-task baseline: 43 tests; post-task: 58 tests, strictly more) that stands in for the conventional RED-then-GREEN gate sequence.

## Issues Encountered

- Repo-wide Windows `core.autocrlf=true` + git stat-cache CRLF drift (pre-existing, documented in `.planning/STATE.md` and `.planning/phases/02-vehicle-feel-core/deferred-items.md`) surfaced ~40 stale-CRLF Biome formatting errors across files this plan never touched, on the very first `npm run check` run. Resolved per this session's own CRLF-recovery instructions: `rm -f <file> && git checkout -- <file>` for every flagged file confirmed clean in `git status`, in three successive passes (the fix surfaces new stale files each pass as Vite's transform cache warms). No content was hand-edited; every file's committed LF blob was already correct.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- The whole Phase 3 slice (surfaces + helicopter camera) is now on screen and tunable in one live session — everything plan 03-08's go/no-go playtest needs to retune and re-measure mid-session exists: per-surface grip sliders, all ~21 camera tunables, the chase-cam fallback (`KeyC`), the skin preview (`KeyV`), and both the vehicle and surface telemetry sweeps (`KeyT`)
- `src/render/camera/**` is now mechanically guarded against physics imports and tick-based smoothing, so plans 03-08 (occlusion mitigation) and 03-09/03-10 can extend the tier without re-litigating those two invariants by hand
- No blockers. `docs/adr` / STATE.md's Phase 2 rearSideFriction straight-line-instability finding still awaits re-verification against real surfaces other than tarmac — unchanged from before this plan, tracked as an existing Phase 3 open item, not newly introduced here

---
*Phase: 03-surfaces-helicopter-camera*
*Completed: 2026-09-12*

## Self-Check: PASSED

All 6 files (5 created/modified + this SUMMARY) confirmed present on disk; all 3 task commits (`ea02c0f`, `09bcc28`, `67148d3`) confirmed present in `git log --oneline --all`.
