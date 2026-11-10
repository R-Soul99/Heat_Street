/**
 * Quick 261110-rdx golden guard. A canned sequence of road + sculpt + erase edits
 * is hashed (heights, paint, graph, edge counter). The hash literal below was
 * recorded on the code BEFORE the road lock feature existed; with no road
 * unlocked every later change must reproduce it bit for bit.
 */
import { describe, expect, it } from "vitest";
import type { RoadGraph } from "../src/core/road-graph.ts";
import {
  type BrushParams,
  createStrokeRecorder,
  type HeightOpOptions,
  raiseBlock,
  raiseLower,
  smoothRegion,
} from "../src/core/terrain-brush.ts";
import { createTerrainGrid } from "../src/core/terrain-grid.ts";
import { createPaintMap } from "../src/core/terrain-paint.ts";
import {
  applyRoadStroke,
  eraseRoad,
  type RoadEditTarget,
  roadVertexMask,
} from "../src/core/terrain-road.ts";

const GOLDEN_HASH = "81d74486";

function emptyGraph(half: number): RoadGraph {
  return {
    schemaVersion: 1,
    areaId: "golden",
    name: "Golden",
    source: { osmExtract: "n/a", osmSnapshot: "n/a", demSource: "n/a", compilerVersion: "test" },
    attribution: { osm: "n/a", osmLicense: "n/a", osmLicenseUrl: "n/a", dem: "n/a" },
    origin: { lat: 0, lon: 0, projection: "local" },
    bounds: { minX: -half, minZ: -half, maxX: half, maxZ: half },
    nodes: [],
    edges: [],
  };
}

function makeArea(): RoadEditTarget {
  const sizeM = 200;
  const cell = 2;
  const n = sizeM / cell;
  const grid = createTerrainGrid({
    rows: n,
    cols: n,
    cellSizeM: cell,
    originX: -sizeM / 2,
    originZ: -sizeM / 2,
  });
  const stride = n + 1;
  for (let c = 0; c <= n; c++) {
    for (let r = 0; r <= n; r++) {
      const x = grid.originX + c * cell;
      const z = grid.originZ + r * cell;
      grid.heights[r + c * stride] = 3 * Math.sin(x * 0.04) * Math.cos(z * 0.03);
    }
  }
  return {
    grid,
    paint: createPaintMap({
      originX: -sizeM / 2,
      originZ: -sizeM / 2,
      widthM: sizeM,
      depthM: sizeM,
      metresPerPixel: 0.5,
      fill: "grass",
    }),
    groundSurface: "grass",
    graph: emptyGraph(sizeM / 2),
    nextEdgeId: 0,
  };
}

function line(x0: number, z0: number, x1: number, z1: number, step = 1) {
  const len = Math.hypot(x1 - x0, z1 - z0);
  const n = Math.max(2, Math.ceil(len / step));
  return Array.from({ length: n + 1 }, (_, i) => ({
    x: x0 + ((x1 - x0) * i) / n,
    z: z0 + ((z1 - z0) * i) / n,
  }));
}

function fnv1a(bytes: Uint8Array, seed = 0x811c9dc5): number {
  let h = seed >>> 0;
  for (let i = 0; i < bytes.length; i++) {
    h ^= bytes[i];
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

function hashArea(area: RoadEditTarget): string {
  let h = fnv1a(new Uint8Array(area.grid.heights.buffer, 0, area.grid.heights.byteLength));
  h = fnv1a(area.paint.data, h);
  h = fnv1a(new TextEncoder().encode(JSON.stringify(area.graph)), h);
  h = fnv1a(new TextEncoder().encode(String(area.nextEdgeId)), h);
  return h.toString(16).padStart(8, "0");
}

const BRUSH = (x: number, z: number): BrushParams => ({
  x,
  z,
  radiusM: 14,
  strength: 1,
  falloff: "smooth",
});

/** The canned edit sequence. `free` is passed straight through as roadVertexMask's optional 5th argument. */
function runGoldenSequence(free?: ReadonlySet<number>): string {
  const area = makeArea();
  const opts = (): HeightOpOptions => ({
    roadMask: (win) =>
      free === undefined
        ? roadVertexMask(area.grid, area.paint, area.graph, win)
        : roadVertexMask(area.grid, area.paint, area.graph, win, free),
  });
  applyRoadStroke(area, line(-80, -10, 80, 10), "street");
  applyRoadStroke(
    area,
    [
      { x: -20, z: -70 },
      { x: -10, z: -30 },
      { x: 5, z: 0 },
      { x: 25, z: 30 },
      { x: 40, z: 70 },
    ],
    "highway",
  );
  const rec = createStrokeRecorder(area.grid, area.paint);
  for (const [x, z] of [
    [-40, -5],
    [-30, -2],
    [0, 4],
    [30, 6],
    [-40, 15],
    [20, -20],
  ] as const) {
    raiseLower(area.grid, BRUSH(x, z), 1, 2, rec, opts());
  }
  raiseLower(area.grid, BRUSH(10, 2), -1, 1.5, rec, opts());
  smoothRegion(
    area.grid,
    { minRow: 0, minCol: 0, maxRow: area.grid.rows, maxCol: area.grid.cols },
    { strength: 0.8, passes: 3 },
    rec,
    opts(),
  );
  raiseBlock(area.grid, { x: -10, z: 0, blockCells: 5, stepM: 1 }, 1, rec, opts());
  eraseRoad(area, 60, 8, 8);
  return hashArea(area);
}

describe("golden hash of road edits (no road unlocked)", () => {
  it("matches the value recorded before the lock feature", () => {
    expect(runGoldenSequence()).toBe(GOLDEN_HASH);
  });
});
