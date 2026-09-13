# Frame Budget (D-04)

This document is the written frame budget that Phase 1 Success Criterion 4 requires
the profiler HUD to be checked against. It exists so that "is this fast enough?" has
an answer that was agreed in advance rather than an implicit assumption formed while
staring at a number.

**This file and `src/core/frame-budget.ts` are mirrors of each other.**
`tests/frame-budget.test.ts` reads this document from disk and asserts that every
constant in `src/core/frame-budget.ts` appears here verbatim, with its unit. Change
one and the test fails until you change the other. That is deliberate: the HUD reads
the TypeScript constants, a human reads this page, and the two must not diverge.

## Slice budget at 60 fps

| Slice | Budget @ 60fps | Basis |
|-------|---------------|-------|
| **Total frame** | **16.6 ms** | D-04 (locked) |
| **Physics step (all steps this frame)** | **≤ 4.0 ms** | D-04 (locked) |
| Render, CPU submit | ≤ 6.0 ms | Recommendation. Leaves room for Phase 4's chunked city colliders and Phase 3's shadow pass. |
| Game logic (input, camera, interpolation, HUD) | ≤ 2.0 ms | Recommendation. |
| Browser / compositor / GC headroom | ≥ 4.6 ms | Recommendation. Never budget to 100%. |

The four sub-slices sum to the total. `tests/frame-budget.test.ts` asserts this too,
so the budget cannot be quietly over-committed.

### The render figure is CPU submit time, not GPU time

The "Render" row above measures the wall time spent inside `renderer.render()` on the
main thread — that is, how long it takes to *submit* the frame. It is **CPU submit
time**, and it is labelled that way in the HUD as well. It says nothing about how long
the GPU then takes to draw what was submitted.

`three@0.185.1`'s classic `WebGLRenderer` exposes no timer query, so real GPU time is
not available to it: `EXT_disjoint_timer_query_webgl2` appears only under
`src/renderers/webgl-fallback/`, which belongs to the WebGPU-family backend. If true
GPU milliseconds are ever needed, add `stats-gl` alongside the HUD rather than
relabelling this number.

## Phase 1 debug-scene targets

These are the numbers the HUD should actually be showing when Phase 1 is verified. A
bare box-and-plane scene must sit far under the global budget, or something is already
wrong.

| Metric | Phase 1 target |
|--------|---------------|
| Physics ms/frame | < 0.5 ms |
| Draw calls | < 20 |
| Triangles | < 10,000 |
| Total bodies | < 20 |

## Grounding for the 4 ms physics budget

Measured on Node v24.14.1 with Rapier 0.20.0 — cuboid stacks on a static plane, timed
over 600 steps after a 120-step settle:

| Bodies | ms / step |
|--------|----------|
| 2 | 0.006 |
| 11 | 0.008 |
| 51 | 0.004 |
| 201 | 0.008 |
| 501 | 0.212 |

**Caveat, stated honestly:** most of these bodies **sleep** once they have settled, and
a sleeping body costs almost nothing to step. These figures are therefore a floor, not
a worst case. A fully awake scene with a vehicle controller and a dozen pursuers will
be materially higher.

The useful conclusion is one of scale rather than precision: 4 ms is a very generous
budget for Rapier at this project's entity counts, and physics is unlikely to be the
bottleneck before Phase 7.

## Phase 3 additions: surface FX, occlusion probe, camera rig (plan 03-10)

By the time plan 03-10 landed, Phase 3 had added, on top of the Phase 1/2 baseline this
document originally described:

- Six `THREE.Points` particle systems (`src/render/surface-fx.ts`), each with a fixed
  96-particle pool (576 particles total, worst case), gated so only systems whose
  surface a wheel is currently on may emit, and hidden (`points.visible = false`,
  skipping the draw call entirely) whenever a system has zero live particles.
- A 48-slot skid-decal ring buffer (`src/render/surface-fx.ts`), each slot a `Mesh`
  toggled invisible once fully faded rather than removed from the scene graph.
- The occlusion probe (`src/render/camera/occlusion-probe.ts`, plan 03-09): up to nine
  fan-cast rays per frame against the building mesh array (14 placeholder boxes this
  phase), plus one direct camera-to-target ray.
