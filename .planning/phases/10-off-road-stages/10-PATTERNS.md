# Phase 10: Off-road Stages - Pattern Map

**Mapped:** 2026-11-23
**Scope:** Phase 10 only (stages, route tool, road-route relaxation). Ramps/structures (D-14..D-20) are Phase 10.1 and skipped.
**Files analyzed:** 22 new/modified
**Analogs found:** 21 / 22 (gate-crossing test has no analog; sketch is in 10-RESEARCH.md Pattern 2)

All paths are relative to `d:\Projects 2\Heat Street`.

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match |
|---|---|---|---|---|
| `src/core/stage.ts` (types, `parseStageData`, `serializeStageData`) | model/parser | transform | `src/core/course.ts` (helpers) + `parseStartPoints` in `src/core/terrain-format.ts:665` | exact |
| `src/core/stage-run.ts` (ordered-gate state machine, `crossedGateForward`, `respawnPose`) | utility (pure) | event-driven | `src/core/race-state.ts` + `src/core/checkpoint-detection.ts` | role-match (oriented test has no analog) |
| `src/core/stage-persistence.ts` (PB envelope) | service (pure) | CRUD | `src/core/medal-persistence.ts` | exact |
| `src/core/heading.ts` (+`bearingFromYaw`/`yawFromBearing`) | utility | transform | same file, `yawFromTravelDirection`/`forwardFromYaw` (lines 87-101) | exact |
| `src/gameplay/stage-coordinator.ts` | controller | event-driven | `src/gameplay/race-coordinator.ts` (+ `free-drive-coordinator.ts` for no-graph respawn) | exact |
| `src/render/stage-view.ts` (gate posts/beam, no colliders) | component | request-response (per-frame update) | `src/render/objective-view.ts` | role-match |
| `src/hud/race-hud.ts` (status text `GATE n / total`) | component | request-response | itself, line ~96-98 | modify |
| `src/hud/results-view.ts` (no medal row for stages) | component | request-response | itself, `showCompletion` | modify |
| `src/core/race-state.ts` (`RaceSnapshot.mode` widen to include `"stage"`) | model | - | itself line 10 | modify |
| `src/main.ts` (stage branch: `?mode=stage`, `?stage=`, spawnOverride, coordinator pick) | config/composition | request-response | itself lines 261-300, 326-390, 1005-1095 | modify |
| `src/core/course.ts` (`parseCourseData` relaxation) | model/parser | transform | itself lines 164-235 | modify |
| `src/core/navigation.ts` (`nearestRoadNode` empty guard, `validateCourseRoutes` gating) | utility | transform | itself lines 43-60, 80-147 | modify |
| `src/core/medal-reference.ts` (`parseMedalReference` partial courses) | parser | transform | itself | modify |
| `tools/terrain-editor/stages.ts` (+`stages.test.ts`) | utility (pure ops) | CRUD | `tools/terrain-editor/start-points.ts` (+`.test.ts`) | exact |
| `tools/terrain-editor/paths.ts` (+`resolveStagesFile`) | utility | file-I/O | `resolveTerrainFile` in same file | exact |
| `tools/terrain-editor/vite-plugin.ts` (`GET/PUT /__terrain/stages/<id>`, `/routes/<id>`) | middleware | request-response | itself lines 139-216 (`drivable` branch + PUT branch) | exact |
| `tools/terrain-editor/editor.ts` (Route/Stage tool, markers, sidebar panel, Test stage) | component | event-driven | start-point section lines 4900-5060, 5310-5470 | exact |
| `tools/terrain-editor/tool-dispatch.ts` (`commitStages`/`commitRoutes`) | service | CRUD | `commitStartPoints` line 849 | exact |
| `src/core/terrain-brush.ts` (`StrokeDiff.stages`/`routes`) + `src/core/terrain-undo.ts` (`UndoTarget`, `ApplyResult.stagesChanged`) | model | CRUD | `startPoints` parts at brush:71, undo:34/48/124 | exact |
| `tools/terrain-editor/place-tool.ts` (reuse only) | utility | event-driven | `createDragGesture` | reuse |
| `tests/stage.test.ts`, `stage-run.test.ts`, `stage-persistence.test.ts`, `stage-coordinator.test.ts` | test | - | `tests/medal-persistence.test.ts`, `tests/race-coordinator.test.ts`, `tests/course-data.test.ts` | exact |
| `docs/schemas/stage.v1.md`, `docs/stages.md` | doc | - | `docs/schemas/*.md` (parity test exists for road-graph) | role-match |

