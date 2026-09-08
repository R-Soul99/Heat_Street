---
phase: 01-engine-foundation
plan: 07
subsystem: engine-loop
tags: [rapier, three.js, requestAnimationFrame, fixed-timestep, vitest]

# Dependency graph
requires:
  - phase: 01-02
    provides: SimClock (stepsFor/alpha/rebaseline/MAX_STEPS_PER_FRAME), InputSource, InputFrame
  - phase: 01-04
    provides: Rapier world, DebugScene (bodies/spinnerIndex/applyInput/preTick), TransformCache
  - phase: 01-05
    provides: WebGL renderer, createRenderer, applyAllInterpolated
  - phase: 01-06
    provides: DEBUG_ENABLED, onDebugToggle, profiler HUD (createHud)
provides:
  - src/loop.ts — the sole requestAnimationFrame driver with absolute-clock stepping, clamp, visibilitychange rebaseline, and same-frame dt-spike rebaseline
  - src/main.ts — the real composition root, replacing plan 01-01's temporary WASM bootstrap
  - tests/layering.test.ts — automated enforcement of import-direction and wall-clock layering rules
  - Human-signed-off SC2 (judder-free interpolation), SC3 (60s alt-tab resumes at 1:1), SC4 (HUD contents + ?debug gating)
affects: [phase-02-vehicle-feel-core]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Dependency injection via a single LoopDeps object literal (not constructor args/singletons) — the shape every later phase's loop wiring should extend"
    - "LoopScheduler abstraction (raf/cancelRaf/now/addVisibilityListener) makes src/loop.ts testable headlessly with a fake queue-driven scheduler, no jsdom"
    - "Reschedule next rAF frame at the TOP of the callback before any work, so a throw in render/hud never kills the loop"
    - "Stall recovery is three independent, overlapping mechanisms: MAX_STEPS_PER_FRAME clamp, visibilitychange rebaseline, and a same-frame dt-spike (>2000ms) rebaseline — because visibilitychange is not guaranteed to fire promptly (or at all) in every OS/window-manager configuration"
    - "tests/layering.test.ts as a repo-hygiene gate: comment-stripped regex scanning of source files via node:fs, asserting import-direction and wall-clock-read confinement with a non-empty-scan guard so a broken glob can't go silently green"

key-files:
  created:
    - src/loop.ts (250 lines) — startLoop, LoopDeps, LoopHandle, LoopScheduler
    - tests/loop.test.ts (427 lines)
    - tests/layering.test.ts (155 lines)
  modified:
    - src/main.ts (80 lines) — composition root rewrite

key-decisions:
  - "Stall handling needs a third, environment-agnostic mechanism beyond clamp + visibilitychange: a same-frame wall-clock dt-spike (>2000ms) detected before stepsFor runs, rebaselining immediately rather than waiting on a possibly-unreliable visibilitychange event or the slower ~31-frame saturation fallback"
  - "The render callback order is load-bearing: applyAllInterpolated before renderer.render, and the HUD callback runs after render returns so its renderer.info read is valid"
  - "A neutral InputSource (sampleForTick always returns NEUTRAL) is the deliberate Phase 1 placeholder; Phase 2 replaces it with a live source wrapped in RecordingInput"

patterns-established:
  - "LoopDeps object-literal DI, LoopScheduler test seam, reschedule-before-work, three-layer stall recovery — see tech-stack.patterns above"
  - "tests/layering.test.ts is the durable gate against architectural drift for every future phase touching src/core, src/physics, src/render or src/debug"

requirements-completed: [VEH-03]

# Metrics
duration: 48min
completed: 2026-09-08
---

# Phase 01 Plan 07: Loop Wiring & Human Verification Summary

**rAF-driven fixed-timestep loop (clamp + visibilitychange rebaseline + same-frame dt-spike rebaseline) wired through a rewritten composition root, with an automated layering gate and human-verified SC2/SC3/SC4 sign-off in a real browser.**

## Performance

- **Duration:** 48 min (19:09 first commit to 19:57 close-out; the bulk of the wall-clock span was the human browser-verification checkpoint, not active implementation)
- **Started:** 2026-09-08T19:09:33Z
- **Completed:** 2026-09-08T19:57:00Z (approx)
- **Tasks:** 3 (2 auto tasks + 1 human-verify checkpoint)
- **Files modified:** 4 (src/loop.ts, src/main.ts, tests/loop.test.ts, tests/layering.test.ts) + STATE.md/ROADMAP.md housekeeping

