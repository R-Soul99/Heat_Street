import { describe, expect, it } from "vitest";
import type { RoadGraph } from "../src/core/road-graph";
import {
  BERM_HEIGHT_M,
  BERM_INSET_M,
  BERM_RUN_MAX_DROP_M,
  BERM_RUN_MAX_M,
  BERM_THICKNESS_M,
  type BermBox,
  buildEdgeBerm,
  roadsClearOfGridEdge,
} from "../src/core/terrain-edge-berm";
import { createTerrainGrid, type TerrainGrid } from "../src/core/terrain-grid";

function contains(b: BermBox, x: number, z: number): boolean {
  return Math.abs(x - b.cx) <= b.hx + 1e-9 && Math.abs(z - b.cz) <= b.hz + 1e-9;
}

function flat(): TerrainGrid {
  return createTerrainGrid({ rows: 20, cols: 20, cellSizeM: 3, originX: -30, originZ: -30 });
}

describe("buildEdgeBerm", () => {
  it("covers all four edges with no gap", () => {
    const g = flat();
    const boxes = buildEdgeBerm(g);
    const mid = BERM_THICKNESS_M / 2 - BERM_INSET_M; // mid-thickness, relative to the edge (outward +)
    for (let i = 0; i <= 20; i++) {
      const p = -30 + i * 3;
      const probes: Array<[number, number]> = [
        [p, -30 - mid],
        [p, 30 + mid],
        [-30 - mid, p],
        [30 + mid, p],
      ];
      for (const [x, z] of probes) expect(boxes.some((b) => contains(b, x, z))).toBe(true);
    }
    // outer corner squares
    expect(boxes.some((b) => contains(b, -30 - 1.5, -30 - 1.5))).toBe(true);
    expect(boxes.some((b) => contains(b, 31, 31))).toBe(true);
  });

  it("top is local max + height, bottom is local min - 1 m", () => {
    const g = flat();
    for (let c = 0; c <= 20; c++) for (let r = 0; r <= 20; r++) g.heights[r + c * 21] = c * 0.1;
    for (const b of buildEdgeBerm(g)) {
      const top = b.cy + b.hy;
      const bottom = b.cy - b.hy;
      // heights equal c*0.1: x-edge walls span columns, z-edge walls sit on one column
      const wide = b.hx > b.hz;
      const xLo = wide ? b.cx - b.hx : b.cx;
      const xHi = wide ? b.cx + b.hx : b.cx;
      const cLo = Math.max(0, Math.min(20, Math.round((xLo + 30) / 3)));
      const cHi = Math.max(0, Math.min(20, Math.round((xHi + 30) / 3)));
      expect(top).toBeCloseTo(cHi * 0.1 + BERM_HEIGHT_M, 2);
      expect(bottom).toBeCloseTo(cLo * 0.1 - 1, 2);
    }
  });

  it("inner face is exactly the inset inside the edge; outer reaches thickness - inset past it", () => {
    const g = flat();
    const boxes = buildEdgeBerm(g);
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (const b of boxes) {
      minX = Math.min(minX, b.cx - b.hx);
      maxX = Math.max(maxX, b.cx + b.hx);
      minZ = Math.min(minZ, b.cz - b.hz);
      maxZ = Math.max(maxZ, b.cz + b.hz);
    }
    const out = BERM_THICKNESS_M - BERM_INSET_M;
    expect(minX).toBeCloseTo(-30 - out, 6);
    expect(maxX).toBeCloseTo(30 + out, 6);
    expect(minZ).toBeCloseTo(-30 - out, 6);
    expect(maxZ).toBeCloseTo(30 + out, 6);
    // No box reaches further inside than the inset.
    for (const b of boxes) {
      const innerX = Math.abs(b.cx) - b.hx;
      const innerZ = Math.abs(b.cz) - b.hz;
      // a box is either a thin x-edge or z-edge wall: one of its faces is the inset face
      expect(Math.max(innerX, innerZ)).toBeGreaterThanOrEqual(30 - BERM_INSET_M - 1e-6);
    }
  });

  it("splits runs on a sloped edge: spread <= max drop, length <= max run", () => {
    const g = createTerrainGrid({ rows: 200, cols: 200, cellSizeM: 3, originX: 0, originZ: 0 });
    for (let c = 0; c <= 200; c++)
      for (let r = 0; r <= 200; r++) g.heights[r + c * 201] = (c * 3 * 30) / 600;
    for (const b of buildEdgeBerm(g)) {
      const runLen = Math.max(b.hx, b.hz) * 2;
      expect(runLen).toBeLessThanOrEqual(BERM_RUN_MAX_M + 2 * (BERM_THICKNESS_M - BERM_INSET_M));
      // spread of the box = (hy*2) - height - foot
      expect(b.hy * 2 - BERM_HEIGHT_M - 1).toBeLessThanOrEqual(BERM_RUN_MAX_DROP_M + 1e-6);
    }
  });

  it("stays bounded on a worst-case zig-zag 2 km grid", () => {
    const g = createTerrainGrid({ rows: 666, cols: 666, cellSizeM: 3, originX: 0, originZ: 0 });
    for (let c = 0; c <= 666; c++)
      for (let r = 0; r <= 666; r++) g.heights[r + c * 667] = (c + r) % 2 === 0 ? 0 : 2.1;
    expect(buildEdgeBerm(g).length).toBeLessThan(2000);
  });

  it("is deterministic", () => {
    const g = flat();
    for (let i = 0; i < g.heights.length; i++) g.heights[i] = Math.sin(i) * 2;
    expect(buildEdgeBerm(g)).toEqual(buildEdgeBerm(g));
  });
});

