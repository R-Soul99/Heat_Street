---
phase: quick-261110-rdx
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - tests/terrain-road-lock-golden.test.ts
  - tests/terrain-road-lock.test.ts
  - tests/terrain-format.test.ts
  - tests/terrain-undo.test.ts
  - tests/terrain-overlay.test.ts
  - tests/road-save-guard.test.ts
  - src/core/terrain-road-lock.ts
  - src/core/terrain-brush.ts
  - src/core/terrain-undo.ts
  - src/core/terrain-format.ts
  - src/core/terrain-graph.ts
  - src/core/terrain-road.ts
  - src/core/terrain-overlay.ts
  - tools/terrain-editor/tool-dispatch.ts
  - tools/terrain-editor/tool-dispatch.test.ts
  - tools/terrain-editor/save-guard.ts
  - tools/terrain-editor/vite-plugin.ts
  - tools/terrain-editor/editor.ts
  - tools/terrain-editor/index.html
autonomous: true
requirements: [QUICK-261110-rdx]

must_haves:
  truths:
    - "With no road unlocked, every sculpt / road / erase / smooth result is byte-identical to the pre-change code (golden hash test recorded BEFORE any source edit still passes; all existing tests pass unchanged)"
    - "Every road (graph edge) loads and is drawn LOCKED by default; old .terrain.json files without the new field load as all-locked; saving an all-locked area writes a sidecar byte-identical to today's"
    - "An unlocked road is not held by the road mask: raise/smooth/flatten/block/stamp/smooth-area over it move the terrain under it; a locked road beside it does not move"
    - "Re-grade (selected unlocked road, or all unlocked) re-samples the terrain, rebuilds the profile with the existing pipeline (pins, 15..80 m vertical curve, banking, levelRoadBand, limitSlope with road vertices fixed) and writes graph y back from the levelled terrain, as ONE undo step"
    - "A re-graded road meeting a locked road is pinned to the locked road's node height; the locked road's graph y and its terrain vertices never change; two re-graded roads sharing a node get one shared height"
    - "Save (and therefore Drive here) is REFUSED, client-side and in the dev-server PUT, while any unlocked road's graph y differs from the terrain by more than 0.05 m; the message says to Re-grade or Lock it"
    - "Undo/redo restores heights, graph y AND lock state for lock toggles, re-grades and strokes"
    - "UI (not browser-verified by the executor: the Chrome tool cannot reach localhost on this machine): Lock tool (L) toggles the clicked road, Lock all / Unlock all / Re-grade selected / Re-grade all unlocked buttons, locked roads drawn light grey, unlocked orange, selected cyan, status line reports max height change and max grade. User runs the manual steps in <verification>."
  artifacts:
    - path: "src/core/terrain-road-lock.ts"
      provides: "Pure lock-set helpers: normaliseUnlocked, isUnlocked, carryUnlocked, staleUnlockedEdges, nearestEdgeWithin, STALE_ROAD_TOL_M"
    - path: "src/core/terrain-road.ts"
      provides: "Lock-aware roadVertexMask (optional 5th arg), regradeRoads, setRoadLock, shared grading internals reused by applyRoadStroke"
      exports: ["regradeRoads", "setRoadLock", "roadVertexMask", "applyRoadStroke"]
    - path: "src/core/terrain-format.ts"
      provides: "Optional sidecar field unlockedEdgeIds (absent = all locked), strict validation, no version bump"
      contains: "unlockedEdgeIds"
    - path: "tests/terrain-road-lock-golden.test.ts"
      provides: "Pre-change golden hash of a canned edit sequence"
    - path: "tests/terrain-road-lock.test.ts"
      provides: "Mask, sculpt, re-grade, junction pin, lock, carry, stale, undo tests"
  key_links:
    - from: "tools/terrain-editor/tool-dispatch.ts heightOpOptions"
      to: "roadVertexMask(..., free)"
      via: "unlocked edge set passed as the 5th argument"
      pattern: "roadVertexMask\\(area\\.grid, area\\.paint, area\\.graph, win, "
    - from: "src/core/terrain-undo.ts applyStrokeDiff"
      to: "area.unlockedEdgeIds"
      via: "diff.lock before/after"
      pattern: "diff\\.lock"
    - from: "tools/terrain-editor/vite-plugin.ts validateAreaPair"
      to: "save-guard assertGradedRoads"
      via: "call after loadTerrainArea"
      pattern: "assertGradedRoads"
    - from: "tools/terrain-editor/editor.ts save()"
      to: "staleRoadBlockMessage"
      via: "refuse before PUT"
      pattern: "staleRoadBlockMessage"
---

