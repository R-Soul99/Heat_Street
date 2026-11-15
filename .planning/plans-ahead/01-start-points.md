# Plan 1: Start points for test drives

> **Corrections (2026-11-15):** research for Phase 07.1.3 checked this brief against the code and found
> some claims wrong or stale. Where they differ,
> `.planning/phases/07.1.3-editor-feature-palette/07.1.3-RESEARCH.md` (section "Brief Verification") wins.
> Main ones: solo `p2p` and `circuit` also start at the default spawn, so the sidecar default must apply in free drive only; hotkey `P` is taken; start-point ids need a counter outside the list; `loadTerrainArea` must pass the new field through.

Read `README.md` in this folder first (rules that apply to every plan).

## Goal

In the terrain editor the user places named start points, each with a facing
direction. "Drive" starts the car on the chosen start point, facing that way.
The start points are saved with the map, and the game can also be opened on one
by name.

**When it is done the user sees:** a Start point tool in the terrain editor; a
flag-and-arrow marker on the terrain for each start point; a list of them in the
sidebar; a Drive button that says which start point it will use. Opening a map
in the game with no other instructions starts at the map's default start point.

## Current state (why it feels random today)

- `tools/terrain-editor/editor.ts` `driveHere()` (about line 2066) uses
  `lastHit ?? controls.target`. `lastHit` is wherever the mouse last touched the
  terrain, which is usually where the pointer left the canvas on its way to the
  menu. That is the "random" drop.
- It opens `/?map=<id>&at=<x>,<z>&debug`. There is no heading in the URL.
- `src/core/map-select.ts` `parseDriveAt()` validates `?at=x,z` (two decimals,
  at most 32 characters, inside the grid extent).
- `src/core/terrain-drive-setup.ts` `resolveDriveHerePose()` turns it into a
  pose. Heading is the direction of the nearest road, or 0 if there are no
  roads. On open terrain you always face the same way.
- `src/physics/terrain-scene.ts` `resolveTerrainSpawn()` (about line 107): uses
  `spawnOverride` if given, else the road graph spawn with id `DEFAULT_SPAWN_ID`.
  It **throws** if the graph has no such spawn. Height is
  `sampleTerrainHeight(grid, x, z) + SPAWN_CLEARANCE_M`.
- The sidecar (`src/core/terrain-format.ts`, `TerrainSidecar`) has no start
  point field. `unlockedEdgeIds` is the model for adding an optional field: it
  is only written when non-empty, so older files serialise byte-for-byte as
  before.

## Decisions

- **D1. Stored in the sidecar** as an optional `startPoints` array, written only
  when non-empty. No format version bump (same approach as `unlockedEdgeIds`).
- **D2. Shape:** `{ id: string, name: string, x: number, z: number, headingRad: number }`.
  `id` is `start-1`, `start-2`... and never reused. `name` defaults to
  `Start 1`. No `y`: height always comes from the terrain, so sculpting under a
  start point never buries the car.
- **D3. Heading convention** is the existing `VehiclePose.headingRad`. Use
  `yawFromTravelDirection(dx, dz)` from `src/core/heading.ts`; never invent a
  second convention.
- **D4. The first start point in the array is the map's default.** The list in
  the sidebar has a "Make default" action that moves an entry to the front.
- **D5. Spawn priority in the game:** `?at=` (with optional `?heading=`) beats
  `?start=<id>`, which beats the sidecar default, which beats the road graph
  spawn. If none exist, start at the grid centre facing heading 0 instead of
  throwing.
- **D6. Placing is click-and-drag:** press sets the position, drag sets the
  facing, release commits. A click with no drag faces along the nearest road, or
  heading 0.
- **D7. Limits:** at most 32 start points; names at most 40 characters; x and z
  must be inside the grid extent; heading must be finite.
- **D8. "Drive here" stays** as a second action for ad-hoc drops, but it uses
  the point under the cursor at the moment of a right-click or hotkey press,
  not a stale `lastHit`. See stage 5.

## Stages

### Stage 1: Sidecar field (core, tests first)

