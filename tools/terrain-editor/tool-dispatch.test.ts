import { describe, expect, it } from "vitest";
import { buildRoadGeometry } from "../../src/core/road-geometry.ts";
import type { RoadGraph, RoadGraphEdge } from "../../src/core/road-graph.ts";
import { sampleTerrainHeight } from "../../src/core/terrain-grid.ts";
import { MAX_SLOPE_DEG } from "../../src/core/terrain-limits.ts";
import { PAINT_ROAD_FLAG, surfaceAt } from "../../src/core/terrain-paint.ts";
import { roadVertexMask } from "../../src/core/terrain-road.ts";
import type { CellWindow } from "../../src/core/terrain-slope.ts";
import { validateGraph } from "../map-compiler/validate/validator.ts";
import { createEmptyTerrainArea } from "./new-area.ts";
import { createToolDispatcher, type EditArea, slopeClampHint } from "./tool-dispatch.ts";

type P = [number, number, number];

function setup() {
  const area = {
    ...createEmptyTerrainArea({ areaId: "t", widthM: 240, depthM: 240, cellSizeM: 3 }),
  };
  const d = createToolDispatcher(() => area as unknown as EditArea);
  return { area: area as unknown as EditArea, d };
}

function drag(d: ReturnType<typeof setup>["d"], pts: [number, number][]) {
  d.pointerDown(pts[0][0], pts[0][1], {});
  for (let i = 1; i < pts.length; i++) d.pointerMove(pts[i][0], pts[i][1], {});
  const last = pts[pts.length - 1];
  return d.pointerUp(last[0], last[1]);
}

/** Raises a (2 * halfM) square of cells by stepM through a Select-mode selection. */
function raiseBox(
  d: ReturnType<typeof setup>["d"],
  x: number,
  z: number,
  halfM: number,
  stepM: number,
) {
  d.setMode("select");
  d.pointerDown(x - halfM, z - halfM, {});
  d.pointerUp(x + halfM, z + halfM);
  d.setOptions({ selectStepM: stepM });
  d.applyOperation("raise");
  d.clearSelection();
}

describe("sculpt tools", () => {
  it("raise stroke is one undo entry and raises terrain", () => {
    const { area, d } = setup();
    d.setTool("raise");
    const down = d.pointerDown(0, 0, {});
    expect(down.dirtyHeights).toBeDefined();
    d.pointerMove(8, 0, {});
    d.pointerMove(16, 0, {});
    d.pointerMove(24, 0, {});
    d.pointerUp(24, 0);
    expect(sampleTerrainHeight(area.grid, 10, 0)).toBeGreaterThan(0);
    expect(d.canUndo()).toBe(true);
    d.undo();
    expect(d.canUndo()).toBe(false);
    expect(sampleTerrainHeight(area.grid, 10, 0)).toBe(0);
  });

  it("lower stroke lowers; modifiers change nothing", () => {
    const { area, d } = setup();
    d.setTool("lower");
    d.pointerDown(0, 0, { shift: true, ctrl: true });
    d.pointerMove(10, 0, { shift: true });
    d.pointerUp(10, 0);
    expect(sampleTerrainHeight(area.grid, 5, 0)).toBeLessThan(0);
  });

  it("raise and lower move by the same amount and report the delta", () => {
    const a = setup();
    a.d.setTool("raise");
    const up = a.d.pointerDown(0, 0, {});
    a.d.pointerUp(0, 0);
    const b = setup();
    b.d.setTool("lower");
    const down = b.d.pointerDown(0, 0, {});
    b.d.pointerUp(0, 0);
    expect(up.heightDeltaM).toBeGreaterThan(0.5);
    expect(down.heightDeltaM).toBeCloseTo(-(up.heightDeltaM as number), 5);
    expect(up.heldVertices).toBe(0);
  });

  it("default strength is 1", () => {
    const { d } = setup();
    expect(d.getOptions().strength).toBe(1);
  });

  it("undo then redo round trips; new stroke clears redo", () => {
    const { area, d } = setup();
    d.setTool("raise");
    drag(d, [
      [0, 0],
      [10, 0],
    ]);
    const h = sampleTerrainHeight(area.grid, 5, 0);
    d.undo();
    expect(d.canRedo()).toBe(true);
    const r = d.redo();
    expect(r).not.toBe(false);
    expect(sampleTerrainHeight(area.grid, 5, 0)).toBeCloseTo(h, 6);
    d.undo();
    drag(d, [
      [40, 40],
      [50, 40],
    ]);
    expect(d.canRedo()).toBe(false);
  });

  it("flatten levels toward the height under the pointer-down", () => {
    const { area, d } = setup();
    d.setTool("raise");
    drag(d, [
      [0, 0],
      [6, 0],
    ]);
    const hill = sampleTerrainHeight(area.grid, 0, 0);
    expect(hill).toBeGreaterThan(0);
    d.setTool("flatten");
    d.setOptions({ strength: 1 });
    drag(d, [
      [60, 60],
      [30, 0],
      [0, 0],
    ]);
    // target was the flat height at (60,60) = 0, so the hill is lowered
    expect(sampleTerrainHeight(area.grid, 0, 0)).toBeLessThan(hill);
  });

  it("paint writes the surface without a road flag and no graph edges", () => {
    const { area, d } = setup();
    d.setTool("paint");
    d.setOptions({ surface: "mud" });
    const r = drag(d, [
      [0, 0],
      [10, 0],
    ]);
    expect(surfaceAt(area.paint, 5, 0)).toBe("mud");
    expect(area.paint.data.some((v) => (v & PAINT_ROAD_FLAG) !== 0)).toBe(false);
    expect(area.graph.edges).toHaveLength(0);
    expect(r.graphChanged).toBe(false);
    expect(d.canUndo()).toBe(true);
  });

  it("ignores non-finite pointer coordinates", () => {
    const { d } = setup();
    d.setTool("raise");
    const r = d.pointerDown(Number.NaN, 0, {});
    expect(r.dirtyHeights).toBeUndefined();
    d.pointerMove(Number.POSITIVE_INFINITY, 0);
    d.pointerUp(0, 0);
    expect(d.canUndo()).toBe(false);
  });

  it("spaces dabs at radius/4 along the drag", () => {
    const { area, d } = setup();
    d.setTool("raise");
    d.setOptions({ radiusM: 8, strength: 0.2 });
    d.pointerDown(-40, 0, {});
    d.pointerMove(40, 0, {});
    d.pointerUp(40, 0);
    // a long drag raises terrain along its whole length
    expect(sampleTerrainHeight(area.grid, 0, 0)).toBeGreaterThan(0);
    expect(sampleTerrainHeight(area.grid, 30, 0)).toBeGreaterThan(0);
  });
});

