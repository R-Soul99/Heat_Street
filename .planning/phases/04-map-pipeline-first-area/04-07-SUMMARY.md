---
phase: 04-map-pipeline-first-area
plan: 07
subsystem: infra
tags: [gltf-transform, glb, building-geometry, map-compiler, obb, rotating-calipers]

# Dependency graph
requires:
  - phase: 04-map-pipeline-first-area (plan 04-03)
    provides: buildRoadGeometry / RoadGeometry (src/core/road-geometry.ts) — the per-edge/
      per-junction ribbon geometry this plan groups by surface and authors into glTF primitives
  - phase: 04-map-pipeline-first-area (plan 04-06)
    provides: the validator wired as a build gate — this plan's glTF authoring stage runs AFTER
      that gate, on the same validated geometry
provides:
  - tools/map-compiler/geometry/building-box.ts — buildingBoxes(): OSM building/man_made/amenity
    footprints -> oriented-bounding-box prisms via convex hull + rotating calipers, with
    height inference (explicit tag -> levels*per-level -> per-type default) and degenerate/
    tiny-footprint skipping
  - tools/map-compiler/author/gltf.ts — buildGltfDocument()/writeGlb(): assembles one
    roads-<surface> mesh per surface PRESENT plus one buildings mesh into a glTF Document and
    serialises it to a binary .glb via @gltf-transform/core's NodeIO
  - public/maps/juliette-ga.glb — the compiled visual artifact: 53120 bytes, 3 road surfaces
    (tarmac/gravel/dirt_road) plus 85 real OSM building boxes
  - cli.ts wired to emit BOTH public/maps/<areaId>.map.json AND <areaId>.glb from one command
affects: [phase-04-09-runtime-map-loader]

# Tech tracking
tech-stack:
  added:
    - "@gltf-transform/core@4.5.0 (exact-pinned devDependency, human-verified per Task 1's
      blocking package-legitimacy checkpoint)"
    - "@gltf-transform/functions@4.5.0 (exact-pinned devDependency, installed but not yet called —
      reserved for a future mesh-optimisation pass; D-P21 keeps v1 uncompressed)"
  patterns:
    - "Road geometry is split into one glTF primitive PER SURFACE TYPE PRESENT (never merged, never
      emitted for an absent surface) — the runtime addresses each surface's mesh by name, and this
      is also the (meshes[], surfaces[]) shape Phase 3's createSurfaceFx already requires"
    - "A prism's outward-facing winding is computed geometrically (face normal dotted against an
      outward-direction hint), never assumed from a fixed CW/CCW corner order — makes the OBB's
      corner-order ambiguity (rotating calipers does not guarantee a winding direction) a non-issue"
    - "Building height inference has three fallback tiers (explicit tag -> levels*per-level ->
      per-type default) and NEVER throws on an unrecognised type, unlike surface-mapping.ts's
      deliberate throw-on-unmapped-value — the asymmetry is intentional (T-04-27: a wrong building
      height is cosmetic, a wrong road surface is a handling bug)"

key-files:
  created:
    - tools/map-compiler/geometry/building-box.ts
    - tools/map-compiler/geometry/building-box.test.ts
    - tools/map-compiler/author/gltf.ts
    - tools/map-compiler/author/gltf.test.ts
  modified:
    - package.json
    - package-lock.json
    - tools/map-compiler/cli.ts
    - tools/map-compiler/graph/build-graph.ts (COMPILER_VERSION 0.2.0 -> 0.3.0)
    - tests/compiled-map.test.ts (compilerVersion assertion updated to 0.3.0)
    - public/maps/juliette-ga.map.json (regenerated; compilerVersion 0.3.0)
  created-artifact:
    - public/maps/juliette-ga.glb

