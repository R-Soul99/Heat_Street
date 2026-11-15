# Plan 2: Scenery palette (roadmap Phase 07.1.3)

> **Corrections (2026-11-15):** research for Phase 07.1.3 checked this brief against the code and found
> some claims wrong or stale. Where they differ,
> `.planning/phases/07.1.3-editor-feature-palette/07.1.3-RESEARCH.md` (section "Brief Verification") wins.
> Main ones: AI cars avoid no scenery today (the forward ray only sees cars); individually fading buildings conflict with the draw budget; `MAX_AREA_SIZE_M` is an edge length, not a coordinate bound; palette buildings on legacy-glb maps need drawing; scenery should share one fixed body and not cast shadows; low fences and hedges act as kerbs for the wheel rays.

Read `README.md` in this folder first. Do Plan 1 first: this plan reuses its
Place tool group, marker handling and undo part.

## Goal

The terrain editor has a palette for placing map features: buildings, trees,
bushes, hedges, fences and ramps. Placed features are saved with the map, drawn
in the game, and solid where they should be.

**When it is done the user sees:** a Place menu in the terrain editor with a
palette in the sidebar; click to drop trees and buildings, drag to draw a hedge
or fence line; everything shows up in a test drive and the car hits what it
should hit.

## Current state

- **Sidecar** (`src/core/terrain-format.ts`): `objects` holds only
  `{ kind: "crest", crest }` (domes and ramps; `parseObject` rejects any other
  kind). `buildings` holds `MapCollisionBuilding`
  `{ center, halfExtents, rotationY }`.
- **Physics** (`src/physics/terrain-scene.ts`): every sidecar building gets a
  fixed cuboid via `buildBuildingCollider` (in `map-scene.ts`). Crests get
  trimesh colliders.
- **Render** (`src/main.ts` about lines 415-440): on terrain maps, building
  meshes come **only** from the legacy `.glb` when `legacyGlbBuildings` is true.
  A building added to a terrain-native map has a collider and **no visible
  mesh**. This is the first thing to fix.
- **Terrain editor** (`tools/terrain-editor/editor.ts`): no building, crest or
  object handling at all. It has modes (Select, Brush), operations, a Road
  drop-down, and a dispatcher (`tool-dispatch.ts`) that owns undo.
- **Map editor** (`tools/map-editor/`): has `addBuildingRect`, `pickBuilding`
  and box select for buildings on legacy maps. Useful as a reference for
  interaction, not for storage.
- **Who else reads buildings:** the camera occlusion probe and fade
  (`src/render/camera/occlusion-probe.ts`, `occlusion-controller.ts`) take
  `mapView.buildingMeshes`; pursuit line of sight (`lineOfSightClear` in
  `src/physics/ai-avoidance.ts`) raycasts colliders; the AI avoidance ray does
  too.
- **Frame budget** (`docs/frame-budget.md`): draw calls target under 80,
  triangles under 90,000, render CPU under 6 ms. Juliette already peaks near 65
  draws. Scenery must be instanced.

## Decisions

- **D1. One new sidecar array, `features`**, optional, written only when
  non-empty. Leave `objects` (crests) and `buildings` alone so existing maps
  and their tests are untouched. Buildings placed from the palette go into the
  existing `buildings` array, extended with an optional `style` string.
- **D2. Feature shapes** (a discriminated union on `kind`):
  - `tree`, `bush`: `{ id, kind, variant, x, z, rotationY, scale }`
  - `hedge`, `fence`: `{ id, kind, variant, points: [x, z][] , heightM }`
    (a polyline; at least 2 points, at most 64)
  - Ramps stay as crest objects; the palette just creates one (stage 7).
  No `y` anywhere: height is sampled from the terrain at load.
- **D3. Catalog in code**, not in the file: `src/core/scenery-catalog.ts` lists
  each `kind`/`variant` with its size, collider and colour. Files store only
  the variant id. An unknown variant fails parsing with a clear message.
