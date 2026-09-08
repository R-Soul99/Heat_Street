---
phase: 01-engine-foundation
plan: 02
subsystem: core
tags: [fixed-timestep, determinism, sim-clock, input-tape, frame-budget, vitest]

# Dependency graph
requires:
  - 01-01 (vitest.config.ts resolver, tsconfig strict + verbatimModuleSyntax, biome.json)
provides:
  - "src/core/sim-clock.ts — DT (1/60), MAX_STEPS_PER_FRAME (5) and SimClock with start/stepsFor/alpha/rebaseline/simTimeSec"
  - "src/core/input-tape.ts — InputFrame, InputSource, frozen NEUTRAL, RecordingInput, ReplayInput"
  - "src/core/frame-budget.ts — BUDGET and PHASE1_DEBUG_SCENE_TARGETS as const"
  - "docs/frame-budget.md — the written D-04 budget the profiler HUD is checked against"
  - "Proof by test that the absolute clock yields 600 ticks at 30/60/75/90/120/144/165/240 fps while the naive accumulator yields 599 at 144"
  - "Proof by test that rebaseline turns a 60s stall from a 300-tick fast-forward into an exact 60-tick resume"
  - "src/core/ purity convention (zero imports in sim-clock.ts, no DOM/wall-clock identifiers anywhere)"
affects: [01-03-physics-world, 01-04-determinism, 01-05-render-interpolation, 01-06-profiler-hud, 01-07-composition-root, phase-02-vehicle, phase-06-medals]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Absolute-clock catch-up stepping — target tick recomputed from nowMs every frame, never an accumulator, no epsilon"
    - "Run clock is tick * DT; src/core never reads wall time"
    - "Input latched per tick index, not per render frame; record/replay is the same mechanism"
    - "Doc/code mirroring enforced by a test that matches values WITH their units, not bare String(n)"
    - "Test files host the deliberately-wrong variant (naive accumulator) so the assertion is proven discriminating"
    - "Vite ?raw transform for reading repo files in tests, instead of node:fs + @types/node"

key-files:
  created:
    - src/core/sim-clock.ts
    - src/core/input-tape.ts
    - src/core/frame-budget.ts
    - docs/frame-budget.md
    - tests/sim-clock.test.ts
    - tests/input-tape.test.ts
    - tests/frame-budget.test.ts
  modified: []

key-decisions:
  - "Drift test matches `4.0 ms` not `4` — String(4.0) is `4`, which occurs in prose and dates, so the naive form the plan suggested would have stayed green through a real drift"
  - "tests/frame-budget.test.ts reads the markdown through Vite's ?raw transform rather than node:fs, avoiding an @types/node install the plan's own threat model (T-01-SC) forbids"
  - "The 60s-stall test asserts both failure and fix (300 ticks clamp-only, 60 ticks rebaselined) in the same file, so the rebaseline is proven to be doing work rather than merely present"

patterns-established:
  - "Every load-bearing constant carries an inline comment recording the measurement that justifies it (599 vs 600 ticks, 300 vs 60 ticks)"
  - "Deliberate-drift verification: break a constant, watch the test fail, restore — recorded in the commit message"
  - "Acceptance greps treated as design constraints on the source (sim-clock.ts contains no occurrence of the substring `import`, in code or comment)"

requirements-completed: [VEH-03]

# Metrics
duration: 6min
completed: 2026-09-08
---

# Phase 01 Plan 02: Simulation Core Summary

**The phase's load-bearing 120 lines: an absolute-clock fixed-timestep `SimClock` that produces identical tick counts at eight refresh rates and resumes 1:1 after a 60-second stall, a per-tick `InputTape` that makes "the same recorded input" mean something, and a frame budget that cannot drift between doc and code — all three proven by 43 Node-runnable tests.**

## Performance

- **Duration:** 6 min
- **Started:** 2026-09-08 13:46 (local)
- **Completed:** 2026-09-08 13:52 (local)
- **Tasks:** 3 (all TDD: RED commit then GREEN commit)
- **Files created:** 7

## Accomplishments