<objective>
Add per-road LOCK/UNLOCK state and a "Re-grade road to terrain" action to the terrain editor.
Locked (the default for every existing and new road) keeps today's behaviour exactly. Unlocked
roads stop being held by the road mask so the user can reshape the ground under them, then
Re-grade (or Lock, which re-grades first if needed) puts the road back on the new terrain
through the existing road pipeline.

Purpose: lets the user re-shape relief around roads already drawn (feeds the world-builder
work of grading roads onto a relief; note `prompts/world-builder-plan.md` does not exist in
the repo, the nearest doc is `prompts/map-authoring-plan.md`).
Output: pure core in src/core (tested with vitest), format field, undo support, editor UI.
</objective>

<design_decisions>
Decisions taken where the request was open. The user should review these.

DD-1 Lock unit = graph EDGE id. Reason: edge ids are the only stable road identity the graph,
undo and sidecar already carry (stable, never reused, D-16). Strokes are not recorded anywhere,
and a road crossed by a later stroke is already two edges. Consequences:
  - Split pieces INHERIT the lock state of the edge they were split from (stroke crossing,
    T join, partial erase). terrain-graph reports exact parentage (new `splitFrom` result field)
    so no geometry guessing.
  - Edges removed (erase, replace-mode overwrite) drop out of the unlocked list.
  - Edges created by a new road stroke are always LOCKED.
  - A road the user thinks of as one line may be several edges after junctions; Lock all /
    Unlock all and Re-grade all unlocked cover that; the Lock tool toggles one edge per click.

DD-2 Storage = list of UNLOCKED edge ids, `unlockedEdgeIds?: number[]` on the area (sorted,
distinct). Absent or empty = everything locked. Sidecar writes the key ONLY when non-empty
(placed after `buildings`), so all-locked areas serialise byte-identically and old files load
unchanged. No formatVersion bump (TERRAIN_FORMAT_VERSION stays 1). Parse is strict like the
rest of the sidecar: must be an array of distinct non-negative integers each matching an edge
id in the graph, else `terrain-format:` failure. The road-graph v1 schema and parseRoadGraph
are NOT touched. The game runtime ignores the field.

DD-3 Stale-graph rule = REFUSE, not auto re-grade. An unlocked edge is stale when any of its
points (or its end nodes) has |graph y - sampleTerrainHeight| > STALE_ROAD_TOL_M = 0.05 m
(well above the 0.01 m save quantisation). Save refuses while any unlocked edge is stale,
in editor save() AND in the dev-server sidecar PUT (validateAreaPair, which already loads
the bin+sidecar pair). Drive here calls save() so it is gated too. Refusal is safer than
auto re-grade because it never silently reshapes terrain at save time. Unlocked roads that are
NOT stale save fine and stay unlocked in the file.

DD-4 Locking a stale unlocked road re-grades it first (same diff), then locks it, so a road can
never become LOCKED with inconsistent graph data and Lock is never a dead end. Locking a
consistent road is a pure flag change. Unlocking is always a pure flag change.

DD-5 Undo: lock changes ride in the existing StrokeDiff as a new optional
`lock: { before: number[]; after: number[] }` snapshot (same first-before / latest-after rule as
the graph snapshot). Lock toggles, Lock all, Unlock all, re-grades and strokes that carry/drop
locks are each ONE undo entry and undo/redo restores heights, graph and lock state together.
This fits the existing model naturally, no caveat.

DD-6 Re-grade inputs per edge: x/z = the edge's own points (topology and ids never change,
only y and lengthM); width = edge.widthM; preset = the ROAD_PRESETS entry matching
edge.roadClass and edge.surface (else roadClass only, else street with
designSpeedKph = edge.speedLimitKph); bank cap = that preset's maxBankDeg (the per-stroke bank
slider value is not stored in the graph, so a highway re-grades at the default 8 degree cap).
Re-grade never touches paint.

DD-7 Re-grade holds everything it is not re-grading: locked roads AND unlocked roads outside
the requested set are held by the mask (inner band and shoulder) and by the limiter. Only the
requested edges' terrain moves.

DD-8 Junction pins per end node of a re-graded edge:
  - node touches any LOCKED edge: pin = node.y (locked roads are consistent by invariant);
    node and locked edge never change.
  - node touches only unlocked edges, some not being re-graded: pin = terrain height at the node
    (the held terrain), and the node y plus every incident edge endpoint y are written to it.
  - node touches only re-graded edges (or is a dead end): pin = mean of each incident edge's
    UNPINNED profile height at that end (pass 1), shared by all of them.
  All profiles are computed from the terrain as it was before the re-grade, then all bands are
  levelled.

DD-9 Lock tool = click (no drag). Click toggles the nearest edge within
max(brush radius, edge half-width + 2 m) and selects it. Alt+click selects without toggling
(for Re-grade selected). Shortcut L (free in TOOL_KEYS and editor shortcuts).

