---
phase: 09-vehicle-types
plan: 08
subsystem: physics
tags: [spike, monster-truck, heavy-vehicle, rapier-stability]
requires: [09-07]
provides:
  - .planning/plans-ahead/03-monster-spike-result.md (verdict, recommended ranges/values, spawn clearance)
  - throwaway branch car/monster-spike (kept, never merged)
key-files:
  created: [.planning/plans-ahead/03-monster-spike-result.md]
key-decisions:
  - "User decision: Approved (option 1) - continue with 09-09 using Recommended values"
requirements-completed: []
metrics:
  completed: 2026-11-22
---

# Phase 9 Plan 08: Monster/Truck Spike Summary

Headless spike showing Rapier's raycast vehicle holds a 4500 kg monster on 0.9 m wheels (and a heavy truck) stably with re-derived suspension values; result recorded with recommended ranges, values and spawn clearance.

## Tasks

| Task | Name | Commit |
|---|---|---|
| 1 | Spike harness and measurements | d85b086 on car/monster-spike (tests/monster-spike.test.ts only) |
| 2 | Spike result written | ed6063f on car/vehicle-types |
| 3 | User reads result (D-10 checkpoint) | decision recorded below |

## User Decision (verbatim)

"Approved"

Interpretation: option 1 of the result file's "Decision needed" - continue with plan 09-09 using the Recommended values as written. Open items carried into 09-09:
- Truck inside-wheel lift at 20 m/s still to be found.
- Monster top speed ~35.8 m/s vs D5 28 m/s accepted as-is for now.
- Per-class spawn clearance (monster 2.1 m, truck 1.3 m vs shared 0.6 m) to be verified on a real map.
- No arcade-assist layer or Jolt evaluation requested (D-10).

## Deviations from Plan

None - plan executed as written. The `car/monster-spike` branch was kept (plan does not call for deletion). No shipped code changed.

## Notes

- VEH-07 is the requirement this spike de-risks; full class delivery is in 09-09, so it is intentionally not marked complete here; it remains open for 09-09 onward.

## Self-Check: PASSED
