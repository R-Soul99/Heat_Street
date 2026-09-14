---
phase: 04-map-pipeline-first-area
plan: 08
subsystem: physics
tags: [rapier, trimesh, collision, surface-map, map-pipeline, glTF-companion]

# Dependency graph
requires:
  - phase: 04-map-pipeline-first-area (plan 04-03)
    provides: buildRoadGeometry / RoadGeometry (src/core/road-geometry.ts) — the per-edge/
      per-junction ribbon+fan geometry this plan turns into live Rapier trimesh colliders
  - phase: 04-map-pipeline-first-area (plan 04-07)
    provides: BuildingBox prisms (tools/map-compiler/geometry/building-box.ts) — this plan's
      collision sidecar derives center/halfExtents/rotationY from their baked corners
  - phase: 03-vehicle-feel-and-surfaces
    provides: SurfaceMap / SurfaceContext (src/physics/surface.ts) and the buildSurfaceZone/
      buildBuilding collider-construction pattern (src/physics/surface-scene.ts) this plan's
      MapScene mirrors structurally
provides:
  - src/core/map-collision.ts — MapCollision/MapCollisionBuilding shape and parseMapCollision(),
    the collision-sidecar contract shared by the compiler and the runtime
  - tools/map-compiler/author/collision.ts — buildMapCollision(): BuildingBox prisms -> sidecar
    entries, data-only, no Rapier import
  - public/maps/juliette-ga.collision.json — 85 real building colliders, byte-identical across
    two consecutive compiles
  - src/physics/map-scene.ts — createMapScene(): the compiled area as a live Rapier scene, one
    trimesh collider per road edge/junction (each registered into a SurfaceMap), one cuboid
    collider per building, one vehicle spawned on the road
affects: [phase-04-09-runtime-map-loader, phase-05-game-modes]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Non-road collision data ships as a versioned sidecar (<areaId>.collision.json), never a
      schema addition to the normative, closed-at-v1 road-graph.v1.md — road collision still
      derives from the same road graph via buildRoadGeometry"
    - "A collision box's center/halfExtents/rotationY are DERIVED from its already-baked prism
      corner vertices (never a second, independently-computed rotation value) — one source of
      truth for a building's footprint geometry, shared by the .glb and the physics collider"
    - "All road colliders (every edge + every junction) share ONE fixed rigid body — Rapier's
      broadphase treats many fixed colliders on one body as efficiently as one body per collider,
      and sharing avoids allocating one RigidBody WASM wrapper per collider on a map this size"
    - "MapScene mirrors SurfaceScene's exact interface shape (bodies/vehicle/surfaces/preTick/
      applyInput/setTuning/setSurfaceProfiles/dispose) so src/main.ts and startLoop need no
      structural change when the composition root eventually swaps scenes"

key-files:
  created:
    - src/core/map-collision.ts
    - tools/map-compiler/author/collision.ts
    - tools/map-compiler/author/collision.test.ts
    - src/physics/map-scene.ts
    - tests/map-scene.test.ts
  modified:
    - tools/map-compiler/cli.ts
    - tools/map-compiler/graph/build-graph.ts (COMPILER_VERSION 0.3.0 -> 0.4.0)
    - tests/compiled-map.test.ts (compilerVersion assertion updated to 0.4.0)
    - public/maps/juliette-ga.map.json (regenerated; compilerVersion 0.4.0 only)
  created-artifact:
    - public/maps/juliette-ga.collision.json

key-decisions:
  - "D-P22/D-P23/D-P24 (sidecar not schema addition, one collider per edge/junction never merged,
    createMapScene takes an already-parsed RoadGraph+MapCollision) — all three decided in the
    plan, implemented exactly as specified"
  - "Road colliders share ONE fixed rigid body rather than one body per collider — the plan left
    this choice open ('whichever is chosen, it is stated and asserted'); chosen for efficiency
    (avoids ~100 RigidBody WASM wrapper allocations) and verified by test: all road-collider
    parent handles are identical and the shared body is fixed"
  - "Building collision boxes derive rotationY/halfExtents from BuildingBox's baked world-space
    prism corners (edge01 for the local-X axis, edge12 for local-Z) rather than threading a
    second rotation value through BuildingBox's own shape — verified empirically that Rapier's
    Y-axis quaternion convention (local +X -> world (cos theta, 0, -sin theta), confirmed against
    src/physics/vehicle.ts's rotateVec) round-trips exactly back to the original rectangle"

patterns-established:
  - "Collider-shape introspection for tests: collider.shapeType() (RAPIER.ShapeType.TriMesh/
    Cuboid) plus collider.shape.flags for TriMesh (verified empirically this session — the
    binding decodes real flags back from the WASM shape, not just an echo of the constructor
    argument) lets a test distinguish and verify collider construction without re-deriving
    geometry"
  - "world.colliders.forEach visits Rapier's arena in collider-creation order for a freshly-built
    world with no removals (verified empirically this session) — used to map collider index back
    to the exact graph.edges/geometry.junctions/collision.buildings entry that produced it,
    without needing the scene factory to export its own internal geometry"

