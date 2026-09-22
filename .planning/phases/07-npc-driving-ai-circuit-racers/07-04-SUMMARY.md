---
phase: 07-npc-driving-ai-circuit-racers
plan: 04
subsystem: ai
tags: [ai, recovery, stuck-detection, state-machine, circuit-race, rapier, vehicle-physics]

# Dependency graph
requires:
  - phase: 07-npc-driving-ai-circuit-racers
    provides: "07-02: circuit-race-coordinator.ts (N-racer countdown/progress), race-start.ts constants; 07-03: AiFleet.lastFrame/avoidanceScale, throttle-only avoidance"
provides:
  - "src/core/checkpoint-pose.ts: checkpointResetPose — one verified, bug-fixed reset-pose helper shared by player respawn and AI reset"
  - "src/physics/transform-cache.ts: TransformCache.snapBody(index) — teleport-without-interpolation for a single body"
  - "src/core/ai-stuck-detector.ts: createStuckDetector, STUCK_PARAMS, driveOutFrame, deriveAiDebugState — a pure racing/recovering/reset state machine"
  - "src/gameplay/circuit-race-coordinator.ts: per-AI stuck detection wired into onTickBegin/onTickEnd, reset-pose deferral (camera clearance + inter-car clearance), RacerSnapshot.stuck"
  - "src/main.ts circuit-race branch: onCarReset -> TransformCache.snapBody, player body registered as an AI avoidance obstacle"
affects: [07-05, 07-06, 07-07, later Circuit Race plans building the ?debug AI overlay (D-15) and finish/placement persistence]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Pure state machines (ai-stuck-detector.ts) never read Rapier/DOM/wall-clock — the caller derives a plain StuckInput from live telemetry each tick, mirroring ai-driver.ts's own AiObservation contract"
    - "A pending reset is a sticky internal flag (resolves once, then returns 'request-reset' every tick until acknowledgeReset()) rather than a re-evaluated condition — avoids re-deriving the camera-clearance decision every tick once it's been made"
    - "Reset-pose safety is TWO independent clearance checks composed in the coordinator, not the detector: camera-distance deferral (detector's own concern) and inter-car 6m clearance (coordinator's own concern, since only it knows every racer's live position)"

key-files:
  created:
    - src/core/checkpoint-pose.ts
    - tests/checkpoint-pose.test.ts
    - src/core/ai-stuck-detector.ts
    - tests/ai-stuck-detector.test.ts
  modified:
    - src/gameplay/race-coordinator.ts
    - src/gameplay/circuit-race-coordinator.ts
    - src/physics/transform-cache.ts
    - tests/transform-cache.test.ts
    - src/main.ts
    - tests/circuit-race-coordinator.test.ts

key-decisions:
  - "poseForCheckpoint's heading was a genuine bug, not a relocation-only refactor: measured 12 of 12 checkpoints (both real Juliette courses) failing a cos(30deg) down-course alignment check pre-fix, 12 of 12 passing post-fix with checkpointResetPose's yawFromTravelDirection formula"
  - "A flipped car's pending reset forces StuckPhase back to 'racing' (never 'recovering') so the coordinator's own phase==='recovering' gate never calls driveOutFrame for a flip — 'skips drive-out' is structural, not a separate flag"
  - "Reset-pose inter-car clearance (RESET_CLEARANCE_M=6) lives in circuit-race-coordinator.ts, not ai-stuck-detector.ts — the detector is pure and per-car, it cannot see other racers' positions; only the coordinator can"

patterns-established:
  - "Pattern: STUCK_PARAMS is a single frozen compile-time constant with a doc comment flagging it for a later feel-pass retune (07-RESEARCH.md Open Question 1's own recommendation), mirroring racing-line.ts's AI_PACE_CALIBRATION discipline"

requirements-completed: [CIRC-02]

# Metrics
duration: 22min
completed: 2026-09-22
---

# Phase 7 Plan 4: NPC Driving AI Recovery Summary

**A crashed, flipped or wedged AI racer drives itself out (reverse-then-forward) and, failing that, resets onto the road at its last checkpoint paying the player's own 5-second respawn cost — deferred off-camera where possible, never dropped onto another car — built on a pure, hysteresis-guarded racing/recovering/reset state machine and a bug-fixed shared checkpoint reset-pose helper.**

## Performance

- **Duration:** ~22 min active work
- **Started:** 2026-09-22T22:31:00Z (approx.)
- **Completed:** 2026-09-22T22:51:32Z
- **Tasks:** 3
- **Files modified:** 10 (4 created, 6 modified)

