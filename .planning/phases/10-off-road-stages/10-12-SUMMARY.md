---
phase: 10-off-road-stages
plan: 12
subsystem: tooling
tags: [terrain-editor, route-tool, road-routes, docs]
requires: [10-10, 10-07, 10-06, 10-03]
provides:
  - "Route tool authors Point to point and Circuit road routes (same gestures as stages)"
  - "routes.json load/save through /__terrain/routes with node/edge derived on save"
  - "docs/stages.md: formats, URL parameters, authoring, testing"
affects: []
key-files:
  created: [docs/stages.md]
  modified: [tools/terrain-editor/route-tool.ts]
key-decisions:
  - "Road routes render through a stage-shaped display draft (gates 20 m wide, facing the next item); no width control, Turn only on the start"
  - "Medals notice after save = map has a medals file AND routes differ from the loaded state"
requirements-completed: []
duration: ~40min
completed: 2026-11-23
---

# Phase 10 Plan 12: Road kinds in the Route tool and stage docs Summary

The one Route tool now authors stages, point-to-point and circuit road routes, each saved to its own file, and `docs/stages.md` documents the file formats, URL parameters and authoring flow. MODE-04 is not marked complete; the phase is unfinished.

## Tasks
1. Road kinds in the Route tool - 9a19cb7
2. docs/stages.md - 2be819f

## What changed
- Kind switch enables Point to point / Circuit when the map has road nodes; otherwise the segments stay aria-disabled with "This map has no roads; use Stage". Gate width box shows only for Stage; Laps box (1 to 20) only for a selected circuit.
- Gestures, markers, picker ("Stage:/Point to point:/Circuit:"), item rows, New/Rename/Delete and Test route all work for the selected kind. Off-road checkpoints (> 30 m from any road node) get an "off road" tag and an info-bar warning.
- Load: GET /__terrain/routes/<id> through parseCourseData + routeDraftFromCourse; a parse failure blocks saving an empty list over the file. Save: courseFromRouteDraft per route, serializeCourseData, PUT after the stages PUT.
- editor.ts untouched (hooks are kind-agnostic).

## Deviations
- [Rule 1 - Bug] The editor `api()` helper throws on non-2xx, so the existing stages load never saw a 404 and treated "no stages file" as a load failure (which would block saving maps with no stages). Both stages and routes loads now treat "no stages/routes file" / "404" as absent.
- Medals notice for routes: no medals endpoint exists, so the tool probes `/maps/<id>.medals.json` (JSON body check) on load.

## Verification
tsc clean; biome clean; `npx vitest run tools/terrain-editor tests/route-draft.test.ts` green; docs keyword check passes. `npm run check`: only tests/demo-hills.test.ts D-03 max slope fails (known, pre-existing): 3015 passed, 1 failed. Not exercised in a live browser.

## Self-Check: PASSED
