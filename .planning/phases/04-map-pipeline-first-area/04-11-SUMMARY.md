---
phase: 04-map-pipeline-first-area
plan: 11
subsystem: physics
tags: [rapier, threejs, road-geometry, heightfield, elevation, gltf-transform]

# Dependency graph
requires:
  - phase: 04-map-pipeline-first-area
    provides: plan 04-10's off-road heightfield ground and the full compiled Juliette, GA area
provides:
  - "Road-shoulder grounding fix: src/core/road-geometry.ts's buildRoadShoulders, a per-edge ramp from the paved rail down to the off-road heightfield's own bilinearly-sampled height (src/core/heightfield-sample.ts), built identically into the runtime collider (src/physics/map-scene.ts) and the shipped .glb (tools/map-compiler/author/gltf.ts)"
  - "Long-segment terrain-following fix: tools/map-compiler/graph/elevation.ts's densifyEdgePoints, inserting DEM-sampled interior points into any OSM segment over MAX_SEGMENT_LENGTH_M (25m) before smoothing"
  - "docs/adr/0004-first-area-and-compiler-decisions.md: Phase 4's eight locked decisions, plus this session's findings and dispositions"
  - "ADR 0003 status update: DoubleSide fix confirmed shipped (plan 04-09), but the fade-vs-steepen re-run still blocked, now by the floating-geometry defect this plan fixed"
affects: []

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Shared bilinear heightfield sampling: src/core/heightfield-sample.ts's SampleableHeightfield structural interface (ArrayLike<number> heights) satisfies both the compiler's HeightfieldGrid and the runtime's parsed MapCollisionHeightfield with one function, no duplicate implementation"
    - "Additive geometry stays out of the validator's gate: buildRoadShoulders is a SEPARATE call from buildRoadGeometry, built after the heightfield exists and merged into the .glb/colliders downstream -- the validator's own `geometry` object (used for reachability/pathability) is untouched, preserving the 'ONE buildRoadGeometry call keeps the render mesh and the validator in sync' discipline cli.ts's own comment states"
    - "Winding correctness for a strip extension is provable from the XZ-only cross product (tests/road-geometry.test.ts's existing triangleNormalY helper) -- a shoulder strip's Y-height difference from its parent ribbon never affects CCW-from-+Y correctness, only its XZ layout relative to the parent rail does"

key-files:
  created:
    - src/core/heightfield-sample.ts
    - tests/heightfield-sample.test.ts
    - docs/adr/0004-first-area-and-compiler-decisions.md
  modified:
    - src/core/road-geometry.ts
    - tools/map-compiler/graph/elevation.ts
    - tools/map-compiler/graph/build-graph.ts
    - tools/map-compiler/author/heightfield.ts
    - tools/map-compiler/author/gltf.ts
    - tools/map-compiler/cli.ts
    - src/physics/map-scene.ts
    - tests/road-geometry.test.ts
    - tests/map-scene.test.ts
    - tools/map-compiler/graph/elevation.test.ts
    - tests/docs-present.test.ts
    - docs/adr/0003-occlusion-mitigation.md
    - public/maps/juliette-ga.map.json
    - public/maps/juliette-ga.glb
    - public/maps/juliette-ga.collision.json