describe("compiled-map berm (07.1)", () => {
  // A compiled collision heightfield: non-square cells (1951.7 m x 767.7 m over 128x128, like map-1).
  const rows = 4;
  const cols = 4;
  const hf = {
    rows,
    cols,
    heights: new Float32Array((rows + 1) * (cols + 1)).fill(-0.1),
    originX: -1000,
    originZ: -400,
    scaleX: 2000,
    scaleZ: 800,
  };
  const graphWith = (points: [number, number, number][]) =>
    ({ edges: [{ points }] }) as unknown as RoadGraph;

  it("encloses the whole non-square grid", () => {
    const boxes = buildEdgeBerm(hf);
    const minX = Math.min(...boxes.map((b) => b.cx - b.hx));
    const maxX = Math.max(...boxes.map((b) => b.cx + b.hx));
    const minZ = Math.min(...boxes.map((b) => b.cz - b.hz));
    const maxZ = Math.max(...boxes.map((b) => b.cz + b.hz));
    expect(minX).toBeLessThan(hf.originX);
    expect(maxX).toBeGreaterThan(hf.originX + hf.scaleX);
    expect(minZ).toBeLessThan(hf.originZ);
    expect(maxZ).toBeGreaterThan(hf.originZ + hf.scaleZ);
    // Z-edge boxes span the Z extent, not the X cell size.
    const zEdgeLen = boxes.filter((b) => b.hx < 5).reduce((s, b) => s + 2 * b.hz, 0);
    expect(zEdgeLen).toBeCloseTo(2 * hf.scaleZ, 0);
  });

  it("is only allowed when every road point is clear of the grid edge", () => {
    expect(
      roadsClearOfGridEdge(
        hf,
        graphWith([
          [0, 0, 0],
          [900, 0, 300],
        ]),
      ),
    ).toBe(true);
    // A road running off the ground (older maps sized to junction nodes only).
    expect(
      roadsClearOfGridEdge(
        hf,
        graphWith([
          [0, 0, 0],
          [0, 0, -395],
        ]),
      ),
    ).toBe(false);
  });
});
