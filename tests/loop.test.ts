import { describe, expect, it, vi } from "vitest";
import type { FrameStats } from "../src/core/frame-stats";
import type { InputSource } from "../src/core/input-tape";
import { NEUTRAL } from "../src/core/input-tape";
import { MAX_STEPS_PER_FRAME } from "../src/core/sim-clock";
import type { LoopDeps, LoopScheduler } from "../src/loop";
import { startLoop } from "../src/loop";
import { createDebugScene } from "../src/physics/debug-scene";
import { TransformCache } from "../src/physics/transform-cache";
import { createWorld } from "../src/physics/world";

/**
 * Headless proof of `startLoop`'s stepping, rendering and stall-recovery
 * behaviour. No jsdom and no `THREE.WebGLRenderer` anywhere in this file:
 * `render` and `hud` are plain spies, and `world`/`scene`/`transforms` are the
 * real Rapier objects `src/main.ts` wires, built fresh per test via
 * `makeSceneDeps()` so no test can see another test's physics state.
 */

/** Always resolves to the all-zero frame — Phase 1 has no live input source yet. */
const neutralInput: InputSource = {
  sampleForTick: () => NEUTRAL,
};

function makeSceneDeps() {
  const world = createWorld();
  const scene = createDebugScene(world);
  const transforms = new TransformCache(scene.bodies);
  return { world, scene, transforms };
}

/**
 * A deterministic, queue-driven `LoopScheduler` the test fully controls: `raf`
 * queues a callback under a cancellable handle, `runFrame` pops and invokes
 * the oldest still-scheduled one at a test-chosen timestamp, and
 * `fireVisible` synchronously invokes every registered visibility listener —
 * mirroring the real hidden-to-visible transition `startLoop` reacts to.
 */
class FakeScheduler implements LoopScheduler {
  private readonly pending = new Map<number, (nowMs: number) => void>();
  private readonly order: number[] = [];
  private nextHandle = 1;
  private currentNowMs = 0;
  private readonly visibilityListeners: Array<() => void> = [];

  raf(cb: (nowMs: number) => void): number {
    const handle = this.nextHandle++;
    this.pending.set(handle, cb);
    this.order.push(handle);
    return handle;
  }

  cancelRaf(handle: number): void {
    this.pending.delete(handle);
  }

  now(): number {
    return this.currentNowMs;
  }

  addVisibilityListener(fn: () => void): () => void {
    this.visibilityListeners.push(fn);
    return () => {
      const index = this.visibilityListeners.indexOf(fn);
      if (index >= 0) this.visibilityListeners.splice(index, 1);
    };
  }

  /** Simulates the hidden -> visible transition firing right now. */
  fireVisible(): void {
    for (const fn of [...this.visibilityListeners]) fn();
  }

  setNow(ms: number): void {
    this.currentNowMs = ms;
  }

  /** Runs the oldest still-scheduled frame at `nowMs`. Throws if none is scheduled. */
  runFrame(nowMs: number): void {
    while (this.order.length > 0) {
      const handle = this.order.shift() as number;
      const cb = this.pending.get(handle);
      if (cb === undefined) continue; // cancelled — skip
      this.pending.delete(handle);
      this.currentNowMs = nowMs;
      cb(nowMs);
      return;
    }
    throw new Error("FakeScheduler.runFrame: no frame is scheduled");
  }

  get pendingCount(): number {
    return this.pending.size;
  }

  get visibilityListenerCount(): number {
    return this.visibilityListeners.length;
  }
}

function makeDeps(
  scheduler: FakeScheduler,
  overrides: Partial<LoopDeps> = {},
): { deps: LoopDeps; sceneDeps: ReturnType<typeof makeSceneDeps> } {
  const sceneDeps = makeSceneDeps();
  const deps: LoopDeps = {
    world: sceneDeps.world,
    input: neutralInput,
    transforms: sceneDeps.transforms,
    applyInput: sceneDeps.scene.applyInput,
    render: () => {},
    scheduler,
    ...overrides,
  };
  return { deps, sceneDeps };
}

describe("startLoop — frame 1 is a no-op", () => {
  it("only starts the clock: zero steps, zero renders", () => {
    const scheduler = new FakeScheduler();
    const render = vi.fn();
    const { deps } = makeDeps(scheduler, { render });

    const handle = startLoop(deps);
    scheduler.runFrame(0);

    expect(render).not.toHaveBeenCalled();
    expect(handle.clock.tick).toBe(0);
  });
});

