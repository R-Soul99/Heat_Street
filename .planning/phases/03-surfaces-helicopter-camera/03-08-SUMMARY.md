---
phase: 03-surfaces-helicopter-camera
plan: 08
subsystem: render
tags: [camera, go-no-go, adr, human-playtest, grid-fix]

# Dependency graph
requires:
  - phase: 03-surfaces-helicopter-camera (plan 03-04)
    provides: createHelicopterCameraRig/createChaseCameraRig, CameraTarget/CameraRig contracts, camera-tuning.ts defaults
  - phase: 03-surfaces-helicopter-camera (plan 03-07)
    provides: the composition root wired onto the surface scene + helicopter camera, live tuning panel
provides:
  - docs/adr/0002-helicopter-camera-go-no-go.md — the recorded GO decision, satisfying SC4's explicit gate
  - A bounded (floor-matched) reference grid, replacing the Phase-2-inherited unbounded one
  - createVehicleView's new groundExtents option, plus surface-scene.ts's exported SURFACE_SCENE_FLOOR_HALF_EXTENTS as its single source of truth
affects: [03-09, 03-10, 03-11, 03-12]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Bounded reference grid: a hand-built LineSegments grid (buildReferenceGrid) replacing THREE.GridHelper wherever the drivable floor is not the Phase 2 400x400m square, sized from the physics tier's own exported half-extents so render and physics can't drift apart"

key-files:
  created:
    - docs/adr/0002-helicopter-camera-go-no-go.md
  modified:
    - src/render/vehicle-view.ts
    - src/physics/surface-scene.ts
    - src/main.ts

key-decisions:
  - "SC4 go/no-go: GO, no retuning — every camera default plan 03-04 shipped was judged correct on first playtest (speed legibility, drift stability, skins, frame cost all passed cleanly)"
  - "camera-tuning.ts defaults are unchanged; every value keeps its [ASSUMED] provenance tag since nothing was retuned — read as 'confirmed correct by playtest', not 'unverified'"
  - "src/main.ts's activeRig stays helicopterRig; only the explanatory comment was updated to point at the now-decided ADR, since the shipped default already matched the GO outcome"

patterns-established:
  - "Bounded reference grid sourced from the physics tier's own exported floor extents, preventing the render tier's speed/slip reference from ever implying more drivable floor than the physics collider actually provides"

requirements-completed: []

# Metrics
duration: ~75min (including a live human playtest session and a mid-session defect fix)
completed: 2026-09-12
---

# Phase 03 Plan 08: Helicopter Camera Go/No-Go Summary

**Ran the SC3/SC4 human go/no-go gate live: a developer playtest found the helicopter camera's
shipped defaults pass cleanly with zero retuning, and a genuine defect (the reference grid
extending past the six-surface scene's real floor, causing fall-offs) was found, fixed, and
re-verified inside the same session. Recorded as `docs/adr/0002-helicopter-camera-go-no-go.md`.**

## Performance

- **Duration:** ~75 min (checkpoint session, including the human playtest itself)
- **Completed:** 2026-09-12
- **Tasks:** 3 (Task 1 human-verify checkpoint, Task 2 decision checkpoint, Task 3 auto)
- **Files modified:** 4 (1 created, 3 modified)

## Accomplishments

- **SC4's go/no-go gate is resolved: GO.** The developer could distinguish 60 mph from 110 mph
  on sight using only FOV, altitude and ground-detail cues, with the shipped `camera-tuning.ts`
  defaults — no slider sweep needed to pass.
- **SC3's drift-stability bar (D-11) is met.** No shake, jitter or snap through a 40-degree
  slide; the one edge case reported (a smooth pan-to-rear as a doughnut decelerates to a stop)
  was verified against `src/render/camera/camera-math.ts`'s `blendedHeadingRad` source to be
  the documented near-zero-speed anti-noise fallback, not a defect.
- **A real defect was found mid-session and fixed.** The reference grid inherited from the
  Phase 2 flat-plane fixture was a fixed 400 x 400 m `THREE.GridHelper`, far wider than the
  six-surface scene's actual ±60 m-wide physics floor — driving past the real edge still showed
  grid lines, reading as safe ground. Replaced with a hand-built, floor-bounded grid
  (`buildReferenceGrid` in `src/render/vehicle-view.ts`) sized from a new exported constant
  (`SURFACE_SCENE_FLOOR_HALF_EXTENTS` in `src/physics/surface-scene.ts`), so the two tiers
  cannot drift apart again. Every pre-Phase-3 call site is unaffected (same 400x400m default).
- **CAM-03's skins confirmed clean**: clearly distinguishable, corner label changes, zero effect
  on camera distance/damping/targeting.
- **Frame cost of the skin's CSS filter measured directly** (in-browser `requestAnimationFrame`
  sampling, not the in-game profiler, which cannot see compositor-level cost): 120.1 FPS with
  the skin vs. 120.0 FPS without — not material.
