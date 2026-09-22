---
phase: 07-npc-driving-ai-circuit-racers
plan: 01
subsystem: ai
tags: [ai, pure-pursuit, racing-line, rapier, vehicle-physics, pathfinding, ngraph]

# Dependency graph
requires:
  - phase: 05-objectives-navigation-race-modes
    provides: road-graph navigation (findRoadPath, buildNavigationGraph), course/checkpoint data, race-state
  - phase: 06-medals-time-attack-loop
    provides: medal-reference splits and MEDAL_BANDS.silver used to anchor AI pace
provides:
  - "src/core/heading.ts: shared bearing/yaw conventions (headingFromRotation, yawFromTravelDirection, forwardFromYaw)"
  - "src/core/racing-line.ts: buildRacingLine (deterministic, frozen, curvature-profiled closed-loop line) + buildGridPoses (D-04 staggered grid)"
  - "src/core/ai-driver.ts: createAiDriver, a pure-pursuit InputSource over a RacingLine"
  - "src/physics/ai-fleet.ts: createAiFleet, N AI vehicles built through the unmodified createVehicle()"
  - "Headless proof (tests/ai-lap.test.ts) that one AI car laps the real Juliette circuit within +/-6% of Silver pace"
affects: [07-02, 07-03, npc-driving-ai-circuit-racers later plans that wire the AI field into Circuit Race mode]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "AiDriver is a pure InputSource (src/core/, no Rapier import) — the only channel into a vehicle is InputFrame, structurally enforcing 'no cheating'"
    - "RacingLine built once per course load, shared read-only by every AI driver instance"
    - "AI_PACE_CALIBRATION is a single fixed compile-time constant in src/core/racing-line.ts, never a runtime/live knob"

key-files:
  created:
    - src/core/heading.ts
    - src/core/racing-line.ts
    - src/core/ai-driver.ts
    - src/physics/ai-fleet.ts
    - tests/heading.test.ts
    - tests/racing-line.test.ts
    - tests/ai-driver.test.ts
    - tests/ai-lap.test.ts
  modified:
    - src/gameplay/race-coordinator.ts
    - src/core/navigation.ts

key-decisions:
  - "yawFromTravelDirection(dx,dz) = atan2(-dx,-dz), the round-trip-correct inverse of forwardFromYaw — NOT the plan's own illustrative anchor value, which had a sign typo (verified against vehicle.ts's own rotateVec and the real map's node coordinates)"
  - "AI_PACE_CALIBRATION corrected 1.0 -> 0.455 after the headless lap crashed into a roadside building at higher pace scales (ordinary pure-pursuit tracking-error growth on a fast bend, not a sign/formula bug)"
  - "ai-fleet.ts's doc comment avoids the literal 'world.step()' substring (describes the contract by behavior) to satisfy the acceptance-criteria grep expecting zero occurrences of that identifier in the file"

patterns-established:
  - "Pattern: bearing (headingFromRotation) vs yaw (yawFromTravelDirection/forwardFromYaw) conventions now live in one documented module, src/core/heading.ts, instead of being re-derived ad hoc per call site"
  - "Pattern: AI driver reads a plain AiObservation each tick (position/bearing/speed), never Rapier state directly — mirrors input-tape.ts's existing InputSource contract"

requirements-completed: [CIRC-02]

# Metrics
duration: 25min
completed: 2026-09-22
---

# Phase 7 Plan 1: NPC Driving AI Vertical Slice Summary

**One AI car, built through the unmodified `createVehicle()` call, laps the real compiled Juliette circuit in headless Rapier physics at a calibrated Silver pace (154.40s vs a 161.00s target), driven by a pure-pursuit controller over a curvature-profiled racing line derived from the road graph.**

## Performance

- **Duration:** ~25 min active work (across a session interruption/resume for a spend-limit reset)
- **Started:** 2026-09-22T20:40:00Z (approx.)
- **Completed:** 2026-09-22T21:05:00Z (approx.)
- **Tasks:** 3
- **Files modified:** 10 (8 created, 2 modified)

## Accomplishments

- Proved the phase's single highest-risk item: a pure-pursuit driver on a road-graph racing line CAN lap the real Juliette circuit cleanly at a fixed Silver pace, headlessly, against the exact same physics vehicle the player drives
- Built a deterministic, frozen `RacingLine` (`src/core/racing-line.ts`) — road-graph path per leg, width-clamped smoothing, defect-avoidance, curvature-derived and braking/accel-feasible speed profile, and a D-04 staggered grid
- Built a pure `AiDriver` (`src/core/ai-driver.ts`) and an `AiFleet` (`src/physics/ai-fleet.ts`) that construct AI cars through the exact same `createVehicle()` call as the player — no transform writes, no player-state reads (mechanically enforced by a source-guard test and layering greps)
- Consolidated the codebase's bearing vs. yaw heading conventions into one documented module (`src/core/heading.ts`), fixing a sign typo in the plan's own illustrative anchor value along the way

