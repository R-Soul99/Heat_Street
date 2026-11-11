import { describe, expect, it } from "vitest";
import { sampleTerrainHeight } from "../../src/core/terrain-grid.ts";
import { PAINT_ROAD_FLAG, surfaceAt } from "../../src/core/terrain-paint.ts";
import { roadVertexMask } from "../../src/core/terrain-road.ts";
import { createEmptyTerrainArea } from "./new-area.ts";
import { createToolDispatcher, type EditArea, TOOL_KEYS } from "./tool-dispatch.ts";

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

describe("TOOL_KEYS", () => {
  it("maps the UI-SPEC keys", () => {
    expect(TOOL_KEYS).toMatchObject({
      KeyH: "raise",
      KeyG: "smooth",
      KeyF: "flatten",
      KeyP: "paint",
      KeyR: "road",
      KeyW: "stamp",
      KeyE: "erase",
    });
  });
});

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

  it("default strength is 1 and blockDirection is 1; setOptions clamps direction", () => {
    const { d } = setup();
    expect(d.getOptions().strength).toBe(1);
    expect(d.getOptions().blockDirection).toBe(1);
    d.setOptions({ blockDirection: -5 as unknown as -1 });
    expect(d.getOptions().blockDirection).toBe(-1);
    d.setOptions({ blockDirection: 7 as unknown as 1 });
    expect(d.getOptions().blockDirection).toBe(1);
  });

  it("every tool has a key", () => {
    expect(TOOL_KEYS.KeyJ).toBe("lower");
    expect(TOOL_KEYS.KeyM).toBe("smoothBox");
    expect(new Set(Object.values(TOOL_KEYS)).size).toBe(Object.keys(TOOL_KEYS).length);
    expect(Object.values(TOOL_KEYS).sort()).toEqual(
      [
        "gridSelect",
        "raise",
        "lower",
        "smooth",
        "flatten",
        "paint",
        "road",
        "stamp",
        "erase",
        "block",
        "smoothBox",
        "lock",
      ].sort(),
    );
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

describe("stamp", () => {
  it("click places a stamp; rotate steps 15 degrees; drag sets length (min 4 m)", () => {
    const { area, d } = setup();
    d.setTool("stamp");
    d.setOptions({ stampKind: "wedge", stampHeightM: 3, stampWidthM: 10, stampLengthM: 20 });
    d.rotateStamp(1);
    expect(d.getOptions().stampRotationRad).toBeCloseTo((15 * Math.PI) / 180, 9);
    d.rotateStamp(-1);
    d.rotateStamp(-1);
    expect(d.getOptions().stampRotationRad).toBeCloseTo((-15 * Math.PI) / 180, 9);
    d.rotateStamp(1);
    d.pointerDown(0, 0, {});
    d.pointerUp(30, 0);
    expect(d.getOptions().stampLengthM).toBeCloseTo(30, 6);
    expect(sampleTerrainHeight(area.grid, 12, 0)).toBeGreaterThan(0.5);
    expect(d.canUndo()).toBe(true);

    d.pointerDown(60, 60, {});
    d.pointerUp(61, 60);
    expect(d.getOptions().stampLengthM).toBeGreaterThanOrEqual(4);
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

describe("block and smooth tools (04.3-07)", () => {
  it("maps KeyB to block", () => {
    expect(TOOL_KEYS.KeyB).toBe("block");
  });

  it("has block/smooth defaults and clamps setOptions", () => {
    const { d } = setup();
    expect(d.getOptions()).toMatchObject({
      blockCells: 2,
      blockStepM: 1,
      smoothStrength: 0.5,
      smoothPasses: 3,
    });
    d.setOptions({ blockCells: 999, blockStepM: 0.1, smoothStrength: 5, smoothPasses: 99 });
    expect(d.getOptions()).toMatchObject({
      blockCells: 64,
      blockStepM: 0.25,
      smoothStrength: 1,
      smoothPasses: 10,
    });
    d.setOptions({ blockCells: 2.6, blockStepM: 1.3 });
    expect(d.getOptions().blockCells).toBe(3);
    expect(d.getOptions().blockStepM).toBe(1.25);
    d.setOptions({ blockCells: Number.NaN, blockStepM: Number.NaN, smoothPasses: Number.NaN });
    expect(d.getOptions()).toMatchObject({ blockCells: 3, blockStepM: 1.25, smoothPasses: 10 });
  });

  it("block click raises one block by the step, one undo entry, bit-exact undo", () => {
    const { area, d } = setup();
    const before = Float32Array.from(area.grid.heights);
    d.setTool("block");
    d.pointerDown(1, 1, {});
    d.pointerUp(1, 1);
    expect(Math.max(...area.grid.heights)).toBeCloseTo(1, 5);
    expect(d.canUndo()).toBe(true);
    d.undo();
    expect(d.canUndo()).toBe(false);
    expect(Array.from(area.grid.heights)).toEqual(Array.from(before));
  });

  it("blockDirection -1 lowers the block", () => {
    const { area, d } = setup();
    d.setTool("block");
    d.setOptions({ blockDirection: -1 });
    d.pointerDown(1, 1, {});
    d.pointerUp(1, 1);
    expect(Math.min(...area.grid.heights)).toBeCloseTo(-1, 5);
  });

  it("a drag steps each block exactly once, one undo entry", () => {
    const { area, d } = setup();
    d.setTool("block");
    d.setOptions({ blockCells: 1 });
    const pts: [number, number][] = [];
    for (let x = 1; x <= 10; x += 0.5) pts.push([x, 1]);
    drag(d, pts);
    expect(Math.max(...area.grid.heights)).toBeLessThanOrEqual(1.0001);
    expect(Math.max(...area.grid.heights)).toBeGreaterThan(0.5);
    d.undo();
    expect(d.canUndo()).toBe(false);
    expect(Math.max(...area.grid.heights)).toBe(0);
  });

  it("smoothBox smooths a box as one undo step", () => {
    const { area, d } = setup();
    d.setTool("block");
    d.setOptions({ blockCells: 2, blockStepM: 3 });
    drag(d, [[0, 0]]);
    const afterBlock = Float32Array.from(area.grid.heights);
    d.setTool("smoothBox");
    drag(d, [
      [-12, -12],
      [12, 12],
    ]);
    expect(Array.from(area.grid.heights)).not.toEqual(Array.from(afterBlock));
    d.undo();
    expect(Array.from(area.grid.heights)).toEqual(Array.from(afterBlock));
    d.undo();
    expect(d.canUndo()).toBe(false);
  });

  it("smoothBox is a corner-to-corner drag rectangle; preview matches the edit", () => {
    const { area, d } = setup();
    d.setTool("block");
    d.setOptions({ blockCells: 2, blockStepM: 3 });
    drag(d, [[0, 0]]);
    d.setTool("smoothBox");
    expect(d.smoothBoxWindow(0, 0)).toBeNull();
    d.pointerDown(-10, -10, {});
    const g = area.grid;
    const col = (x: number) => (x - g.originX) / g.cellSizeM;
    const row = (z: number) => (z - g.originZ) / g.cellSizeM;
    const w = d.smoothBoxWindow(14, 8);
    expect(w).toEqual({
      minCol: Math.floor(col(-10)),
      maxCol: Math.ceil(col(14)),
      minRow: Math.floor(row(-10)),
      maxRow: Math.ceil(row(8)),
    });
    // Dragging the other way gives the same window (true corner-to-corner).
    expect(d.smoothBoxWindow(-30, -20)).toEqual({
      minCol: Math.floor(col(-30)),
      maxCol: Math.ceil(col(-10)),
      minRow: Math.floor(row(-20)),
      maxRow: Math.ceil(row(-10)),
    });
    const up = d.pointerUp(14, 8);
    expect(up.dirtyHeights).toBeDefined();
    // The dirty rebuild window may pad the box by up to two cells for normals, never more.
    expect(up.dirtyHeights?.minCol).toBeGreaterThanOrEqual((w?.minCol ?? 0) - 2);
    expect(up.dirtyHeights?.maxCol).toBeLessThanOrEqual((w?.maxCol ?? 0) + 2);
    expect(d.smoothBoxWindow(14, 8)).toBeNull();
  });

  it("cancelBoxDrag drops a smoothBox drag without an undo entry", () => {
    const { d } = setup();
    d.setTool("smoothBox");
    d.pointerDown(0, 0, {});
    expect(d.cancelBoxDrag()).toBe(true);
    expect(d.isStroking()).toBe(false);
    expect(d.canUndo()).toBe(false);
    expect(d.cancelBoxDrag()).toBe(false);
  });

  it("smoothAll is one undo entry", () => {
    const { area, d } = setup();
    d.setTool("block");
    d.setOptions({ blockStepM: 3 });
    drag(d, [[0, 0]]);
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
    d.setTool("block");
    d.setOptions({ blockStepM: 3 });
    drag(d, [[30, 30]]);
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

describe("road lock tool (quick 261110-rdx)", () => {
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
    d.setTool("block");
    d.setOptions({ blockStepM: 4, blockCells: 8 });
    return d.pointerDown(x, z, {}) && d.pointerUp(x, z);
  }

  it("L selects the lock tool", () => {
    expect(TOOL_KEYS.KeyL).toBe("lock");
  });

  it("click unlocks a road, a second click locks it; each is one undo step", () => {
    const { area, d, id } = withRoad();
    d.setTool("lock");
    const a = d.pointerDown(0, 1, {});
    expect(a.lockChanged).toBe(true);
    expect(a.status).toContain("Unlocked");
    expect(a.status).toContain("Re-grade");
    expect(area.unlockedEdgeIds).toEqual([id]);
    expect(d.getSelectedEdgeId()).toBe(id);
    const b = d.pointerDown(0, 1, {});
    expect(b.status).toContain("Locked road");
    expect(area.unlockedEdgeIds).toEqual([]);
    d.undo();
    expect(area.unlockedEdgeIds).toEqual([id]);
    d.undo();
    expect(area.unlockedEdgeIds).toEqual([]);
    expect(d.canUndo()).toBe(false);
  });

  it("clicking empty ground says so and pushes nothing", () => {
    const { d } = withRoad();
    d.setTool("lock");
    const r = d.pointerDown(0, 90, {});
    expect(r.status).toBe("No road under the cursor.");
    expect(d.canUndo()).toBe(false);
  });

  it("Shift+click selects without toggling", () => {
    const { area, d, id } = withRoad();
    d.setTool("lock");
    const r = d.pointerDown(0, 0, { shift: true });
    expect(r.selectionChanged).toBe(true);
    expect(d.getSelectedEdgeId()).toBe(id);
    expect(area.unlockedEdgeIds ?? []).toEqual([]);
    expect(d.canUndo()).toBe(false);
  });

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

  it("re-grade selected warns on a locked road and pushes nothing", () => {
    const { d, id } = withRoad();
    d.setTool("lock");
    d.pointerDown(0, 0, { shift: true });
    const r = d.regradeSelected();
    expect(r.warnings).toContain(`Road ${id} is locked; unlock it to re-grade.`);
    expect(d.canUndo()).toBe(false);
    d.clearHistory();
    expect(d.regradeSelected().status).toContain("Select a road first");
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

describe("grid select (07.1)", () => {
  const A = { x: -30, z: -30 };
  const B = { x: -9, z: -9 };

  function selected() {
    const s = setup();
    s.d.setTool("gridSelect");
    s.d.pointerDown(A.x, A.z, {});
    s.d.pointerMove(B.x, B.z, {});
    s.d.pointerUp(B.x, B.z);
    return s;
  }

  function winHeights(
    area: EditArea,
    win: NonNullable<ReturnType<ReturnType<typeof setup>["d"]["getSelection"]>>,
  ) {
    const out: number[] = [];
    const stride = area.grid.rows + 1;
    for (let c = win.minCol; c <= win.maxCol; c++) {
      for (let r = win.minRow; r <= win.maxRow; r++) out.push(area.grid.heights[r + c * stride]);
    }
    return out;
  }

  it("KeyS selects the gridSelect tool", () => {
    expect(TOOL_KEYS.KeyS).toBe("gridSelect");
  });

  it("dragging selects a window without editing or undo entry", () => {
    const { area, d } = setup();
    d.setTool("gridSelect");
    d.pointerDown(A.x, A.z, {});
    const live = d.selectionPreview(B.x, B.z);
    d.pointerMove(B.x, B.z, {});
    const up = d.pointerUp(B.x, B.z);
    const sel = d.getSelection();
    expect(sel).toEqual({ minCol: 30, maxCol: 37, minRow: 30, maxRow: 37 });
    expect(live).toEqual(sel);
    expect(up.selectionChanged).toBe(true);
    expect(d.canUndo()).toBe(false);
    expect(Math.max(...(area.grid.heights as unknown as number[]))).toBe(0);
  });

  it("a click selects the single cell under the pointer", () => {
    const { d } = setup();
    d.setTool("gridSelect");
    d.pointerDown(-29, -29, {});
    d.pointerUp(-29, -29);
    const w = d.getSelection();
    expect(w).toBeTruthy();
    expect((w?.maxCol as number) - (w?.minCol as number)).toBe(1);
    expect((w?.maxRow as number) - (w?.minRow as number)).toBe(1);
  });

  it("raiseSelection steps by selectStepM as one undo entry and keeps the selection", () => {
    const { area, d } = selected();
    const sel = d.getSelection() as NonNullable<ReturnType<typeof d.getSelection>>;
    const before = winHeights(area, sel);
    const r = d.raiseSelection(1);
    expect(r.dirtyHeights).toBeDefined();
    expect(winHeights(area, sel)).toEqual(before.map((h) => h + 1));
    expect(d.getSelection()).toEqual(sel);
    d.raiseSelection(-1);
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

  it("raiseSelection without a selection reports and pushes nothing", () => {
    const { d } = setup();
    const r = d.raiseSelection(1);
    expect(r.status).toBe("Select some cells first (Grid select, S).");
    expect(d.canUndo()).toBe(false);
  });

  it("push/pull is absolute from the snapshot and one undo entry", () => {
    const { area, d } = selected();
    const sel = d.getSelection() as NonNullable<ReturnType<typeof d.getSelection>>;
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
    const sel = d.getSelection() as NonNullable<ReturnType<typeof d.getSelection>>;
    const base = winHeights(area, sel);
    d.beginPushPull();
    d.pushPullTo(3);
    d.cancelPushPull();
    expect(winHeights(area, sel)).toEqual(base);
    expect(d.canUndo()).toBe(false);
  });

  it("pushPullTo clamps delta to 50 m", () => {
    const { area, d } = selected();
    const sel = d.getSelection() as NonNullable<ReturnType<typeof d.getSelection>>;
    d.beginPushPull();
    d.pushPullTo(500);
    const max = Math.max(...winHeights(area, sel));
    expect(max).toBeLessThanOrEqual(50);
    d.cancelPushPull();
  });

  it("Ctrl+pointerDown on an existing selection starts push/pull, not a new band", () => {
    const { d } = selected();
    const sel = d.getSelection();
    const r = d.pointerDown(60, 60, { ctrl: true });
    expect(r.pushPullStarted).toBe(true);
    d.pointerMove(90, 90, {});
    d.pointerUp(90, 90);
    expect(d.getSelection()).toEqual(sel);
    d.cancelPushPull();
  });

  it("road-held vertices keep their height under raiseSelection and pushPullTo", () => {
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
    d.setTool("gridSelect");
    d.pointerDown(-20, -20, {});
    d.pointerUp(20, 20);
    const sel = d.getSelection() as NonNullable<ReturnType<typeof d.getSelection>>;
    const stride = area.grid.rows + 1;
    const held: number[] = [];
    for (let c = sel.minCol; c <= sel.maxCol; c++) {
      for (let r = sel.minRow; r <= sel.maxRow; r++)
        if (mask[r + c * stride]) held.push(r + c * stride);
    }
    expect(held.length).toBeGreaterThan(0);
    const before = held.map((i) => area.grid.heights[i]);
    const r1 = d.raiseSelection(1);
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
    d.setTool("gridSelect");
    d.pointerDown(-1000, -1000, {});
    d.pointerUp(1000, 1000);
    expect(d.getSelection()).toEqual({ minRow: 0, minCol: 0, maxRow: 80, maxCol: 80 });
    d.clearSelection();
    expect(d.getSelection()).toBeNull();
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