Files: `src/core/terrain-format.ts`, `tests/terrain-format-start-points.test.ts`
(new), `docs/schemas/` (update the terrain sidecar schema doc there).

1. Read `terrain-format.ts` around `TerrainSidecar`, `serializeTerrainSidecar`,
   `parseTerrainSidecar` and how `unlockedEdgeIds` is parsed and written.
2. Add `export interface TerrainStartPoint` (D2) and
   `readonly startPoints?: readonly TerrainStartPoint[]` on `TerrainSidecar`.
3. Parse: absent means undefined. Present must be an array of at most 32
   entries; each needs a non-empty string `id` (unique), string `name` (1 to 40
   characters), finite `x`, `z`, `headingRad`. Use the file's existing `fail`,
   `reqStr`, `reqNum` helpers so error messages name the path, for example
   `startPoints[2].x`.
4. Serialise: write the key only when the array is non-empty.
5. Tests: round trip; absent key leaves output identical to today (compare
   against a sidecar serialised before your change, e.g. load
   `public/maps/demo-hills.terrain.json`, parse, serialise, expect equal text);
   duplicate id rejected; 33 entries rejected; non-finite number rejected.

Done when: `npx vitest run tests/terrain-format-start-points.test.ts
tests/terrain-format*.test.ts` passes and `npx tsc --noEmit` is clean.

### Stage 2: Spawn resolution (core, tests first)

Files: `src/core/map-select.ts`, `src/core/terrain-drive-setup.ts`,
`src/physics/terrain-scene.ts`, `src/main.ts`, tests beside the existing
`tests/terrain-drive-setup*.test.ts` and `tests/map-select*.test.ts` (find the
exact names with a glob).

1. In `map-select.ts` add `parseDriveHeading(search): number | undefined`.
   Accept `?heading=` as a decimal number of **degrees**, 0 to 360, at most 8
   characters, matching the same strict `DECIMAL` pattern as `parseDriveAt`.
   Return radians. Anything else returns undefined.
2. Add `parseStartId(search): string | undefined`: `?start=` must match
   `/^start-\d{1,3}$/`.
3. In `terrain-drive-setup.ts` add
   `resolveStartPose(search, grid, graph, startPoints)` implementing D5 and
   returning `{ x, z, headingRad } | undefined`. Keep `resolveDriveHerePose`
   and have it use `parseDriveHeading` when present, else the nearest-road
   heading as today. A start point outside the grid extent (the map was
   resized) is skipped.
4. `main.ts`: pass `resolveStartPose(location.search, physicsGrid, graph,
   terrainArea.startPoints)` as `spawnOverride` in place of the current
   `resolveDriveHerePose` call.
5. `terrain-scene.ts` `resolveTerrainSpawn`: when there is no override and no
   graph spawn, use the grid centre and heading 0 instead of throwing. Keep the
   throw for a spawn that references an unknown node (that is a corrupt file).
6. Race modes (`?mode=...`) take their start from the course, not from start
   points. Do not change that. Check by reading how `main.ts` places the car
   for `circuit`, `p2p` and `circuit-race` and confirm your change does not
   alter those paths.

Done when: new tests cover every priority level of D5 and the no-spawn
fallback; `npm run check` passes.

### Stage 3: Editor state and undo

Files: `tools/terrain-editor/tool-dispatch.ts`, its test file, and a new pure
module `tools/terrain-editor/start-points.ts` with `start-points.test.ts`.

1. `start-points.ts` (pure, no DOM): `addStartPoint(list, x, z, headingRad)`,
   `removeStartPoint(list, id)`, `moveStartPoint(list, id, x, z)`,
   `turnStartPoint(list, id, headingRad)`, `renameStartPoint(list, id, name)`,
   `makeDefault(list, id)`, `nextStartId(list)`. All return a new array and
   never mutate. `nextStartId` is one more than the highest number ever present
   in the list.