describe("startLoop — step ordering", () => {
  it("runs captureAsPrevious, onTickBegin, applyInput, world.step, onTickEnd, captureAsCurrent in that exact order", () => {
    const scheduler = new FakeScheduler();
    const { deps, sceneDeps } = makeDeps(scheduler);
    const calls: string[] = [];

    const originalCapturePrev = sceneDeps.transforms.captureAsPrevious.bind(sceneDeps.transforms);
    const originalCaptureCur = sceneDeps.transforms.captureAsCurrent.bind(sceneDeps.transforms);
    vi.spyOn(sceneDeps.transforms, "captureAsPrevious").mockImplementation(() => {
      calls.push("captureAsPrevious");
      originalCapturePrev();
    });
    vi.spyOn(sceneDeps.transforms, "captureAsCurrent").mockImplementation(() => {
      calls.push("captureAsCurrent");
      originalCaptureCur();
    });
    const originalStep = sceneDeps.world.step.bind(sceneDeps.world);
    vi.spyOn(sceneDeps.world, "step").mockImplementation((...args: unknown[]) => {
      calls.push("world.step");
      // biome-ignore lint/suspicious/noExplicitAny: forwarding Rapier's variadic step() args
      return (originalStep as (...a: any[]) => unknown)(...args);
    });

    startLoop({
      ...deps,
      applyInput: (frame) => {
        calls.push("applyInput");
        sceneDeps.scene.applyInput(frame);
      },
      onTickBegin: () => calls.push("onTickBegin"),
      onTickEnd: () => calls.push("onTickEnd"),
    });

    scheduler.runFrame(0); // frame 1: start only, no steps
    scheduler.runFrame(1000 / 60); // exactly one tick

    expect(calls).toEqual([
      "captureAsPrevious",
      "onTickBegin",
      "applyInput",
      "world.step",
      "onTickEnd",
      "captureAsCurrent",
    ]);
  });
});

describe("startLoop — tick indices", () => {
  it("passes contiguous tick indices 0..119 to onTickBegin over 120 frames at 60 fps", () => {
    const scheduler = new FakeScheduler();
    const seen: number[] = [];
    const { deps } = makeDeps(scheduler, { onTickBegin: (tick) => seen.push(tick) });

    startLoop(deps);
    for (let f = 0; f <= 120; f++) {
      scheduler.runFrame((f / 60) * 1000);
    }

    expect(seen).toEqual(Array.from({ length: 120 }, (_, i) => i));
  });
});

describe("startLoop — exactly one render per frame", () => {
  it("renders once per frame regardless of step count, including 0-step and 5-step frames", () => {
    const scheduler = new FakeScheduler();
    const render = vi.fn();
    const stepsSeen: number[] = [];
    const { deps } = makeDeps(scheduler, {
      render,
      hud: (stats: FrameStats) => stepsSeen.push(stats.steps),
    });

    startLoop(deps);
    scheduler.runFrame(0); // frame 1: start, no render

    let nowMs = 0;
    const frameDeltaMs = 1000 / 240; // 240 fps: most frames run zero steps at 60 Hz sim
    for (let i = 0; i < 100; i++) {
      nowMs += i === 50 ? 1000 : frameDeltaMs; // one big jump forces a 5-step clamp frame
      scheduler.runFrame(nowMs);
    }

    expect(render).toHaveBeenCalledTimes(100);
    expect(stepsSeen).toHaveLength(100);
    expect(stepsSeen).toContain(0);
    expect(stepsSeen).toContain(MAX_STEPS_PER_FRAME);
  });
});

describe("startLoop — reschedule happens before work", () => {
  it("keeps the loop alive when render throws: the next frame still runs", () => {
    const scheduler = new FakeScheduler();
    let renderCalls = 0;
    const render = vi.fn(() => {
      renderCalls++;
      if (renderCalls === 1) throw new Error("boom");
    });
    const { deps } = makeDeps(scheduler, { render });

    startLoop(deps);
    scheduler.runFrame(0); // frame 1: start, no render

    expect(() => scheduler.runFrame(1000 / 60)).toThrow("boom");
    // The next frame was already scheduled BEFORE render threw.
    expect(scheduler.pendingCount).toBe(1);

    scheduler.runFrame((2 * 1000) / 60);
    expect(render).toHaveBeenCalledTimes(2);
  });
});