## Pattern Assignments

### `src/core/stage.ts` (parser, transform)

**Analog:** `src/core/course.ts` (copy helper style; helpers are file-private, so copy them, do not import). `parseStartPoints` (`src/core/terrain-format.ts:665-687`) for id uniqueness, bounds and `MAX_COORD_ABS_M`.

**Error + required-key helpers** (course.ts 41-81):
```typescript
function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function fail(sourceLabel: string, message: string): never {
  throw new Error(`parseCourseData: ${sourceLabel}: ${message}`);   // use `parseStageData:` prefix
}
function required(sourceLabel, object, key, context): unknown {
  if (!Object.hasOwn(object, key)) fail(sourceLabel, `${context} missing required key "${key}"`);
  return object[key];
}
function finiteNumber(...)  // typeof number && Number.isFinite, else fail("... must be a finite number")
```
**Entry point shape** (course.ts 209-224): `JSON.parse` in try/catch -> `fail("not valid JSON")`; `isObject(parsed)`; `schemaVersion` integer must equal constant; `areaId` string; arrays validated with `Array.isArray`.

**Duplicate id + range pattern** (terrain-format.ts 665-687):
```typescript
const ids = new Set<string>();
if (ids.has(id)) fail(label, `${ctx}.id duplicate start point id ${JSON.stringify(id)}`);
ids.add(id);
if (Math.abs(x) > MAX_COORD_ABS_M) fail(label, `${ctx}.x out of range, got ${x}`);
```
Extent check: `terrainGridExtent(grid)` from `src/core/terrain-drive-setup.ts:22` returns `{minX,minZ,maxX,maxZ}`. `MAX_COORD_ABS_M` exported at `terrain-format.ts:448`.
Parse prefix must be `parseStageData:` so the dev-server `isValidation` check (see vite-plugin below) maps it to HTTP 400.
Layering: no three/rapier/DOM/wall clock (`tests/layering.test.ts`).

---

### `src/core/stage-persistence.ts` (service, CRUD)

**Analog:** `src/core/medal-persistence.ts`

**Imports/constants** (lines 1-9): `isPlainObject` from `./tuning-utils`; `KIND`/`VERSION`/`KEY` consts; allowlist as `ReadonlySet`.
**Storage interface** (64-67): `MedalStorage { get(key): string | null; set(key, value): void }` - reuse the type (or re-export), injected from main.
**Tolerant parse** (151-177):
```typescript
if (raw === null) return emptyMedalProgress();
let parsed: unknown;
try { parsed = JSON.parse(raw); } catch { return emptyMedalProgress(); }
if (!isPlainObject(parsed) || parsed.kind !== KIND || parsed.version !== VERSION) return empty();
return { kind, version, courses: copyValidCourses(parsed.courses, knownCourseIds) };
```
**Per-entry validation + copy** (94-141): iterate `Object.keys(value)`, validate each (`Number.isFinite(bestTimeSec) && > 0`), copy only whitelisted fields, drop the rest.
**Merge improves only, returns same reference when no change** (187-220); **save wrapped in try/catch** (240-255):
```typescript
const updated = merge(current, ...);
if (updated === current) return false;
try { storage.set(KEY, serialize(updated)); return true; } catch { return false; }
```
Deviation (per RESEARCH Pattern 4): do NOT reuse `mergeMedalResult` or `knownCourseIds` machinery (T-07-24 trap, comment at lines 21-26). Key = `"<areaId>:<stageId>:<classId>"`, validated by regex; class allowlist via array `find`, not object-key lookup. New key `heat-street.stage-bests.v1`.

---

### `src/core/heading.ts` (add converters)

**Analog:** same file, lines 87-101:
```typescript
export function yawFromTravelDirection(dx: number, dz: number): number { return Math.atan2(-dx, -dz); }
export function forwardFromYaw(yawRad: number): { x: number; z: number } { return { x: -Math.sin(yawRad), z: -Math.cos(yawRad) }; }
```
Gate `headingRad` is YAW (same as `TerrainStartPoint.headingRad`, `resetVehicle`, `createDragGesture` output). Race-state/minimap/`headingFromRotation` are BEARING. Add `bearingFromYaw`/`yawFromBearing` built from these two; round-trip test in `tests/heading.test.ts` style.

---

### `src/core/stage-run.ts` (pure state machine)