- **D4. What is solid:**
  | Feature | Collider | Blocks camera/line of sight |
  |---|---|---|
  | Building | cuboid (existing) | yes |
  | Tree | fixed cylinder on the trunk only, radius from catalog | no |
  | Bush | none (drive through) | no |
  | Hedge | fixed cuboid per segment, full height | yes for line of sight, no camera fade |
  | Fence | fixed cuboid per segment, thin | no |
  **ASK:** should fences and bushes be solid, or break/drive through? Default
  as in the table: fences solid, bushes not. Breakable props are roadmap
  GET-06 and out of scope.
- **D5. Low-poly procedural meshes built in code** for this plan (cones and
  cylinders for trees, boxes for hedges, posts and rails for fences, boxes with
  a pitched or flat roof for buildings). Plan 5 or later art work can swap in
  glTF models behind the same catalog ids. This keeps the editor usable now.
- **D6. Rendering uses `THREE.InstancedMesh`**: one per tree variant part
  (trunk, canopy), one per bush variant, one merged mesh for all hedges, one
  for all fences, one merged mesh per building style. Budget: scenery adds at
  most 12 draw calls in total and 40,000 triangles.
- **D7. Limits:** 4,000 point features, 500 line features, 2,000 buildings per
  map. Parsing rejects more.
- **D8. Features never go on a road.** Placing inside road paint is refused
  with an info-bar message. Use the paint map's road flag (`PAINT_ROAD_FLAG`),
  the same test the paint operations use.
- **D9. Same module builds the game view and the editor view**, so what the
  user places is exactly what they drive past.

## Stages

### Stage 1: Catalog and sidecar (core, tests first)

Files: `src/core/scenery-catalog.ts` (new), `src/core/terrain-format.ts`,
`tests/scenery-catalog.test.ts`, `tests/terrain-format-features.test.ts`,
schema doc in `docs/schemas/`.

1. Catalog: `SCENERY_KINDS = ["tree","bush","hedge","fence"] as const`; a frozen
   table of variants. Start small: trees `pine`, `oak`, `dead`; bushes
   `round`, `scrub`; hedges `box`; fences `post-rail`, `picket`, `chainlink`;
   building styles `shed`, `house`, `barn`, `shop`, `block`. Each entry has the
   numbers render and physics need (trunk radius and height, canopy radius,
   default heights, colours as hex integers, default footprint for buildings).
   `resolveVariant(kind, id)` uses array `find`, never object-key lookup with
   file input.
2. Sidecar: add `TerrainFeature` union (D2) and `features?` on
   `TerrainSidecar`; add optional `style?: string` on buildings **in the
   terrain sidecar parser only** (do not change `MapCollisionBuilding` in
   `map-collision.ts`; make a `TerrainBuilding extends MapCollisionBuilding`
   type so the legacy collision parser and its tests are untouched).
3. Validation: ids unique; coordinates finite and within `MAX_AREA_SIZE_M`;
   `scale` 0.5 to 2; `heightM` 0.3 to 6; polylines 2 to 64 points; limits D7;
   variant must resolve.
4. Tests: round trip; absent key keeps existing files byte-identical; each
   rejection.

Done when: targeted vitest files pass, `npx tsc --noEmit` clean.

### Stage 2: Feature geometry (core, pure)

File: `src/core/scenery-geometry.ts` (new), with tests.

Pure functions that turn features plus a height sampler `(x, z) => y` into
plain data (no three, no rapier):

- `featureColliders(features, heightAt)` returns a list of
  `{ shape: "cylinder" | "cuboid", center, halfExtents or radius/halfHeight, rotationY, blocksSight }`.
  Hedge and fence segments: one cuboid per polyline segment, centred at the
  segment midpoint at the average of the two end heights, length the segment
  length, rotated to the segment direction. Split segments longer than 8 m so
  boxes follow slopes.
