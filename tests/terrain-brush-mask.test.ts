// 07.1.2-04: mask-aware height ops (D-08/D-09/D-10/D-24/D-28).
import { describe, expect, it } from "vitest";
import {
  createStrokeRecorder,
  flattenMaskToAverage,
  maskAverageHeight,
  setMaskFromBase,
  smoothRegion,
  snapshotWindow,
} from "../src/core/terrain-brush.ts";
import { createCellMask } from "../src/core/terrain-cell-mask.ts";
import { createTerrainGrid, terrainIndex } from "../src/core/terrain-grid.ts";

function grid(cell = 2) {
  return createTerrainGrid({ rows: 20, cols: 20, cellSizeM: cell, originX: 0, originZ: 0 });
}
const emptyPaint = { width: 1, height: 1, data: new Uint8Array(1) } as never;
const h = (g: ReturnType<typeof grid>, r: number, c: number) => g.heights[terrainIndex(g, r, c)];

/** L-shape: rows 4..8 x cols 4..6 plus rows 4..6 x cols 6..9 (half-open cell boxes). */
function lMask(g: ReturnType<typeof grid>) {
  const m = createCellMask(g.rows, g.cols);
  m.apply({ minRow: 4, minCol: 4, maxRow: 8, maxCol: 6 }, "add");
  m.apply({ minRow: 4, minCol: 6, maxRow: 6, maxCol: 9 }, "add");
  return m;
}

describe("setMaskFromBase", () => {
  it("raises exactly the selected vertices by the hard step", () => {
    const g = grid();
    const m = lMask(g);
    const sel = m.vertexMask(g);
    const b = m.bounds();
    if (!b) throw new Error("empty");
    const r = setMaskFromBase(g, m, snapshotWindow(g, b), b, 0.5);
    expect(r.window).toBeDefined();
    for (let i = 0; i < sel.length; i++) {
      expect(g.heights[i]).toBeCloseTo(sel[i] ? 0.5 : 0, 5);
    }
  });

  it("leaves the vertices just outside the selection at 0 (no falloff)", () => {
    const g = grid();
    const m = lMask(g);
    const b = m.bounds();
    if (!b) throw new Error("empty");
    setMaskFromBase(g, m, snapshotWindow(g, b), b, 0.5);
    expect(h(g, 3, 3)).toBe(0);
    expect(h(g, 9, 7)).toBe(0);
  });

  it("clamps an over-steep step and reports slopeClamped (D-24)", () => {
    const g = grid(1);
    const m = createCellMask(g.rows, g.cols);
    m.apply({ minRow: 5, minCol: 5, maxRow: 8, maxCol: 8 }, "add");
    const b = m.bounds();
    if (!b) throw new Error("empty");
    const r = setMaskFromBase(g, m, snapshotWindow(g, b), b, 5);
    expect(r.slopeClamped).toBe(true);
  });

  it("does not move road-held vertices", () => {
    const g = grid();
    const m = lMask(g);
    const b = m.bounds();
    if (!b) throw new Error("empty");
    const held = terrainIndex(g, 5, 5);
    setMaskFromBase(g, m, snapshotWindow(g, b), b, 0.5, undefined, {
      roadMask: () => {
        const r = new Uint8Array(g.heights.length);
        r[held] = 1;
        return r;
      },
    });
    expect(g.heights[held]).toBe(0);
    expect(h(g, 5, 6)).toBeCloseTo(0.5, 5);
  });

  it("repeated growing deltas from one base end at the final delta in one diff", () => {
    const g = grid();
    const m = lMask(g);
    const b = m.bounds();
    if (!b) throw new Error("empty");
    const base = snapshotWindow(g, b);
    const rec = createStrokeRecorder(g, emptyPaint);
    for (const d of [0.5, 1, 1.5]) setMaskFromBase(g, m, base, b, d, rec);
    expect(h(g, 5, 5)).toBeCloseTo(1.5, 5);
    expect(rec.commit()?.heights).toBeDefined();
    expect(rec.commit()?.heights).toBeUndefined();
  });

  it("is a no-op for non-finite delta, empty mask or base mismatch", () => {
    const g = grid();
    const m = lMask(g);
    const b = m.bounds();
    if (!b) throw new Error("empty");
    const base = snapshotWindow(g, b);
    expect(setMaskFromBase(g, m, base, b, Number.NaN).window).toBeUndefined();
    expect(setMaskFromBase(g, createCellMask(20, 20), base, b, 1).window).toBeUndefined();
    expect(setMaskFromBase(g, m, new Float32Array(3), b, 1).window).toBeUndefined();
    expect(g.heights.every((v) => v === 0)).toBe(true);
  });
});

describe("flatten to average", () => {
  it("maskAverageHeight includes every selected vertex and is null when empty", () => {
    const g = grid();
    const m = createCellMask(g.rows, g.cols);
    expect(maskAverageHeight(g, m)).toBeNull();
    m.apply({ minRow: 2, minCol: 2, maxRow: 3, maxCol: 3 }, "add");
    g.heights[terrainIndex(g, 2, 2)] = 4;
    expect(maskAverageHeight(g, m)).toBeCloseTo(1, 5);
  });

  it("levels selected un-held vertices to the average, held stay put (D-28)", () => {
    const g = grid();
    const m = createCellMask(g.rows, g.cols);
    m.apply({ minRow: 2, minCol: 2, maxRow: 3, maxCol: 3 }, "add");
    const held = terrainIndex(g, 2, 2);
    g.heights[held] = 0.4;
    g.heights[terrainIndex(g, 3, 3)] = 0.4;
    const r = flattenMaskToAverage(g, m, undefined, {
      roadMask: () => {
        const x = new Uint8Array(g.heights.length);
        x[held] = 1;
        return x;
      },
    });
    expect(r.targetM).toBeCloseTo(0.2, 5);
    expect(g.heights[held]).toBeCloseTo(0.4, 5);
    expect(h(g, 2, 3)).toBeCloseTo(0.2, 5);
    expect(h(g, 3, 3)).toBeCloseTo(0.2, 5);
  });

  it("empty mask is a no-op", () => {
    const g = grid();
    expect(flattenMaskToAverage(g, createCellMask(20, 20)).window).toBeUndefined();
  });
});

describe("smoothRegion selected", () => {
  it("changes only selected vertices in one pass", () => {
    const g = grid();
    const m = createCellMask(g.rows, g.cols);
    m.apply({ minRow: 5, minCol: 5, maxRow: 8, maxCol: 8 }, "add");
    g.heights[terrainIndex(g, 6, 6)] = 0.8;
    g.heights[terrainIndex(g, 2, 2)] = 0.8;
    const before = g.heights.slice();
    const sel = m.vertexMask(g);
    const b = m.bounds();
    if (!b) throw new Error("empty");
    const r = smoothRegion(g, b, { strength: 1, passes: 1, selected: sel });
    expect(r.window).toBeDefined();
    expect(h(g, 6, 6)).toBeLessThan(0.8);
    for (let i = 0; i < sel.length; i++) {
      if (!sel[i]) expect(g.heights[i]).toBe(before[i]);
    }
  });
});