key-decisions:
  - "HEIGHTFIELD_SINK_M (5.0m) and HEIGHTFIELD_RESOLUTION (128) left UNCHANGED, deliberately, despite being the direct cause of the session's headline finding (roads floating above terrain). Raising resolution enough to meaningfully shrink the gap (~512, matching sources/dem.ts's own DEM_MAX_SIZE_PX) would cost ~524,288 terrain triangles alone -- over 10x the entire ~45,000-triangle compiled-map budget. Fixed the GEOMETRY instead: buildRoadShoulders ramps from the paved edge down to whatever the (however coarse, however sunk) heightfield actually reports at that exact point, making the sink's magnitude a physics-invisible implementation detail at the road edge rather than something the player ever falls into."
  - "SHOULDER_WIDTH_M = 6m, chosen so even the worst-case measured road-vs-terrain disagreement (~3.95m, from plan 04-10's own sweep) ramps down at roughly a 35-degree grade -- steep, but a continuous slope a car can scrub down and climb back up, never the vertical, unclimbable cliff the pre-fix code left. [ASSUMED], flagged for re-driving like every other constant on this plan's own tuning-surface table."
  - "Shoulders are edge-only, not junction-fan-only -- a junction fan is already wider than any incident road's paved half-width and reads as a paved apron, so the floating-edge problem is concentrated along a road's run, not at nodes. Filling a fan's own irregular boundary with a matching ramp is a materially harder variable-radius-polygon problem for comparatively little benefit; deliberately left for a follow-up rather than guessed at."
  - "The 'road passes through a hill' finding (distinct from the floating-shoulder finding) traced to a DIFFERENT root cause: a real 503m OSM way segment with only its two endpoints as vertices -- the straight-line elevation interpolation between them cut through real intervening terrain relief a fine-grained sweep confirmed (up to 3.25m of terrain rising ABOVE the linearly-interpolated road, strictly BETWEEN vertices, never AT one). Fixed with densifyEdgePoints (MAX_SEGMENT_LENGTH_M=25m) in the elevation stage, not the heightfield/shoulder stage -- verified the fix by re-running the same sweep against the recompiled map: 0 terrain-above-road points, down from 123, and the map's own max segment length is now capped at 24.9m."
  - "The oblique-angle junction surface bug (gravel visible through tarmac at a non-90-degree tarmac/gravel junction) was investigated at length -- confirmed real acute (<45deg) mixed-width junctions exist in the compiled data (node 45: 3.5m dirt road meeting 7m tarmac at 28-41deg), ruled out MITER_CLAMP as the mechanism (junction endpoints never receive a miter -- tangentAndFactor's own i===0/i===n-1 early returns are always factor:1), and found genuine near-duplicate fan corners at 'through'-road junctions (two collinear same-width edges split at a node) as a plausible but unconfirmed contributing factor -- but could NOT conclusively isolate and safely fix the exact rendering defect without direct visual re-verification. Deferred rather than shipping a speculative geometry change; recorded in ADR 0004's Open Questions and both implicated constants' own doc comments."
  - "Road width (LANE_WIDTH_M/DEFAULT_LANES_BY_CLASS) left unchanged despite a direct finding ('quite difficult to stay on the roads at speed') -- the difficulty was plausibly compounded by the (now-fixed) floating-road defect making every departure from the road a hard stop; re-test requested before retuning width, per the plan's own 'verified by re-driving' discipline."
  - "Frame-drop reading (profiler: dropped 5282 of ~7857 ticks) diagnosed as NOT a defect: SimClock.droppedTicks only increments on a stall rebaseline (Phase 1 SC3's alt-tab-safety mechanism), and the driving session included long stretches of the developer reading/typing checkpoint responses with the tab almost certainly backgrounded. Active-frame metrics reported in the same reading (physics 0.20ms, render 0.54ms, 88 bodies, 35076/45000 triangles) are all comfortably under budget -- real performance is fine. No code change."
  - "The developer separately raised, outside plan 04-11's own scope, that both the permanent helicopter camera and the debug chase-cam fallback read closer than the finished-product vision (a genuinely higher, more overhead 'real helicopter' angle, not GTA1/2-style). Out of scope for this map-compiler plan (belongs to Phase 3's src/core/camera-tuning.ts) -- not touched here. Already live-tunable via the existing ?debug panel (altitude/distance range 3-80m) with no code change needed to preview a higher angle; flagged as a follow-up to bake into defaults once a value is chosen by feel."
  - "Project-level decision, recorded here since it shaped this session but is not one of Phase 4's own locked technical decisions: the developer decided to pause further investment in automated real-world OSM map compilation 'for the moment' in favour of an art-direction pass once the current area's structure reads as solid, and confirmed staying on the current Three.js/Rapier stack rather than evaluating Unity/Godot -- prompted by an honest assessment that grounding fixes alone would not close the gap to the envisioned 'real chase-movie town' look, which needs deliberate art-direction work (building material/colour variety, props, road markings) that is not currently scheduled in any phase 5-8. Juliette, GA and the compiler remain as built; real-world street layouts may still be 'borrowed' as a hand-authored starting layout later."

patterns-established:
  - "Grounding ramps as a shared-geometry extension: any future road-adjacent visual/physical feature belongs in src/core/road-geometry.ts alongside buildRibbon/buildJunctionFan, called identically by the compiler's .glb authoring and the runtime's collider construction -- exactly how buildRoadShoulders was added without touching either call site's surrounding structure."
  - "Segment densification before elevation sampling: any future terrain-following concern for sparse real-world topology data belongs in the elevation stage (graph/elevation.ts), inserting DEM-sampled points before smoothing, rather than in the geometry or heightfield stages downstream."

requirements-completed: [SC1, SC2, SC5]

