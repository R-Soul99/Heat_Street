---
phase: 07-npc-driving-ai-circuit-racers
verified: 2026-11-15T06:00:00Z
status: passed
score: 5/5 must-haves verified
overrides_applied: 0
---

# Phase 7: NPC Driving AI & Circuit Racers Verification Report

**Phase Goal:** Other cars share the road and actually drive: same physics, same contact, no cheating
**Verified:** 2026-11-15
**Status:** passed
**Re-verification:** No, initial verification

## Goal Achievement

### Observable Truths (ROADMAP SC1-SC5)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | AI racers drive the identical physics vehicle the player does. They can be rammed, spun and can crash, and nothing writes their transforms directly | VERIFIED | `src/physics/ai-fleet.ts:120` builds every car with the player's `createVehicle(world, tuning, pose)`. The only control channel is `car.vehicle.tick(frame, ...)` with an `InputFrame` (line 212). No `setTranslation`/`setLinvel`/kinematic writes in ai-fleet, ai-driver or circuit-race-coordinator. The only pose writes are `resetPose` at spawn, at restart and at the stuck-recovery checkpoint reset (the same path the player's respawn uses, with the 5 s penalty). Circuit-race cars use `aiTuning`, which is the player's RWD tune. |
| 2 | AI racers complete a Circuit at a fixed, repeatable pace with no rubber-banding or speed-multiplier catch-up | VERIFIED | `AI_PACE_CALIBRATION = 1.05` is a compile-time constant (`src/core/racing-line.ts:125`). The circuit-race `createAiFleet` call (`src/main.ts:489-501`) passes no `speedEdge`, and pursuers are forced to 0 in circuit race (`main.ts:512`). The source-guard test (`tests/ai-driver.test.ts:245`) bans `player`, `race-placement`, `rubber`, `catchUp`, `Math.random` and `Date.now` in ai-driver.ts and racing-line.ts. The racing-line build is deterministic (`racing-line.test.ts:149`). `tests/ai-lap-terrain.test.ts` requires 3 AI x 3 laps to finish under the Gold total and above 0.8x Gold. See the Warning about pursuer catch-up below. |
| 3 | AI cars that get stuck, flipped or wedged detect it and recover (or despawn off-screen) rather than idling forever | VERIFIED | `src/core/ai-stuck-detector.ts` has stuck, flipped (70 deg for 1 s) and no-progress (10 m in 8 s) detection. It is wired in `circuit-race-coordinator.ts:186,374,472-477`: drive-out first, then a checkpoint reset deferred until off camera, with 6 m inter-car clearance. Unit-tested in `tests/ai-stuck-detector.test.ts` and `circuit-race-coordinator.test.ts`. Human approval in 07-05. |
| 4 | AI steering shows no visible oscillation on straights or corner-cutting through scenery, verifiable via an AI debug overlay showing paths and targets | VERIFIED | `src/debug/ai-debug-overlay.ts` draws the racing line, per-AI targets and S/T/B/state/timers. It is built under `DEBUG_ENABLED` and toggled with KeyI (`main.ts:1026-1030`), and updated each render frame (`main.ts:1548`). At the shipped pace the terrain test asserts mean straight-line steer below 0.06, steer delta below 0.004, and never more than 2 m outside the road. Human sign-off: 07-05 (overlay and SC4), then the 07-07 re-test at pace 1.05. |
| 5 | Adding AI racers changes nothing about the player's medal time. The clock is still the opponent | VERIFIED | The circuit-race coordinator imports nothing from the medal system (import list checked). Circuit Race saves under `<id>.race` with medal `none` (`main.ts:844`, `medal-persistence.ts` `saveRaceResult`). Solo time attack builds no fleet. Passing `knownProgressCourseIds` at every load and save keeps solo and race records from deleting each other (mutual-preservation test). `?laps=N` practice never saves. |

**Score:** 5/5 truths verified

### D-09 (AI pace) judged against the recorded user decision

The original D-09 set AI pace at "roughly Silver". At the 07-07 checkpoint the user changed this ("Fast, no catch-up", then "as fast as clean allows, beating Gold"), as recorded in 07-07-SUMMARY.md key-decisions. The shipped code meets the revised target. The measured 3-AI field ran 190.3 to 192.8 s against a 213.05 s Gold total, and `tests/ai-lap-terrain.test.ts` enforces this. Pace is still one fixed dial, with no catch-up and no speed edge. D-09 is satisfied as amended.

### Required Artifacts