describe("road and erase", () => {
  it("road moves only preview; up paints, adds edges, and undo restores exactly", () => {
    const { area, d } = setup();
    d.setTool("road");
    d.setOptions({ roadPreset: "street" });
    const before = Float32Array.from(area.grid.heights);
    const paintBefore = Uint8Array.from(area.paint.data);
    const down = d.pointerDown(-60, 0, {});
    expect(down.previewPoints).toHaveLength(1);
    const mv = d.pointerMove(-20, 0, {});
    expect(mv.previewPoints?.length).toBe(2);
    expect(area.graph.edges).toHaveLength(0);
    expect(area.paint.data).toEqual(paintBefore);
    const up = d.pointerUp(60, 0);
    expect(up.graphChanged).toBe(true);
    expect(area.graph.edges.length).toBeGreaterThan(0);
    expect(area.paint.data.some((v) => (v & PAINT_ROAD_FLAG) !== 0)).toBe(true);
    expect(d.canUndo()).toBe(true);
    d.undo();
    expect(area.graph.edges).toHaveLength(0);
    expect(area.paint.data).toEqual(paintBefore);
    expect(Array.from(area.grid.heights)).toEqual(Array.from(before));
    expect(d.canUndo()).toBe(false);
  });

  it("WR-02: sculpting beside a road never lets the slope limiter move road vertices", () => {
    const { area, d } = setup();
    d.setTool("road");
    d.setOptions({ roadPreset: "street" });
    drag(d, [
      [-60, 0],
      [60, 0],
    ]);
    const road = roadVertexMask(area.grid, area.paint, area.graph, {
      minRow: 0,
      minCol: 0,
      maxRow: area.grid.rows,
      maxCol: area.grid.cols,
    });
    // A steep cut on both sides of the road (converted-map style): the cheapest
    // limiter fix for any nearby dab is to raise the road out of its cutting.
    for (let i = 0; i < road.length; i++) if (!road[i]) area.grid.heights[i] = 10;
    const before = Float32Array.from(area.grid.heights);
    d.setTool("raise");
    d.setOptions({ radiusM: 4, strength: 0.5 });
    for (const x of [-30, -10, 10, 30]) {
      drag(d, [
        [x, 9],
        [x + 3, 9],
      ]);
    }
    let moved = 0;
    for (let i = 0; i < road.length; i++)
      if (road[i] && area.grid.heights[i] !== before[i]) moved++;
    expect(moved).toBe(0);
    for (const e of area.graph.edges) {
      for (const [x, y, z] of e.points) {
        expect(Math.abs(sampleTerrainHeight(area.grid, x, z) - y)).toBeLessThan(1e-6);
      }
    }
  });

  it("erase cuts the road, drags merge into one undo step", () => {
    const { area, d } = setup();
    d.setTool("road");
    drag(d, [
      [-60, 0],
      [0, 0],
      [60, 0],
    ]);
    const graphBefore = JSON.stringify(area.graph);
    d.setTool("erase");
    d.setOptions({ radiusM: 10 });
    drag(d, [
      [-5, 0],
      [5, 0],
    ]);
    expect(JSON.stringify(area.graph)).not.toBe(graphBefore);
    d.undo(); // erase stroke
    expect(JSON.stringify(area.graph)).toBe(graphBefore);
    expect(d.canUndo()).toBe(true); // the road stroke remains
  });

  it("erase down reports the status text when an edge was removed", () => {
    const { d } = setup();
    d.setTool("road");
    drag(d, [
      [-60, 0],
      [60, 0],
    ]);
    d.setTool("erase");
    d.setOptions({ radiusM: 10 });
    const r = d.pointerDown(0, 0, {});
    expect(r.status).toBe("Road erased. Ctrl+Z to undo.");
    d.pointerUp(0, 0);
    d.undo();
  });
});

describe("history", () => {
  it("keeps 50 entries and clearHistory empties", () => {
    const { d } = setup();
    d.setTool("raise");
    for (let i = 0; i < 55; i++)
      drag(d, [
        [-80 + i, 50],
        [-79 + i, 50],
      ]);
    let n = 0;
    while (d.canUndo()) {
      d.undo();
      n++;
    }
    expect(n).toBe(50);
    d.clearHistory();
    expect(d.canRedo()).toBe(false);
  });
});

describe("smooth options and drags (04.3-07)", () => {
  it("has smooth defaults and clamps setOptions", () => {
    const { d } = setup();
    expect(d.getOptions()).toMatchObject({ smoothStrength: 0.5, smoothPasses: 3 });
    d.setOptions({ smoothStrength: 5, smoothPasses: 99 });
    expect(d.getOptions()).toMatchObject({ smoothStrength: 1, smoothPasses: 10 });
    d.setOptions({ smoothPasses: Number.NaN });
    expect(d.getOptions()).toMatchObject({ smoothPasses: 10 });
  });

  it("cancelSelectDrag abandons a selection drag and leaves the selection untouched", () => {
    const { d } = setup();
    d.setMode("select");
    d.pointerDown(0, 0, {});
    d.pointerMove(20, 20);
    expect(d.cancelSelectDrag()).toBe(true);
    expect(d.isStroking()).toBe(false);
    expect(d.selectionCellCount()).toBe(0);
    expect(d.cancelSelectDrag()).toBe(false);
  });

  it("smoothAll is one undo entry", () => {
    const { area, d } = setup();
    raiseBox(d, 0, 0, 3, 3);
    const afterBlock = Float32Array.from(area.grid.heights);
    const peak = Math.max(...afterBlock);
    const r = d.smoothAll();
    expect(r.dirtyHeights).toBeDefined();
    expect(Math.max(...area.grid.heights)).toBeLessThan(peak);
    d.undo();
    expect(Array.from(area.grid.heights)).toEqual(Array.from(afterBlock));
    d.undo();
    expect(d.canUndo()).toBe(false);
  });

  it("smoothAll never moves road vertices", () => {
    const { area, d } = setup();
    raiseBox(d, 30, 30, 3, 3);
    d.setTool("road");
    drag(d, [
      [0, 0],
      [40, 0],
      [80, 0],
    ]);
    const mask = roadVertexMask(area.grid, area.paint, area.graph, {
      minRow: 0,
      minCol: 0,
      maxRow: area.grid.rows,
      maxCol: area.grid.cols,
    });
    const before = Float32Array.from(area.grid.heights);
    d.smoothAll();
    for (let i = 0; i < mask.length; i++) if (mask[i]) expect(area.grid.heights[i]).toBe(before[i]);
  });
});

describe("road lock (quick 261110-rdx)", () => {
  /** Area 240 m, cell 3: one street along z = 0. Returns the edge id. */
  function withRoad() {
    const s = setup();
    s.d.setTool("road");
    drag(s.d, [
      [-80, 0],
      [-40, 0],
      [0, 0],
      [40, 0],
      [80, 0],
    ]);
    expect(s.area.graph.edges.length).toBeGreaterThan(0);
    s.d.clearHistory();
    return { ...s, id: s.area.graph.edges[0].id };
  }

  function raiseUnder(d: ReturnType<typeof setup>["d"], x: number, z: number) {
    raiseBox(d, x, z, 12, 4);
  }

  it("unlock all then undo restores the previous list", () => {
    const { area, d, id } = withRoad();
    const r = d.lockAll(false);
    expect(r.lockChanged).toBe(true);
    expect(area.unlockedEdgeIds).toEqual([id]);
    d.undo();
    expect(area.unlockedEdgeIds ?? []).toEqual([]);
    expect(d.lockAll(true).status).toBe("No unlocked roads.");
  });

  it("sculpting moves terrain under an unlocked road but not under a locked one", () => {
    const { area, d, id } = withRoad();
    const at = () => sampleTerrainHeight(area.grid, 0, 0);
    const h0 = at();
    raiseUnder(d, 0, 0);
    expect(at()).toBe(h0);
    d.lockAll(false);
    expect(area.unlockedEdgeIds).toEqual([id]);
    raiseUnder(d, 0, 0);
    expect(at()).toBeGreaterThan(h0 + 1);
  });

  it("re-grade all unlocked reports the change and undo restores heights and graph", () => {
    const { area, d } = withRoad();
    d.lockAll(false);
    raiseUnder(d, 0, 0);
    const heights = Float32Array.from(area.grid.heights);
    const graph = JSON.stringify(area.graph);
    const r = d.regradeAllUnlocked();
    expect(r.status).toMatch(
      /^Re-graded 1 road\(s\): max height change \d+\.\d\d m, max grade \d+\.\d%\.$/,
    );
    expect(r.graphChanged).toBe(true);
    expect(r.dirtyHeights).toBeDefined();
    expect(JSON.stringify(area.graph)).not.toBe(graph);
    d.undo();
    expect(Array.from(area.grid.heights)).toEqual(Array.from(heights));
    expect(JSON.stringify(area.graph)).toBe(graph);
    expect(d.regradeAllUnlocked().status).toBeDefined();
  });

  it("an erase stroke that carries locks merges the lock into its single undo entry", () => {
    const { area, d, id } = withRoad();
    d.lockAll(false);
    d.clearHistory();
    d.setTool("erase");
    d.setOptions({ radiusM: 6 });
    const r = d.pointerDown(0, 0, {});
    d.pointerUp(0, 0);
    expect(r.graphChanged).toBe(true);
    expect(r.lockChanged).toBe(true);
    expect(area.unlockedEdgeIds?.length).toBe(2);
    expect(area.unlockedEdgeIds).toContain(id);
    d.undo();
    expect(area.unlockedEdgeIds).toEqual([id]);
    expect(d.canUndo()).toBe(false);
  });
});

