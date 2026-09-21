---
phase: 05-objectives-navigation-race-modes
plan: 04
subsystem: race-composition
tags: [typescript, three, vite, vitest, navigation, hud, race-modes]

# Dependency graph
requires:
  - phase: 05-objectives-navigation-race-modes
    plan: 01
    provides: validated Juliette course sidecar and directed road navigation
  - phase: 05-objectives-navigation-race-modes
    plan: 02
    provides: checkpoint detection and P2P/Circuit race state
  - phase: 05-objectives-navigation-race-modes
    plan: 03
    provides: fixed-tick respawn/restart commands and in-place vehicle reset
provides:
  - race coordinator wired into the real Juliette composition root
  - world checkpoint pillars, north-up follow minimap, road-aware arrow, race HUD, and chime
  - sports camera activation and selectable P2P/Circuit route loading
affects: [phase-06-medals, phase-07-ai]

# Tech tracking
tech-stack:
  added: []
  patterns: [snapshot-driven HUD presentation, fixed-tick checkpoint integration, route-sidecar composition loading]

key-files:
  created:
    - src/gameplay/race-coordinator.ts
    - src/render/objective-view.ts
    - src/hud/minimap.ts
    - src/hud/navigation-arrow.ts
    - src/hud/race-hud.ts
    - src/audio/checkpoint-chime.ts
    - tests/minimap.test.ts
    - tests/race-coordinator.test.ts
  modified:
    - src/main.ts
    - src/input/live-input.ts

decisions:
  - "P2P is the default browser mode; ?mode=circuit selects the authored three-lap Circuit course."
  - "Checkpoint pillars are tall additive translucent cylinders and visited objectives are removed immediately."
  - "The minimap uses fixed-radius north-up XZ projection; only the car marker rotates and distant objectives clamp to the perimeter."
  - "Respawn retains the existing five-second race-state penalty and restart uses the existing 125ms HUD flash."

# Metrics
duration: approximately 25 min
completed: 2026-09-21
tasks_automated: 2/2

# Phase 5 Plan 4 Summary

**Fixed-tick race composition with world beacons, tactical navigation HUD, retry routing, and sports camera activation**

## Accomplishments

- Added a fixed-tick `RaceCoordinator` that reads post-step vehicle pose, detects P2P any-order or Circuit ordered checkpoint hits, retargets all presentations immediately, and routes respawn/restart commands without rebuilding the loaded world.
- Loaded and validated `juliette-ga.routes.json` beside the graph, selected P2P by default or Circuit through `?mode=circuit`, and activated the existing sports camera skin for race play.
- Added tall glowing checkpoint pillars, immediate visited-pillar removal, a bottom-left dark north-up follow minimap with rotating car marker and perimeter indicators, a road-path-derived HUD arrow, lap/target/wrong-way HUD, restart flash, and synthesized checkpoint chime.
- Exposed the existing keyboard retry latch through `LiveInputSource` so `main.ts` can pass one command source into the fixed loop without duplicate listeners.
- Corrected coordinator quaternion heading extraction to use the same XZ convention as directed route headings, keeping wrong-way hysteresis aligned with navigation.

## Task Commits

1. **Task 1: Build objective presentation and navigation HUD** - `c7a8e88`
2. **Task 2: Compose race coordinator, route loading, camera skin, and loop callbacks** - `6a251bb`
3. **Scoped formatting follow-up** - `434221a`
4. **Heading convention correction** - `4c9947f`

## Verification

- Focused presentation test: `npm test -- --run tests/minimap.test.ts` passed, 3 tests.
- Focused race verification: `npm test -- --run tests/race-coordinator.test.ts tests/race-state.test.ts tests/checkpoint-detection.test.ts tests/minimap.test.ts` passed, 4 files / 12 tests.
- `npm run typecheck` passed.
- Scoped Biome check passed for all Plan 04 source and test files.
- `npm run build` passed after the final heading correction.
- Vite HTTP smoke check passed at `http://127.0.0.1:5173/`, `http://127.0.0.1:5173/?mode=circuit`, and `/maps/juliette-ga.routes.json` with HTTP 200 responses.
- Full test suite: 1,060 passed, 3 pre-existing failures in `tests/vehicle-telemetry.test.ts` (accel, brake, and aggregate routine result). These are the known Phase 2 telemetry red state and were not modified.
- Full `npm run check`: typecheck passed; repository-wide lint stopped on pre-existing unrelated formatting/unused-variable findings before the test phase. The changed Plan 04 files pass scoped Biome.

## Browser Checkpoint

Automated browser tooling was not available in this session, so visual sign-off remains pending. Vite was started successfully and then stopped after the HTTP smoke check. Start with:

`npm run dev -- --host 127.0.0.1`

Open `http://127.0.0.1:5173/` for Point-to-Point or `http://127.0.0.1:5173/?mode=circuit` for Circuit, then verify:

1. Sports camera chrome, bottom-left dark north-up minimap, rotating car marker, and perimeter indicators are visible.
2. Driving through a checkpoint at speed, including a route crest if available, produces one chime, immediate arrow/minimap retarget, and removes the visited pillar/dot without a screen flash.
3. `P` respawns upright at the last checkpoint facing its road direction and applies the five-second penalty.
4. `R` restarts in place with a roughly 125ms flash, no reload, loading screen, or duplicated overlays.
5. Circuit rejects an out-of-order checkpoint, advances through three laps, and shows/clears WRONG WAY plus the subtle red edge tint.
6. No AI, medal thresholds, persistence, or extra course UI appears.

**Browser blocker:** requires a desktop Chromium observation and `approved` or the first failing step with console evidence.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Exposed the existing retry command source from `LiveInputSource`**
- **Found during:** Task 2 composition wiring
- **Issue:** The keyboard latch was privately created by `LiveInputSource`, so the fixed loop could not consume `KeyP`/`KeyR` without registering duplicate listeners.
- **Fix:** Added a readonly `raceCommands` property that reuses the owned keyboard latch and uses an inert latch for injected test key providers.
- **Files modified:** `src/input/live-input.ts`
- **Commit:** `6a251bb`

### Auto-fixed Bugs

**2. [Rule 1 - Bug] Corrected vehicle heading axis conversion**
- **Found during:** Final integration review
- **Issue:** The first quaternion conversion returned a heading convention inconsistent with route `atan2(deltaZ, deltaX)` values, making wrong-way detection unreliable.
- **Fix:** Extracted the local -Z forward vector and returned the matching XZ road heading.
- **Files modified:** `src/gameplay/race-coordinator.ts`
- **Commit:** `4c9947f`

## Known Stubs

None in the Plan 04 implementation files. Browser visual sign-off is pending because no browser automation tool was available.

## Threat Surface Scan

| Flag | File | Description |
|------|------|-------------|
| threat_flag: route-artifact | `src/main.ts` | Adds the route sidecar fetch, protected by named HTTP checking, `parseCourseData`, area matching, and route validation before live composition. |

HUD route-derived text uses `textContent`/direct DOM properties only; no HTML injection path was added.

## Self-Check: PASSED

- Summary file created at `.planning/phases/05-objectives-navigation-race-modes/05-04-SUMMARY.md`.
- Task commits `c7a8e88`, `6a251bb`, `434221a`, and `4c9947f` exist.
- Final typecheck, focused tests, scoped lint, and production build passed.
- Route and app HTTP smoke endpoints returned 200.

---
*Phase: 05-objectives-navigation-race-modes*
*Completed: 2026-09-21; browser sign-off pending*
