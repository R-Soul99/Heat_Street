/**
 * The per-frame telemetry contract shared between `src/loop.ts` (producer) and
 * `src/debug/profiler-hud.ts` (consumer).
 *
 * Lives under `src/core/` rather than `src/debug/` or `src/loop.ts` because both
 * of those files depend on it and neither should depend on the other —
 * `src/loop.ts` must not know the HUD exists (D-05/T-01-22: debug tooling must
 * never perturb simulation timing), and `src/debug/` must not become a
 * dependency of the loop.
 *
 * Type-only module: no dependency statements, no runtime code, nothing to
 * test in isolation.
 */
export interface FrameStats {
  /** Wall time (ms) around ALL fixed steps executed this frame, not per step. */
  readonly physicsMs: number;
  /** CPU submit time (ms) around `renderer.render()` — not GPU time. */
  readonly renderMs: number;
  /** Fixed steps executed this frame (0 to `MAX_STEPS_PER_FRAME`). */
  readonly steps: number;
  /** `SimClock.tick` after this frame's steps. */
  readonly tick: number;
  /** `SimClock.simTimeSec` — the only run clock. */
  readonly simTimeSec: number;
  /** `SimClock.droppedTicks` — nonzero only after a stall rebaseline. */
  readonly droppedTicks: number;
}