const selBounds = (d: ReturnType<typeof setup>["d"]): CellWindow | null =>
  d.getSelectionMask()?.bounds() ?? null;

describe("grid select (07.1)", () => {
  const A = { x: -30, z: -30 };
  const B = { x: -9, z: -9 };

  function selected() {
    const s = setup();
    s.d.setTool("select");
    s.d.pointerDown(A.x, A.z, {});
    s.d.pointerMove(B.x, B.z, {});
    s.d.pointerUp(B.x, B.z);
    return s;
  }

  function winHeights(area: EditArea, win: CellWindow) {
    const out: number[] = [];
    const stride = area.grid.rows + 1;
    for (let c = win.minCol; c <= win.maxCol; c++) {
      for (let r = win.minRow; r <= win.maxRow; r++) out.push(area.grid.heights[r + c * stride]);
    }
    return out;
  }

  it("dragging selects a window without editing or undo entry", () => {
    const { area, d } = setup();
    d.setTool("select");
    d.pointerDown(A.x, A.z, {});
    const live = d.selectionPreview(B.x, B.z);
    d.pointerMove(B.x, B.z, {});
    const up = d.pointerUp(B.x, B.z);
    const sel = selBounds(d);
    expect(sel).toEqual({ minCol: 30, maxCol: 37, minRow: 30, maxRow: 37 });
    expect(live).toEqual(sel);
    expect(up.selectionChanged).toBe(true);
    expect(d.canUndo()).toBe(false);
    expect(Math.max(...(area.grid.heights as unknown as number[]))).toBe(0);
  });

  it("a click selects the single cell under the pointer", () => {
    const { d } = setup();
    d.setTool("select");
    d.pointerDown(-29, -29, {});
    d.pointerUp(-29, -29);
    const w = selBounds(d);
    expect(w).toBeTruthy();
    expect((w?.maxCol as number) - (w?.minCol as number)).toBe(1);
    expect((w?.maxRow as number) - (w?.minRow as number)).toBe(1);
  });

  it("applyOperation raise/lower steps by selectStepM as one undo entry and keeps the selection", () => {
    const { area, d } = selected();
    const sel = selBounds(d) as CellWindow;
    const before = winHeights(area, sel);
    const r = d.applyOperation("raise");
    expect(r.dirtyHeights).toBeDefined();
    expect(winHeights(area, sel)).toEqual(before.map((h) => h + 1));
    expect(selBounds(d)).toEqual(sel);
    d.applyOperation("lower");
    expect(winHeights(area, sel)).toEqual(before);
    d.undo();
    expect(winHeights(area, sel)).toEqual(before.map((h) => h + 1));
    d.undo();
    expect(winHeights(area, sel)).toEqual(before);
    expect(d.canUndo()).toBe(false);
  });

  it("selectStepM clamps to 0.25..5", () => {
    const { d } = setup();
    d.setOptions({ selectStepM: 9 });
    expect(d.getOptions().selectStepM).toBe(5);
    d.setOptions({ selectStepM: 0.1 });
    expect(d.getOptions().selectStepM).toBe(0.25);
    expect(d.getOptions().selectStepM).toBeGreaterThan(0);
  });

  it("applyOperation raise/lower without a selection reports and pushes nothing", () => {
    const { d } = setup();
    const r = d.applyOperation("raise");
    expect(r.status).toBe("Select an area first (drag on the map)");
    expect(d.canUndo()).toBe(false);
  });

  it("push/pull is absolute from the snapshot and one undo entry", () => {
    const { area, d } = selected();
    const sel = selBounds(d) as CellWindow;
    const base = winHeights(area, sel);
    expect(d.beginPushPull()).toBe(true);
    d.pushPullTo(2);
    expect(winHeights(area, sel)).toEqual(base.map((h) => h + 2));
    d.pushPullTo(-1);
    expect(winHeights(area, sel)).toEqual(base.map((h) => h - 1));
    d.pushPullTo(0);
    expect(winHeights(area, sel)).toEqual(base);
    d.pushPullTo(2);
    d.endPushPull();
    d.undo();
    expect(winHeights(area, sel)).toEqual(base);
    expect(d.canUndo()).toBe(false);
  });

  it("beginPushPull is false without a selection; cancel restores with no undo entry", () => {
    const empty = setup();
    expect(empty.d.beginPushPull()).toBe(false);
    const { area, d } = selected();
    const sel = selBounds(d) as CellWindow;
    const base = winHeights(area, sel);
    d.beginPushPull();
    d.pushPullTo(3);
    d.cancelPushPull();
    expect(winHeights(area, sel)).toEqual(base);
    expect(d.canUndo()).toBe(false);
  });

  it("cancelPushPull restores the WHOLE heights array (limiter-moved neighbours too)", () => {
    const { area, d } = selected();
    const original = Float32Array.from(area.grid.heights);
    d.beginPushPull();
    d.pushPullTo(20);
    d.cancelPushPull();
    expect(Array.from(area.grid.heights)).toEqual(Array.from(original));
    expect(d.canUndo()).toBe(false);
  });

  it("beginPushPull while a hold-repeat is active commits the repeat first (composable undo)", () => {
    const { area, d } = selected();
    const sel = selBounds(d) as CellWindow;
    const base = winHeights(area, sel);
    d.beginOpRepeat("raise");
    expect(d.isRepeating()).toBe(true);
    d.beginPushPull();
    expect(d.isRepeating()).toBe(false);
    d.pushPullTo(2);
    d.endPushPull();
    d.undo();
    expect(winHeights(area, sel)).toEqual(base.map((h) => h + 1));
    d.undo();
    expect(winHeights(area, sel)).toEqual(base);
    expect(d.canUndo()).toBe(false);
  });

  it("switching mode mid rubber-band drops the drag instead of committing it", () => {
    const { d } = setup();
    d.setTool("select");
    d.pointerDown(A.x, A.z, {});
    d.pointerMove(B.x, B.z, {});
    d.setMode("brush");
    expect(d.isStroking()).toBe(false);
    expect(d.getSelectionMask()).toBeNull();
  });

  it("pushPullTo clamps delta to 50 m", () => {
    const { area, d } = selected();
    const sel = selBounds(d) as CellWindow;
    d.beginPushPull();
    d.pushPullTo(500);
    const max = Math.max(...winHeights(area, sel));
    expect(max).toBeLessThanOrEqual(50);
    d.cancelPushPull();
  });

  it("Alt+pointerDown on an existing selection starts push/pull, not a new band", () => {
    const { d } = selected();
    const sel = selBounds(d);
    const r = d.pointerDown(60, 60, { alt: true });
    expect(r.pushPullStarted).toBe(true);
    d.pointerMove(90, 90, {});
    d.pointerUp(90, 90);
    expect(selBounds(d)).toEqual(sel);
    d.cancelPushPull();
  });

  it("road-held vertices keep their height under applyOperation raise/lower and pushPullTo", () => {
    const { area, d } = setup();
    d.setTool("road");
    drag(d, [
      [-80, 0],
      [-40, 0],
      [0, 0],
      [40, 0],
      [80, 0],
    ]);
    d.clearHistory();
    const mask = roadVertexMask(area.grid, area.paint, area.graph, {
      minRow: 0,
      minCol: 0,
      maxRow: area.grid.rows,
      maxCol: area.grid.cols,
    });
    d.setTool("select");
    d.pointerDown(-20, -20, {});
    d.pointerUp(20, 20);
    const sel = selBounds(d) as CellWindow;
    const stride = area.grid.rows + 1;
    const held: number[] = [];
    for (let c = sel.minCol; c <= sel.maxCol; c++) {
      for (let r = sel.minRow; r <= sel.maxRow; r++)
        if (mask[r + c * stride]) held.push(r + c * stride);
    }
    expect(held.length).toBeGreaterThan(0);
    const before = held.map((i) => area.grid.heights[i]);
    const r1 = d.applyOperation("raise");
    expect(r1.heldVertices).toBeGreaterThan(0);
    expect(held.map((i) => area.grid.heights[i])).toEqual(before);
    d.beginPushPull();
    const r2 = d.pushPullTo(2);
    expect(r2.heldVertices).toBeGreaterThan(0);
    expect(held.map((i) => area.grid.heights[i])).toEqual(before);
    d.cancelPushPull();
  });

  it("clearSelection clears; windows clip to the grid", () => {
    const { d } = setup();
    d.setTool("select");
    d.pointerDown(-1000, -1000, {});
    d.pointerUp(1000, 1000);
    expect(selBounds(d)).toEqual({ minRow: 0, minCol: 0, maxRow: 80, maxCol: 80 });
    d.clearSelection();
    expect(selBounds(d)).toBeNull();
  });
});