describe("startLoop — clamp", () => {
  it("runs exactly MAX_STEPS_PER_FRAME steps when a frame jumps 1000 ms forward", () => {
    const scheduler = new FakeScheduler();
    let lastSteps = -1;
    const { deps } = makeDeps(scheduler, {
      hud: (stats: FrameStats) => {
        lastSteps = stats.steps;
      },
    });

    startLoop(deps);
    scheduler.runFrame(0);
    scheduler.runFrame(1000);

    expect(lastSteps).toBe(MAX_STEPS_PER_FRAME);
  });
});

describe("startLoop — visibility rebaseline (SC3)", () => {
  it("produces exactly 60 ticks in the first simulated second after a hidden-to-visible rebaseline, not 300", () => {
    const scheduler = new FakeScheduler();
    const { deps } = makeDeps(scheduler);
    const handle = startLoop(deps);

    scheduler.runFrame(0);
    for (let f = 1; f <= 60; f++) scheduler.runFrame((f / 60) * 1000);
    expect(handle.clock.tick).toBe(60);

    // The tab comes back after a 60 s hidden stall. `fireVisible` reads
    // `scheduler.now()` at the moment it fires, exactly like a real
    // `visibilitychange` handler reading `performance.now()`.
    const resumeMs = 61_000;
    scheduler.setNow(resumeMs);
    scheduler.fireVisible();

    for (let f = 1; f <= 60; f++) scheduler.runFrame(resumeMs + (f / 60) * 1000);

    expect(handle.clock.tick - 60).toBe(60);
    expect(handle.clock.droppedTicks).toBeGreaterThan(0);
  });
});

describe("startLoop — same-frame dt-spike rebaseline (SC3, no visibilitychange)", () => {
  it("does not fast-forward through a 60 second gap even when visibilitychange never fires", () => {
    const scheduler = new FakeScheduler();
    const stepsSeen: number[] = [];
    const { deps } = makeDeps(scheduler, {
      hud: (stats: FrameStats) => stepsSeen.push(stats.steps),
    });
    const handle = startLoop(deps);

    scheduler.runFrame(0);
    for (let f = 1; f <= 60; f++) scheduler.runFrame((f / 60) * 1000);
    expect(handle.clock.tick).toBe(60);

    // A 60 real-second gap between two rAF callbacks — e.g. a backgrounded
    // tab whose window was never actually occluded, so `document.hidden`
    // never flips and `visibilitychange` never fires. `fireVisible` is
    // deliberately NOT called anywhere in this test: this must be handled
    // purely by the same-frame dt-spike detection in `src/loop.ts`, not by
    // the visibility listener.
    const resumeMs = 1000 + 60_000;
    scheduler.runFrame(resumeMs);

    // The very first frame back must NOT run anywhere near the ~3600 ticks
    // of backlog a 60 second gap represents — it must be bounded exactly
    // like an ordinary frame (at most one clamp's worth), with the rest
    // accounted for by `droppedTicks`, not silently executed.
    const ticksOnResumeFrame = handle.clock.tick - 60;
    expect(ticksOnResumeFrame).toBeLessThanOrEqual(MAX_STEPS_PER_FRAME);
    expect(handle.clock.droppedTicks).toBeGreaterThan(3000);

    // Subsequent frames must advance at roughly 1:1 with wall-clock time —
    // NOT a decaying catch-up curve. Ten more frames at a normal 60 Hz
    // cadence must add up to (approximately) ten more ticks, not hundreds.
    const tickBeforeCatchupWindow = handle.clock.tick;
    for (let f = 1; f <= 10; f++) {
      scheduler.runFrame(resumeMs + (f / 60) * 1000);
    }
    const ticksOverTenFrames = handle.clock.tick - tickBeforeCatchupWindow;
    expect(ticksOverTenFrames).toBe(10);

    // None of the frames in that ten-frame window may have saturated the
    // clamp — a decaying catch-up curve looks like repeated
    // `MAX_STEPS_PER_FRAME` steps every frame; a clean 1:1 resume never
    // touches the clamp at all, even allowing for the ordinary +/-1 step
    // pairing that floating-point timestamp rounding produces at a large
    // absolute `nowMs` (the same rounding the "tick indices" test tolerates
    // at small `nowMs`).
    const stepsDuringCatchupWindow = stepsSeen.slice(-10);
    expect(stepsDuringCatchupWindow.every((s) => s < MAX_STEPS_PER_FRAME)).toBe(true);
  });
});

