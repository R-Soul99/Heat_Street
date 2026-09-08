/**
 * The rAF driver: the ONLY file in the repo that may call
 * `requestAnimationFrame`, read `performance.now()` outside `src/debug/`, or
 * listen for `document.visibilitychange`. `tests/layering.test.ts` enforces
 * this automatically rather than relying on it being reviewed by eye.
 *
 * Steps on an absolute clock, renders exactly once per animation frame
 * outside the fixed-tick loop, and handles a stall with THREE
 * complementary mechanisms — 01-RESEARCH.md "Pattern 5" requires the first
 * two, and a real 60-second-alt-tab browser verification surfaced the need
 * for the third:
 *   1. `SimClock`'s own `MAX_STEPS_PER_FRAME` clamp bounds a single slow
 *      frame's work.
 *   2. A `visibilitychange` rebaseline discards a long backlog instead of
 *      replaying it, on the hidden -> visible transition.
 *   3. A same-frame dt-spike rebaseline: if a single frame's wall-clock gap
 *      alone (`dtMs`) exceeds `STALL_DT_THRESHOLD_MS`, rebaseline BEFORE
 *      computing `stepsFor` for that frame, rather than waiting on either
 *      `visibilitychange` (which is not guaranteed to fire promptly, or at
 *      all, in every windowing/OS configuration) or the saturation counter
 *      below (which — while bounded to ~31 frames — is a belt-and-braces
 *      fallback, not a same-frame fix, and a human verification pass
 *      measured a sustained ~10x fast-forward that neither of the first two
 *      mechanisms cut short). See "Fix note" further down for the measured
 *      failure this closes.
 * "Pitfall 2" measured a clamp-only alt-tab producing 300 ticks (a
 * five-times fast-forward) in the first second back instead of 60; this
 * file is where that fix lives.
 *
 * See 01-RESEARCH.md "Code Examples > Example 1" and 01-PATTERNS.md
 * "src/loop.ts" for the eight structural conventions this establishes for
 * every later phase.
 */
import type * as RAPIER from "@dimforge/rapier3d";
import type { FrameStats } from "./core/frame-stats";
import type { InputFrame, InputSource } from "./core/input-tape";
import { MAX_STEPS_PER_FRAME, SimClock } from "./core/sim-clock";
import type { TransformCache } from "./physics/transform-cache";

/**
 * Consecutive saturated frames tolerated before the belt-and-braces
 * rebaseline fires. 01-RESEARCH.md "Code Examples > Example 1" uses 30; a
 * stall this long has already produced a visible race regardless of which
 * path recovers it, so this is a safety net, not a tuning dial.
 */
const SATURATION_REBASELINE_THRESHOLD = 30;

/**
 * Single-frame wall-clock gap, in ms, above which a frame is treated as a
 * stall and rebaselined immediately — same frame, before `stepsFor` runs —
 * rather than left to drain via the clamp and the (much slower, ~31-frame)
 * saturation fallback.
 *
 * Fix note: a real browser 60-second alt-tab verification measured `sim`
 * advancing roughly 10x for a sustained ~10 real seconds after returning —
 * far longer than either the saturation fallback (bounded to ~31 frames,
 * well under a second at any real refresh rate) or a correctly-firing
 * `visibilitychange` should ever allow. That means the loop cannot rely
 * solely on `document.hidden`/`visibilitychange` timing, which is not
 * guaranteed to fire promptly (or classify the page as hidden at all) in
 * every OS/window-manager configuration — a window that is alt-tabbed away
 * from but not actually occluded/minimized can remain "visible" per the
 * Page Visibility spec even though the user is not looking at it. This
 * threshold is a same-frame, environment-agnostic backstop: ANY single
 * inter-frame gap this large is unambiguously a stall (background timer
 * throttling, OS sleep, a long GC or debugger pause), never an ordinary
 * slow frame, so it is safe to rebaseline on it immediately rather than
 * waiting for confirmation from `visibilitychange` or the saturation
 * counter. Set comfortably above the clamp test's 1000 ms single-frame
 * jump (which must still take the bounded-clamp path, not an instant
 * rebaseline — RESEARCH.md "Pattern 5": the clamp handles one genuinely
 * slow frame, rebaseline handles a stall) and comfortably below any
 * realistic alt-tab/backgrounding duration.
 */
const STALL_DT_THRESHOLD_MS = 2000;

/**
 * Everything the loop needs from the browser: scheduling a frame, wall time,
 * and the hidden-to-visible transition. Injecting this is what makes
 * `startLoop` testable in Node with no jsdom — the default implementation is
 * built lazily INSIDE `startLoop`, never at module scope, so importing this
 * module never touches `document` or `window`.
 */
export interface LoopScheduler {
  raf(cb: (nowMs: number) => void): number;
  cancelRaf(handle: number): void;
  now(): number;
  /** Registers `fn` to fire only on the hidden -> visible transition. Returns an unregister function. */
  addVisibilityListener(fn: () => void): () => void;
}

function createBrowserScheduler(): LoopScheduler {
  return {
    raf: (cb) => requestAnimationFrame(cb),
    cancelRaf: (handle) => cancelAnimationFrame(handle),
    now: () => performance.now(),
    addVisibilityListener: (fn) => {
      const handler = (): void => {
        if (!document.hidden) fn();
      };
      document.addEventListener("visibilitychange", handler);
      return () => document.removeEventListener("visibilitychange", handler);
    },
  };
}

