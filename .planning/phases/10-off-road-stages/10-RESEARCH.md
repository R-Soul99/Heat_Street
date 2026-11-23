# Phase 10: Off-road Stages - Research

**Researched:** 2026-11-23
**Domain:** Pure-TypeScript game-mode logic (stage run state machine, file formats, persistence), terrain-editor authoring tool, Rapier trimesh collider geometry for parametric ramps
**Confidence:** HIGH on stages / routes / persistence / editor wiring (all read from this repo's code). MEDIUM on ramp grip-material plumbing and snapping thresholds (design recommendations, not verified in play).

## Summary

Everything this phase needs already exists in some form in the repo; the work is mostly new pure modules plus careful wiring, not new libraries. **No new npm packages are needed** (Package Legitimacy Audit: none). Stage gameplay (D-01..D-10, brief stages 1-6, 8) is a self-contained new file format (`stages.json`), a pure run state machine, a coordinator that implements the existing `RaceCoordinator` interface, and a gate view. The road-route widening (D-11..D-13) is the riskiest part of the "stages" half because `parseCourseData`, `validateCourseRoutes`, `parseMedalReference`, and `main.ts` all hard-assume exactly two fully-medalled, road-bound courses. Ramps (D-14..D-20) are an independent subsystem (new format in the terrain sidecar, new geometry, new collider + grip plumbing, new editor panel, committed-map migration) and are about as large as the rest of the phase put together.

Key findings that change the brief: (1) `containsCheckpoint` is axis-aligned, so gates need a new oriented test; (2) `SURFACE_TYPES` is a closed 6-value enum baked into the `.terrain.bin` header, the road-graph schema doc, the grip tables of every vehicle class, and surface audio, so adding "wood"/"metal" to it has a large blast radius; use a per-collider grip override instead; (3) `zod` is NOT a dependency of this project (CLAUDE.md and the brief mention it, but `medal-persistence.ts` is hand-rolled validation) so follow the hand-rolled pattern; (4) `nearestRoadNode` throws a `TypeError` on an empty graph; (5) two heading conventions (BEARING for ramps/race-state, YAW for start points/`VehiclePose`) must be pinned for gates; (6) the committed maps already contain 15 crest-ramps (demo-hills 5, feel-test 3, playground 6, new-area-3 1) that must migrate with identical geometry.

**Primary recommendation:** Split the phase. **Phase 10 = stages + the shared Route tool + road-route relaxation (about 7 plans).** **Phase 10.1 = ramps as structure pieces (about 6 plans).** Keep `stages.json` separate from `routes.json` behind one editor tool (D-12). Store structure pieces in the terrain sidecar as a new optional `structures` array, migrating crest-ramps on read.

## User Constraints (from CONTEXT.md)

<user_constraints>
### Locked Decisions
- **D-01 (revised 2026-11-16, see D-11):** New file `public/maps/<id>.stages.json` with its own schema and parser (`src/core/stage.ts`). The original "existing routes untouched" rule is lifted; medal times need not be preserved (user, 2026-11-15).
- **D-02:** Shape per the brief (D2): start, 1 to 40 ordered gates, finish, optional medals; no `y` stored.
- **D-03:** Gates count only in order, and only when crossed forwards (velocity dotted with the gate direction).
- **D-04:** No wrong-way warning in stage mode.
- **D-05:** Respawn returns the car to the last gate passed, facing onward, with the existing flat time penalty.
- **D-06:** Medals optional per stage; with none, the run is timed and the personal best saved with no medal shown.
- **D-07:** Personal bests stored per stage and per vehicle class under a new, validated storage key.
- **D-08:** Terrain maps only; elsewhere `?mode=stage` falls back to free drive with a console warning.
- **D-09:** Editor: **Place > Stage**, sidebar Stages panel, Test stage button; stages saved through new dev-server `GET`/`PUT /__terrain/stages/<id>` validated by the parser. Show the user a layout sketch first.
- **D-10:** Gate visuals have no colliders.
- **D-11:** One route tool in the terrain editor authors off-road stages and road races (point-to-point and circuit): a start, ordered checkpoints, a finish or a lap. Reuse the Place tool, markers, sidebar list and undo pattern from Phase 07.1.3.
- **D-12:** Relax the two-course rule in `parseCourseData`: a map may hold any number of road routes, including none. Whether road routes and stages share one file format or stay as `routes.json` + `stages.json` behind one tool is decided during planning.
- **D-13:** The race coordinator uses `nearestRoadNode`; hand-placed checkpoints may not sit on a road node, so that must cope. Medals for a new route are recorded after it is authored.
- **D-14:** Ramps look like built stunt ramps (timber planks or a steel wedge with visible frame and side panels, own material, not the ground) with a choice of shapes, picked in the Place menu / ramp options. Own surface grip instead of hard-coded grass. Keep the rigid deck from quick task 261116-ryu (one base height at the foot). May become its own plan(s) or a split-off phase if the phase gets too big.
- **D-15 Shapes:** kicker, wedge, tabletop / gap jump, quarter-pipe and half-pipe. All five are in scope.
- **D-16 Adjustable profile:** kickers and tabletops/gap jumps have an adjustable angle and an adjustable curve (lip profile), not fixed presets. Other shapes expose at least size; extra parameters are planner's choice.
- **D-17 Easy, intelligent alignment:** snap to the terrain under the foot, align to the car's line / a route or stage gate direction, snap pieces to each other (gap-jump take-off and landing on one axis with a set gap). Exact rules are planner's choice; must be undoable like other placements.
- **D-18 Materials:** selectable materials with distinct textures, at least wood (timber planks) and metal (steel). Each carries its own surface grip value (replaces the hard-coded grass grip).
- **D-19 Format:** ramps leave the crest list and get their own object kind and file format (Claude's choice of file layout). Crests stay pure terrain. Older files with crest-ramps must still load (migrate on read).
- **D-20 Structure base (forward-looking):** design the ramp object as the first kind of a general "structure piece" base (parametric piece with a profile, transform, material and optional supports) so elevated track pieces can be added later without a format break. **Building elevated stunt tracks is NOT in this phase.** Record as a seed (already done: `.planning/seeds/elevated-stunt-tracks.md`).

Brief decisions (04-off-road-stages.md, locked by CONTEXT "Everything in the brief's Decisions section is locked"): D2 shape and ranges (`widthM` 8..60 default 20, <= 20 stages/map, 1..40 gates); gates in order; gate = box widthM x 6 m x 12 m + forward velocity check; no wrong-way; respawn at last gate; PB per stage per class; terrain maps only.

### Claude's Discretion
Gate look, exact warning thresholds, wave split. Ramp file layout (D-19). Whether ramps (D-14 to D-20) stay in this phase or split into a follow-on decimal phase if the phase gets too big - prefer splitting over cramming.

### Deferred Ideas (OUT OF SCOPE)
- Medal recording per stage and vehicle (with the user, after handling is settled)
- AI opponents on stages
- Dust-cloud line-of-sight evasion (seed)
- Elevated roller-coaster-style stunt tracks built from structure pieces (user idea 2026-11-23; see D-20). Only the base is in this phase.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| MODE-04 | Off-road point-to-point stages (promoted from v2): timed run, ordered gates, open terrain, authored in the terrain editor, medal-time-ready | Stage schema/parser (Standard Stack, Pattern 1), oriented gate crossing + run state machine (Pattern 2), coordinator implementing `RaceCoordinator` (Pattern 3), PB persistence (Pattern 4), editor + dev-server API (Pattern 5), empty-road-graph hazards (Pitfalls 1-3) |
</phase_requirements>

## Project Constraints (from CLAUDE.md)

- Stack is fixed: Three.js (WebGLRenderer) + `@dimforge/rapier3d` 0.20.0 + TypeScript + Vite; entirely code-driven (no visual editor dependency). No ECS, no UI framework: vanilla TS + DOM HUD; minimap is a 2D canvas.
- Fixed-timestep physics at 1/60; timing uses sim time only (never wall clock) - medal times depend on it.
- `ColliderDesc.trimesh` MUST use `TriMeshFlags.FIX_INTERNAL_EDGES` (value 144). Never hand-roll a raycast vehicle; never import `three/addons/physics/RapierPhysics.js`.
- Persistence: `localStorage` with schema validation on read so malformed data never crashes. (CLAUDE.md says `zod`, but `zod` is not in `package.json`; the repo's real pattern is hand-rolled validators - see `src/core/medal-persistence.ts`. Follow the repo.)
- Biome for lint/format, vitest 5.0.0 for tests; typecheck with `tsc --noEmit`; `npm run check` is the gate. `tests/layering.test.ts` enforces `src/core/` purity (no three/rapier/DOM/wall clock).
- Do not use Draco or Howler; no real manufacturer IP in assets (ramp materials are procedural, so no assets involved).
- GSD workflow enforcement: edits happen through a GSD command.
- Textures for planks/steel must be code-driven (procedural `CanvasTexture` or vertex colours) - there is no art pipeline.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Stage / structure file formats and validation | `src/core/` (pure parsers) | `tools/terrain-editor/vite-plugin.ts` (PUT validation) | Same parser runs in game load, editor, and dev-server PUT; core must stay pure (layering test). |
| Gate-crossing and ordered-progress logic | `src/core/stage-run.ts` | - | Deterministic, sim-time-only, unit-testable. |
| Stage run orchestration (HUD, timing, respawn, restart) | `src/gameplay/stage-coordinator.ts` | `src/main.ts` composition | Mirrors `race-coordinator.ts`; the only layer that touches Rapier body + HUD. |
| Gate visuals | `src/render/stage-view.ts` (three) | editor reuses it | No colliders (D-10); 3 draw calls budget. |
| PB persistence | `src/core/stage-persistence.ts` | `src/main.ts` (storage adapter) | Pure validate/merge; storage injected like `MedalStorage`. |
| Ramp profile geometry, snapping math, crest migration | `src/core/` + `tools/terrain-editor/*.ts` pure files | - | Testable with no DOM/three. |
| Ramp colliders + per-material grip | `src/physics/terrain-scene.ts` + `src/physics/surface.ts` | `src/physics/vehicle.ts` single grip read site | Collider handle to surface/grip is the established mapping (`SurfaceMap`). |
| Ramp mesh + procedural materials | `src/render/structure-view.ts` | editor ghost | Shared builder so editor shows the real thing (as `crest-view.ts` does). |
| Authoring UI, markers, undo | `tools/terrain-editor/editor.ts` + pure helpers | dev-server plugin for file IO | Existing pattern (start-points, place-tool, StrokeDiff undo). |

## Standard Stack

No new libraries. Everything uses what is in the repo.

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| three | 0.185.1 [VERIFIED: package.json] | gate and ramp meshes, procedural materials | Project stack |
| @dimforge/rapier3d | 0.20.0 [VERIFIED: package.json/CLAUDE.md] | ramp trimesh colliders | Project stack |
| typescript / vite / vitest | 7.0.2 / 8.2.2 / 5.0.0 [CITED: CLAUDE.md; vitest 5.0.0 VERIFIED in package.json] | build + test | Project stack |
| ngraph.path / ngraph.graph | already installed | existing road routing (road races only) | Existing |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| New `SurfaceType` values "wood"/"metal" | Per-collider grip override on `SurfaceMap` (recommended) | Enum change touches `.terrain.bin` header, docs/schemas/road-graph.v1.md parity test, `SurfaceProfiles`, every `SurfaceGripScale` table, audio loops, fx. Override touches 1 read site. |
| Convex-hull colliders for curved ramps | One trimesh per piece + `FIX_INTERNAL_EDGES` (recommended) | Hull decomposition of a concave quarter/half-pipe creates hull-to-hull seams (the exact ghost-collision problem the flag fixes) and a lip hull is hard to keep exactly tangent. |
| Merge stages into `routes.json` | Separate `stages.json` (recommended, see D-12 section) | See evidence below. |
| `zod` | Hand-rolled validators | `zod` is not installed; adding a dependency for one schema is not warranted. |

**Installation:** none. `npm run check` is the gate.

## Package Legitimacy Audit

| Package | Registry | Age | Downloads | Source Repo | slopcheck | Disposition |
|---------|----------|-----|-----------|-------------|-----------|-------------|
| (none - this phase installs no packages) | - | - | - | - | n/a | n/a |

**Packages removed due to slopcheck [SLOP] verdict:** none
**Packages flagged as suspicious [SUS]:** none

## Architecture Patterns

### System Architecture Diagram

```
EDITOR (dev only)                                           GAME (?map=<id>&mode=stage&stage=<sid>)
 Place > Route tool                                          main.ts
  click/drag -> pure stages.ts ops (new arrays)               |-- terrain load (bin+json) -> graph (maybe EMPTY), grid
  -> StrokeDiff {stages|routes before/after} -> undo stack    |-- fetchOptionalArtifactText(<id>.stages.json)
  -> save: PUT /__terrain/stages/<id>  --parseStageData-->    |     missing/not terrain -> console.warn + free drive (D-08)
           PUT /__terrain/routes/<id>  --parseCourseData-->   |-- parseStageData(raw, label, terrainGridExtent(grid))
        (atomic write public/maps/<id>.stages.json)           |-- spawnOverride = stage.start (beats ?at/?start)
  Test stage -> opens game URL ------------------------------>|-- createStageRun(stage) [core, pure]
                                                              |-- createStageCoordinator(deps)  implements RaceCoordinator
 PHYSICS TICK (fixed 1/60)                                    |     onTickEnd: body pos/vel -> run.update -> {passedGateId?,finished?}
  vehicle body ---------------------------------------------->|        -> timing.recordCheckpoint (gate = sector) / complete
                                                              |     refresh: stage-view (next gate bright), minimap, nav arrow, race-hud
 onCommands: restart -> run.reset + timing.restart + resetVehicle(stage.start)
             respawn -> run.respawn pose (last gate or start, yaw=gate.headingRad, y=heightAt+clearance) + 5 s penalty
 onCompleted -> stage-persistence.mergeStageBest(areaId, stageId, classId) -> localStorage "heat-street.stage-bests.v1"
              -> results-view.showCompletion (no medal row when no medals)
```

### Recommended Project Structure
```
src/core/stage.ts                 # types, parseStageData, serializeStageData (D2 shape)
src/core/stage-run.ts             # createStageRun, gate-crossing test, respawnPose
src/core/stage-persistence.ts     # PB envelope, parse/merge/save per area+stage+class
src/core/structure.ts             # (10.1) structure-piece types, parse/serialize, crest-ramp migration
src/core/structure-profile.ts     # (10.1) pure profile -> polyline/grid geometry per shape
src/gameplay/stage-coordinator.ts
src/render/stage-view.ts          # gate posts/banners/beam, <= 3 draw calls
src/render/structure-view.ts      # (10.1) planks/steel procedural materials
tools/terrain-editor/stages.ts    # pure ops (+ .test.ts co-located, like start-points.test.ts)
tools/terrain-editor/structure-snap.ts   # (10.1) pure snapping rules
tests/stage.test.ts, tests/stage-run.test.ts, tests/stage-persistence.test.ts, tests/stage-coordinator.test.ts
docs/schemas/stage.v1.md, docs/stages.md
```

### Pattern 1: Stage schema + parser (follow `course.ts` / `parseStartPoints` style)
**What:** Hand-rolled `isObject`/`required`/`finiteNumber` helpers (copy the style of `src/core/course.ts`; do not import its private helpers). `parseStageData(raw, sourceLabel, extent)` throws `Error("parseStageData: <label>: <msg>")`. Rules from brief Stage 1 plus: ids `/^[a-z0-9-]{1,40}$/` unique per file and gate ids unique per stage; `areaId` check is done by the caller (as main does for routes); positions inside `extent` (reuse `terrainGridExtent`); `|x|,|z| <= MAX_COORD_ABS_M` (100000); headings finite; reject unknown keys? (No: ignore unknown keys like the sidecar parsers do, but never copy them through serialize.) Use `Object.hasOwn`-based `required` (avoids prototype keys).
**Heading convention (pin it):** store `headingRad` in **YAW** (the `VehiclePose` convention used by `startPoints`, `resetVehicle`, `yawFromTravelDirection`), forward = `(-sin h, -cos h)`. Race-state/minimap/ramps use BEARING (`atan2(fz, fx)`). Document in `docs/schemas/stage.v1.md` and add pure `bearingFromYaw`/`yawFromBearing` to `src/core/heading.ts` with a round-trip test. [VERIFIED: src/core/heading.ts]
**Medals:** `{goldSec, silverSec, bronzeSec, vehicle}` strictly `gold < silver < bronze`, all > 0, `vehicle` in `KNOWN_VEHICLE_CLASS_IDS`.

### Pattern 2: Gate crossing (core, pure) - do NOT reuse `containsCheckpoint`
**What:** `containsCheckpoint` is an axis-aligned box test (`Math.abs(position - center) <= half extents` on x/y/z; it ignores rotation) [VERIFIED: src/core/checkpoint-detection.ts]. Brief authorises writing an oriented test. Recommend a stateless **plane-crossing** test instead of box + debounce:
```typescript
// gate: {x, z, headingRad(yaw), widthM}; f = (-sin h, -cos h); r = (cos h, -sin h)
// prev/cur = car XZ at previous / current fixed tick (run keeps prev internally)
const side = (p) => (p.x - gate.x) * f.x + (p.z - gate.z) * f.z;   // >0 = ahead of gate
const crossed = side(prev) < 0 && side(cur) >= 0;                  // forward crossing only
// interpolate crossing point t = side(prev)/(side(prev)-side(cur)); lateral = dot(lerp(prev,cur,t)-gate, r)
const inWindow = Math.abs(lateral) <= gate.widthM / 2;
// height window: car y within [terrainY(gate)-2, terrainY(gate)+12]  [ASSUMED: brief's 12 m tall box]
```
Why: at 60 m/s a car moves 1 m/tick so a 6 m deep box is fine, but the crossing test needs no `wasInside` map, cannot double-fire, handles sliding sideways (direction comes from plane side, not heading - satisfies the brief's "velocity not heading" trap), and "forward only" is inherent. Also dot `(vx,vz)` with `f` > 0 as a belt-and-braces check to match D-03 wording literally. Initial `prev` = first sample (never fire on the first tick).
**State machine:** `createStageRun(stage)` -> `snapshot()` `{nextGateIndex, gatesPassed, complete, penaltySec, lastPassed, targetPosition}`; gates then finish are one ordered list (finish = last element, same test with finish width). `update({x,y,z,vx,vz})` returns `{passedGateId?, finished?}`. `respawnPose(heightAt)` -> `{x, y: heightAt + 0.6, z, headingRad}`; with 0 gates passed it is the start pose. `RESPAWN_PENALTY_SEC` is defined twice already (`race-state.ts`, `medal-timing.ts`, both 5); import one, do not add a third.

### Pattern 3: Stage coordinator implements the existing `RaceCoordinator` interface
`RaceCoordinator` (`onTickEnd`, `onCommands`, `render`, `snapshot(): RaceSnapshot`) is what `main.ts`'s `activeCoordinator = circuitRace ?? raceCoordinator ?? freeDriveCoordinator` dispatches on [VERIFIED: race-coordinator.ts, main.ts ~1088]. Add a stage coordinator as a fourth option. `RaceSnapshot.mode` is `Course["mode"]` (`"p2p"|"circuit"`); widen the snapshot type to `"p2p"|"circuit"|"stage"` (additive) and extend `race-hud.ts`'s status text to `GATE n / total` for stage (currently `CHECKPOINT n` for non-circuit). Timing: `createMedalTiming` starts on first movement (>= 0.5 m/s), identical to P2P - there is no countdown for solo modes, so match that (answers brief Stage 5.4). Use `medals: false` when the stage has no `medals` or the class mismatches. Gate pass = `recordCheckpoint(simTime, {checkpointId: gate.id, ordinal})`; finish = `timing.complete(simTime)`; respawn = state penalty + `timing.update({penaltySec})` exactly as `race-coordinator.ts` does.
`resultsView`: `createResultsView(courses, references, ...)` is Course-typed. For stages pass empty `courses`/`references` (cards render nothing) and use `showCompletion(completion)`; verify the no-medal row text ("UNEARNED") is suppressed in that path (UI-SPEC requires no medal row) - small `results-view.ts` change with a test on `buildResultRows`/the view model.

### Pattern 4: Personal-best persistence (new key, hand-rolled)
New module `src/core/stage-persistence.ts`, key `"heat-street.stage-bests.v1"`, envelope `{kind:"heat-street.stage-bests", version:1, bests:{ "<areaId>:<stageId>:<classId>": {bestTimeSec} }}`. Composite key components cannot contain `:` (areaId `/^[a-z0-9-]{1,64}$/`, stageId `/^[a-z0-9-]{1,40}$/`, classId in `KNOWN_VEHICLE_CLASS_IDS`), so it is injective and cannot collide with the course-id-only medal key. On read: `JSON.parse` in try/catch -> empty on any failure; copy only entries whose key matches the regex, whose class is allowlisted via array `find` (never object-key lookup), whose `bestTimeSec` is finite and > 0; drop the rest (mirror `copyValidCourses`). Merge only improves. Save wrapped in try/catch (quota). Save for **every** class (D-07: PB per class, including `savesMedals:false` classes); medal field is `"none"` whenever the stage has no medals or the class does not earn them. Do NOT reuse `mergeMedalResult` (its `knownCourseIds` machinery drops unknown ids on every save - the T-07-24 trap documented in `medal-persistence.ts`). Pass `knownStageIds` only if you filter; simplest is to not filter by known id and rely on key validation.

### Pattern 5: Dev-server API (`/__terrain/stages/<id>`)
Existing plugin routes `parts = ["__terrain", id, kind]` and requires `parts.length === 3`; `/__terrain/stages/<id>` has `parts[1]==="stages"` and would currently be read as area id "stages" with kind `<id>`. Add a branch **before** the generic `id/kind` handling (like the `areas`/`drivable` branches): `GET|PUT /__terrain/stages/<id>` and, for D-12, `/__terrain/routes/<id>`. Reuse `isSafeAreaId`, `readBodyCapped(req, MAX_JSON_BYTES)`, `writeAtomic`, `safeMessage`; add `resolveStagesFile(root, id)` in `paths.ts` (resolve under `public/maps`, `startsWith(mapsDir + sep)` check, filename `${id}.stages.json`). PUT: parse body with `parseStageData(text, id, extent)` where `extent` comes from reading the area's `.terrain.bin` header via `decodeTerrainBinary` (area must exist -> 404 otherwise); map `parseStageData:` messages to HTTP 400 by extending the `isValidation` prefix check. Make `GET` return 404 JSON when absent so the editor can treat "no file" as empty list. `apply: "serve"` already keeps this out of prod builds.

### Pattern 6: Editor undo for stages/routes
`StrokeDiff` (src/core/terrain-brush.ts) and `UndoTarget`/`applyStrokeDiff` (src/core/terrain-undo.ts) carry optional whole-array before/after parts (`startPoints`, `features`, `buildings`, `objects`). Add `stages` (and `routes`, and in 10.1 `structures`) the same way plus an `ApplyResult.stagesChanged` flag. Elements are shared and never mutated (pure ops return new arrays), exactly as `start-points.ts`. `amendTop` (small repeated edits as one step) already exists. Pure ops in `tools/terrain-editor/stages.ts`: newStage, addGate (inserted before finish), insertGate, moveGate, turnGate, setWidth, reorder, deleteGate, renameStage, deleteStage, `nextGateId` (seed = max numeric suffix + 1, in editor state, never in file; copy `startIdSeed`). Reuse `createDragGesture` from `place-tool.ts` for press-drag (position + facing) - kind-agnostic by design. `DRAG_HEADING_MIN_M` fallback: a click with no drag takes the previous gate's heading, or the heading toward the cursor from the previous gate (assumption).

### Anti-Patterns to Avoid
- **Reusing `detectCheckpointHit` for oriented gates** - it ignores rotation.
- **Calling `nearestRoadNode` in the stage coordinator** - throws on empty graph (see Pitfall 1).
- **Storing `y` in stage/structure files** - always sample the physics grid (`sampleTerrainHeight`), as the brief says.
- **Wall-clock timing** - use `SimClock.simTimeSec`.
- **A third copy of `RESPAWN_PENALTY_SEC`.**
- **Importing `three`/Rapier/DOM in `src/core/`** - `tests/layering.test.ts` fails the build.

## D-12: shared file or two files? Recommendation: two files behind one tool

**Recommend `routes.json` (relaxed) + `stages.json` (new), one editor tool ("Route", Kind switch) writing to whichever file the Kind implies.** Evidence from the code:

| Concern | Routes (`routes.json` + `medals.json`) | Stages |
|---|---|---|
| Position semantics | checkpoint `{nodeId, edgeId, position[x,y,z], sensor}` bound to road graph; `parseCourseData(raw, label, graph)` rejects unknown node/edge | `{x, z, headingRad, widthM}`, no `y`, no graph |
| Order semantics | P2P any order (nearest-by-path target selection); circuit in order | always strict order, forward-only |
| Validation context | needs `RoadGraph` + `validateCourseRoutes` (path existence, 30 m edge tolerance, Juliette `DEFECT_COORDINATES`) | needs only grid extent |
| Medals | separate `<id>.medals.json`, `parseMedalReference` demands a reference per course with a full per-checkpoint split table | inline optional `{gold,silver,bronze,vehicle}` |
| PB key | `heat-street.medals.v1` keyed by course id only (global across maps) | new key, area+stage+class |
| Consumers (7 test files + 3 author scripts + `main.ts`) | `tests/course-data.test.ts`, `medal-reference`, `route-validation`, `checkpoint-pose`, `ai-field`, `ai-lap`, `racing-line`, `grid-test-routes`, `playground-map`, `terrain-convert`, `fixtures/terrain-race-harness` | none (new) |
A merged format would force every existing route consumer and test to change shape for no gain, and would make an empty-graph map unable to hold a road route in the same file anyway. The UI-SPEC already hides the split from the user (assumption 1), so nothing user-visible depends on this. The editor exposes one panel; `Kind` chooses the destination file.

### What must change for road routes (D-12/D-13), concretely
1. `parseCourseData`: replace `rawCourses.length !== 2` and the "exactly one p2p + one circuit" check with `0..N` courses (cap N, e.g. 20 [ASSUMED]); relax per-mode checkpoint counts (`p2p 5-8`, `circuit 4-6`) and `laps === 3` for authored routes (e.g. p2p >= 2, circuit >= 3 checkpoints, laps 1..20 matching the UI-SPEC "Laps 1 to 20"). Tests `tests/course-data.test.ts` assert the old rules - update them deliberately (the user lifted the "untouched" rule in D-01 revision). Keep strict id/duplicate checks.
2. `main.ts` (around lines 260-390): `fetchArtifactText(MAP_MEDALS_URL)` throws on 404, and `course`/`reference` lookups throw if missing. Make medals optional per course: if `<id>.medals.json` is absent or lacks a course, run that course with `createMedalTiming({medals:false})`, no thresholds, `reference` empty (`{splits: []}` shape - `comparisonFor` already returns `undefined` when no split is found). Add `?route=<courseId>` (strict `/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/` pattern already used for course ids) to choose among N routes; `?mode=p2p|circuit` picks the first route of that mode when `?route` is absent. `parseMedalReference` expectations list must only include courses that appear in the medals file (or make the parser accept a partial subset); `buildCourseCardModels` already returns `[]` for a course with no reference.
3. `validateCourseRoutes` is the biggest trap for hand-placed checkpoints: it fails on `no directed path`, `checkpoint is not near edge` (> 30 m from edge points), `sensor too small for its road`, and the Juliette-only `DEFECT_COORDINATES` check. Gate these on authored (terrain-area) routes: skip `DEFECT_COORDINATES` unless `areaId === "juliette-ga"` [ASSUMED mapping; `DEFECT_COORDINATES` is exported and Juliette-local], and in the editor-side save guard run a softer check (warn, do not block) for off-road checkpoints (UI-SPEC: "off road" `--warn` tag at > 30 m from any road node).
4. Editor derives `nodeId`/`edgeId` at save time: nearest road node (`nearestRoadNode` semantics) and the nearest edge touching that node, so `parseCourseData`'s "edge touches node" rule holds; hand-placed `position` is preserved. A road route needs >= 1 road node (a map with no roads cannot hold a road race - disable the road Kinds with a hint "this map has no roads; use Stage"); stages work with an empty graph. Course `start.nodeId` likewise derived from the start position.

### D-13: how the coordinator copes with off-node checkpoints
- `nearestRoadNode` returns the closest node by 3D distance, so off-node checkpoints just resolve to a nearby node; `race-state.updateProgress(nodeId, heading)` only needs a valid node. P2P `selectP2PTarget` uses `pathCost(findRoadPath(currentNodeId, checkpoint.nodeId))`; unreachable checkpoints get cost `Infinity` and fall through to lowest `index` on ties - it does not throw. [VERIFIED: race-state.ts]
- **Real defect:** `nearestRoadNode` does `let nearest = navigation.roadGraph.nodes[0]; ... return nearest.id` - a `TypeError` when `nodes` is empty. Fix: return `-1` for empty graph (`updateProgress` already guards `navigation.graph.hasNode(-1) === false` and returns). Add a test. The stage coordinator never calls it; this fix protects any future route-on-sparse-graph use and the minimap path.
- `checkpointResetPose` falls back to `course.start.headingRad` when no road tangent exists - fine for off-road checkpoints.
- `createMinimap(graph)` iterates `graph.edges` - safe on an empty edge list [VERIFIED: src/hud/minimap.ts]. `createObjectiveView(view.scene)`/`navigationArrow` need only positions.
- Circuit with `wrongWay`: `headingToNext` returns `null` when no path -> `wrongWay = false`, so off-road circuit checkpoints just never warn. Acceptable.

## Ramps (Phase 10.1 recommended): format, migration, collider, grip, geometry, snapping

### D-19 file layout: new optional `structures` array in the terrain sidecar
- **Where:** `public/maps/<id>.terrain.json` gets an optional top-level `structures: StructurePiece[]` (absent when empty), exactly like `startPoints`/`features`. Rationale: structures are terrain-seated geometry edited together with sculpting (they are already invalidated/re-seated by terrain edits - `rebuildRamps()` on sculpt), they flow through the existing sidecar PUT validation, `UndoTarget`, `loadTerrainArea`, and `MAX_JSON_BYTES`; no new dev-server endpoint. `TERRAIN_FORMAT_VERSION` stays 1 (precedent: `startPoints`, `features` were added as optional keys without a bump) [VERIFIED: terrain-format.ts parse + serialize]. Document in `docs/schemas/terrain-area.v1.md`.
- **Why not a separate file:** unlike stages, structures have no independent save semantics, no medals, and the editor's "Save" already writes the pair atomically.
- **Piece schema (D-20 base):** discriminated on `type`, with room for supports/elevation so elevated tracks add types later without a format break:
```
StructurePiece = {
  id: string,                         // /^[a-z0-9-]{1,40}$/ unique among structures
  type: "kicker"|"wedge"|"tabletop"|"quarter-pipe"|"half-pipe",   // later: "track-straight", "track-banked", ...
  x, z: number, headingRad: number,   // foot-start position; BEARING (0=+x), same as crest ramps today
  material: "wood"|"metal"|"ground",  // "ground" = legacy/migrated only, hidden from UI palette
  params: { heightM, widthM, lengthM?, angleDeg?, curvePct?, gapM?, radiusM?, landing? },  // per-type validated ranges
  baseMode?: "terrain",               // reserved: later "fixed" + baseY (elevation); only "terrain" accepted now
  supports?: null                     // reserved: later {kind, spacingM, ...}; only absent/null accepted now
}
```
Parser: per-type required params, finite and range-clamped, total footprint must lie inside the area (reuse `MAX_AREA_SIZE_M`, `canPlaceRamp`/`RAMP_OUTSIDE_REASON` logic), unknown `type`/`material` rejected with a clear message, max count (e.g. 200 [ASSUMED]).
- **Migration on read (crest-ramps):** in `parseTerrainSidecar`, after `parseObject`, any `kind:"crest"` object **with** `ramp` becomes a `StructurePiece` of `type:"kicker"` with `material:"ground"` and `params` that reproduce the current geometry **exactly**: `heightM` = lip height, `widthM`, `angleDeg`, `footRadiusM` retained as a legacy `params.footRadiusM` (or derived curve - see profile section), heading unchanged, `centerX/Z` -> `x/z`. Non-ramp crests (domes) stay in `objects` ("crests stay pure terrain"). Serialize writes `structures` and no ramp objects, so any re-save migrates the file; the loader keeps accepting the old shape forever. **Geometry parity test:** for each of the 15 committed ramps (`demo-hills` 5, `feel-test` 3, `playground` 6, `new-area-3` 1) vertex arrays from the new builder equal `buildCrestGeometry`'s old `buildRampGeometry` output exactly (same step, same `rampBaseY`). `tests/feel-test-ramps.test.ts`, `tests/crest-geometry.test.ts`, and the pivot/occlusion/playground tests rely on ramps and must stay green unchanged. `material:"ground"` registers `input.groundSurface` and `ROAD_FRICTION` as today, so handling tests on flat-tarmac test areas are behaviour-identical.
- `AUTHORED_CRESTS_BY_AREA`/`crestsForArea` (code-authored crests for legacy non-terrain maps) are out of scope; keep `AuthoredCrest.ramp` and `buildRampGeometry` alive for them (or route them through the same new builder behind a thin adapter). Do not delete until nothing reads `crest.ramp` (grep: `crest-geometry.ts`, `terrain-format.ts`, `features.ts`, `ramp-align.ts`, `editor.ts`, `terrain-scene.ts`, `crest-view.ts`).

### Collider approach (resolves D-20 open item 3)
**Use one `ColliderDesc.trimesh(positions, indices, TriMeshFlags.FIX_INTERNAL_EDGES)` per piece** [VERIFIED in repo: terrain-scene.ts lines ~180-190 does exactly this for crest ramps with `.setFriction(ROAD_FRICTION)` registered via `surfaceMap.register(handle, surface)`; CLAUDE.md mandates the flag]. Curved profiles are just more vertices on a sampled polyline: keep the existing `RAMP_STEP_M = 0.5` sampling along length (and across width for half-pipe, <= 0.5 m). The existing mesh is a top surface + two side skirts to the ground + a lip face (not a closed solid); keep that shape for kicker/wedge/tabletop, add side walls to the top surface for quarter-pipe (the curved wall) and half-pipe (U cross-section). Convex hulls are the worse choice: a concave quarter-pipe needs a hull decomposition whose seams reintroduce the internal-edge ghost-collision problem, and an exactly-tangent lip is impossible with hull faces. Max triangle estimate per piece: length/0.5 x width/0.5 x 2 -> cap piece length x width so it stays < ~20k triangles [ASSUMED budget; benchmark in plan]. Chunking is unnecessary at piece scale. Wheel rays (`wheelGroundObject`) already hit trimeshes; the wheel-ray patch only shadows the heightfield, not these.
**Vertical walls:** raycast wheels do not treat vertical faces as ground, the chassis collider does; limit quarter/half-pipe wall angle to <= ~80 deg to avoid wheel-ray misses at the top [ASSUMED].

### Rigid deck rule (261116-ryu) - keep as a testable invariant
`rampBaseY(crest, sampler) = sampler(centerX, centerZ)` and top vertex `y = baseY + profileHeight(s)` on **both** edges, identical left/right, while the **ground** vertices of the skirts still sample real terrain. Carry this over as `structureBaseY` for every piece type (`baseMode:"terrain"`). Test: moving terrain under the middle/lip of the piece never changes any top-surface vertex; only the foot-start sample matters. [VERIFIED: crest-geometry.ts `rampBaseY`, `buildRampGeometry`; 261116-ryu summary]
**Gap-jump consequence:** take-off and landing each get their own base from their own foot, so on uneven terrain lip heights differ. Surface this as an editor info-bar warning ("Lips differ by {d} m") when |dy| > 0.5 m; do not auto-adjust (rigid-deck rule wins).

### Per-material grip (D-18): how it works today and the recommended plumbing
Today: `SurfaceMap` is a `Map<colliderHandle, SurfaceType>` (collider objects have no `userData` in this binding; `.parent()?.userData` allocates every tick) [VERIFIED: src/physics/surface.ts header]. `vehicle.ts` (~line 598) loops 4 wheels: `ground = vc.wheelGroundObject(i)`; terrain/patch handles read the paint map by contact point; everything else `surface = surfaces.map.lookup(ground?.handle)`; then `profile = surfaces.profiles[surface]` x `classGripScale[surface]`, blended toward target, applied via `setWheelFrictionSlip` / `setWheelSideFrictionStiffness`. Crest ramps register `input.groundSurface` (grass on real maps) - the "hard-coded grass grip". `SURFACE_TYPES` is a closed 6-enum mirrored in `docs/schemas/road-graph.v1.md` (parity test), written into the `.terrain.bin` header (remap logic exists but it is a format change), required keys in `SurfaceProfiles`, `SurfaceGripScale` (7 vehicle classes), audio loops and fx.
**Recommendation (keep the enum closed):** add to `SurfaceMap` an optional **grip override** table: `registerGrip(handle, {forwardGrip, lateralGrip})` and `gripOverride(handle): SurfaceProfile | undefined` (plain `number` keys, zero per-tick allocation like `lookup`). Register each structure collider with (a) a **base `SurfaceType`** used for fx/audio/class scale (wood -> `dirt_road`, metal -> `tarmac` [ASSUMED mapping; planner/user may tune]) and (b) its own `{forwardGrip, lateralGrip}` from a pure `STRUCTURE_MATERIALS` table in `src/core/structure.ts`. At the single read site in `vehicle.ts`, when an override exists use it instead of `surfaces.profiles[surface]` (class scale still multiplies via the base surface). Starting values within `SURFACE_PROFILE_RANGES` [0.2, 1.2]: wood `{forward 0.9, lateral 0.85}`, metal `{forward 0.6, lateral 0.5}` [ASSUMED; feel-tune later, mirrors how gravel/dirt were tuned]. Also set Rapier collider `setFriction` to match (currently `ROAD_FRICTION`) so the chassis scraping behaves consistently. Keep `profiles` user-tunable panel unaffected. Test with the existing fake-world style of `tests/surface-scene.test.ts` / `surface.test.ts`: a registered override collider yields the override profile, an unregistered one the base.
**Alternative if the user wants real new surfaces everywhere (audio/fx/class tables):** extending `SURFACE_TYPES` is possible but is a format + doc + 7 class tables + audio change; not recommended inside a ramp phase.

### Profile geometry (D-15/D-16), pure and testable
Reuse the proven primitives `rampProfileHeight(s, H, {angleDeg, footRadiusM})` and `rampLengthM`. Define **curve** (percent 0-100) as a mapping onto `footRadiusM` so existing math is reused and the migration is exact:
- `footRadiusM(curvePct, H, angleDeg) = (curvePct/100 * H) / (1 - cos(angle))` for the arc rise share; `curvePct=0` -> radius 0 (straight plank, kink at the foot) and `curvePct=100` -> arc reaches the lip exactly tangent at `angleDeg` (full quarter-curve lip). Pure, monotone, testable (profile height at lip = H; slope at lip = tan(angle); length decreases as angle rises). Migrated ramps keep their literal `footRadiusM` (store `legacyFootRadiusM`, parser accepts either `curvePct` or `legacyFootRadiusM`; builder prefers legacy when present) - this is the migration-exactness guarantee.
- **kicker:** concave arc + straight at `angleDeg` up to `heightM`, lip face (today's ramp).
- **wedge:** straight plane, `curvePct` fixed 0 (size only; angle derived from height/length).
- **tabletop / gap jump:** take-off kicker + flat deck of `lengthM` (tabletop) **or** take-off + `gapM` void + mirrored landing (gap jump; `landing:on` creates the second piece, heading + pi, lips `gapM` apart on one axis). Represent as two linked pieces with a shared `groupId` (reserved in the schema) so deleting one prompts the other, or as one piece with `landing` params - recommend **two independent pieces + `groupId`** so each keeps its own rigid base and collider (fewer special cases, aligns with D-20 "pieces").
- **quarter-pipe:** circular arc `y = R - sqrt(R^2 - s^2)` for `s in [0, R]`, capped at 80 deg; `heightM` = rise.
- **half-pipe:** quarter-pipe cross-section mirrored across width (U profile in lateral axis), length along heading; `radiusM` param.
All profiles sample into a generic `(columns x rows)` height grid -> one builder generates top surface + skirts, so adding track pieces later (banked curves) is "another profile function". Unit tests: lip height, tangent continuity (no step at arc/line join), length, monotonic height, triangle winding CCW from +Y (reuse `expectAllTrianglesCCW` convention from `tests/road-geometry.test.ts`), top vertices independent of terrain, ground vertices on terrain.

### D-17 snapping: concrete, testable rules (all pure, in `tools/terrain-editor/structure-snap.ts`)
Constants: `SNAP_ANGLE_RAD = 15 deg`, `SNAP_DIST_M = 4`, gap default 12 m [ASSUMED values; UI-SPEC specifies 15 deg]. Each rule is a pure function returning `{x, z, headingRad, applied: string[]}`; Alt-held bypasses all (UI-SPEC).
1. **Terrain (foot):** not a transform edit - the model itself: `baseY = terrainHeight(x, z)` at the foot start (rigid deck). Test: base follows the sampler at the foot only. Info bar lists "terrain".
2. **Line:** build candidate bearings: (a) every start point's yaw -> bearing, (b) gate/checkpoint headings of the selected route (yaw -> bearing via the new converter), (c) tangent of the nearest road edge within 30 m (`nearestEdgeHeading` exists in `terrain-drive-setup.ts`, YAW-returning; convert), (d) headings of other pieces and their reverse (+pi). If the drag heading is within `SNAP_ANGLE_RAD` of a candidate (smallest delta wins, ties -> earlier list order), snap `headingRad` to it. Reuse `wrapHeading`, `headingToward` from `ramp-align.ts`.
3. **Pieces:** for each other piece P, take P's centre-line (reuse `centreLineEnds`, `slideOntoLine`); if the new foot is within `SNAP_DIST_M` of the extension of P's line beyond its lip, slide laterally onto the line (sideways only) and, if "gap jump" is on, place the longitudinal position so lips are exactly `gapM` apart and set heading to P's heading + pi (landing). Otherwise no change.
4. Existing `alignRamp` modes (`face`, `faceEach`, `match`, `lineUp`) stay as explicit commands; generalise their signature from `AuthoredCrest` to a `StructurePiece` projection (`x, z, headingRad`), keep all their tests.
**Undo:** snapping happens **before** commit, so a gesture is exactly one `StrokeDiff{structures:{before,after}}` (placing a gap-jump pair = one diff with both pieces; edits via value boxes use `amendTop` like the 07.1.3 steppers). Tests: placement produces one undo step; undo restores the exact prior array reference/contents; redo re-applies; a gesture refused by `canPlaceStructure` changes nothing and reports the reason.

### Materials/textures (D-14/D-18) - code-driven
`MeshStandardMaterial` per material with a procedural `CanvasTexture` (wood: horizontal plank stripes `#8A5A2B`/`#6F4521` with plank gaps; steel: `#8E959E`/`#6B727B` with rivet dots, UI-SPEC colours), `RepeatWrapping`, UVs from (s, lateral) in metres so planks are ~0.2 m. Visible frame/side panels: extra non-collider meshes (posts/side panels as boxes) generated by the same builder; **visual only** (colliders are the single trimesh). Shared geometry builder between game and editor ghost (like `crest-view.ts`). Texture memory is small (power-of-two 256^2, generated once per material). `metalness` for steel ~0.6 with `roughness` 0.5 [ASSUMED look].

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Surface grip per collider | New physics hook | `SurfaceMap` + one override table at the existing read site | Zero-alloc, already unit-tested pattern |
| Collider seams | Convex hull sets | `trimesh` + `FIX_INTERNAL_EDGES` | Documented project rule |
| Press-drag placement | New gesture class | `createDragGesture` (`place-tool.ts`) | Kind-agnostic by design |
| Undo | New history system | `StrokeDiff` + `applyStrokeDiff` extension | 50-deep, amendTop already exists |
| Dev-server safe IO | New plugin | Existing `writeAtomic`, `readBodyCapped`, `isSafeAreaId`, `safeMessage` | Hardened (T-04.2-33/34/37, WR-01..07) |
| PB storage safety | Raw `JSON.parse` of localStorage | Pattern in `medal-persistence.ts` (try/catch, whitelist, finite checks) | Never crash on bad data |
| Time/medal timing | New timer | `createMedalTiming` (`medals:false` path) | Sim-time, first-movement start, penalty, sectors |
| Ramp profile math | New curve code | `rampProfileHeight`/`rampLengthM`/`rampBaseY` | Already tuned and tested |
| Heading conversions | Ad-hoc atan2 at call sites | `src/core/heading.ts` (+ new `bearingFromYaw`) | The two conventions are a known bug source (07-04 deviation note) |
| Dev id/path validation | Regex at each use | `isSafeAreaId` + `resolveStagesFile` | One audited place |

## Runtime State Inventory

Applies to the crest-ramp -> structure migration only (rename/migration of a stored kind).

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | 15 committed crest-ramps in `public/maps/{demo-hills(5), feel-test(3), playground(6), new-area-3(1)}.terrain.json` [VERIFIED: grep `"ramp"`]; user-authored maps on the user's disk may hold more | Code edit: loader migrates on read (no data migration required to keep working). Optional one-off re-save of committed maps to the new shape (a script or editor re-save) - do via a tested converter, and keep tests on old files too. |
| Live service config | None - no external services | None |
| OS-registered state | None | None |
| Secrets/env vars | None | None |
| Build artifacts | `src/core/authored-maps.generated.ts` (generated registry of authored maps; not ramp data) | None expected; confirm the generator does not embed crest data (grep) |
| Browser localStorage | `heat-street.medals.v1` keyed by course id - unaffected by ramps; new `heat-street.stage-bests.v1` is additive | None |

## Common Pitfalls

### Pitfall 1: `nearestRoadNode` on an empty graph
**What goes wrong:** `TypeError: Cannot read properties of undefined (reading 'id')`. **Why:** `nodes[0]` is `undefined` when a terrain map has no roads. **Avoid:** stage coordinator never calls it; also change it to return `-1` for no nodes (guarded by `updateProgress`). **Warning sign:** crash on first tick of a road route/stage on a roadless map.

### Pitfall 2: `main.ts` hard failures for missing artifacts
`fetchArtifactText(MAP_MEDALS_URL)` throws on 404 and `no medal reference for course` throws. For stage mode these paths must not run (stage mode must not require routes/medals). Also `buildNavigationGraph(graph)` on an empty graph is fine (empty ngraph) but `validateCourseRoutes` must not be invoked for stage mode. Structure the new branch so `?mode=stage` bypasses the routes block entirely.

### Pitfall 3: Two heading conventions
Gate `headingRad` (YAW) vs ramp heading (BEARING) vs `race-state` heading (BEARING). A wrong conversion turns gates 90 degrees or mirrors them. Pin in schema doc, add converter + round-trip tests, and a test that a car driven along `forwardFromYaw(h)` crosses its gate and one driven backwards does not.

### Pitfall 4: Axis-aligned `containsCheckpoint`
Rotated gates would be wrong boxes. Use the plane-crossing test (Pattern 2).

### Pitfall 5: `main.ts` mode/params and spawn
`modeParam` is read near line 332 and defaults to p2p; add `stage` explicitly. `?stage=<id>` strict `/^[a-z0-9-]{1,40}$/`; unknown id -> first stage + console.warn. Stage start beats `?at=`/`?start=`: pass the stage start as `spawnOverride` (`resolveStartPose` result shape `{x,z,headingRad}` yaw) only when stage mode resolved. Restart must reset to the stage start, not `scene.defaultSpawnPose` if those can differ (they should not, since spawnOverride seeds it).

### Pitfall 6: `?mode=stage` on legacy maps
Fall back to free drive with `console.warn` (D-08). Implement the check on `isTerrain` and file presence. Note `main.ts` builds `freeDriveCoordinator` only when `rd === undefined && freeDriveGrid !== undefined`; keep that path for the fallback.

### Pitfall 7: Time and penalty bookkeeping
`timing.update({penaltySec})` takes `max(penaltySec, input)`; `respawn()` in the coordinator mirrors `race-coordinator`: `state.respawn()` (+5 s) then `timing.update`. Restart resets penalty. Do not call both `timing.respawn()` and `update({penaltySec})` or the penalty doubles.

### Pitfall 8: Ramp rigid-deck regression
Any new builder that samples terrain per vertex for the top surface reintroduces the "ramp copies bumps" bug fixed in 261116-ryu. The invariant test (Profile section) guards it.

### Pitfall 9: Class spawn clearance
Respawn y uses `heightAt + 0.6`; tall classes (truck 1.3, monster 2.1, buggy 1.35) get lift from `main.ts`'s `scene.resetVehicle` wrapper per the free-drive coordinator comment. Confirm the wrapper applies to the stage coordinator's `resetVehicle` calls (it should, since `scene` is the shared object); otherwise tall classes spawn on the bump stop.

### Pitfall 10: Dev server Windows paths and message leakage
Keep `safeMessage` on all error bodies; the project path contains a space (`d:\Projects 2\...`), which `safeMessage` handles; do not echo raw `Error.message` from fs. Use `writeAtomic` only.

### Pitfall 11: Editor re-seat on terrain edits
Ramps are "seated on the ground at build time" and rebuilt on sculpt (`rebuildRamps()`); structures need the same hook, and stage markers must re-seat to terrain height after sculpting. Stage medals can become unfair after terrain edits: show the non-blocking save notice when `medals` exist (UI-SPEC).

### Pitfall 12: Pre-existing failing test
`tests/demo-hills.test.ts` max-slope was failing before this phase (261116-ryu summary). Record the baseline so the phase gate does not blame new work. [CITED: .planning/quick/261116-ryu summary]

## Code Examples

### Gate-crossing core (sketch; sim-time-free, pure)
```typescript
// Source: derived from src/core/heading.ts conventions (forward = (-sin h, -cos h))
export function crossedGateForward(
  gate: { x: number; z: number; headingRad: number; widthM: number },
  prev: { x: number; z: number },
  cur: { x: number; z: number },
): boolean {
  const fx = -Math.sin(gate.headingRad), fz = -Math.cos(gate.headingRad);
  const rx = Math.cos(gate.headingRad), rz = -Math.sin(gate.headingRad);
  const sp = (prev.x - gate.x) * fx + (prev.z - gate.z) * fz;
  const sc = (cur.x - gate.x) * fx + (cur.z - gate.z) * fz;
  if (!(sp < 0 && sc >= 0)) return false;
  const t = sp / (sp - sc);
  const px = prev.x + (cur.x - prev.x) * t, pz = prev.z + (cur.z - prev.z) * t;
  return Math.abs((px - gate.x) * rx + (pz - gate.z) * rz) <= gate.widthM / 2;
}
```

### Empty-graph guard
```typescript
// src/core/navigation.ts nearestRoadNode: return -1 when there are no nodes
if (navigation.roadGraph.nodes.length === 0) return -1;
```

### Curve-to-foot-radius mapping (kicker)
```typescript
export function footRadiusForCurve(curvePct: number, heightM: number, angleDeg: number): number {
  const rise = (Math.min(100, Math.max(0, curvePct)) / 100) * heightM;
  const theta = (angleDeg * Math.PI) / 180;
  return theta > 0 ? rise / (1 - Math.cos(theta)) : 0;
}
```

### Stage PB key
```typescript
const KEY = /^[a-z0-9-]{1,64}:[a-z0-9-]{1,40}:[a-z]{2,16}$/;
export const stageBestKey = (area: string, stage: string, cls: VehicleClassId) => `${area}:${stage}:${cls}`;
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Ramp = crest object with `ramp` sub-spec (grass grip) | Structure piece with type/material/params | This phase (10.1) | Own format, materials, snapping; crest = dome only |
| Exactly 2 courses per map | 0..N routes (relaxed) | This phase | Editor can author races; tests updated |
| Course = road-graph-bound checkpoints | Stage gates = world positions, ordered, oriented | This phase | Roadless maps playable |

**Deprecated/outdated:** `AuthoredCrest.ramp` for terrain maps (kept for legacy code-authored areas only).

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Gate height window `[terrainY-2, terrainY+12]` | Pattern 2 | Cars airborne over a gate may miss/hit it; low (tune) |
| A2 | Material grip start values (wood 0.9/0.85, metal 0.6/0.5) and base-surface mapping (wood->dirt_road, metal->tarmac) | Per-material grip | Feel; user/feel-session may retune; easy |
| A3 | Snap thresholds (15 deg per UI-SPEC; `SNAP_DIST_M` 4 m; default gap 12 m) | D-17 | Feel only |
| A4 | Max 20 authored road routes, max 200 structures, triangle budget ~20k/piece | Formats | Limits too tight/loose; trivial to change |
| A5 | `DEFECT_COORDINATES` check should apply only to `juliette-ga` | D-12 | If other maps relied on it, a defect clearance check is skipped; low |
| A6 | Two independent pieces + `groupId` for gap jumps (vs one combined piece) | Profile | Planner may prefer combined; moderate rework |
| A7 | Plane-crossing gate test replaces the brief's "box + detectCheckpointHit" | Pattern 2 | Deviates from brief D4 wording but meets its intent (brief allows an oriented test); confirm with user at review |
| A8 | Stage medals display deferred; no-medal path first; explicit-threshold support in `medal-timing` is an open decision (stage medals are `gold/silver/bronze` seconds, `createMedalTiming` derives thresholds from one reference x `MEDAL_BANDS` and has an `ace` band) | Open Questions | Medal row semantics on stages with medals |
| A9 | `structures` as optional sidecar key without bumping `TERRAIN_FORMAT_VERSION` | D-19 | If an old game build loads a new file it ignores structures (ramps vanish); acceptable single-user project |
| A10 | `?route=<id>` URL param name and `?mode=p2p|circuit` fallback to first route of that mode | D-12 | Naming only |
| A11 | Wall-angle cap 80 deg for pipes | Collider | Wheel-ray behaviour on steep walls unverified; needs a playtest spike |

## Open Questions (RESOLVED)

1. **Medal thresholds for stages that do have medals.**
   - Known: `stage.medals = {goldSec, silverSec, bronzeSec, vehicle}`; `createMedalTiming` takes one `referenceTimeSec` and fixed `MEDAL_BANDS` (ace 0.9, gold 1, silver 1.15, bronze 1.35).
   - Unclear: whether recorded medals map via a reference (gold = reference) or explicit thresholds.
   - Recommendation: Phase 10 ships full support for no-medal stages and parse/validate/serialize of `medals`; add an additive optional `thresholds` config to `createMedalTiming` only in the later "record medals" step with the user (stage 7). Until then a stage with `medals` present and matching class runs with `medals:false` plus a console note.
2. **Does `results-view` suppress the "UNEARNED" text path for no-medal stages?** Unverified (only the exports were read). Plan task: read `results-view.ts` `showCompletion`, add a model test, change if needed.
3. **Do other tests assert `RaceSnapshot.mode` exhaustiveness?** Widening to `"stage"` may break a `switch`. Plan task: `grep -rn "snapshot.mode\|RaceSnapshot" src tests` and fix.
4. **Wall/lip behaviour of steep pipe walls under the raycast vehicle** - needs a short physics spike test in 10.1 (drive a class up a quarter-pipe at speed in a Rapier test; see `tests/feel-test-ramps.test.ts` for the pattern).
5. **Can the user's own authored maps hold crest-ramps that this migration must preserve?** Yes by design (migration on read); no way to enumerate them. The tests plus the on-read converter cover it.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node + npm | all tests/build | assumed present (repo builds) | not probed [ASSUMED] | - |
| vitest | tests | in package.json | 5.0.0 | - |
| Vite dev server | editor + `/__terrain/*` API | in package.json | 8.2.2 | - |
| Browser (human check) | in-game stage run | user's | - | Human check is manual (3 min, per brief) |

No external services or CLI tools beyond the repo's own toolchain. No missing dependencies.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest 5.0.0, environment `node` (`vitest.config.ts`; `resolve.mainFields` workaround for Rapier) |
| Config file | `d:\Projects 2\Heat Street\vitest.config.ts` (excludes `.claude/worktrees/**`) |
| Test locations | `tests/*.test.ts` (core/gameplay/physics) and co-located `tools/terrain-editor/*.test.ts` (editor pure modules) |
| Quick run command | `npx vitest run tests/stage.test.ts tests/stage-run.test.ts tests/stage-persistence.test.ts` |
| Full suite command | `npm run check` (typecheck + biome + vitest) |
| Layering guard | `tests/layering.test.ts` (keeps `src/core/` pure) |

### Phase Requirements -> Test Map
| Req / Decision | Behavior | Test Type | Automated Command | File Exists? |
|---|---|---|---|---|
| MODE-04 / D-02 | Stage parser: round-trip; rejects bad version, id pattern, duplicate ids, names, non-finite, out-of-extent, widths outside 8..60, 0 or >40 gates, >20 stages, medals not strictly gold<silver<bronze | unit | `npx vitest run tests/stage.test.ts` | Wave 0 |
| D-03 | In-order pass; out-of-order ignored; reverse crossing ignored; sideways-slide crossing counts; lateral miss ignored; rotated gates at 0/45/90 deg; finish only after all gates; no fire on first tick | unit | `npx vitest run tests/stage-run.test.ts` | Wave 0 |
| D-05 | `respawnPose` after 0, 1, all gates: position, yaw, height = heightAt + clearance; reset clears progress; penalty +5 s | unit | same | Wave 0 |
| D-04/D-06/D-10 | Coordinator with fakes: no wrong-way, no-medal timing (`medals:false`), gate = sector split, completion published once, restart/respawn commands, empty road graph never throws | unit | `npx vitest run tests/stage-coordinator.test.ts` | Wave 0 |
| D-07 | PB key per area+stage+class; merge only improves; malformed JSON / bad keys / non-finite / unknown class dropped; all classes saved incl. non-medal; quota exception swallowed | unit | `npx vitest run tests/stage-persistence.test.ts` | Wave 0 |
| D-08 | `?mode=stage` allowlist, `?stage=` pattern, legacy-map fallback decision as a pure resolver `resolveStageMode(search, isTerrain, stages)` | unit | `npx vitest run tests/stage-mode.test.ts` | Wave 0 |
| D-09 | Dev API: `resolveStagesFile` rejects bad ids/traversal; PUT validator rejects invalid bodies with the parser message; GET missing -> 404 | unit | `npx vitest run tools/terrain-editor/paths.test.ts tools/terrain-editor/stages-api.test.ts` | Wave 0 |
| D-09/D-11 | Editor pure ops (`stages.ts`): add/insert/move/turn/width/reorder/delete/rename return new arrays, never mutate, enforce 40-gate and 20-stage caps, `nextGateId` | unit | `npx vitest run tools/terrain-editor/stages.test.ts` | Wave 0 |
| undo | `StrokeDiff` stages part: apply before/after, `stagesChanged` flag | unit | `npx vitest run tests/terrain-undo.test.ts` (existing file extended) | check; extend |
| D-12 | `parseCourseData` accepts 0, 1, N courses and relaxed counts/laps; still rejects dup ids, bad node/edge; `parseMedalReference` with partial/absent medals; routes with no medals run time-only | unit | `npx vitest run tests/course-data.test.ts tests/medal-reference.test.ts` (update) | exists; update |
| D-13 | `nearestRoadNode` empty graph returns -1; `updateProgress(-1)` no-op; off-node checkpoint resolves to nearest node; `validateCourseRoutes` skips defect check for non-juliette | unit | `npx vitest run tests/route-validation.test.ts tests/navigation.test.ts` | extend |
| heading | `bearingFromYaw`/`yawFromBearing` round trip; gate/start yaw -> ramp bearing | unit | `npx vitest run tests/heading.test.ts` | exists; extend |
| D-19 migration | Old sidecar with ramp crest loads as structure `kicker/ground` with identical vertex arrays; domes stay crests; serialize emits `structures`; old+new both load; unknown `type`/`material` rejected | unit | `npx vitest run tests/structure.test.ts tests/terrain-format.test.ts` | Wave 0 / extend |
| D-15/D-16 profile | Per shape: lip height, tangent continuity, length, monotonic, CCW winding, curve 0 vs 100 limits, rigid-deck invariant, skirt ground vertices on terrain | unit | `npx vitest run tests/structure-profile.test.ts` | Wave 0 |
| D-17 snapping | Terrain foot, line-snap within/outside 15 deg (tie order), yaw/bearing candidate conversion, piece line-up + gap exact, Alt bypass, one undo step per gesture, refusal changes nothing | unit | `npx vitest run tools/terrain-editor/structure-snap.test.ts` | Wave 0 |
| D-18 grip | `SurfaceMap` grip override registered/unregistered/unregister-after-removal; material table within `SURFACE_PROFILE_RANGES` | unit | `npx vitest run tests/surface.test.ts tests/structure-materials.test.ts` | extend / Wave 0 |
| D-18 physics | A wheel on a wood vs metal piece reads the right profile (fake world as in `surface-scene.test.ts`) | integration | `npx vitest run tests/structure-scene.test.ts` | Wave 0 |
| regression | `feel-test-ramps`, `crest-geometry`, `playground-map`, `pivot-*`, `occlusion` unchanged and green after migration | integration | `npx vitest run tests/feel-test-ramps.test.ts tests/crest-geometry.test.ts tests/playground-map.test.ts` | exists |
| layering | New `src/core` files import no three/rapier/DOM | unit | `npx vitest run tests/layering.test.ts` | exists |
| Human | 3-minute stage drive on `demo-hills` (brief "Human check"); ramp feel check | manual | - | manual-only: handling feel/visuals cannot be unit-tested |

### Sampling Rate
- **Per task commit:** the single new/changed test file via `npx vitest run <file>`.
- **Per wave merge:** `npm run check`.
- **Phase gate:** `npm run check` green (modulo the recorded pre-existing `tests/demo-hills.test.ts` failure) before `/gsd-verify-work`.

### Wave 0 Gaps
- [ ] `tests/stage.test.ts`, `tests/stage-run.test.ts`, `tests/stage-persistence.test.ts`, `tests/stage-coordinator.test.ts`, `tests/stage-mode.test.ts`
- [ ] `tools/terrain-editor/stages.test.ts`, `tools/terrain-editor/paths.test.ts` (if absent), `tools/terrain-editor/stages-api.test.ts`
- [ ] 10.1: `tests/structure.test.ts`, `tests/structure-profile.test.ts`, `tests/structure-scene.test.ts`, `tools/terrain-editor/structure-snap.test.ts`
- [ ] Shared fixtures: a tiny flat `TerrainGrid` + empty `RoadGraph` fixture (copy the approach in `tests/fixtures/terrain-race-harness.ts`)
- [ ] No framework install needed.

## Security Domain

`security_enforcement` is not set to false in `.planning/config.json` (absent = enabled). Surface is small: a dev-only file API and localStorage/URL parsing.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | dev-only local tool, `apply: "serve"` (not in prod build) |
| V3 Session Management | no | - |
| V4 Access Control | no (dev-only) | plugin only mounted by the dev server |
| V5 Input Validation | yes | hand-rolled strict parsers (`parseStageData`, structure parser, PB parser); `isSafeAreaId`/stage-id regexes; body cap `readBodyCapped`; URL params allowlisted (`?stage=`, `?route=`, `?mode=`, `?car=`) |
| V6 Cryptography | no | none used; no secrets |
| V12 Files and Resources | yes | `resolveStagesFile` confined under `public/maps` via `startsWith(mapsDir + sep)`, atomic temp+rename write, error text through `safeMessage` |

### Known Threat Patterns

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Path traversal via area/stage id in `/__terrain/stages/<id>` | Tampering | `isSafeAreaId` regex + resolved-path prefix check |
| Oversized PUT body | DoS | `readBodyCapped(MAX_JSON_BYTES)`, 413 handling already present |
| Malformed/hostile `localStorage` PB blob | Tampering | try/catch, key regex, allowlisted class via array `find`, finite checks; never crash |
| Prototype-key injection (`__proto__`) in JSON objects | Tampering | `Object.hasOwn`-based `required`; copy known fields only; never spread untrusted objects |
| URL param injection (`?stage=`, `?route=`) | Tampering | strict patterns, unknown -> default + `console.warn` |
| Path leakage in error bodies | Info disclosure | `safeMessage` (handles Windows paths with spaces) |
| Unbounded geometry from structure params | DoS | per-type param ranges, area-inside check, triangle budget, piece count cap |

## Scope and plan breakdown

**Recommendation: split. Phase 10 (stages + Route tool + road routes) and a follow-on Phase 10.1 (ramps/structure pieces).** The two halves share only the editor sidebar infrastructure and a heading converter; ramps touch `terrain-format`, physics, render, undo, editor, and 15 committed ramps, which is a risky second subsystem. CONTEXT explicitly prefers splitting over cramming. The brief's stages 1-8 map to Phase 10 plans nearly 1:1.

### Phase 10 (about 7 plans)
| # | Plan | Wave | Depends |
|---|------|------|---------|
| 10-01 | `stage.ts` parser/serializer + `stage-persistence.ts` + heading converters + docs/schemas/stage.v1.md (tests first) | 1 | - |
| 10-02 | `stage-run.ts` (oriented crossing, ordered progress, respawn pose) (tests first) | 1 | - |
| 10-03 | `stage-coordinator.ts`, `stage-view.ts` (gates, <= 3 draw calls), HUD/results tweaks (`RaceSnapshot.mode`, `GATE n/total`, no-medal row), `nearestRoadNode` empty guard | 2 | 01, 02 |
| 10-04 | `main.ts` wiring: `mode=stage`, `?stage=`, fetch, spawn override, legacy fallback, PB save; stage-mode bypasses routes block | 3 | 03 |
| 10-05 | Dev-server API (`/__terrain/stages|routes/<id>`), `stages.ts` pure ops, `StrokeDiff` stages part | 3 | 01 |
| 10-06 | Editor Route tool UI (Place menu entry 8, Routes panel, markers via `stage-view`, Test stage, warnings, medal notice) - UI-SPEC is approved | 4 | 03, 05 |
| 10-07 | Road routes: relax `parseCourseData`, optional medals, `?route=`, node/edge derivation, validate relaxation, editor road Kinds; `docs/stages.md`; `npm run check` gate | 5 | 06 |
Stage 7 (medal recording) stays out of the plans (done with the user).

### Phase 10.1 (about 6 plans)
| # | Plan | Notes |
|---|------|-------|
| 10.1-01 | `structure.ts` format + parser + crest-ramp migration + `terrain-format` wiring + docs (geometry parity tests) | Wave 1 |
| 10.1-02 | `structure-profile.ts` geometry for 5 shapes + invariants (tests first) | Wave 1 |
| 10.1-03 | Physics: trimesh colliders, `SurfaceMap` grip override, vehicle read site, material table | Wave 2 |
| 10.1-04 | Render: `structure-view.ts` procedural wood/steel, frame/side panels, game + editor ghost | Wave 2 |
| 10.1-05 | Editor: shape/material/value-box panel, `structure-snap.ts`, undo, generalise `ramp-align`, re-seat on sculpt | Wave 3 |
| 10.1-06 | Remove/redirect crest-ramp paths, re-save committed maps, regression suite, docs, seed note, `npm run check` | Wave 4 |
If the user prefers one phase, the same 13 plans fit; ramps should still be ordered after the stage plans so stages ship first.

## Sources

### Primary (HIGH confidence) - read directly in this repo this session
- `src/core/course.ts`, `race-state.ts`, `navigation.ts`, `checkpoint-detection.ts`, `checkpoint-pose.ts`, `medal-timing.ts`, `medal-persistence.ts`, `medal-reference.ts`, `vehicle-class.ts`, `surface-types.ts`, `surface-tuning.ts`, `ground-surface.ts`, `heading.ts`, `terrain-format.ts` (sidecar parse/serialize), `terrain-undo.ts`, `terrain-brush.ts` (`StrokeDiff`), `terrain-drive-setup.ts`, `crest-geometry.ts` (ramp profile/builder/`rampBaseY`)
- `src/gameplay/race-coordinator.ts`, `free-drive-coordinator.ts`; `src/physics/terrain-scene.ts`, `surface.ts`, `vehicle.ts` (grip read site); `src/render/crest-view.ts`; `src/hud/minimap.ts`, `race-hud.ts`, `results-view.ts` (exports)
- `src/main.ts` (route/mode/spawn/coordinator wiring)
- `tools/terrain-editor/vite-plugin.ts`, `paths.ts`, `start-points.ts`, `place-tool.ts`, `ramp-align.ts`, `features.ts` (exports), `editor.ts` (ramp sections)
- `.planning/phases/10-off-road-stages/10-CONTEXT.md`, `10-UI-SPEC.md`, `.planning/plans-ahead/04-off-road-stages.md`, `.planning/seeds/elevated-stunt-tracks.md`, `.planning/quick/261116-ryu*/SUMMARY`
- `package.json`, `vitest.config.ts`, `.planning/config.json`, `public/maps/*.terrain.json` (grep for committed ramps)

### Secondary / Tertiary
- None used (no external web lookups were needed; no new libraries).

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - no new packages; versions read from package.json/CLAUDE.md.
- Stages architecture (parser, run, coordinator, persistence, API, undo): HIGH - mirrors code read end to end.
- Road-route relaxation touch points: HIGH on the list, MEDIUM on completeness (tests list found by grep; some consumers like `ai-*` tests may assume 2 courses).
- Ramp format/migration/collider: HIGH (existing pattern). Grip override plumbing and snapping thresholds: MEDIUM (design, unplayed).
- Pitfalls: HIGH.

**Research date:** 2026-11-23
**Valid until:** 2026-12-23 (stable internal code; revalidate if `main.ts` or `terrain-format.ts` change materially before planning)
