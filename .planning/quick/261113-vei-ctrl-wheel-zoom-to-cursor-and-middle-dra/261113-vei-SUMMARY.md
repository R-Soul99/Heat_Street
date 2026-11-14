# Quick 261113-vei: Ctrl+wheel zoom to cursor, middle-drag orbit/pan Summary

Cursor-centred editor navigation: Ctrl/Meta+wheel zooms toward the cursor in both editors, plain wheel does nothing, terrain middle-drag orbits about the ground point under the cursor, Shift+middle-drag pans.

## Commits
- 5da6962: pure camera maths (`tools/terrain-editor/camera-nav.ts` + tests) and `wheelZoomFactor` in `tools/map-editor/world.ts` (+ tests)
- Task 2 commit (see git log): wiring in `tools/terrain-editor/editor.ts` and `tools/map-editor/editor.ts`, help text updated

## Details
- Terrain: `controls.enableZoom = false`; min/max distance 2 m / 10000 m shared with `zoomTowardPoint`; `pickPivot` falls back to the horizontal plane through the orbit target, then to the target itself. Ctrl+wheel pan removed; Alt+wheel brush size and right-drag behaviour unchanged.
- Map: wheel listener always preventDefault, zooms only when `wheelZoomFactor` is non-null. Middle and Shift+middle already panned.
- Hints updated in both editors. No `src/` changes.

## Deviations from Plan
None in behaviour. Yaw sign in `orbitAboutPivot` was fixed during the test phase (rotation about Y by +dTheta increases Spherical theta). Biome reformatted touched files.

## Verification
tsc clean, vitest tools/terrain-editor + tools/map-editor 203 passed, biome clean. Manual browser checks from the plan not performed.

## Self-Check: PASSED

## Follow-up (user, 2026-11-14)

Plain wheel now zooms toward the cursor too (any wheel zooms; Ctrl+wheel still zooms without page zoom). Commit 370fe9f.