# Metrics
duration: ~1 session (interactive human-verify checkpoint driving session + same-session fix implementation)
completed: 2026-09-15
---

# Phase 4, Plan 11: SC1 sign-off session, road-shoulder grounding fix, and the phase ADR

**Fixed the floating-road defect (per-edge shoulder ramps to real sampled terrain) and a long-segment terrain-skip defect (elevation densification), both verified against the real compiled Juliette, GA map; deferred the oblique-junction surface bug and road-width retuning with recorded reasons; wrote ADR 0004 recording Phase 4's eight locked decisions.**

## Performance

- **Tasks:** 2 (Task 1: human driving checkpoint; Task 2: fixes, ADR, recompile)
- **Files modified:** 15 (3 new, 12 modified, including all three regenerated map artifacts)
- **Tests:** 832 -> 844 passing (12 new: 5 heightfield-sample, 4 buildRoadShoulders, 1 densification regression, 2 map-scene collider-count updates)

## Accomplishments

- **Task 1 — SC1 sign-off driving session.** The developer drove the compiled Juliette, GA area through `npm run dev`. All 10 verification steps returned a recorded finding (see "Findings" below); the session did not return a clean "approved" — nearly every step surfaced something to fix, retune, or defer.
- **Task 2 — fixes, ADR, recompile.**
  - **Fixed: floating road / falling off and getting stuck.** `src/core/road-geometry.ts`'s new `buildRoadShoulders` builds a ramp per edge from the paved rail down to the off-road heightfield's own real sampled height (`src/core/heightfield-sample.ts`'s bilinear sampler), built identically into the runtime physics collider and the shipped `.glb`. Regression-tested (`tests/road-geometry.test.ts`, `tests/heightfield-sample.test.ts`).
  - **Fixed: road tunnels through a hill.** Traced to a real 503m OSM way segment with only its two endpoints as vertices. `tools/map-compiler/graph/elevation.ts`'s new `densifyEdgePoints` inserts DEM-sampled points into any segment over 25m before smoothing. Verified against the real compiled map: a fine-grained terrain-vs-road sweep found 0 remaining violations, down from 123 pre-fix (worst case 3.25m).
  - **Investigated, deferred with reasons: junction surface bug (gravel through tarmac at an oblique angle), road width, and the occlusion probe re-run.** See "Deferred Findings" below and `docs/adr/0004-first-area-and-compiler-decisions.md`'s Open Questions.
  - **Diagnosed, no fix needed: frame-drop reading.** `SimClock.droppedTicks` correctly recorded tab-backgrounding stalls during the long checkpoint conversation, not a performance problem.
  - **Wrote `docs/adr/0004-first-area-and-compiler-decisions.md`** (15,344 chars), recording Phase 4's eight locked decisions plus this session's findings, and registered it in `tests/docs-present.test.ts`.
  - **Amended `docs/adr/0003-occlusion-mitigation.md`** with a status update: the `DoubleSide` fix from plan 04-09 is confirmed shipped, but the fade-vs-steepen comparison still hasn't been fairly re-run — this session's attempt was confounded by the (now-fixed) floating-geometry defect instead.
  - **Recompiled** `juliette-ga.{map.json,glb,collision.json}` with both fixes. Verified two consecutive compiles produce byte-identical artifacts. `npm run check` green (typecheck, lint, 844 tests).

## Findings (Task 1, per verification step)

1. **Drive every road:** Roads float above off-road terrain; veering off drops the car a few metres and it cannot climb back on without a reset. **Fixed** (shoulder ramps).
2. **Junctions:** Fine at speed and at a crawl. No issue.
3. **Surface transitions:** At non-90-degree tarmac/gravel junctions, gravel is visible where the fan should read as paved. **Investigated, deferred** — see below.
4. **Junction aprons:** Same defect as step 3.
5. **Road widths:** "Quite difficult to stay on the roads at speed due to the desired sliding effect... quite a challenge to stay on the road." **Deferred pending re-test** now that leaving the road is recoverable.
6. **Crests/jumps:** Off-road terrain itself feels properly hilly and jumpable. Separately, the road-through-a-hill defect (**fixed**, densification).
7. **Leaving the road:** Same defect as step 1. **Fixed.**
8. **Buildings/camera + occlusion probe:** "It doesn't read like a real town, more like some kind of surreal dream." Root-caused to every building sharing one flat colour with no material/prop/marking variety — an art-direction gap explicitly deferred to a future art-pass phase per the developer's own direction. The `O`-toggle occlusion probe was inconclusive, confounded by the (now-fixed) floating-geometry defect — ADR 0003 amended accordingly.
9. **Profiler:** frame 16.67ms budget, physics 0.20ms/4ms, render 0.54ms/6ms, draws 10/16, tris 35076/45000, 88 bodies (1 active), tick 7857, sim 130.950s, dropped 5282. **Diagnosed as expected behaviour** (tab-backgrounding stall rebaseline), not a defect — active-frame numbers are all comfortably under budget.
10. **Overall:** "No, but I might if it felt more joined up, without the floating roads and buildings... it's hard to stay on a road long enough to explore." Directly addressed by the Task 2 grounding fixes; the remaining gap to "yes" is the deferred art-direction work.

## Deferred Findings (with reasons)

- **Junction surface bug (steps 3/4).** Real acute (<45deg) mixed-width junctions confirmed in the compiled data (e.g. node 45). `MITER_CLAMP` ruled out as the mechanism (junction endpoints never receive a miter). Near-duplicate fan corners at collinear "through"-road junctions found as a plausible contributing factor, but the exact rendering defect could not be conclusively isolated and safely fixed without direct visual re-verification. Recorded in `ADR 0004`'s Open Questions and in `MITER_CLAMP`'s/`ROAD_CLASS_RANK`'s own doc comments in `src/core/road-geometry.ts`.
- **Road width (step 5).** Left unchanged — the felt difficulty is plausibly compounded by the (now-fixed) inability to recover from leaving the road. Re-test requested before retuning `LANE_WIDTH_M`/`DEFAULT_LANES_BY_CLASS`.
- **Occlusion mitigation re-run (step 8, part).** ADR 0003 updated with a status note; shipped mitigation (`fade`) unchanged per this plan's own instruction not to touch shipped camera behaviour.
- **Art-direction pass (step 8, part; step 10).** Explicitly out of this phase's and this plan's scope. `SURFACE_COLOR_HEX`/`BUILDING_COLOR_HEX` in `tools/map-compiler/author/gltf.ts` left unretouched.
- **Camera altitude/distance.** Raised by the developer outside the plan's own 10 steps, during a broader project-direction conversation. Belongs to Phase 3's `src/core/camera-tuning.ts`, not this map-compiler plan — not touched. Already live-tunable via the `?debug` panel.

## Decisions Made

See `key-decisions` in the frontmatter above for the full list with rationale. Headline: the floating-road fix deliberately did NOT touch `HEIGHTFIELD_SINK_M`/`HEIGHTFIELD_RESOLUTION` (raising resolution enough to matter would blow the triangle budget by >10x) — it fixed the geometry (a shoulder ramp to the real sampled terrain) instead, making the heightfield's coarseness invisible at the road edge.

## Deviations from Plan

None beyond the plan's own explicit allowances (deferring findings with reasons is the plan's documented disposition set, not a deviation).