- **SC1 is now automated, not asserted.** `tests/sim-clock.test.ts` drives the clock at 30, 60, 75, 90, 120, 144, 165 and 240 fps and asserts exactly 600 ticks over 10 simulated seconds at every one of them. The test file also implements the textbook `acc += frameDelta` accumulator inline and asserts it yields **599** at 144 fps — so the invariance assertion is demonstrably discriminating rather than trivially green. Both numbers reproduce 01-RESEARCH.md's measurements exactly.
- **SC3 is now automated, and the fix is proven to be load-bearing.** The stall suite runs 1 s of 60 fps play, a 60 s gap, then 60 more frames, and asserts **300 ticks** with the clamp alone (the documented 5x fast-forward failure) and **exactly 60 ticks** once `rebaseline` is called. `droppedTicks` lands at 3600. A reader who deletes `rebaseline` gets a red test that names the failure mode.
- **The input tape closes the other half of SC1.** A 120-frame tape replayed while a real `SimClock` is driven at 30 fps and again at 144 fps yields byte-identical consumed sequences, because consumption is keyed on tick index rather than frame count. Recording is idempotent per tick (asserted by reference equality) and pads skipped ticks with `NEUTRAL` rather than shifting the tape, so a frame's array index always equals its tick index.
- **The frame budget cannot silently drift.** `tests/frame-budget.test.ts` reads `docs/frame-budget.md` and asserts every constant appears there with its unit. Verified once by deliberate breakage: changing `renderCpuMs` from 6.0 to 5.0 fails two tests (the verbatim match and the sub-slice sum), then restored.
- **`src/core/` purity holds.** `src/core/sim-clock.ts` contains zero occurrences of the substring `import` — no imports, and none in the prose either. No `performance`, `document`, `window` or `Date.now` in any core file. This is what keeps SC1 and SC3 in Node rather than in a browser checkpoint.
- Full gate green on a clean tree: `47 tests passed`, `tsc --noEmit` exit 0, `biome check .` exit 0.

## Task Commits

Each task was executed TDD-first and committed atomically at both gates:

1. **Task 1: SimClock** — RED `aebd9dc` (test), GREEN `165c4fe` (feat)
2. **Task 2: InputTape** — RED `1ccd47f` (test), GREEN `bba8953` (feat)
3. **Task 3: Frame budget mirroring** — RED `93b800a` (test), GREEN `482f25a` (feat)

No REFACTOR commits were needed — 01-RESEARCH.md's `SimClock` body was copied structurally, and the other two files were small enough to land clean.

## Files Created/Modified