- `featureInstances(features, heightAt)` returns per-variant arrays of
  instance transforms (position, rotationY, scale) for trees and bushes, and
  for hedges/fences a list of segment boxes and fence post positions (posts
  every 2.5 m).
- `buildingBoxes(buildings)` returns boxes grouped by style, with roof type
  from the catalog.

Tests: counts, positions on a sloped sampler, a 20 m hedge on flat ground
gives 3 segments, zero-length segments are dropped.

### Stage 3: Game physics

File: `src/physics/terrain-scene.ts`, test beside the existing terrain-scene
tests.

1. Add `features` to `TerrainSceneInput` (default empty). After the building
   loop, create one fixed body and attach a collider per entry from
   `featureColliders`, with `BUILDING_FRICTION`.
2. Register nothing in the surface map for them (they are not ground).
3. Mark trunk and fence colliders so line of sight ignores them. Read
   `lineOfSightClear` first: it takes a set of collider handles to ignore
   (`carColliderHandles`). Expose a `sightTransparentHandles` set on the scene
   and pass the union at the call sites. Do not change what the AI forward
   avoidance ray sees: AI cars should avoid trees.
4. `main.ts`: pass `terrainArea.features ?? []`.
5. Test: a world with one tree; a ray through the trunk hits; a box dropped
   beside it does not.

Done when: the test passes and `npm run check` is green.

### Stage 4: Game rendering

Files: `src/render/scenery-view.ts` (new), `src/main.ts`.

1. `createSceneryView(features, buildings, heightAt)` returns
   `{ group, buildingMeshes, dispose }`. Use `MeshStandardMaterial` only
   (no custom shaders; see the stack notes in `CLAUDE.md`). Instanced meshes
   per D6. `castShadow` true for buildings and tree canopies only.
2. Buildings: the occlusion controller fades each mesh in `buildingMeshes` by
   its own material, so buildings merged into one mesh would all fade
   together. Read `occlusion-controller.ts` first. Then: when the map has 150
   buildings or fewer, build one `THREE.Mesh` per building with its own
   material and list them all in `buildingMeshes` (they fade individually).
   Above 150, merge by style and leave the merged meshes out of
   `buildingMeshes` (no fade). Log which path was taken in `?debug`. Record
   the measured draw calls in `docs/frame-budget.md`.
3. `main.ts` terrain branch: build the scenery view for sidecar buildings that
   are **not** covered by a legacy glb (when `legacyGlbBuildings` is true the
   glb already draws them; draw only features in that case). Add its group to
   the map group, append its `buildingMeshes` to `mapView.buildingMeshes`, and
   dispose it in `dispose()`.
4. Measure on `?map=grid-test&debug` and a map with 500 trees: draws and
   triangles within the D6 budget. If over, reduce canopy segment counts
   before anything else.

Done when: a hand-edited sidecar with a building, three trees and a hedge
shows all of them in the game, and the car collides with the building, trunk
and hedge.

### Stage 5: Editor operations and undo (pure)

Files: `tools/terrain-editor/features.ts` (new) with tests,
`tools/terrain-editor/tool-dispatch.ts`.

1. Pure operations returning new arrays: add point feature, add line feature,
   add building, move, rotate, scale, delete, delete all inside a selection
   mask (`CellMask.cellAtXZ`), `nextFeatureId`.
2. `canPlaceAt(paint, x, z)` implementing D8; for a line, every sampled point
   along it.
3. Undo: extend the diff with `features` and `buildings` before/after parts,
   the same way Plan 1 added `startPoints`. One drag is one undo step.
4. Tests for each operation and for undo/redo.

### Stage 6: Editor palette UI

Files: `tools/terrain-editor/rail-tools.ts`, `toolbar-state.ts`, `editor.ts`,
their tests. **Sketch the layout for the user first** (rule 11). Proposal:

- Top bar **Place ▾** drop-down: Start point (from Plan 1), Building, Tree,
  Bush, Hedge, Fence, Ramp. Picking one closes the menu and activates it.