**Analog (role):** `src/core/race-state.ts` (snapshot/restart/respawn API, `RESPAWN_PENALTY_SEC`), `src/core/checkpoint-detection.ts` (result shape `{hit, inside}`; do NOT reuse its `containsCheckpoint`, lines 14-31 are axis-aligned and ignore rotation).
No analog for the plane-crossing test: use the sketch in RESEARCH.md "Gate-crossing core" (`crossedGateForward`) and keep `prev` inside the run. Import `RESPAWN_PENALTY_SEC` from `medal-timing.ts` (line 9: `export const RESPAWN_PENALTY_SEC = 5`), do not define a third copy.
Snapshot fields must feed `RaceSnapshot` (see race-state below).

---

### `src/gameplay/stage-coordinator.ts` (controller, event-driven)

**Analog:** `src/gameplay/race-coordinator.ts` (implements exported `RaceCoordinator` interface at 37-42).

**Imports/Deps** (1-35): the deps object holds `scene: MapScene`, `objectiveView`/stage view, `minimap`, `navigationArrow`, `raceHud`, `chime`, `simTimeSec: () => number`, `timing: MedalTiming`, optional `onCompleted`, `onRestart`. Drop `course`, `navigation`, `state`, `reference`.
**Tick loop core** (93-139), adapt: read `deps.scene.vehicle.body.translation()`, call `timing.update({simTimeSec, speedMs: telemetry.groundSpeedMs, penaltySec})`, on gate pass `timing.recordCheckpoint(simTime, {checkpointId, fromCheckpointId: latestTiming.sectors.at(-1)?.checkpointId ?? null, lap, ordinal: latestTiming.sectors.length})`, `chime.play()`, and on finish:
```typescript
latestTiming = deps.timing.complete(deps.simTimeSec());
if (latestTiming.completion !== null && publishedCompletion === null) {
  publishedCompletion = latestTiming.completion;
  deps.onCompleted?.(publishedCompletion);
}
```
Do NOT call `nearestRoadNode` (throws on empty graph).
**Restart** (142-152): `state.restart(); timing.restart(); publishedCompletion = null; scene.resetVehicle(scene.defaultSpawnPose); raceHud.flashRestart(); onRestart?.(); refresh()`.
**Respawn** (153-170): penalty via state then `timing.update({..., penaltySec})` ONCE (Pitfall 7: never also `timing.respawn()`); `scene.resetVehicle(pose)` with pose = last gate / start `{x, y: heightAt+0.6, z, headingRad(yaw)}`.
**Respawn clearance** analog: `src/gameplay/free-drive-coordinator.ts:11-14` `RESPAWN_CLEARANCE_M = 0.6`; `heightAt` is injected (main passes `sampleTerrainHeight(grid, x, z)`, main.ts ~1088).
**No-course snapshot** (free-drive-coordinator.ts 28-38): constant `RaceSnapshot` shape to start from; the stage version needs `mode: "stage"`.
**Returned object** (174-181): `{ onTickEnd, onCommands, render: refresh, snapshot }`.
**Test harness analog:** `tests/race-coordinator.test.ts:50-100` (fake `body = {translation, rotation}`, `scene = {vehicle:{body, telemetry}, defaultSpawnPose, resetVehicle: vi.fn()}`, `deps as never`).

---

### `src/render/stage-view.ts` (component)

**Analog:** `src/render/objective-view.ts` (lines 1-60): factory `createObjectiveView(parent: THREE.Object3D)` returning `{update, dispose}`; shared geometry, per-gate cloned `MeshBasicMaterial`, `AdditiveBlending`, `depthWrite:false`, active vs inactive colour/opacity, remove meshes for passed gates, `dispose()` frees geometry/materials. No colliders (D-10). Reuse for the editor ghost like `src/render/crest-view.ts` does (builder takes `heightAt` callback; layering: three + pure core only, never Rapier). Place mesh y from `heightAt(x,z)`, not from the file (no `y` stored).

---

### `src/main.ts` (composition)

