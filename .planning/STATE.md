---
gsd_state_version: 1.0
milestone: v1.0
milestone_name: milestone
status: executing
stopped_at: Completed 01-03-PLAN.md
last_updated: "2026-09-08T13:12:48.017Z"
last_activity: 2026-09-08 -- Plan 01-03 complete (map-data ADR, road graph v1 schema, SC5 enforcement tests)
progress:
  total_phases: 8
  completed_phases: 0
  total_plans: 7
  completed_plans: 3
  percent: 43
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-09-08)

**Core value:** The driving itself must feel weighty, cinematic, and replayable — big slides, tire smoke, jumps, and a heavy rear-wheel-drive-loose feel — with medal-time chasing giving every route long-term replay value.
**Current focus:** Phase 01 — engine-foundation

## Current Position

Phase: 01 (engine-foundation) — EXECUTING
Plan: 4 of 7
Status: Ready to execute
Last activity: 2026-09-08 -- Plan 01-03 complete (map-data ADR, road graph v1 schema, SC5 enforcement tests)

Progress: [████░░░░░░] 43%

## Performance Metrics

**Velocity:**

- Total plans completed: 3
- Average duration: 10 min
- Total execution time: 0.5 hours

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 01 engine-foundation | 3 | 30 min | 10 min |

**Per-plan detail:**

| Plan | Duration | Tasks | Files |
|------|----------|-------|-------|
| Phase 01 P01 | 13 min | 3 | 11 |
| Phase 01 P02 | 6 min | 3 | 7 |
| Phase 01 P03 | 11 min | 3 | 11 |

**Recent Trend:**

- Last 5 plans: 13 min, 6 min, 11 min
- Trend: → steady (01-03 was docs-heavy; two deliberate-breakage verifications and one generated-file discovery accounted for most of the time)

*Updated after each plan completion*

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

## Deferred Items

Items acknowledged and carried forward from previous milestone close:

| Category | Item | Status | Deferred At |
|----------|------|--------|-------------|
| *(none)* | | | |

## Session Continuity

Last session: 2026-09-08T13:12:39.128Z
Stopped at: Completed 01-03-PLAN.md
Resume file: .planning/phases/01-engine-foundation/01-04-PLAN.md
