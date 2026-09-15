import { describe, expect, it } from "vitest";
import {
  type SampleableHeightfield,
  sampleHeightfieldBilinear,
} from "../src/core/heightfield-sample";

/** A 3x3-sample (2x2-cell) grid spanning [0,20]x[0,20], heights `row + col * (rows+1)` per cell so each corner is uniquely identifiable. */
function makeGrid(): SampleableHeightfield {
  const rows = 2;
  const cols = 2;
  // heights[row + col * (rows+1)] -- storage order verified in heightfield.ts.
  const heights = new Array<number>((rows + 1) * (cols + 1));
  const value = (row: number, col: number): number => row * 10 + col; // distinct per corner
  for (let row = 0; row <= rows; row++) {
    for (let col = 0; col <= cols; col++) {
      heights[row + col * (rows + 1)] = value(row, col);
    }
  }
  return { rows, cols, heights, originX: 0, originZ: 0, scaleX: 20, scaleZ: 20 };
}

describe("sampleHeightfieldBilinear", () => {
  it("returns the exact stored value at every grid corner", () => {
    const grid = makeGrid();
    // col 0/1/2 -> x 0/10/20; row 0/1/2 -> z 0/10/20 (10 units per cell, 2 cells over 20).
    expect(sampleHeightfieldBilinear(grid, 0, 0)).toBeCloseTo(0, 9); // row0,col0
    expect(sampleHeightfieldBilinear(grid, 20, 0)).toBeCloseTo(2, 9); // row0,col2
    expect(sampleHeightfieldBilinear(grid, 0, 20)).toBeCloseTo(20, 9); // row2,col0
    expect(sampleHeightfieldBilinear(grid, 20, 20)).toBeCloseTo(22, 9); // row2,col2
  });

  it("interpolates linearly along a single axis at a cell edge midpoint", () => {
    const grid = makeGrid();
    // Midpoint between (row0,col0)=0 and (row0,col1)=1 along X at z=0.
    expect(sampleHeightfieldBilinear(grid, 5, 0)).toBeCloseTo(0.5, 9);
    // Midpoint between (row0,col0)=0 and (row1,col0)=10 along Z at x=0.
    expect(sampleHeightfieldBilinear(grid, 0, 5)).toBeCloseTo(5, 9);
  });

  it("bilinearly interpolates a point that is not on any grid line", () => {
    const grid = makeGrid();
    // x=15 -> colF=1.5 (between col1=1 and col2=2); z=5 -> rowF=0.5 (between row0=0 and row1=1).
    // Corners: (row0,col1)=1, (row0,col2)=2, (row1,col1)=11, (row1,col2)=12.
    // Top edge (row0) lerp at tCol=0.5: 1.5. Bottom edge (row1) lerp: 11.5.
    // Final lerp at tRow=0.5: 6.5.
    expect(sampleHeightfieldBilinear(grid, 15, 5)).toBeCloseTo(6.5, 9);
  });

  it("returns the exact stored value at the grid's centre sample node", () => {
    const grid = makeGrid();
    // x=10,z=10 lands exactly on (row1,col1) -- not an interpolation, since it
    // is a genuine grid vertex, not a centroid of the four outer corners.
    expect(sampleHeightfieldBilinear(grid, 10, 10)).toBeCloseTo(11, 9);
  });

  it("clamps out-of-bounds queries to the nearest edge rather than extrapolating or throwing", () => {
    const grid = makeGrid();
    expect(sampleHeightfieldBilinear(grid, -100, -100)).toBeCloseTo(0, 9);
    expect(sampleHeightfieldBilinear(grid, 1000, 1000)).toBeCloseTo(22, 9);
  });
});
