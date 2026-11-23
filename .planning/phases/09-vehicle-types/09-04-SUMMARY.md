---
phase: 09-vehicle-types
plan: 04
subsystem: tuning
tags: [rear-axle, per-wheel, ai-views]
requires: [09-02]
provides:
  - wheels.rear optional override, REAR_OVERRIDE_KEYS, WheelAxleOverride, WheelParams, wheelParams(t, i)
  - per-wheel suspension in physics and per-axle wheel radius in render
affects: [09-05]
tech-stack:
  added: []
  patterns: [optional subtree invisible when absent, explicit-key-list parse]
key-files:
  created: [tests/vehicle-axle.test.ts]
  modified: [src/core/vehicle-tuning.ts, src/debug/tuning-panel.ts, src/physics/vehicle.ts, src/render/vehicle-view.ts, src/render/ai-vehicle-view.ts, src/main.ts, tests/vehicle-tuning.test.ts, tests/tuning-persist.test.ts, tests/ai-vehicle-view.test.ts]
key-decisions:
  - "rear is not in TUNING_RANGES; it is clamped by clampRearOverride against the front-wheel ranges"
  - "Bump-stop gate computed as min over wheels of (compression - onset) so it is exactly the old expression when no rear override exists"
requirements-completed: [VEH-07]
duration: 20 min
completed: 2026-11-22
---

# Phase 9 Plan 04: Rear axle override and AI mesh fix Summary

Optional `wheels.rear` (7 fields) with `wheelParams(t, i)` drives physics and rendering per wheel; AI racer and pursuer meshes now size from `aiTuning` (D-07).

## Commits
- Task 1: 180776b rear override, wheelParams, sanitised parse, panel "Rear axle" folder
- Task 2: per-wheel physics/render and AI views from aiTuning 576da22

## Verification
`npm run check`: only the known demo-hills slope failure. Golden test green, one commit in its history (unmodified).

## Deviations from Plan
**1. [Rule 3] Panel typing**: `addNumber` generic rejects the all-optional `WheelAxleOverride`; the rear object is cast to `Record<string, number>` at the call.
**2. [Rule 3] createVehicleView takes numeric args, not tuning**: the rear radius is passed via a new `options.rearWheelRadius`.

## Known Stubs
None.

## Self-Check: PASSED
