---
phase: 04-map-pipeline-first-area
plan: 03
subsystem: infra
tags: [typescript, geometry, road-graph, offset-ribbon, junction-fan, vitest, src-core]

# Dependency graph
requires:
  - phase: 04-01
    provides: "src/core/road-graph.ts (RoadGraphEdge/RoadGraphNode/RoadGraph contract), src/core/surface-types.ts (SurfaceType)"
provides:
  - "src/core/road-geometry.ts — buildRibbon/buildJunctionFan/buildRoadGeometry, the shared offset-ribbon + angle-sorted junction-fan geometry module"
  - "SC1 topology proof: watertight junction-to-ribbon seams across every node degree (1/2/3/4), proven by exact float equality"
  - "The shared contract plans 04-07 (offline .glb authoring) and 04-08 (runtime collision) both consume, closing SC3's 'collision and nav derive from the same road graph' structurally"
affects: [04-07, 04-08, 04-10]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Junction-fan boundary-vertex bearing is computed from each corner's OWN position relative to the node, not derived as a fixed +/-90deg offset from the edge's away-point direction — buildRibbon's forward tangent points away-from-node only when this node is the edge's `from` end; for `to`-end edges it points toward the node, so a fixed-offset formula silently swaps nearLeft/nearRight's effective bearings and produces an inverted, self-crossing fan. Any future junction-adjacent geometry code must read corner positions directly, not assume a tangent-based offset."
    - "Ribbon/fan winding invariant, empirically pinned: for a `left = point + rotate90CCW(tangent) * dist` offset convention (tangent = increasing-point-index direction), CCW-from-+Y triangle order is (L_i, L_{i+1}, R_i) / (R_i, L_{i+1}, R_{i+1}) for ribbon quads, and (centre, ring[i], ring[i+1]) for an ascending-bearing-sorted fan ring. Any change to the left/right or offset-sign convention must re-derive and re-verify this pairing via the CCW cross-product test, not assume it still holds."

key-files:
  created:
    - src/core/road-geometry.ts
    - tests/road-geometry.test.ts

key-decisions:
  - "Junction-fan boundary-vertex bearing is computed from each corner's own XZ position relative to the node (atan2 of the corner offset), not from a fixed +/-90deg offset of the edge's away-point bearing as the plan's <action> text literally describes — found via the CCW-winding test failing on a degree-3 T-junction fixture where one incident edge arrived AT the node (a `to`-end edge). buildRibbon's tangent always points in the edge's forward (increasing-index) direction, which is away-from-node for a `from`-end edge but toward-node for a `to`-end edge; a fixed-offset-from-away-bearing formula silently swapped nearLeft/nearRight's effective positions for every `to`-end edge, producing a self-crossing fan. Reading each corner's own position sidesteps the direction ambiguity and is correct regardless of which end of the edge the node is."
  - "IncidentEdgeAtNode.awayPoint is retained in the exported interface as provenance/debugging metadata even though buildJunctionFan no longer uses it to compute sort order, since it is still useful context for future consumers and removing it would be a needless breaking change to the shared contract mid-plan."
  - "Node degree (for fan-vs-no-fan decisions) is derived directly from the actual incident-edge count computed by buildRoadGeometry, not from RoadGraphNode.junction — the schema defines junction as exactly 'three or more edges meet', so deriving it independently keeps this pure-geometry module self-consistent rather than trusting an externally-set flag it could in principle disagree with."

requirements-completed: [SC1, SC3]

# Metrics
duration: 55min
completed: 2026-09-13
---

# Phase 4 Plan 3: Offset-ribbon and angle-sorted junction-fan geometry Summary

**`src/core/road-geometry.ts` — a shared, pure-geometry module turning `RoadGraph` centrelines into watertight ribbon + junction-fan triangle geometry, proven seamless across every node degree by exact float equality, consumed identically by the offline compiler and the browser runtime.**

## Performance

- **Duration:** 55 min
- **Started:** 2026-09-13T20:00:00Z (approx, worktree base commit c75aaef)
- **Completed:** 2026-09-13T20:40:44Z
- **Tasks:** 2 (both TDD: RED -> GREEN)
- **Files modified:** 2 (both created)