DD-10 Unlocked roads are also not held by a NEW road stroke's shoulder protect / limiter mask
(consistent with "not held"); the stroke's crossing pins still use their graph/terrain heights
exactly as today, and any unlocked road it disturbs simply goes stale until re-graded.
</design_decisions>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@./CLAUDE.md
@.planning/STATE.md
@src/core/terrain-road.ts
@src/core/terrain-graph.ts
@src/core/terrain-brush.ts
@src/core/terrain-undo.ts
@src/core/terrain-format.ts
@tools/terrain-editor/tool-dispatch.ts
@tools/terrain-editor/save-guard.ts
@tests/terrain-road.test.ts

<interfaces>
Existing contracts the executor builds on (extracted, do not re-explore):

src/core/terrain-road.ts
- interface RoadEditTarget { grid: TerrainGrid; paint: PaintMap; groundSurface: SurfaceType; graph: RoadGraph; nextEdgeId: number }
- applyRoadStroke(area, rawPoints, presetId, opts?: { widthM?, maxBankDeg?, replace? }): { diff: StrokeDiff|undefined; newEdgeIds: number[]; warnings: string[] }
  Pipeline today: prepareStrokePolyline -> findStrokeCrossings (pins) -> densify(entries, min(4, max(1, cell/2))) ->
  protect = roadVertexMaskFromPaint + roadVertexMaskFromGraph over reachWindow(xz, roadLevelRadiusM(half,cell)+shoulder) ->
  curveM = clamp(2.4 * designSpeed m/s, 15, 80); roadHeightProfile(grid, xz, { maxGrade: STROKE_GRADE, pins, smoothM: curveM });
  roadBankAngles(xz, preset, bankCap) tapered by distance to nearest pin / BANK_SMOOTH_M ->
  levelRoadBand(grid, xz, heights, banks, half, shoulder, { recorder, protect }) -> paintRoadBand ->
  win = expandWindow(band.window, grid, band.maxDeltaM, MAX_SLOPE_DEG); rec.beforeHeightsWrite(win);
  mask = band.mask OR roadVertexMask(grid, paint, area.graph, win); limitSlope(grid, win, { mask }) (roadViolations -> slopeWarning) ->
  addRoadStroke(state0, centreline with y = sampleTerrainHeight, profile, { replace }) -> ensureDefaultSpawn -> syncNodeHeights -> rec.recordGraph.
- roadVertexMask(grid, paint, graph, area: CellWindow): Uint8Array (paint road flag + levelled radius of every edge)
- private: roadVertexMaskFromGraph(grid, graph, area, into), reachWindow, densify, cumulativeLength, syncNodeHeights, STROKE_GRADE=0.45, BANK_SMOOTH_M=20
- levelRoadBand(grid, pts, heights, banks, halfWidthM, shoulderM?, opts: { recorder?, protect? }): { mask, window, maxDeltaM }  (protect only guards the shoulder blend today)
- eraseRoad(area, x, z, radiusM): { diff, removedEdgeIds, warnings }

src/core/terrain-graph.ts
- addRoadStroke(state, polyline, profile, opts?) -> AddStrokeResult { state, newEdgeIds, junctionNodeIds, reason? }; split pieces: first piece keeps parent id, later pieces get nextEdgeId++
- eraseGraphDisc(state, x, z, r) -> EraseResult { state, removedEdgeIds, spawnLost }; same split-id rule

src/core/terrain-brush.ts
- StrokeDiff { heights?; paint?; graph?: { before: string; after: string; nextEdgeIdBefore; nextEdgeIdAfter } }
- StrokeRecorder { beforeHeightsWrite; beforePaintWrite; recordGraph; commit(): StrokeDiff|undefined }
- HeightOpOptions { roadMask?: (win: CellWindow) => Uint8Array }

src/core/terrain-undo.ts
- UndoTarget { grid; paint; graph: RoadGraph; nextEdgeId: number }
- ApplyResult { heightsWindow?; paintRect?; graphChanged: boolean }
- applyStrokeDiff(area, diff, side); createUndoStack(depth)

src/core/terrain-format.ts
- TerrainSidecar { areaId; name; groundSurface; legacyGlbBuildings; nextEdgeId; graph; objects; buildings }; TerrainArea extends it + grid, paint, colliderSubdiv
- serializeTerrainSidecar(area) (wire key order: kind, formatVersion, areaId, name, groundSurface, legacyGlbBuildings, nextEdgeId, graph, objects, buildings)
- parseTerrainSidecar(text, expectedAreaId, label); loadTerrainArea(bin, sidecarText, id, label)

