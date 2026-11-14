/**
 * Selection mask for the terrain editor (07.1.2 D-04/D-06): a union of
 * rectangles minus rectangles, stored as one byte per terrain cell.
 *
 * Boxes are in CELL indices, half-open [min, max). The dispatcher's inclusive
 * vertex window converts once via cellBoxFromWindow.
 *
 * Layering: pure core, no three/rapier/DOM.
 */
import type { TerrainGrid } from "./terrain-grid.ts";
import type { CellWindow } from "./terrain-slope.ts";

export interface CellBox {
  minRow: number;
  minCol: number;
  maxRow: number;
  maxCol: number;
}

export type MaskOp = "replace" | "add" | "subtract";

export interface CellMask {
  readonly rows: number;
  readonly cols: number;
  /** One byte per cell, index r + c * rows. */
  readonly data: Uint8Array;
  apply(box: CellBox, op: MaskOp): void;
  clear(): void;
  isEmpty(): boolean;
  cellCount(): number;
  has(row: number, col: number): boolean;
  clone(): CellMask;
  /** Vertex window enclosing all selected cells, or null when empty. */
  bounds(): CellWindow | null;
  /** Set for every corner of a selected cell; index r + c * (grid.rows + 1). */
  vertexMask(grid: TerrainGrid): Uint8Array;
  cellAtXZ(grid: TerrainGrid, x: number, z: number): boolean;
  /** Edges between selected and unselected (or off-grid) cells, flat xyz pairs. */
  boundarySegments(grid: TerrainGrid, lift: number): Float32Array;
  /** Two triangles per selected cell, flat xyz. */
  fillTriangles(grid: TerrainGrid, lift: number): Float32Array;
}

/** Convert the dispatcher's inclusive vertex window to a half-open cell box. */
export function cellBoxFromWindow(win: CellWindow): CellBox {
  return {
    minRow: win.minRow,
    minCol: win.minCol,
    maxRow: win.maxRow,
    maxCol: win.maxCol,
  };
}

export function createCellMask(rows: number, cols: number): CellMask {
  const data = new Uint8Array(Math.max(0, rows * cols));
  return build(rows, cols, data);
}

function build(rows: number, cols: number, data: Uint8Array): CellMask {
  const has = (r: number, c: number): boolean =>
    r >= 0 && c >= 0 && r < rows && c < cols && data[r + c * rows] === 1;

  const mask: CellMask = {
    rows,
    cols,
    data,
    apply(box, op) {
      const vals = [box.minRow, box.minCol, box.maxRow, box.maxCol];
      if (!vals.every(Number.isFinite)) return;
      const r0 = Math.max(0, Math.floor(box.minRow));
      const c0 = Math.max(0, Math.floor(box.minCol));
      const r1 = Math.min(rows, Math.ceil(box.maxRow));
      const c1 = Math.min(cols, Math.ceil(box.maxCol));
      if (r0 >= r1 || c0 >= c1) return;
      if (op === "replace") data.fill(0);
      const v = op === "subtract" ? 0 : 1;
      for (let c = c0; c < c1; c++) {
        for (let r = r0; r < r1; r++) data[r + c * rows] = v;
      }
    },
    clear() {
      data.fill(0);
    },
    isEmpty() {
      return mask.cellCount() === 0;
    },
    cellCount() {
      let n = 0;
      for (let i = 0; i < data.length; i++) n += data[i];
      return n;
    },
    has,
    clone() {
      return build(rows, cols, data.slice());
    },
    bounds() {
      let minRow = Number.POSITIVE_INFINITY;
      let minCol = Number.POSITIVE_INFINITY;
      let maxRow = -1;
      let maxCol = -1;
      for (let c = 0; c < cols; c++) {
        for (let r = 0; r < rows; r++) {
          if (data[r + c * rows] !== 1) continue;
          if (r < minRow) minRow = r;
          if (c < minCol) minCol = c;
          if (r > maxRow) maxRow = r;
          if (c > maxCol) maxCol = c;
        }
      }
      if (maxRow < 0) return null;
      return { minRow, minCol, maxRow: maxRow + 1, maxCol: maxCol + 1 };
    },
    vertexMask(grid) {
      const out = new Uint8Array(grid.heights.length);
      const stride = grid.rows + 1;
      for (let c = 0; c < cols; c++) {
        for (let r = 0; r < rows; r++) {
          if (data[r + c * rows] !== 1) continue;
          out[r + c * stride] = 1;
          out[r + 1 + c * stride] = 1;
          out[r + (c + 1) * stride] = 1;
          out[r + 1 + (c + 1) * stride] = 1;
        }
      }
      return out;
    },
    cellAtXZ(grid, x, z) {
      if (!Number.isFinite(x) || !Number.isFinite(z) || !(grid.cellSizeM > 0)) return false;
      const col = Math.floor((x - grid.originX) / grid.cellSizeM);
      const row = Math.floor((z - grid.originZ) / grid.cellSizeM);
      return has(row, col);
    },
    boundarySegments(grid, lift) {
      const stride = grid.rows + 1;
      const out: number[] = [];
      const put = (r: number, c: number): void => {
        out.push(
          grid.originX + c * grid.cellSizeM,
          grid.heights[r + c * stride] + lift,
          grid.originZ + r * grid.cellSizeM,
        );
      };
      for (let c = 0; c < cols; c++) {
        for (let r = 0; r < rows; r++) {
          if (data[r + c * rows] !== 1) continue;
          if (!has(r - 1, c)) {
            put(r, c);
            put(r, c + 1);
          }
          if (!has(r + 1, c)) {
            put(r + 1, c);
            put(r + 1, c + 1);
          }
          if (!has(r, c - 1)) {
            put(r, c);
            put(r + 1, c);
          }
          if (!has(r, c + 1)) {
            put(r, c + 1);
            put(r + 1, c + 1);
          }
        }
      }
      return Float32Array.from(out);
    },
    fillTriangles(grid, lift) {
      const stride = grid.rows + 1;
      const out: number[] = [];
      const put = (r: number, c: number): void => {
        out.push(
          grid.originX + c * grid.cellSizeM,
          grid.heights[r + c * stride] + lift,
          grid.originZ + r * grid.cellSizeM,
        );
      };
      for (let c = 0; c < cols; c++) {
        for (let r = 0; r < rows; r++) {
          if (data[r + c * rows] !== 1) continue;
          put(r, c);
          put(r + 1, c);
          put(r, c + 1);
          put(r, c + 1);
          put(r + 1, c);
          put(r + 1, c + 1);
        }
      }
      return Float32Array.from(out);
    },
  };
  return mask;
}
