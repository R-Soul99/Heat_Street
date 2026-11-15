---
phase: 07-npc-driving-ai-circuit-racers
plan: 07
subsystem: gameplay
tags: [circuit-race, persistence, results, ai-pace, terrain, vitest]

requires:
  - phase: 07-npc-driving-ai-circuit-racers
    provides: "07-06: race-placement.ts (progress/standings/gap), circuit-race-coordinator.ts live placing; 07-02: race-start.ts (AI_PAINTS, RACE_FIELD_SIZE)"
provides:
  - "medal-persistence.ts: optional bestFinish, raceVariantCourseId, knownProgressCourseIds, mergeRaceResult/saveRaceResult, MAX_RACE_FIELD_SIZE (same key/version)"
  - "race-placement.ts: classifyRace (final order with projected flags)"
  - "results-view.ts: buildRaceCardModel, buildRaceClassificationRows, Circuit Race card, showRaceClassification panel"
  - "circuit-race-coordinator.ts: onClassificationChanged / onRaceClassified (exactly once) / onRestart; R after finishing projects then restarts"
  - "race-laps.ts: resolveRaceLaps (?laps=N practice override, never saved); RaceHud.showNote"
  - "AI pace rework: lock-fade-compensated steer, surface-scaled accel/brake limits, AI_PACE_CALIBRATION 1.05, terrain lap harness + test"
affects: [phase 07 verification, any future AI/pursuer tuning, any future race mode persistence]

tech-stack:
  added: []
  patterns:
    - "Every progress load/save passes knownProgressCourseIds(routes.courses) so solo and race records never delete each other"
    - "AI steering divides by the lock the car will really have (steerLockScale) — the car's own speed fade stays in force"
    - "Racing-line longitudinal limits scale with surface forward grip, like cornering scales with lateral grip"
    - "Headless race calibration on the real terrain map via tests/fixtures/terrain-race-harness.ts"

key-files:
  created:
    - src/core/race-laps.ts
    - tests/race-laps.test.ts
    - tests/ai-lap-terrain.test.ts
    - tests/fixtures/terrain-race-harness.ts
  modified:
    - src/core/medal-persistence.ts
    - src/core/race-placement.ts
    - src/hud/results-view.ts
    - src/hud/race-hud.ts
    - src/gameplay/circuit-race-coordinator.ts
    - src/main.ts
    - src/core/racing-line.ts
    - src/core/ai-driver.ts
    - tests/medal-persistence.test.ts
    - tests/race-placement.test.ts
    - tests/results-view.test.ts
    - tests/circuit-race-coordinator.test.ts
    - tests/racing-line.test.ts
    - tests/ai-driver.test.ts
    - tests/ai-lap.test.ts
    - tests/ai-field.test.ts

key-decisions:
  - "Circuit Race persists under '<circuit id>.race' in the existing heat-street.medals.v1 envelope (version 1 unchanged); medal always 'none'; best time and best finish improve independently"
  - "A result shown by R-after-finish stays on screen through the restart; a DNF restart clears the panel"
  - "AI pace target moved (user decisions) from Silver to 'as fast as clean allows, beating Gold': AI_PACE_CALIBRATION = 1.05, clean to 1.10, breaks at 1.20"
  - "Racing-line car capability set to aAccel 6.5, aBrake 9, aLat 9 m/s^2, each surface-scaled; top speed 48 m/s (shipped RWD)"
  - "Pure-pursuit look-ahead 0.7 s capped at 30 m"
  - "?laps=N (1-9) is practice for that run; any count other than the course's own is never saved"

requirements-completed: [CIRC-02]

duration: ~6h45m (including three browser re-test rounds)
completed: 2026-11-15
---

# Phase 7 Plan 7: Race Finish, Persistence and Pace Summary

**A Circuit Race can now be finished, interrupted, scored and remembered: the RACE RESULT panel follows the field across the line, R after finishing projects the unfinished AI and restarts at once, and best finish plus best time persist on a Circuit Race card. The AI racers were also reworked to beat Gold pace cleanly on terrain Juliette, and `?laps=N` gives unsaved practice runs.**

## Performance