## Accomplishments

- `src/loop.ts` is now the single file in the repo calling `requestAnimationFrame`. It steps Rapier on an absolute clock (`SimClock.stepsFor`), captures transform-cache previous/current state in the correct order, renders exactly once per frame outside the step loop, and updates the profiler HUD after the render call so `renderer.info` reads are valid.
- Stall recovery is layered three ways: the `MAX_STEPS_PER_FRAME` clamp bounds any single frame's solver work; a `visibilitychange` listener rebaselines the clock on the hidden-to-visible transition; and (added mid-plan, see Deviations) a same-frame wall-clock dt-spike check (`dtMs > 2000ms`) rebaselines immediately, before `stepsFor` runs, independent of whether `visibilitychange` fires at all.
- `src/main.ts` was rewritten as the real composition root, deleting plan 01-01's temporary Rapier-WASM-proof bootstrap entirely. It wires `createWorld`, `createDebugScene`, `TransformCache`, `createRenderer`, `createDebugRenderScene` (passed `scene.bodies.length`/`spinnerIndex` explicitly to keep the mesh-to-body index contract visible at the call site), a neutral placeholder `InputSource`, and a `?debug`-gated profiler HUD, all driven through `startLoop`.
- `tests/layering.test.ts` automates every import-direction and wall-clock rule from 01-RESEARCH.md/01-PATTERNS.md as a permanent regression gate: `src/core/` purity, `src/physics/` never importing `three`, `src/render/` never writing simulation state, `requestAnimationFrame` confined to `src/loop.ts`, `performance.now`/`Date.now` confined to `src/loop.ts` and `src/debug/**`, and `innerHTML` banned everywhere under `src/`. Comment lines are stripped before matching and the scan asserts it found at least ten files, so a broken glob cannot make the suite trivially green.
- A human completed the full browser verification checkpoint twice: the first pass caught a real SC3 bug (see Deviations); after the fix, a full re-run of all five checks (judder at multiple refresh rates, 60-second alt-tab resume, HUD contents and `?debug` gating, resize sanity, clean console) was reported as **approved**.

## Task Commits

Each task was committed atomically:

1. **Task 1: The rAF loop with clamp, rebaseline and saturation fallback** — `56dd317` (test), `c85491a` (feat)
2. **Task 2: Composition root and the automated layering gate** — `7b6e98d` (feat)
3. **Task 3: Browser verification of SC2, SC3 and SC4** — no direct commit (verification-only task); the bug it surfaced was fixed in `eae86c7`/`28f5fa9` (see Deviations)

**Plan metadata:** (this commit) — docs: complete plan

_Note: Task 1 followed the RED→GREEN TDD cycle (failing test commit, then implementation commit)._

## Files Created/Modified

- `src/loop.ts` — the rAF driver: absolute-clock stepping, exact six-step tick ordering (captureAsPrevious → onTickBegin → applyInput → world.step → onTickEnd → captureAsCurrent), one render per frame, clamp + visibilitychange rebaseline + same-frame dt-spike rebaseline, saturation-fallback counter
- `src/main.ts` — composition root wiring world/scene/transforms/renderer/debug-render-scene/input/HUD through `startLoop`
- `tests/loop.test.ts` — headless proof of every behavior-block item via an injected `LoopScheduler`, including the discriminating dt-spike test added during the bugfix
- `tests/layering.test.ts` — automated layering/wall-clock rule enforcement, comment-stripped, non-empty-scan guarded

## Decisions Made

