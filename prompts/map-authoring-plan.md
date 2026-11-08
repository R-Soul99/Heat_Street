# Heat Street: Map Authoring Plan

**Goal:** import the Newton Poppleford export as a playable area, then add hand-authored maps on the same pipeline.

**Key finding:** the map compiler (`tools/map-compiler`) already turns a raw "OSM-shaped" JSON into `.map.json`, `.glb`, `.collision.json`, routes and medals. The synthetic maps (`feel-test`, `grid-test`) are written by code into that same raw format. Hand-authored and imported maps should target it too, so physics, minimap and AI pathfinding all work unchanged. Schema: `docs/schemas/road-graph.v1.md`.

## The export (Newton Poppleford, Devon)
- Roads GeoJSON: 204 polylines (70 residential, 48 service, 35 unclassified, 30 track, 19 primary, 2 secondary). Properties are only `highway`, `name`, `ref`, `id`. No surface, width, lanes, oneway or bridge info.
- Buildings GeoJSON: 835 polygons with `height`, `levels`, `type`, `subtype`, `areaSqM`. The CSV is the same data as a table.
- Terrain `.glb`: 64x64 terrain mesh plus 834 building boxes, nodes named by OSM id.
- bbox: [-3.32593, 50.69222, -3.27586, 50.70711]
- Still OpenStreetMap data (OSM ids), so ODbL attribution applies.

## Phase 1: Importer (real-area map)
1. Add `tools/map-compiler/import/geojson-to-raw-osm.ts`. Read the roads and buildings GeoJSON and write `<areaId>.raw-osm.json` and `<areaId>.raw-buildings.json` in the same envelope as the synthetic generators (copy the shape from `generate-grid-test.ts` and `grid-layout.ts`).
2. Give each unique coordinate a synthetic node id. Road endpoints share exact coordinates, so junctions come from matching them. Keep OSM feature ids as way ids.
3. Pass through `highway`, `name`, `ref`. Do not invent `surface`, `lanes` or `width`; the compiler's fallbacks and schema mapping decide those.
4. Buildings: map `height` and `levels` onto the tags the building stage reads; keep ids.
5. Add `newton-poppleford.config.ts` (bbox above, `demSource: "none-flat-authored"`, `osmExtract` labelled as an AI Studio export).
6. Run `compile-map -- --area newton-poppleford`, load it and drive it.

**Check first:** whether the compiler fails on missing optional tags, and whether a ~3.5km area fits the frame budget (`docs/frame-budget.md`); existing maps are much smaller.

## Phase 2: Terrain .glb
- Inspect the mesh and report its elevation range.
- If flat: ignore it.
- If real relief: do not import as-is. The design keeps roads flat and treats relief and crests as separate authored artifacts. Choose between sampling it into the off-road heightfield, or staying flat with a few hand-placed crests.

## Phase 3: Hand-editing tool
- Dev-only top-down editor page in Vite, outside `src/` so the layering tests are unaffected.
- Loads and saves the raw-OSM JSON, so it edits imported and blank areas alike.
- Features: polyline road drawing, per-way surface/width/oneway, building footprints, crest domes, spawn and route markers, "drive here" button.
- Build order: view and select, then edit tags, then draw and move nodes, then markers.

## Phase 4: Surface tagging for real areas
- Real-area maps compile to almost all tarmac and dirt_road. Use the editor to repaint chosen roads as gravel, mud or sand.

## Risk
A faithful real village is not necessarily a good chase map. Newton Poppleford is basically one main road with a few lanes off it. Expect to edit the layout in Phase 3 rather than keep it exact.
