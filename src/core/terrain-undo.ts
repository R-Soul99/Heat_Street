/**
 * 50-deep stroke undo/redo for the terrain editor (phase 04.2, D-11).
 *
 * Each entry is a `StrokeDiff` holding only the cells a stroke changed, so
 * memory stays proportional to edits. The stack is never persisted: the editor
 * creates a fresh one on reload (D-11). Graph snapshots are re-parsed with
 * `parseRoadGraph` on restore so only valid graphs ever re-enter the area.
 *
 * Layering: pure core, no three/rapier/DOM.
 */
import { parseRoadGraph, type RoadGraph } from "./road-graph.ts";
import type { PaintRect, StrokeDiff } from "./terrain-brush.ts";
import type { TerrainGrid } from "./terrain-grid.ts";
import type { PaintMap } from "./terrain-paint.ts";
import type { CellWindow } from "./terrain-slope.ts";

export const UNDO_DEPTH = 50;

/** The mutable holder the editor owns; heights/paint arrays are written in place. */
export interface UndoTarget {
  grid: TerrainGrid;
  paint: PaintMap;
  graph: RoadGraph;
  nextEdgeId: number;
}

export interface ApplyResult {
  heightsWindow?: CellWindow;
  paintRect?: PaintRect;
  graphChanged: boolean;
}

export function applyStrokeDiff(
  area: UndoTarget,
  diff: StrokeDiff,
  side: "before" | "after",
): ApplyResult {
  const result: ApplyResult = { graphChanged: false };

  if (diff.heights) {
    const { indices } = diff.heights;
    const values = diff.heights[side];
    const stride = area.grid.rows + 1;
    let minRow = Number.POSITIVE_INFINITY;
    let maxRow = -1;
    let minCol = Number.POSITIVE_INFINITY;
    let maxCol = -1;
    for (let k = 0; k < indices.length; k++) {
      const i = indices[k];
      if (i >= area.grid.heights.length) continue;
      area.grid.heights[i] = values[k];
      const row = i % stride;
      const col = (i - row) / stride;
      if (row < minRow) minRow = row;
      if (row > maxRow) maxRow = row;
      if (col < minCol) minCol = col;
      if (col > maxCol) maxCol = col;
    }
    if (maxRow >= 0) result.heightsWindow = { minRow, minCol, maxRow, maxCol };
  }

  if (diff.paint) {
    const { indices } = diff.paint;
    const values = diff.paint[side];
    const w = area.paint.width;
    let minPx = Number.POSITIVE_INFINITY;
    let maxPx = -1;
    let minPz = Number.POSITIVE_INFINITY;
    let maxPz = -1;
    for (let k = 0; k < indices.length; k++) {
      const i = indices[k];
      if (i >= area.paint.data.length) continue;
      area.paint.data[i] = values[k];
      const px = i % w;
      const pz = (i - px) / w;
      if (px < minPx) minPx = px;
      if (px > maxPx) maxPx = px;
      if (pz < minPz) minPz = pz;
      if (pz > maxPz) maxPz = pz;
    }
    if (maxPx >= 0) result.paintRect = { minPx, minPz, maxPx, maxPz };
  }

  if (diff.graph) {
    area.graph = parseRoadGraph(diff.graph[side], "undo");
    area.nextEdgeId = side === "before" ? diff.graph.nextEdgeIdBefore : diff.graph.nextEdgeIdAfter;
    result.graphChanged = true;
  }
  return result;
}

export interface UndoStack {
  push(diff: StrokeDiff): void;
  undo(area: UndoTarget): ApplyResult | false;
  redo(area: UndoTarget): ApplyResult | false;
  canUndo(): boolean;
  canRedo(): boolean;
  clear(): void;
}

export function createUndoStack(depth: number = UNDO_DEPTH): UndoStack {
  const cap = Math.max(1, Math.floor(depth));
  let items: StrokeDiff[] = [];
  /** Number of applied entries; items[cursor..] are redoable. */
  let cursor = 0;
  return {
    push(diff) {
      items = items.slice(0, cursor);
      items.push(diff);
      if (items.length > cap) items = items.slice(items.length - cap);
      cursor = items.length;
    },
    undo(area) {
      if (cursor === 0) return false;
      const r = applyStrokeDiff(area, items[cursor - 1], "before");
      cursor--;
      return r;
    },
    redo(area) {
      if (cursor >= items.length) return false;
      const r = applyStrokeDiff(area, items[cursor], "after");
      cursor++;
      return r;
    },
    canUndo: () => cursor > 0,
    canRedo: () => cursor < items.length,
    clear() {
      items = [];
      cursor = 0;
    },
  };
}