describe("startLoop — saturation fallback", () => {
  it("rebaselines after 31 consecutive saturated frames with no visibility event, and resets the counter on any non-saturating frame", () => {
    const scheduler = new FakeScheduler();
    const { deps } = makeDeps(scheduler);
    const handle = startLoop(deps);

    scheduler.runFrame(0);

    // Every frame jumps 1000 ms — far more than MAX_STEPS_PER_FRAME * DT — so
    // every one of these frames saturates the clamp. No visibility event ever
    // fires: this must be the belt-and-braces path, not the primary one.
    let nowMs = 0;
    for (let i = 0; i < 30; i++) {
      nowMs += 1000;
      scheduler.runFrame(nowMs);
    }
    expect(handle.clock.droppedTicks).toBe(0); // 30 saturated frames: threshold not yet exceeded

    nowMs += 1000;
    scheduler.runFrame(nowMs); // the 31st consecutive saturated frame trips the fallback
    const droppedAfterFirstTrip = handle.clock.droppedTicks;
    expect(droppedAfterFirstTrip).toBeGreaterThan(0);

    // A single non-saturating frame must reset the counter to zero.
    nowMs += 1; // far less than one tick: steps === 0
    scheduler.runFrame(nowMs);

    // 30 more saturated frames must NOT retrigger the fallback — if the
    // counter had not reset, it would already be well past 30 and this would
    // trip again on an early frame in this batch.
    for (let i = 0; i < 30; i++) {
      nowMs += 1000;
      scheduler.runFrame(nowMs);
    }
    expect(handle.clock.droppedTicks).toBe(droppedAfterFirstTrip);
  });
});

describe("startLoop — hud receives clock-accurate FrameStats", () => {
  it("passes steps, tick, simTimeSec and droppedTicks that match the clock", () => {
    const scheduler = new FakeScheduler();
    let lastStats: FrameStats | undefined;
    const { deps } = makeDeps(scheduler, {
      hud: (stats: FrameStats) => {
        lastStats = stats;
      },
    });

    const handle = startLoop(deps);
    scheduler.runFrame(0);
    scheduler.runFrame(1000 / 60);
    scheduler.runFrame((2 * 1000) / 60);

    expect(lastStats).toBeDefined();
    expect(lastStats?.tick).toBe(handle.clock.tick);
    expect(lastStats?.simTimeSec).toBe(handle.clock.simTimeSec);
    expect(lastStats?.droppedTicks).toBe(handle.clock.droppedTicks);
    expect(typeof lastStats?.steps).toBe("number");
    expect(typeof lastStats?.physicsMs).toBe("number");
    expect(typeof lastStats?.renderMs).toBe("number");
  });
});

describe("startLoop — render receives dtMs", () => {
  it("passes the wall-clock delta as render's second argument, and 0 on the start-only first frame", () => {
    const scheduler = new FakeScheduler();
    const renderArgs: Array<[number, number]> = [];
    const render = vi.fn((alpha: number, dtMs: number) => {
      renderArgs.push([alpha, dtMs]);
    });
    const { deps } = makeDeps(scheduler, { render });

    startLoop(deps);
    scheduler.runFrame(0); // frame 1: start only, no render call at all
    expect(render).not.toHaveBeenCalled();

    scheduler.runFrame(1000 / 60);
    scheduler.runFrame((2 * 1000) / 60);

    expect(renderArgs).toHaveLength(2);
    for (const [, dtMs] of renderArgs) {
      expect(Number.isFinite(dtMs)).toBe(true);
    }
    expect(renderArgs[0][1]).toBeCloseTo(1000 / 60, 5);
    expect(renderArgs[1][1]).toBeCloseTo(1000 / 60, 5);
  });
});

describe("startLoop — stop()", () => {
  it("cancels the pending frame and removes the visibility listener; no further callbacks run", () => {
    const scheduler = new FakeScheduler();
    const render = vi.fn();
    const { deps } = makeDeps(scheduler, { render });

    const handle = startLoop(deps);
    scheduler.runFrame(0);
    scheduler.runFrame(1000 / 60);
    expect(render).toHaveBeenCalledTimes(1);
    expect(scheduler.visibilityListenerCount).toBe(1);

    handle.stop();

    expect(scheduler.pendingCount).toBe(0);
    expect(scheduler.visibilityListenerCount).toBe(0);

    // Firing visibility after stop() must be inert: the listener was removed.
    const tickBeforeFireVisible = handle.clock.tick;
    scheduler.fireVisible();
    expect(handle.clock.tick).toBe(tickBeforeFireVisible);

    // No frame is scheduled, so there is nothing left for the fake scheduler
    // to run — attempting to would throw, which is itself proof stop() worked.
    expect(() => scheduler.runFrame(2000)).toThrow();
    expect(render).toHaveBeenCalledTimes(1);
  });
});