requirements-completed: [SC1, SC2, SC3]

# Metrics
duration: ~55min
completed: 2026-09-14
---

# Phase 04 Plan 08: Collision Sidecar and MapScene Summary

**The compiled Juliette, GA area is now a physically solid place: every one of its 100 road-geometry entries (64 edges + 36 junctions) is a real Rapier trimesh collider carrying its own surface type with zero hand-tagging, all 85 real OSM buildings are solid cuboids correctly oriented from a new collision sidecar, and a headless 120-tick settle test proves a car dropped on the real compiled map lands upright on tarmac.**

## Performance

- **Duration:** ~55 min active work
- **Completed:** 2026-09-14
- **Tasks:** 2 (collision sidecar compiler+parser, MapScene runtime loader)
- **Files modified:** 10 total (6 created, 4 modified) plus 1 binary/JSON artifact regenerated

## Accomplishments

- **Task 1:** `src/core/map-collision.ts` + `tools/map-compiler/author/collision.ts` ship the
  non-road collision sidecar:
  - `parseMapCollision` follows `road-graph.ts`'s exact discipline — field-by-field
    reconstruction, never a spread of the parsed value (T-04-01), plus an `areaId` match check
    against a caller-supplied expected id (T-04-30) so a mismatched `.map.json`/`.collision.json`
    pair fails loudly instead of silently placing buildings in the wrong town.
  - `buildMapCollision` derives each building's `center`/`halfExtents`/`rotationY` directly from
    `BuildingBox`'s already-baked world-space prism corners — no second, independently-computed
    rotation value anywhere.
  - `cli.ts` writes `public/maps/<areaId>.collision.json` after the glTF stage, self-checking its
    own output through `parseMapCollision` before writing (mirrors `buildGraph`'s own
    self-check). `COMPILER_VERSION` bumped `0.3.0` -> `0.4.0`.
  - **Real compile output:** `public/maps/juliette-ga.collision.json`, 85 buildings, 24510 bytes,
    byte-identical across two consecutive compiles.