- Same-frame dt-spike detection (`STALL_DT_THRESHOLD_MS = 2000`) was added as a third, environment-agnostic stall-recovery mechanism because `visibilitychange` firing correctly/promptly is not guaranteed across every OS/window-manager configuration, and the ~31-frame saturation fallback alone is too slow to prevent a multi-second visible fast-forward. See Deviations for the full incident.
- The render callback ordering (interpolate then submit; HUD reads `renderer.info` only after `renderer.render` returns) is treated as load-bearing per the plan's layering rules and was verified structurally by `tests/layering.test.ts` and by the acceptance-criteria checks in Task 2.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] SC3 alt-tab sustained ~10x fast-forward after real 60s stall**
- **Found during:** Task 3, first human browser-verification pass
- **Issue:** The human reported `sim` advancing roughly 10x for a sustained ~10 real seconds after a genuine 60-second alt-tab, instead of resuming at 1:1 as the plan's SC3 acceptance criterion requires. The existing `visibilitychange` rebaseline and the ~31-frame saturation fallback both depend on `document.hidden`/`visibilitychange` firing correctly and/or promptly, which is not guaranteed in every OS/window-manager configuration; the saturation fallback alone is also too slow (~31 frames) to explain a sustained ~10s overshoot resolving on its own.
- **Fix:** Added a same-frame wall-clock dt-spike detection in `src/loop.ts`: whenever a single frame's `nowMs - lastNowMs` gap exceeds `STALL_DT_THRESHOLD_MS` (2000ms), the loop rebaselines the clock immediately, before `stepsFor` runs for that frame — independent of whether `visibilitychange` ever fires.
- **Files modified:** `src/loop.ts`, `tests/loop.test.ts`
- **Verification:** New discriminating test added to `tests/loop.test.ts` that fails without the fix and passes with it (asserts a bounded resume frame, a correctly incremented `dropped` counter, and no clamp saturation in the frames immediately following). Full automated gate re-run clean (201/201 tests, tsc clean, biome clean, build clean). Human re-ran the full five-point browser checklist against the fix and reported **approved**, including a clean 1:1 resume on the alt-tab check.
- **Committed in:** `eae86c7` (fix), `28f5fa9` (docs: STATE.md note recording the re-verification requirement)

---

**Total deviations:** 1 auto-fixed (Rule 1 — bug found via human verification, not headless testing, which is exactly what Task 3 exists to catch)
**Impact on plan:** Necessary correctness fix directly in scope of the plan's stated purpose (SC3 stall recovery). No scope creep — the fix touches only the mechanism the plan's threat register (T-01-25) already covers, adding a third layer to the existing clamp+rebaseline defense rather than introducing new architecture.

## Issues Encountered

None beyond the deviation above. The first human-verification pass did exactly what RESEARCH.md's validation table said it would: catch a real-world timing/environment interaction (`visibilitychange` reliability) that cannot be proven headlessly. The second pass, run after the fix, confirmed all five checks:

1. **SC2 judder** — spinner and settling boxes moved smoothly at every tested refresh rate; the spinner kept rotating after the boxes slept.
2. **SC3 alt-tab** — 60-second alt-tab resumed the sim clock at 1:1 immediately, with `dropped` jumping by roughly the expected backlog and no visible fast-forward.
3. **SC4 HUD** — all required lines present against budget (frame ms/16.6, physics ms/4, render ms/6, draw calls/20, triangles/10000, bodies active/total, tick/sim/dropped); toggled correctly with backtick; completely inert with no `?debug` query string.
4. **Resize sanity** — no stretch/squash, ground stayed level.
5. **Console** — no errors or warnings from Three.js or Rapier.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

Phase 1 (Engine Foundation) is now fully complete: all 7 plans executed, the fixed-timestep loop is proven both headlessly (determinism, stall recovery, layering) and in a real browser (judder-free interpolation, 1:1 alt-tab resume, complete and properly-gated HUD). Phase 2 (Vehicle Feel Core) can build directly on:
- `startLoop`'s `LoopDeps` shape for wiring a real vehicle controller in place of the neutral placeholder input source
- `tests/layering.test.ts` as a standing gate against reintroducing wall-clock reads or cross-layer writes
- The `?debug` + backtick hotkey convention (`src/debug/debug-gate.ts`) as the intended shape for the Phase 2 `lil-gui` tuning panel (per the 01-06 decision log)

No blockers carried into Phase 2 from this plan. One repo-hygiene item (`core.autocrlf`/missing `.gitattributes` causing CRLF-vs-LF biome failures on a fresh Windows checkout, logged in `deferred-items.md` during 01-04) remains explicitly deferred to phase verification rather than fixed here, since it is repo-wide and unrelated to this plan's headline artifact.

## Known Stubs

None. The neutral `InputSource` in `src/main.ts` is a documented, intentional Phase 1 placeholder (commented in-line, referencing `tests/determinism.test.ts` as its exercising test) rather than an undocumented stub — Phase 2 is the explicit owner of replacing it with a live keyboard/gamepad source wrapped in `RecordingInput`.

---
*Phase: 01-engine-foundation*
*Completed: 2026-09-08*
