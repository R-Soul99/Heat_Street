---
phase: 02-vehicle-feel-core
plan: 08
subsystem: composition-root
tags: [three, rapier, vitest, typescript, composition-root, checkpoint]

# Dependency graph
requires:
  - phase: 02-vehicle-feel-core
    provides: "LiveInputSource (02-02), createSpeedometer (02-03), createVehicleScene/createVehicleView (02-06), defaultTuning/parseSavedTuning/TUNING_STORAGE_KEY (02-01)"
provides:
  - "src/loop.ts: LoopDeps.render(alpha, dtMs) — dtMs now reaches the render callback"
  - "src/main.ts: the phase's first end-to-end playable vertical slice — vehicle scene, live input, vehicle view and speedometer wired into the fixed-tick loop, with a temporary fixed chase camera"
affects: [02-09-tuning-panel, 02-10-feel-session]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "LoopDeps.render gained a second dtMs parameter rather than routing player-facing HUD updates through the DEBUG_ENABLED-gated hud callback, keeping the speedometer always-on"
    - "src/main.ts is the one place Phase 2 supersedes the Phase 1 debug scene — both debug-scene.ts files stay in place, untouched, as regression fixtures"
    - "Vehicle geometry (wheel radius/track/wheelbase, chassis half-extents) is passed explicitly from VehicleTuning at the src/main.ts call site into createVehicleView, rather than that render module importing VehicleTuning itself"
    - "Temporary fixed-offset chase camera in src/main.ts, recomputed every frame from the chassis's live translation — explicitly a placeholder pending Phase 3's permanent helicopter camera"

key-files:
  created: []
  modified:
    - src/loop.ts
    - tests/loop.test.ts
    - src/main.ts

key-decisions:
  - "LoopDeps.render(alpha: number, dtMs: number) — the rejected alternative (routing dtMs through the existing DEBUG_ENABLED-gated hud callback) is recorded as a comment on the render field itself; the speedometer is player-facing and must not become a debug-only feature."
  - "Composition-root camera is a simple fixed-offset chase cam (0, 5, 9 behind/above the chassis, recomputed from live translation every frame), not a proper follow/orbit camera — explicitly a temporary placeholder per 02-RESEARCH.md Open Question 1, so the SC5 feel session (plan 02-10) is not judged through an unusable view. Phase 3 owns the real helicopter camera."
  - "Ground speed for the speedometer is computed inline as Math.hypot(linvel.x, linvel.z) at the top of render(), never through the vehicle controller's own full-3D speed getter (whose vertical-velocity component is numerical noise for a -Z-forward car) — matching src/physics/vehicle.ts's own groundSpeedMs convention."

requirements-completed: [VEH-01, VEH-02, VEH-04, NAV-01]

# Metrics
duration: 35min
completed: 2026-09-11
---

# Phase 02 Plan 08: Composition Root Wiring and Browser Checkpoint Summary

**Wired the phase's first end-to-end user-visible slice — a live-input muscle car on a flat plane with a ramp, driven through the fixed-tick loop and read out on a real-time speedometer — and got a human sign-off on it in a browser.**

## Performance

- **Duration:** 35 min
- **Tasks:** 3 (2 automated + 1 human-verify checkpoint)
- **Files modified:** 3

## Accomplishments

- Closed the `dtMs` signature gap 02-PATTERNS.md flagged as ambiguous: `LoopDeps.render` now receives `(alpha, dtMs)`, with the rejected `hud`-callback routing recorded as a comment.
- Repointed `src/main.ts` at `createVehicleScene`/`createVehicleView`/`LiveInputSource`/`createSpeedometer`/`parseSavedTuning`, replacing the Phase 1 debug-scene composition entirely at this one call site while leaving both `debug-scene.ts` files as untouched regression fixtures.
- A human developer drove the car in a real browser and confirmed: correct steer direction, visible wheel spin/turn/suspension travel, braking nose-dip, handbrake slide-and-recover, a full ramp climb-launch-land cycle, speedometer needle/digit tracking with the 120 mph amber transition, and the `?debug` profiler HUD gate — all ten checklist steps passed on the first pass, no fixes needed.

## Task Commits

1. **Task 1: Close the dtMs signature gap** - `701c70c` (feat)
2. **Task 2: Repoint the composition root at the vehicle scene** - `c87e3b8` (feat)
3. **Task 3: Browser checkpoint** - human-verified, all 10 steps passed on the first pass; no code changes required.

## Files Created/Modified

- `src/loop.ts` - `LoopDeps.render(alpha, dtMs)`; the single call site now passes the already-computed `dtMs`.
- `tests/loop.test.ts` - new case asserting `render` receives a finite `dtMs` matching the fake scheduler's wall-clock delta.
- `src/main.ts` - full rewire: `parseSavedTuning`-restored `VehicleTuning` at boot, `createVehicleScene`, `createVehicleView`, `LiveInputSource`, always-on `createSpeedometer`, a temporary fixed chase camera, and the reordered `render()` body (speedo update -> wheel rig -> interpolate -> draw).

## Decisions Made

- **`render(alpha, dtMs)` over routing through `hud`.** `hud` only exists when `DEBUG_ENABLED`; the speedometer must always work. Recorded as a doc comment on `LoopDeps.render`.
- **Placeholder fixed chase camera, not a proper camera system.** This phase has no camera requirement beyond "the car and ramp must be visible for the checkpoint and the plan 02-10 feel session" — building anything more is Phase 3 scope.
- **Ground speed computed inline in `src/main.ts`, not via the vehicle controller's own speed accessor.** Mirrors `src/physics/vehicle.ts`'s existing `groundSpeedMs` convention and avoids the vertical-velocity noise Pitfall 1 warns about.

## Deviations from Plan

None. Both automated tasks matched their acceptance criteria on the first attempt; the browser checkpoint passed all 10 steps without any defect requiring a second pass.

## Issues Encountered

None.

## Known Stubs

- The chase camera is an explicit, commented placeholder — Phase 3 replaces it with the permanent helicopter camera and its own go/no-go gate.

## Threat Flags

None new — this plan's threat model (T-02-01 tuning-blob parsing, T-02-20 debug-scene-fixture preservation, T-02-02 DOM injection) was fully anticipated and mitigated exactly as planned; no new trust boundary was introduced.

## User Setup Required

None.

## Next Phase Readiness

- The composition root now boots into a fully drivable vehicle with live input, a real speedometer and a working ramp — plan 02-09's tuning panel and telemetry HUD have a live scene to attach to.
- Plan 02-10's human feel session can run directly against this wiring; the temporary chase camera is adequate for that session per 02-RESEARCH.md Open Question 1.

---
*Phase: 02-vehicle-feel-core*
*Completed: 2026-09-11*

## Self-Check: PASSED

`src/loop.ts`, `tests/loop.test.ts` and `src/main.ts` confirmed present and modified on disk;
commits `701c70c` and `c87e3b8` confirmed in `git log`. `npm run check`'s typecheck and test
components pass cleanly (322/322 tests plus the new `dtMs` case); `npm run build` emits a
bundle. The human browser checkpoint (task 3) was performed live and reported all 10 steps
passing on the first pass.