- Two feel-quality notes were surfaced and explicitly deferred to plan 03-12 per this plan's own
  instruction not to fix surface feel here: the vehicle reads as "floaty" with unclear
  surface interaction (compounded by a lack of visible ground detail texture), and a request
  for the camera to hold its position more during a doughnut.

## Task Commits

1. **Task 1: Human go/no-go playtest** — no code commit (checkpoint task); the defect found
   during this task was fixed and committed separately, below.
2. **Mid-session defect fix (found during Task 1, fixed before Task 2)** — `9a86186` (fix)
3. **Task 2: The SC4 decision** — GO, recorded via the developer's explicit selection (no code
   commit; the decision itself is recorded in Task 3's ADR)
4. **Task 3: Record the decision, update the comment pointing at it** — (docs + comment commit,
   this SUMMARY)

## Deviations from Plan

1. **A defect was found and fixed mid-checkpoint, exactly as the plan anticipates** ("If the
   developer reports a defect, fix it and re-present the same steps for a second pass, and
   record both passes in the SUMMARY"). First pass surfaced the grid bug during step 1's setup
   before speed testing could meaningfully start; the fix (commit `9a86186`) was applied, `npm
   run check` and `npm run build` re-verified clean, and the full ten-step pass proceeded
   without further issue on the corrected build. There was no need for a literal second full
   pass through all ten steps — the fix was applied before the developer's substantive answers
   to steps 1–10 were given, so there is one clean answer set, not two.
2. **Step 6 (sustained full-throttle on loose surfaces) could not be confirmed by hand** — the
   scene's 80 m zone length is too short. The plan's own text anticipates this exact gap
   ("already covered headlessly by plan 03-06's stability sweep, now confirmed by hand"); the
   ADR records the automated result (8.8° worst-case slip vs. 30° threshold) as the evidence of
   record rather than treating the gap as a failure to answer.
3. **Step 9 (frame cost) was reworded and measured directly by the orchestrating agent**, rather
   than walked through DevTools panels by the developer, after the developer reported not
   understanding the original instruction. A small `requestAnimationFrame`-based console script
   was provided instead, giving an exact, reproducible number (0.0 FPS diff) rather than a
   qualitative DevTools read.
4. **`src/main.ts`'s `activeRig`-adjacent comment was updated even though the decision was
   GO** (the plan's literal text only mandates a code change "on `no-go` only"). This is a
   documentation-only change: the comment previously described the gate as still pending
   ("if plan 03-08's go/no-go gate fails"), which would have been stale and misleading the
   moment this ADR was accepted. No behavioural change accompanies it.

## Self-Check: PASSED

- `npx vitest run tests/camera-tuning.test.ts tests/camera-framing.test.ts` — 36/36 pass
- `npm run check` (typecheck + lint + full suite) — 503/503 tests pass, lint clean
- `npm run build` — succeeds
- `docs/adr/0002-helicopter-camera-go-no-go.md` exists, `## Decision` names exactly one outcome (`GO`), quotes ROADMAP SC3/SC4 verbatim, cites CONTEXT.md D-11/D-12, and embeds the verbatim human answers to steps 1, 3, 8(fallback)/9(frame-cost by number in this plan's step list) — see the ADR's own step-by-step Evidence section
- No `[TUNED` provenance tags were needed (no retune occurred) — verified no diff in `src/core/camera-tuning.ts`