## Accomplishments

- Found and fixed a real, universal bug in the player/AI shared reset-pose math: the former `poseForCheckpoint` computed heading as a BEARING but fed it to `Vehicle.resetPose` as a YAW — measured against both real Juliette courses, this failed a down-course alignment check at every single checkpoint (12 of 12), not an edge case. `checkpointResetPose` fixes it for both the player's respawn and every AI reset.
- Built `TransformCache.snapBody(index)`, closing the one-frame interpolation-slide gap for any body teleported outside the loop's normal reset-command path.
- Built `src/core/ai-stuck-detector.ts`: a fully pure, deterministic racing/recovering/reset state machine covering stuck hysteresis, flip detection (skips drive-out entirely), a wrap-aware no-line-progress window, a reverse-then-forward drive-out frame, and camera-clearance-deferred reset requests — 18 behavior tests, all passing on the first run.
- Wired recovery into `circuit-race-coordinator.ts`: one detector per AI racer, updated only after GO and only for racers still racing; a "recovering" detector overrides the fleet's shape with `driveOutFrame`; a "request-reset" resolves to `checkpointResetPose` (or the grid pose before any checkpoint is hit), postponed a tick at a time while any other racer sits within 6m of the target, then actually resets with the same 5s penalty the player pays.
- Registered the player's own vehicle body as an AI avoidance obstacle in `main.ts` (D-10) and wired `onCarReset` to `TransformCache.snapBody(1 + racerIndex)` so a reset AI car pops instantly onto its new pose.

## Task Commits

Each task was committed atomically:

1. **Task 1: One verified checkpoint reset pose + TransformCache.snapBody** - `142ea66` (fix)
2. **Task 2: Pure stuck/flip/no-progress detector with drive-out frame** - `5d52ac4` (feat)
3. **Task 3: Wire recovery into Circuit Race and register the player as an obstacle** - `fc63999` (feat)

**Plan metadata:** (this commit, docs: complete plan)

## Files Created/Modified

- `src/core/checkpoint-pose.ts` - `checkpointResetPose`: pure, verified, road-tangent reset-pose helper shared by player respawn and AI reset
- `tests/checkpoint-pose.test.ts` - Position/heading behavior tests against both real Juliette courses, plus the no-route fallback case
- `src/gameplay/race-coordinator.ts` - Deleted the buggy `poseForCheckpoint`; respawn now calls `checkpointResetPose`
- `src/gameplay/circuit-race-coordinator.ts` - Player-respawn import switched to `checkpointResetPose`; per-AI `createStuckDetector`, drive-out override in `onTickBegin`, reset-resolution loop in `onTickEnd`, detector restart on race restart, `RacerSnapshot.stuck`
- `src/physics/transform-cache.ts` - `snapBody(index)`: re-reads one body into both `prev` and `cur`, throws `RangeError` out of range
- `tests/transform-cache.test.ts` - `snapBody` behavior coverage (teleport, other-body isolation, range check, zero allocation)
- `src/core/ai-stuck-detector.ts` - `createStuckDetector`, `STUCK_PARAMS`, `driveOutFrame`, `deriveAiDebugState`
- `tests/ai-stuck-detector.test.ts` - 18 tests covering every transition in the plan's behavior list
- `src/main.ts` - Circuit Race branch: `line`/`onCarReset` passed to the coordinator, `obstacleBodies: [scene.vehicle.body]` passed to `createAiFleet`
- `tests/circuit-race-coordinator.test.ts` - Fake fleet extended with `lastFrame`/`avoidanceScale`/`driver.debug().lineIndex`; 9 new behavior tests for the recovery flow

## Decisions Made

- **`poseForCheckpoint`'s heading was a genuine, universal bug (Task 1's own investigation step).** The plan asked for a pre-fix measurement before implementing the fix; a throwaway script (written, run, then deleted before any commit) confirmed 12 of 12 checkpoints across both real Juliette courses failed a `cos(30deg)` down-course alignment check with the old bearing-as-yaw math (dot products from -0.94 to +0.66). `checkpointResetPose`'s `yawFromTravelDirection`-based formula passes at every checkpoint, verified directly in `tests/checkpoint-pose.test.ts` against the real map data (not a synthetic fixture).
- **A flip forces `StuckPhase` back to `"racing"`, never `"recovering"`.** Since `circuit-race-coordinator.ts`'s drive-out override is gated purely on `phase === "recovering"`, keeping a flipped car's phase at `"racing"` while its `pendingReset` flag drives the reset flow is what makes "skips drive-out" structural rather than a second conditional the coordinator would need to check.
- **Inter-car reset clearance (6m) lives in the coordinator, not the detector.** `ai-stuck-detector.ts` is intentionally pure and per-car — it has no way to know where other racers are. `circuit-race-coordinator.ts` already tracks every racer's body position for its own progress loop, so it owns the `otherRacerBlocksPose` check and simply skips the reset for a tick (the detector's own `request-reset` action stays sticky and is re-read the very next tick) rather than teaching the detector about the whole field.
- **Test tick-count assertions use comfortable margins around the 1.0/1.8/3.0s float-accumulation boundaries** (e.g., `deferSec`/`resetLabelTimer` crossing thresholds via 150+ repeated `dtSec` additions) rather than exact tick indices — an exact-boundary assertion risked being one ULP off from a real threshold crossing and would have been a flaky test, not a real bug.