**Analog:** itself.
- URL consts (261): `const MAP_ROUTES_URL = \`/maps/${AREA_ID}.routes.json\`;` add `MAP_STAGES_URL` the same way.
- Optional fetch (288-300): `fetchOptionalArtifactText(url)` returns `undefined` on 404 or HTML body; use it for stages and for medals (currently `fetchArtifactText(MAP_MEDALS_URL)` at 352 throws).
- Mode param + routes block (330-390): `modeParam` read at 332; `if (routesText !== undefined) { parseCourseData...; validateCourseRoutes...; fetchArtifactText(MAP_MEDALS_URL) ...}`. Stage mode must bypass this block entirely (Pitfall 2). For routes relaxation: make medals optional, add `?route=<id>` selection and `createMedalTiming({medals:false, ...})` when no reference.
- Spawn (416-421): `resolveStartPose(location.search, physicsGrid, graph, terrainArea.startPoints)` gives `spawnOverride`; stage start must beat it, pass the stage start `{x,z,headingRad}` as `spawnOverride`.
- Coordinator build (1005-1068): `createRaceCoordinator({... timing: createMedalTiming({referenceTimeSec, medals: CAR_CLASS.savesMedals}), onCompleted: (completion) => { if (!CAR_CLASS.savesMedals) { resultsView?.showCompletion(completion); return; } saveMedalResult(...); resultsView?.showCompletion(completion) }, onRestart: () => resultsView?.clearCompletion() })`. Mirror for the stage coordinator with the stage-persistence save for every class (D-07).
- Dispatch (1092): `const activeCoordinator = circuitRace ?? raceCoordinator ?? freeDriveCoordinator;` add `stageCoordinator` before `freeDriveCoordinator`. Free-drive fallback (1076-1090) stays for D-08 (`console.warn`, non-terrain or missing file).
- `freeDriveCoordinator` condition is `rd === undefined && freeDriveGrid !== undefined`: make sure the stage branch does not leave both undefined (line 1093 throws).

---

### `src/core/course.ts` (relax `parseCourseData`)

**Analog:** itself. Edit sites:
- `course.ts:183-186`: `const minimum = mode === "p2p" ? 5 : 4; const maximum = mode === "p2p" ? 8 : 6;` -> authored range (p2p >= 2, circuit >= 3 per RESEARCH).
- `course.ts:190-191`: `if (mode === "circuit" && laps !== 3) fail(...)` -> laps 1..20.
- `course.ts:222-233`: `rawCourses.length !== 2` and exactly-one-p2p/one-circuit check -> 0..N (cap ~20).
Keep id/duplicate/graph checks (`parseCheckpoint` 126-162: nodeId/edgeId must exist and edge must touch node). Update `tests/course-data.test.ts` deliberately.

### `src/core/navigation.ts` (`nearestRoadNode`, `validateCourseRoutes`)

**Bug site** (lines 43-60): `let nearest = navigation.roadGraph.nodes[0]; ... return nearest.id;` throws when empty. Add at top: `if (navigation.roadGraph.nodes.length === 0) return -1;` (`updateProgress` already guards `hasNode(-1)`). Add test in `tests/navigation.test.ts`.
`validateCourseRoutes` (~80-147): the `DEFECT_COORDINATES` loop (lines ~131-136) is Juliette-local; gate on area. `CHECKPOINT_EDGE_TOLERANCE_M = 30` check and `sensor.widthM < edge.widthM` are the failures that block hand-placed checkpoints; soften for authored routes. `mapHasDirt` check is already map-adaptive (shape to copy for other conditional rules).

### `src/hud/race-hud.ts` / `src/core/race-state.ts`

`race-state.ts:10` `readonly mode: Course["mode"];` widen additively to `"p2p" | "circuit" | "stage"`. `race-hud.ts:96-98`:
```typescript
snapshot.mode === "circuit" ? <lap text> : `CHECKPOINT ${snapshot.visitedIds.length}   ${snapshot.currentTargetId ?? "FINISH"}`
```
add a `stage` branch with `GATE n / total` (needs total; carry in snapshot or HUD via `totalLaps` field reuse is not advised; add an optional field). Test in `tests/race-hud.test.ts`.

---

### `tools/terrain-editor/stages.ts` (pure ops, CRUD)

**Analog:** `tools/terrain-editor/start-points.ts` (81 lines) and `start-points.test.ts`.
Header rule (lines 1-3): pure, no DOM/three, every function returns a NEW array and never mutates elements (undo snapshots share them).
**Id seed** (13-25): `const START_ID = /^start-(\d+)$/; startIdSeed(list)` = max numeric suffix + 1; counter lives in editor state not file.
**Add with cap + error result** (27-43):
```typescript
export type AddResult = { list: T[]; nextSeed: number; error?: undefined } | { error: string; list?: undefined; nextSeed?: undefined };
if (list.length >= MAX_START_POINTS) return { error: `A map can have at most ${MAX} start points` };
return { list: [...list, entry], nextSeed: seed + 1 };
```
**replaceAt helper + move/turn/rename** (51-70): unknown id returns same `list` reference; rename trims and rejects empty/over-long by returning the same reference.
Stage ops to add (RESEARCH Pattern 6): newStage, addGate (before finish), insertGate, moveGate, turnGate, setWidth, reorder, deleteGate, renameStage, deleteStage, `nextGateId`.
**Test style** (start-points.test.ts 1-30): vitest, small factory `sp(n)`, assert same-reference on no-op.

