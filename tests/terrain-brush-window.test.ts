import { describe, expect, it } from "vitest";
import { createStrokeRecorder, offsetWindowFrom, raiseWindow } from "../src/core/terrain-brush.ts";
import { createTerrainGrid, terrainIndex } from "../src/core/terrain-grid.ts";
import { MAX_SLOPE_DEG } from "../src/core/terrain-limits.ts";
import { maxSlopeDegIn } from "../src/core/terrain-slope.ts";

function grid() {
  return createTerrainGrid({ rows: 40, cols: 40, cellSizeM: 3, originX: -60, originZ: -60 });
}
const win = { minRow: 10, minCol: 10, maxRow: 14, maxCol: 14 };
const h = (g: ReturnType<typeof grid>, r: number, c: number) => g.heights[terrainIndex(g, r, c)];

describe("raiseWindow", () => {
  it("raises every vertex in the window by exactly the delta", () => {
    const g = grid();
    const rec = createStrokeRecorder(g, { width: 1, height: 1 } as never);
    const r = raiseWindow(g, win, 1.5, rec);
    expect(r.window).toBeDefined();
    for (let row = win.minRow; row <= win.maxRow; row++) {
      for (let col = win.minCol; col <= win.maxCol; col++) {
        expect(h(g, row, col)).toBeCloseTo(1.5, 5);
      }
    }
    expect(h(g, 9, 9)).toBe(0);
    expect(rec.commit()?.heights).toBeDefined();
  });

  it("is a no-op for zero or non-finite deltas", () => {
    const g = grid();
    for (const d of [0, Number.NaN, Number.POSITIVE_INFINITY]) {
      const r = raiseWindow(g, win, d);
      expect(r.window).toBeUndefined();
      expect(r.slopeClamped).toBe(false);
    }
    expect(g.heights.every((v) => v === 0)).toBe(true);
  });

  it("holds road-masked vertices", () => {
    const g = grid();
    const stride = g.rows + 1;
    const held = terrainIndex(g, 12, 12);
    raiseWindow(g, win, 1, undefined, {
      roadMask: () => {
        const m = new Uint8Array(g.heights.length);
        m[held] = 1;
        return m;
      },
    });
    expect(g.heights[held]).toBe(0);
    expect(g.heights[11 + 12 * stride]).toBeGreaterThan(0);
  });

  it("clamps a huge raise to the slope limit", () => {
    const g = grid();
    const small = { minRow: 10, minCol: 10, maxRow: 12, maxCol: 12 };
    const r = raiseWindow(g, small, 10);
    expect(r.slopeClamped).toBe(true);
    const all = { minRow: 0, minCol: 0, maxRow: g.rows, maxCol: g.cols };
    expect(maxSlopeDegIn(g, all)).toBeLessThanOrEqual(MAX_SLOPE_DEG + 0.01);
  });

  it("clips a window that overhangs the grid", () => {
    const g = grid();
    const r = raiseWindow(g, { minRow: -5, minCol: -5, maxRow: 2, maxCol: 2 }, 1);
    expect(r.window).toBeDefined();
    expect(h(g, 0, 0)).toBeCloseTo(1, 5);
  });
});

describe("offsetWindowFrom", () => {
  it("sets vertices to base + delta, and back to base at 0", () => {
    const g = grid();
    const base = Float32Array.from(g.heights);
    offsetWindowFrom(g, win, base, 3);
    expect(h(g, 12, 12)).toBeCloseTo(3, 5);
    g.heights.set(base);
    const r = offsetWindowFrom(g, win, base, 0);
    expect(r.window).toBeUndefined();
    expect(h(g, 12, 12)).toBe(0);
  });

  it("keeps held vertices at their current height", () => {
    const g = grid();
    const base = Float32Array.from(g.heights);
    const held = terrainIndex(g, 12, 12);
    offsetWindowFrom(g, win, base, 2, undefined, {
      roadMask: () => {
        const m = new Uint8Array(g.heights.length);
        m[held] = 1;
        return m;
      },
    });
    expect(g.heights[held]).toBe(0);
    expect(h(g, 11, 11)).toBeCloseTo(2, 5);
  });

  it("is a no-op for non-finite deltas", () => {
    const g = grid();
    const r = offsetWindowFrom(g, win, Float32Array.from(g.heights), Number.NaN);
    expect(r.window).toBeUndefined();
  });
});
