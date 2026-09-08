---
gsd_state_version: 1.0
milestone: v1.0
milestone_name: milestone
status: planning
stopped_at: Phase 02 UI-SPEC approved
last_updated: "2026-09-08T23:11:05.431Z"
last_activity: 2026-09-08
progress:
  total_phases: 8
  completed_phases: 1
  total_plans: 7
  completed_plans: 7
  percent: 13
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-09-08)

**Core value:** The driving itself must feel weighty, cinematic, and replayable — big slides, tire smoke, jumps, and a heavy rear-wheel-drive-loose feel — with medal-time chasing giving every route long-term replay value.
**Current focus:** Phase 2 — vehicle feel core

## Current Position

Phase: 2
Plan: Not started
Status: Ready to plan
Last activity: 2026-09-08

Progress: [██████████] 100%

## Performance Metrics

**Velocity:**

- Total plans completed: 14
- Average duration: 15 min
- Total execution time: 1.7 hours

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 01 engine-foundation | 7 | 103 min | 15 min |
| 01 | 7 | - | - |

**Per-plan detail:**

| Plan | Duration | Tasks | Files |
|------|----------|-------|-------|
| Phase 01 P01 | 13 min | 3 | 11 |
| Phase 01 P02 | 6 min | 3 | 7 |
| Phase 01 P03 | 11 min | 3 | 11 |
| Phase 01 P04 | 12 min | 3 | 5 |
| Phase 01 P05 | 7 min | 3 | 4 |
| Phase 01 P06 | 6 min | 2 | 5 |
| Phase 01 P07 | 48 min | 3 | 4 |

**Recent Trend:**

- Last 5 plans: 12 min, 7 min, 6 min, 48 min
- Trend: → P07's 48 min is dominated by wall-clock wait on the two-pass human browser-verification checkpoint (SC2/SC3/SC4), not active implementation time — the bug found on the first pass was fixed and re-verified within the same session. Phase 1 complete: 7/7 plans, 103 min total.

*Updated after each plan completion*

> Note: `gsd-sdk query state.record-metric` appends its row AFTER this line rather
> than into the Per-plan detail table above. Move it up and refresh the velocity
> rollup by hand after each plan, as was done for P04, P05, P06 and P07.

## Accumulated Context

### Decisions

Decisions are logged in PROJECT.md Key Decisions table.
Recent decisions affecting current work:

