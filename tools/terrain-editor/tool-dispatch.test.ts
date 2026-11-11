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

function drag(d: ReturnType<typeof setup>["d"], pts: [number, number][], alt = false) {
  d.pointerDown(pts[0][0], pts[0][1], { alt });
  for (let i = 1; i < pts.length; i++) d.pointerMove(pts[i][0], pts[i][1], { alt });
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
  it("raise stroke is one undo entry and raises terrain; alt is ignored", () => {
    const { area, d } = setup();
    d.setTool("raise");
    const down = d.pointerDown(0, 0, { alt: false });
    expect(down.dirtyHeights).toBeDefined();
    d.pointerMove(8, 0, { alt: false });
    d.pointerMove(16, 0, { alt: false });
    d.pointerMove(24, 0, { alt: false });
    d.pointerUp(24, 0);
    expect(sampleTerrainHeight(area.grid, 10, 0)).toBeGreaterThan(0);
    expect(d.canUndo()).toBe(true);
    d.undo();
    expect(d.canUndo()).toBe(false);
    expect(sampleTerrainHeight(area.grid, 10, 0)).toBe(0);

    drag(
      d,
      [
        [0, 0],
        [10, 0],
      ],
      true,
    );
    expect(sampleTerrainHeight(area.grid, 5, 0)).toBeGreaterThan(0);
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
    const r = d.pointerDown(Number.NaN, 0, { alt: false });
    expect(r.dirtyHeights).toBeUndefined();
    d.pointerMove(Number.POSITIVE_INFINITY, 0);
    d.pointerUp(0, 0);
    expect(d.canUndo()).toBe(false);
  });

  it("spaces dabs at radius/4 along the drag", () => {
    const { area, d } = setup();
    d.setTool("raise");
    d.setOptions({ radiusM: 8, strength: 0.2 });
    d.pointerDown(-40, 0, { alt: false });
    d.pointerMove(40, 0, { alt: false });
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
    const down = d.pointerDown(-60, 0, { alt: false });
    expect(down.previewPoints).toHaveLength(1);
    const mv = d.pointerMove(-20, 0, { alt: false });
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
    const r = d.pointerDown(0, 0, { alt: false });
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
    d.pointerDown(0, 0, { alt: false });
    d.pointerUp(30, 0);
    expect(d.getOptions().stampLengthM).toBeCloseTo(30, 6);
    expect(sampleTerrainHeight(area.grid, 12, 0)).toBeGreaterThan(0.5);
    expect(d.canUndo()).toBe(true);

    d.pointerDown(60, 60, { alt: false });
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
    d.pointerDown(1, 1, { alt: false });
    d.pointerUp(1, 1);
    expect(Math.max(...area.grid.heights)).toBeCloseTo(1, 5);
    expect(d.canUndo()).toBe(true);
    d.undo();
    expect(d.canUndo()).toBe(false);
    expect(Array.from(area.grid.heights)).toEqual(Array.from(before));
  });

  it("blockDirection -1 lowers the block; alt no longer does", () => {
    const { area, d } = setup();
    d.setTool("block");
    expect(d.getOptions().blockDirection).toBe(1);
    d.setOptions({ blockDirection: -1 });
    d.pointerDown(1, 1, { alt: false });
    d.pointerUp(1, 1);
    expect(Math.min(...area.grid.heights)).toBeCloseTo(-1, 5);
    d.undo();
    d.setOptions({ blockDirection: 1 });
    d.pointerDown(1, 1, { alt: true });
    d.pointerUp(1, 1);
    expect(Math.min(...area.grid.heights)).toBe(0);
    expect(Math.max(...area.grid.heights)).toBeCloseTo(1, 5);
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
    d.pointerDown(-10, -10, { alt: false });
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
    d.pointerDown(0, 0, { alt: false });
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
    return d.pointerDown(x, z, { alt: false }) && d.pointerUp(x, z);
  }

  it("L selects the lock tool", () => {
    expect(TOOL_KEYS.KeyL).toBe("lock");
  });

  it("click unlocks a road, a second click locks it; each is one undo step", () => {
    const { area, d, id } = withRoad();
    d.setTool("lock");
    const a = d.pointerDown(0, 1, { alt: false });
    expect(a.lockChanged).toBe(true);
    expect(a.status).toContain("Unlocked");
    expect(a.status).toContain("Re-grade");
    expect(area.unlockedEdgeIds).toEqual([id]);
    expect(d.getSelectedEdgeId()).toBe(id);
    const b = d.pointerDown(0, 1, { alt: false });
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
    const r = d.pointerDown(0, 90, { alt: false });
    expect(r.status).toBe("No road under the cursor.");
    expect(d.canUndo()).toBe(false);
  });

  it("shift+click selects without toggling (alt kept as an alias)", () => {
    const { area, d, id } = withRoad();
    d.setTool("lock");
    const r = d.pointerDown(0, 0, { shift: true });
    expect(r.selectionChanged).toBe(true);
    expect(d.getSelectedEdgeId()).toBe(id);
    expect(area.unlockedEdgeIds ?? []).toEqual([]);
    expect(d.canUndo()).toBe(false);
    d.pointerDown(0, 0, { alt: true });
    expect(area.unlockedEdgeIds ?? []).toEqual([]);
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
    const msg = d.regradeSelected().status;
    expect(msg).toContain("Select a road first");
    expect(msg).toContain("Shift+click");
  });

  it("an erase stroke that carries locks merges the lock into its single undo entry", () => {
    const { area, d, id } = withRoad();
    d.lockAll(false);
    d.clearHistory();
    d.setTool("erase");
    d.setOptions({ radiusM: 6 });
    const r = d.pointerDown(0, 0, { alt: false });
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

describe("lower tool and keys (07.1-06)", () => {
  it("adds the new keys and keeps the old ones", () => {
    expect(TOOL_KEYS).toMatchObject({
      KeyH: "raise",
      KeyJ: "lower",
      KeyA: "smoothBox",
      KeyV: "gridSelect",
      KeyG: "smooth",
      KeyB: "block",
      KeyL: "lock",
    });
  });

  it("lower click lowers the centre as one undo entry", () => {
    const { area, d } = setup();
    d.setTool("lower");
    d.pointerDown(0, 0, { alt: false });
    d.pointerUp(0, 0);
    expect(Math.min(...area.grid.heights)).toBeLessThan(0);
    expect(d.canUndo()).toBe(true);
    d.undo();
    expect(d.canUndo()).toBe(false);
    expect(Math.min(...area.grid.heights)).toBe(0);
  });

  it("raise ignores alt", () => {
    const { area, d } = setup();
    d.setTool("raise");
    d.pointerDown(0, 0, { alt: true });
    d.pointerUp(0, 0);
    expect(Math.min(...area.grid.heights)).toBe(0);
    expect(Math.max(...area.grid.heights)).toBeGreaterThan(0);
  });

  it("a raise click reports heightChange on pointerUp", () => {
    const { d } = setup();
    d.setTool("raise");
    d.pointerDown(0, 0, { alt: false });
    const up = d.pointerUp(0, 0);
    expect(up.heightChange?.maxUpM).toBeGreaterThan(0);
  });

  it("a click on a road says why nothing changed", () => {
    const s = setup();
    s.d.setTool("road");
    drag(s.d, [
      [-80, 0],
      [-40, 0],
      [0, 0],
      [40, 0],
      [80, 0],
    ]);
    s.d.clearHistory();
    s.d.setTool("raise");
    s.d.setOptions({ radiusM: 4 });
    const r = s.d.pointerDown(0, 0, { alt: false });
    s.d.pointerUp(0, 0);
    expect(r.dirtyHeights).toBeUndefined();
    expect(r.status).toMatch(/^Nothing changed: /);
    expect(r.status).toContain("road");
    expect(r.status).toContain("Lock tool (L)");
    expect(r.heldVertices).toBeGreaterThan(0);
    s.d.setTool("raise");
    const open = s.d.pointerDown(0, 90, { alt: false });
    s.d.pointerUp(0, 90);
    expect(open.heldVertices ?? 0).toBe(0);
  });
});

describe("grid select (07.1-06)", () => {
  const select = (d: ReturnType<typeof setup>["d"], a: [number, number], b: [number, number]) => {
    d.setTool("gridSelect");
    d.pointerDown(a[0], a[1], {});
    d.pointerMove(b[0], b[1], {});
    return d.pointerUp(b[0], b[1]);
  };

  it("a drag selects a rectangle that persists, with no undo entry", () => {
    const { d } = setup();
    d.setTool("gridSelect");
    d.pointerDown(-30, -30, {});
    d.pointerMove(0, 0, {});
    const live = d.gridSelectDragWindow(30, 30);
    expect(live).not.toBeNull();
    expect(d.gridSelectDragWindow(Number.NaN, 0)).toBeNull();
    const up = d.pointerUp(30, 30);
    expect(up.gridSelectionChanged).toBe(true);
    expect(d.getGridSelection()).toEqual(live);
    expect(d.canUndo()).toBe(false);
    expect(d.gridSelectDragWindow(0, 0)).toBeNull();
  });

  it("raiseSelection steps by gridStepM as one undo entry; undo restores exactly", () => {
    const { area, d } = setup();
    const before = Float32Array.from(area.grid.heights);
    select(d, [-30, -30], [30, 30]);
    d.setOptions({ gridStepM: 2 });
    const r = d.raiseSelection(1);
    expect(r.dirtyHeights).toBeDefined();
    expect(r.heightChange?.maxUpM).toBeCloseTo(2, 4);
    expect(sampleTerrainHeight(area.grid, 0, 0)).toBeCloseTo(2, 4);
    expect(d.canUndo()).toBe(true);
    d.raiseSelection(-1);
    expect(sampleTerrainHeight(area.grid, 0, 0)).toBeCloseTo(0, 4);
    d.undo();
    d.undo();
    expect(d.canUndo()).toBe(false);
    expect(Array.from(area.grid.heights)).toEqual(Array.from(before));
  });

  it("clamps gridStepM and blockDirection", () => {
    const { d } = setup();
    d.setOptions({ gridStepM: 99 });
    expect(d.getOptions().gridStepM).toBe(5);
    d.setOptions({ gridStepM: 0.01 });
    expect(d.getOptions().gridStepM).toBe(0.25);
    d.setOptions({ gridStepM: 1.3 });
    expect(d.getOptions().gridStepM).toBe(1.25);
    d.setOptions({ blockDirection: -7 as never });
    expect(d.getOptions().blockDirection).toBe(-1);
  });

  it("raiseSelection without a selection reports and pushes nothing", () => {
    const { d } = setup();
    const r = d.raiseSelection(1);
    expect(r.status).toBe("Drag a selection first (Grid select, V).");
    expect(d.canUndo()).toBe(false);
  });

  it("push/pull is absolute: +5 then 0 restores every height; one undo entry", () => {
    const { area, d } = setup();
    select(d, [-30, -30], [30, 30]);
    d.setOptions({ gridStepM: 1 });
    d.raiseSelection(1);
    d.clearHistory();
    // clearHistory drops the selection; reselect.
    select(d, [-30, -30], [30, 30]);
    const start = Float32Array.from(area.grid.heights);
    const h0 = sampleTerrainHeight(area.grid, 0, 0);
    d.pointerDown(0, 0, { ctrl: true });
    expect(d.isStroking()).toBe(true);
    const a = d.pushPullTo(2);
    expect(a.dirtyHeights).toBeDefined();
    expect(sampleTerrainHeight(area.grid, 0, 0)).toBeCloseTo(h0 + 2, 3);
    d.pushPullTo(20);
    d.pushPullTo(0);
    expect(Array.from(area.grid.heights)).toEqual(Array.from(start));
    d.pushPullTo(3);
    d.pointerUp(0, 0);
    expect(d.isStroking()).toBe(false);
    expect(sampleTerrainHeight(area.grid, 0, 0)).toBeCloseTo(h0 + 3, 3);
    expect(d.canUndo()).toBe(true);
    d.undo();
    expect(d.canUndo()).toBe(false);
    expect(Array.from(area.grid.heights)).toEqual(Array.from(start));
  });

  it("ctrl-down with no selection reports and changes nothing", () => {
    const { area, d } = setup();
    d.setTool("gridSelect");
    const r = d.pointerDown(0, 0, { ctrl: true });
    expect(r.status).toBe("Drag a selection first (Grid select, V).");
    expect(d.isStroking()).toBe(false);
    expect(d.pushPullTo(3).dirtyHeights).toBeUndefined();
    expect(Math.max(...area.grid.heights)).toBe(0);
  });

  it("clearGridSelection and clearHistory clear it; selection is clipped", () => {
    const { area, d } = setup();
    select(d, [-500, -500], [500, 500]);
    const sel = d.getGridSelection();
    expect(sel).toEqual({
      minRow: 0,
      minCol: 0,
      maxRow: area.grid.rows,
      maxCol: area.grid.cols,
    });
    expect(d.clearGridSelection().gridSelectionChanged).toBe(true);
    expect(d.getGridSelection()).toBeNull();
    select(d, [-30, -30], [30, 30]);
    d.clearHistory();
    expect(d.getGridSelection()).toBeNull();
  });

  it("road-held vertices inside the selection do not move", () => {
    const s = setup();
    s.d.setTool("road");
    drag(s.d, [
      [-80, 0],
      [-40, 0],
      [0, 0],
      [40, 0],
      [80, 0],
    ]);
    s.d.clearHistory();
    const mask = roadVertexMask(s.area.grid, s.area.paint, s.area.graph, {
      minRow: 0,
      minCol: 0,
      maxRow: s.area.grid.rows,
      maxCol: s.area.grid.cols,
    });
    const before = Float32Array.from(s.area.grid.heights);
    select(s.d, [-30, -30], [30, 30]);
    s.d.raiseSelection(1);
    let heldMoved = 0;
    let freeMoved = 0;
    for (let i = 0; i < mask.length; i++) {
      const moved = s.area.grid.heights[i] !== before[i];
      if (mask[i] && moved) heldMoved++;
      if (!mask[i] && moved) freeMoved++;
    }
    expect(mask.some((v) => v !== 0)).toBe(true);
    expect(heldMoved).toBe(0);
    expect(freeMoved).toBeGreaterThan(0);
  });
});