- The helicopter/chase camera rig's own per-frame damping math (`src/render/camera/
  helicopter-camera.ts`) — pure CPU math, no extra draw calls.
- The zone/building visuals themselves (`src/render/surface-view.ts`, plan 03-05): six
  zone meshes and 14 placeholder buildings, each building a separately cloned material
  (needed for plan 03-08's per-building occlusion fade), so each is its own draw call
  by default (three does not auto-batch separate `Mesh` objects sharing geometry).

### Measured `renderer.info` figures — NOT YET TAKEN; this section is an estimate

This plan's own action text asks for `renderer.info.render.calls` and triangle counts
"from a `?debug` session ... take the numbers from the profiler HUD, do not estimate
them." That session did not happen as part of this plan: this plan was executed in a
headless environment with no browser/WebGL/display available, so no real `?debug`
session could be driven to read the HUD. The figures below are therefore an
**engineering estimate from the scene's known object/material counts**, explicitly
labelled as such rather than presented as a measured reading, with a follow-up action
recorded in this plan's SUMMARY.md to replace them with real numbers the next time
someone drives the game in a browser (plan 03-12's playtest already needs to do this
for its own SC6 comparison, and is the natural place to also fill this table in for
real).

| Case | Draw calls (main pass) | Draw calls (+ shadow pass) | Estimated triangles |
|------|------------------------|-----------------------------|----------------------|
| Idle FX (parked on tarmac, no slide) | ~26 (1 chassis + 4 wheels + 1 grid + 6 zones + 14 buildings) | ~45 (chassis/wheels/buildings re-drawn into the shadow map) | well under 10,000 — every mesh here is a handful of boxes |
| Heavy FX (mid-slide on gravel) | ~26 baseline + 1-2 active particle systems + up to ~10 simultaneously-fading decals | ~45 baseline + the same FX additions (particle/decal meshes are not shadow casters) | still well under 10,000 — 576 particle sprites and 48 decal quads are each a handful of vertices, not a triangle-budget concern |

Both cases sit comfortably inside the existing `renderCpuMs` (6.0 ms) and `gameLogicMs`
(2.0 ms) budgets by this estimate — a few dozen draw calls of simple boxes and sprites
is far short of the class of workload (chunked city colliders, dense traffic) those
budgets were sized for. Because this is reasoned from object counts rather than
measured, the budget figures themselves are left UNCHANGED here rather than raised —
raising a locked-looking number on an estimate would make the document describe a guess
as settled fact, the opposite of this file's purpose. If a real `?debug` session finds
either figure exceeded, raise the relevant budget row then, with the measured numbers
recorded here in place of this estimate.

### The CSS camera-skin filter is invisible to every number above

03-RESEARCH.md's Pitfall 4 applies directly to this table: the camera skin's CSS
`filter` (`src/render/camera/camera-skin.ts`, plan 03-0x) is applied by the **browser
compositor**, not by `three`'s `WebGLRenderer.render()` call — `renderer.info` only
accounts for what three itself submits to the GPU. A skin toggle could regress overall
frame time on lower-end GPUs while every number in this document, and the in-game
profiler HUD itself, stays green. The correct instrument for that specific regression
is the **browser's own performance/rendering panel** (Chrome DevTools' Performance tab
or the Rendering tab's frame-rendering stats), spot-checked with the skin on vs. off —
never this document's `renderer.info`-derived figures, which cannot see it by
construction.

### The shadow pass this document's own comment anticipated has still NOT landed

The "Revision notes" section below has said, since Phase 1, that the render/game-logic/
headroom split should be re-derived "in Phase 3 when the shadow pass lands." Phase 3's
`sun` directional light (`src/render/vehicle-view.ts`) already has `castShadow: true`
and a shadow map configured, so a shadow PASS already exists in the numbers above (the
"+ shadow pass" column) — but a dedicated, tuned shadow-quality pass (cascade count,
map resolution tuning, shadow-caster culling) is still outstanding. That revision
remains a future action item, not something this plan resolves.

## Revision notes

- The 16.6 ms total and the 4.0 ms physics allowance are locked by D-04 and should not
  be changed without revisiting that decision.
- The render / game-logic / headroom split is a recommendation. Plan 03-10 revisited it
  with an ESTIMATE (see "Phase 3 additions" above) rather than a measured browser
  session; a real measurement is still an open follow-up.