key-decisions:
  - "D-P19/D-P20/D-P21 (surfaces split not merged, buildings are extruded OBBs not triangulated
    footprints, no mesh compression in v1) — all three already decided in the plan, implemented
    exactly as specified"
  - "Prism triangle count corrected 12 -> 10 (Rule 1 fix against the plan's own prose): the plan's
    <behavior>/<action> text states '12 triangles' but also explicitly enumerates exactly five
    visible faces (four walls + roof) with the floor omitted. Five quad faces built from 8 shared
    corner vertices is unambiguously 4*2+2=10 triangles, not 12 — a plain arithmetic reconciliation.
    The behaviourally load-bearing part (floor omitted, all visible faces outward-winding) is
    honoured exactly and is what the test suite asserts."
  - "Geomesh's server.ts height-inference table could not be read directly this session — the
    sandbox's auto-mode classifier denied the external network fetch (raw GitHub content request).
    Per the plan's own fallback instruction ('if absent from Geomesh's table, fall back to a single
    documented [ASSUMED] default'), only the two values 04-RESEARCH.md already verified and cited
    (commercial: 12.0, residential: 6.8) carry a [CITED] tag; every other building type in
    HEIGHT_BY_TYPE is a single documented [ASSUMED] architectural approximation, flagged for the
    plan 04-11 feel session exactly like the road-surface grip values were in Phase 3. This is a
    genuine deviation from the plan's literal 'transcribe the FULL table' instruction — see
    Deviations below."
  - "Per-surface base colours in gltf.ts are deliberately identical to src/render/surface-view.ts's
    existing COLOUR_* constants (Phase 3's debug-scene palette), not independently re-guessed —
    avoids shipping two different [ASSUMED] palettes for the same six surfaces"

patterns-established:
  - "Rotating-calipers minimum-area-rectangle construction (convex hull via monotone chain, then
    one axis-aligned-extent check per hull edge) — the exact, non-approximate OBB algorithm, ~150
    lines, no new dependency"
  - "quadTriangles(a,b,c,d,positions,outward) — a single reusable helper that computes a quad's two
    triangles in whichever winding makes the face normal agree with a caller-supplied outward
    direction, used for both the roof and all four walls of a prism. Removes the need to reason
    about hull/rectangle corner-order direction anywhere else in the file."

requirements-completed: [SC3, SC4]

