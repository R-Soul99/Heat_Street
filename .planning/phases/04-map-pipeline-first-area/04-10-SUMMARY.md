---
phase: 04-map-pipeline-first-area
plan: 10
subsystem: physics
tags: [rapier, heightfield, threejs, gltf-transform, dom, hud]

# Dependency graph
requires:
  - phase: 04-map-pipeline-first-area
    provides: plan 04-09's composition root driving the compiled Juliette, GA map (MapScene, MapWorldView, live SC1 render/physics loop)
provides:
  - "DEM-derived off-road heightfield: tools/map-compiler/author/heightfield.ts's buildHeightfield, consumed by both the collision sidecar and the .glb"
  - "collisionVersion 2 (heightfield block), COMPILER_VERSION 0.5.0"
  - "Off-road ground at runtime: src/physics/map-scene.ts's heightfield collider registered as grass, built before road colliders"
  - "Terrain render mesh: MapWorldView.terrainMesh, excluded from roadMeshes/buildingMeshes"
  - "Always-on attribution HUD line: src/hud/map-credit.ts's createMapCredit/mapCreditLines"
  - "SCENE_TARGETS and docs/frame-budget.md revised against the real compiled map"
affects: [04-11]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "MapCollisionHeightfield.heights is a plain number[], not a Float32Array -- JSON.stringify does not serialise a Float32Array as a JSON array; the Float32Array conversion Rapier's ColliderDesc.heightfield wants happens once, at collider-construction time, in src/physics/map-scene.ts"
    - "HUD modules split into a pure content half (Node-testable, no DOM) and a DOM-constructing half (untested in this project's node-environment Vitest, covered by human browser checkpoint) -- src/hud/map-credit.ts mirrors src/hud/speedometer.ts's existing split"

key-files:
  created:
    - tools/map-compiler/author/heightfield.ts
    - tools/map-compiler/author/heightfield.test.ts
    - src/hud/map-credit.ts
    - tests/map-credit.test.ts
  modified:
    - src/core/map-collision.ts
    - tools/map-compiler/author/collision.ts
    - tools/map-compiler/author/gltf.ts
    - tools/map-compiler/cli.ts
    - tools/map-compiler/graph/build-graph.ts
    - src/physics/map-scene.ts
    - src/render/map-view.ts
    - src/core/frame-budget.ts
    - src/main.ts
    - docs/frame-budget.md
    - public/maps/juliette-ga.map.json
    - public/maps/juliette-ga.collision.json
    - public/maps/juliette-ga.glb

key-decisions:
  - "MapCollisionHeightfield.heights is a plain number[] on the wire (both when the compiler writes it and when parseMapCollision reads it back), not a Float32Array as the plan's own <interfaces> section suggested -- verified empirically that JSON.stringify(Float32Array) serialises as an index-keyed object, not a JSON array, which would have silently corrupted the compiled sidecar. The Float32Array conversion Rapier's ColliderDesc.heightfield constructor wants happens once, at the point of collider construction in src/physics/map-scene.ts, not in the parsed type."
  - "HEIGHTFIELD_SINK_M raised from D-P29's planned 0.35m to 5.0m after an exhaustive raycast sweep of every point on every real compiled road edge found up to ~3.95m of raw-DEM-vs-smoothed-road-ribbon disagreement, not the 'tens of centimetres' the plan anticipated -- the real Juliette, GA bounding box is ~5.5km x 5.7km (the plan guessed ~2.9km pre-data), giving the fixed 128-cell grid ~43m of spacing per cell rather than ~23m. Per the plan's own instruction, raised the sink and recompiled rather than loosening the test assertion."
  - "SCENE_TARGETS raised again (drawCalls 70->16, triangles 10,000->45,000, bodies 30->110) against the real compiled map plus this plan's own additions -- the 128x128 terrain mesh alone is 32,768 triangles, by far the largest single contributor in the scene. physicsMs kept at 0.5ms unchanged: the new heightfield collider is cheap and static, and the real measured 0.27ms already has ample headroom."

patterns-established:
  - "Off-road safety-net terrain: a DEM-derived heightfield sized to the map's own bounds, sunk beneath the road surface, uniformly one surface type (grass) -- the pattern any future area's compiler run reuses with zero code changes (only its own DEM/bounds differ)."

requirements-completed: [SC1, SC4]

# Metrics
duration: ~2h (across two sessions -- an earlier stalled executor attempt left partial, tested Task 1 work that this session verified, fixed, and completed)
completed: 2026-09-15
---

# Phase 04: DEM heightfield off-road ground, terrain mesh, attribution credit, and a real-map frame budget

