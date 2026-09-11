---
phase: 02-vehicle-feel-core
plan: 09
subsystem: ui
tags: [lil-gui, dev-tooling, telemetry, tuning-panel, vehicle-tuning, debug-gate]

# Dependency graph
requires:
  - phase: 02-vehicle-feel-core
    provides: "VehicleTuning/TUNING_RANGES (02-01), onDebugKey (02-05), runAllRoutines/RoutineResult (02-07), the composition root and setTuning (02-08)"
provides:
  - "src/debug/tuning-panel.ts — a lil-gui panel over every numeric leaf of VehicleTuning, with localStorage persistence and a two-click reset"
  - "src/debug/telemetry-hud.ts — an in-browser panel that runs the identical runAllRoutines the Vitest suite runs, against the live tuning object"
  - "src/main.ts wiring both panels behind DEBUG_ENABLED on KeyG/KeyT"
affects: [02-10, phase-03-ui-polish]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Gate-free dev-tool factories (createTuningPanel/createTelemetryHud), matching createHud's convention — DEBUG_ENABLED is checked only at the composition root"
    - "Two-runner telemetry: the same runAllRoutines/runRoutine code path serves both the Vitest CI gate and the live browser panel, parameterised only by which VehicleTuning object is passed in"
    - "Pure formatter / DOM factory split for a dev panel (formatTelemetryRow + formatTelemetrySummary vs createTelemetryHud), mirroring profiler-hud.ts's formatHudText split"

key-files:
  created:
    - src/debug/tuning-panel.ts
    - src/debug/telemetry-hud.ts
    - tests/telemetry-hud.test.ts
  modified:
    - src/main.ts

key-decisions:
  - "Resolved the RESEARCH.md/UI-SPEC.md vs shipped-convention gating conflict in favour of the shipped convention: createTuningPanel and createTelemetryHud are gate-free, DEBUG_ENABLED is checked only in src/main.ts"
  - "Wheels/drive/assists knobs bind on .onChange (live); chassis mass/comOffset/halfExtents bind on .onFinishChange (Pitfall 10 — setAdditionalMassProperties invalidates cached inertia mid-drag)"
  - "Reset writes defaultTuning() onto the existing nested objects in place (never replaces tuning.chassis/wheels/etc. wholesale), because lil-gui controllers hold references into those exact objects"
  - "Telemetry panel's Routine label mapping is a separate id->label table, not RoutineResult.label, per 02-UI-SPEC.md's shorter panel copy contract"

patterns-established:
  - "Dev-tool folder ordering as a literal contract in source (Chassis -> Suspension -> Grip -> Drive -> Assists -> Telemetry), asserted in comments so folders never get reordered by a future edit"

requirements-completed: [VEH-01, VEH-04, NAV-01]

# Metrics
duration: 20min
completed: 2026-09-11
---

# Phase 02 Plan 09: Vehicle Tuning + Telemetry Dev Panels Summary

**lil-gui vehicle tuning panel (every VehicleTuning knob, TUNING_RANGES-bounded, localStorage-persisted, two-click reset) plus an in-browser telemetry panel that runs the exact same runAllRoutines the Vitest suite runs against the live tuning — both gated behind `?debug` on KeyG/KeyT.**

## Performance

- **Duration:** ~20 min
- **Started:** 2026-09-11T20:49:00Z (approx, worktree setup + context read)
- **Completed:** 2026-09-11T21:09:25Z
- **Tasks:** 3
- **Files modified:** 4 (3 created, 1 modified)

## Accomplishments
- Every numeric leaf of `VehicleTuning` is live-adjustable in a `?debug` lil-gui panel, bounded by `TUNING_RANGES` (never an inline literal), in the fixed six-folder order Chassis -> Suspension -> Grip -> Drive -> Assists -> Telemetry
- Tuning persists under `heat-street.tuning.v1` on every change, and a two-click "Reset to defaults" restores `defaultTuning()` in place with no modal dialog
- A `KeyT` telemetry panel runs `runAllRoutines(getTuning())` against the LIVE tuning object and prints per-routine PASS/FAIL as both colour and the literal word
- Both panels wired into `src/main.ts` behind `DEBUG_ENABLED`, with zero panel construction and zero listeners in a normal build

## Task Commits

Each task was committed atomically:

1. **Task 1: lil-gui tuning panel with persistence and reset (D-15, D-16, D-17)** - `533f919` (feat)
2. **Task 2: In-browser telemetry results panel (SC5's live-verification half)** - `ec292ac` (feat)
3. **Task 3: Wire both panels into the composition root behind ?debug** - `da59d49` (feat)

## Files Created/Modified
- `src/debug/tuning-panel.ts` - lil-gui panel: `createTuningPanel(tuning, onApply, storage?)`, `TuningPanel`, `TuningStorage`
- `src/debug/telemetry-hud.ts` - telemetry panel: `createTelemetryHud`, `TelemetryHud`, `formatTelemetryRow`, `formatTelemetrySummary`
- `tests/telemetry-hud.test.ts` - Node tests for the pure formatter half (6 cases)
- `src/main.ts` - constructs both panels behind `DEBUG_ENABLED`, wires `KeyG`/`KeyT` via `onDebugKey`

## Decisions Made
- Followed the shipped `createHud` convention (gate-free factory, gating lives in `main.ts`) over the RESEARCH.md/UI-SPEC.md example's `if (!DEBUG_ENABLED) return null` — documented as a RESOLVED CONVENTION CONFLICT comment in `tuning-panel.ts` so a future editor doesn't "fix" it back
- Split `VehicleTuning.wheels` across two folders (Suspension: geometry + suspension physics; Grip: frictionSlip/frontSideFriction/rearSideFriction) since the plan's own folder contract names both but `VehicleTuning` has no such split at the data level
- Added an inert "Telemetry" folder (a disabled pointer control) to satisfy the fixed six-folder order contract, since the telemetry panel itself is a separate DOM surface (`KeyT`) rather than a set of lil-gui controls
- Telemetry panel's "Running…" state is written synchronously immediately before the (currently synchronous, ~100-300ms) `runAllRoutines` call; documented as a placeholder for a future async refactor rather than a real perceivable frame today

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Installed npm dependencies in the worktree**
- **Found during:** Task 1 setup
- **Issue:** This worktree had no `node_modules/` (fresh worktree checkout), so `npm run typecheck`/`vitest` could not run at all
- **Fix:** Ran `npm install` against the existing `package-lock.json` — no dependency versions changed, `package.json`/`package-lock.json` diff is empty
- **Files modified:** none (node_modules is gitignored)
- **Verification:** `npm run typecheck` and `npx vitest run` both execute afterward
- **Committed in:** N/A (no repo files changed)

**2. [Rule 3 - Blocking] Reset stale worktree branch to the expected phase base**
- **Found during:** Startup worktree branch check
- **Issue:** The worktree's branch (`worktree-agent-a19426ba10e9b5d9e`) was based on an older commit that predated all of plan 02-01 through 02-08's execution history (a stale spawn point), not the expected `2ccaaee` tip
- **Fix:** Verified `2ccaaee` was reachable on `main`/`origin/main`, confirmed a clean working tree, and ran `git reset --hard 2ccaaee7ebad326efc94f178e91956b6020bd0a8` per the worktree_branch_check protocol
- **Files modified:** none (branch pointer only)
- **Verification:** `git log --oneline` shows the full 02-01..02-08 history; `git rev-parse HEAD` matches the expected commit
- **Committed in:** N/A (no new commit; branch reset only)

---

**Total deviations:** 2 auto-fixed (both Rule 3 — blocking, environment setup only; no application code deviations)
**Impact on plan:** Both fixes were prerequisites to running any verification at all. No scope creep — the plan's own tasks were executed exactly as written.

## Issues Encountered

**`npm run check` reports pre-existing CRLF formatting errors unrelated to this plan.** Biome's formatter wants LF line endings; this Windows worktree checks files out as CRLF because `core.autocrlf=true` is set locally. The committed git blobs are LF (verified via `git show HEAD~2:src/main.ts`, which is `\n`-terminated) — autocrlf will renormalize back to LF on commit regardless of the working-tree line endings, so this is purely a local-checkout artifact, not a real formatting regression. It affects every pre-existing file in the repo identically (`src/loop.ts`, `src/core/*.ts`, `tsconfig.json`, `vite.config.ts`, etc. — none of which this plan touched), confirming it predates this plan's work. Per the executor's scope boundary, this was not "fixed" (doing so would touch dozens of unrelated files). Verification instead used the plan's individually-named commands directly:
- `npm run typecheck` — passes
- `npx vitest run` (full suite, 22 files / 330 tests) — passes
- `npm run build` — passes (`dist/` emitted, one pre-existing chunk-size warning unrelated to this plan)
- `npx biome check` scoped to only the files this plan created/touched — clean after one auto-fix (import ordering)

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- SC5's two halves are both live: the tuning panel makes every handling knob retunable with no code edit, and the telemetry panel re-verifies against the identical scripted track the CI gate uses.
- Plan 02-10 (the manual tuning session / browser checkpoint) can now open `?debug`, drag sliders, and press "Run telemetry suite" to see live pass/fail against whatever values are currently on the car.
- No blockers. The one open item is purely cosmetic: the telemetry panel's fixed `top:400px` offset is a documented approximation of "below the tuning panel" rather than a computed one — worth a glance during 02-10's visual pass in case a very tall (many-folder) `#lil-gui` panel overlaps it at common window heights.

---
*Phase: 02-vehicle-feel-core*
*Completed: 2026-09-11*

## Self-Check: PASSED

- FOUND: src/debug/tuning-panel.ts
- FOUND: src/debug/telemetry-hud.ts
- FOUND: tests/telemetry-hud.test.ts
- FOUND: src/main.ts
- FOUND: .planning/phases/02-vehicle-feel-core/02-09-SUMMARY.md
- FOUND: commit 533f919
- FOUND: commit ec292ac
- FOUND: commit da59d49