- **Started:** 2026-11-14T23:25Z
- **Completed:** 2026-11-15 (human approval after the 1-lap re-test)
- **Tasks:** 3 (2 auto + 1 human-verify), plus pace rework and `?laps=N` requested at the checkpoint
- **Files:** 4 created, 16 modified

## Accomplishments

- **Persistence (D-05/D-06):** `bestFinish` (integer 1..4, range-checked; the record is dropped otherwise) on `MedalProgressRecord`; `raceVariantCourseId`, `knownProgressCourseIds`, `mergeRaceResult`, `saveRaceResult`. Same key and version; pre-Phase-7 saves still parse; no spreading of untrusted objects.
- **Classification (D-07):** `classifyRace` orders finished racers by effective time (finish + penalty), then unfinished by progress, flagged `projected`.
- **Results view:** Circuit Race card (`BEST FINISH P2/4  BEST 8:03.12` or `BEST FINISH UNRACED`), `RACE RESULT` / `RACE RESULT  (RUNNING)` panel with the player row highlighted; textContent only.
- **Coordinator:** live classification once the player finishes, final classification exactly once (all finished, or R after the player finished), DNF restart saves nothing, respawn after finishing ignored.
- **main.ts:** `knownIds` at every load/save in both modes, race card in all modes, a single `saveRaceResult` call under the `.race` id.
- **Pace rework and `?laps=N`:** see Deviations.

## Task Commits

1. **Task 1: persistence, classification, race view models:** `e794dc0` (test), `a93fb20` (feat)
2. **Task 2: finish / interrupt / save wiring:** `e413802` (test), `dd71509` (feat)
3. **Checkpoint follow-ups:**
   - `7ca8df3`: terrain gate fix (orchestrator)
   - `000e6d6`: terrain harness and test
   - `40bbae6`: first pace pass
   - `8bdc31a`: pace rework
   - `94da79e`: `?laps=N`
4. **Task 3: human-verify:** approved after the `?mode=circuit-race&laps=1` re-test at pace 1.05.

## Measured AI Pace (terrain Juliette, medals "261104-liftwide", shipped RWD, 60 Hz, standing start)

**Targets:** Gold is 213.05 s for 3 laps (71.02 s a lap). Silver is 245.01 s for 3 laps (81.67 s a lap).

One AI car, laps 1 and 2, with the final limits (accel 6.5, brake 9, cornering 9, surface-scaled) and the steering fix:

| paceScale | Lap 1 | Lap 2 | Clean? |
|---|---|---|---|
| 1.00 | ~65.5 s | ~64.5 s | yes |
| **1.05 (shipped)** | 64.2 s | 63.0 s | yes |
| 1.10 | 62.9 s | 61.7 s | yes (last clean, ~5% headroom) |
| 1.20 | 62.7 s | 67.7 s | no: 26 m off at the dirt hairpin (arc ~1380) |
| 1.30 | 61.9 s | 59.9 s | no: 24 m off at the same hairpin |
| 1.40 | 71.7 s | 69.5 s | no: 56 m off, weaving on straights |

3-AI, 3-lap field at 1.05:

| Car | Laps | Total |
|---|---|---|
| 0 | 64.20 / 63.03 / 63.03 | 190.27 s |
| 1 | 65.02 / 63.55 / 62.98 | 191.55 s |
| 2 | 66.32 / 63.47 / 62.98 | 192.77 s |

- About 10% faster than Gold. Every car stayed within 0.6 m of the road edge with tilt under 14°, and none got stuck, used the handbrake, or pressed throttle and brake together.
- **Earlier values:**
  - 0.455 (legacy calibration): ~152.5 s a lap here.
  - 0.90 with the old 3/6/7 m/s² limits and an uncompensated steer: 82.9 s, "no challenge".
- **Legacy-map test** (`LEGACY_06_03_LINE_PARAMS`): 160.05 s against its 161.00 s target, still inside its band.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] The projected result was wiped the same frame it appeared**
- **Found during:** Task 2
- **Issue:** On R after finishing, the coordinator fires the classification and then `onRestart`. The planned `onRestart: clearCompletion` therefore erased the projected panel immediately, so UAT step 6 could never be seen.
- **Fix:** `main.ts` keeps a just-classified result on screen through that restart. The next classification replaces it, and a DNF restart clears it.
- **Files:** src/main.ts
- **Commit:** dd71509

