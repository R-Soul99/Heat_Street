---
phase: 02-vehicle-feel-core
plan: 01
subsystem: vehicle-tuning
tags: [config, validation, security, vitest, typescript]

# Dependency graph
requires:
  - phase: 01-engine-foundation
    provides: src/core/ purity convention (tests/layering.test.ts), src/core/frame-budget.ts doc-comment pattern, src/core/input-tape.ts factory/freeze precedent
provides:
  - "VehicleTuning interface: chassis/wheels/drive/assists groups, the shape every downstream Phase 2 plan (vehicle controller, assists, telemetry, tuning panel) compiles against"
  - "defaultTuning() factory returning 02-RESEARCH.md's measured Config A/B values"
  - "TUNING_RANGES — one shared min/max/step table for both the lil-gui panel (plan 02-09) and this file's own clamp"
  - "clampTuning / parseSavedTuning / serializeTuning — the ASVS V5 control that makes a localStorage tuning blob safe to feed into Rapier"
affects: [02-04-vehicle-controller, 02-07-telemetry, 02-09-tuning-panel]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Group keys readonly, numeric leaves mutable (deliberate deviation from frame-budget.ts's fully-frozen as const, documented inline)"
    - "defaultTuning() as a factory, never a module singleton, so telemetry and the panel never share mutable state"
    - "One TUNING_RANGES table drives both UI bounds and security clamping — no second copy of any bound"
    - "clampTuning replaces non-finite leaves with defaultTuning() values, not the range minimum, so a hostile blob cannot choose which boundary it lands on"

key-files:
  created:
    - src/core/vehicle-tuning.ts
    - tests/vehicle-tuning.test.ts
    - tests/tuning-persist.test.ts
  modified: []

key-decisions:
  - "CLAUDE.md's tuning table (mass 10, stiffness 24, frictionSlip 1000, engine force +/-30) is superseded by 02-RESEARCH.md's measured Config A/B — documented as a DEVIATION comment in vehicle-tuning.ts; the actual fix belongs in .planning/research/STACK.md since CLAUDE.md lines 28-219 are generated"
  - "serializeTuning persists the plain VehicleTuning object rather than lil-gui's own gui.save() format, because lil-gui cannot be imported under Vitest's node environment and that would make this file's own D-17 security test suite unrunnable"

requirements-completed: [VEH-01]

# Metrics
duration: 20min
completed: 2026-09-09
---

# Phase 02 Plan 01: Vehicle Tuning Contract Summary

**VehicleTuning config type with measured Config A/B defaults, a shared UI/security range table, and a hostile-blob parser that never lets a NaN reach `world.step()`**

## Performance

- **Duration:** ~20 min
- **Completed:** 2026-09-09T17:48:00Z
- **Tasks:** 2 completed
- **Files modified:** 3 (2 created source-adjacent, 1 test file added per task)

## Accomplishments
- `src/core/vehicle-tuning.ts` exports the full `VehicleTuning` contract (chassis/wheels/drive/assists), a `defaultTuning()` factory carrying the measured Config A/B values (not CLAUDE.md's stale three.js-demo table), and `TUNING_RANGES`, the single min/max/step table both the future lil-gui panel and this file's own clamp read from.
- `clampTuning` and `parseSavedTuning` land the phase's highest-value security control: a corrupt or hostile `localStorage` tuning blob is discarded or clamped to a finite, in-range `VehicleTuning`, never thrown, and never partially populated.
- Every numeric leaf of `defaultTuning()` is proven (by a recursive walk, not a hand-written list) to have a matching `TUNING_RANGES` entry satisfying `min <= default <= max`.

## Task Commits

Each task was committed atomically:

1. **Task 1: VehicleTuning shape, measured defaults, and the range table** - `6b4a8c0` (feat)
2. **Task 2: Pure clamp + hostile-blob parser for persisted tuning (D-17, T-02-01)** - `4e8f539` (feat)

_Note: vehicle-tuning.ts is shared by both tasks; each commit staged only the additions belonging to that task's scope, plus one incidental biome-reformat of tests/vehicle-tuning.test.ts folded into the Task 2 commit (formatting only, no content change)._

## Files Created/Modified
- `src/core/vehicle-tuning.ts` - VehicleTuning type, defaultTuning(), TUNING_RANGES, clampTuning, parseSavedTuning, serializeTuning, TUNING_STORAGE_KEY (429 lines)
- `tests/vehicle-tuning.test.ts` - defaults + recursive range-table coverage (8 cases)
- `tests/tuning-persist.test.ts` - hostile-blob round-trip suite, D-17 (15 cases, no case wrapped in `toThrow`)

## Decisions Made
- Kept `defaultTuning()` a factory (never a shared singleton) per 02-PATTERNS.md, so the telemetry runner (plan 02-07) and the live tuning panel (plan 02-09) never corrupt each other's state.
- Non-finite leaves in a saved blob are replaced with the matching `defaultTuning()` value, not clamped to `min` — a hostile blob cannot even choose which boundary a corrupted field lands on.
- Documented the CLAUDE.md tuning-table supersession and the `gui.save()` vs plain-object-serialization choice as inline `DEVIATION from …` comments per the repo's `vite.config.ts:4-24` convention, rather than silently diverging.

## Deviations from Plan

None — plan executed exactly as written. Both tasks' acceptance criteria are met exactly as specified (see Self-Check below); the only incidental change was a biome auto-format of the Task 1 test file, folded into the Task 2 commit since it touched no test logic.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- `VehicleTuning`, `defaultTuning`, `TUNING_RANGES`, `clampTuning`, `parseSavedTuning`, `serializeTuning`, and `TUNING_STORAGE_KEY` are all exported and ready for plan 02-04 (vehicle controller factory), 02-07 (telemetry runner), and 02-09 (lil-gui tuning panel) to import.
- `npm run check` is green (typecheck + biome + full 225-test suite across 16 files); `tests/layering.test.ts` confirms `src/core/vehicle-tuning.ts` stays pure.
- No blockers for downstream Phase 2 plans.

---
*Phase: 02-vehicle-feel-core*
*Completed: 2026-09-09*

## Self-Check: PASSED

- FOUND: src/core/vehicle-tuning.ts
- FOUND: tests/vehicle-tuning.test.ts
- FOUND: tests/tuning-persist.test.ts
- FOUND: 6b4a8c0 (Task 1 commit)
- FOUND: 4e8f539 (Task 2 commit)
