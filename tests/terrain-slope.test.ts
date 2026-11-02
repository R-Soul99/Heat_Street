import { describe, expect, it } from "vitest";
import { createTerrainGrid, terrainIndex } from "../src/core/terrain-grid.ts";
import { MAX_SLOPE_DEG } from "../src/core/terrain-limits.ts";
import { expandWindow, limitSlope, maxSlopeDegIn } from "../src/core/terrain-slope.ts";

const CELL = 3;
const D = Math.tan((35 * Math.PI) / 180) * CELL;

function flat(n = 40, cell = CELL) {
  return createTerrainGrid({ rows: n, cols: n, cellSizeM: cell, originX: 0, originZ: 0 });
}

function whole(g: { rows: number; cols: number }) {
  return { minRow: 0, minCol: 0, maxRow: g.rows, maxCol: g.cols };
}

function assertCap(g: ReturnType<typeof flat>, tol = 1e-6) {
  const h = g.heights;
  for (let c = 0; c <= g.cols; c++) {
    for (let r = 0; r <= g.rows; r++) {
      const i = terrainIndex(g, r, c);
      if (r < g.rows) expect(Math.abs(h[i + 1] - h[i])).toBeLessThanOrEqual(D + tol);
      if (c < g.cols) {
        expect(Math.abs(h[terrainIndex(g, r, c + 1)] - h[i])).toBeLessThanOrEqual(D + tol);
        if (r < g.rows)
          expect(Math.abs(h[terrainIndex(g, r + 1, c + 1)] - h[i])).toBeLessThanOrEqual(
            D * Math.SQRT2 + tol,
          );
        if (r > 0)
          expect(Math.abs(h[terrainIndex(g, r - 1, c + 1)] - h[i])).toBeLessThanOrEqual(
            D * Math.SQRT2 + tol,
          );
      }
    }
  }
}