- [Roadmap]: Map data source is OpenStreetMap + open DEM — no Google-sourced bytes may enter the shipped pipeline (P0 legal decision, must be frozen in Phase 1)
- [Roadmap]: Fixed-timestep physics from Phase 1, non-negotiable — variable timestep would invalidate the entire medal system
- [Roadmap]: Helicopter camera is prototyped in Phase 3 with an explicit go/no-go "does 100mph read as fast?" gate, with a low chase-cam fallback kept alive
- [Roadmap]: v1 scope frozen to one area, three modes (P2P/Circuit/Getaway), one car; Survival, area unlock and heat tiers 4-5 deferred to v2
- [Phase 01-01]: optimizeDeps.exclude for @dimforge/rapier3d is REQUIRED in vite.config.ts — Vite's esbuild pre-bundler duplicates the wasm-bindgen glue and breaks Rapier at runtime in dev; do not remove it
- [Phase 01-01]: All dependencies pinned to exact version literals (no caret/tilde) — a three or Rapier patch bump can alter solver behaviour and invalidate recorded medal times
- [Phase 01-02]: The run clock is SimClock.simTimeSec (tick * DT) and nothing else — src/core/ contains no wall-clock read, so medal times are reproducible by construction
- [Phase 01-02]: Fixed-step target is recomputed absolutely from nowMs every frame — an acc += frameDelta accumulator loses a tick at 144fps (599 vs 600, measured and now regression-tested) and must never be reintroduced
- [Phase 01-02]: Alt-tab handling is clamp AND rebaseline, not either/or — clamp alone fast-forwards 300 ticks into the first second back instead of 60; both numbers are asserted in tests/sim-clock.test.ts
- [Phase 01-02]: Doc/code mirroring tests must match values WITH their units ("4.0 ms", not "4") — String(4.0) is "4", which occurs incidentally in prose, so the naive form stays green through real drift
- [Phase 01-02]: Tests read repo files via Vite's ?raw transform rather than node:fs — @types/node is not installed and the phase threat model forbids new packages; later file-scanning tests should use import.meta.glob with query ?raw
- [Phase 01-03]: Map data is OpenStreetMap under ODbL 1.0 plus an open DEM (USGS 3DEP inside the US, Copernicus GLO-30 globally) — frozen in docs/adr/0001-map-data-source.md, which supersedes the design doc, CLAUDE.md and STACK.md
- [Phase 01-03]: Compiled *.map.json artifacts ship under ODbL 1.0 (LICENSE-MAPDATA) — the free safe path on the open Derivative Database question; compiled .glb is treated as a Produced Work
- [Phase 01-03]: surface is a closed six-value game enum parsed FROM docs/schemas/road-graph.v1.md by the test, not hardcoded — the Phase 4 compiler owns the OSM mapping and must fail the BUILD on an unmapped value
- [Phase 01-03]: CLAUDE.md lines 28-219 are GENERATED from .planning/research/STACK.md — always amend the source, or a regeneration silently reverts the edit
- [Phase 01-03]: Repo-scanning tests use import.meta.glob with an INLINE query ?raw eager literal — options must not be a named const, keys are directory-relative, and the importing module is excluded from its own glob
- [Phase 01-04]: VEH-03 is proven by byte-equality of world.takeSnapshot() bytes (FNV-1a fingerprint), never by comparing positions with an epsilon — a float comparison passes while islands, sleeping flags and contact caches have already diverged
- [Phase 01-04]: Rapier's Real is f32, so world.timestep reads back as Math.fround(DT) = 0.01666666753590107, not the f64 DT — assert against Math.fround(DT); it is a one-time constant rounding, not an accumulating error, and the run clock stays tick * DT
- [Phase 01-04]: The SC2 always-moving body is a kinematicPositionBased spinner rotated by an angle that is a pure function of the tick index (PATTERNS.md R2) — the six dynamic boxes all sleep by step 600, measured
- [Phase 01-04]: TransformCache exposes raw stride-7 Float64Array prev/cur buffers and never applies transforms to meshes, keeping src/physics/ free of three — src/render/interpolator.ts in plan 01-05 owns the lerp/slerp
- [Phase 01-05]: Interpolation is a free function in src/render/interpolator.ts reading TransformCache's raw buffers, not a TransformCache method — closes the placement question 01-PATTERNS.md left open and keeps src/physics/ free of three
- [Phase 01-05]: The short-arc slerp guard drives cur from the NEGATED quaternion — a plain 175-degree rotation is short-way under both slerp and a naive lerp, so that test would have been decorative; measured 87.5 vs exactly 92.5 degrees
- [Phase 01-05]: Never compare quaternions with angleTo when the expected angle is near zero — it is 2*acos(dot) and acos is ill-conditioned there, so one-ULP-apart quaternions report ~3e-8 rad; compare components instead
- [Phase 01-05]: renderer.info.autoReset stays at its default true, so the 01-06 HUD must read renderer.info AFTER the draw; it must become false with a manual reset() if any later phase draws more than once per frame
- [Phase 01-05]: The render mesh array order is a contract with DebugScene.bodies and TransformCache — createDebugRenderScene takes bodyCount and spinnerIndex as parameters and range-validates them, and the ground is excluded from meshes (T-01-16)
- [Phase 01-06]: The ?debug + Backquote hotkey convention in src/debug/debug-gate.ts is the exact shape Phase 2's lil-gui tuning panel should reuse
- [Phase 01-06]: Acceptance greps are design constraints on comments too — frame-stats.ts's doc comment avoids the literal substring "import" entirely, not just an actual import statement
- [Phase 01-07]: Stall handling needs a third, environment-agnostic mechanism beyond clamp + visibilitychange -- a same-frame wall-clock dt-spike (>2000ms) rebaselines immediately, before stepsFor runs, because visibilitychange is not guaranteed to fire promptly (or at all) in every OS/window-manager configuration

### Pending Todos

[From .planning/todos/pending/ — ideas captured during sessions]

None yet.

### Blockers/Concerns

[Issues that affect future work]

- REQUIREMENTS.md previously stated 29 v1 requirements; the actual traceability list is 30. Corrected during roadmap creation.
- Open risk (Phase 2): whether Rapier's raycast vehicle can reach the "arcade-realistic hybrid" feel at all — flagged as a spike, not an assumption
- Open question (Phase 4): whether the existing extraction tool already emits usable road-graph topology, or whether the map-compiler must build it from scratch
- [01-01] 01-RESEARCH.md 'State of the Art' claims Vite 8.2.2 pre-bundles Rapier correctly — disproven at runtime (dev-only TypeError). That claim and 01-01-PLAN.md's 'no optimizeDeps.exclude anywhere' success criterion should be corrected at phase verification
- [01-03] Six Google-Maps-pipeline references remain in .planning/ (research/STACK.md 92/212/300, research/ARCHITECTURE.md 367, research/FEATURES.md 73/247, PROJECT.md 75) — deliberately outside the decided grep scope, covered by the STACK.md supersession banner. Upgrade path if ever needed is PATTERNS.md R1 option (b).
- [01-06] src/main.ts:21 contains the literal substring "innerHTML" inside a comment stating the DOM-XSS mitigation ("textContent only — never innerHTML"), pre-dating this plan. A repo-wide `grep -rn "innerHTML" src/` (the plan's own verification step 3) will surface this one line even though it documents a prohibition rather than a violation; src/debug/ itself is clean. Worth a note at phase verification.

## Deferred Items

Items acknowledged and carried forward from previous milestone close:

| Category | Item | Status | Deferred At |
|----------|------|--------|-------------|
| *(none)* | | | |

## Session Continuity

Last session: 2026-09-08T23:11:05.422Z
Stopped at: Phase 02 UI-SPEC approved
Resume file: .planning/phases/02-vehicle-feel-core/02-UI-SPEC.md
