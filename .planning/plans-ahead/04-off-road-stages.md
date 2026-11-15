# Plan 4: Off-road point-to-point stages (MODE-04)

Read `README.md` in this folder first. Do Plan 1 first (it adds the Place tool
group, markers and the undo pattern this plan reuses). Plan 3 supplies the
vehicles, but this plan works with the muscle car too.

## Goal

A stage is a timed run from a start line through numbered gates to a finish,
across open terrain, with no road needed. Stages are authored in the terrain
editor and raced in the game with a medal time.

**When it is done the user sees:** in the terrain editor, a Stage tool that
drops a start, gates and a finish; a Test stage button; in the game,
`?map=<id>&mode=stage` with gate markers, an arrow to the next gate, a timer,
splits and a results screen.

## Current state (why the existing modes cannot do this)

- `src/core/course.ts`: a `Course` has `mode: "p2p" | "circuit"`, `laps`,
  `checkpoints`, `start`. Every checkpoint needs a `nodeId` and `edgeId` on the
  road graph; the start is a `nodeId` plus heading.
- `parseCourseData` requires **exactly two courses, one p2p and one circuit**,
  and validates against the road graph.
- `public/maps/<id>.routes.json` holds the courses; `<id>.medals.json` holds
  reference times. `main.ts` (about lines 300 to 360) loads both and picks the
  course by `?mode=`.
- `src/gameplay/race-coordinator.ts` each tick calls
  `nearestRoadNode(navigation, position)` and `state.updateProgress(nodeId,
  heading)`; wrong-way detection in `src/core/race-state.ts` compares heading
  with the next road segment; respawn uses `checkpointResetPose`, which takes
  heading from the road between checkpoints.
- Existing P2P lets the player hit checkpoints in any order (P2P-01).
- Reusable as they are: `detectCheckpointHit` and `containsCheckpoint`
  (`src/core/checkpoint-detection.ts`, a box test with debouncing), the medal
  timing (`src/core/medal-timing.ts`), the results view
  (`src/hud/results-view.ts`), the race HUD, the navigation arrow
  (`src/hud/navigation-arrow.ts`: it points at a waypoint position and does not
  itself need a road), the objective markers
  (`src/render/objective-view.ts`), medal persistence
  (`src/core/medal-persistence.ts`), instant restart and respawn commands.

## Decisions

- **D1. A new file and schema, not a change to routes.** Stages live in
  `public/maps/<id>.stages.json`. `routes.json`, its parser and its
  two-course rule are untouched, so existing maps and tests are unaffected.
- **D2. Shape:**
  ```
  { schemaVersion: 1, areaId, stages: [ {
      id, name,
      start:  { x, z, headingRad },
      gates:  [ { id, x, z, headingRad, widthM } ],   // 1 to 40, in order
      finish: { x, z, headingRad, widthM },
      medals?: { goldSec, silverSec, bronzeSec, vehicle }   // absent until recorded
  } ] }
  ```
  No `y`: height comes from the terrain. `widthM` 8 to 60, default 20. At most
  20 stages per map.
- **D3. Gates must be taken in order.** Driving through a later gate early
  does nothing. This differs from P2P on purpose: off-road, "any order" would
  let the player skip the stage.
- **D4. A gate is a line with a direction.** It counts when the car crosses it
  in the forward direction within its width. Implement it as a box
  (`widthM` wide, 6 m deep, 12 m tall) centred on the gate so the existing
  `detectCheckpointHit` is reused, plus a direction check: car velocity dotted
  with the gate's forward vector must be positive.
- **D5. No wrong-way warning** in stage mode (there is no road direction).
  The arrow and the gate markers are the guidance.
- **D6. Respawn** puts the car at the last gate passed (or the start), facing
  that gate's `headingRad`, at terrain height plus clearance, with the same
  flat time penalty the existing modes use.
- **D7. Medals are optional per stage.** With no `medals`, the run is timed and
  the personal best is saved, with no medal shown. Recording medal times is a
  later, separate step with the user (see stage 7).
- **D8. Personal bests are stored per stage and per vehicle class**, in a new
  storage key, so a buggy time never competes with a muscle car time. Read
  `medal-persistence.ts` first and follow its validation approach (zod schema
  on read, never crash on bad data).
- **D9. Stage mode is terrain maps only.** On a legacy map `?mode=stage` falls
  back to free drive with a console warning.