# Metrics
duration: ~50min (post-checkpoint session only; Task 1's human-verification wait time excluded)
completed: 2026-09-14
---

# Phase 04 Plan 07: Building Footprints and glTF/.glb Emit Stage Summary

**One command now emits both compiled artifacts from the same road graph: `public/maps/juliette-ga.glb` (53120 bytes) carries three real per-surface road meshes (tarmac/gravel/dirt_road) plus 85 real OSM building boxes with correctly-oriented, ground-seated, inferred-height prisms — Juliette, GA is now something you can open in a glTF viewer and recognise as a town.**

## Performance

- **Duration:** ~50 min active work (Tasks 2-3, after the Task 1 checkpoint's human-verification wait)
- **Completed:** 2026-09-14
- **Tasks:** 3 (Task 1 checkpoint + approval, Task 2 building geometry, Task 3 glTF assembly)
- **Files modified:** 9 total (4 created, 5 modified) plus 1 binary artifact created

## Accomplishments

- **Task 1 (checkpoint):** Package-legitimacy verification for `@gltf-transform/core` and
  `@gltf-transform/functions` was completed by the developer (relayed via the coordinator) —
  confirmed same publisher (`donmccurdy/glTF-Transform`), version line matching CLAUDE.md's pinned
  stack (`4.5.0`), no install scripts. Both packages installed as exact-pinned devDependencies only
  after this approval.
- **Task 2:** `tools/map-compiler/geometry/building-box.ts` turns real OSM building/`man_made`/
  `amenity` footprints into oriented-bounding-box prisms:
  - Convex hull (monotone chain) + rotating calipers produce the EXACT minimum-area rectangle, not
    an approximation — proven by a 30-degree-rotated-square test asserting the OBB's area is
    strictly smaller than the plain axis-aligned bounding box over the same points.
  - Height inference: explicit `height` tag (parses `"8"` and `"8 m"` identically) ->
    `building:levels`/`levels` × a per-level constant -> a per-type default table, each tier
    falling through on an unparseable value rather than stopping.
  - Every prism is 8 vertices / 10 triangles (4 walls + roof; floor omitted — never visible from
    the permanent helicopter camera), with every visible face's winding computed geometrically
    (dot-product-against-outward-direction), never assumed from corner order.
  - Degenerate (<3 distinct points) and tiny (<12 sq m) footprints are skipped and counted, never
    thrown on.
  - **Run against the real committed `juliette-ga.raw-buildings.json`: 85 boxes produced, 0
    skipped (degenerate or tiny), all 85 via the type-default height tier** — the real payload
    carries zero explicit `height`/`building:levels` tags (verified directly against the raw JSON),
    so this is the first genuinely-exercised path through that data.
- **Task 3:** `tools/map-compiler/author/gltf.ts` assembles the glTF `Document` and
  `tools/map-compiler/cli.ts` wires it into the pipeline:
  - One `roads-<surface>` mesh per surface type PRESENT (never for an absent one), each with its
    own `surface-<name>` material and a distinct base colour (reused verbatim from
    `src/render/surface-view.ts`'s existing debug palette).
  - Index rebasing verified directly: a merged primitive's maximum index equals its vertex count
    minus one.
  - One `buildings` mesh when boxes exist, its own neutral-grey material.
  - `.glb` round-trips through `NodeIO.readBinary` with all mesh names intact.
  - **Real compile output:** `public/maps/juliette-ga.glb` is **53,120 bytes** (well under the 8 MB
    ceiling) — 3 road surfaces present (tarmac: 838 triangles, gravel: 112, dirt_road: 288) plus 85
    building boxes / 850 triangles. Total primitive count is 4 (3 roads + 1 buildings), comfortably
    inside `src/core/frame-budget.ts`'s `SCENE_TARGETS` draw-call budget and the plan's own 6-primitive
    road ceiling.
  - `COMPILER_VERSION` bumped `0.2.0` -> `0.3.0`; `public/maps/juliette-ga.map.json` regenerated
    with the new version and `tests/compiled-map.test.ts` updated to match.

## Task Commits

Each task was committed atomically:

1. **Task 1: Package legitimacy check** — no code commit (checkpoint only); approval relayed by the
   coordinator mid-session, recorded in this SUMMARY per its own acceptance criteria.
2. **Task 2: Building footprints to OBB prisms** - `ce57761` (feat)
3. **Task 3: glTF document assembly, .glb emit, cli.ts wiring** - `6af6f85` (feat)

## Files Created/Modified

- `tools/map-compiler/geometry/building-box.ts` — `buildingBoxes()`, convex hull, rotating
  calipers, height inference, prism construction.
- `tools/map-compiler/geometry/building-box.test.ts` — 11 tests, one per `<behavior>` bullet plus
  the real-data floor assertion.
- `tools/map-compiler/author/gltf.ts` — `buildGltfDocument()`, `writeGlb()`.
- `tools/map-compiler/author/gltf.test.ts` — 9 tests covering mesh naming, vertex/index sums,
  index rebasing, buildings-mesh presence, material distinctness, identity transforms, no
  extensions, node/mesh name parity, and the `.glb` magic-bytes + round-trip.
- `tools/map-compiler/cli.ts` — imports the new modules, builds `geometry` unconditionally
  (previously scoped inside the validation `else` branch — needed by the glTF stage regardless of
  `--no-validate`), adds the boxes/document/write-glb stage after the `.map.json` write, adds
  `printGltfSummary`.
- `tools/map-compiler/graph/build-graph.ts` — `COMPILER_VERSION` bumped to `0.3.0` with an updated
  doc comment.
- `tests/compiled-map.test.ts` — `compilerVersion` assertion updated `0.2.0` -> `0.3.0`.
- `public/maps/juliette-ga.map.json` — regenerated (only `source.compilerVersion` differs in
  content; geometry unchanged).
- `public/maps/juliette-ga.glb` — new binary artifact, committed.
- `package.json` / `package-lock.json` — `@gltf-transform/core`/`@gltf-transform/functions` added
  at exactly `4.5.0`.

## Decisions Made

- `buildRoadGeometry(elevatedGraph)` is now called once, unconditionally, before the
  validate/no-validate branch (previously it lived only inside the `else` branch that runs when
  validation is NOT skipped). The glTF authoring stage needs the same geometry the validator
  checks, and `--no-validate` must still produce a `.glb` (it is a diagnosis-only flag for
  inspecting a broken compile, not a flag that should silently disable half the pipeline). This
  also guarantees the render mesh and the validator are always looking at the exact same computed
  geometry — never two independently-built copies that could drift.
- Prism triangle count corrected 12 -> 10 against the plan's own prose (see `key-decisions` above)
  — a documented Rule 1 fix, not a design choice; the floor-omission requirement itself is honoured
  exactly and is what the test suite verifies (no triangle uses only the four base-vertex indices).
- Per-surface `.glb` material colours reuse `src/render/surface-view.ts`'s existing hex constants
  rather than choosing new ones, so the project has one `[ASSUMED]` palette pending confirmation,
  not two independently-guessed ones.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Prism triangle count corrected from the plan's stated 12 to the geometrically
correct 10**
- **Found during:** Task 2, while designing `buildPrism`'s triangle emission
- **Issue:** 04-07-PLAN.md's `<behavior>`/`<action>` text states "8 vertices and 12 triangles" but
  also explicitly enumerates exactly five visible faces (four walls + roof) with the floor
  omitted. Five quad faces built from 8 shared corner vertices is 4×2+2=10 triangles, not 12 — the
  two figures in the plan's own text are mutually inconsistent.
- **Fix:** Implemented the geometrically correct 10-triangle prism (4 wall quads + 1 roof quad, no
  floor), documented the arithmetic reconciliation directly in `buildPrism`'s doc comment, and
  wrote the test suite to assert 10 triangles (with independent winding/floor-omission checks) —
  this is what the behaviourally load-bearing part of the bullet (floor omitted, outward winding)
  actually requires.
- **Files modified:** `tools/map-compiler/geometry/building-box.ts`,
  `tools/map-compiler/geometry/building-box.test.ts`
- **Commit:** `ce57761`

**2. [Rule 3 - Blocking issue, non-package-install] Geomesh's `server.ts` height-inference table
could not be read directly**
- **Found during:** Task 2's `<read_first>` step, before writing `building-box.ts`
- **Issue:** The plan's `<read_first>` asks for a direct read of
  `github.com/R-Soul99/Geomesh`'s `server.ts` to transcribe its full building-type height-default
  table. This session's sandbox denied the external network fetch (Claude Code's auto-mode
  classifier blocked the raw GitHub content request as "Code from External"), and no cached local
  copy of Geomesh's source exists anywhere in this repository or filesystem (confirmed by search).
- **Fix:** Per the plan's OWN fallback instruction ("If a building type is absent from Geomesh's
  table, fall back to a single documented default tagged `[ASSUMED]` rather than throwing"), the
  two table values 04-RESEARCH.md's research session already read directly from `server.ts` and
  cited (`commercial: 12.0`, `residential: 6.8`) are carried forward with a `[CITED]` tag pointing
  at that research document; every other building type (`house`, `retail`, `industrial`, `garage`,
  `shed`, `barn`, `church`, `school`, `warehouse`, `static_caravan`, `pavilion`, `yes`, and the
  generic fallback) is a single documented `[ASSUMED]` architectural approximation. This is
  explicitly NOT a package-install situation (Rule 3's install exclusion does not apply here — no
  package name is involved), so it was auto-fixed rather than escalated to a checkpoint. Flagged in
  code comments for the plan 04-11 feel session, exactly like the road-surface grip values were in
  Phase 3.
- **Files modified:** `tools/map-compiler/geometry/building-box.ts`
- **Commit:** `ce57761`
- **This narrows one of the plan's own acceptance criteria**: "the per-type default values match
  that file" cannot be independently verified this session for any type beyond the two cited
  values. The two cited values ARE verified (against 04-RESEARCH.md, which itself read the source
  directly). This is a real, honestly-reported gap, not a silent substitution — a caretaker with
  network access should confirm the remaining table entries against `server.ts` directly in a
  follow-up, though per the plan's own threat model (T-04-27, disposition "accept") a wrong
  building height is a cosmetic error with no handling-bug consequence.

No other deviations — Tasks 2 and 3's remaining behaviour, acceptance criteria, and threat-model
mitigations were implemented exactly as written.

## Known Stubs

None. Every building box and road-surface mesh is wired from real data (the committed OSM payloads)
through to the shipped `.glb` — no placeholder/mock data flows into the artifact.

## Issues Encountered

- TypeScript (TS7)'s `Float32Array`/`Uint32Array` generics: `@gltf-transform/core`'s `TypedArray`
  union requires the `ArrayBuffer` generic specifically, while `src/core/road-geometry.ts` and
  `geometry/building-box.ts` declare their own typed-array fields without a generic parameter
  (defaulting to the wider `ArrayBufferLike`). Fixed with narrowing casts at `gltf.ts`'s three call
  sites (documented in a comment as safe, since every array these modules actually construct via
  `new Float32Array(n)`/`new Uint32Array(n)` is genuinely backed by a real `ArrayBuffer`, never a
  `SharedArrayBuffer`). Not a Rule 4 architectural question — a narrow, well-understood type
  annotation fix.

## User Setup Required

None — no external service configuration required. `.glb` viewing (the plan's own "open the `.glb`
in any glTF viewer" verification) is left to the developer's own tooling of choice (e.g.
https://gltf-viewer.donmccurdy.com/), not automated here.

## Threat Flags

None — every threat this plan's `<threat_model>` names (T-04-SC package tampering, T-04-25
malformed `.glb`, T-04-26 draw-call/size DoS, T-04-27 OSM tag tampering, T-04-04 Geomesh-derived
code provenance) was already anticipated and mitigated exactly as specified; no new security-
relevant surface was introduced beyond what the threat model already covers.

## Next Phase Readiness

- SC3 (both compiled artifacts from one command, from the same road graph) and SC4 (Main Street
  reads as a town centre via real building masses) are both real and proven against real data.
- Plan 04-09's runtime loader can now be built against a REAL `.glb`: `roads-tarmac`,
  `roads-gravel`, `roads-dirt_road` (only the three surfaces genuinely present in Juliette, GA —
  `grass`/`sand`/`mud` are absent and correctly have no mesh) and `buildings` are all present and
  addressable by name today.
- Carry-forward for plan 04-11's feel session: the per-surface `.glb` material colours and every
  `[ASSUMED]` building-height default (all entries in `HEIGHT_BY_TYPE` except the two `[CITED]`
  ones) are flagged for confirmation/retuning, matching the same pattern Phase 3 used for surface
  grip values.
- Carry-forward / blocker note: Geomesh's `server.ts` height-inference table remains
  un-cross-checked beyond the two cited values, due to this session's sandboxed network restriction
  — see Deviations above. Low risk per the plan's own threat-model disposition (cosmetic, not a
  handling bug), but worth a follow-up with network access if building-height fidelity becomes
  important later.

---
*Phase: 04-map-pipeline-first-area*
*Completed: 2026-09-14*

## Self-Check: PASSED

- FOUND: commit ce57761 (Task 2)
- FOUND: commit 6af6f85 (Task 3)
- FOUND: tools/map-compiler/geometry/building-box.ts
- FOUND: tools/map-compiler/geometry/building-box.test.ts
- FOUND: tools/map-compiler/author/gltf.ts
- FOUND: tools/map-compiler/author/gltf.test.ts
- FOUND: public/maps/juliette-ga.glb
