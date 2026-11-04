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
 * physics 0.38 ms, 57 draw calls, 692 triangles, 21 total bodies (1 active).
 *
 * Revised AGAIN in Phase 4 plan 04-10 against the real compiled Juliette, GA
 * area -- the fixture-scene numbers above described a six-band test bed, not
 * a real map, and this is the first phase with one. Two inputs feed this
 * revision: plan 04-09's checkpoint measured a live `?debug` session against
 * the map as it stood after plan 04-09 (frame 16.67ms, physics 0.27ms,
 * render 0.73ms, 11 draws, 2420 triangles, 1 active / 87 total bodies -- see
 * `docs/frame-budget.md`'s "Live scene targets" section for the full
 * reading); this plan's own Task 1/2 work then added the off-road heightfield
 * (one more fixed body: 88 total) and the terrain mesh (one more draw call,
 * and — because a coarse 128x128 grid is still 32768 triangles — the single
 * biggest triangle contributor in the scene: measured 34856 triangles for
 * the static map alone, i.e. every road/building/terrain mesh with no
 * vehicle geometry, via a direct count against the real `.glb`). `physicsMs`
 * keeps its Phase 3 target unchanged: the heightfield collider is cheap and
 * static, and 0.27ms already measured against the FULL real map (87 bodies)
 * has ample headroom under 0.5ms. `drawCalls`/`triangles`/`bodies` are all
 * raised, each with roughly 15-30% headroom over the measured/computed
 * figures (matching Phase 3's own margin convention) rather than pinned
 * exactly to them: 12 draws -> 16, ~35188 triangles -> 45000, 88 bodies -> 110.
 *
 * Revised AGAIN in Phase 04.2 plan 14 against a REAL measured session on the
 * terrain renderer (profiler HUD, `?debug`, busiest view while driving,
 * 2026-11-02). Readings (physics / render cpu / draws / triangles / bodies):
 *   demo-hills  (600 x 600 m @ 3 m)   0.37 ms / 1.61 ms / 44 / 66,506 / 1 active, 2 total
 *   feel-test   (1041 x 1341 m @ 3 m) 1.16 ms / 1.67 ms / 22 / 73,036 / 1 active, 3 total
 *   juliette-ga (5664 x 5512 m @ 8 m) 0.90 ms / 7.71 ms / 63 / 42,576 / 1 active, 88 total
 * Frame ms was not captured (the map-select dropdown covered that HUD line);
 * 0 dropped ticks on every map. Per D-04 only demo-hills and feel-test are
 * inside the 2 x 2 km envelope, so the targets come from them: busiest
 * in-envelope physics 1.16 ms -> 1.5, draws 44 -> 55, triangles 73,036 ->
 * 90000 (each ~20-30% headroom). Bodies stays 110: the terrain maps read 2-3,
 * but body count is driven by building colliders and juliette-ga's 88 still
 * needs to pass. juliette-ga's 63 draws and 7.71 ms render submit are over
 * (target and BUDGET.renderCpuMs respectively) and are an open item in
 * docs/frame-budget.md, not hidden by these targets. BUDGET is unchanged.
 *
 * Draw-call target raised 55 -> 80 in plan 04.3-11 (2026-11-04), by the user's decision, on
 * measured readings: juliette-ga peaks of 64 (town) and 65 (area crossing) with render CPU
 * averaging 1.2-1.4 ms against its 6.0 ms slice, so the count was a proxy that did not
 * predict cost. 80 is 65 plus ~20% headroom. The shadow pass and 130+ terrain chunks drive it.
 */
export const SCENE_TARGETS = {
  /** Physics ms per frame. */
  physicsMs: 1.5,
  /** `renderer.info.render.calls`, read after `render()`. */
  drawCalls: 80,
  /** `renderer.info.render.triangles`, read after `render()`. */
  triangles: 90000,
  /** `world.bodies.len()`. */
  bodies: 110,
} as const;