2. Undo: read `src/core/terrain-undo.ts` and how road-graph changes are
   recorded (`diff.graph` with before/after). Add an equivalent optional
   `startPoints: { before, after }` part to the diff so each add, move, turn,
   rename, delete or make-default is one undo step. Follow the existing pattern
   exactly; do not build a second undo stack.
3. Tests: each operation; undo then redo restores exact arrays; ids are not
   reused after delete.

Done when: `npx vitest run tools/terrain-editor` passes.

### Stage 4: Editor tool, markers and sidebar

Files: `tools/terrain-editor/rail-tools.ts` (toolbar data),
`tools/terrain-editor/toolbar-state.ts`, `tools/terrain-editor/editor.ts`.

Show the user a layout sketch first (rule 11). Proposed layout:

- A **Place** group in the top bar with one entry for now, **Start point**
  (hotkey `P`; check `rail-tools.ts` and the hotkey audit test for clashes).
  Plan 2 adds scenery to the same group.
- Left sidebar section **Start points**: a list with name (editable), a
  "Make default" star, a "Go to" button that centres the camera, and Delete.
  The default is marked.

Steps:

1. Add the tool to the toolbar data and state modules, following how the Road
   drop-down entries are declared and tested.
2. Pointer handling in `editor.ts`: with the tool active, pointer-down on the
   terrain records the position; pointer-move draws a preview arrow from that
   position to the cursor; pointer-up commits via the dispatcher. If the drag
   is shorter than 1 m use the fallback heading (D6). Clicking an existing
   marker selects it; dragging it moves it; Delete removes it.
3. Marker: a `THREE.Group` per start point with a thin pole, a small flag and a
   flat arrow on the ground showing heading. Sit it on
   `sampleTerrainHeight(area.grid, x, z)`. Rebuild marker heights after any
   sculpt operation that touches its cell (hook into wherever the editor
   refreshes overlays after `applyResult`). The default start point is a
   different colour. Dispose geometry and materials when markers are removed.
4. Save path: confirm the editor's save builds the sidecar from the live area
   object so `startPoints` is included (read `save-pair.ts` and the `save()`
   function). The dev-server PUT validates the sidecar with
   `parseTerrainSidecar`, so stage 1 already covers the server side.

Done when: a start point can be placed, turned, moved, renamed, deleted, undone
and redone; it survives save and reload; `npm run check` passes.

### Stage 5: Drive buttons

File: `tools/terrain-editor/editor.ts`.

1. Replace the single Drive action with **Drive from: <name>** using the
   selected start point, or the default if none is selected. It opens
   `/?map=<id>&start=<start id>&debug`. If the map has no start points, the
   info bar says "Place a start point first, or use Drive here."
2. Keep **Drive here** as a secondary menu entry and hotkey. Fix the stale
   position: capture the terrain point under the cursor at the moment the
   hotkey is pressed. When invoked from the menu, use the camera target and
   say so in the info bar ("Driving from the centre of the view"). Add
   `&heading=<deg>` set to the camera's look direction projected onto the
   ground, so the car faces the way the user was looking.
3. Both still call `save()` first and still check `/__terrain/drivable/<id>`.

Done when: both actions open the game at the expected spot and facing.

## Human check (about two minutes)

1. Open the terrain editor on any map. Place two start points facing different
   ways, one on a road and one on open ground.
2. Press Drive with each selected: the car is where the marker was, facing
   along the arrow.
3. Reload the editor: both are still there.
4. Open `/?map=<id>` with no other parameters: the car is on the default one.
5. Open `/?map=juliette-ga&mode=circuit`: the race start is unchanged.

## Traps

- Heading maths: always go through `src/core/heading.ts`. A sign error here
  shows up as the car facing backwards only on some compass directions.
- `parseDriveAt` validates against the grid extent on purpose (a new area has
  no roads). Do the same for start points.
- Do not put `y` in the file.
- The game ignores unknown URL parameters silently by design. Keep every new
  parameter on a strict allowlist pattern; never index an object with a raw
  URL string.
- `public/maps/arena-test.terrain.*` is the user's working map. Test on
  `demo-hills` or a new area, and do not commit map files you changed while
  testing.