## Issues Encountered

- The junction-surface-bug investigation went deep (real acute-angle junction geometry confirmed in the compiled data, several hypotheses tested and ruled out) but did not reach a confirmed root cause safe to fix blind. Chose to defer with a detailed written trail (both in code comments and ADR 0004) over shipping an unverified geometry change.
- A mid-session honesty conversation with the developer (concern about whether the visual direction would ever "look right," and whether Unity/Godot/a more literal isometric camera would serve better) resulted in explicit project-level decisions — pause further real-world map automation, stay on the current stack, raise the camera further post-fix, prioritise an art pass once structure is solid — recorded in this summary's key-decisions and flagged for `.planning/STATE.md`.

## Next Phase Readiness

- Phase 4's SC1 perceptual requirement is now materially closer to true: the two structural defects a human driving session found (floating roads, road-through-hill) are fixed and regression-tested against the real compiled area.
- Two items remain genuinely open before Phase 4 can be called fully signed off: the oblique-junction surface bug (needs a targeted visual re-check) and road-width retuning (needs a re-drive now that the floating-road fix landed).
- The art-direction gap (flat, uniform building colour; no props, markings, or material variety) is real and acknowledged but is explicitly a future-phase concern, not a Phase 4 blocker per the developer's own direction.
- Phase 5 (Objectives, Navigation & Race Modes) can proceed against the current compiled area; nothing in this plan changed the road graph's topology or schema, only its elevation fidelity and its edge geometry's grounding.

---
*Phase: 04-map-pipeline-first-area*
*Completed: 2026-09-15*
