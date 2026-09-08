---
phase: 01-engine-foundation
plan: 06
subsystem: debug
tags: [vitest, url-search-params, dom, three, rapier, profiler, security]

# Dependency graph
requires:
  - 01-01 (vitest.config.ts Rapier resolver, biome.json, tsconfig strict/verbatimModuleSyntax)
  - 01-02 (src/core/frame-budget.ts — BUDGET, PHASE1_DEBUG_SCENE_TARGETS)
  - 01-04 (src/physics/world.ts — RAPIER.World shape for forEachActiveRigidBody/bodies.len())
provides:
  - "src/core/frame-stats.ts — the FrameStats contract shared between the loop and the HUD"
  - "src/debug/debug-gate.ts — parseDebugFlag, DEBUG_ENABLED, onDebugToggle; the ?debug + single-hotkey convention Phase 2's lil-gui panel reuses"
  - "src/debug/profiler-hud.ts — formatHudText (pure) and createHud (DOM), reporting every D-03 field against BUDGET with an over-budget marker"
  - "24 new Node-runnable tests proving the gate is a presence-only check and the formatter is pure and deterministic"
affects: [01-07-composition-root, phase-02-vehicle-tuning-panel]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Debug/profiling code lives entirely behind a ?debug presence check (URLSearchParams.has, never .get) with zero DOM footprint when absent"
    - "Pure formatter / DOM factory split: formatHudText takes only a plain HudInputs object so the HUD's core logic is Node-testable without a browser, WebGL context or Rapier world"
    - "DOM writes throttled to ~7Hz behind an accumulated-ms guard, never per rAF frame"
    - "textContent-only DOM overlay writes; innerHTML forbidden by grep-enforced acceptance criteria"

key-files:
  created:
    - src/core/frame-stats.ts
    - src/debug/debug-gate.ts
    - src/debug/profiler-hud.ts
    - tests/debug-gate.test.ts
    - tests/profiler-hud.test.ts
  modified: []

key-decisions:
  - "frame-stats.ts's doc comment avoids the substring \"import\" entirely (not just an import statement) — matching the same design-constraint-as-grep convention 01-PATTERNS.md established for sim-clock.ts, since the file's own acceptance criterion is checked by grepping for that substring"
  - "createHud spreads the latest FrameStats and overrides only physicsMs/renderMs with the throttle-window averages, so tick/simTimeSec/droppedTicks/steps always reflect the most recent frame while the ms figures are smoothed"
  - "formatHudText marks all four budgeted lines (frame, physics, render, draws, tris) with the same over() helper for consistency, even though the plan's behavior block only mandated physics/draws/tris as required over-budget test cases"

patterns-established:
  - "Debug-surface files are exempted from the src/core purity rule but carry an explicit comment reiterating they must never call world.step, apply impulses, or write body transforms — enforced by a grep acceptance criterion in this plan and reusable by Phase 2's tuning panel"

requirements-completed: [VEH-03]

# Metrics
duration: 6min
completed: 2026-09-08
---

# Phase 01 Plan 06: Debug Gate and Profiler HUD Summary

**A `?debug`-gated, presence-only URL flag with a single Backquote hotkey, and a profiler HUD split into a pure Node-testable formatter plus a throttled `textContent`-only DOM overlay reporting physics/render/draws/tris/bodies against the written frame budget with an over-budget marker.**

## Performance

- **Duration:** 6 min
- **Started:** 2026-09-08 18:54 (local)
- **Completed:** 2026-09-08 18:58 (local)
- **Tasks:** 2 (both TDD: RED commit then GREEN commit)
- **Files created:** 5

## Accomplishments

- **The `?debug` gate is proven to never read or render its own value.** `parseDebugFlag` is `new URLSearchParams(search).has("debug")` and nothing else — asserted true for `?debug`, `?debug=0`, and `?debug=<script>alert(1)</script>` alike, and asserted to return a `boolean` even in the script-tag case. `.get("debug")` does not appear anywhere in `src/debug/debug-gate.ts`.
- **`onDebugToggle` registers zero listeners in a normal build.** It early-returns before any `addEventListener` call when `DEBUG_ENABLED` is false, so a shipped, non-debug page adds no debug surface at all — closing T-01-21 (HUD DOM writes as a DoS vector) at the source rather than only via throttling.
- **The HUD's formatting logic is pure and fully proven in Node.** `formatHudText` takes only a plain `HudInputs` object — no DOM, no `THREE.WebGLRenderer`, no `RAPIER.World` — and 17 tests cover every D-03 field, both an over- and an under-budget variant of all four budgeted lines (frame, physics, render, draws, tris), active/total body rendering, dropped-ticks/steps visibility, the "cpu submit" render label, and byte-identical determinism for identical inputs.
- **The over-budget marker is the mechanism, not decoration.** `over(value, budget)` appends `" !"` only when `value > budget`; physics at 5.0ms against a 4.0ms budget, draw calls at 25 against a target of 20, and triangles at 20000 against a target of 10000 are each asserted to produce a marked line, with the paired under-budget case asserted unmarked — this is what satisfies "checked against a written budget" (SC4/D-04) rather than merely displaying numbers.
- **`renderer.info` read-after-render and DOM-write throttling are both encoded, not just documented.** `createHud`'s `update()` reads `renderer.info` and calls `world.forEachActiveRigidBody`/`world.bodies.len()` only after accumulating 150ms of frame time (~7Hz), with a comment recording that the read is valid only because plan 01-07's loop calls `update()` after `renderer.render()` returns.
- Full gate green on the modified tree: **173 tests passed** across 12 files (24 new), `tsc --noEmit` exit 0, `biome check .` exit 0.

