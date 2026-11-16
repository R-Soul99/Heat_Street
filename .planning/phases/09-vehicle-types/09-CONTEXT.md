# Phase 9: Vehicle Types - Context

**Gathered:** 2026-11-15
**Status:** Ready for planning
**Source:** Brief `.planning/plans-ahead/03-vehicle-types.md` (written from a code survey on 2026-11-15)

<domain>
## Phase Boundary

Add four vehicles that drive differently because their bodies, wheels and suspension differ: rally coupe, dune buggy, 4x4 pickup, monster truck. Selected with `?car=`. The existing `rwd`, `fwd` and `awd` cars keep bit-identical physics.

The brief is the specification. Its stages (0 to 8) map to plans roughly one to one, in order. Everything in its Decisions section is locked unless marked ASK.

**Out of scope:** AI driving the new vehicles, per-vehicle medals, a garage screen, car body art (Phase 11), renaming `engineForcePerRearWheel`.

</domain>

<decisions>
## Implementation Decisions

- **D-01:** Extend the existing class system in `src/core/vehicle-class.ts`; no second registry. Existing ids, storage keys and behaviour unchanged.
- **D-02:** Per-class tuning ranges: `classTuningRanges(id)`; `clampTuning` and `parseSavedTuning` take ranges as a parameter defaulting to `TUNING_RANGES`.
- **D-03:** Per-axle suspension as an optional `wheels.rear` override; absent means same as front, so existing tuning objects and saved blobs do not change.
- **D-04:** `engineForcePerRearWheel` is not renamed.
- **D-05:** Roster and starting numbers are the table in the brief (D5). They are starting points; tune headlessly against measured targets, then the user drives.
- **D-06:** Per-vehicle surface grip multipliers (`surfaceGripScale`) on the class spec; all 1.0 for existing classes.
- **D-07:** AI keeps driving the muscle car. **Default pending user confirmation (ASK in brief D7).**
- **D-08:** Non-`rwd` runs show a time but do not save a medal; match how `fwd`/`awd` are treated today and raise it with the user if that differs.
- **D-09:** A golden test (stage 0) pins `rwd`, `fwd`, `awd` end states on a fixed input tape and stays green through the whole phase. Its job is to catch accidental changes, not to protect medal times (user, 2026-11-15: medal times need not be retained at this stage). It may be updated only for a deliberate handling change the user has approved.
- **D-10:** The monster truck is a time-boxed spike (stage 6) with a written result and a stop for the user before the pickup and monster truck are built. If it fails, do not start an arcade-assist layer or a physics-engine change without the user.

### Claude's Discretion
Final tuning values within the measured targets, colours (distinct from the AI paints), wave split.

</decisions>

<canonical_refs>
## Canonical References (MANDATORY reading before planning)

- `.planning/plans-ahead/README.md` - rules that apply to every plan
- `.planning/plans-ahead/03-vehicle-types.md` - current state, stages, tests, traps
- `src/core/vehicle-class.ts`, `src/core/vehicle-tuning.ts`, `src/core/feel.ts`, `src/physics/vehicle.ts`
- `docs/vehicle-tuning-guide.md`
- Closed todos folded in here (2026-11-16): drivetrain per car class (RWD/FWD/AWD already exist via `?car=`), and "other vehicles" (user: "we really need those other vehicles", said while building a playground map)
- `.planning/seeds/offroad-point-to-point-stages.md`

</canonical_refs>

<specifics>
## Specific Ideas

- Saved browser tuning hides new defaults (memory: tuning-localstorage-override); values outside the active ranges are silently clamped.
- Fix the car, not the terrain (memory: fix-car-not-terrain).
- Human check: one minute per vehicle on `?map=feel-test`, plus one check that `?car=rwd` is unchanged.

</specifics>

<deferred>
## Deferred Ideas

- AI racers and pursuers in other vehicle classes
- Per-vehicle medal times
- Vehicle select screen
- Renaming `drive.engineForcePerRearWheel` (`src/core/vehicle-tuning.ts`, `src/core/feel.ts`) to a drivetrain-neutral name: kept out by D-04, revisit once real car classes settle

</deferred>

---
*Context gathered: 2026-11-15 from .planning/plans-ahead briefs*