## Stages of work

### Stage 1: Schema and parser (core, tests first)

Files: `src/core/stage.ts` (new), `tests/stage.test.ts`, schema doc in
`docs/schemas/`.

1. Types per D2. `parseStageData(raw, sourceLabel, extent)` where `extent` is
   the grid extent (`terrainGridExtent` in `terrain-drive-setup.ts`).
2. Validate: schema version exactly 1; ids unique and matching
   `/^[a-z0-9-]{1,40}$/`; names 1 to 60 characters; all numbers finite;
   positions inside the extent; widths in range; 1 to 40 gates; at most 20
   stages; medals, when present, strictly `gold < silver < bronze`, all
   positive.
3. `serializeStageData`. Round-trip test. A rejection test for each rule.

### Stage 2: Stage run logic (core, tests first)

File: `src/core/stage-run.ts` (new), `tests/stage-run.test.ts`.

A pure state machine, modelled on `src/core/race-state.ts` (read it first):

- `createStageRun(stage)` with `snapshot()`, `reset()`,
  `update({ x, y, z, vx, vz })` called once per fixed tick, `respawnPose(heightAt)`.
- Snapshot: `nextGateIndex`, `gatesPassed`, `complete`, `penaltySec`,
  `lastPassed` (for respawn), `targetPosition` (next gate or finish).
- `update` returns `{ passedGateId?: string, finished?: boolean }`.
- Gate test per D4. Convert each gate to the `CourseCheckpoint`-shaped box the
  existing detector takes, or write a small oriented-box test here if the
  existing one is axis-aligned (check `containsCheckpoint`; if it ignores
  rotation, write `insideOrientedBox(point, gate)` in this module and test it
  at 0, 45 and 90 degrees).
- Tests: in-order pass; out-of-order ignored; reverse crossing ignored;
  finish only after all gates; respawn pose after 0, 1 and all gates; reset.

### Stage 3: Stage coordinator

File: `src/gameplay/stage-coordinator.ts` (new), with a test using fakes for
the HUD pieces, as the existing coordinator tests do.

1. Read `race-coordinator.ts` end to end and copy its structure: `onTickEnd`,
   `refresh`, `onCommands` (restart, respawn), completion callback.
2. Differences from the race coordinator: no `nearestRoadNode`, no
   `updateProgress`, no wrong-way; gate detection via `stage-run`; waypoint is
   `snapshot.targetPosition` with `y` from the height sampler.
3. Feed `medal-timing` the same way (each gate is a sector). When the stage
   has no medals, pass a reference with no thresholds; check how
   `medal-timing.ts` and `results-view.ts` behave with no reference and make
   "no medal" a supported, tested case rather than faking thresholds.
4. Minimap: pass gate positions as `remaining` and the target; the minimap
   draws road polylines from the graph, which may be empty. Confirm it copes
   with an empty graph.

### Stage 4: Gate visuals

File: `src/render/stage-view.ts` (new).

1. Each gate: two posts `widthM` apart with a banner between them; the next
   gate is bright, later gates dim, passed gates removed or greyed. Finish is
   a chequered banner. Posts sit on terrain height at their own positions so a
   gate on a side slope looks right.
2. A tall thin light beam on the next gate so it can be found from the
   helicopter camera at distance. `MeshBasicMaterial`, additive, no shadows.
3. Visual only: no colliders on posts (hitting a gate post should not end a
   run). Budget: at most 3 draw calls total (instanced posts, banners, beam).

### Stage 5: Wire into the game

File: `src/main.ts`, plus `src/core/map-select.ts` if mode parsing lives
there (find where `?mode=` is allowlisted; it is read near line 308).

1. Add `stage` to the mode allowlist and `?stage=<id>` (strict pattern; default
   is the first stage in the file).
2. Fetch `/maps/<id>.stages.json` with the optional-artifact fetch helper
   (`fetchOptionalArtifactText`). Missing file with `?mode=stage` falls back to
   free drive with a console warning.
3. Spawn: use the stage start as `spawnOverride` (it has the same shape Plan 1
   uses). The start beats `?at=` and `?start=` in stage mode.
4. Countdown: reuse `src/core/race-start.ts` if the solo modes use one; if the
   solo modes start the clock on first movement, do the same. Match the
   existing P2P behaviour, whichever it is.