- Left sidebar **Palette** panel for the active kind: variant swatches in even
  rows (3 across), then the option values for that kind only: tree and bush
  have Scale and Random rotation (on by default); hedge and fence have Height;
  building has Width, Depth, Height and Rotation.
- A **Scatter** toggle for trees and bushes: drag paints features at a density
  slider (features per 100 m², 1 to 20) inside the brush circle, using a
  seeded random so the preview matches the result.

Steps:

1. Point kinds: click places; a ghost preview follows the cursor; refused spots
   (D8) show the ghost in red with the reason in the info bar.
2. Line kinds: click adds points, double-click or Enter finishes, Esc cancels,
   Backspace removes the last point. Show the running length.
3. Buildings: click and drag draws the footprint rectangle; mouse wheel while
   dragging rotates in 15 degree steps; height from the sidebar. Seat the box
   on the **lowest** terrain height under its footprint and extend it down by
   the height difference so no corner floats.
4. Selecting: in Select mode, clicking a feature selects it (show a highlight
   box); drag moves; Delete removes; a box selection plus Delete removes all
   features inside (ask for confirmation above 20).
5. The editor draws features with `createSceneryView` from stage 4 (D9).
   Rebuild only the changed kind after an edit, not everything.
6. Re-seat features after sculpting: after any height operation, re-run the
   view build for features whose position lies inside the touched window.
7. Hotkeys: add to the hotkey table and make sure the existing hotkey audit
   test passes.

Done when: every kind can be placed, selected, moved, deleted, undone and
redone, and survives save and reload.

### Stage 7: Ramps from the palette

Crest and ramp objects already exist in the format (`AuthoredCrest`,
`RampSpec` in `src/core/crest-geometry.ts`) and already work in the game.

1. Read `crest-geometry.ts` (`RampSpec`, `rampLengthM`, `buildCrestGeometry`)
   and `parseObject` in `terrain-format.ts`.
2. Palette entry Ramp: click places a ramp crest with sidebar values for
   height (0.5 to `MAX_CREST_HEIGHT_M`), angle and width, within the ranges
   `parseRamp` accepts; drag sets direction.
3. Draw it in the editor with the same builder the game uses.
4. Undo part for `objects`, as for features.

Do not change ramp shapes to make jumps feel better (rule 9).

### Stage 8: Gate and docs

1. `npm run check`.
2. Update `docs/schemas/` and add a short "Scenery" section to
   `docs/terrain-migration.md` or a new `docs/scenery.md`: catalog ids,
   limits, what is solid.
3. Record measured draw calls and triangles in `docs/frame-budget.md`.

## Human check (about five minutes)

1. In the terrain editor on a small map, place a house, a barn, a row of five
   trees, a scatter of bushes, a hedge along a road and a fence round a field.
2. Undo three times, redo three times.
3. Save, reload: all still there.
4. Drive: hit the house, a tree trunk, the hedge and the fence (solid); drive
   through a bush (not solid). The camera still fades a building that blocks
   the view of the car.
5. `?debug`: frame time and draw calls look normal.

## Traps

- **Invisible buildings.** Stage 4 exists because terrain-native buildings are
  not drawn today. Check that case explicitly.
- **Merged meshes and the camera fade.** See stage 4 step 2.
- **Do not add a second undo stack** or a second write path to the area.
- **Instanced mesh bounds:** call `computeBoundingSphere()` after setting
  instance matrices or instances get culled wrongly.
- **Heights:** sample with the same function the collider uses
  (`sampleTerrainHeight` on the physics grid), or features float or sink.
- **Trimesh colliders are not needed** for any of this. Cuboids and cylinders
  only.
- **Line of sight:** a solid hedge blocking pursuit sight is intended; it is an
  escape tool. Tree trunks must not block it.
- **Catalog ids are a file format.** Never rename one after a map uses it; add
  a new id instead.
