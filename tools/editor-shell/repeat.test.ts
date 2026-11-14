import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRepeater } from "./repeat.ts";

describe("createRepeater", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("ticks immediately, waits the delay, then repeats", () => {
    const tick = vi.fn();
    const r = createRepeater({ delayMs: 400, intervalMs: 80, tick });
    r.start();
    expect(tick).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(399);
    expect(tick).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1 + 80);
    expect(tick).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(160);
    expect(tick).toHaveBeenCalledTimes(4);
    expect(r.running()).toBe(true);
  });

  it("stop clears timers and is idempotent", () => {
    const tick = vi.fn();
    const r = createRepeater({ delayMs: 400, intervalMs: 80, tick });
    r.start();
    vi.advanceTimersByTime(500);
    r.stop();
    r.stop();
    const n = tick.mock.calls.length;
    vi.advanceTimersByTime(1000);
    expect(tick).toHaveBeenCalledTimes(n);
    expect(r.running()).toBe(false);
  });

  it("start while running restarts without a double interval", () => {
    const tick = vi.fn();
    const r = createRepeater({ delayMs: 100, intervalMs: 50, tick });
    r.start();
    vi.advanceTimersByTime(120);
    r.start();
    expect(tick).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(100 + 50);
    expect(tick).toHaveBeenCalledTimes(3);
  });
});