## Task Commits

Each task was committed atomically:

1. **Task 1: Failing end-to-end headless lap test + shared heading helpers** - `d4cc7d0` (test)
2. **Task 2: Pure racing line (road-graph path, width-clamped smoothing, speed profile, grid poses)** - `da4ebcf` (feat)
3. **Task 3: Pure-pursuit AI driver + AI fleet factory; calibrate Silver pace** - `ab164e0` (feat)

**Plan metadata:** (this commit, docs: complete plan — committed by this same agent, see below)

## Files Created/Modified

- `src/core/heading.ts` - `headingFromRotation` (moved verbatim from race-coordinator.ts), `yawFromTravelDirection`, `forwardFromYaw` — the bearing/yaw conventions the racing line and AI driver depend on
- `src/core/racing-line.ts` - `buildRacingLine` (deterministic, frozen closed-loop line), `buildGridPoses`, `curvatureFromThreePoints`, `targetSpeedAtCurvature`, `silverLapTargetSec`, `nearestLineIndex`, `pointAhead`, `AI_PACE_CALIBRATION` (=0.455), `DEFAULT_RACING_LINE_PARAMS`
- `src/core/ai-driver.ts` - `createAiDriver`, a pure-pursuit `InputSource`; `pursuitSteer`, `lookAheadDistanceM`, `defaultAiDriverParams`
- `src/physics/ai-fleet.ts` - `createAiFleet`, N AI vehicles built through `createVehicle()`, ticked by their own `AiDriver`s
- `src/core/navigation.ts` - `DEFECT_COORDINATES`/`DEFECT_CLEARANCE_M` changed from module-private to `export const` so `racing-line.ts` reuses the single list
- `src/gameplay/race-coordinator.ts` - private `headingFromRotation` deleted; now imports it from `../core/heading`
- `tests/heading.test.ts`, `tests/racing-line.test.ts`, `tests/ai-driver.test.ts`, `tests/ai-lap.test.ts` - full behavior coverage plus the headless end-to-end lap proof

## Decisions Made

- **`yawFromTravelDirection` formula corrected against the plan's own illustrative anchor.** The plan's `<behavior>` bullet gave `yawFromTravelDirection(0.985, -0.170)` as within 0.01 rad of `-1.7419882003637046` (the real `course.start.headingRad`). Verified with a throwaway Node script against `vehicle.ts`'s own `rotateVec` and the real map's node 16/19 coordinates: the round-trip-correct formula forced by `forwardFromYaw`'s own definition (`atan2(-dx, -dz)`) requires `dz = +0.170`, not `-0.170` as literally stated. The `-0.170` value is real (it matches the actual edge tangent), but plugged into the correct formula it yields `-1.40`, not `-1.74` — a ~20-degree discrepancy, not rounding noise. Kept the round-trip-correct formula (load-bearing for `buildGridPoses`'s heading computation in Task 2) and corrected the test's anchor input sign; documented in `heading.ts`'s own doc comment.
- **`AI_PACE_CALIBRATION` calibrated to 0.455, not left at the plan's starting value of 1.0.** At 1.0 and at an intermediate 0.75, the headless lap crashed into a roadside building on the real circuit's fast 19->16 leg (tarmac, not the dirt leg) — an ordinary pure-pursuit tracking-error growth on a ~180-300m-radius bend taken at 40-45 m/s, not a sign error or broken formula (confirmed by tracing the exact tick-by-tick position/steer/lookahead values and cross-referencing the real building collision geometry). Reducing the whole pace (which also shrinks `lookAheadDistanceM` proportionally at every point) gave the controller enough margin to track the corner. 0.5 and 0.47 completed cleanly but under-ran the +/-6% Silver band; 0.455 lands at 154.40s against a 161.00s target (-4.1%). `aLatMaxMs2` was deliberately left untouched — the crash was not a cornering-grip problem on the dirt leg, which is the only case the plan authorizes touching that knob for.
- **`ai-fleet.ts`'s doc comment avoids the literal `"world.step()"` substring.** The Task 3 acceptance criteria requires `grep -c "setTranslation\|setRotation\|setLinvel\|world.step" src/physics/ai-fleet.ts` to output 0. The file's own doc comment needed to explain that `tick()` never advances the physics solver — worded around the literal identifier (mirroring this codebase's established Phase 02-03 convention of describing forbidden techniques by behavior, not by the literal identifier a grep polices).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Corrected `yawFromTravelDirection`'s test anchor sign (see Decisions Made above)**
- **Found during:** Task 1 (writing `tests/heading.test.ts`)
- **Issue:** The plan's illustrative behavior-test input for `yawFromTravelDirection` had a sign that is mathematically inconsistent with the round-trip property `forwardFromYaw`/`yawFromTravelDirection` must satisfy (verified against `vehicle.ts`'s own `rotateVec` and the real map data)
- **Fix:** Implemented the round-trip-correct formula (`atan2(-dx, -dz)`) and anchored the test to the sign-corrected input, which is exactly `forwardFromYaw(-1.7419882003637046)`
- **Files modified:** `src/core/heading.ts`, `tests/heading.test.ts`
- **Verification:** `tests/heading.test.ts` round-trip test passes for representative headings including the real course-start value; `npx vitest run tests/heading.test.ts` green
- **Committed in:** `d4cc7d0` (Task 1 commit)