### `tools/terrain-editor/paths.ts` (+`resolveStagesFile`)

**Analog:** `resolveTerrainFile` (lines 18-26):
```typescript
export function resolveTerrainFile(root, id, kind): string | null {
  if (!isSafeAreaId(id)) return null;
  const mapsDir = path.resolve(root, "public", "maps");
  const file = path.resolve(path.join(mapsDir, `${id}.terrain.${kind}`));
  if (!file.startsWith(mapsDir + path.sep)) return null;
  return file;
}
```
Copy with `${id}.stages.json` (and `.routes.json`). Caps: `MAX_JSON_BYTES` (8 MB) and `readBodyCapped` (lines 40-70) are reused as is.

### `tools/terrain-editor/vite-plugin.ts` (stages/routes endpoints)

**Analog:** itself.
**Branch placement** (139-153): special routes are handled BEFORE the generic `id/kind` split, keyed on `parts[1]`:
```typescript
if (req.method === "GET" && parts[1] === "drivable" && parts.length === 3) {
  const q = parts[2] ?? "";
  if (!isSafeAreaId(q)) return sendError(res, 400, "invalid area id");
  return send(res, 200, JSON.stringify({ drivable: isDrivableTerrain(ROOT, q) }));
}
```
Add `parts[1] === "stages"` (and `"routes"`) with GET and PUT here; otherwise `/__terrain/stages/<id>` is parsed as area "stages" kind `<id>` (line 154-156).
**PUT pattern** (177-183): `const body = await readBodyCapped(req, MAX_JSON_BYTES); const text = body.toString("utf8"); validate(text, id); await writeAtomic(file, text); return send(res, 200, '{"ok":true}')`. For stages, extent comes from `decodeTerrainBinary(bytes, label)` (line 173) of the area's `.terrain.bin` via `readIfExists(resolveTerrainFile(ROOT,id,"bin"))`; 404 if area missing. GET: `if (!existsSync(file)) return sendError(res, 404, ...)` (164-166).
**Error mapping** (205-211): extend `isValidation` with `msg.startsWith("parseStageData:")` and `parseCourseData:`. Always `safeMessage(err)` for bodies (57-60). `validateSidecarPut` (101-104) is the exported-validator shape to mirror (`validateStagesPut(text, id, extent)`), unit-testable without Vite.

### `tools/terrain-editor/editor.ts` (Route/Stage tool)

**Analog:** the start-point tool in the same file (6636 lines; read by range).
- State (642-662): `let startDraft: readonly TerrainStartPoint[] | null = null; const startGesture = createDragGesture(); function currentStarts() { return startDraft ?? area?.startPoints ?? []; }`.
- Pointer down/move/up (4900-4990): down hit-tests a marker (`startPointAt`, 798) to move/turn, else starts `startGesture`; up:
```typescript
const r = startGesture.up(); setGesturePreview(null, null); if (!r) return;
const ext = terrainGridExtent(area.grid);
if (r.x < ext.minX || ...) { setStatus("Start points must be inside the map area", "error"); return; }
const heading = r.headingRad ?? nearestEdgeHeading(area.graph, r.x, r.z) ?? 0;
const res = addStartPoint(area.startPoints ?? [], startSeed, r.x, r.z, heading);
if (res.error !== undefined) { setStatus(res.error, "error"); return; }
startSeed = res.nextSeed; selectedStartId = added.id;
applyResult(dispatcher.commitStartPoints(res.list), 0); updateHistoryButtons();
setStatus(`Placed ${added.name}. Ctrl+Z undoes it.`, "ok");
```
- Cancel (4998-5006): cancel gesture, release pointer capture.
- List-edit commit (5009-5013): `commitStarts(next)` guards `stroking || pushPull || opHold` then `applyResult(dispatcher.commitStartPoints(next), 0)`.
- Undo/redo refresh (4596-4600, 5016): `if (res.startPointsChanged) startPointsEdited();` add `stagesChanged` analog.
- Sidebar (5310-5470): `startRow(...)`, `buildStartPointsSection(open)`; names inserted via `textContent`/`value` only (file strings). Add Stages panel in the same style; hook into Place menu where `placingKind === "start"` (5470) and the "has entries" display rule (5588).
- Missing-fallback heading: `nearestEdgeHeading` from `src/core/terrain-drive-setup.ts` (returns YAW); stage fallback per RESEARCH is previous gate heading.
- Save/PUT: follow existing save path for the sidecar; stage save is a separate PUT to `/__terrain/stages/<id>`.