describe("applyRoadFix (07.1-15)", () => {
  function withDuplicate() {
    const { area, d } = setup();
    const pts = [
      [0, 0, 0],
      [10, 0, 0],
      [10, 0, 0],
      [20, 0, 0],
    ] as [number, number, number][];
    const e = {
      id: 0,
      from: 0,
      to: 1,
      points: pts,
      lengthM: 20,
      surface: "tarmac" as const,
      roadClass: "residential",
      lanes: 2,
      widthM: 7,
      oneway: false,
      speedLimitKph: 50,
      bridge: false,
      tunnel: false,
      layer: 0,
      osmWayId: 0,
    };
    const node = (id: number, p: [number, number, number]) => ({
      id,
      x: p[0],
      y: p[1],
      z: p[2],
      junction: false,
      osmNodeId: 0,
    });
    area.graph = { ...area.graph, nodes: [node(0, pts[0]), node(1, pts[3])], edges: [e] };
    area.nextEdgeId = 1;
    return { area, d };
  }

  it("removes duplicate points as one undo step", () => {
    const { area, d } = withDuplicate();
    const before = JSON.stringify(area.graph);
    const r = d.applyRoadFix("remove-duplicate-points", 0);
    expect(r.graphChanged).toBe(true);
    expect(area.graph.edges[0].points).toHaveLength(3);
    d.undo();
    expect(JSON.stringify(area.graph)).toBe(before);
    expect(d.canUndo()).toBe(false);
  });

  it("pushes nothing when no safe fix exists", () => {
    const { d } = withDuplicate();
    const r = d.applyRoadFix("smooth-heights", 0);
    expect(r.graphChanged).toBe(false);
    expect(r.status).toContain("no safe automatic fix");
    expect(d.canUndo()).toBe(false);
  });
});

describe("applyRoadFix connectivity fixes (07.1-21)", () => {
  const failuresOf = (g: RoadGraph) => validateGraph(g, buildRoadGeometry(g));
  const has = (g: RoadGraph, category: string) =>
    failuresOf(g).some((f) => f.category === category);

  function edgeOf(id: number, from: number, to: number, pts: P[], oneway = false): RoadGraphEdge {
    let lengthM = 0;
    for (let i = 1; i < pts.length; i++) {
      lengthM += Math.hypot(
        pts[i][0] - pts[i - 1][0],
        pts[i][1] - pts[i - 1][1],
        pts[i][2] - pts[i - 1][2],
      );
    }
    return {
      id,
      from,
      to,
      points: pts,
      lengthM,
      surface: "tarmac",
      roadClass: "residential",
      lanes: 2,
      widthM: 7,
      oneway,
      speedLimitKph: 50,
      bridge: false,
      tunnel: false,
      layer: 0,
      osmWayId: 0,
    };
  }
  const nodeOf = (id: number, p: P) => ({
    id,
    x: p[0],
    y: p[1],
    z: p[2],
    junction: false,
    osmNodeId: 0,
  });

  function snapshot(area: EditArea) {
    return {
      graph: JSON.stringify(area.graph),
      heights: Array.from(area.grid.heights),
      paint: Array.from(area.paint.data),
      nextEdgeId: area.nextEdgeId,
    };
  }

  it("make-two-way flips the trap's one-way road and undoes in one step", () => {
    const { area, d } = setup();
    const a: P = [0, 0, 0];
    const b: P = [20, 0, 0];
    const c: P = [40, 0, 0];
    area.graph = {
      ...area.graph,
      nodes: [nodeOf(0, a), nodeOf(1, b), nodeOf(2, c)],
      edges: [edgeOf(0, 0, 1, [a, b]), edgeOf(1, 1, 2, [b, c], true)],
    };
    area.nextEdgeId = 2;
    expect(has(area.graph, "DIRECTED_PATHABILITY")).toBe(true);
    const before = JSON.stringify(area.graph);
    const r = d.applyRoadFix("make-two-way", 1, 2);
    expect(r.graphChanged).toBe(true);
    expect(r.status).toContain("two-way");
    expect(area.graph.edges.every((e) => !e.oneway)).toBe(true);
    expect(has(area.graph, "DIRECTED_PATHABILITY")).toBe(false);
    d.undo();
    expect(JSON.stringify(area.graph)).toBe(before);
    expect(d.canUndo()).toBe(false);
  });

  it("connect-ends draws a real road to the network and undoes in one step", () => {
    const { area, d } = setup();
    d.setTool("road");
    d.setOptions({ roadPreset: "street" });
    drag(d, [
      [-80, -60],
      [80, -60],
    ]);
    drag(d, [
      [-80, 40],
      [80, 40],
    ]);
    expect(has(area.graph, "UNDIRECTED_REACHABILITY")).toBe(true);
    const cutOff = area.graph.edges.find((e) => e.points[0][2] > 0) as RoadGraphEdge;
    const rootEdge = area.graph.edges.find((e) => e.points[0][2] < 0) as RoadGraphEdge;
    // Whichever piece holds graph.nodes[0] is the network; fix the other one.
    const rootNode = area.graph.nodes[0].id;
    const fixId = cutOff.from === rootNode || cutOff.to === rootNode ? rootEdge.id : cutOff.id;
    const before = snapshot(area);
    const r = d.applyRoadFix("connect-ends", fixId);
    expect(r.graphChanged).toBe(true);
    expect(r.status).toContain("Connected Road");
    expect(has(area.graph, "UNDIRECTED_REACHABILITY")).toBe(false);
    expect(area.nextEdgeId).toBeGreaterThan(before.nextEdgeId);
    expect(Array.from(area.paint.data)).not.toEqual(before.paint);
    d.undo();
    expect(snapshot(area)).toEqual(before);
  });

  it("close-loop with a wide gap draws a joining road; one undo restores", () => {
    const { area, d } = setup();
    d.setTool("road");
    d.setOptions({ roadPreset: "street" });
    drag(d, [
      [-60, -60],
      [60, -60],
      [60, 60],
      [-60, 60],
    ]);
    const ids = area.graph.edges.map((e) => e.id);
    const before = snapshot(area);
    const r = d.applyRoadFix("close-loop", ids[0]);
    expect(r.graphChanged).toBe(true);
    expect(r.status).toContain("Closed the loop");
    const degree = new Map<number, number>();
    for (const e of area.graph.edges) {
      degree.set(e.from, (degree.get(e.from) ?? 0) + 1);
      degree.set(e.to, (degree.get(e.to) ?? 0) + 1);
    }
    expect([...degree.values()].some((v) => v === 1)).toBe(false);
    d.undo();
    expect(snapshot(area)).toEqual(before);
  });

  it("close-loop with a tiny gap merges the two ends; one undo restores", () => {
    const { area, d } = setup();
    const pts: P[] = [
      [0, 0, 0],
      [40, 0, 0],
      [40, 0, 40],
      [0, 0, 40],
      [0, 0, 3],
    ];
    area.graph = {
      ...area.graph,
      nodes: [nodeOf(0, pts[0]), nodeOf(1, pts[4])],
      edges: [edgeOf(0, 0, 1, pts)],
    };
    area.nextEdgeId = 1;
    const before = snapshot(area);
    const r = d.applyRoadFix("close-loop", 0);
    expect(r.graphChanged).toBe(true);
    expect(area.graph.nodes.map((n) => n.id)).toEqual([0]);
    expect(area.graph.edges[0].to).toBe(0);
    expect(Array.from(area.paint.data)).toEqual(before.paint);
    d.undo();
    expect(snapshot(area)).toEqual(before);
    expect(d.canUndo()).toBe(false);
  });

  it("pushes nothing and explains when the planner finds no fix", () => {
    const { area, d } = setup();
    const a: P = [0, 0, 0];
    const b: P = [20, 0, 0];
    area.graph = {
      ...area.graph,
      nodes: [nodeOf(0, a), nodeOf(1, b)],
      edges: [edgeOf(0, 0, 1, [a, b])],
    };
    area.nextEdgeId = 1;
    const before = JSON.stringify(area.graph);
    const r = d.applyRoadFix("connect-ends", 0);
    expect(r.graphChanged).toBe(false);
    expect(r.status).toBe("Road 0: nothing within 250 m to connect to; draw a road to it by hand.");
    expect(d.applyRoadFix("make-two-way", 0, 1).graphChanged).toBe(false);
    expect(d.canUndo()).toBe(false);
    expect(JSON.stringify(area.graph)).toBe(before);
  });
});

