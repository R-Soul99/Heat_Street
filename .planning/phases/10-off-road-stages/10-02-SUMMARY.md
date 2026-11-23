---
phase: 10-off-road-stages
plan: 02
subsystem: core
tags: [stages, gates, persistence, race-state]
requires: []
provides:
  - "src/core/stage-run.ts: crossedGateForward, createStageRun, formatStageTime, stageSplitLine"
  - "src/core/stage-persistence.ts: per area+stage+class personal bests"
  - "RaceSnapshot.mode widened with stage, optional totalGates and label"
affects: [10-05, 10-06]
key-files:
  created: [src/core/stage-run.ts, src/core/stage-persistence.ts, tests/stage-run.test.ts, tests/stage-persistence.test.ts]
  modified: [src/core/race-state.ts]
key-decisions:
  - "Stateless plane-crossing gate test with forward-velocity check and terrain height window"
  - "PB records store cumulative splits; bests only ever improve"
requirements-completed: []
completed: 2026-11-23
---

# Phase 10 Plan 02: Stage run logic and PB persistence Summary

Ordered forward-only oriented gate crossing with respawn pose/penalty, time/split formatters, per-class personal-best storage under `heat-street.stage-bests.v1`, and an additive RaceSnapshot widening.

## Tasks

1. Stage run state machine plus RaceSnapshot widening (TDD): 7e55ce3, format fix follows in the next commit
2. Stage PB persistence (TDD): cd23372

## Deviations from Plan

None in behavior. Biome formatting required a follow-up style commit for the test file. RED and GREEN were committed together per task rather than as separate test/feat commits.

MODE-04 intentionally not marked complete (phase unfinished). `tsc --noEmit` clean; stage-run, stage-persistence, layering, race-coordinator and free-drive-coordinator tests green.

## Known Stubs

None.

## Self-Check: PASSED