**2. [Rule 3 - Blocking] Circuit Race was switched off on terrain maps**
- **Found during:** Task 3 (browser: no AI appeared)
- **Issue:** `isCircuitRace = wantsCircuitRace && !isTerrain`, a gate left from 04.2 when Juliette became a terrain map.
- **Fix (by the orchestrator):** lifted the gate and seated the grid poses on the heightfield (`sampleTerrainHeight + SPAWN_CLEARANCE_M`).
- **Files:** src/main.ts
- **Commit:** 7ca8df3

**3. [Rule 1 + user decisions "Fast, no catch-up", then "as fast as clean allows"] AI pace rework**
- **Found during:** Task 3 (two re-tests: "pathetic", then "no challenge at all")
- **Issue:** `AI_PACE_CALIBRATION = 0.455` was calibrated on the legacy map against the stale 06-03 Silver reference. Beyond that, two real caps held the AI back:
  - **Steering:** the AI computed steer as if full lock were always available, ignoring the car's speed-dependent lock fade (`steerLockScale`), so at speed it ran wide.
  - **Speed profile:** the accel/brake limits (3 / 6 m/s²) were well under the car's own and ignored surface grip, so the AI crawled out of corners and overcooked dirt braking zones.
- **Fix:**
  - The driver now divides by the effective lock at its current speed.
  - Accel and brake limits are scaled by surface forward grip and set to the car's capability (6.5 / 9, cornering 9 m/s²).
  - Line top speed is 48 m/s, the shipped RWD top speed, pinned by a test.
  - Look-ahead is 0.7 s capped at 30 m.
  - `AI_PACE_CALIBRATION` is 1.05, with the measured sweep documented above the constant.
  - The legacy-map tests pin their old values through `LEGACY_06_03_LINE_PARAMS`.
  - New `tests/ai-lap-terrain.test.ts` (3 AI x 3 laps faster than Gold, plus clean-lap checks) on `tests/fixtures/terrain-race-harness.ts`.
- **Unchanged:** still no catch-up, no speed edge, one fixed dial, same car and tune; the source-guard test still passes.
- **Rejected:** scaling only cornering grip as the dial (erratic, non-monotonic).
- **Files:** src/core/racing-line.ts, src/core/ai-driver.ts, tests/racing-line.test.ts, tests/ai-driver.test.ts, tests/ai-lap.test.ts, tests/ai-field.test.ts, tests/ai-lap-terrain.test.ts, tests/fixtures/terrain-race-harness.ts
- **Commits:** 000e6d6, 40bbae6, 8bdc31a

**4. [User request] `?laps=N` practice override**
- **Found during:** Task 3 ("i don't enjoy driving that same track over and over")
- **Change:** `resolveRaceLaps` accepts N from 1 to 9 and overrides the course lap count for that run. Any count other than the course's own is practice: no `saveRaceResult`, and the HUD shows "N-LAP PRACTICE - NOT SAVED" (`RaceHud.showNote`).
- **Tests:** `tests/race-laps.test.ts`
- **Files:** src/core/race-laps.ts, src/hud/race-hud.ts, src/main.ts, tests/race-laps.test.ts
- **Commit:** 94da79e

## Known Stubs

None.

## Threat Flags

None beyond the plan's register.
- T-07-22/23: bestFinish range check; named-field copy only.
- T-07-24: `knownIds` at every call site; mutual-preservation test.
- T-07-25: medal "none"; the coordinator never imports the medal system.
- T-07-26: textContent only.
- `?laps` is accepted only as a single digit 1-9 and can only stop a save, never add one.

## Notes

- The AI car's physical tune is `aiTuning`: the player's saved RWD tune from `localStorage` (`heat-street.tuning.v1`) if present, otherwise `shippedTuning("rwd")`. AI pace therefore follows a saved tune exactly as the player's car does. The racing-line and driver settings are never overridden in the browser path.

## Self-Check: PASSED

- All created files exist.
- Commits e794dc0, a93fb20, e413802, dd71509, 7ca8df3, 000e6d6, 40bbae6, 8bdc31a and 94da79e are in the log.
- `npm run check` (2429 tests) and `npm run build` pass.