/**
 * Dependency-injection object literal rather than constructor parameters or
 * module singletons. Later phases add fields here as the loop grows more
 * responsibilities — keep it an object, per 01-PATTERNS.md.
 */
export interface LoopDeps {
  world: RAPIER.World;
  input: InputSource;
  transforms: TransformCache;
  applyInput(frame: InputFrame): void;
  /** Called at the top of each fixed tick, before `applyInput`. */
  onTickBegin?(tick: number): void;
  /**
   * Called immediately after `world.step()` for this tick. The event-queue
   * parameter is always `null` in Phase 1 — nothing drains Rapier's
   * `EventQueue` yet — but the signature must PERMIT per-tick draining now,
   * or Phase 5's checkpoint detection will silently miss crossings on
   * multi-step frames (01-RESEARCH.md "Anti-Patterns to Avoid").
   */
  onTickEnd?(tick: number, events: RAPIER.EventQueue | null): void;
  /** Called exactly once per animation frame, outside the fixed-tick loop. */
  render(alpha: number): void;
  /** Called once per frame, after `render` returns. */
  hud?(stats: FrameStats, dtMs: number): void;
  /** Defaults to a browser implementation wrapping rAF / performance.now / visibilitychange. */
  scheduler?: LoopScheduler;
}

export interface LoopHandle {
  readonly clock: SimClock;
  /** Cancels the pending frame and unregisters the visibility listener. No further callbacks run. */
  stop(): void;
}

/**
 * Start the fixed-timestep loop. See the module doc comment and
 * 01-RESEARCH.md "Code Examples > Example 1" for the full rationale behind
 * every line below.
 */
export function startLoop(deps: LoopDeps): LoopHandle {
  const scheduler = deps.scheduler ?? createBrowserScheduler();
  const clock = new SimClock();

  let started = false;
  let saturated = 0;
  let stopped = false;
  let rafHandle = 0;
  let previousNowMs = 0;

  // Rebaselines on the hidden -> visible transition. This is the PRIMARY
  // stall fix; the saturation fallback below is belt-and-braces for stalls
  // that never dispatch this event.
  const removeVisibilityListener = scheduler.addVisibilityListener(() => {
    clock.rebaseline(scheduler.now());
  });

  function frame(nowMs: number): void {
    // Reschedule BEFORE any work: a throw anywhere below must not stop the
    // loop, because the next frame is already queued by the time it happens.
    rafHandle = scheduler.raf(frame);

    if (!started) {
      clock.start(nowMs);
      started = true;
      previousNowMs = nowMs;
      return;
    }

    const dtMs = nowMs - previousNowMs;
    previousNowMs = nowMs;

    // Same-frame stall backstop: a gap this large is unambiguously a stall,
    // not an ordinary slow frame. Rebaseline BEFORE `stepsFor` runs so THIS
    // frame — not the 31st frame after it — is the one that resumes at 1:1.
    // Independent of, and does not replace, the `visibilitychange` listener
    // above or the saturation fallback below: see `STALL_DT_THRESHOLD_MS`.
    if (dtMs > STALL_DT_THRESHOLD_MS) {
      clock.rebaseline(nowMs);
      saturated = 0;
    }

    const physicsBeginMs = scheduler.now();
    const steps = clock.stepsFor(nowMs);
    for (let s = 0; s < steps; s++) {
      // `stepsFor` has already advanced `clock.tick` past all `steps` of
      // them, so the index for step `s` is counted back from the current tick.
      const tickIndex = clock.tick - steps + s;
      deps.transforms.captureAsPrevious();
      deps.onTickBegin?.(tickIndex);
      deps.applyInput(deps.input.sampleForTick(tickIndex));
      deps.world.step();
      deps.onTickEnd?.(tickIndex, null);
      deps.transforms.captureAsCurrent();
    }
    const physicsMs = scheduler.now() - physicsBeginMs;

    // Belt-and-braces saturation fallback: a debugger pause, a long GC pause,
    // or an OS sleep with the tab still nominally visible never fires
    // `visibilitychange`. If the clamp saturates for a sustained run of
    // frames, rebaseline anyway rather than fast-forwarding indefinitely.
    if (steps === MAX_STEPS_PER_FRAME) {
      saturated++;
      if (saturated > SATURATION_REBASELINE_THRESHOLD) {
        clock.rebaseline(nowMs);
        saturated = 0;
      }
    } else {
      saturated = 0;
    }

    // ONE render per frame, outside the step loop above. Rendering per tick
    // collapses the architecture back into variable-rate rendering.
    const renderBeginMs = scheduler.now();
    deps.render(clock.alpha(nowMs));
    const renderMs = scheduler.now() - renderBeginMs;

    // Runs LAST, after render returns, so a HUD reading `renderer.info` sees
    // this frame's draw — `renderer.info.autoReset` resets at the START of
    // `render()`, not the end.
    deps.hud?.(
      {
        physicsMs,
        renderMs,
        steps,
        tick: clock.tick,
        simTimeSec: clock.simTimeSec,
        droppedTicks: clock.droppedTicks,
      },
      dtMs,
    );
  }

  rafHandle = scheduler.raf(frame);

  return {
    clock,
    stop(): void {
      if (stopped) return;
      stopped = true;
      scheduler.cancelRaf(rafHandle);
      removeVisibilityListener();
    },
  };
}
