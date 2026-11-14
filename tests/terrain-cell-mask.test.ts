import { describe, expect, it } from "vitest";
import { cellBoxFromWindow, createCellMask } from "../src/core/terrain-cell-mask.ts";
import { createTerrainGrid } from "../src/core/terrain-grid.ts";

const grid = () =>
  createTerrainGrid({ rows: 10, cols: 10, cellSizeM: 2, originX: 0, originZ: 0, fill: 0 });
const box = (minRow: number, minCol: number, maxRow: number, maxCol: number) => ({
  minRow,
  minCol,
  maxRow,
  maxCol,
});

describe("CellMask", () => {
  it("1x1 box: one cell, four vertices, 2x2 vertex bounds", () => {
    const g = grid();
    const m = createCellMask(10, 10);
    m.apply(box(2, 3, 3, 4), "replace");
    expect(m.cellCount()).toBe(1);
    expect(m.vertexMask(g).reduce((a, b) => a + b, 0)).toBe(4);
    expect(m.bounds()).toEqual({ minRow: 2, minCol: 3, maxRow: 3, maxCol: 4 });
  });

  it("add unions disjoint and counts overlap once", () => {
    const m = createCellMask(10, 10);
    m.apply(box(0, 0, 2, 2), "replace");
    m.apply(box(5, 5, 7, 7), "add");
    expect(m.cellCount()).toBe(8);
    m.apply(box(1, 1, 3, 3), "add");
    expect(m.cellCount()).toBe(8 + 3);
  });

  it("subtract creates a hole with its own boundary", () => {
    const g = grid();
    const m = createCellMask(10, 10);
    m.apply(box(0, 0, 5, 5), "replace");
    m.apply(box(2, 2, 3, 3), "subtract");
    expect(m.cellCount()).toBe(24);
    expect(m.has(2, 2)).toBe(false);
    // outer perimeter 20 + hole 4
    expect(m.boundarySegments(g, 0).length).toBe(24 * 6);
  });

  it("L-shape outline has perimeter-many cell edges", () => {
    const g = grid();
    const m = createCellMask(10, 10);
    m.apply(box(0, 0, 3, 1), "replace");
    m.apply(box(2, 1, 3, 3), "add");
    // L: 3 tall x 1 wide plus 2 wide foot; perimeter = 2*(3+3) = 12
    expect(m.boundarySegments(g, 0).length).toBe(12 * 6);
  });

  it("cellAtXZ handles inside, outside, off-grid, NaN", () => {
    const g = grid();
    const m = createCellMask(10, 10);
    m.apply(box(1, 1, 3, 3), "replace");
    expect(m.cellAtXZ(g, 3, 3)).toBe(true);
    expect(m.cellAtXZ(g, 15, 15)).toBe(false);
    expect(m.cellAtXZ(g, -5, 3)).toBe(false);
    expect(m.cellAtXZ(g, 500, 3)).toBe(false);
    expect(m.cellAtXZ(g, Number.NaN, 3)).toBe(false);
  });

  it("empties on subtract-all and clear; bounds null", () => {
    const m = createCellMask(10, 10);
    m.apply(box(0, 0, 4, 4), "replace");
    m.apply(box(0, 0, 10, 10), "subtract");
    expect(m.isEmpty()).toBe(true);
    expect(m.bounds()).toBeNull();
    m.apply(box(0, 0, 2, 2), "add");
    m.clear();
    expect(m.isEmpty()).toBe(true);
  });

  it("clips to the grid and ignores off-grid or non-finite boxes", () => {
    const m = createCellMask(10, 10);
    m.apply(box(8, 8, 20, 20), "replace");
    expect(m.cellCount()).toBe(4);
    m.apply(box(30, 30, 40, 40), "add");
    expect(m.cellCount()).toBe(4);
    m.apply(box(Number.NaN, 0, 2, 2), "add");
    expect(m.cellCount()).toBe(4);
  });

  it("clone is independent", () => {
    const m = createCellMask(10, 10);
    m.apply(box(0, 0, 2, 2), "replace");
    const c = m.clone();
    c.clear();
    expect(m.cellCount()).toBe(4);
    expect(c.cellCount()).toBe(0);
  });

  it("fillTriangles for 3 cells is 54 numbers", () => {
    const g = grid();
    const m = createCellMask(10, 10);
    m.apply(box(0, 0, 2, 1), "replace");
    m.apply(box(1, 1, 2, 2), "add");
    expect(m.fillTriangles(g, 0.1).length).toBe(54);
  });

  it("cellBoxFromWindow maps vertex window to cell box", () => {
    expect(cellBoxFromWindow({ minRow: 1, minCol: 2, maxRow: 4, maxCol: 6 })).toEqual(
      box(1, 2, 4, 6),
    );
  });
});
