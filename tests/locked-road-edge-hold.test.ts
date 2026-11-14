/**
 * D-23 regression (phase 07.1.2-01): sculpting beside a LOCKED road must never change the
 * terrain height at the road's lateral edge, even at an 80 degree slope limit. The old
 * mask held only vertices within max(halfWidth, cell*sqrt2) of the centreline, so the
 * outer vertex of a cell the road touches was free and the cell's interpolated surface
 * at the road edge warped. The fix (opt-in padM on roadVertexMask) holds every vertex of
 * every cell the road touches.
 */
import { describe, expect, it } from "vitest";
import { raiseLower } from "../src/core/terrain-brush.ts";
import { sampleTerrainHeight } from "../src/core/terrain-grid.ts";
import { roadVertexMask } from "../src/core/terrain-road.ts";
import { createEmptyTerrainArea } from "../tools/terrain-editor/new-area.ts";
import {
  createToolDispatcher,
  type EditArea,
  type Tool,
} from "../tools/terrain-editor/tool-dispatch.ts";

type Pt = readonly [number, number];
type Dispatcher = ReturnType<typeof createToolDispatcher>;

function makeArea(sizeM: number, cellSizeM: number): EditArea {
  return {
    ...createEmptyTerrainArea({ areaId: "t", widthM: sizeM, depthM: sizeM, cellSizeM }),
  } as unknown as EditArea;
}

function drawRoad(d: Dispatcher, points: readonly Pt[], widthM: number): void {
  d.setTool("road");
  d.setOptions({ widthM });
  d.pointerDown(points[0][0], points[0][1], {});
  for (let i = 1; i < points.length; i++) d.pointerMove(points[i][0], points[i][1], {});
  const last = points[points.length - 1];
  d.pointerUp(last[0], last[1]);
  d.clearHistory();
}

/** Samples lateral +/- halfWidth (and just inside) at sample positions along a road. */
interface EdgeSample {
  x: number;
  z: number;
}

function straightSamples(halfWidth: number, cellSizeM: number, len: number): EdgeSample[] {
  const out: EdgeSample[] = [];
  const margin = cellSizeM * 2;
  for (let x = -len + margin + 6; x <= len - margin - 6; x += 7.3) {
    for (const lat of [halfWidth, -halfWidth, halfWidth - 0.05, -(halfWidth - 0.05)]) {
      out.push({ x, z: lat });
    }
  }
  return out;
}

function heightsAt(area: EditArea, samples: readonly EdgeSample[]): number[] {
  return samples.map((s) => sampleTerrainHeight(area.grid, s.x, s.z));
}

function dab(d: Dispatcher, x: number, z: number, n: number): void {
  for (let i = 0; i < n; i++) {
    d.pointerDown(x, z, {});
    d.pointerUp(x, z);
  }
}

function maxChange(before: readonly number[], after: readonly number[]): number {
  let m = 0;
  for (let i = 0; i < before.length; i++) m = Math.max(m, Math.abs(after[i] - before[i]));
  return m;
}

const CASES: ReadonlyArray<readonly [number, number, number]> = [
  [3, 7, 35],
  [3, 7, 80],
  [3, 10, 80],
  [2, 6, 80],
  [1, 6, 80],
];
const SIZE = 240;
const HALF_LEN = 80;

describe.each(CASES)(
  "locked road edge hold (cell %d m, road %d m wide, slope %d deg)",
  (cellSizeM, widthM, slopeDeg) => {
    const tools: Tool[] = ["raise", "lower", "smooth", "flatten"];
    it.each(tools)("%s beside a locked road leaves the edge untouched", (tool) => {
      const area = makeArea(SIZE, cellSizeM);
      const d = createToolDispatcher(() => area);
      drawRoad(
        d,
        [
          [-HALF_LEN, 0],
          [-40, 0],
          [0, 0],
          [40, 0],
          [HALF_LEN, 0],
        ],
        widthM,
      );
      const half = widthM / 2;
      const samples = straightSamples(half, cellSizeM, HALF_LEN);
      const before = heightsAt(area, samples);
      d.setTool(tool);
      d.setOptions({ slopeLimitDeg: slopeDeg, radiusM: 15, strength: 1 });
      dab(d, 0, 14, 60);
      expect(maxChange(before, heightsAt(area, samples))).toBeLessThan(1e-6);
    });
  },
);