- **Task 2:** `src/physics/map-scene.ts` turns the compiled area into a live physics scene:
  - `createMapScene(world, graph, collision, tuning, profiles)` mirrors
    `src/physics/surface-scene.ts`'s exact `SurfaceScene` contract shape.
  - One shared fixed body carries every road edge/junction trimesh collider
    (`TriMeshFlags.FIX_INTERNAL_EDGES` on all of them), each registered into a fresh `SurfaceMap`
    with its own entry's surface — verified against the REAL compiled map that every road
    collider's `surfaces.map.lookup()` matches its source edge's surface, not just a spot-check.
  - Buildings become individual fixed cuboid colliders from the sidecar, deliberately never
    registered in the `SurfaceMap` (matches `surface-scene.ts`'s documented T-03-16 acceptance).
  - Vehicle spawns at the graph's `"default"` spawn node, 0.6 m above it, heading applied as a
    post-construction Y rotation on the chassis body; throws naming the area id when no default
    spawn exists (T-04-31) rather than spawning at the origin under the terrain.
  - `tests/map-scene.test.ts` runs entirely against the REAL committed
    `juliette-ga.map.json`/`.collision.json` in a real Rapier world: collider count, per-collider
    surface correctness (every entry, not just gravel/tarmac spot-checks), the
    `FIX_INTERNAL_EDGES` flag round-tripped from the live collider shape, single shared road
    body, building geometry/orientation, spawn placement, the missing-spawn failure path, and a
    120-tick settle proof (chassis stays within 1 m of spawn height, tilt under 15 degrees).

## Task Commits

Each task was committed atomically:

1. **Task 1: Collision sidecar — compiler emit and shared parser** - `fef712e` (feat)
2. **Task 2: MapScene — per-edge trimesh colliders, SurfaceMap registration, buildings, spawn** - `6a86c26` (feat)

## Files Created/Modified

- `src/core/map-collision.ts` — `MapCollision`/`MapCollisionBuilding` types, `parseMapCollision()`.
- `tools/map-compiler/author/collision.ts` — `buildMapCollision()`, deriving sidecar entries from
  `BuildingBox` prism corners.
- `tools/map-compiler/author/collision.test.ts` — 11 tests, one per `<behavior>` bullet plus the
  byte-identical re-emit proof and a prototype-pollution guard test.
- `tools/map-compiler/cli.ts` — imports the new collision modules, writes the sidecar after the
  glTF stage, self-checks via `parseMapCollision`, prints a collision summary line.
- `tools/map-compiler/graph/build-graph.ts` — `COMPILER_VERSION` bumped to `0.4.0` with an
  updated doc comment.
- `tests/compiled-map.test.ts` — `compilerVersion` assertion updated `0.3.0` -> `0.4.0`.
- `public/maps/juliette-ga.map.json` — regenerated (only `source.compilerVersion` differs).
- `public/maps/juliette-ga.collision.json` — new artifact, committed.
- `src/physics/map-scene.ts` — `createMapScene()`, `MapScene` interface, road/building collider
  builders, spawn resolution.
- `tests/map-scene.test.ts` — 11 tests against the real compiled artifacts covering every
  `<behavior>` bullet.

## Decisions Made

- Road colliders share ONE fixed rigid body rather than one body per collider — the plan
  explicitly left this open ("whichever is chosen, it is stated and asserted"). Chosen for
  efficiency (a map this size would otherwise allocate ~100 separate fixed `RigidBody` WASM
  wrappers for bodies that never move) and verified directly: every road collider's parent body
  handle is identical, and that shared body is fixed.
- Building collision boxes derive `rotationY`/`halfExtents` from `BuildingBox`'s already-baked
  world-space prism corners (`edge01` for the local-X axis, `edge12` for local-Z) rather than
  threading a second, independently-computed rotation value through `BuildingBox`'s own shape.
  Verified empirically this session (see Issues Encountered) that Rapier's Y-axis quaternion
  convention round-trips exactly back to the original rectangle.
- `COMPILER_VERSION` bumped to `0.4.0`: the artifact SET a given version names is now genuinely
  different (three files, not two) even though neither `.map.json` nor `.glb`'s own fields
  changed.

## Deviations from Plan

None — Tasks 1 and 2's behavior, acceptance criteria, and threat-model mitigations were
implemented exactly as written. Two design choices the plan explicitly left open (shared vs.
per-collider road body; how to recover a building's rotation from baked corners) were resolved
as documented above, not deviations from anything the plan mandated.

## Known Stubs

None. Every road collider and building collider is wired from real compiled data (the committed
`juliette-ga.map.json`/`.collision.json`) through to a live, tested Rapier scene — no
placeholder/mock geometry anywhere in this plan's output.

## Issues Encountered

- Before writing `map-scene.ts`'s trimesh/collider construction and `collision.ts`'s rotation
  derivation, two assumptions were verified empirically against the installed
  `@dimforge/rapier3d@0.20.0` binding directly (via throwaway scratch Vitest files, removed
  before the real test suite ran):
  1. `collider.shape.flags` for a `TriMesh`-shaped collider round-trips the exact
     `TriMeshFlags` value passed at construction (not just echoing the constructor argument
     from JS-side state) — confirmed, which is what makes `tests/map-scene.test.ts`'s
     FIX_INTERNAL_EDGES assertion a real runtime proof rather than a source-grep-only check.
  2. `world.colliders.forEach` visits colliders in creation order for a freshly-built world with
     no removals — confirmed with a 5-collider ordering probe, which is what makes the test
     suite's "match collider index back to its source graph entry" technique valid.
  Neither produced a surprise; both are now documented as verified patterns in this SUMMARY's
  `patterns-established` for future plans that need the same introspection.
- `toBeCloseTo(..., 4)` was initially too tight for building/vehicle translation assertions:
  Rapier's `Real` is `f32` (already a documented project fact, `src/physics/world.ts`), and
  Juliette's local-ENU coordinates run into the thousands, so f32's ~7-digit relative precision
  only guarantees ~2 decimal places of absolute precision at that magnitude. Loosened to
  `toBeCloseTo(..., 2)` for position/half-extent checks (rotation-component checks, near
  magnitude 1, kept their tighter precision-5 tolerance).

## User Setup Required

None — no external service configuration required.

## Threat Flags

None — every threat this plan's `<threat_model>` names (T-04-01 sidecar tampering, T-04-28 DoS
via malformed collider counts, T-04-29 missing FIX_INTERNAL_EDGES, T-04-30 mismatched map/sidecar
pair, T-04-31 missing spawn) was already anticipated and mitigated exactly as specified; no new
security-relevant surface was introduced beyond what the threat model already covers.

## Next Phase Readiness

- SC1/SC2/SC3 are all real and proven against real data: every road edge/junction is a solid,
  surface-correct collider; buildings are solid and correctly oriented; a car dropped on the
  real compiled map settles upright on the road, all verified headlessly in
  `tests/map-scene.test.ts` against the committed artifacts (not a synthetic fixture).
- Plan 04-09's runtime map loader (composition-root wiring in `src/main.ts`) can now fetch
  `juliette-ga.map.json`/`.collision.json`, parse them with `parseRoadGraph`/`parseMapCollision`,
  and hand them straight to `createMapScene` — the exact `(world, graph, collision, tuning,
  profiles)` signature this plan ships.
- `src/physics/surface-scene.ts`, `vehicle-scene.ts` and `debug-scene.ts` all remain in place
  as regression fixtures, per this plan's own module-header note — not touched by this plan.

---
*Phase: 04-map-pipeline-first-area*
*Completed: 2026-09-14*

## Self-Check: PASSED

- FOUND: commit fef712e (Task 1)
- FOUND: commit 6a86c26 (Task 2)
- FOUND: src/core/map-collision.ts
- FOUND: tools/map-compiler/author/collision.ts
- FOUND: tools/map-compiler/author/collision.test.ts
- FOUND: public/maps/juliette-ga.collision.json
- FOUND: src/physics/map-scene.ts
- FOUND: tests/map-scene.test.ts