tools/terrain-editor/tool-dispatch.ts
- type EditArea = RoadEditTarget & UndoTarget; ToolResult { dirtyHeights?; dirtyPaint?; graphChanged; slopeClamped; warnings; status?; previewPoints? }
- heightOpOptions(area) -> { roadMask: (win) => roadVertexMask(area.grid, area.paint, area.graph, win) }
- mergeDiffs(diffs) merges heights/paint/graph for erase strokes; TOOL_KEYS map (H G F P R W E B used)
- editor.ts casts the loaded TerrainArea to EditArea (line ~239) and calls serializeTerrainSidecar(target) in save().

tools/terrain-editor/save-guard.ts: blockingRoadFailures, saveBlockMessage, assertSaveableGraph, SAVE_GUARD_PREFIX "terrain-save:"
tools/terrain-editor/vite-plugin.ts: validateAreaPair(id, bin, sidecarText) -> await loadTerrainArea(...) (runs on sidecar PUT with the on-disk bin)
</interfaces>
</context>

<tasks>

<task type="auto" tdd="true">
<name>Task 1: Golden guard, lock-state data model, format field and undo (tests first)</name>
<files>tests/terrain-road-lock-golden.test.ts, tests/terrain-road-lock.test.ts, tests/terrain-format.test.ts, tests/terrain-undo.test.ts, src/core/terrain-road-lock.ts, src/core/terrain-brush.ts, src/core/terrain-undo.ts, src/core/terrain-format.ts</files>
<behavior>
- Golden: a canned sequence on the UNCHANGED code produces a recorded FNV-1a hash; the same sequence after all changes (with unlockedEdgeIds undefined, and again with []) gives the same hash.
- normaliseUnlocked(ids, graph) returns sorted distinct ids that exist in graph; isUnlocked(area, id).
- carryUnlocked(prev, afterGraph, splitFrom) keeps surviving unlocked ids, adds pieces whose parent was unlocked, drops removed ids.
- staleUnlockedEdges reports an unlocked edge after the terrain under it is raised 1 m, ignores locked edges, ignores deltas <= 0.05 m.
- Format: sidecar without the field round-trips with no unlockedEdgeIds key and the serialised text equals the pre-change text; with [3, 1] it serialises as [1, 3] after "buildings" and round-trips; rejects non-array, negative, non-integer, duplicate and unknown-edge ids with /unlockedEdgeIds/.
- Undo: a diff carrying lock { before: [], after: [2] } applied "after" sets area.unlockedEdgeIds to [2], "before" restores [], lockChanged true; recorder.recordLock keeps first before / latest after and commit returns a diff containing only lock when nothing else changed, undefined when before equals after.
</behavior>
<action>
STEP 0, before touching any file under src/ or tools/: create tests/terrain-road-lock-golden.test.ts. Build the grid/paint/area the same way tests/terrain-road.test.ts does (reuse its helper pattern, copy locally if not exported): about 200 x 200 m, 2 m cells, heights = a smooth sine hill. Sequence: applyRoadStroke "street" straight across; applyRoadStroke "highway" curved stroke crossing it; raiseLower dabs over and beside the first road with roadMask = roadVertexMask(grid, paint, graph, win) (4-arg call); smoothRegion over the whole grid with the same roadMask; raiseBlock on a road; eraseRoad partial. Hash heights (Float32 bytes), paint.data and JSON.stringify(graph) plus nextEdgeId with a local FNV-1a 32-bit function. Run `npx vitest run tests/terrain-road-lock-golden.test.ts` with a placeholder expectation, read the actual hash from the failure, paste it as the literal, re-run green, and commit this test on its own ("test(quick-261110-rdx): golden hash of road edits before lock feature") BEFORE any source change. Later tasks add a second case running the same sequence through the dispatcher-style lock-aware calls with unlockedEdgeIds undefined and [] (5th arg undefined / empty set) expecting the same literal.

Then write the failing behaviour tests above in tests/terrain-road-lock.test.ts (data-model parts only), tests/terrain-format.test.ts and tests/terrain-undo.test.ts (append new describe blocks; do not edit existing assertions), and implement:

src/core/terrain-road-lock.ts (new, pure, no three/rapier/DOM; header comment cites DD-1..DD-4): export STALE_ROAD_TOL_M = 0.05; normaliseUnlocked(ids: readonly number[] | undefined, graph: RoadGraph): number[]; unlockedSet(ids): ReadonlySet<number> | undefined (undefined when empty, so callers keep the exact old path); carryUnlocked(prev: readonly number[] | undefined, after: RoadGraph, splitFrom: readonly { id: number; parentId: number }[]): number[]; staleUnlockedEdges(grid, graph, unlocked: readonly number[] | undefined, tolM = STALE_ROAD_TOL_M): { edgeId: number; maxDeltaM: number }[] (checks every edge point and both end nodes against sampleTerrainHeight); nearestEdgeWithin(graph, x, z, radiusM): { edgeId: number; distanceM: number } | null where an edge qualifies when its XZ distance <= max(radiusM, widthM / 2 + 2).