describe("locked road edge hold, other geometry", () => {
  it("diagonal road", () => {
    const area = makeArea(SIZE, 3);
    const d = createToolDispatcher(() => area);
    drawRoad(
      d,
      [
        [-60, -60],
        [-30, -30],
        [0, 0],
        [30, 30],
        [60, 60],
      ],
      7,
    );
    const nx = -Math.SQRT1_2;
    const nz = Math.SQRT1_2;
    const samples: EdgeSample[] = [];
    for (let t = -36; t <= 36; t += 9) {
      for (const lat of [3.5, -3.5, 3.45, -3.45]) {
        samples.push({ x: t + nx * lat, z: t + nz * lat });
      }
    }
    const before = heightsAt(area, samples);
    d.setTool("raise");
    d.setOptions({ slopeLimitDeg: 80, radiusM: 15, strength: 1 });
    dab(d, nx * 14, nz * 14, 60);
    expect(maxChange(before, heightsAt(area, samples))).toBeLessThan(1e-6);
  });

  it("curved road", () => {
    const area = makeArea(SIZE, 3);
    const d = createToolDispatcher(() => area);
    const R = 80;
    const pts: Pt[] = [];
    for (let k = -4; k <= 4; k++) {
      const th = -Math.PI / 2 + k * 0.15;
      pts.push([R * Math.cos(th), 80 + R * Math.sin(th)]);
    }
    drawRoad(d, pts, 7);
    const samples: EdgeSample[] = [];
    for (let k = -2; k <= 2; k++) {
      const th = -Math.PI / 2 + k * 0.15;
      for (const rr of [R + 3.5, R - 3.5, R + 3.45, R - 3.45]) {
        samples.push({ x: rr * Math.cos(th), z: 80 + rr * Math.sin(th) });
      }
    }
    const before = heightsAt(area, samples);
    d.setTool("raise");
    d.setOptions({ slopeLimitDeg: 80, radiusM: 15, strength: 1 });
    // Outside of the curve at the apex (road apex is at z = 0, outside is lower z).
    dab(d, 0, -14, 60);
    expect(maxChange(before, heightsAt(area, samples))).toBeLessThan(1e-6);
  });

  it("unlocked road still moves", () => {
    const area = makeArea(SIZE, 3);
    const d = createToolDispatcher(() => area);
    drawRoad(
      d,
      [
        [-HALF_LEN, 0],
        [0, 0],
        [HALF_LEN, 0],
      ],
      7,
    );
    const samples = straightSamples(3.5, 3, HALF_LEN);
    const before = heightsAt(area, samples);
    area.unlockedEdgeIds = area.graph.edges.map((e) => e.id);
    expect(area.unlockedEdgeIds.length).toBeGreaterThan(0);
    d.setTool("raise");
    d.setOptions({ slopeLimitDeg: 80, radiusM: 15, strength: 1 });
    dab(d, 0, 14, 60);
    expect(maxChange(before, heightsAt(area, samples))).toBeGreaterThan(0.01);
  });

  it("unpadded mask proves the bug", () => {
    const area = makeArea(SIZE, 3);
    const d = createToolDispatcher(() => area);
    drawRoad(
      d,
      [
        [-HALF_LEN, 0],
        [0, 0],
        [HALF_LEN, 0],
      ],
      7,
    );
    const samples = straightSamples(3.5, 3, HALF_LEN);
    const before = heightsAt(area, samples);
    const grid = area.grid;
    const opts = {
      roadMask: (w: Parameters<typeof roadVertexMask>[3]) =>
        roadVertexMask(grid, area.paint, area.graph, w),
      maxSlopeDeg: 80,
    };
    for (let i = 0; i < 60; i++) {
      raiseLower(
        grid,
        { x: 0, z: 14, radiusM: 15, strength: 1, falloff: "smooth" },
        1,
        1,
        undefined,
        opts,
      );
    }
    expect(maxChange(before, heightsAt(area, samples))).toBeGreaterThan(0.1);
  });
});

describe("selection operations", () => {
  const boxes: ReadonlyArray<readonly [string, Pt, Pt]> = [
    ["overlapping the road", [-60, -24], [60, 24]],
    ["abutting the road", [-60, 3.5], [60, 36]],
  ];
  const ops = ["raise", "lower", "flatten", "smooth", "terrain"] as const;

  describe.each(boxes)("selection %s", (_name, a, b) => {
    it.each(ops)("%s leaves the road edge untouched (80 degree limit)", (op) => {
      const area = makeArea(SIZE, 3);
      const d = createToolDispatcher(() => area);
      drawRoad(
        d,
        [
          [-HALF_LEN, 0],
          [-40, 0],
          [0, 0],
          [40, 0],
          [HALF_LEN, 0],
        ],
        7,
      );
      const samples = straightSamples(3.5, 3, HALF_LEN);
      const before = heightsAt(area, samples);
      d.setMode("select");
      d.pointerDown(a[0], a[1], {});
      d.pointerUp(b[0], b[1]);
      expect(d.selectionCellCount()).toBeGreaterThan(0);
      d.setOptions({ slopeLimitDeg: 80, selectStepM: 5, selectSmoothStrength: 1 });
      if (op === "raise" || op === "lower" || op === "smooth") {
        d.beginOpRepeat(op);
        for (let i = 0; i < 10; i++) d.opRepeatTick();
        d.endOpRepeat();
      } else {
        d.applyOperation(op);
      }
      expect(maxChange(before, heightsAt(area, samples))).toBeLessThan(1e-6);
    });
  });
});
