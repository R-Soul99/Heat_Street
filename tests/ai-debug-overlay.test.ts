import { describe, expect, it } from "vitest";
import { formatAiDebugLabel, ndcToCss, racingLinePositions } from "../src/debug/ai-debug-overlay";

/**
 * Only the three pure functions are exercised here — `createAiDebugOverlay`
 * needs a DOM and a `three` scene/camera, which do not exist in Vitest's
 * `node` environment (matches `tests/nav-pointer.test.ts`'s own split); the
 * Task 3 browser checkpoint covers that half.
 */
describe("formatAiDebugLabel", () => {
  it("formats state, signed steer, unsigned throttle/brake and 1-decimal timers", () => {
    const label = formatAiDebugLabel({
      state: "avoiding",
      frame: { steer: 0.123, throttle: 0.8, brake: 0, handbrake: false },
      stuckSec: 0,
      noProgressSec: 1.25,
    });
    expect(label).toBe("AVOIDING  S+0.12 T0.80 B0.00  STUCK 0.0s  NP 1.3s");
  });

  it("renders a negative steer with its own minus sign, no extra +", () => {
    const label = formatAiDebugLabel({
      state: "recovering",
      frame: { steer: -0.4, throttle: 0, brake: 1, handbrake: false },
      stuckSec: 2.5,
      noProgressSec: 0,
    });
    expect(label).toContain("S-0.40");
    expect(label).not.toContain("S+-0.40");
  });

  it("uppercases every state label", () => {
    for (const state of ["racing", "avoiding", "recovering", "reset"] as const) {
      const label = formatAiDebugLabel({
        state,
        frame: { steer: 0, throttle: 0, brake: 0, handbrake: false },
        stuckSec: 0,
        noProgressSec: 0,
      });
      expect(label.startsWith(state.toUpperCase())).toBe(true);
    }
  });
});

describe("racingLinePositions", () => {
  it("returns a Float32Array of length points.length * 3 with y offset by +0.35", () => {
    const line = {
      points: [
        { x: 1, y: 10, z: 2 },
        { x: 3, y: 20, z: 4 },
        { x: 5, y: 30, z: 6 },
      ],
    };
    const positions = racingLinePositions(line);
    expect(positions).toBeInstanceOf(Float32Array);
    expect(positions.length).toBe(9);
    expect(positions[0]).toBeCloseTo(1, 5);
    expect(positions[1]).toBeCloseTo(10.35, 5);
    expect(positions[2]).toBeCloseTo(2, 5);
    expect(positions[3]).toBeCloseTo(3, 5);
    expect(positions[4]).toBeCloseTo(20.35, 5);
    expect(positions[5]).toBeCloseTo(4, 5);
    expect(positions[6]).toBeCloseTo(5, 5);
    expect(positions[7]).toBeCloseTo(30.35, 5);
    expect(positions[8]).toBeCloseTo(6, 5);
  });

  it("returns an empty array for an empty line", () => {
    expect(racingLinePositions({ points: [] }).length).toBe(0);
  });
});

describe("ndcToCss", () => {
  it("maps NDC origin to the screen centre and reports visible", () => {
    const result = ndcToCss({ x: 0, y: 0, z: 0.5 }, 800, 600);
    expect(result).toEqual({ left: 400, top: 300, visible: true });
  });

  it("maps NDC (-1, -1) to the bottom-left corner", () => {
    const result = ndcToCss({ x: -1, y: -1, z: 0 }, 800, 600);
    expect(result.left).toBeCloseTo(0, 5);
    expect(result.top).toBeCloseTo(600, 5);
    expect(result.visible).toBe(true);
  });

  it("maps NDC (1, 1) to the top-right corner", () => {
    const result = ndcToCss({ x: 1, y: 1, z: 0 }, 800, 600);
    expect(result.left).toBeCloseTo(800, 5);
    expect(result.top).toBeCloseTo(0, 5);
    expect(result.visible).toBe(true);
  });

  it("reports not visible when z is past the far clip plane", () => {
    expect(ndcToCss({ x: 0, y: 0, z: 1.01 }, 800, 600).visible).toBe(false);
  });

  it("reports not visible when |x| exceeds 1.2", () => {
    expect(ndcToCss({ x: 1.21, y: 0, z: 0 }, 800, 600).visible).toBe(false);
    expect(ndcToCss({ x: -1.21, y: 0, z: 0 }, 800, 600).visible).toBe(false);
  });

  it("reports not visible when |y| exceeds 1.2", () => {
    expect(ndcToCss({ x: 0, y: 1.21, z: 0 }, 800, 600).visible).toBe(false);
    expect(ndcToCss({ x: 0, y: -1.21, z: 0 }, 800, 600).visible).toBe(false);
  });

  it("stays visible exactly at the 1.2 margin", () => {
    expect(ndcToCss({ x: 1.2, y: 1.2, z: 1 }, 800, 600).visible).toBe(true);
  });
});