src/core/terrain-brush.ts: add optional `lock?: { before: readonly number[]; after: readonly number[] }` to StrokeDiff and `recordLock(before, after)` to StrokeRecorder / createStrokeRecorder (first before wins, latest after wins; commit emits lock only when the sorted arrays differ; reset on commit like graph). Existing commit output for diffs without lock must be unchanged (do not add a `lock: undefined` key; build the object so existing toEqual-style checks still pass).

src/core/terrain-undo.ts: UndoTarget gains optional `unlockedEdgeIds?: number[]`; ApplyResult gains `lockChanged: boolean` (false default); applyStrokeDiff, when diff.lock is present, sets area.unlockedEdgeIds to a copy of diff.lock[side] and lockChanged = true. Apply lock AFTER the graph restore.

src/core/terrain-format.ts (DD-2): TerrainSidecar gains `readonly unlockedEdgeIds?: readonly number[]`. serializeTerrainSidecar appends `unlockedEdgeIds` (sorted ascending) to the wire object after `buildings` only when the list is non-empty. parseTerrainSidecar: when the key is present, validate array / non-negative integers / distinct / each id is an edge in the parsed graph (fail with `root.unlockedEdgeIds ...`), and include it in the result only via conditional spread when non-empty; when absent, the result object has no such key. loadTerrainArea passes it through the same way. TERRAIN_FORMAT_VERSION unchanged.
</action>
<verify>
<automated>npx vitest run tests/terrain-road-lock-golden.test.ts tests/terrain-road-lock.test.ts tests/terrain-format.test.ts tests/terrain-undo.test.ts tests/terrain-brush.test.ts && npm run typecheck</automated>
</verify>
<done>Golden test committed before any source edit and green; new data-model, format and undo tests pass; all pre-existing assertions in those files untouched and passing; typecheck clean.</done>
</task>

<task type="auto" tdd="true">
<name>Task 2: Lock-aware road mask, split-lock carry, regradeRoads and setRoadLock (tests first)</name>
<files>tests/terrain-road-lock.test.ts, tests/terrain-road-lock-golden.test.ts, src/core/terrain-graph.ts, src/core/terrain-road.ts</files>
<behavior>
- Mask: roadVertexMask(grid, paint, graph, win) and roadVertexMask(..., undefined) and (..., new Set()) are element-equal; with edge A unlocked, vertices inside A's levelled radius (+ one paint pixel) are 0 unless also inside a locked edge's radius; locked edge B's vertices stay 1.
- Locked road untouched by sculpt: raiseLower / smoothBrush / raiseBlock over locked road B with the lock-aware mask leave B's band heights and graph y bit-identical.
- Unlocked sculpt moves terrain: same dabs over unlocked road A change heights under A's centreline; staleUnlockedEdges then reports A.
- Re-grade follows a synthetic hill: road drawn flat, unlock, raise a 6 m hill under it, regradeRoads(area, [A]) -> graph y of every A point equals sampleTerrainHeight within 1e-6, centreline follows the hill (max height change > 1 m), every consecutive-point grade <= 0.45 + 1e-6, bank within preset cap, staleUnlockedEdges empty, maxHeightChangeM and maxGradePct reported.
- Junction pin to locked: A (unlocked) meets B (locked) at a node; after hill + re-grade, the node y, every B point y and every height inside B's levelled radius are bit-identical to before; A's end point y equals node y.
- Two unlocked roads sharing a node, both re-graded: shared node y equals both edges' endpoint y; graph passes parseRoadGraph.
- Re-grade on a locked edge is a no-op with a warning "Road N is locked"; "all-unlocked" with none unlocked returns diff undefined.
- setRoadLock: unlock is a lock-only diff; locking a stale road re-grades then locks in ONE diff (heights + graph + lock); undo of that diff restores heights, graph JSON and unlocked list exactly; redo re-applies.
- Carry: unlock road A, cross it with a new stroke -> both pieces of A unlocked, new stroke edges locked; partial erase of A -> surviving pieces unlocked; replace-mode overwrite drops A's id.
- Golden case 2: the Task 1 sequence run with the lock-aware 5th argument undefined and empty set still matches the recorded literal.
</behavior>
<action>
Write the failing tests first (append to tests/terrain-road-lock.test.ts; add golden case 2), then implement.

src/core/terrain-graph.ts: add `splitFrom: readonly { id: number; parentId: number }[]` to AddStrokeResult and EraseResult (empty array on reject / no-op). In addRoadStroke's split loop and eraseGraphDisc's run loop, push { id, parentId: e.id } for every piece that takes a fresh id. If replace-mode compaction remaps nothing about edge ids (it compacts nodes only), no remap is needed; confirm by reading compactInternal. No other behaviour change.

