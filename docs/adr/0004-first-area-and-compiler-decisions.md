# ADR 0004 — Phase 4's locked decisions: area, compiler shape, and off-road ground

- **Status:** Accepted
- **Date:** 2026-09-15
- **Phase:** 04 map-pipeline-first-area (plan 04-11), satisfying ROADMAP Phase 4's own
  requirement to record its decisions so a future agent does not relitigate them
- **Deciders:** Project owner, via an SC1 sign-off driving session and this plan's own Task 2
  code investigation

## Context

Phase 4 built the offline map compiler and its first compiled area across ten waves (plans
04-01 through 04-10), making a series of decisions along the way — a target area, a scope
boundary against the Geomesh tool it drew on, a location for the compiler in the repo, a
granularity for collision, a data-flow choice for non-road collision, a code-sharing rule
between compiler and runtime, an off-road-ground approach, and a rejected library. None of these
were written down in one place. This ADR is that place, following ADR 0001's own house style
(Context / Decision / Consequences / Supersedes / Open Questions / Enforcement) so a future agent
finds the answer here instead of re-deriving or reopening it.

This ADR also records plan 04-11's own findings: a human SC1 sign-off session drove every road
in the compiled area, found real defects, and this plan's Task 2 fixed what could be fixed
safely in scope and deferred the rest with reasons. See `04-11-SUMMARY.md` for the full
per-finding record; this document carries only the decisions that need to outlive that summary.

## Decision

### 1. Juliette, Georgia (Monroe County) is v1's target area

Chosen and explicitly confirmed by the project owner against ADR 0001's US-DEM-source rule
(which needed a US area to get USGS 3DEP's 1m public-domain data rather than Copernicus
GLO-30's 30m global fallback with its mandatory notice) and against 04-RESEARCH.md's D-01
through D-09 sizing/complexity criteria: small enough to compile and validate quickly, real
enough (a genuine small town with a real Main Street, real side roads, real elevation relief) to
be worth driving. Its bounding box is recorded in `tools/map-compiler/areas/juliette-ga.config.ts`
and its compiled artifacts ship at `public/maps/juliette-ga.{map.json,glb,collision.json}`.

### 2. Geomesh's road/building query logic was PORTED; its elevation pipeline was NOT

The existing "Map Heightmap & 3D GLTF Generator" tool (referred to throughout this phase's
planning as Geomesh) has working Overpass query logic for roads and buildings, and a building
height-inference table from OSM tags — both were ported into
`tools/map-compiler/sources/overpass.ts` and `tools/map-compiler/geometry/building-box.ts`, with
attribution to the source tool preserved in code comments.

Geomesh's elevation pipeline was explicitly **not** ported. Its default source is Terrarium 30m
tiles, which is not one of ADR 0001's two approved DEM sources (USGS 3DEP or Copernicus
GLO-30). `tools/map-compiler/sources/dem.ts` instead fetches USGS 3DEP directly via its
`exportImage` ArcGIS endpoint, per ADR 0001's US selection rule — an independent implementation
built specifically to stay inside that ADR's licensing decision rather than inherit a
third source it never approved.

### 3. The compiler is an offline Node CLI under `tools/`, outside `src/`