**DEM-derived heightfield ground (grass, sunk 5m beneath the road ribbons) closes the fall-through-the-world gap; an always-on HUD line credits OSM/USGS from the compiled artifact's own data; SCENE_TARGETS now describes the real Juliette, GA map instead of Phase 3's test fixture.**

## Performance

- **Duration:** ~2h across two sessions
- **Completed:** 2026-09-15
- **Tasks:** 3 completed
- **Files modified:** 19 (4 created, 15 modified, including 3 recompiled map artifacts)

## Accomplishments
- Off-road ground exists in both compiled artifacts (`heightfield` block in `.collision.json`, `terrain` mesh in `.glb`), correctly oriented (grid ordering verified empirically against the installed Rapier build via a throwaway raycast probe, documented in `heightfield.ts`'s own header comment), and sunk beneath the road surface.
- The off-road heightfield collider is live at runtime, registered as `grass`, built before the road colliders; 15/15 sampled real road-edge midpoints resolve to their own surface, never `grass`.
- `MapWorldView.terrainMesh` renders the same grid, excluded from both `roadMeshes` and `buildingMeshes`.
- SC4's positive half is satisfied: an always-on HUD line credits `© OpenStreetMap contributors`, the ODbL licence URL, and the USGS 3DEP DEM credit, generated entirely from the loaded map's `attribution` block (a test asserts the shipped source contains no hardcoded `OpenStreetMap` literal).
- `docs/frame-budget.md` and `src/core/frame-budget.ts` now describe the real compiled scene, with Phase 3's fixture-scene reading kept as a dated, explicitly-superseded historical entry.

## Task Commits

Each task was committed atomically:

1. **Task 1: DEM heightfield grid — compiler emit into the sidecar and a terrain mesh in the .glb** - `1772ae6` (feat)
2. **Task 2: Off-road ground at runtime — heightfield collider registered as grass, terrain mesh rendered** - `228fd11` (feat)
3. **Task 3: Attribution credit line and a frame budget that describes the real scene** - `4d0c56a` (feat)

_No separate TDD red/green split -- each task's tests and implementation landed in one commit, matching this phase's established per-task commit granularity._

## Files Created/Modified
- `tools/map-compiler/author/heightfield.ts` - `buildHeightfield`: DEM raster -> downsampled 129x129 heightfield grid, sunk 5m, with Rapier storage-order proof in its own header comment
- `tools/map-compiler/author/heightfield.test.ts` - grid-construction and parse-round-trip coverage
- `src/core/map-collision.ts` - `MapCollisionHeightfield` (plain-array wire type), `collisionVersion` 2, `parseHeightfield`
- `tools/map-compiler/author/collision.ts` - `buildMapCollision` takes a `HeightfieldGrid`, converts to a plain array for JSON
- `tools/map-compiler/author/gltf.ts` - `buildTerrainGeometry`, a `terrain` mesh with `surface-grass` material
- `tools/map-compiler/cli.ts` - wires `buildHeightfield` into both the collision and glTF stages; `COMPILER_VERSION` 0.5.0
- `src/physics/map-scene.ts` - `buildHeightfieldCollider`, built before road colliders, registered as `grass`
- `src/render/map-view.ts` - classifies the `terrain` node into `MapWorldView.terrainMesh`
- `src/hud/map-credit.ts` - `mapCreditLines`/`createMapCredit`, the always-on attribution overlay
- `tests/map-credit.test.ts` - pure-half coverage (this project's Vitest environment has no DOM)
- `src/core/frame-budget.ts` - `SCENE_TARGETS` revised against the real map
- `src/main.ts` - `createMapCredit(graph.attribution)` wired in, ungated
- `docs/frame-budget.md` - new "Real measurement, plan 04-10" section; Phase 3's reading kept as dated history
- `public/maps/juliette-ga.{map.json,collision.json,glb}` - recompiled; verified byte-identical across two consecutive compiles

## Decisions Made
See `key-decisions` in the frontmatter above: the plain-array wire type for `heights`, the raised `HEIGHTFIELD_SINK_M`, and the revised `SCENE_TARGETS`.

## Deviations from Plan

### Auto-fixed Issues

**1. [Correctness] `MapCollisionHeightfield.heights` typed as `Float32Array` would have broken the compiled artifact**
- **Found during:** Task 1, while wiring `buildMapCollision`'s output into `JSON.stringify`
- **Issue:** The plan's `<interfaces>` section describes Rapier's `ColliderDesc.heightfield` wanting a `Float32Array`, and the type was drafted that way. `JSON.stringify` on a `Float32Array` produces an index-keyed object (`{"0":1,"1":2,...}`), not a JSON array — `parseMapCollision`'s own `Array.isArray` check would reject every real compiled sidecar.
- **Fix:** `MapCollisionHeightfield.heights` is a plain `readonly number[]`, matching every other on-disk numeric array in this codebase's schemas (`road-graph.ts`). The `Float32Array` conversion Rapier's constructor wants moved to `src/physics/map-scene.ts`, at the point of collider construction.
- **Files modified:** `src/core/map-collision.ts`, `tools/map-compiler/author/collision.ts`, `tools/map-compiler/author/collision.test.ts`, `tools/map-compiler/author/heightfield.test.ts`
- **Verification:** `tests/map-scene.test.ts`'s real-artifact raycast tests pass; two consecutive compiles are byte-identical
- **Committed in:** `1772ae6` (Task 1 commit)

**2. [Correctness] `HEIGHTFIELD_SINK_M` raised from 0.35m to 5.0m**
- **Found during:** Task 2, while verifying the plan's own acceptance criterion ("every real road midpoint resolves to its own surface, never grass")
- **Issue:** An exhaustive raycast sweep of every point on every real compiled road edge found up to ~3.95m of disagreement between the raw-DEM heightfield samples and the smoothed road ribbons — the real map's bounding box (~5.5km x 5.7km) is roughly twice the area the plan estimated (~2.9km), giving the fixed 128-cell grid coarser spacing (~43m, not ~23m) than assumed, which matters on this area's steepest edge (~35% gradient).
- **Fix:** Raised `HEIGHTFIELD_SINK_M` to 5.0m (comfortable margin over the measured worst case) and recompiled, per the plan's own explicit instruction ("raise HEIGHTFIELD_SINK_M and recompile rather than loosening the assertion").
- **Files modified:** `tools/map-compiler/author/heightfield.ts`, `tools/map-compiler/author/heightfield.test.ts`, recompiled `public/maps/juliette-ga.{collision.json,glb}`
- **Verification:** 15/15 sampled real road-edge midpoints resolve to their own surface; an off-road point resolves to grass
- **Committed in:** `228fd11` (Task 2 commit)

**3. [Test scope] `tests/profiler-hud.test.ts` had two tests hardcoding the pre-revision `SCENE_TARGETS` values**
- **Found during:** Task 3, running the full suite after revising `SCENE_TARGETS`
- **Issue:** Two tests asserted `SCENE_TARGETS.drawCalls === 70` and `SCENE_TARGETS.triangles === 10000` as part of proving the "over budget" HUD marker — these were the OLD Phase 3 values, now stale.
- **Fix:** Updated both tests to assert against the new values (16, 45000) and to compute their "over target" input relative to the live constant rather than a second hardcoded number.
- **Files modified:** `tests/profiler-hud.test.ts`
- **Verification:** `npm run check` green, 831/831 tests passing
- **Committed in:** `4d0c56a` (Task 3 commit)

---

**Total deviations:** 3 auto-fixed (1 correctness — wire-format type, 1 correctness — measured-value correction per the plan's own escape valve, 1 stale-test-value fix as a direct consequence of the plan's own required target revision).
**Impact on plan:** All three were necessary for the compiled artifacts and the frame-budget HUD to be correct, not scope creep — the plan's own text explicitly anticipated and authorized the sink-value correction.

## Issues Encountered
An earlier executor attempt (this same plan, prior session) stalled mid-Task-1 with no commit, leaving tested-but-incomplete work (`heightfield.ts`/`heightfield.test.ts` plus partial `collision.ts`/`map-collision.ts` changes) in an orphaned git worktree. This session located that work, verified it (all 10 of its own tests passed), and continued from it rather than discarding it and starting over — completing Task 1's remaining scope (gltf.ts terrain mesh, cli.ts wiring, recompile), then Tasks 2 and 3, with three atomic commits.

## User Setup Required
None — no external service configuration required.

## Next Phase Readiness
Plan 04-11 (drive every road in Juliette, GA end to end, fix what the drive finds, record the ADR) is unblocked: off-road ground exists, the attribution credit ships, and the frame budget describes the real scene. Two open items carried forward, both explicitly out of scope for this plan and named as such in the code:
- `heightfield.ts`'s `HEIGHTFIELD_RESOLUTION`/`HEIGHTFIELD_SINK_M` are tagged `[ASSUMED]` first-pass values for plan 04-11's feel session.
- The gltf.ts surface colour palette (including the grass/terrain colour) remains flagged `[ASSUMED]` pending plan 04-11's confirmation pass (carried over from plan 04-09's checkpoint, item 5).

---
*Phase: 04-map-pipeline-first-area*
*Completed: 2026-09-15*