src/core/terrain-road.ts:
1. roadVertexMaskFromGraph gains optional parameters (edge filter predicate, extra radius pad) defaulting to today's behaviour. roadVertexMask gains optional 5th arg `free?: ReadonlySet<number>`: when undefined or empty, run exactly today's code; otherwise mask = paint mask, held = graph mask over edges NOT in free, freeZone = graph mask over edges in free with pad = paint.metresPerPixel; clear freeZone vertices not in held, set held vertices. Doc comment cites requirement 2/3 and DD-7.
2. levelRoadBand option `hold?: Uint8Array`: vertices never written (inner band or shoulder). Unused by applyRoadStroke so stroke output stays identical.
3. Extract applyRoadStroke internals into private helpers WITHOUT changing their arithmetic or call order: gradeProfile(grid, xz, pins, preset, bankCap) -> { heights, banks } (curveM clamp 15..80, roadHeightProfile with STROKE_GRADE, roadBankAngles, pin taper) and limitAroundBand(grid, paint, graph, band, rec, free?) -> roadViolations (expandWindow, beforeHeightsWrite, band mask OR roadVertexMask(..., free), limitSlope). applyRoadStroke calls them. When area.unlockedEdgeIds is non-empty, applyRoadStroke uses the lock-aware mask for protect and the limiter (DD-10) and, after the graph update, computes carryUnlocked(prev, synced graph, added.splitFrom); if different, sets area.unlockedEdgeIds and calls rec.recordLock(prev, next). eraseRoad does the same carry with erased.splitFrom. With no unlocked ids neither function takes any new branch.
4. RoadEditTarget gains optional `unlockedEdgeIds?: number[]`.
5. export regradeRoads(area, edgeIds: readonly number[] | "all-unlocked"): { diff; regradedEdgeIds: number[]; maxHeightChangeM: number; maxGradePct: number; warnings: string[] }. Internally a regradeInto(area, ids, rec) used by both regradeRoads and setRoadLock. Per DD-6..DD-8: request set = requested ids that are unlocked and exist (locked ones -> warning `Road ${id} is locked; unlock it to re-grade.`); preset/width/bank per DD-6; xz = densify(edge points as entries, min(4, max(1, cell/2))) with endpoints at indices 0 and n-1; pass 1 unpinned gradeProfile per edge for free-node means; node pins per DD-8; pass 2 gradeProfile with end pins; hold = roadVertexMask(grid, paint, graph, reachWindowOfAll, requestSet) (everything not re-graded); for each edge in order levelRoadBand(..., { recorder, protect: hold OR accumulated band masks, hold }); union band windows/maxDelta and run limitAroundBand with free = requestSet and the unioned band mask (slope warning when roadViolations > 0). Write-back: new graph with each re-graded edge's points y = sampleTerrainHeight (x/z unchanged), end points y = pinned node y, lengthM = 3D polyline length; free nodes and DD-8 middle-case nodes (plus their incident edge endpoints) get the new y; locked nodes and edges unchanged. rec.recordGraph(before JSON, after JSON, nextEdgeId, nextEdgeId). maxHeightChangeM = max |new y - old y| over re-graded points; maxGradePct = 100 * max |dy| / dxz over consecutive re-graded points.
6. export setRoadLock(area, edgeIds: readonly number[], locked: boolean): { diff; changedEdgeIds: number[]; regradedEdgeIds: number[]; maxHeightChangeM; maxGradePct; warnings }. Unlock: add ids, recordLock. Lock (DD-4): stale = staleUnlockedEdges for the requested unlocked ids; if any, regradeInto(area, stale, rec) first; then remove ids and recordLock. One rec, one diff.
Keep src/core pure (tests/layering.test.ts must stay green).
</action>
<verify>
<automated>npx vitest run tests/terrain-road-lock.test.ts tests/terrain-road-lock-golden.test.ts tests/terrain-road.test.ts tests/terrain-graph.test.ts tests/terrain-brush.test.ts tests/layering.test.ts && npm run typecheck</automated>
</verify>
<done>All behaviour tests above pass; golden hash unchanged for both cases; every pre-existing terrain-road / terrain-graph / terrain-brush test passes unmodified; no new imports of three/rapier/DOM in src/core.</done>
</task>

