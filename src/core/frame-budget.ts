/**
 * The frame budget, in milliseconds at 60 fps.
 *
 * Mirrored in `docs/frame-budget.md`. `tests/frame-budget.test.ts` reads that
 * document and fails if any figure here is missing from it, so the budget the
 * profiler HUD checks against can never quietly drift from the budget that was
 * written down and agreed.
 *
 * D-04 locks `frameMs` at 16.6 and `physicsMs` at no more than 4.0. The remaining
 * split is a research recommendation and is expected to be revisited in Phase 3
 * when the shadow pass lands.
 */
export const BUDGET = {
  /** Total frame. 60 fps. Locked by D-04. */
  frameMs: 16.6,
  /** All fixed physics steps executed in one frame, not per step. Locked by D-04. */
  physicsMs: 4.0,
  /** Renderer CPU submit time. Not GPU time — see the doc. Recommendation. */
  renderCpuMs: 6.0,
  /** Input, camera, interpolation and HUD. Recommendation. */
  gameLogicMs: 2.0,
  /** Browser, compositor and GC. Never budget to 100 percent. Recommendation. */
  headroomMs: 4.6,
} as const;

/**
 * What the HUD should actually be reading in the Phase 1 debug scene. A bare
 * six-box scene must sit far under the global budget; if it does not, something is
 * already wrong and no amount of later optimisation will hide it.
 */
export const PHASE1_DEBUG_SCENE_TARGETS = {
  /** Physics ms per frame in the debug scene. */
  physicsMs: 0.5,
  /** `renderer.info.render.calls`, read after `render()`. */
  drawCalls: 20,
  /** `renderer.info.render.triangles`, read after `render()`. */
  triangles: 10000,
  /** `world.bodies.len()`. */
  bodies: 20,
} as const;