describe("brush shape option (quick 261111-x00)", () => {
  it("defaults to round, accepts square, rejects anything else", () => {
    const { d } = setup();
    expect(d.getOptions().brushShape).toBe("round");
    d.setOptions({ brushShape: "square" });
    expect(d.getOptions().brushShape).toBe("square");
    d.setOptions({ brushShape: "hexagon" as unknown as "round" });
    expect(d.getOptions().brushShape).toBe("round");
  });

  it("raise honours the square shape", () => {
    const sq = setup();
    sq.d.setOptions({ brushShape: "square", radiusM: 12 });
    sq.d.setTool("raise");
    sq.d.pointerDown(0, 0, {});
    sq.d.pointerUp(0, 0);
    const rd = setup();
    rd.d.setOptions({ radiusM: 12 });
    rd.d.setTool("raise");
    rd.d.pointerDown(0, 0, {});
    rd.d.pointerUp(0, 0);
    expect(sampleTerrainHeight(sq.area.grid, 9, 9)).toBeGreaterThan(0);
    expect(sampleTerrainHeight(rd.area.grid, 9, 9)).toBe(0);
  });
});

describe("slope limit option", () => {
  it("defaults to MAX_SLOPE_DEG and clamps to 5..80 integers", () => {
    const { d } = setup();
    expect(d.getOptions().slopeLimitDeg).toBe(MAX_SLOPE_DEG);
    d.setOptions({ slopeLimitDeg: 100 });
    expect(d.getOptions().slopeLimitDeg).toBe(80);
    d.setOptions({ slopeLimitDeg: 1 });
    expect(d.getOptions().slopeLimitDeg).toBe(5);
    d.setOptions({ slopeLimitDeg: 42.6 });
    expect(d.getOptions().slopeLimitDeg).toBe(43);
    d.setOptions({ slopeLimitDeg: Number.NaN });
    expect(d.getOptions().slopeLimitDeg).toBe(43);
  });

  it("hint mentions the chosen degrees", () => {
    expect(slopeClampHint(50)).toContain("50 degrees");
  });

  it("a steeper limit lets a raise stroke build a steeper hill", () => {
    const peak = (deg: number) => {
      const { area, d } = setup();
      d.setOptions({ slopeLimitDeg: deg, radiusM: 6, strength: 1 });
      d.setTool("raise");
      for (let i = 0; i < 40; i++) {
        d.pointerDown(0, 0, {});
        d.pointerUp(0, 0);
      }
      return sampleTerrainHeight(area.grid, 0, 0);
    };
    expect(peak(60)).toBeGreaterThan(peak(20));
  });
});

describe("selection road actions (07.1.2-08)", () => {
  function twoRoads() {
    const s = setup();
    s.d.setTool("road");
    drag(s.d, [
      [-80, -60],
      [-40, -60],
      [0, -60],
      [40, -60],
      [80, -60],
    ]);
    drag(s.d, [
      [-80, 60],
      [-40, 60],
      [0, 60],
      [40, 60],
      [80, 60],
    ]);
    expect(s.area.graph.edges.length).toBe(2);
    s.d.clearHistory();
    s.d.setMode("select");
    return s;
  }
  function select(d: ReturnType<typeof setup>["d"], a: [number, number], b: [number, number]) {
    d.pointerDown(a[0], a[1], {});
    d.pointerMove(b[0], b[1], {});
    d.pointerUp(b[0], b[1]);
  }
  const crossFirst = (d: ReturnType<typeof setup>["d"]) => select(d, [-15, -80], [15, -40]);

  it("unlock affects only the crossed road, lock restores it whole; one undo each", () => {
    const { area, d } = twoRoads();
    const edgeCount = area.graph.edges.length;
    const first = area.graph.edges.find((e) => e.points[0][2] < 0)?.id as number;
    crossFirst(d);
    const r = d.applyRoadAction("unlock");
    expect(r.status).toBe("Unlocked 1 road(s)");
    expect(area.unlockedEdgeIds).toEqual([first]);
    const l = d.applyRoadAction("lock");
    expect(l.status).toBe("Locked 1 road(s)");
    expect(area.unlockedEdgeIds ?? []).toEqual([]);
    expect(area.graph.edges.length).toBe(edgeCount);
    d.undo();
    expect(area.unlockedEdgeIds).toEqual([first]);
    d.undo();
    expect(area.unlockedEdgeIds ?? []).toEqual([]);
    expect(d.canUndo()).toBe(false);
  });

  it("deleteRoad cuts a locked road inside the selection, one undo restores it", () => {
    const { area, d } = twoRoads();
    const before = JSON.stringify(area.graph);
    crossFirst(d);
    const r = d.applyRoadAction("deleteRoad");
    expect(r.graphChanged).toBe(true);
    expect(r.status).toBe("Road deleted in the selection. Ctrl+Z to undo.");
    expect(area.graph.edges.length).toBe(3);
    d.undo();
    expect(JSON.stringify(area.graph)).toBe(before);
    expect(d.canUndo()).toBe(false);
  });

  it("no selection, brush mode and empty selections change nothing", () => {
    const { d } = twoRoads();
    expect(d.applyRoadAction("lock").status).toBe("Select an area first (drag on the map)");
    select(d, [-15, -20], [15, 20]);
    expect(d.applyRoadAction("unlock").status).toBe("No roads in the selection");
    expect(d.applyRoadAction("deleteRoad").status).toBe("No roads in the selection");
    d.setMode("brush");
    expect(d.applyRoadAction("lock").status).toBe("Switch to Select mode (S) to use this");
    expect(d.canUndo()).toBe(false);
  });

  it("regradeSelection re-grades only unlocked roads touching the selection", () => {
    const { area, d } = twoRoads();
    crossFirst(d);
    expect(d.regradeSelection().status).toBe("No unlocked roads in the selection");
    d.applyRoadAction("unlock");
    for (let i = 0; i < area.grid.heights.length; i++) area.grid.heights[i] += 2;
    const r = d.regradeSelection();
    expect(r.status).toContain("Re-graded 1 road(s)");
  });
});

