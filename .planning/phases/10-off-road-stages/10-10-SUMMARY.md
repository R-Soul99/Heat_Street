---
phase: 10-off-road-stages
plan: 10
subsystem: terrain-editor
tags: [editor, route-tool, stages, save, undo]
requires: [10-09]
provides:
  - "Route tool hosted in editor.ts: Place dispatch, pointer/key routing, load/save/undo/sculpt hooks, per-frame tags"
affects: [10-12]
key-files:
  modified: [tools/terrain-editor/editor.ts]
key-decisions:
  - "prepareSave runs after the road checks and before any PUT; commitSave writes stages after the terrain pair; stages failure reported by name, terrain stays saved"
  - "Save-as writes stages under the new area id (then reloads via loadArea)"
  - "Hooks are kind-agnostic (route tool only), so 10-12 needs no editor.ts change"
requirements-completed: []
duration: ~15min
completed: 2026-11-23
---

# Phase 10 Plan 10: Host the Route tool in the editor Summary

The terrain editor now arms the Route tool from Place > Route (key 8), routes pointer and Enter/Backspace/Esc to it, loads stages with the area, saves them after the terrain pair, and refreshes on undo/redo and sculpting. MODE-04 is not marked complete; the phase is unfinished.

## Tasks
1. Construct tool, Place sidebar dispatch, pointer press/move/up/cancel, key routing, per-frame tags - 90f20a7
2. Load (`await routeTool.load`), save (`prepareSave` before PUT, `commitSave` after, medals-at-risk warning), undo/redo (`onUndoApplied`, edited condition), sculpt (`onTerrainEdited` in reseatScenery) - 12a5ba6

## Deviations
- [Rule 3] Added a `UndoTarget` type import and a finite-difference `slopeDegAt` (editor had no point slope sampler). PLACE_HINT.route already existed from 10-09.
- Route Esc is handled in the escape shortcut chain (routeTool.cancel first) rather than a separate keydown listener. Enter/Backspace sit in the post-shortcut guarded section, so they are suspended while typing in a field.
- Info bar warnings use the existing "change" info slot.

## Verification
tsc clean; biome clean; `vitest run tools/terrain-editor` 371 pass; `npm run check` only fails the known demo-hills D-03 slope test. Not exercised in a live browser.

## Self-Check: PASSED
