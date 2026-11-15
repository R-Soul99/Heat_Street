# Phase 10: Off-road Stages - Context

**Gathered:** 2026-11-15
**Status:** Ready for planning
**Source:** Brief `.planning/plans-ahead/04-off-road-stages.md` (written from a code survey on 2026-11-15)

<domain>
## Phase Boundary

A stage is a timed run from a start through ordered gates to a finish across open terrain, with no road needed. Stages are authored in the terrain editor and raced with `?map=<id>&mode=stage`.

The brief is the specification. Its stages of work (1 to 8) map to plans roughly one to one, in order. Stage 7 (medal recording) is done later with the user and is not a build plan. Everything in the brief's Decisions section is locked.

**Out of scope:** changing `routes.json` or `parseCourseData`, AI opponents on stages, medal recording, stages on legacy (non-terrain) maps.

</domain>

<decisions>
## Implementation Decisions

- **D-01:** New file `public/maps/<id>.stages.json` with its own schema and parser (`src/core/stage.ts`); existing routes, courses and their two-course rule are untouched.
- **D-02:** Shape per the brief (D2): start, 1 to 40 ordered gates, finish, optional medals; no `y` stored.
- **D-03:** Gates count only in order, and only when crossed forwards (velocity dotted with the gate direction).
- **D-04:** No wrong-way warning in stage mode.
- **D-05:** Respawn returns the car to the last gate passed, facing onward, with the existing flat time penalty.
- **D-06:** Medals optional per stage; with none, the run is timed and the personal best saved with no medal shown.
- **D-07:** Personal bests stored per stage and per vehicle class under a new, validated storage key.
- **D-08:** Terrain maps only; elsewhere `?mode=stage` falls back to free drive with a console warning.
- **D-09:** Editor: **Place ▾ → Stage**, sidebar Stages panel, Test stage button; stages saved through new dev-server `GET`/`PUT /__terrain/stages/<id>` validated by the parser. Show the user a layout sketch first.
- **D-10:** Gate visuals have no colliders.

### Claude's Discretion
Gate look, exact warning thresholds, wave split.

</decisions>

<canonical_refs>
## Canonical References (MANDATORY reading before planning)

- `.planning/plans-ahead/README.md` - rules that apply to every plan
- `.planning/plans-ahead/04-off-road-stages.md` - current state, stages of work, tests, traps
- `.planning/plans-ahead/01-start-points.md` - the placement, marker and undo pattern this reuses (built in Phase 07.1.3)
- `src/core/course.ts`, `src/core/race-state.ts`, `src/gameplay/race-coordinator.ts`, `src/core/checkpoint-detection.ts`, `src/core/medal-timing.ts`, `src/core/medal-persistence.ts`
- `tools/terrain-editor/vite-plugin.ts`
- `.planning/seeds/offroad-point-to-point-stages.md`

</canonical_refs>

<specifics>
## Specific Ideas

- A stage map may have an empty road graph; everything touched must cope with that.
- Timing uses sim time only.
- Human check is about three minutes on `demo-hills` or a map of the user's.

</specifics>

<deferred>
## Deferred Ideas

- Medal recording per stage and vehicle (with the user, after handling is settled)
- AI opponents on stages
- Dust-cloud line-of-sight evasion (seed)

</deferred>

---
*Context gathered: 2026-11-15 from .planning/plans-ahead briefs*