describe("modes and mask selection (07.1.2-07)", () => {
  function box(
    d: ReturnType<typeof setup>["d"],
    a: [number, number],
    b: [number, number],
    mods: { shift?: boolean; ctrl?: boolean; alt?: boolean } = {},
  ) {
    d.pointerDown(a[0], a[1], mods);
    d.pointerMove(b[0], b[1], mods);
    return d.pointerUp(b[0], b[1]);
  }

  it("defaults to select mode; setTool adapter maps onto mode/armed", () => {
    const { d } = setup();
    expect(d.getMode()).toBe("select");
    d.setTool("smooth");
    expect(d.getMode()).toBe("brush");
    expect(d.getArmed()).toBe("smooth");
    d.setTool("select");
    expect(d.getMode()).toBe("select");
  });

  it("plain drag replaces, shift adds, ctrl subtracts; no undo entries", () => {
    const { d } = setup();
    box(d, [-30, -30], [-9, -9]);
    const first = d.selectionCellCount();
    expect(first).toBe(49);
    box(d, [30, 30], [51, 51]);
    expect(d.selectionCellCount()).toBe(49);
    box(d, [-30, -30], [-9, -9], { shift: true });
    expect(d.selectionCellCount()).toBe(98);
    box(d, [-30, -30], [-9, -9], { ctrl: true });
    expect(d.selectionCellCount()).toBe(49);
    box(d, [30, 30], [51, 51], { ctrl: true });
    expect(d.getSelectionMask()).toBeNull();
    expect(selBounds(d)).toBeNull();
    expect(d.canUndo()).toBe(false);
  });

  it("selectionDragOp reports the live op", () => {
    const { d } = setup();
    d.pointerDown(0, 0, { shift: true });
    expect(d.selectionDragOp()).toBe("add");
    d.pointerUp(9, 9);
    d.pointerDown(0, 0, { ctrl: true });
    expect(d.selectionDragOp()).toBe("subtract");
    d.pointerUp(9, 9);
    expect(d.selectionDragOp()).toBeNull();
  });

  it("switching mode keeps the selection; clearSelection and clearHistory empty it", () => {
    const { d } = setup();
    box(d, [-30, -30], [-9, -9]);
    const n = d.selectionCellCount();
    d.setMode("brush");
    d.setMode("select");
    expect(d.selectionCellCount()).toBe(n);
    d.clearSelection();
    expect(d.getSelectionMask()).toBeNull();
    box(d, [-30, -30], [-9, -9]);
    d.clearHistory();
    expect(d.getSelectionMask()).toBeNull();
  });

  it("brush mode with nothing armed reports and edits nothing", () => {
    const { area, d } = setup();
    d.setMode("brush");
    const r = d.pointerDown(0, 0, {});
    d.pointerUp(0, 0);
    expect(r.status).toBe("Pick an operation");
    expect(d.canUndo()).toBe(false);
    expect(Math.max(...(area.grid.heights as unknown as number[]))).toBe(0);
  });

  it("armBrush raise sculpts, terrain paints", () => {
    const { area, d } = setup();
    d.armBrush("raise");
    expect(d.getMode()).toBe("brush");
    d.pointerDown(0, 0, {});
    d.pointerUp(0, 0);
    expect(sampleTerrainHeight(area.grid, 0, 0)).toBeGreaterThan(0);
    d.armBrush("terrain");
    d.setOptions({ surface: "sand" });
    d.pointerDown(30, 30, {});
    d.pointerUp(30, 30);
    expect(surfaceAt(area.paint, 30, 30)).toBe("sand");
  });

  it("alt push/pull in select mode: only selected vertices move, one undo entry", () => {
    const { area, d } = setup();
    box(d, [-30, -30], [-9, -9]);
    const outside = area.grid.heights[0];
    const r = d.pointerDown(60, 60, { alt: true });
    expect(r.pushPullStarted).toBe(true);
    d.pointerUp(60, 60);
    expect(d.beginPushPull()).toBe(true);
    d.pushPullTo(1.5);
    d.endPushPull();
    expect(sampleTerrainHeight(area.grid, -20, -20)).toBeCloseTo(1.5, 5);
    expect(area.grid.heights[0]).toBe(outside);
    d.undo();
    expect(d.canUndo()).toBe(false);
    expect(sampleTerrainHeight(area.grid, -20, -20)).toBe(0);
  });

  it("ctrl in select mode subtracts instead of push/pull; brush mode ignores alt", () => {
    const { d } = setup();
    box(d, [-30, -30], [-9, -9]);
    const r = d.pointerDown(-20, -20, { ctrl: true });
    expect(r.pushPullStarted).toBeUndefined();
    d.pointerUp(-20, -20);
    d.armBrush("raise");
    const r2 = d.pointerDown(60, 60, { alt: true });
    expect(r2.pushPullStarted).toBeUndefined();
    d.pointerUp(60, 60);
  });
});