## Deviations from Plan

None — the plan itself explicitly directed the Task 1 investigation-then-fix sequence (write the test against the old function first, measure, then build the fix), so the bug fix above is planned work, not an unplanned deviation. No Rule 1-4 auto-fixes were needed beyond what the plan's own action text already scoped.

## Issues Encountered

- `npm run check`'s Biome step is RED on this branch, but only for files this plan never touched: `tools/map-compiler/author/gltf.test.ts`, `src/loop.ts`, `src/input/race-commands.ts` (pre-existing import-order drift), `tests/loop.test.ts`/`tests/respawn.test.ts`/`tests/restart.test.ts` (pre-existing CRLF-vs-LF formatting drift, already documented in `.planning/STATE.md`'s `[Phase 2, all plans]` entry), and two developer-exported `vehicleTuning/*.json` files outside `src/`/`tests/`. Confirmed via `git status --short` that none of these were modified by this plan; every file this plan touched passes `npx biome check` cleanly.
- The full `npx vitest run` regression pass shows the same 3 pre-existing `tests/vehicle-telemetry.test.ts` failures (accel/brake/runAllRoutines) already documented in STATE.md as a KNOWN-RED state from an earlier hand-tuning session (`[Quick 260920-sm2, open]`) — unrelated to this plan's files. 1242 of 1245 tests pass; every test this plan added or touched is green.

## Known Stubs

None — every file this plan touches is fully wired (no placeholder data, no unwired components). The `?debug` AI overlay (D-15) that will consume `RacerSnapshot.stuck`/`deriveAiDebugState` is explicitly out of this plan's scope per 07-02-SUMMARY.md's own deferred-items list, not a stub left behind by this plan.

## Threat Flags

None beyond what this plan's own `<threat_model>` already registers (T-07-12/T-07-13/T-07-14 in `07-04-PLAN.md`) — the reset path is triggered only by the detector's own telemetry rules, relocates to the car's own last checkpoint, charges the same 5s penalty as the player, the reset-deferral/overlap retry loop is capped and allocation-free, and `TransformCache.snapBody` throws on an out-of-range index with its only caller computing that index from the fixed racer table.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- SC3 (stuck AI cars recover instead of idling forever) is satisfied by the tested detect -> drive-out -> reset flow, headless-proven against 18 detector-level tests and 9 coordinator-level integration tests.
- `RacerSnapshot.stuck` and `deriveAiDebugState` are ready for the `?debug` AI overlay (D-15) to consume directly — no new plumbing needed.
- `checkpointResetPose` is now the single reset-pose source of truth for both solo Time Attack respawn and every Circuit Race reset (player and AI) — a future plan touching either path has one function to reason about, not two subtly different ones.
- `STUCK_PARAMS`' exact thresholds are Claude's-discretion values per 07-RESEARCH.md Open Question 1, explicitly doc-flagged for a later browser feel-pass (the 07-05 checkpoint, per that plan's own note) — worth revisiting once a human can watch a car actually get stuck and recover in the browser.
- No blockers.

---
*Phase: 07-npc-driving-ai-circuit-racers*
*Completed: 2026-09-22*

## Self-Check: PASSED

- All 10 created/modified source and test files verified present on disk (`src/core/checkpoint-pose.ts`, `tests/checkpoint-pose.test.ts`, `src/core/ai-stuck-detector.ts`, `tests/ai-stuck-detector.test.ts`, `src/gameplay/race-coordinator.ts`, `src/gameplay/circuit-race-coordinator.ts`, `src/physics/transform-cache.ts`, `tests/transform-cache.test.ts`, `src/main.ts`, `tests/circuit-race-coordinator.test.ts`)
- All 3 task commits verified present in `git log`: `142ea66`, `5d52ac4`, `fc63999`