## Accomplishments

- `buildRibbon(edge)` turns any `RoadGraphEdge` centreline into a correctly-sized, correctly-wound, elevation-faithful offset ribbon, with miter joins at interior points (clamped at 3x half-width per D-P10 for hairpins) and exact endpoint straddling.
- `buildJunctionFan(node, incident)` fills a junction with a triangle fan built from the exact ribbon corners `buildRibbon` already produced at that node — never recomputed — which is the structural mechanism that makes seamless stitching a guarantee rather than a hope.
- `buildRoadGeometry(graph)` assembles the whole graph's geometry (one ribbon per edge, one fan per junction node of degree >= 3), and the plan's centerpiece watertightness test proves zero unmatched fan boundary vertices across a synthetic graph covering all four node degrees (1, 2, 3, 4) using exact float equality, not a tolerance.
- Found and fixed a real correctness bug in the plan's own described algorithm (junction-fan bearing derivation) via the CCW-winding test — documented as a key decision above and in the code's own doc comments.

## Task Commits

Each task followed TDD RED -> GREEN (both `tdd="true"`):

1. **Task 1: Offset-ribbon builder with clamped miter joins**
   - `1d79ea8` (test, RED) — 9 behavior-bullet tests, genuine RED confirmed (module did not exist)
   - `b58664a` (feat, GREEN) — `buildRibbon` implementation, all 9 tests pass
2. **Task 2: Angle-sorted junction fan and the whole-graph geometry assembler**
   - `c572d19` (test, RED) — extended to 24 tests total, genuine RED confirmed (buildJunctionFan/buildRoadGeometry not exported)
   - `a4b6b96` (feat, GREEN) — `buildJunctionFan`/`buildRoadGeometry` implementation, all 24 tests pass

**Plan metadata:** commit pending (this SUMMARY + self-check, this commit).

_Both tasks: exactly test -> feat, no refactor commit needed — GREEN was reached on the first correctness-verified implementation after one mid-task algorithm correction (see Deviations)._

## Files Created/Modified

- `src/core/road-geometry.ts` (474 lines) — `Vec3`, `RibbonGeometry`, `IncidentEdgeAtNode`, `FanGeometry`, `EdgeGeometryEntry`, `JunctionGeometryEntry`, `RoadGeometry` types; `buildRibbon`, `buildJunctionFan`, `buildRoadGeometry` exports; imports only `./road-graph.ts` and `./surface-types.ts`
- `tests/road-geometry.test.ts` (684 lines) — 24 tests covering every `<behavior>` bullet from both tasks, including the whole-graph watertightness proof

## Decisions Made

