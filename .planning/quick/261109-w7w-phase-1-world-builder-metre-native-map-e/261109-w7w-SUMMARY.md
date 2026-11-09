---
phase: quick-261109-w7w
plan: 01
subsystem: tools/map-editor
tags: [map-editor, world-builder, metres, tiles]
requirements-completed: [WB-P1-1, WB-P1-2, WB-P1-3, WB-P1-4, WB-P1-5]
key-files:
  created:
    - tools/map-editor/world.ts
    - tools/map-editor/world.test.ts
    - tools/map-editor/new-world.ts
    - tools/map-compiler/areas/world-test.config.ts
    - tools/map-compiler/areas/world-test.raw-osm.json
    - tools/map-compiler/areas/world-test.raw-buildings.json
  modified:
    - tools/map-editor/model.ts
    - tools/map-editor/editor.ts
    - tools/map-editor/index.html
    - tools/map-editor/vite-plugin.ts
    - tools/map-compiler/cli.ts
completed: 2026-11-09
---

# Quick 261109-w7w: Phase 1 World Builder, metre-native map editor

Map editor now works in metres (x east, y north, SW corner origin) using the compiler's own metres-per-degree series, with adaptive grid, tile grid, scale bar, smooth zoom, and a New world action that writes a synthetic-bbox raw-OSM pair plus config. A blank 6 km `world-test` area is registered.

## Commits
- f959755 Task 1: world.ts (pure, tested), model.ts projector delegates to it
- 2c95678 Task 2: metre canvas, grid, tile grid, scale bar, zoom, culling
- 2287b3f Task 3: new-world helper/CLI/endpoint/form, world-test area + cli.ts registry entry

## Notes
- Projector origin moved from bbox centre to SW corner and now uses the compiler series; lat/lon in saved files is only rewritten for elements that are edited (untouched elements are not re-projected). Existing model/draw tests passed unchanged.
- Tile labels "c,r": c from west, r from north (row 0 at top, label at tile top-left). Phase 5 may want to revisit the naming.
- Zoom: exp(-deltaY*0.0015), clamp fitScale/4 .. 20 px/m. Redraws coalesced via rAF; per-way projected points and AABB cached (geometryVersion), off-screen ways skipped.
- Compile proof: with a temporary 400 m square road added, `node tools/map-compiler/cli.ts --area world-test` ran to completion (validation PASSED, wrote map.json/glb/collision.json). Raw file restored to blank, public/maps/world-test.* deleted; nothing compiled is committed.
- The new-world POST endpoint was not exercised against a live server (dev server untouched); the shared writeNewWorld helper was exercised via the CLI. Browser behaviour (zoom feel, drawing) was not human-verified.

## Deviations
None to the plan. Compiler code untouched (only the one import and KNOWN_AREAS line in cli.ts).

## Verification
- `npm run typecheck`: pass
- `npm test`: 154 files, 1971 passed, 1 skipped, 2 todo
- `npm run lint`: FAILS with 4 errors / 4 warnings, all pre-existing and outside this task (logs/_scratch/lift*.test.ts, tools/map-compiler/author/gltf.test.ts). Files touched by this task are lint-clean (`biome check tools/map-editor tools/map-compiler/areas tools/map-compiler/cli.ts`).

## Self-Check: PASSED
