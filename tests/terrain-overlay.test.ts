import { describe, expect, it } from "vitest";
import { createTerrainGrid, terrainIndex } from "../src/core/terrain-grid.ts";
import {
  cellPixelSize,
  contourSegments,
  gridLineSegments,
  needsZoomHint,
  ZOOM_HINT_MIN_CELL_PX,
} from "../src/core/terrain-overlay.ts";

function flat(fill = 0) {
  return createTerrainGrid({
    rows: 10,
    cols: 10,
    cellSizeM: 2,
    originX: 0,
    originZ: 0,
    fill,
  });
}

describe("gridLineSegments", () => {
  it("a 4 x 4 cell window yields 2 * 5 * 4 segments", () => {
    const g = flat();
    const seg = gridLineSegments(g, { minRow: 2, minCol: 2, maxRow: 6, maxCol: 6 });
    expect(seg.length).toBe(2 * 5 * 4 * 6);
  });

  it("follows terrain height plus 0.05 m", () => {
    const g = flat(3);
    const seg = gridLineSegments(g, { minRow: 0, minCol: 0, maxRow: 1, maxCol: 1 });
    expect(seg.length).toBe(2 * 2 * 1 * 6);
    for (let i = 1; i < seg.length; i += 3) expect(seg[i]).toBeCloseTo(3.05, 5);
  });

  it("returns an empty array for a degenerate window", () => {
    const g = flat();
    expect(gridLineSegments(g, { minRow: 3, minCol: 3, maxRow: 3, maxCol: 3 }).length).toBe(0);
  });
});

describe("contourSegments", () => {
  it("a planar x ramp gives straight segments at integer heights", () => {
    const g = flat();
    // 1 m per 2 m cell along x.
    for (let c = 0; c <= g.cols; c++) {
      for (let r = 0; r <= g.rows; r++) g.heights[terrainIndex(g, r, c)] = c;
    }
    const seg = contourSegments(g, { minRow: 0, minCol: 0, maxRow: 10, maxCol: 10 }, 1);
    expect(seg.length).toBeGreaterThan(0);
    expect(seg.length % 6).toBe(0);
    for (let i = 0; i < seg.length; i += 3) {
      const x = seg[i];
      const y = seg[i + 1];
      expect(y).toBeCloseTo(x / 2, 5);
      expect(Math.abs(y - Math.round(y))).toBeLessThan(1e-5);
    }
    // Every segment is straight along z (both ends share x).
    for (let i = 0; i < seg.length; i += 6) expect(seg[i]).toBeCloseTo(seg[i + 3], 5);
  });

  it("a flat grid between contour levels has none", () => {
    const g = flat(0.5);
    expect(contourSegments(g, { minRow: 0, minCol: 0, maxRow: 10, maxCol: 10 }, 1).length).toBe(0);
  });

  it("rejects non-positive and non-finite intervals", () => {
    const g = flat();
    const w = { minRow: 0, minCol: 0, maxRow: 10, maxCol: 10 };
    expect(contourSegments(g, w, 0).length).toBe(0);
    expect(contourSegments(g, w, -1).length).toBe(0);
    expect(contourSegments(g, w, Number.NaN).length).toBe(0);
  });

  it("a saddle cell yields two segments", () => {
    const g = flat();
    g.heights[terrainIndex(g, 0, 0)] = 1;
    g.heights[terrainIndex(g, 1, 1)] = 1;
    const seg = contourSegments(g, { minRow: 0, minCol: 0, maxRow: 1, maxCol: 1 }, 1);
    expect(seg.length).toBe(2 * 6);
  });
});

describe("zoom check", () => {
  it("cellPixelSize follows the pinhole formula", () => {
    const px = cellPixelSize(100, 60, 1080, 3);
    expect(px).toBeCloseTo((3 * 1080) / (2 * 100 * Math.tan(Math.PI / 6)), 6);
  });
  it("needsZoomHint trips below ZOOM_HINT_MIN_CELL_PX", () => {
    expect(ZOOM_HINT_MIN_CELL_PX).toBe(8);
    expect(needsZoomHint(7.99)).toBe(true);
    expect(needsZoomHint(8)).toBe(false);
    expect(needsZoomHint(50)).toBe(false);
  });
  it("non-finite size counts as needing a hint", () => {
    expect(needsZoomHint(Number.NaN)).toBe(true);
  });
});