**2. [Rule 1 - Bug] `AI_PACE_CALIBRATION` calibrated 1.0 -> 0.455 to stop the headless lap crashing (see Decisions Made above)**
- **Found during:** Task 3 (running `tests/ai-lap.test.ts` for the first time against the real circuit)
- **Issue:** At the plan's starting calibration (1.0) the AI car ran wide off a fast tarmac corner into a roadside building and never completed the lap
- **Fix:** Iteratively reduced `AI_PACE_CALIBRATION`, confirming via full-run traces (position, speed, steer, lookahead) that the mechanism was ordinary pure-pursuit tracking-error growth, not a driver bug; landed on 0.455, which passes the +/-6% Silver-pace band with margin
- **Files modified:** `src/core/racing-line.ts` (value + doc comment recording the measured progression)
- **Verification:** `npx vitest run tests/ai-lap.test.ts` green (154.40s measured vs 161.00s target, no crash, no handbrake, quiet straights)
- **Committed in:** `ab164e0` (Task 3 commit)

**3. [Rule 3 - Blocking] Reworded `ai-fleet.ts`'s doc comment to satisfy its own acceptance-criteria grep**
- **Found during:** Task 3 verification
- **Issue:** The doc comment explaining `tick()`'s contract used the literal substring `"world.step()"` twice, which the file's own acceptance criterion (`grep -c "...world.step" ai-fleet.ts` must be 0) then flagged
- **Fix:** Reworded to describe the same contract by behavior ("never advances the physics solver itself" / "the loop's own solver step") instead of the literal identifier
- **Files modified:** `src/physics/ai-fleet.ts`
- **Verification:** `grep -c 'setTranslation\|setRotation\|setLinvel\|world.step' src/physics/ai-fleet.ts` outputs 0
- **Committed in:** `ab164e0` (Task 3 commit)

---

**Total deviations:** 3 auto-fixed (2 Rule 1 bug fixes, 1 Rule 3 blocking fix)
**Impact on plan:** All three were necessary for the plan's own acceptance criteria and success criteria to hold; no scope creep beyond what Task 3's own calibration step explicitly authorized ("fix the driver... rather than loosening test bounds").

## Issues Encountered

- The headless lap test initially failed with the AI car getting permanently stuck (near-zero speed, full steer/throttle) against a roadside building on the fast 19->16 leg. Diagnosed via tick-by-tick position/speed/frame tracing (temporarily added, then removed, debug logging in `tests/ai-lap.test.ts`) cross-referenced against `public/maps/juliette-ga.collision.json`'s real building geometry — confirmed a genuine road departure into a building close to the road edge, not a physics or detection bug. Resolved via the `AI_PACE_CALIBRATION` reduction described above.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- The load-bearing risk (pure-pursuit + road-graph racing line hitting Silver pace cleanly on the real map) is proven. Later 07-0N plans can build the 3-AI-car field, grid/countdown sequencing, avoidance, stuck/flip recovery, placements, minimap dots and the `?debug` AI overlay on top of `RacingLine`/`AiDriver`/`AiFleet` without re-deriving any of this plan's math.
- `DEFAULT_RACING_LINE_PARAMS.aLatMaxMs2` (7.0 m/s²) was never touched during calibration — worth re-checking once the dirt leg (15->19) gets real AI traffic, per the plan's own carve-out for that specific leg.
- `AiFleet.tick`'s optional `shape` parameter (avoidance/recovery override composition point, per 07-RESEARCH.md Patterns 5/6) is wired but unused by this plan — ready for the plan that adds mild avoidance and stuck/flip recovery.
- No blockers.

---
*Phase: 07-npc-driving-ai-circuit-racers*
*Completed: 2026-09-22*