describe("selection operations (07.1.2-07)", () => {
  function selected() {
    const s = setup();
    s.d.pointerDown(-30, -30, {});
    s.d.pointerUp(-9, -9);
    return s;
  }
  const hAt = (area: EditArea) => sampleTerrainHeight(area.grid, -20, -20);

  it("raise/lower step exactly selectStepM, one undo entry each", () => {
    const { area, d } = selected();
    d.setOptions({ selectStepM: 0.5 });
    d.applyOperation("raise");
    expect(hAt(area)).toBeCloseTo(0.5, 5);
    d.applyOperation("lower");
    d.applyOperation("lower");
    expect(hAt(area)).toBeCloseTo(-0.5, 5);
    d.undo();
    d.undo();
    d.undo();
    expect(d.canUndo()).toBe(false);
    expect(hAt(area)).toBe(0);
  });

  it("no selection: status and no change", () => {
    const { d } = setup();
    for (const op of ["raise", "lower", "smooth", "flatten", "terrain"] as const) {
      const r = d.applyOperation(op);
      expect(r.status).toBe("Select an area first (drag on the map)");
    }
    expect(d.canUndo()).toBe(false);
  });

  it("flatten sets selected vertices to the average", () => {
    const { area, d } = selected();
    const stride = area.grid.rows + 1;
    area.grid.heights[35 + 35 * stride] = 4;
    d.applyOperation("flatten");
    const vals = new Set<number>();
    for (let c = 30; c <= 37; c++) {
      for (let r = 30; r <= 37; r++) vals.add(Math.round(area.grid.heights[r + c * stride] * 1e4));
    }
    expect(vals.size).toBe(1);
    expect(d.canUndo()).toBe(true);
    d.undo();
    expect(d.canUndo()).toBe(false);
  });

  it("smooth acts only inside the selection, one undo entry", () => {
    const { area, d } = selected();
    const stride = area.grid.rows + 1;
    area.grid.heights[33 + 33 * stride] = 3;
    area.grid.heights[10 + 10 * stride] = 3;
    d.setOptions({ selectSmoothStrength: 1 });
    d.applyOperation("smooth");
    expect(area.grid.heights[33 + 33 * stride]).toBeLessThan(3);
    expect(area.grid.heights[10 + 10 * stride]).toBe(3);
    d.undo();
    expect(d.canUndo()).toBe(false);
  });

  it("terrain fills selected cells with the surface, one undo entry", () => {
    const { area, d } = selected();
    d.setOptions({ surface: "sand" });
    const r = d.applyOperation("terrain");
    expect(r.dirtyPaint).toBeDefined();
    expect(surfaceAt(area.paint, -20, -20)).toBe("sand");
    expect(surfaceAt(area.paint, 60, 60)).not.toBe("sand");
    d.undo();
    expect(d.canUndo()).toBe(false);
  });

  it("a hold (begin + 4 ticks + end) is base + 5 steps and ONE undo entry", () => {
    const { area, d } = selected();
    d.setOptions({ selectStepM: 0.25 });
    d.beginOpRepeat("raise");
    expect(d.isRepeating()).toBe(true);
    for (let i = 0; i < 4; i++) d.opRepeatTick();
    const end = d.endOpRepeat();
    expect(d.isRepeating()).toBe(false);
    expect(end.dirtyHeights).toBeDefined();
    expect(hAt(area)).toBeCloseTo(1.25, 5);
    d.undo();
    expect(hAt(area)).toBe(0);
    expect(d.canUndo()).toBe(false);
  });

  it("a smooth hold is one undo entry", () => {
    const { area, d } = selected();
    const stride = area.grid.rows + 1;
    area.grid.heights[33 + 33 * stride] = 3;
    d.beginOpRepeat("smooth");
    d.opRepeatTick();
    d.opRepeatTick();
    d.endOpRepeat();
    d.undo();
    expect(d.canUndo()).toBe(false);
    expect(area.grid.heights[33 + 33 * stride]).toBe(3);
  });

  it("reports the slope clamp for a step steeper than the limit", () => {
    const { d } = selected();
    d.setOptions({ slopeLimitDeg: 5, selectStepM: 5 });
    const r = d.applyOperation("raise");
    expect(r.slopeClamped).toBe(true);
    expect(r.status).toBe(slopeClampHint(5));
  });

  it("select-mode and brush options are independent and validated", () => {
    const { d } = setup();
    const before = { ...d.getOptions() };
    d.setOptions({ selectStepM: 2, selectSmoothStrength: 0.9 });
    expect(d.getOptions().radiusM).toBe(before.radiusM);
    expect(d.getOptions().strength).toBe(before.strength);
    expect(d.getOptions().smoothStrength).toBe(before.smoothStrength);
    d.setOptions({ radiusM: 30, strength: 3 });
    expect(d.getOptions().selectStepM).toBe(2);
    expect(d.getOptions().selectSmoothStrength).toBe(0.9);
    d.setOptions({ selectSmoothStrength: 7 });
    expect(d.getOptions().selectSmoothStrength).toBe(1);
    d.setOptions({ selectSmoothStrength: Number.NaN, selectStepM: Number.NaN });
    expect(d.getOptions().selectSmoothStrength).toBe(1);
    expect(d.getOptions().selectStepM).toBe(2);
  });
});

describe("start-point undo (07.1.3 D-16)", () => {
  const sp = (n: number) => ({
    id: `start-${n}`,
    name: `Start ${n}`,
    x: n,
    z: n * 2,
    headingRad: 0.5,
  });

  it("commitStartPoints is one undo step; undo and redo restore exact arrays", () => {
    const { area, d } = setup();
    const a = [sp(1)];
    const r = d.commitStartPoints(a);
    expect(r.startPointsChanged).toBe(true);
    expect(area.startPoints).toEqual(a);
    const b = [sp(1), sp(2)];
    d.commitStartPoints(b);
    const u = d.undo();
    expect(u !== false && u.startPointsChanged).toBe(true);
    expect(area.startPoints).toEqual(a);
    d.undo();
    expect(area.startPoints).toEqual([]);
    const rd = d.redo();
    expect(rd !== false && rd.startPointsChanged).toBe(true);
    expect(area.startPoints).toEqual(a);
    d.redo();
    expect(area.startPoints).toEqual(b);
  });

  it("a deep-equal list pushes nothing", () => {
    const { area, d } = setup();
    d.commitStartPoints([sp(1)]);
    const r = d.commitStartPoints([sp(1)]);
    expect(r.startPointsChanged).toBe(false);
    d.undo();
    expect(area.startPoints).toEqual([]);
    expect(d.canUndo()).toBe(false);
  });

  it("interleaves with sculpt steps on the single stack", () => {
    const { area, d } = setup();
    raiseBox(d, 0, 0, 12, 1);
    d.commitStartPoints([sp(1)]);
    expect(sampleTerrainHeight(area.grid, 0, 0)).toBeGreaterThan(0);
    d.undo();
    expect(area.startPoints).toEqual([]);
    expect(sampleTerrainHeight(area.grid, 0, 0)).toBeGreaterThan(0);
    d.undo();
    expect(sampleTerrainHeight(area.grid, 0, 0)).toBe(0);
  });

  it("placing state refuses strokes and clears on mode change", () => {
    const { area, d } = setup();
    d.setTool("raise");
    d.setPlacing("start");
    expect(d.placing()).toBe("start");
    d.pointerDown(0, 0, {});
    d.pointerMove(5, 0, {});
    d.pointerUp(5, 0);
    expect(d.canUndo()).toBe(false);
    expect(sampleTerrainHeight(area.grid, 0, 0)).toBe(0);
    d.setMode("select");
    expect(d.placing()).toBeNull();
    d.setPlacing("tree");
    d.setPlacing(null);
    expect(d.placing()).toBeNull();
  });
});