### `tools/terrain-editor/tool-dispatch.ts` / `terrain-brush.ts` / `terrain-undo.ts` (undo parts)

**Analog:** `commitStartPoints` (tool-dispatch.ts:849-855):
```typescript
commitStartPoints(next: readonly TerrainStartPoint[]): ToolResult {
  const area = getArea();
  const before = area.startPoints ?? [];
  if (JSON.stringify(before) === JSON.stringify(next)) return emptyResult();
  area.startPoints = [...next];
  return commitSceneryDiff(area, { startPoints: { before, after: next } });
}
```
`terrain-brush.ts:71-74`: `readonly startPoints?: { before: readonly X[]; after: readonly X[] }` on `StrokeDiff`. `terrain-undo.ts`: field on `UndoTarget` (34), flag on `ApplyResult` (48, init 63), restore in `applyStrokeDiff` (124-126: `area.startPoints = [...diff.startPoints[side]]; result.startPointsChanged = true;`). Stages/routes live in files separate from the sidecar, so the editor holds them in its own state; the `UndoTarget`-holder must carry them (or a parallel holder) so one 50-deep stack covers both. Consider `amendTop`/`SceneryMerge` (tool-dispatch ~862-870) for repeated tweaks to width/heading.

---

## Shared Patterns

### Hand-rolled validation (no zod)
**Source:** `src/core/course.ts:41-114`, `src/core/medal-persistence.ts:69-141`. `zod` is not a dependency. Apply to: stage.ts, stage-persistence.ts. Throw `Error("<fn>: <label>: <msg>")` for file parsers; return empty/default (never throw) for localStorage reads.

### Fixed-tick sim time only
**Source:** `race-coordinator.ts:103-107` (`deps.simTimeSec()`), `medal-timing.ts` (starts on first movement >= `FIRST_MOVEMENT_SPEED_MS` 0.5). Apply to stage coordinator; no `performance.now`/`Date.now` (layering test).

### Dev-server safety
**Source:** `vite-plugin.ts` `readBodyCapped`, `writeAtomic` (84-93), `safeMessage` (57-60), `isSafeAreaId` (paths.ts:14). Apply to all new endpoints. `apply: "serve"` keeps them out of prod.

### Undo = whole-array before/after in one `StrokeDiff`
**Source:** `terrain-brush.ts:71`, `tool-dispatch.ts:849`, `terrain-undo.ts:124`. Elements shared, never mutated; pure ops return new arrays.

### Optional artifact fetch
**Source:** `main.ts:288-300` `fetchOptionalArtifactText` (404 and Vite HTML-200 both mean absent). Use for `.stages.json` and `.medals.json`.

### Heading conventions
YAW for stage gates/start points/`resetVehicle` (`forwardFromYaw`); BEARING for race-state/minimap/`headingFromRotation`. Convert only via `src/core/heading.ts`.

## No Analog Found

| File / piece | Role | Data Flow | Reason |
|---|---|---|---|
| Oriented gate plane-crossing test in `stage-run.ts` | utility | transform | Only axis-aligned `containsCheckpoint` exists; use RESEARCH.md "Gate-crossing core" sketch |
| Stage PB composite key (`area:stage:class`) | utility | CRUD | Medal store keys by course id only; regex in RESEARCH "Stage PB key" |

## Metadata

**Analog search scope:** `src/core`, `src/gameplay`, `src/render`, `src/hud`, `src/main.ts`, `tools/terrain-editor`, `tests`
**Files read:** course.ts, race-coordinator.ts, free-drive-coordinator.ts, medal-persistence.ts, checkpoint-detection.ts, navigation.ts (parts), heading.ts (parts), start-points.ts, place-tool.ts, vite-plugin.ts, paths.ts, objective-view.ts, crest-view.ts, plus targeted ranges of main.ts, editor.ts, tool-dispatch.ts, terrain-format.ts, terrain-undo.ts, terrain-brush.ts
**Pattern extraction date:** 2026-11-23