## Task Commits

Each task was executed TDD-first and committed atomically at both gates:

1. **Task 1: Debug gate** — RED `b0aaa4d` (test), GREEN `7d43d29` (feat)
2. **Task 2: Profiler HUD** — RED `02b640c` (test), GREEN `5bea4b3` (feat)

No REFACTOR commits were needed.

## Files Created/Modified

- `src/core/frame-stats.ts` (26 lines) — The `FrameStats` interface (`physicsMs`, `renderMs`, `steps`, `tick`, `simTimeSec`, `droppedTicks`), type-only, zero imports, zero runtime code. Placed under `src/core/` so neither `src/loop.ts` nor `src/debug/` has to import the other.
- `src/debug/debug-gate.ts` (49 lines) — `parseDebugFlag` (pure presence check), `DEBUG_ENABLED` (evaluated once at module load, guarded with `typeof location !== "undefined"` for Node-testability), `onDebugToggle` (Backquote + `!repeat` + `!metaKey` + `!ctrlKey`, early-returns when debug is off).
- `src/debug/profiler-hud.ts` (127 lines) — `formatHudText` (pure formatter, imports `BUDGET`/`PHASE1_DEBUG_SCENE_TARGETS` from `../core/frame-budget`) and `createHud` (DOM factory: `<div>` with `pointer-events:none`/`display:none` inline style, throttled `update()`, `toggle()`, `dispose()`).
- `tests/debug-gate.test.ts` (7 tests) — all seven behavior-block cases for `parseDebugFlag`, including the script-tag value and a 1000-call no-side-effects loop.
- `tests/profiler-hud.test.ts` (17 tests) — every D-03 field present, over/under variants for all four budgeted lines, body-count formatting, dropped-ticks/steps visibility, the CPU-submit label, and determinism.

## Decisions Made

- **`frame-stats.ts`'s comment was reworded to avoid the substring `import` entirely**, not just an actual import statement — see the deviation below. This mirrors the established convention (01-PATTERNS.md, applied to `sim-clock.ts` in plan 01-04) that acceptance greps are design constraints on the source text, including comments.
- **`createHud` overrides only `physicsMs`/`renderMs` on the spread `FrameStats`** when building `HudInputs`, so the throttle-window averages replace only the two accumulated fields while `tick`, `simTimeSec`, `droppedTicks` and `steps` stay as of the most recent frame — matching the plan's stated per-field data sources exactly.
- **All four budgeted lines use the same `over()` marker**, including `frame` (against `BUDGET.frameMs`) which the plan's behavior block did not list as a mandatory over-budget test case. Consistency across every budgeted metric was judged more correct than a partial implementation, and both directions are now tested for `frame` too.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] `src/core/frame-stats.ts`'s doc comment tripped its own acceptance grep**

- **Found during:** Task 1, immediately after writing the first draft of `frame-stats.ts`, before running the acceptance grep.
- **Issue:** The acceptance criterion "`src/core/frame-stats.ts` contains no `import` statement and no runtime code" is enforced (per the established sim-clock.ts convention) by grepping for the literal substring `import` anywhere in the file, including comments. The first draft's doc comment read "Type-only module: no imports, no runtime code" and "neither should import from the other" — both contain the substring `import` and would fail a strict grep, even though there is no actual `import` statement in the file.
- **Fix:** Reworded to "Type-only module: no dependency statements, no runtime code" and "neither should depend on the other." The warnings are preserved in full; only the exact wording changed. Re-verified: `grep -c "import" src/core/frame-stats.ts` now returns 0.
- **Files modified:** `src/core/frame-stats.ts`
- **Verification:** `grep -c "import" src/core/frame-stats.ts` → 0. `tsc --noEmit` and `biome check .` both exit 0.
- **Committed in:** `7d43d29` (Task 1 GREEN commit — the file was staged in the RED commit `b0aaa4d` before this wording existed, then corrected before GREEN)

**2. [Rule 3 - Blocking] Biome import-sort and line-wrap fixes on `tests/profiler-hud.test.ts`**

