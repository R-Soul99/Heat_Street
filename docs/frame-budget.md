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

## Revision notes

- The 16.6 ms total and the 4.0 ms physics allowance are locked by D-04 and should not
  be changed without revisiting that decision.
- The render / game-logic / headroom split is a recommendation. Phase 3 adds the
  shadow pass and the helicopter camera, which is the natural point to re-derive it
  from measurements rather than from estimate.