`tools/map-compiler/` is a separate tier from the browser runtime (`src/`), invoked via
`npm run compile-map -- --area <id>`. Two things were widened to admit it: `tsconfig.json`
(plan 04-01) so a Node-only, `three`/`RAPIER`-free TypeScript program could exist in the same
repo without pulling browser lib types into its compile, and the Google-data grep gate
(`tests/no-google-pipeline.test.ts`, ADR 0001's enforcement mechanism) so it also scans
`tools/**` and not just `src/**`. `tests/layering.test.ts`'s own src/-scoped rules do **not**
extend to `tools/**` — each compiler module's own doc comment is the only guard there (see
`src/core/road-geometry.ts`'s header, for one, on why that file specifically stays pure anyway).

### 4. Collision is one collider per road edge and per junction; render is one mesh per surface

Two different granularities, for two different reasons. **Collision** granularity is dictated by
`src/physics/surface.ts`'s `SurfaceMap`, which resolves grip per-COLLIDER (plan 03-03) — so
`src/physics/map-scene.ts` creates one Rapier trimesh collider per `buildRoadGeometry` edge/
junction entry (plan 04-08), each registered with its own edge's surface. **Render** granularity
is the opposite: `createSurfaceFx`'s skid-decal contract (Phase 3) expects a `(meshes[],
surfaces[])` parallel-array shape keyed by surface TYPE, not by edge — so
`tools/map-compiler/author/gltf.ts` (plan 04-07) merges every edge/junction sharing a surface
into ONE mesh per surface type present (`roads-tarmac`, `roads-gravel`, etc.), never one mesh per
edge. Both granularities derive from the identical `RoadGraph`; they diverge only in how that
one source is grouped for two different downstream consumers.

### 5. `src/core/road-geometry.ts` is shared between the compiler and the runtime (plan 04-03 D-P9)

The offset-ribbon and junction-fan algorithm lives in `src/core/`, not
`tools/map-compiler/geometry/` — a deliberate deviation from 04-RESEARCH.md/04-PATTERNS.md's own
filed location, made because the browser runtime needs the IDENTICAL algorithm to build
colliders that line up with the shipped `.glb` to the vertex. Two independent implementations of
a miter-joined offset polyline would drift, and the symptom is exactly what plan 04-11's Task 1
found and fixed: a car floating above, or sinking into, the ground it visibly touches. Plan
04-11 extended this same file with `buildRoadShoulders` for the identical reason — one ramp
algorithm, called identically by `tools/map-compiler/author/gltf.ts` (the shipped `.glb`) and
`src/physics/map-scene.ts` (the runtime collider), so the visible ramp and the drivable ramp can
never independently disagree.

### 6. Non-road collision data ships in a `<areaId>.collision.json` sidecar (plan 04-08 D-P22)

`docs/schemas/road-graph.v1.md` is normative and closed at v1 — its own "Versioning" section
requires a breaking schema change to be a new document, never an edit to the existing one. Adding
a `buildings` (or, from plan 04-10, a `heightfield`) key to that schema would be exactly such a
breaking change. Both instead ship in a separate `<areaId>.collision.json` sidecar
(`src/core/map-collision.ts`), round-tripped through `parseMapCollision` at compile time so a
malformed sidecar fails the build loudly rather than shipping. Road collision itself is
unaffected — it still derives from the road graph via `buildRoadGeometry(graph)` at runtime, per
decision 5 above.

### 7. Off-road ground is a DEM-derived, uniform-`grass` heightfield sunk beneath the roads (plan 04-10 D-P28)

This resolves 04-RESEARCH.md's Open Question 3 ("what does the player see/drive on off the
road?"). `tools/map-compiler/author/heightfield.ts` samples the raw DEM on a coarse
128x128 grid spanning the compiled area's own road-network bounds, with every sampled height
reduced by `HEIGHTFIELD_SINK_M` (5.0m) so the coarse grid can never visibly poke through a road
ribbon built from independently-smoothed elevation. Consumed identically by
`src/physics/map-scene.ts` (the physics floor) and `tools/map-compiler/author/gltf.ts` (the
visible terrain mesh) — the SAME grid, never two independently-built copies, matching decision 5's
own "one algorithm, two consumers" discipline.

**Amended by plan 04-11:** the sink, applied uniformly, created a real defect this plan's own
SC1 driving session found — "the roads are floating above the scenery... if I veer off the road
at any point I fall a few metres to the landscape, then cannot get back on." `HEIGHTFIELD_SINK_M`
and `HEIGHTFIELD_RESOLUTION` were deliberately left unchanged (raising resolution to close the
gap directly would cost ~524,288 terrain triangles at res 512, more than 10x the entire compiled
map's ~45,000-triangle budget). The fix instead is `src/core/road-geometry.ts`'s
`buildRoadShoulders`: a ramp per road edge, from the paved rail down to this SAME heightfield's
own bilinearly-sampled height at that exact point (`src/core/heightfield-sample.ts`), built into
both the collision (`src/physics/map-scene.ts`) and the visible `.glb`
(`tools/map-compiler/author/gltf.ts`). This makes the sink's magnitude a physics-invisible
implementation detail at the road edge — the car always has continuous ground to drive on, no
matter how coarse the safety-net terrain underneath stays.

A second, related defect from the same session — "at one point the road passes through a hill
then pops out the other side" — turned out to have a different root cause: a real 503m OSM way
segment with only its two endpoints as vertices, whose straight-line elevation interpolation cut
through real intervening terrain relief the sparse two-point line never sampled. Fixed in
`tools/map-compiler/graph/elevation.ts`'s `densifyEdgePoints` (new in plan 04-11): any segment
longer than `MAX_SEGMENT_LENGTH_M` (25m) gets DEM-sampled interior points inserted before
smoothing, so a long straight OSM segment can no longer skip over a hill between its two
authored vertices. Verified against the real compiled area: a fine-grained sweep along every
road found up to 3.25m of terrain rising above a linearly-interpolated road surface before this
fix, and zero such points after.

### 8. `osmtogeojson` was rejected; junction identity comes from raw OSM node IDs (plan 04-01 D-P5)

GeoJSON conversion via `osmtogeojson` discards the OSM node identity that junction detection
requires (a junction is "three or more ways share a node ID" — a purely geometric coincidence
test on converted coordinates is both slower and strictly less reliable than comparing the IDs
OSM already assigned). This also retires 04-RESEARCH.md's Open Question 4.
`tools/map-compiler/graph/build-graph.ts` works directly from Overpass's own JSON response,
never routing through a GeoJSON intermediate.

## Consequences

- **The compiled `.glb`, `.map.json` and `.collision.json` for Juliette, GA are the only shipped
  area as of this ADR.** Later areas follow the same pipeline; none of these eight decisions are
  area-specific.
- **A future area needs its own `tools/map-compiler/areas/<id>.config.ts`** but inherits every
  decision above unchanged — the compiler is not Juliette-specific anywhere in its code.
- **`src/core/road-geometry.ts` keeps growing as the one shared geometry surface** — any future
  road-adjacent visual/physical feature (this plan's shoulders included) belongs there, not
  duplicated between `tools/` and `src/physics/`.
- **The project owner has, separately from this ADR, deprioritised further automated real-world
  map compilation "for the moment"** in favour of an art-direction pass once the current area's
  structure reads as solid — recorded in `.planning/STATE.md`, not repeated here since it is a
  roadmap-sequencing decision rather than one of this phase's own locked technical decisions.
  The compiler and its Juliette, GA output remain as built; real-world street layouts may still
  be "borrowed" as a starting layout for hand-authored work later.

## Supersedes

Nothing — this is Phase 4's first consolidated decision record. It does not contradict ADR 0001,
0002 or 0003; where it touches the same ground (elevation source selection, occlusion), it cites
rather than restates them.

## Open Questions

Carried forward, none blocking:

1. **The junction-fan surface-boundary defect at acute, width-mismatched junctions** (this
   plan's Task 1 finding 3/4: "found one place where tarmac meets gravel — gravel part juts
   through the tarmac surface because the junction is not a 90 degree angle"). Investigated at
   length this session — real acute (<45deg) mixed-width junctions exist in the compiled data
   (e.g. node 45: a 3.5m dirt road meeting a 7m tarmac road at 28-41deg) — but the exact
   rendering defect could not be conclusively isolated and safely fixed without a direct visual
   re-check. `src/core/road-geometry.ts`'s `MITER_CLAMP` and `ROAD_CLASS_RANK` doc comments both
   carry this session's investigation notes. Follow-up: re-drive to a flagged junction (or supply
   a screenshot) so the fix can target the confirmed mechanism.
2. **Road width versus the car's slide radius** (finding 5: "quite difficult to stay on the
   roads at speed due to the desired sliding effect"). Deferred pending re-driving now that
   leaving the road is recoverable (decision 7's fix) — see `LANE_WIDTH_M`'s own doc comment in
   `tools/map-compiler/graph/build-graph.ts`.
3. **The occlusion mitigation comparison (ADR 0003) still has not been fairly run on real
   geometry.** This session's attempt was confounded by the floating-road/building defect
   (fixed here); ADR 0003's own "Status update" section carries the detail.
4. **The town does not yet read as a real place** (finding 8: "it doesn't read like a real town,
   more like some kind of surreal dream"). Root-caused to every building sharing one flat colour
   with no material, prop, or road-marking variety anywhere in the pipeline — an art-direction
   gap, not a defect this phase's scope covers. Explicitly deferred to a future art-pass phase;
   see `SURFACE_COLOR_HEX`'s and `BUILDING_COLOR_HEX`'s doc comments in
   `tools/map-compiler/author/gltf.ts`.

## Enforcement

| Guarantee | Mechanism |
|---|---|
| This ADR cannot go missing or be stubbed | `tests/docs-present.test.ts` (existence plus a 1500-character floor) |
| The road/collision geometry algorithm cannot silently fork between compiler and runtime | Single `src/core/road-geometry.ts` module, imported directly by both `tools/map-compiler/author/gltf.ts` and `src/physics/map-scene.ts` — no duplicate implementation exists anywhere else in the repo |
| A road edge can never float above the terrain it borders, regardless of heightfield resolution or sink | `tests/road-geometry.test.ts`'s `buildRoadShoulders` suite (outer-rail-tracks-sampled-height, clamped-never-upward, shared-vertex-with-ribbon, CCW-winding) |
| A long, sparse OSM segment can no longer skip over real intervening terrain relief | `tools/map-compiler/graph/elevation.test.ts`'s densification regression test, plus `MAX_SEGMENT_LENGTH_M` capping every segment in the real compiled map at ≤25m |
| No Google-sourced bytes anywhere in this compiler, including `tools/**` | `tests/no-google-pipeline.test.ts` (ADR 0001's mechanism, scoped to include `tools/**` per decision 3 above) |
| The compiled sidecar can never ship malformed | `parseMapCollision` round-trip self-check in `tools/map-compiler/cli.ts`, before the file is written |

## References

- `.planning/ROADMAP.md` Phase 4
- `.planning/phases/04-map-pipeline-first-area/04-CONTEXT.md`, `04-RESEARCH.md`
- `.planning/phases/04-map-pipeline-first-area/04-11-SUMMARY.md` (this plan's full per-finding record)
- `docs/adr/0001-map-data-source.md` (DEM source selection rule, Google-data prohibition)
- `docs/adr/0003-occlusion-mitigation.md` (status update recorded there, this session)
- `src/core/road-geometry.ts`, `src/core/heightfield-sample.ts`
- `tools/map-compiler/author/heightfield.ts`, `tools/map-compiler/graph/elevation.ts`
- `docs/schemas/road-graph.v1.md`