- **Found during:** Task 2, at the plan's own `npx biome check .` verification step.
- **Issue:** `biome check .` flagged an unsorted import specifier list (`{ type HudInputs, formatHudText }` should be `{ formatHudText, type HudInputs }`) and one line exceeding the 100-character `lineWidth` in a test case.
- **Fix:** Ran `npx biome check --write .`, which auto-applied both fixes. No logic changed.
- **Files modified:** `tests/profiler-hud.test.ts`
- **Verification:** `npx biome check .` exits 0; `npx vitest run tests/profiler-hud.test.ts` still passes all 17 tests unchanged.
- **Committed in:** `5bea4b3` (Task 2 GREEN commit)

---

**Total deviations:** 2 auto-fixed (both Rule 3 — blocking acceptance-criteria failures caught before commit). Neither changed behavior, scope, or any exported shape.
**Impact on plan:** Every acceptance criterion and behavior-block case in both tasks is met exactly as written. No scope creep, no new dependencies.

## Issues Encountered

None beyond the two auto-fixed items above.

## Known Stubs

None. Every export (`FrameStats`, `parseDebugFlag`, `DEBUG_ENABLED`, `onDebugToggle`, `formatHudText`, `createHud`, `Hud`, `HudInputs`) is a complete, tested implementation. `createHud`'s DOM half has no automated test (by design — it needs a browser) but its `<human-check>` is explicitly deferred to plan 01-07's checkpoint, as the plan itself states.

## Threat Flags

None beyond the plan's own register, which is fully mitigated:

| Threat | Status |
|--------|--------|
| T-01-19 (query-param injection via debug gate) | `parseDebugFlag` is a presence-only boolean check; proven with a script-tag value test; `.get("debug")` absent from the file. |
| T-01-20 (DOM XSS via profiler HUD) | `el.textContent` only; `innerHTML` absent from `src/debug/profiler-hud.ts` (grep-verified). |
| T-01-21 (HUD DOM writes as a frame-budget DoS) | 150ms (~7Hz) throttle in `createHud.update()`; `pointer-events:none`; zero listeners/elements created when `DEBUG_ENABLED` is false. |
| T-01-22 (debug tooling perturbing sim timing) | No `world.step`, `applyImpulse` or `setTranslation` calls anywhere in `profiler-hud.ts` (grep-verified); the module only reads. |
| T-01-23 (stale/misattributed profiler numbers) | `renderer.info` read is documented and positioned inside `update()`, called only after `renderer.render()` per the loop contract plan 01-07 owns. |
| T-01-SC (npm installs) | No new packages. `stats-gl` deliberately not installed, matching the plan's own register. |

One repo-wide grep note, not introduced by this plan: `src/main.ts:21` contains the literal substring `innerHTML` inside a comment stating the DOM-XSS mitigation ("textContent only — never innerHTML"). This pre-dates plan 01-06 (from plan 01-01's `src/main.ts` bootstrap) and is a prohibition being stated, not a violation — the plan's own verification step 3 (`grep -rn "innerHTML" src/`) will show this one line if run repo-wide; `src/debug/` itself is clean. Out of scope for this plan (file not in `files_modified`); flagged here rather than silently fixed.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- **Plan 01-07 (composition root)** can now import `FrameStats` from `src/core/frame-stats.ts`, build it once per frame in the loop, call `onDebugToggle(() => hud.toggle())` after constructing `createHud(renderer, world)`, and call `hud.update(stats, dtMs)` once per rAF **after** `renderer.render()` returns — never before, and never inside the fixed-tick loop.
- **Carry-forward:** the `?debug` + Backquote hotkey convention in `src/debug/debug-gate.ts` is the exact shape Phase 2's `lil-gui` tuning panel should reuse (D-05) — gate its construction behind `DEBUG_ENABLED` the same way `onDebugToggle` does.
- **Carry-forward:** `formatHudText`'s `HudInputs` shape is the contract; if a future phase adds a HUD field, add it to `HudInputs` and to `formatHudText`'s output, and mirror any new budget figure in both `src/core/frame-budget.ts` and `docs/frame-budget.md` per the existing drift test.
- The one pre-existing `innerHTML` comment string in `src/main.ts` is worth a note at phase verification since it will surface in a repo-wide `grep -rn "innerHTML" src/`, even though it is the mitigation being documented, not a violation.

## Self-Check: PASSED

All 5 created files verified present on disk. All 4 commit hashes verified present in git history (`b0aaa4d`, `7d43d29`, `02b640c`, `5bea4b3`). No tracked files were deleted by any commit in this plan. Working tree apart from this plan's commits and the pre-existing untracked `screenshots/` directory and CRLF-only diffs on `src/core/sim-clock.ts`/`src/physics/debug-scene.ts` (logged in plan 01-04's summary, unrelated to this plan).

---
*Phase: 01-engine-foundation*
*Completed: 2026-09-08*
