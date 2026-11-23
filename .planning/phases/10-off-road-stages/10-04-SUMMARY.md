---
phase: 10-off-road-stages
plan: 04
subsystem: gameplay
tags: [stage, coordinator, timing, gates]
requires: ["10-01", "10-02"]
provides:
  - "createStageCoordinator implementing RaceCoordinator"
  - "StageHudPort / StageGatePort structural ports for plan 10-05"
affects: [10-05, 10-08]
key-files:
  created: [src/gameplay/stage-coordinator.ts, tests/stage-coordinator.test.ts]
  modified: []
decisions:
  - "Stage medal classified at completion via classifyStageMedal; timing built with medals:false"
  - "Per-gate PB delta computed in the coordinator from personalBest.splitsSec"
  - "Respawn penalty flows only through timing.update; timing respawn hook never called"
metrics:
  tasks: 2
  completed: 2026-11-23
---

# Phase 10 Plan 04: Stage coordinator Summary

A fourth `RaceCoordinator` that drives a stage run from the fixed tick: each gate pass (and the finish) becomes a medal-timing sector with a PB-relative split flash, completion publishes once with penalty, medal and per-gate splits, and restart/respawn follow D-05. It has no road-graph or wrong-way dependency.

## Tasks

1. Tick loop, gate sectors, completion, snapshot and refresh (cef4b56)
2. Restart and respawn commands (cef4b56, same file; both tasks were implemented and tested together and committed as one)

## Deviations from Plan

- Tasks 1 and 2 share one file and one test file, so they were committed together rather than as two commits.
- The finish is recorded as a sector by the coordinator directly (StageRun reports `finished`, not a passed gate id) with checkpointId "finish".
- `showStageInfo` is called once at construction with name, PB and (when medals are active) the stage medals.

## Known Stubs

None. `StageHudPort.showStageInfo` / `flashStageSplit` and `StageGatePort.update` are implemented by plan 10-05.

## Verification

13 new tests plus race/free-drive coordinator tests pass; `tsc --noEmit` and biome clean; grep gates (no nearestRoadNode/navigation, no wall clock, no timing.respawn) are 0.

## Self-Check: PASSED