5. Build the stage coordinator in the same place the other coordinators are
   chosen (about lines 856 to 990).
6. Personal best storage per D8.
7. `tests/layering.test.ts` must stay green: the coordinator lives in
   `src/gameplay/`, logic in `src/core/`.

Done when: a hand-written `demo-hills.stages.json` with a start, three gates
and a finish can be driven start to finish with a results screen.
Do not commit that file unless the user wants it as a sample.

### Stage 6: Authoring in the terrain editor

Files: `tools/terrain-editor/stages.ts` (pure, with tests),
`tools/terrain-editor/vite-plugin.ts`, `tools/terrain-editor/editor.ts`,
toolbar data files. **Sketch the layout for the user first** (rule 11).

Proposed layout: **Place ▾ → Stage**. Sidebar **Stages** panel: a stage
picker with New, Rename, Delete; below it the ordered gate list for the
selected stage (Start, Gate 1..n, Finish) with a Width value and move up/down;
a **Test stage** button.

1. Pure operations in `stages.ts`: new stage, add gate (appended before the
   finish), insert, move, turn, set width, reorder, delete, rename. New arrays,
   no mutation. `nextGateId`.
2. Placing: with the Stage tool active, the first click-drag places the start
   (position and facing, like Plan 1), each further click-drag adds a gate, and
   Enter or double-click places the finish at the last point. Later edits:
   click a marker to select, drag to move, drag its arrow to turn.
3. Markers: reuse the game's `stage-view.ts` so the editor shows real gates.
   Draw a thin line connecting start, gates and finish in order, with the
   running total length in the info bar.
4. Storage: the stages file is separate from the terrain pair. Add
   `GET` and `PUT /__terrain/stages/<id>` to the dev-server plugin. Read the
   existing plugin first: it already hardens ids and paths and validates on
   PUT. Validate with `parseStageData` on PUT and reject invalid bodies with
   the parser's message. Save stages as part of the editor's normal save.
5. Undo: stages are editor state; add a `stages` before/after part to the undo
   diff as Plan 1 did for start points.
6. Warn (do not block) when consecutive gates are more than 600 m apart or a
   gate sits on a slope steeper than the editor's slope limit; show the
   warnings in the info bar using the existing problems-panel style.
7. **Test stage** saves, then opens
   `/?map=<id>&mode=stage&stage=<stage id>&debug`.

### Stage 7: Medal recording (with the user, later)

Not part of the build. When the user is happy with a stage and the vehicle
tuning is settled: the user drives it a few times; take their best clean time
as the reference and derive thresholds the same way the existing medals were
derived (read `src/core/medal-reference.ts` and plan 04.2-15's summary for the
ratios used). Store the result in the stage's `medals` with the vehicle class
it was recorded in. Re-record whenever the stage's terrain or that vehicle's
handling changes.

### Stage 8: Gate and docs

`npm run check`. Add `docs/stages.md`: file format, URL parameters, how to
author and test a stage.

## Human check (about three minutes)

1. In the terrain editor on `demo-hills` (or a map of the user's), place a
   start, four gates across open ground and a finish. Press Test stage.
2. Drive it: each gate lights in turn, the arrow points to the next, the timer
   runs, the results screen appears at the finish.
3. Skip a gate on purpose: the next one does not count until the skipped one
   is taken. Press the respawn key: the car returns to the last gate, facing
   onward.
4. Restart, finish again faster: the personal best updates.

## Traps

- **Do not relax `parseCourseData`.** The two-course rule is relied on by
  existing code and tests. Stages are a separate file for this reason.
- **Empty road graph.** A stage map may have no roads. Anything that assumes
  at least one node or edge (minimap bounds, nearest-road heading, navigation
  graph build) must be checked with an empty graph. Plan 1 stage 2 already
  removes the no-spawn throw.
- **Heights.** Never store or trust a `y` in the file; sample the physics grid.
- **Timing uses sim time** (`SimClock.simTimeSec`), never wall clock.
- **Direction check uses velocity, not heading**, so a car sliding sideways
  through a gate still counts.
- **Terrain edits invalidate times.** If a stage's medals exist and the user
  re-sculpts the map, the editor should warn that recorded times may no longer
  be fair. A simple "stages on this map have recorded medals" notice on save
  is enough.