- `src/core/sim-clock.ts` (93 lines) — `DT = 1/60`, `MAX_STEPS_PER_FRAME = 5`, and the `SimClock` class. `stepsFor` recomputes `elapsedSec` from `nowMs` on every call and advances while `this.tick * DT < elapsedSec`; there is no accumulator and deliberately no epsilon. `rebaseline` moves `originMs` forward and increments `droppedTicks`, never touching `tick`. `simTimeSec` is `tick * DT` and is documented as the project's only run clock. Every non-obvious line carries the measurement that justifies it.
- `src/core/input-tape.ts` (97 lines) — `InputFrame` (readonly steer/throttle/brake/handbrake), `Object.freeze`d `NEUTRAL`, the one-method `InputSource` interface, `RecordingInput` (wraps a live source, idempotent per tick, gap-fills with `NEUTRAL`, defensive `frames()` copy) and `ReplayInput` (`tape[tick]` with `NEUTRAL` out of range and for negative ticks).
- `src/core/frame-budget.ts` (40 lines) — `BUDGET` (`frameMs: 16.6`, `physicsMs: 4.0`, `renderCpuMs: 6.0`, `gameLogicMs: 2.0`, `headroomMs: 4.6`) and `PHASE1_DEBUG_SCENE_TARGETS` (`physicsMs: 0.5`, `drawCalls: 20`, `triangles: 10000`, `bodies: 20`), both `as const`.
- `docs/frame-budget.md` (81 lines, 3,589 chars) — the D-04 slice table with Budget and Basis columns, the Phase 1 debug-scene targets, and the measured Rapier step-cost table with its "most bodies sleep, so this is a floor not a worst case" caveat stated in full. Contains an explicit section stating the render figure is **CPU submit time, not GPU time** (three@0.185.1's classic `WebGLRenderer` exposes no timer query), and an explicit statement that `src/core/frame-budget.ts` mirrors this file and `tests/frame-budget.test.ts` fails on drift.
- `tests/sim-clock.test.ts` (20 tests) — invariance across eight rates, the inline naive-accumulator regression guard, run-clock identity, single-frame clamp, both stall variants, rebaseline no-rewind / accounting / no-op, alpha bounds and zero-step monotonicity.
- `tests/input-tape.test.ts` (10 tests) — `NEUTRAL` shape and frozen-ness, recorder delegation, per-tick idempotence by reference equality, gap fill, defensive snapshot, replay range handling, 120-frame round trip, and the 30-vs-144 fps consumed-sequence equality. Two test names contain the phrase `input tape`, so plan 01-04's `-t "input tape"` filter will select them.
- `tests/frame-budget.test.ts` (13 tests) — locked values, sub-slice sum via `toBeCloseTo(…, 9)`, doc length floor, all five slice labels, the CPU-submit phrasing, per-key verbatim matching and the debug-scene targets.

## Decisions Made

- **The drift test matches `"4.0 ms"`, not `"4"`.** The plan specified asserting that "the number's string form appears in the document". `String(4.0)` in JavaScript is `"4"` — and `"4"`, `"5"` and `"6"` all occur incidentally in the doc's prose, dates and step-cost table. A test written that way would pass while `renderCpuMs` had drifted to 5.0, which is exactly the failure it exists to catch. Every millisecond figure is therefore matched as `${v.toFixed(1)} ms` and every count as `< ${v}`. This was verified by deliberate breakage, which is the acceptance criterion the plan itself asked for.
- **`tests/frame-budget.test.ts` reads the doc via Vite's `?raw` transform, not `node:fs`.** See the deviation below.
- **The stall suite asserts the failure mode as well as the fix.** Keeping the 300-tick clamp-only assertion in the file means a future agent who removes `rebaseline` sees a test named "fast-forwards to 300 ticks in the first second back with the clamp alone" go green in isolation while the paired 60-tick test goes red — the diagnosis is in the test names.
- **The naive accumulator lives in the test file, never in `src/`.** It exists solely to prove the invariance assertion can fail. Putting it in `src/` would risk a future agent importing it.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] `tests/frame-budget.test.ts` reads the doc through Vite's `?raw` transform instead of `node:fs`**

- **Found during:** Task 3, at the plan's `npx tsc --noEmit` verification step.
- **Issue:** The plan's action step specifies "Read `docs/frame-budget.md` from disk with `node:fs`". The tests pass with it, but `tsc --noEmit` fails:
  `error TS2591: Cannot find name 'node:fs'. Do you need to install type definitions for node?` — `@types/node` is not installed and is not present transitively (`node_modules/@types` holds only chai, deep-eql, estree, stats.js, three, webxr). Task 3's own acceptance criteria require `tsc --noEmit` to exit 0.
- **Why not just install `@types/node`:** this plan's threat model states **T-01-SC — "No new packages installed in this plan. The plan 01-01 audit stands."** Installing a package would contradict the plan's own security register, and package installs are outside the auto-fix envelope regardless.
- **Fix:** `import doc from "../docs/frame-budget.md?raw";`. Vite's `?raw` transform is already typed by `vite/client`, which `tsconfig.json` loads via `"types": ["vite/client"]` (confirmed at `node_modules/vite/client.d.ts:249`). Vitest runs through Vite's transform pipeline, so the file is still genuinely read from disk on every run — re-verified by the deliberate-drift check after the change. A comment at the import records the reasoning and points later file-reading tests at `import.meta.glob(..., { query: "?raw", eager: true })`.
- **Files modified:** `tests/frame-budget.test.ts`
- **Verification:** `47 tests passed`, `tsc --noEmit` exit 0, `biome check .` exit 0. Deliberate drift (`renderCpuMs` 6.0 → 5.0) still fails two tests under the new import, then restored.
- **Committed in:** `482f25a` (Task 3 commit)

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** One sentence of Task 3's action step is not followed literally; the artifact contract (`tests/frame-budget.test.ts` reads `docs/frame-budget.md` and asserts every number matches `src/core/frame-budget.ts`) is fully satisfied, as is every acceptance criterion including the `tsc` one that forced the change. No scope creep, no new dependencies.

## Issues Encountered

