import { describe, expect, it } from "vitest";
import { createTerrainGrid } from "../../src/core/terrain-grid.ts";
import { contourSegments } from "../../src/core/terrain-overlay.ts";
import {
  INDEX_EVERY,
  nextContourMode,
  parseContourMode,
  splitIndexContours,
} from "./contour-view.ts";

describe("contour modes", () => {
  it("cycles off, on, only, off", () => {
    expect(nextContourMode("off")).toBe("on");
    expect(nextContourMode("on")).toBe("only");
    expect(nextContourMode("only")).toBe("off");
  });
  it("reads stored values, unknown means off", () => {
    expect(parseContourMode("on")).toBe("on");
    expect(parseContourMode("only")).toBe("only");
    expect(parseContourMode("1")).toBe("off");
    expect(parseContourMode(null)).toBe("off");
  });
});

describe("splitIndexContours", () => {
  const seg = (y: number) => [0, y, 0, 1, y, 0];
  it("puts every fifth level into the index list", () => {
    const all = Float32Array.from([0, 1, 2, 3, 4, 5, 6, 10].flatMap(seg));
    const { regular, index } = splitIndexContours(all, 1, 5);
    expect(index.length / 6).toBe(3); // levels 0, 5, 10
    expect(regular.length / 6).toBe(5);
    expect(new Set(Array.from({ length: 3 }, (_, i) => index[i * 6 + 1]))).toEqual(
      new Set([0, 5, 10]),
    );
  });
  it("counts in multiples of the interval, including negative levels", () => {
    const all = Float32Array.from([-5, -2.5, 0, 2.5, 5].flatMap(seg));
    const { index } = splitIndexContours(all, 0.5, 5);
    // 0.5 m interval, every 5th = every 2.5 m: all five levels are index lines.
    expect(index.length / 6).toBe(5);
    const half = splitIndexContours(Float32Array.from([-1, -0.5, 0, 0.5, 1].flatMap(seg)), 0.5, 5);
    expect(half.index.length / 6).toBe(1); // only level 0
  });
  it("keeps segment data intact and in order", () => {
    const all = Float32Array.from([1, 5].flatMap(seg));
    const { regular, index } = splitIndexContours(all, 1, INDEX_EVERY);
    expect(Array.from(regular)).toEqual(seg(1));
    expect(Array.from(index)).toEqual(seg(5));
  });
  it("returns everything as ordinary for a bad interval", () => {
    const all = Float32Array.from(seg(5));
    expect(splitIndexContours(all, 0).index.length).toBe(0);
    expect(splitIndexContours(all, 0).regular).toBe(all);
  });
  it("works on real contourSegments output over a ramped grid", () => {
    const g = createTerrainGrid({ rows: 10, cols: 10, cellSizeM: 1, originX: 0, originZ: 0 });
    const stride = g.rows + 1;
    for (let r = 0; r <= g.rows; r++)
      for (let c = 0; c <= g.cols; c++) g.heights[r + c * stride] = c;
    const segs = contourSegments(g, { minRow: 0, minCol: 0, maxRow: g.rows, maxCol: g.cols }, 1);
    const { regular, index } = splitIndexContours(segs, 1, 5);
    expect(regular.length + index.length).toBe(segs.length);
    expect(index.length).toBeGreaterThan(0);
    for (let i = 1; i < index.length; i += 3) expect(Math.round(index[i] as number) % 5).toBe(0);
  });
});
