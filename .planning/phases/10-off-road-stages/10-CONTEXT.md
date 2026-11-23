# Phase 10: Off-road Stages - Context

**Gathered:** 2026-11-15
**Status:** Ready for planning
**Source:** Brief `.planning/plans-ahead/04-off-road-stages.md` (written from a code survey on 2026-11-15)

<domain>
## Phase Boundary

**Ramps (D-14 to D-20) moved to Phase 10.1 on 2026-11-23.**

A stage is a timed run from a start through ordered gates to a finish across open terrain, with no road needed. Stages are authored in the terrain editor and raced with `?map=<id>&mode=stage`.

The brief is the specification. Its stages of work (1 to 8) map to plans roughly one to one, in order. Stage 7 (medal recording) is done later with the user and is not a build plan. Everything in the brief's Decisions section is locked.

**Widened 2026-11-16 (user):** the same route tool also authors **road race routes** (point-to-point and circuit) in the terrain editor, and the phase includes **ramps as built objects** (see D-11 to D-14). Both were todos raised during other phases and folded in here.

**Out of scope:** AI opponents on stages, medal recording, stages on legacy (non-terrain) maps.

</domain>

<decisions>
## Implementation Decisions

- **D-01 (revised 2026-11-16, see D-11):** New file `public/maps/<id>.stages.json` with its own schema and parser (`src/core/stage.ts`). The original "existing routes untouched" rule is lifted; medal times need not be preserved (user, 2026-11-15).
- **D-02:** Shape per the brief (D2): start, 1 to 40 ordered gates, finish, optional medals; no `y` stored.
- **D-03:** Gates count only in order, and only when crossed forwards (velocity dotted with the gate direction).
- **D-04:** No wrong-way warning in stage mode.
- **D-05:** Respawn returns the car to the last gate passed, facing onward, with the existing flat time penalty.
- **D-06:** Medals optional per stage; with none, the run is timed and the personal best saved with no medal shown.
- **D-07:** Personal bests stored per stage and per vehicle class under a new, validated storage key.
- **D-08:** Terrain maps only; elsewhere `?mode=stage` falls back to free drive with a console warning.
- **D-09:** Editor: **Place ▾ → Stage**, sidebar Stages panel, Test stage button; stages saved through new dev-server `GET`/`PUT /__terrain/stages/<id>` validated by the parser. Show the user a layout sketch first.
- **D-10:** Gate visuals have no colliders.

**Road race routes (folded in from todo `2026-11-15-author-race-routes-in-the-editor.md`, 2026-11-16):**
- **D-11:** One route tool in the terrain editor authors off-road stages and road races (point-to-point and circuit): a start, ordered checkpoints, a finish or a lap. Reuse the Place tool, markers, sidebar list and undo pattern from Phase 07.1.3.
- **D-12:** Relax the two-course rule in `parseCourseData`: a map may hold any number of road routes, including none. Whether road routes and stages share one file format or stay as `routes.json` + `stages.json` behind one tool is decided during planning.
- **D-13:** The race coordinator uses `nearestRoadNode`; hand-placed checkpoints may not sit on a road node, so that must cope. Medals for a new route are recorded after it is authored.

> **Moved 2026-11-23:** D-14 to D-20 (ramps) now belong to Phase 10.1 (`.planning/phases/10.1-ramps-and-structures/10.1-CONTEXT.md`). Kept here for reference; Phase 10 does not plan them.

**Ramps as built objects (folded in from todo `2026-11-16-ramps-as-built-objects.md`, 2026-11-16):**
- **D-14:** Ramps look like built stunt ramps (timber planks or a steel wedge with visible frame and side panels, own material, not the ground) with a choice of shapes (kicker, wedge, tabletop, quarter-pipe), picked in the Place menu / ramp options. Own surface grip instead of hard-coded grass. Decide whether ramps leave the crest list as their own object kind (crests stay pure terrain) and how older files with crest-ramps load. Keep the rigid deck from quick task 261116-ryu (one base height at the foot). Short discuss pass first on shapes list, look and format split; may become its own plan(s) or a split-off phase if the phase gets too big.

**Ramps discuss pass (user, 2026-11-23) — resolves the D-14 open questions:**
- **D-15 Shapes:** kicker, wedge, tabletop / gap jump, quarter-pipe and half-pipe. All five are in scope.
- **D-16 Adjustable profile:** kickers and tabletops/gap jumps have an adjustable angle and an adjustable curve (lip profile), not fixed presets. Other shapes expose at least size; extra parameters are planner's choice.
- **D-17 Easy, intelligent alignment:** placing ramps must make alignment easy: e.g. snap to the terrain under the foot, align to the car's line / a route or stage gate direction, and snap pieces to each other (gap-jump take-off and landing on one axis with a set gap). Exact snapping rules are planner's choice; must be undoable like other placements.
- **D-18 Materials:** ramps have selectable materials with distinct textures, at least wood (timber planks) and metal (steel). Each material carries its own surface grip value (replaces the hard-coded grass grip).
- **D-19 Format:** ramps leave the crest list and get their own object kind and file format (Claude's choice of file layout). Crests stay pure terrain. Older files with crest-ramps must still load (migrate on read).
- **D-20 Structure base (forward-looking):** the user is thinking about elevated, roller-coaster-style stunt tracks later (raised track sections on supports, banked curves, gaps). Design the ramp object as the first kind of a general "structure piece" base (a parametric piece with a profile, transform, material and optional supports) so elevated track pieces can be added later without a format break. **Building elevated stunt tracks is NOT in this phase** — only the base must not block it. Record it as a seed.

**Accepted deviation (2026-11-23):** D-09 asked to show the user a layout sketch first. The user was asleep during planning, so the sketch lives at the top of `10-UI-SPEC.md` and the user reviews it before execution (morning review) and again at the plan 10-13 human check. If the user changes the layout after review, replan the editor plans (10-09, 10-10, 10-12) before executing them.

### Claude's Discretion
Gate look, exact warning thresholds, wave split. Ramps split to Phase 10.1 on 2026-11-23 (research recommendation).

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
- Elevated roller-coaster-style stunt tracks built from structure pieces (user idea 2026-11-23; see D-20). Only the base is in this phase.

</deferred>

---
*Context gathered: 2026-11-15 from .planning/plans-ahead briefs*
