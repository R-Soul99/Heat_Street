---
phase: 07-npc-driving-ai-circuit-racers
plan: 06
subsystem: gameplay
tags: [circuit-race, hud, minimap, standings, pure-core, vitest]

# Dependency graph
requires:
  - phase: 07-npc-driving-ai-circuit-racers
    provides: "07-01: RacingLine (points/arcM/checkpointArcM/lapLengthM); 07-02: race-start.ts (AI_PAINTS, RACE_FIELD_SIZE, AI_RACER_COUNT, PLAYER_GRID_SLOT); 07-05: circuit-race-coordinator.ts's per-racer arrays, RACER INDEX TABLE"
provides:
  - "src/core/race-placement.ts: createProgressTracker (leg-bounded racing-line progress), computeStandings, createGapTracker — pure, presentation-only race placement"
  - "src/hud/race-hud.ts: RaceStatusModel, formatRaceStatus, RaceHud.updateRaceStatus — the D-16 'P3/4 · Lap 2/3 · +1.4s' status line + race clock"
  - "src/hud/minimap.ts: MinimapRacer, projectRacerMarkers, optional MinimapSnapshot.racers — D-14 colored AI dots with edge blips"
  - "src/gameplay/circuit-race-coordinator.ts: standings + per-racer progressM on CircuitRaceSnapshot, live raceHud.updateRaceStatus/minimap.update(racers) wiring, gap-tracker truncation on respawn/reset/restart"
affects: [07-07, any future AI-pace or course-authoring session that touches racing-line arc scale]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Pattern: one progress tracker per racer, each a stateless wrapper over the SAME shared RacingLine's precomputed per-checkpoint legs (07-RESEARCH.md Pattern 7) — no per-racer internal state, only the live race snapshot + XZ position passed to update() each call, matching this file's existing convention of calling races[i].snapshot() fresh at every use site rather than caching"
    - "Pattern: a respawn/reset's gap-tracker truncate() call is computed from the INTENDED reset pose's x/z (gridPoses[i] or checkpointResetPose(...)), never from the live body position — correct even when the physics body has not yet physically moved that same tick"

key-files:
  created:
    - src/core/race-placement.ts
    - tests/race-placement.test.ts
    - tests/race-hud.test.ts
  modified:
    - src/hud/race-hud.ts
    - src/hud/minimap.ts
    - tests/minimap.test.ts
    - src/gameplay/circuit-race-coordinator.ts
    - tests/circuit-race-coordinator.test.ts

key-decisions:
  - "tests/circuit-race-coordinator.test.ts's shared RacingLine fixture was upgraded from a two-field stub ({lapLengthM, points:[{arcM:0}]}) to a fully real, 10x-arc-scaled geometry (x=i, arcM=i*10, lapLengthM=400) — a 1:1 scale would have made LEG_BACKTRACK_M (60) exceed the fixture's own lap length, wrapping every leg's point list around to swallow the ENTIRE line and defeating the leg-restriction behavior this plan wires in"
  - "Standings/progressM are computed live (never cached) from current body position + race snapshot on every snapshot()/refresh() call, mirroring this file's pre-existing races[i].snapshot()-every-call-site convention — keeps the new code trivially consistent with the rest of the file rather than introducing a second, cache-invalidation-prone state-tracking style"

patterns-established:
  - "Pattern: gap-tracker truncate() on any reset path takes the pose about to be applied, not the body's current (possibly stale, in a fake-scene test) translation — future reset paths (e.g. a Getaway-mode pursuer respawn) should follow the same rule"

requirements-completed: [CIRC-02]

# Metrics
duration: ~34min
completed: 2026-09-23
---

# Phase 7 Plan 6: Live Placing, Gap and Minimap Racers Summary

**D-16's live "P3/4 · Lap 2/3 · +1.4s" race-status HUD line with a time-based milestone gap, plus D-14's colored AI minimap dots, both wired live off a new pure `race-placement.ts` core (leg-bounded racing-line progress, standings, milestone-based gap tracker) — presentation-only, structurally guarded from ever feeding back into AI control.**

## Performance

- **Duration:** ~34 min (Task 1: ~9 min; Task 2: ~10 min; Task 3: ~15 min)
- **Started:** 2026-09-23T18:32:28+01:00
- **Completed:** 2026-09-23T19:06:12+01:00
- **Tasks:** 3 (all `type="auto" tdd="true"`)
- **Files modified:** 8 (3 created, 5 modified)

## Accomplishments