describe("scenery undo and building re-seat (07.1.3 D-16)", () => {
  const tree = (n: number) => ({
    id: `f-${n}`,
    kind: "tree" as const,
    variant: "oak",
    x: n * 3,
    z: 50,
    rotationY: 0,
    scale: 1,
  });
  const shed = (x: number, z: number, style?: string) => ({
    center: { x, y: 1.1, z },
    halfExtents: { x: 2, y: 1.4, z: 2 },
    rotationY: 0,
    ...(style !== undefined ? { style } : {}),
  });

  it("commitScenery is one step; undo and redo restore every part", () => {
    const { area, d } = setup();
    const r = d.commitScenery({
      features: [tree(1)],
      buildings: [shed(0, 0, "shed")],
      objects: [
        { kind: "crest", crest: { id: "ramp-1", centerX: 5, centerZ: 5, radiusM: 0, heightM: 2 } },
      ],
    });
    expect(r.featuresChanged && r.buildingsChanged && r.objectsChanged).toBe(true);
    expect(area.features).toHaveLength(1);
    const u = d.undo();
    expect(u !== false && u.featuresChanged && u.buildingsChanged && u.objectsChanged).toBe(true);
    expect(area.features ?? []).toEqual([]);
    expect(area.buildings ?? []).toEqual([]);
    expect(area.objects ?? []).toEqual([]);
    expect(d.canUndo()).toBe(false);
    d.redo();
    expect(area.features).toHaveLength(1);
    expect(area.buildings).toHaveLength(1);
    expect(area.objects).toHaveLength(1);
  });

  it("only records the parts that differ and skips deep-equal input", () => {
    const { area, d } = setup();
    d.commitScenery({ features: [tree(1)] });
    const same = d.commitScenery({ features: [tree(1)], buildings: [] });
    expect(same.featuresChanged || same.buildingsChanged).toBe(false);
    d.undo();
    expect(d.canUndo()).toBe(false);
    expect(area.features ?? []).toEqual([]);
  });

  it("box-delete of 3 features and 1 building is one undo step", () => {
    const { area, d } = setup();
    d.commitScenery({
      features: [tree(1), tree(2), tree(3)],
      buildings: [shed(0, 0, "shed")],
    });
    d.commitScenery({ features: [], buildings: [] });
    expect(area.features).toEqual([]);
    expect(area.buildings).toEqual([]);
    d.undo();
    expect(area.features).toHaveLength(3);
    expect(area.buildings).toHaveLength(1);
  });

  it("styled buildings follow a sculpt in the same undo step; style-less ones stay put", () => {
    const { area, d } = setup();
    const styled = shed(0, 0, "shed");
    const legacy = shed(12, 0);
    d.commitScenery({ buildings: [styled, legacy] });
    const topBefore = styled.center.y + styled.halfExtents.y;
    raiseBox(d, 6, 0, 24, 2);
    const b0 = area.buildings?.[0];
    const b1 = area.buildings?.[1];
    expect(b0 && b0.center.y + b0.halfExtents.y).toBeCloseTo(topBefore + 2, 3);
    expect(b1).toEqual(legacy);
    d.undo();
    expect(sampleTerrainHeight(area.grid, 0, 0)).toBe(0);
    expect(area.buildings?.[0]).toEqual(styled);
    expect(area.buildings?.[1]).toEqual(legacy);
    d.redo();
    const again = area.buildings?.[0];
    expect(again && again.center.y + again.halfExtents.y).toBeCloseTo(topBefore + 2, 3);
    // Undoing past the stroke leaves only the scenery commit; one more undo removes it.
    d.undo();
    d.undo();
    expect(area.buildings ?? []).toEqual([]);
  });

  // WR-02 / WR-03: a held arrow key or stepper is one undo step, not one per repeat tick.
  describe("merging commitScenery", () => {
    const turned = (rotationY: number) => [{ ...shed(0, 0, "shed"), rotationY }];
    const merge = (nowMs: number, key = "rotate:b0", windowMs = 700) => ({ key, nowMs, windowMs });

    it("folds a run with the same key into one undo step", () => {
      const { area, d } = setup();
      d.commitScenery({ buildings: turned(0) });
      for (let i = 1; i <= 100; i++) {
        const r = d.commitScenery({ buildings: turned(i / 100) }, merge(1000 + i * 30));
        expect(r.buildingsChanged).toBe(true);
      }
      expect(area.buildings?.[0]?.rotationY).toBe(1);
      d.undo();
      expect(area.buildings?.[0]?.rotationY).toBe(0);
      d.redo();
      expect(area.buildings?.[0]?.rotationY).toBe(1);
      d.undo();
      d.undo();
      expect(area.buildings ?? []).toEqual([]);
      expect(d.canUndo()).toBe(false);
    });

    it("a run does not evict earlier history from the 50-entry stack", () => {
      const { area, d } = setup();
      d.commitScenery({ features: [tree(1)] });
      d.commitScenery({ buildings: turned(0) });
      for (let i = 1; i <= 120; i++) d.commitScenery({ buildings: turned(i / 100) }, merge(i * 80));
      d.undo();
      d.undo();
      d.undo();
      expect(area.features ?? []).toEqual([]);
    });

    it("starts a new step after the window, for another key, and after any other edit", () => {
      const { area, d } = setup();
      d.commitScenery({ buildings: turned(0) });
      d.commitScenery({ buildings: turned(0.1) }, merge(0));
      d.commitScenery({ buildings: turned(0.2) }, merge(701)); // too late: a new step
      d.undo();
      expect(area.buildings?.[0]?.rotationY).toBe(0.1);
      d.redo();
      d.commitScenery({ buildings: turned(0.3) }, merge(800, "rotate:b1")); // other item
      d.undo();
      expect(area.buildings?.[0]?.rotationY).toBe(0.2);
      d.redo();
      d.commitScenery({ features: [tree(1)] }); // unrelated edit in between
      d.commitScenery({ buildings: turned(0.4) }, merge(810, "rotate:b1"));
      d.undo();
      expect(area.buildings?.[0]?.rotationY).toBe(0.3);
    });

    it("never merges across an undo or a redo", () => {
      const { area, d } = setup();
      d.commitScenery({ buildings: turned(0) });
      d.commitScenery({ buildings: turned(0.1) }, merge(0));
      d.undo();
      d.redo();
      d.commitScenery({ buildings: turned(0.2) }, merge(10));
      d.undo();
      expect(area.buildings?.[0]?.rotationY).toBe(0.1);
    });

    it("an unbounded window merges a key repeat however late it arrives", () => {
      const { area, d } = setup();
      d.commitScenery({ buildings: turned(0) });
      d.commitScenery({ buildings: turned(0.1) }, merge(0));
      d.commitScenery(
        { buildings: turned(0.2) },
        merge(5000, "rotate:b0", Number.POSITIVE_INFINITY),
      );
      d.undo();
      expect(area.buildings?.[0]?.rotationY).toBe(0);
    });
  });

  // WR-01: every sculpt path that re-seats a building must say so, or the view keeps the old mesh.
  describe("reports buildingsChanged when a sculpt re-seats a building", () => {
    const withShed = () => {
      const s = setup();
      s.d.commitScenery({ buildings: [shed(0, 0, "shed")] });
      return s;
    };
    const selectBox = (d: ReturnType<typeof setup>["d"]) => {
      d.setMode("select");
      d.pointerDown(-12, -12, {});
      d.pointerUp(12, 12);
    };

    it("brush stroke release", () => {
      const { area, d } = withShed();
      d.setTool("raise");
      d.pointerDown(0, 0, {});
      d.pointerMove(3, 0, {});
      const up = d.pointerUp(3, 0);
      expect(up.buildingsChanged).toBe(true);
      expect(area.buildings?.[0]?.center.y).not.toBe(1.1);
    });

    it("a stroke away from every building reports nothing", () => {
      const { d } = withShed();
      d.setTool("raise");
      d.pointerDown(90, 90, {});
      expect(d.pointerUp(90, 90).buildingsChanged).toBe(false);
    });

    it("Flatten on a selection", () => {
      const { d } = withShed();
      d.setTool("raise");
      d.pointerDown(6, 0, {});
      d.pointerUp(6, 0);
      selectBox(d);
      expect(d.applyOperation("flatten").buildingsChanged).toBe(true);
    });

    it("Raise on a selection, and the hold-to-repeat end", () => {
      const { d } = withShed();
      selectBox(d);
      expect(d.applyOperation("raise").buildingsChanged).toBe(true);
      d.beginOpRepeat("lower");
      d.opRepeatTick();
      expect(d.endOpRepeat().buildingsChanged).toBe(true);
    });

    it("Smooth all", () => {
      const { d } = withShed();
      d.setTool("raise");
      d.pointerDown(6, 0, {});
      d.pointerUp(6, 0);
      expect(d.smoothAll().buildingsChanged).toBe(true);
    });
  });
});
