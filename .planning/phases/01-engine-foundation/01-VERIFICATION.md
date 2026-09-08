---
phase: 01-engine-foundation
verified: 2026-09-08T21:00:00Z
status: passed
score: 5/5 must-haves verified
overrides_applied: 0
---

# Phase 1: Engine Foundation Verification Report

**Phase Goal:** The simulation runs on a timing foundation that makes every future run time trustworthy and framerate-independent
**Verified:** 2026-09-08T21:00:00Z
**Status:** passed
**Re-verification:** No — initial verification

## Note on MVP Mode Tagging

ROADMAP.md marks this phase `Mode: mvp`, but the phase goal ("The simulation runs on a
timing foundation...") is not in the `As a [role], I want to [capability], so that
[outcome].` format required by `references/verify-mvp-mode.md`
(`gsd-sdk query user-story.validate` returns `valid: false` — missing all four required
clauses). Phase 1 is pure engine infrastructure with no end-user-facing capability (no
UI, no player-visible feature) — there is no natural user story to write for "a fixed
timestep exists." This reads as a roadmap-generation artifact (every phase defaulted to
`mode: mvp`) rather than an intentional user-facing framing for this specific phase.

Per protocol this would normally cause the verifier to refuse and ask for
`/gsd mvp-phase 1`. Given the task brief already supplied five concrete, technically
verifiable Success Criteria for this phase and explicitly directed verification against
them (not a user-flow walkthrough), this report proceeds with standard goal-backward
verification against those five criteria. Flagging this for awareness rather than
blocking — recommend either clearing `mode: mvp` for infrastructure-only phases going
forward, or accepting this as a known framing gap.

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Same recorded input produces same elapsed time and end state at 30/60/144fps | ✓ VERIFIED | `tests/determinism.test.ts` — `it.each([30,60,75,90,120,144,165,240])` asserts byte-identical Rapier snapshot hashes (not float-epsilon) and identical tick counts across all 8 rates vs. a 60fps baseline; a dedicated tape-replay test drives a 30fps and 144fps run with the same varying `InputFrame` tape (`buildVaryingTape`) and asserts identical hash; a negative-control test proves the tape is load-bearing (`varying.hash !== neutral.hash`) and another proves the hash is sensitive to a single tick (`stepScene(600) !== stepScene(601)`). `SimClock.stepsFor` (`src/core/sim-clock.ts`) recomputes `elapsedSec` from an absolute `nowMs` every call rather than accumulating deltas — the exact bug class (599 vs 600 ticks at 144fps) the design doc calls out. `world.timestep` is bound to the same `DT` constant the clock steps on (`src/physics/world.ts`). All 201 tests pass (`npx vitest run`), `npx tsc --noEmit` exits 0. |
| 2 | Physics object in debug scene renders smoothly at any refresh rate (interpolated, no judder) | ✓ VERIFIED (human sign-off, per task brief) | `src/render/interpolator.ts` (`applyAllInterpolated`) is called with `clock.alpha(nowMs)` once per animation frame in `src/loop.ts`/`src/main.ts`, driven by a double-buffered `TransformCache` (capture-previous before the tick loop, capture-current after). A human completed the full browser checkpoint twice (SUMMARY 01-07) and reported "approved" on the second pass, confirming smooth motion of the spinner and settling boxes at multiple refresh rates, with the spinner still rotating after the boxes sleep (kept awake per `createDebugScene`, asserted in `tests/determinism.test.ts` "keeps the spinner awake..."). Not re-run per task instruction — only the discriminating test claim (item below) was independently re-checked. Note: code review WR-01 flags that `applyAllInterpolated` has no runtime bounds check if a future mesh/transform-cache array pair drifts out of sync (currently 1:1 and correct; non-blocking for Phase 1). |
| 3 | Alt-tabbing away for 60 seconds and returning does not teleport, explode, or fast-forward | ✓ VERIFIED | Independently re-checked per task instruction: `tests/loop.test.ts` "same-frame dt-spike rebaseline (SC3, no visibilitychange)" is present, passes, and is discriminating — it simulates a 60-second gap between two rAF callbacks with `fireVisible()` deliberately never called (proving the fix is not dependent on `visibilitychange` firing), then asserts (a) the very first frame back runs `<= MAX_STEPS_PER_FRAME` ticks, not ~3600, (b) `droppedTicks > 3000`, (c) the next 10 real-time frames advance by exactly 10 ticks (clean 1:1 resume, not a decaying catch-up), and (d) none of those 10 frames saturate the clamp. This test would fail without the `STALL_DT_THRESHOLD_MS` fix in `src/loop.ts` (commit `eae86c7`) — confirmed by reading the implementation: the dt-spike branch rebaselines the clock before `stepsFor` runs whenever a single frame's wall-clock gap exceeds 2000ms, independent of the `visibilitychange` listener and the 31-frame saturation fallback (both of which also exist and have their own dedicated passing tests). All 6 referenced commits (`56dd317`, `c85491a`, `7b6e98d`, `eae86c7`, `28f5fa9`, `5240c1a`, `27386bf`, `cf65444`) verified present in `git log --oneline --all`. Human re-ran the full alt-tab check after the fix and reported approved (SUMMARY 01-07 Deviations section). |
| 4 | Profiler HUD toggled by single key shows physics ms, draw calls, triangles, body count against a written budget | ✓ VERIFIED | `docs/frame-budget.md` is the written budget (16.6ms frame / 4.0ms physics / 6.0ms render-CPU-submit budgets, mirrored 1:1 against `src/core/frame-budget.ts` by `tests/frame-budget.test.ts`, which reads the doc from disk). `src/debug/profiler-hud.ts`'s `formatHudText` emits frame/physics/render/draws/tris/bodies/tick-sim-dropped lines, each measured value paired with its budget and marked with `!` when over (`over()` helper) — 19 tests in `tests/profiler-hud.test.ts` cover every field and both the under- and over-budget marking cases, plus a determinism/purity check. `src/debug/debug-gate.ts` gates HUD construction on `DEBUG_ENABLED` (`?debug` query param) in `src/main.ts`, and `onDebugToggle` wires the backtick key to `hud.toggle()`. Human sign-off (SUMMARY 01-07) confirmed all lines present and correctly marked in a real browser, toggle works, and the HUD is completely inert with no `?debug` param. |
| 5 | Map-data decision (OSM + open DEM, zero Google bytes) and road-graph schema recorded before any map work starts | ✓ VERIFIED | `docs/adr/0001-map-data-source.md` (Accepted, dated 2026-09-08) fixes OpenStreetMap/ODbL as the road-network source, a USGS-3DEP/Copernicus-GLO30 DEM selection rule, an explicit Google-derived-data prohibition, and formally supersedes 4 prior documents that recommended a Google Maps pipeline. `docs/schemas/road-graph.v1.md` is the normative v1 schema (nodes/edges/attribution/source/surface-enum) with a companion conforming fixture `fixtures/road-graph.sample.json`. Enforcement is automated, not just documentary: `tests/docs-present.test.ts` (existence + length floor), `tests/road-graph-schema.test.ts` (fixture conformance), and `tests/no-google-pipeline.test.ts` (comment-stripped grep gate requiring an ADR pointer near any Google-pipeline mention) all pass. No map-compilation work exists yet in the repo (correctly deferred to Phase 4). |

**Score:** 5/5 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/loop.ts` | Sole rAF driver: clamp + rebaseline + saturation fallback + single render/frame | ✓ VERIFIED | 250 lines; exports `startLoop`, `LoopDeps`, `LoopHandle`, `LoopScheduler`; contains `visibilitychange`, two `MAX_STEPS_PER_FRAME` usages, a `dtMs > STALL_DT_THRESHOLD_MS` same-frame rebaseline branch; `deps.render(` appears exactly once, outside the step loop |
| `src/main.ts` | Composition root wiring core/physics/render/debug | ✓ VERIFIED | Wires `createWorld`, `createDebugScene`, `TransformCache`, `createRenderer`, `createDebugRenderScene(scene.bodies.length, scene.spinnerIndex)`, `startLoop`, `DEBUG_ENABLED`, `onDebugToggle`; `applyAllInterpolated` precedes `renderer.render` in the render callback |
| `tests/loop.test.ts` | Headless proof of step ordering, one-render-per-frame, rebaseline, saturation | ✓ VERIFIED | 427 lines, 10 describe blocks, all passing, including the discriminating dt-spike test |
| `tests/layering.test.ts` | Automated import-direction / wall-clock rule enforcement | ✓ VERIFIED | 155 lines; scans 35 source files (well above the ≥10 guard); enforces `src/core` purity, `src/physics` no-three, `src/render` no simulation writes, single-file `requestAnimationFrame`, wall-clock confinement, no `innerHTML`; all rules pass |
| `docs/adr/0001-map-data-source.md` | Map-data source decision | ✓ VERIFIED | Present, Accepted status, supersession list, enforcement table |
| `docs/schemas/road-graph.v1.md` + `fixtures/road-graph.sample.json` | Road-graph schema + conforming sample | ✓ VERIFIED | Both present; schema test passes. Note: fixture marks all 4 nodes `junction: true` despite each having degree 2 (contradicts the schema's own definition) — flagged as WR-03 in code review, non-blocking for SC5 (the ADR/schema are correctly recorded; this is a fixture-data-quality defect for Phase 4 to inherit carefully) |
| `docs/frame-budget.md` + `src/core/frame-budget.ts` | Written, mirrored frame budget | ✓ VERIFIED | `tests/frame-budget.test.ts` cross-checks the doc against the constants |
| `src/debug/profiler-hud.ts` | Profiler HUD (pure formatter + DOM overlay) | ✓ VERIFIED | 19 passing tests on the pure `formatHudText`; DOM half exercised only by human browser checkpoint (appropriately, since it needs a real `WebGLRenderer`/`RAPIER.World`) |

### Key Link Verification

| From | To | Via | Status | Details |
|------|-----|-----|--------|---------|
| `src/loop.ts` | `src/core/sim-clock.ts` | `stepsFor`/`alpha`/`rebaseline` driven by rAF timestamp | ✓ WIRED | Confirmed by direct read of `src/loop.ts`; `stepsFor` called once per frame before the step loop, `rebaseline` called from both the visibility listener and the same-frame dt-spike branch |
| `src/loop.ts` | `document visibilitychange` | rebaseline on hidden→visible | ✓ WIRED | `createBrowserScheduler().addVisibilityListener` filters to the hidden→visible transition only; `startLoop` registers it and calls `clock.rebaseline` |
| `src/main.ts` | `src/render/debug-scene.ts` | mesh array built with body count + spinner index, interpolated each frame | ✓ WIRED | `createDebugRenderScene(scene.bodies.length, scene.spinnerIndex)` called explicitly at the wiring site; `applyAllInterpolated(meshes, transforms, alpha)` called in the render callback before `renderer.render` |
| `src/loop.ts` | HUD | `hud?.(stats, dtMs)` called after render, before next frame | ✓ WIRED | Confirmed: HUD callback fires last in `frame()`, after `deps.render()` returns, matching the `renderer.info.autoReset` timing requirement documented in `profiler-hud.ts` |

### Requirements Coverage

| Requirement | Source Plan(s) | Description | Status | Evidence |
|-------------|-----------------|--------------|--------|----------|
| VEH-03 | 01-01 through 01-07 (all) | Vehicle physics run on a fixed timestep so lap/medal times are framerate-independent | ✓ SATISFIED | Truths 1 and 3 above; `tests/determinism.test.ts` is a dedicated VEH-03/SC1 proof; `REQUIREMENTS.md` traceability row already marks VEH-03/Phase 1 as Complete, and this verification confirms that mark with direct evidence rather than trusting it |

No orphaned requirements: `REQUIREMENTS.md` maps only VEH-03 to Phase 1, and it appears in every plan's `requirements:` frontmatter for this phase.

### Anti-Patterns Found

Sourced from `.planning/phases/01-engine-foundation/01-REVIEW.md` (0 critical / 3 warning / 2 info) plus an independent debt-marker scan of `src/`, `tests/`, `docs/`, `fixtures/` (no `TBD`/`FIXME`/`XXX`/`TODO`/`HACK`/`PLACEHOLDER` markers found; the two "placeholder" hits are documented-intentional design comments, not debt markers).

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `src/render/interpolator.ts` | 90-98 | No runtime bounds check between `TransformCache` buffer length and `targets.length` in `applyAllInterpolated` | Warning | Currently correct (1:1 wiring); would fail silently (`NaN` transforms, no thrown error) if a future phase's mesh/transform-cache pair drifts out of sync. Non-blocking for Phase 1; worth fixing before Phase 2/7/8 add more bodies. |
| `src/main.ts` | 66-80 | `LoopHandle` returned by `startLoop` is discarded — `stop()`/`clock` unreachable outside test code | Warning | No teardown path exists in the running app today (fine for a page that never unloads); risks being copy-pasted forward into later composition roots. Non-blocking. |
| `fixtures/road-graph.sample.json` | 29-32 | All 4 nodes marked `junction: true` despite degree-2 topology, contradicting the schema's own definition | Warning | Contradicts the schema's normative definition in a file documented as "a conforming sample" future fixture authors may copy from. Non-blocking for SC5 (ADR + schema are correctly recorded); recommend fixing before Phase 4 copies this fixture. |
| `src/core/input-tape.ts` | 74-77 | `RecordingInput.frames()` returns a shallow copy; individual `InputFrame` objects are not frozen | Info | No current caller mutates a returned frame; a future one silently could. |
| `src/render/renderer.ts` | 102-109 | `RenderContext.dispose()` is dead code — `src/main.ts` never captures/calls it | Info | Same root cause as the `LoopHandle` warning; page has no teardown path yet. |

None of these rise to Blocker/Critical (review's own classification, independently corroborated: they are robustness/hygiene gaps in already-correct wiring, not missing or stubbed functionality).

### Independent Verification Commands Run

- `npx vitest run` → 14 files, 201/201 tests passed
- `npx tsc --noEmit` → exits 0, no output
- `npx biome check .` → "Checked 35 files in 36ms. No fixes applied."
- `npm run build` → exits 0; exactly one `.wasm` asset emitted (`dist/assets/rapier_wasm3d_bg-*.wasm`), matching the plan's acceptance criterion
- `git log --oneline --all | grep <hashes>` → all 8 commits referenced across SUMMARY.md files (56dd317, c85491a, 7b6e98d, eae86c7, 28f5fa9, 5240c1a, 27386bf, cf65444) confirmed present
- Debt-marker scan (`TBD|FIXME|XXX|TODO|HACK|PLACEHOLDER`) across `src/`, `tests/`, `docs/`, `fixtures/` → zero hits

### Human Verification Required

None. SC2 and SC3 were human-verified in-browser during plan 01-07's execution (first pass caught a real SC3 bug, fixed in `eae86c7`, second pass approved all five checks — see SUMMARY.md Deviations section). Per task instruction this was not re-run, but the discriminating regression test for the fix (`tests/loop.test.ts` "same-frame dt-spike rebaseline") was independently confirmed to exist, pass, and be discriminating. SC4's human-only elements (visual HUD contents, `?debug` gating in a real browser) were also signed off in the same checkpoint. No new items requiring human testing were identified during this verification.

### Gaps Summary

No gaps. All 5 ROADMAP success criteria are verified with direct codebase evidence (source reads, test reads, and independently re-run `vitest`/`tsc`/`biome`/`build` commands — not SUMMARY.md narrative alone). The phase's own code review found 0 critical/blocker issues; its 3 warnings and 2 info items are robustness/hygiene notes on already-functioning wiring, not missing functionality, and do not block the Phase 1 goal ("a trustworthy, framerate-independent timing foundation"). Recommend addressing WR-01 (interpolator bounds check) and WR-03 (fixture junction flags) early in Phase 2/Phase 4 respectively, since both are explicitly called out as risks for future phases to inherit, but neither invalidates what Phase 1 delivered.

---

_Verified: 2026-09-08T21:00:00Z_
_Verifier: Claude (gsd-verifier)_
