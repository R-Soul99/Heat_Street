---
created: 2026-09-20T16:51:31.140Z
title: Support configurable drivetrain type per car class
area: physics
files:
  - src/physics/vehicle.ts (engine-force application, ~line 347-353)
  - src/core/vehicle-tuning.ts (engineForcePerRearWheel and related drive fields)
---

## Problem

The vehicle physics currently hardcode rear-wheel drive: engine force is only ever applied to
`RL`/`RR` (`vc.setWheelEngineForce(RL, engineForce)` / `(RR, engineForce)` in
`src/physics/vehicle.ts`), and the tuning field itself is literally named
`engineForcePerRearWheel` (`src/core/vehicle-tuning.ts`) rather than something drivetrain-neutral.
The authored power-oversteer/handbrake mechanic also specifically manipulates rear-wheel side
friction, assuming power goes to the rear (RWD's characteristic slide-under-power feel).

This is correct and intentional for v1 — the project's core value is explicitly a "heavy
rear-wheel-drive-loose feel" (PROJECT.md) and v1 is scoped to one car. But the developer has
confirmed that later milestones will introduce other car classes, and at least some of those
will need front-wheel drive (and possibly all-wheel drive) simulated properly — not just a
tuning-panel slider, since FWD's characteristic failure mode under power is understeer, not
oversteer, which the current oversteer mechanic doesn't model at all.

## Solution

TBD — likely needs, when this becomes relevant:
- A drivetrain-type field per car (RWD/FWD/AWD), read at vehicle construction, that decides
  which wheel pair(s) receive `setWheelEngineForce`.
- Rethinking the "authored oversteer term" (currently rear-only) so it degrades sensibly or is
  replaced by an FWD-appropriate power-on-understeer term when drivetrain is FWD (and some
  front/rear split for AWD).
- `engineForcePerRearWheel` and other rear-drive-specific field names in `VehicleTuning` will
  need renaming/restructuring to be drivetrain-neutral, or split into a per-drivetrain tuning
  shape.
- Likely needs its own research pass once a second car class phase is actually being planned —
  not urgent now, captured so it isn't lost before v1's single-car RWD assumption gets baked in
  further.