<task type="auto" tdd="true">
<name>Task 3: Dispatcher lock tool, save guard, road lock overlay and editor UI wiring</name>
<files>src/core/terrain-overlay.ts, tests/terrain-overlay.test.ts, tools/terrain-editor/tool-dispatch.ts, tools/terrain-editor/tool-dispatch.test.ts, tools/terrain-editor/save-guard.ts, tests/road-save-guard.test.ts, tools/terrain-editor/vite-plugin.ts, tools/terrain-editor/editor.ts, tools/terrain-editor/index.html</files>
<behavior>
- roadLockSegments(graph, unlocked, selectedEdgeId, liftM) returns three Float32Arrays (locked, unlocked, selected) of xyz segment pairs; all edges land in locked when unlocked is empty; y = point y + liftM.
- Dispatcher: TOOL_KEYS.KeyL === "lock"; lock tool click on a road unlocks it (status mentions Re-grade), second click locks it; Alt+click selects without toggling; click on empty ground gives status "No road under the cursor." and no undo entry; lockAll(false) then undo restores the previous list; regradeSelected on a locked selection warns and pushes nothing; regradeAllUnlocked after a hill under an unlocked road reports "Re-graded N road(s): max height change X.XX m, max grade Y.Y%" and undo restores heights and graph; ToolResult.lockChanged true for lock changes; sculpt dabs through heightOpOptions move terrain under an unlocked road but not under a locked one; an erase stroke that carries locks merges lock into its single diff.
- Save guard: staleRoadBlockMessage(grid, graph, unlocked) is null for all-locked and for a freshly re-graded unlocked road, a message naming the edge ids for a stale one; assertGradedRoads throws with the "terrain-save:" prefix; validateAreaPair rejects a stale unlocked pair.
</behavior>
<action>
Tests first (new describe blocks; existing tool-dispatch and save-guard assertions unchanged), then:

src/core/terrain-overlay.ts: add pure roadLockSegments as described (no three import).

tools/terrain-editor/save-guard.ts: add staleRoadBlockMessage(grid, graph, unlocked) using staleUnlockedEdges (text: `Unlocked road(s) ${ids} no longer match the terrain (up to ${max} m). Re-grade them, or Lock them (locking re-grades), before saving.`) and assertGradedRoads(area) throwing `${SAVE_GUARD_PREFIX} ...` (DD-3). tools/terrain-editor/vite-plugin.ts validateAreaPair: capture the loadTerrainArea result and call assertGradedRoads on it. validateSidecarPut unchanged.

tools/terrain-editor/tool-dispatch.ts: Tool union gains "lock"; TOOL_KEYS gains KeyL: "lock". ToolResult and UndoRedoResult gain `lockChanged: boolean` (emptyResult false, mergeInto ORs, toUndoResult from ApplyResult.lockChanged; windowsOfDiff reports lock presence). heightOpOptions passes unlockedSet(area.unlockedEdgeIds) as roadVertexMask's 5th arg (undefined when none, so the old path runs). mergeDiffs merges lock (earliest before, latest after). Dispatcher state `selectedEdgeId: number | null`, reset by clearHistory and dropped when the edge no longer exists. pointerDown with tool "lock" (DD-9): nearestEdgeWithin(graph, x, z, options.radiusM); Alt selects only; otherwise setRoadLock toggle, push diff, status texts: unlock -> `Unlocked road ${id}. Sculpt freely, then Re-grade or Lock it before saving.`; lock -> `Locked road ${id}.` or, when re-graded, `Locked road ${id} (re-graded first: max height change ${m} m, max grade ${g}%).` pointerMove/pointerUp for lock do nothing beyond finishing the stroke with no diff. New methods: getSelectedEdgeId(), lockAll(locked: boolean), regradeSelected(), regradeAllUnlocked(); each finishes any open stroke first, is exactly one undo entry, and returns a ToolResult with dirtyHeights from windowsOfDiff, graphChanged, lockChanged, warnings and status (`Re-graded ${n} road(s): max height change ${m.toFixed(2)} m, max grade ${g.toFixed(1)}%.`; slope warning appended to warnings).

tools/terrain-editor/index.html: tool button `data-tool="lock"` "Lock/unlock road (L)" with title "Click a road to lock or unlock it. Alt+click selects it."; options block `data-for="lock"` with buttons ids lock-all "Lock all", unlock-all "Unlock all", regrade-selected "Re-grade selected", regrade-all "Re-grade all unlocked", and a one-line legend "Grey = locked, orange = unlocked, cyan = selected. Unlocked roads must be re-graded or locked before saving."