| Artifact | Status | Details |
|----------|--------|---------|
| `src/core/racing-line.ts` (712 lines) | VERIFIED | Deterministic, curvature-profiled line and grid poses; fixed pace constant |
| `src/core/ai-driver.ts` (332 lines) | VERIFIED | Pure-pursuit InputSource; throttle-only avoidance composition |
| `src/physics/ai-fleet.ts` (247 lines) | VERIFIED | Wired from main.ts for both circuit race and pursuit |
| `src/physics/ai-avoidance.ts` | VERIFIED | castRay forward probe, wired in fleet.tick |
| `src/core/ai-stuck-detector.ts` | VERIFIED | Wired in the coordinator |
| `src/gameplay/circuit-race-coordinator.ts` (595 lines) | VERIFIED | Countdown, per-racer laps, recovery, standings, classification |
| `src/debug/ai-debug-overlay.ts` | VERIFIED | Wired behind `?debug` with KeyI |
| `src/core/race-placement.ts`, `src/hud/race-hud.ts`, `src/hud/minimap.ts` | VERIFIED | Live P/Lap/gap HUD and racer dots |
| `src/core/medal-persistence.ts`, `src/hud/results-view.ts`, `src/core/race-laps.ts` | VERIFIED | bestFinish persistence, race card and classification panel, practice laps |

### Key Link Verification

| From | To | Via | Status |
|------|----|-----|--------|
| main.ts circuit-race branch | createAiFleet | `fleet = createAiFleet(world, aiTuning, ..., line, gridPoses.slice(0, AI_RACER_COUNT), ...)` | WIRED |
| ai-fleet tick | Vehicle physics | `car.vehicle.tick(frame, ...)` | WIRED |
| coordinator | stuck detector / fleet.resetCar | `createStuckDetector`, `driveOutFrame`, `resetCar` | WIRED |
| main.ts | ai-debug-overlay | `createAiDebugOverlay` + `onDebugKey("KeyI")` + per-frame update | WIRED |
| main.ts | medal persistence | `saveRaceResult` under `raceVariantCourseId` only | WIRED |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Typecheck, lint and full test suite | `npm run check` | tsc clean. Biome: 4 warnings, all outside phase 7 (`tools/editor-shell/shell.css` x3, `tools/map-compiler/author/gltf.test.ts`). Vitest: 189 files, 2429 passed, 1 skipped (unrelated: demo-hills/terrain-gate), 2 todo | PASS |
| 3 AI x 3 clean laps faster than Gold on terrain Juliette | included in `npm run check` (`tests/ai-lap-terrain.test.ts`) | passed | PASS |

### Probe Execution

No probes are declared for this phase. Step 7c does not apply.

### Requirements Coverage

| Requirement | Source Plans | Description | Status | Evidence |
|-------------|--------------|-------------|--------|----------|
| CIRC-02 | 07-01..07-07 | AI racers compete in Circuit mode at a fixed difficulty with no rubber-banding | SATISFIED | SC1, SC2 and SC5 above; the user approved the browser circuit race on 2026-11-15 |

No orphaned requirements.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| (phase 7 files) | - | TBD/FIXME/XXX | none found | - |
| `src/core/pursuer-driver.ts` | ~480 | Distance-based `catchupEdge` speed multiplier, fed through `ai-fleet.ts` `speedEdge` | WARNING | Belongs to the pursuit prototype (`?pursuers=N`, Phase 8 groundwork), not the circuit racers. Pursuers are disabled in circuit race and the racer fleet gets no `speedEdge`. Read literally, though, SC2's "anywhere in the code" is no longer true, and the source guard covers only ai-driver.ts and racing-line.ts, not ai-fleet.ts or the circuit-race wiring. |
| `src/main.ts` | 211 | `aiTuning` follows the player's saved RWD tune from localStorage | INFO | Deliberate (D-02: same car as the player). AI pace is repeatable for a given tune but moves if the player retunes their car. |

### Human Verification Required

None outstanding. The 07-05 human checkpoint approved SC3, SC4, D-10, D-12 and the frame budget. The 07-07 end-of-phase checkpoint was approved on 2026-11-15 after the `?mode=circuit-race&laps=1` re-test at AI pace 1.05.

### Gaps Summary

No blocking gaps. Phase 7 achieves its goal. One warning is worth tracking for Phase 8: the shared `ai-fleet.ts` now carries a per-car `speedEdge` multiplier, and the pursuit driver uses distance-based catch-up. Both are outside Circuit Race, but no test pins that the circuit-race fleet never receives a `speedEdge`. A small source guard or unit test on the circuit-race wiring would keep CIRC-02's no-rubber-banding guarantee enforced as pursuit work grows.

---

_Verified: 2026-11-15_
_Verifier: Claude (gsd-verifier)_