- **The plan's suggested assertion form was weaker than the acceptance criterion it had to satisfy.** "Assert the number's string form appears in the document" and "temporarily changing `renderCpuMs` to `5.0` makes the test fail" are contradictory in JavaScript, because `String(5.0) === "5"` and `"5"` appears in the doc. Following the first instruction literally would have failed the second. Resolved by strengthening the match to include units; worth noting because the same trap applies to any future doc-mirroring test.
- **`@types/node` will be needed eventually.** 01-RESEARCH.md's structure lists `tests/docs-present.test.ts` and `tests/no-google-pipeline.test.ts` as file-I/O tests, and plan 01-07 adds an automated layering test that must scan `src/core/**`. All three can use `import.meta.glob(..., { query: "?raw", eager: true })` and stay dependency-free, which is the recommended path. If a later plan decides it genuinely needs `node:fs`, adding `@types/node` is a devDependency-only change but should be an explicit planned decision with a legitimacy audit, not an incidental one.

## Known Stubs

| Stub | File | Reason |
|------|------|--------|
| `InputFrame` axis semantics | `src/core/input-tape.ts` | Intentional and specified by the plan. Phase 1 needs only the shape and the latching mechanism to be correct and tested; Phase 2 fills in real steering/throttle/brake behaviour. The interface members are documented with their intended ranges so Phase 2 has a contract to meet. Nothing renders from this yet, so no user-visible stub exists. |

## Threat Flags

None. This plan adds pure computation with no I/O at runtime, no network, no DOM and no user-input surface. The plan's own register (T-01-04 core purity, T-01-05 budget drift, T-01-06 run-clock provenance, T-01-SC no new packages) is mitigated as written and each mitigation is asserted by a test or an acceptance grep.

## TDD Gate Compliance

All three tasks completed the RED → GREEN sequence with distinct commits, verified in git log:

| Task | RED (`test`) | GREEN (`feat`) | RED confirmed failing |
|------|--------------|----------------|------------------------|
| 1 SimClock | `aebd9dc` | `165c4fe` | Yes — `Cannot find module '../src/core/sim-clock'` |
| 2 InputTape | `1ccd47f` | `bba8953` | Yes — `Cannot find module '../src/core/input-tape'` |
| 3 Frame budget | `93b800a` | `482f25a` | Yes — `Cannot find module '../src/core/frame-budget'` |

No test passed unexpectedly during any RED phase.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- **Plan 01-03 (physics world)** can now `import { DT } from "../core/sim-clock"` and set `world.timestep = DT` rather than re-declaring `1/60`. Do not re-declare it.
- **Plan 01-04 (determinism suite)** has both halves of SC1 available: the clock and the input tape. Its `-t "input tape"` filter matches two existing tests in `tests/input-tape.test.ts`.
- **Plan 01-05 (render interpolation)** consumes `clock.alpha(nowMs)`, which is already asserted to stay in [0, 1] and to be non-decreasing across zero-step frames at 144 fps.
- **Plan 01-06 (profiler HUD)** consumes `BUDGET`, `PHASE1_DEBUG_SCENE_TARGETS`, `clock.droppedTicks` and `clock.simTimeSec`. Anything it displays as a budget must come from `src/core/frame-budget.ts` — hardcoding a threshold in the HUD would route around the drift test.
- **Plan 01-07 (composition root)** owns `requestAnimationFrame`, `performance.now()` and the `visibilitychange` → `rebaseline` wiring, plus the saturation fallback (`steps === MAX_STEPS_PER_FRAME` for more than 30 consecutive frames). None of that belongs in `src/core/`, and its automated layering test now has three files to police.
- **Carry-forward:** the tick index inside the loop's step iteration is `clock.tick - steps + s`, because `stepsFor` has already advanced `tick` past all of them. `tests/input-tape.test.ts` encodes this in `consumeAtFps` and is the reference for plans 01-05 and 01-07.

## Self-Check: PASSED

All 7 created files verified present on disk. All 6 commit hashes verified present in git history (`aebd9dc`, `165c4fe`, `1ccd47f`, `bba8953`, `93b800a`, `482f25a`). No tracked files were deleted by any commit in this plan. Working tree clean apart from the pre-existing untracked `screenshots/` directory.

---
*Phase: 01-engine-foundation*
*Completed: 2026-09-08*
