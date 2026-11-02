import { describe, expect, it } from "vitest";
import fixtureRaw from "../fixtures/road-graph.sample.json?raw";
import { parseRoadGraph } from "../src/core/road-graph.ts";
import { createStrokeRecorder, paintSurface, raiseLower } from "../src/core/terrain-brush.ts";
import { createTerrainGrid } from "../src/core/terrain-grid.ts";
import { createPaintMap } from "../src/core/terrain-paint.ts";
import {
  applyStrokeDiff,
  createUndoStack,
  UNDO_DEPTH,
  type UndoTarget,
} from "../src/core/terrain-undo.ts";

function makeArea(): UndoTarget {
  return {
    grid: createTerrainGrid({ rows: 60, cols: 60, cellSizeM: 3, originX: -90, originZ: -90 }),
    paint: createPaintMap({
      originX: -90,
      originZ: -90,
      widthM: 180,
      depthM: 180,
      metresPerPixel: 1,
      fill: "grass",
    }),
    graph: parseRoadGraph(fixtureRaw, "fixture"),
    nextEdgeId: 4,
  };
}

function dab(area: UndoTarget, k: number) {
  const rec = createStrokeRecorder(area.grid, area.paint);
  const p = {
    x: -60 + (k % 10) * 12,
    z: -60 + Math.floor(k / 10) * 12,
    radiusM: 8,
    strength: 1,
    falloff: "smooth" as const,
  };
  raiseLower(area.grid, p, 1, 0.5 + (k % 3) * 0.1, rec);
  paintSurface(area.paint, { ...p, radiusM: 4 }, "mud", {}, rec);
  const diff = rec.commit();
  if (!diff) throw new Error("expected a diff");
  return diff;
}

describe("undo stack", () => {
  it("is 50 deep", () => {
    expect(UNDO_DEPTH).toBe(50);
  });

  it("keeps the newest 50 of 60 strokes and restores stroke-10 state exactly", () => {
    const area = makeArea();
    const stack = createUndoStack();
    let after10: Float32Array | undefined;
    for (let k = 0; k < 60; k++) {
      stack.push(dab(area, k));
      if (k === 9) after10 = new Float32Array(area.grid.heights);
    }
    for (let k = 0; k < 50; k++) expect(stack.undo(area)).not.toBe(false);
    expect(stack.canUndo()).toBe(false);
    expect(stack.undo(area)).toBe(false);
    expect(Array.from(area.grid.heights)).toEqual(Array.from(after10 as Float32Array));
  });

  it("undo then redo restores heights, paint and graph exactly", () => {
    const area = makeArea();
    const stack = createUndoStack();
    const graphBefore = JSON.parse(fixtureRaw) as Record<string, unknown>;
    const graphAfter = { ...graphBefore, name: "edited" };
    const rec = createStrokeRecorder(area.grid, area.paint);
    raiseLower(area.grid, { x: 0, z: 0, radiusM: 12, strength: 1, falloff: "smooth" }, 1, 1, rec);
    paintSurface(
      area.paint,
      { x: 0, z: 0, radiusM: 5, strength: 1, falloff: "smooth" },
      "sand",
      {},
      rec,
    );
    rec.recordGraph(JSON.stringify(graphBefore), JSON.stringify(graphAfter), 4, 9);
    area.graph = parseRoadGraph(JSON.stringify(graphAfter), "t");
    area.nextEdgeId = 9;
    const diff = rec.commit();
    if (!diff) throw new Error("expected a diff");
    stack.push(diff);
    const h = new Float32Array(area.grid.heights);
    const p = new Uint8Array(area.paint.data);

    const original = makeArea();
    const u = stack.undo(area);
    expect(u).not.toBe(false);
    expect(Array.from(area.grid.heights)).toEqual(Array.from(original.grid.heights));
    expect(Array.from(area.paint.data)).toEqual(Array.from(original.paint.data));
    expect(area.graph.name).toBe(original.graph.name);
    expect(area.nextEdgeId).toBe(4);

    expect(stack.canRedo()).toBe(true);
    expect(stack.redo(area)).not.toBe(false);
    expect(Array.from(area.grid.heights)).toEqual(Array.from(h));
    expect(Array.from(area.paint.data)).toEqual(Array.from(p));
    expect(area.graph.name).toBe("edited");
    expect(area.nextEdgeId).toBe(9);
    expect(stack.canRedo()).toBe(false);
  });

  it("pushing after undo clears redo; clear() empties both", () => {
    const area = makeArea();
    const stack = createUndoStack();
    stack.push(dab(area, 1));
    stack.push(dab(area, 2));
    stack.undo(area);
    expect(stack.canRedo()).toBe(true);
    stack.push(dab(area, 3));
    expect(stack.canRedo()).toBe(false);
    expect(stack.redo(area)).toBe(false);
    stack.clear();
    expect(stack.canUndo()).toBe(false);
    expect(stack.canRedo()).toBe(false);
  });

  it("applyStrokeDiff returns the dirty height window and paint rect", () => {
    const area = makeArea();
    const diff = dab(area, 35);
    const r = applyStrokeDiff(area, diff, "before");
    expect(r.graphChanged).toBe(false);
    expect(r.heightsWindow).toBeDefined();
    expect(r.paintRect).toBeDefined();
    const w = r.heightsWindow as NonNullable<typeof r.heightsWindow>;
    expect(w.minRow).toBeLessThanOrEqual(w.maxRow);
    // dab 35 is centred at x=-60+5*12=0, z=-60+3*12=-24 -> vertex col 30, row 22.
    expect(w.minCol).toBeLessThanOrEqual(30);
    expect(w.maxCol).toBeGreaterThanOrEqual(30);
    expect(w.minRow).toBeLessThanOrEqual(22);
    expect(w.maxRow).toBeGreaterThanOrEqual(22);
    expect(area.grid.heights.every((v) => v === 0)).toBe(true);
  });

  it("rejects a corrupt graph snapshot instead of installing it", () => {
    const area = makeArea();
    const bad = {
      graph: { before: "{not json", after: "{}", nextEdgeIdBefore: 1, nextEdgeIdAfter: 2 },
    };
    expect(() => applyStrokeDiff(area, bad, "before")).toThrow();
    expect(area.graph.areaId).toBe("sample-square");
  });

  it("memory is bounded by the ring", () => {
    const area = makeArea();
    const stack = createUndoStack(3);
    for (let k = 0; k < 10; k++) stack.push(dab(area, k));
    let n = 0;
    while (stack.undo(area) !== false) n++;
    expect(n).toBe(3);
  });
});
