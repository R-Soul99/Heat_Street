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
 * What the HUD should actually be reading in the CURRENT shipped scene. There is
 * only ever one live target set — the HUD has no scene-awareness — so this is
 * revised forward each time a phase materially changes what's on screen, rather
 * than living as a permanent "Phase 1" snapshot after later phases have moved on.
 *
 * Originally authored for Phase 1's bare six-box debug scene (drawCalls 20,
 * bodies 20). Revised in Phase 3 plan 03-12 against a REAL measured `?debug`
 * session (profiler HUD, sustained slide on gravel with dust at full):
 * physics 0.38 ms, 57 draw calls, 692 triangles, 21 total bodies (1 active) —
 * see `docs/frame-budget.md`'s "Live scene targets" section for the full
 * reading. `physicsMs` and `triangles` already had comfortable headroom over
 * that measurement and are unchanged; `drawCalls` and `bodies` did not and are
 * raised here, with roughly 20-40% headroom over the measured figures rather
 * than pinned exactly to them.
 */
export const SCENE_TARGETS = {
  /** Physics ms per frame. */
  physicsMs: 0.5,
  /** `renderer.info.render.calls`, read after `render()`. */
  drawCalls: 70,
  /** `renderer.info.render.triangles`, read after `render()`. */
  triangles: 10000,
  /** `world.bodies.len()`. */
  bodies: 30,
} as const;