describe("limitSlope", () => {
  it("defaults to the signed-off cap", () => {
    expect(MAX_SLOPE_DEG).toBe(35);
  });

  it("limits a 50 m spike on every axis and diagonal neighbour", () => {
    const g = flat();
    g.heights[terrainIndex(g, 20, 20)] = 50;
    limitSlope(g, whole(g), { maxSlopeDeg: 35 });
    assertCap(g);
  });

  it("lowers the peak instead of raising a cone around it", () => {
    const g = flat();
    const peak = terrainIndex(g, 20, 20);
    g.heights[peak] = 50;
    const res = limitSlope(g, whole(g), { maxSlopeDeg: 35 });
    expect(g.heights[peak]).toBeLessThan(10);
    expect(g.heights[terrainIndex(g, 20, 22)]).toBe(0);
    expect(res.changed.length).toBe(1);
    expect(res.changed[0]).toBe(peak);
  });

  it("fills a pit rather than digging a cone", () => {
    const g = flat();
    const pit = terrainIndex(g, 20, 20);
    g.heights[pit] = -50;
    limitSlope(g, whole(g), { maxSlopeDeg: 35 });
    assertCap(g);
    expect(g.heights[pit]).toBeGreaterThan(-10);
  });

  it("leaves cells outside the window byte-identical", () => {
    const g = flat();
    for (let i = 0; i < g.heights.length; i++) g.heights[i] = (i * 37) % 11;
    const before = new Float32Array(g.heights);
    const win = { minRow: 10, minCol: 10, maxRow: 25, maxCol: 25 };
    limitSlope(g, win, { maxSlopeDeg: 35 });
    for (let c = 0; c <= g.cols; c++) {
      for (let r = 0; r <= g.rows; r++) {
        const inside = r >= 10 && r <= 25 && c >= 10 && c <= 25;
        const i = terrainIndex(g, r, c);
        if (!inside) expect(g.heights[i]).toBe(before[i]);
      }
    }
  });

  it("WR-03: reads the ring outside the window as fixed sources, so the border never steps", () => {
    const g = flat();
    const win = { minRow: 10, minCol: 10, maxRow: 30, maxCol: 30 };
    // A 20 m block inside the window on flat ground: a cliff at the window edge.
    for (let c = 10; c <= 30; c++)
      for (let r = 10; r <= 30; r++) g.heights[terrainIndex(g, r, c)] = 20;
    const before = new Float32Array(g.heights);
    limitSlope(g, win, { maxSlopeDeg: 35 });
    for (let c = 0; c <= g.cols; c++) {
      for (let r = 0; r <= g.rows; r++) {
        const inside = r >= 10 && r <= 30 && c >= 10 && c <= 30;
        const i = terrainIndex(g, r, c);
        if (!inside) expect(g.heights[i]).toBe(before[i]);
      }
    }
    assertCap(g);
  });

  it("never moves masked road cells and reports unsatisfiable constraints", () => {
    const g = flat();
    const mask = new Uint8Array(g.heights.length);
    // Road band: columns 10..14, held at height 3.
    for (let c = 10; c <= 14; c++) {
      for (let r = 0; r <= g.rows; r++) {
        const i = terrainIndex(g, r, c);
        g.heights[i] = 3;
        mask[i] = 1;
      }
    }
    g.heights[terrainIndex(g, 20, 12)] = 3; // road cell, fine
    g.heights[terrainIndex(g, 20, 15)] = 60; // spike next to the road
    const res = limitSlope(g, whole(g), { maxSlopeDeg: 35, mask });
    expect(res.roadViolations).toBe(0);
    for (let c = 10; c <= 14; c++) {
      for (let r = 0; r <= g.rows; r++) expect(g.heights[terrainIndex(g, r, c)]).toBe(3);
    }
    assertCap(g);

    // Two road cells 2 apart with a huge height difference: unsatisfiable.
    const g2 = flat(10);
    const m2 = new Uint8Array(g2.heights.length);
    const a = terrainIndex(g2, 5, 3);
    const b = terrainIndex(g2, 5, 5);
    g2.heights[a] = 0;
    g2.heights[b] = 40;
    m2[a] = 1;
    m2[b] = 1;
    const res2 = limitSlope(g2, whole(g2), { maxSlopeDeg: 35, mask: m2 });
    expect(res2.roadViolations).toBeGreaterThan(0);
    expect(g2.heights[a]).toBe(0);
    expect(g2.heights[b]).toBe(40);
  });

  it("maxSlopeDegIn reports the steepest axis slope", () => {
    const g = flat(10);
    for (let c = 0; c <= g.cols; c++)
      for (let r = 0; r <= g.rows; r++) g.heights[terrainIndex(g, r, c)] = c * D;
    expect(maxSlopeDegIn(g, whole(g))).toBeCloseTo(35, 2);
    expect(maxSlopeDegIn(flat(10), whole(g))).toBe(0);
  });

  it("expandWindow grows by ceil(delta / (tan*cell)) cells, clamped", () => {
    const g = flat();
    const w = expandWindow({ minRow: 20, minCol: 20, maxRow: 22, maxCol: 22 }, g, 10, 35);
    const n = Math.ceil(10 / D);
    expect(w).toEqual({ minRow: 20 - n, minCol: 20 - n, maxRow: 22 + n, maxCol: 22 + n });
    const edge = expandWindow({ minRow: 0, minCol: 0, maxRow: 1, maxCol: 1 }, g, 100, 35);
    expect(edge.minRow).toBe(0);
    expect(edge.minCol).toBe(0);
  });

  it("stays local and fast on a 667x667 grid", () => {
    const g = createTerrainGrid({ rows: 666, cols: 666, cellSizeM: 3, originX: 0, originZ: 0 });
    const centre = { minRow: 300, minCol: 300, maxRow: 319, maxCol: 319 };
    g.heights[terrainIndex(g, 310, 310)] = 30;
    const before = new Float32Array(g.heights);
    const win = expandWindow(centre, g, 30, 35);
    const t0 = performance.now();
    limitSlope(g, win, { maxSlopeDeg: 35 });
    expect(performance.now() - t0).toBeLessThan(50);
    for (let c = 0; c <= g.cols; c++) {
      if (c >= win.minCol && c <= win.maxCol) continue;
      const i = terrainIndex(g, 5, c);
      expect(g.heights[i]).toBe(before[i]);
    }
  });
});