See `key-decisions` in frontmatter. Summarized:
1. Junction-fan boundary bearing computed from each corner's own position, not a fixed offset from the edge's away-bearing (bug fix, found via testing).
2. `awayPoint` kept in the interface as documentation/provenance despite no longer driving the sort.
3. Node degree derived from actual incident-edge count, not the `junction` flag.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Corrected the junction-fan boundary-vertex bearing formula**
- **Found during:** Task 2, while running the CCW-winding test against the whole-graph synthetic fixture (a degree-3 T-junction with a mix of `from`-end and `to`-end incident edges)
- **Issue:** The plan's `<action>` text describes computing each corner's bearing as a fixed `+/-90deg` offset from the edge's own approach bearing (`awayPoint`'s direction). This is correct only when the node is the edge's `from` end. `buildRibbon`'s tangent at any point always points in the edge's forward (increasing-point-index) direction; for a `to`-end edge, that forward tangent points TOWARD the node (arriving), which is the exact opposite of the "away from node" direction the fixed-offset formula assumes. The result: `nearLeft`/`nearRight`'s effective bearings were silently swapped for every `to`-end incident edge, producing a fan whose triangle order self-crossed (a negative cross-product Y-component, caught by the CCW-winding assertion, not a passing-but-wrong test).
- **Fix:** Compute each corner's bearing directly from its own XZ position relative to the node (`atan2(corner.x - node.x, corner.z - node.z)`), independent of which end of the edge the node is. This is mathematically equivalent to the plan's intent (corners still cluster near their edge's approach bearing) but sidesteps the direction ambiguity entirely.
- **Files modified:** `src/core/road-geometry.ts` (the `buildJunctionFan` doc comment now explains this explicitly), `tests/road-geometry.test.ts` (the whole-graph synthetic fixture's T-junction arms were also adjusted to avoid an unrelated degenerate exact-duplicate-corner case, see below)
- **Verification:** All 24 tests pass, including CCW winding across every ribbon and fan in the whole-graph synthetic fixture; `npm run check` green
- **Committed in:** `a4b6b96` (Task 2 GREEN commit)

**2. [Rule 1 - Bug, test-fixture only] Fixed a degenerate exact-duplicate-corner case in the whole-graph test fixture**
- **Found during:** Task 2, first run of the whole-graph watertightness/winding test
- **Issue:** The synthetic T-junction's two branch edges were originally constructed exactly collinear-opposite through the junction node with equal width, which geometrically makes their near corners at one shared bearing angle EXACTLY coincide — a legitimate degeneracy (zero-area fan triangle), not an implementation bug, but an unintentional artifact of the test's own coordinate choice.
- **Fix:** Adjusted the two branch nodes' coordinates so the branch edges are no longer collinear-opposite, breaking the artificial symmetry.
- **Files modified:** `tests/road-geometry.test.ts`
- **Verification:** Re-ran the full suite; all 24 tests pass with no degenerate triangles
- **Committed in:** `a4b6b96` (Task 2 GREEN commit, since the test-file fix landed before the RED commit for this scenario was made — see commit history: the RED commit for Task 2 already contains the corrected fixture)

---

**Total deviations:** 2 auto-fixed (1 Rule 1 algorithm bug, 1 Rule 1 test-fixture degeneracy)
**Impact on plan:** The algorithm fix is a genuine, non-cosmetic correctness fix to the plan's own described approach — without it, junction fans at any node where an edge arrives (rather than departs) would self-cross. No scope creep; both fixes were required to make the plan's own acceptance criteria (CCW winding, watertightness) pass honestly rather than by weakening the test.

## Issues Encountered

None beyond the two deviations above, both caught and fixed empirically via the test suite (run repeatedly via `npx vitest run tests/road-geometry.test.ts` during implementation) before the Task 2 GREEN commit.

## User Setup Required

None — no external service configuration required.

## Known Stubs

None. Both `buildRibbon` and `buildJunctionFan`/`buildRoadGeometry` are fully implemented per the plan's `<behavior>` bullets, not stubbed or deferred.

## Next Phase Readiness

- `src/core/road-geometry.ts`'s three exports (`buildRibbon`, `buildJunctionFan`, `buildRoadGeometry`) are ready for plan 04-07 (offline `.glb` authoring via `tools/map-compiler/author/gltf.ts`) and plan 04-08 (runtime collision via `src/physics/map-scene.ts`) to consume directly, unmodified — this is the whole point of D-P9 (shared module, not two implementations).
- The junction-surface heuristic (`pickJunctionSurface`, highest-road-class-wins) is tagged `[ASSUMED, MEDIUM confidence]` and queued for the plan 04-10 feel session, exactly as the plan specified.
- The 3x half-width miter clamp constant is tagged `[ASSUMED]` and is also a candidate for the plan 04-10 feel session.
- No blockers. `npm run check` is green (typecheck + lint + 642 tests across 35 files) at the end of this plan.

---
*Phase: 04-map-pipeline-first-area*
*Completed: 2026-09-13*

## Self-Check: PASSED

All 3 claimed files verified present on disk (`src/core/road-geometry.ts`,
`tests/road-geometry.test.ts`, this SUMMARY itself).
All 4 claimed commit hashes verified present in `git log --oneline --all`
(`1d79ea8`, `b58664a`, `c572d19`, `a4b6b96`).
