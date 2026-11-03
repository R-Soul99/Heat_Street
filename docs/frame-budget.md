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
| Physics ms/frame | < 1.5 ms |
| Draw calls | < 55 |
| Triangles | < 90,000 |
| Total bodies | < 110 |

Originally authored for Phase 1's bare box-and-plane debug scene (draw calls < 20,
bodies < 20) — a scene with no expectation of ever needing more. Draw calls and bodies
were raised in Phase 3 (plan 03-12) against a REAL measured reading (see "Real
measurement, plan 03-12" below, kept as a dated historical reading). All four figures
were raised AGAIN in Phase 4 (plan 04-10) against the real compiled Juliette, GA area
(see "Real measurement, plan 04-10" below). Physics, draw calls and triangles are
raised once more in Phase 04.2 (plan 14) against the terrain renderer — see "Phase
04.2 terrain measurement" immediately below, which is now the current reference.

### Phase 04.2 terrain measurement (plan 14, 2026-11-02)

Phase 04.2 replaced the compiled `.glb` maps with sculpted terrain areas (heights +
paint, rendered and collided as a terrain grid). Readings are from the profiler HUD
(`?debug`) at the busiest view while driving each map, taken by the user at the end of
plan 14's checkpoint:

| Map | Grid | Vertices | Frame | Physics ms/frame | Render (CPU submit) | Draw calls | Triangles | Bodies |
|-----|------|---------:|------:|-----------------:|--------------------:|-----------:|----------:|-------|
| demo-hills | 200x200 @ 3 m (600 x 600 m) | 40,401 | not captured | 0.37 ms | 1.61 ms | 44 | 66,506 | 1 active / 2 total |
| feel-test | 347x447 @ 3 m (1041 x 1341 m) | 155,904 | not captured | 1.16 ms | 1.67 ms | 22 | 73,036 | 1 active / 3 total |
| juliette-ga | 708x689 @ 8 m (5664 x 5512 m) | 489,210 | not captured (HUD flagged it over 16.6 ms) | 0.90 ms | **7.71 ms (over)** | 63 | 42,576 | 1 active / 88 total |

No map dropped a fixed tick (dropped 0 on all three), and the user saw no stutter or
memory trouble on juliette-ga beyond the numbers above.

**Frame ms was not captured.** The map-select dropdown in the top-left corner sits on
top of the HUD's first line, so the frame figure was unreadable in every screenshot
(juliette-ga's line was visibly flagged as over 16.6 ms, but its value was hidden).
Fixing that overlap and re-reading frame ms is an open follow-up.

**D-04 compliance.** D-04's envelope is a 2 x 2 km area. demo-hills and feel-test are
inside it and must meet the locked budget: 16.6 ms frame, physics ≤ 4.0 ms, render CPU
submit ≤ 6.0 ms. Both pass physics (0.37 ms, 1.16 ms) and render (1.61 ms, 1.67 ms) with
wide margins; their frame figure is unverified (see above). juliette-ga, at 5.5 x 5.7 km
(8 m cells), is outside the envelope: it is measured and reported here, not promised.

**Open item: juliette-ga render CPU submit is over budget.** 7.71 ms against the 6.0 ms
render slice, with 63 draw calls (over the 55 target) and an over-16.6 ms frame flag.
The budget is NOT raised to accommodate it. The cause has not been investigated; the
obvious candidates are the 489k-vertex terrain grid and its 11024x11328 paint map
(about 125 MB decoded). This needs a profiling pass (and likely chunking or a coarser
paint resolution for large areas) before any map of that size is promised to run in
budget.

**How the targets were revised.** From the busiest in-envelope reading, with roughly
20-30% headroom (the convention since Phase 3):

- Physics 1.16 ms (feel-test) -> < 1.5 ms (was < 0.5 ms). The terrain collider costs
  more per step than the old compiled heightfield, but this is still under a third of
  the locked 4.0 ms physics budget.
- Draw calls 44 (demo-hills) -> < 55 (was < 16).
- Triangles 73,036 (feel-test) -> < 90,000 (was < 45,000).
- Bodies unchanged at < 110. The terrain maps read 2-3 bodies; body count is driven by
  building colliders, and juliette-ga's 88 still passes.

The old targets (16 draws, 45,000 triangles) were already flagged as over on every
terrain map, so they no longer described the shipped scene.

### Phase 04.3 juliette-ga render pass (plan 09, 2026-11-03)

P43-RENDER follow-up to the open item above. The `?debug` HUD gained a `terrain tex`
line (texture-LOD cost split out from `renderer.render`, LOD flips/s, GPU texture
count) and the frame line was confirmed readable (not hidden by the map dropdown).
Baseline readings on juliette-ga, taken by the user on a 120 Hz display (8.33 ms
frame is vsync, so the 16.6 ms frame budget is met):

| | Steady cruise (pos -163, 453; town) | Flat out across many chunks (worst seen) |
|---|---|---|
| frame | 8.33 / 16.6 ms | 8.33 / 16.6 ms |
| physics | 0.21 / 4 ms | 0.20 / 4 ms |
| render (CPU submit) | 1.33 / 6 ms | 2.12 / 6 ms |
| terrain tex | 0.03 ms, flips/s 0 | 0.00 at snapshot, max about 1.0 ms seen, flips/s 4 |
| GPU textures | 18 | 13 |
| draw calls | **63 / 55 (over, flagged)** | 33 / 55 |
| triangles | 44,724 / 90,000 | 36,264 / 90,000 |
| bodies | 1 active / 91 total | same |

**Finding.** The 7.71 ms render figure from plan 04.2-14 does not reproduce: render CPU
submit is 1.33-2.12 ms, well under the 6.0 ms slice. The only terrain-texture cost is
the LOD flip at chunk crossings (about 1 ms peak, previously all flips in one call).

**Change.** `TerrainView.updateTextures` now rebuilds at most
`TEXTURE_REBUILDS_PER_CALL` (1) chunk texture per call, nearest pending chunk first,
with enter at `textureRadiusM` and leave at `textureRadiusM + TEXTURE_LOD_HYSTERESIS_M`
(half a chunk), so a 10 m jitter across the radius rebuilds nothing. Same-size swaps
reuse the pixel buffer and GPU texture; a pure map swap no longer sets
`material.needsUpdate` (no shader recompile check). `flush()` converges everything in
one call for tests. NOT applied, because the readings do not call for them: row-wise
paint fill, the 512 px full-res cap, and the shadow/draw-radius cull.
`BUDGET` and `SCENE_TARGETS` are unchanged.

**Open item: draw calls 63 against the < 55 target** in the town area (steady cruise),
while render CPU is only 1.33 ms. The draw-call target is a proxy for submit cost and
the submit cost is fine, so this is flagged rather than fixed here: the shadow pass
re-submits every caster, and the town has building meshes on top of 132 terrain chunks.
The plan's draw-side fallback (shadow-caster and draw-radius cull) is conditioned on
render ms over 6.0, which did not occur. Whether to raise the draw-call target (with a
measured justification) or cull chunk draws is for the orchestrator to decide; the
post-change confirmation reading is taken in plan 11.

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