tools/terrain-editor/editor.ts (keep thin, no logic beyond wiring): three THREE.LineSegments (locked 0xcfd4da, unlocked 0xff8a1f, selected 0x44ddff, lift 0.4 m) rebuilt by a refreshRoadLockOverlay() from roadLockSegments on area load/create, after any ToolResult or undo/redo with graphChanged or lockChanged; applyResult treats lockChanged as an edit (setDirty); undoRedo refreshes the overlay; wire the four buttons to the dispatcher methods through applyResult + updateHistoryButtons; in save(), after the existing graph block check, refuse with staleRoadBlockMessage(target.grid, target.graph, (target as EditArea).unlockedEdgeIds) (status + log, no PUT). Do not change runtime scene, physics, vehicle tuning or map compiler code; do not touch public/maps/*.

Finally run `npx biome check` on all touched paths and fix findings in them only.
</action>
<verify>
<automated>npx vitest run tools/terrain-editor/tool-dispatch.test.ts tests/terrain-overlay.test.ts tests/road-save-guard.test.ts tests/terrain-plugin.test.ts && npm run typecheck && npm test && npx biome check src/core/terrain-road-lock.ts src/core/terrain-road.ts src/core/terrain-graph.ts src/core/terrain-brush.ts src/core/terrain-undo.ts src/core/terrain-format.ts src/core/terrain-overlay.ts tools/terrain-editor tests/terrain-road-lock.test.ts tests/terrain-road-lock-golden.test.ts tests/terrain-format.test.ts tests/terrain-undo.test.ts tests/terrain-overlay.test.ts tests/road-save-guard.test.ts</automated>
<human-check>UI cannot be browser-checked by the executor (Chrome tool cannot reach localhost here). Manual steps are listed in verification for the user.</human-check>
</verify>
<done>Dispatcher, overlay and save-guard tests pass; full npm test passes; typecheck clean; biome clean on touched paths (pre-existing failures in logs/_scratch and gltf.test.ts ignored); editor and index.html wired as described.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| disk / dev-server PUT -> parseTerrainSidecar | sidecar JSON (hand-edited or from the editor) enters the pure core |
| editor client -> dev-server PUT | client-side save checks can be bypassed by a direct PUT |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-rdx-01 | Tampering | parseTerrainSidecar unlockedEdgeIds | mitigate | strict validation: array of distinct non-negative integers, each an existing edge id; field copied by name, never spread (same as T-04-01) |
| T-rdx-02 | Tampering | stale graph written via direct PUT | mitigate | assertGradedRoads in validateAreaPair on the sidecar PUT, same rule as the client |
| T-rdx-03 | Denial of service | Re-grade all unlocked on a large graph | accept | dev-only tool, bounded by edge count and existing window caps; one synchronous op like Smooth whole map |
| T-rdx-04 | Tampering | runtime map loading | accept | runtime ignores the field; no runtime code changes |
</threat_model>

<verification>
Automated: commands in each task, ending with `npm run typecheck`, `npm test`, and `npx biome check` on touched paths.

Coverage audit (request items -> task):
1 lock state per road, default locked, optional persisted field, no format break -> Task 1 (DD-1, DD-2), carry in Task 2
2 locked = current behaviour -> golden test Task 1 + mask equality Task 2
3 unlocked not held; stale rule -> Task 2 mask, Task 1 staleness, Task 3 save refusal (DD-3, DD-4)
4 re-grade via existing pipeline, one undoable diff incl. lock -> Task 2 (DD-5..DD-8)
5 junction pinning, never move a locked road -> Task 2 (DD-8, hold option)
6 editor UI -> Task 3 (DD-9)
7 pure core unit tests -> Tasks 1-2 (all listed cases), Task 3 dispatcher/overlay/guard tests

Manual checks for the user (npm run dev, open the terrain editor):
1. Load an existing area: all roads draw grey (locked). Sculpt beside and over a road: road height does not change (as before).
2. Press L, click a road: it turns orange and status says Unlocked. Raise a hill over it: the terrain moves under it.
3. Press Save terrain: refused with the "no longer match the terrain" message. Drive here is refused the same way.
4. Alt+click the road (selected, cyan), press Re-grade selected: road follows the hill; status shows max height change and max grade. Save now succeeds; reload the area: the road is still orange (unlocked).
5. Ctrl+Z: heights, road and lock state go back together; Ctrl+Shift+Z re-applies.
6. Draw a new road crossing a locked road and an unlocked road: new road is grey; both halves of the crossed unlocked road stay orange.
7. Unlock a road that meets a locked road, sculpt, Re-grade: the locked road's height at the junction does not move.
8. Click a stale unlocked road with the Lock tool: it re-grades and turns grey in one step (one Ctrl+Z undoes both).
9. Lock all / Unlock all toggle every road; each is one undo step.
</verification>

<success_criteria>
- Golden hash recorded on pre-change code still matches; all existing tests pass unchanged.
- Lock state persists via optional unlockedEdgeIds; all-locked sidecars byte-identical; old files load locked.
- Re-grade and lock-with-regrade produce consistent graph y (stale check empty) within slope/bank limits, as one undo entry restoring heights, graph and lock state.
- Locked roads never move under sculpt, re-grade or junction pinning.
- Save and Drive here refuse stale unlocked roads client-side and server-side.
- Editor exposes the Lock tool, the four buttons, the coloured overlay and result status; user runs the manual checks.
</success_criteria>

<output>
Create `.planning/quick/261110-rdx-terrain-editor-lockable-roads-and-re-gra/261110-rdx-SUMMARY.md` when done, listing DD-1..DD-10 as implemented (or any deviation) and the manual check steps for the user.
</output>