- Built `src/core/race-placement.ts`: `createProgressTracker` (leg-bounded nearest-point search restricted to `[checkpointArcM[t-1] - LEG_BACKTRACK_M, checkpointArcM[t]]`, with correct start/finish-line wrap handling for negative leg arc), `computeStandings` (finished racers by effective finish time, then unfinished by progress, ties by racer index), and `createGapTracker` (time-based 20 m milestone gaps with respawn/reset truncation) — all pure, imported only by `race-state.ts`/`racing-line.ts` types.
- Added `formatRaceStatus`/`RaceStatusModel`/`RaceHud.updateRaceStatus` to `src/hud/race-hud.ts`: a new status line (first child of the existing top-right timing panel) rendering exact D-16 strings (`"P3/4 · Lap 2/3 · +1.4s"`, `"-0.8s"` when leading, `"--"` with no shared milestone, `"P2/4 · FINISHED"`), plus the race clock.
- Added `MinimapRacer`/`projectRacerMarkers`/optional `MinimapSnapshot.racers` to `src/hud/minimap.ts`: colored AI dots (radiusPx 4.5 on-map / 3 offscreen, same edge-blip treatment as checkpoints), drawn after checkpoint/target dots and before the player arrow.
- Wired all of it into `src/gameplay/circuit-race-coordinator.ts`: one progress tracker per racer plus a shared gap tracker; `onTickEnd` records every racer's milestones after GO; `refresh()` builds the player's `RaceStatusModel` and the AI `racers` array for the minimap; player respawn and AI reset each truncate their own gap-tracker milestones to the new (intended) position; restart resets the whole gap tracker. `standings` and per-racer `progressM` are now exposed on `CircuitRaceSnapshot`.
- Full plan verification suite green: `race-placement.test.ts`, `race-hud.test.ts`, `minimap.test.ts`, `circuit-race-coordinator.test.ts`, `ai-driver.test.ts`, `layering.test.ts` (181 tests), `npm run typecheck`, `npm run build`, and `npm run check` clean on every file this plan touched (pre-existing CRLF-format errors in unrelated files are untouched, per STATE.md's already-documented finding).

## Task Commits

Each task was committed atomically, following RED/GREEN TDD gates:

1. **Task 1: Pure race placement (progress/standings/gap)** - `f75b161` (test, RED) → `79996be` (feat, GREEN)
2. **Task 2: Race-status HUD block and minimap racer dots** - `71ab25a` (test, RED) → `d170ba0` (feat, GREEN)
3. **Task 3: Live placing, gap and minimap racers in the coordinator** - `6b26240` (feat; extends the existing `circuit-race-coordinator.test.ts` in the same commit as the implementation, since it modifies an existing shared test fixture rather than adding an isolated new test file)

**Plan metadata:** (this commit, docs: complete plan)

## Files Created/Modified

- `src/core/race-placement.ts` - `LEG_BACKTRACK_M`, `GAP_MILESTONE_M`, `createProgressTracker`, `computeStandings`, `createGapTracker` (pure core)
- `tests/race-placement.test.ts` - progress/standings/gap-tracker behavior tests against a synthetic square racing line
- `src/hud/race-hud.ts` - `RaceStatusModel`, `formatRaceStatus`, `RaceHud.updateRaceStatus`, a new `raceStatus` DOM node
- `tests/race-hud.test.ts` - pure `formatRaceStatus` formatter tests (Node environment, no DOM)
- `src/hud/minimap.ts` - `MinimapRacer`, `MinimapRacerMarker`, `projectRacerMarkers`, optional `MinimapSnapshot.racers`, racer-dot draw pass in `update()`
- `tests/minimap.test.ts` - `projectRacerMarkers` on-map/offscreen projection tests
- `src/gameplay/circuit-race-coordinator.ts` - progress trackers + gap tracker construction, `racerProgressM`/`computeCurrentStandings`/`buildRaceStatusModel` helpers, gap-record/truncate/reset wiring across `onTickEnd`/respawn/AI-reset/restart, `standings`/`progressM` on the snapshot types
- `tests/circuit-race-coordinator.test.ts` - shared `line` fixture upgraded to real 10x-arc-scaled geometry; `raceHud` fake gains `updateRaceStatus`; new `describe("circuit race coordinator — live placing (D-16)")` block (7 tests covering pre-GO grid order, ranking/gap, leading, respawn truncation, AI-reset truncation, restart reset, minimap racers)

## Decisions Made

- **Test fixture arc-scale correction (Task 3):** the pre-existing `line` fixture in `tests/circuit-race-coordinator.test.ts` was a minimal two-field stub (`{ lapLengthM: 1_000_000, points: [{ arcM: 0 }] }`) sufficient only for the AI stuck detector (which only ever reads `points[0].arcM`, always 0, since `debugLineIndex` never changes in this file). Wiring `race-placement.ts` in required a fully-shaped `RacingLine`. A first attempt used a 1:1 x-to-arc scale (`arcM = x`, `lapLengthM = 40`) which broke immediately: `LEG_BACKTRACK_M` (60) exceeding the lap length made every leg's own point-list wrap around and swallow the entire line (the exact failure mode leg-restriction is meant to prevent — verified against `LEG_BACKTRACK_M` before finalizing). Corrected to `arcM = x * 10`, `lapLengthM = 400`, `checkpointArcM = [100, 200, 300, 400]`, keeping the same physical x-axis positions the existing checkpoint/course fixtures already use. Re-verified all 19 pre-existing tests in the file still pass unchanged against the new fixture (the stuck-detector's own no-progress-window behavior is provably independent of `lapLengthM`'s value when `arcM` never changes, which it doesn't in that file).
- **Mock-scene truncate uses the intended pose, not the (possibly stale) live body position:** `src/gameplay/circuit-race-coordinator.ts`'s respawn/AI-reset paths compute the gap-tracker truncation progress from `pose.x`/`pose.z` (the grid pose or `checkpointResetPose(...)` result) rather than reading `racerBody(...).translation()` — correct in production (where `scene.resetVehicle`/`fleet.resetCar` synchronously move the physics body) and also correct against the test fixture's fake scene/fleet (which do NOT move the mock body), avoiding a class of "works in tests, silently wrong once wired to real physics" bug.
- **Task 3's implementation and its (pre-existing, extended) test file share one commit:** unlike Tasks 1-2's clean RED→GREEN pairs against new files, Task 3 both modifies `circuit-race-coordinator.ts` and extends the ALREADY-EXISTING `circuit-race-coordinator.test.ts` (including a breaking fixture upgrade the old stub could not have supported) — splitting "add new D-16 tests" from "upgrade the shared fixture + wire the coordinator" into separate commits would have left an intermediate state where the file fails to even construct a coordinator (`createProgressTracker` throwing on the old stub's missing `checkpointArcM`), which is not a meaningful RED state to preserve as its own commit.

## Deviations from Plan

None — plan executed exactly as written. The test-fixture arc-scale correction above was necessary scaffolding for Task 3's own stated action ("create one `createProgressTracker(line, ...)` per racer"), not a deviation from the plan's scope.

## Issues Encountered

None.

## Known Stubs

None — every file this plan touches is fully wired (no placeholder data, no unwired components). `RaceHud.updateRaceStatus`/`Minimap.racers` are exercised end-to-end by `circuit-race-coordinator.ts`'s `refresh()`.

## Threat Flags

None beyond what this plan's own `<threat_model>` already registers (T-07-19/T-07-20/T-07-21 in `07-06-PLAN.md`) — verified directly: `grep -rn "race-placement" src/core/ai-driver.ts src/physics/ai-fleet.ts` returns no hits (standings/gaps never reach AI control), and `grep -rn "innerHTML"` across every file this plan touched returns no hits (`tests/layering.test.ts`'s repo-wide ban already covers this).

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- D-16 (live position/lap/gap status line + race clock) and D-14 (colored AI minimap dots) are both complete and fully wired end-to-end through `circuit-race-coordinator.ts`.
- Placing is structurally guarded from ever affecting AI driving (T-07-19): confirmed via source grep, not just code review.
- No blockers for 07-07.
- Carry-forward note for any future course-authoring or AI-pace session: the real `src/core/racing-line.ts`'s own `AI_PACE_CALIBRATION` and course geometry are untouched by this plan — the arc-scale fixture correction above was test-only scaffolding, not a change to production racing-line construction.

---
*Phase: 07-npc-driving-ai-circuit-racers*
*Completed: 2026-09-23*

## Self-Check: PASSED

- All created/modified files verified present on disk: `src/core/race-placement.ts`, `tests/race-placement.test.ts`, `tests/race-hud.test.ts`, `src/hud/race-hud.ts`, `src/hud/minimap.ts`, `tests/minimap.test.ts`, `src/gameplay/circuit-race-coordinator.ts`, `tests/circuit-race-coordinator.test.ts`
- All 5 task/RED-GREEN commits verified present in `git log`: `f75b161`, `79996be`, `71ab25a`, `d170ba0`, `6b26240`
