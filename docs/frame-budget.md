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

## Live scene targets

These are the numbers the HUD (`src/debug/profiler-hud.ts`) actually checks against
right now — `SCENE_TARGETS` in `src/core/frame-budget.ts`. There is only one live
target set (the HUD has no scene-awareness), so this section is revised forward each
time a phase materially changes what's on screen, rather than staying a permanent
snapshot of whichever phase first wrote it.

| Metric | Target |
|--------|---------------|
| Physics ms/frame | < 0.5 ms |
| Draw calls | < 16 |
| Triangles | < 45,000 |
| Total bodies | < 110 |

Originally authored for Phase 1's bare box-and-plane debug scene (draw calls < 20,
bodies < 20) — a scene with no expectation of ever needing more. Draw calls and bodies
were raised in Phase 3 (plan 03-12) against a REAL measured reading (see "Real
measurement, plan 03-12" below, kept as a dated historical reading). All four figures
are raised AGAIN in Phase 4 (plan 04-10) against the real compiled Juliette, GA area —
see "Real measurement, plan 04-10" immediately below, which supersedes plan 03-12's
reading as the current reference.

### Real measurement, plan 04-10 (2026-09-15)

Phase 3's fixture scene (six bands, 14 placeholder buildings) is superseded here by
Heat Street's first real compiled map. Two inputs feed this reading: a live `?debug`
session at the end of plan 04-09 (frame/physics/render/draws/triangles/bodies, taken
against the map as plan 04-09 shipped it), and a direct offline count of the static map
`.glb` after plan 04-10's own Task 1/2 additions (the off-road heightfield collider and
terrain mesh) — the terrain mesh alone, a 128x128 grid, is 32,768 triangles, by far the
single biggest contributor in the scene:

| Metric | Measured | Target | Verdict |
|--------|---------:|-------:|---------|
| Total frame | 16.67 ms | 16.6 ms | Essentially exact 60 fps, not a real overage (plan 04-09's own `?debug` session) |
| Physics ms/frame | 0.27 ms | < 0.5 ms (unchanged) | Pass, ample headroom — measured against the FULL real map's 87 bodies; plan 04-10's one extra (cheap, static) heightfield collider does not threaten this |
| Render (CPU submit) | 0.73 ms | < 6.0 ms | Pass, comfortable headroom (plan 04-09's own `?debug` session, before the terrain mesh existed — CPU submit time tracks draw-call COUNT, not triangle count, so one more mesh moves this figure negligibly) |
| Draw calls | 12 (11 measured + 1 new terrain mesh) | < 16 (was < 70) | Pass against the revised target |
| Triangles | ~35,188 (2,420 measured + 32,768 new terrain) | < 45,000 (was < 10,000) | Pass against the revised target |
| Total bodies | 88 (87 measured + 1 new heightfield) | < 110 (was < 30) | Pass against the revised target |

The 87-body/2,420-triangle/11-draw/frame/physics/render figures are plan 04-09's
checkpoint reading verbatim (see that plan's SUMMARY.md, Task 3 checkpoint). The
34,856-triangle/5-draw static-map figure (road + building + terrain meshes, no vehicle
geometry) is a direct offline count against the real committed `.glb`, cross-checked
against the CLI's own printed per-surface triangle counts (1,238 road + 850 building +
32,768 terrain = 34,856). The +1 body/+1 draw call for the new heightfield
collider/terrain mesh are exact, not estimated — plan 04-10's own Task 1/2 additions
are each precisely one collider and one mesh.

### Real measurement, plan 03-12 (2026-09-13) — superseded by the reading above

Taken from the profiler HUD (`?debug`, Backquote) during a sustained slide on gravel
with the dust particles at full — the heaviest case this phase's scene produces:

| Metric | Measured | Target | Verdict |
|--------|---------:|-------:|---------|
| Total frame | 16.68 ms | 16.6 ms | Essentially exact 60 fps (16.667 ms is the true interval; "16.6" is a rounded-down constant) — not a real overage |
| Physics ms/frame | 0.38 ms | < 0.5 ms | Pass, comfortable headroom |
| Render (CPU submit) | 1.64 ms | < 6.0 ms | Pass, comfortable headroom |
| Draw calls | 57 | < 70 (was < 20) | Pass against the revised target. Closely matches this document's own prior "heavy FX, + shadow pass" ESTIMATE of ~55-57 — the estimate held up well |
| Triangles | 692 | < 10,000 | Pass, comfortable headroom |
| Total bodies | 21 (1 active) | < 30 (was < 20) | Pass against the revised target |

This measurement replaces the "engineering estimate" table that previously stood here
(see git history for the superseded estimate) — the follow-up action that section's own
text asked for is now closed.

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

### Measured `renderer.info` figures — SUPERSEDED by a real reading

This section previously carried an engineering estimate (reasoned from the scene's
object/material counts, not measured), because the plan that added it was executed
headless with no browser available. That estimate's own text named plan 03-12's
playtest as the point it should be replaced with a real reading — see this document's
"Live scene targets" section above for that measurement, taken exactly the way the
estimate anticipated (profiler HUD, heavy-FX case: sustained slide on gravel with dust
at full). The estimate predicted ~45-57 draw calls for that case including the shadow
pass; the real reading came in at 57 — close enough that the estimate's reasoning is
validated, not just superseded.

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
