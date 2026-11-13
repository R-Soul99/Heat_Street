import { describe, expect, it } from "vitest";
import type { RoadGraph } from "../src/core/road-graph.ts";
import { stampTerrain } from "../src/core/terrain-brush.ts";
import { createTerrainGrid, terrainIndex } from "../src/core/terrain-grid.ts";
import {
  brushFootprintWindow,
  CONTOUR_LADDER_M,
  CONTOUR_REF_CELL_PX,
  cellPixelSize,
  contourIntervalForZoom,
  contourSegments,
  footprintGridSegments,
  footprintOutline,
  gridLineSegments,
  needsZoomHint,
  roadLockCounts,
  roadLockSegments,
  stampOutline,
  ZOOM_HINT_MIN_CELL_PX,
} from "../src/core/terrain-overlay.ts";

function flat(fill = 0) {
  return createTerrainGrid({
    rows: 10,
    cols: 10,
    cellSizeM: 2,
    originX: 0,
    originZ: 0,
    fill,
  });
}

describe("gridLineSegments", () => {
  it("a 4 x 4 cell window yields 2 * 5 * 4 segments", () => {
    const g = flat();
    const seg = gridLineSegments(g, { minRow: 2, minCol: 2, maxRow: 6, maxCol: 6 });
    expect(seg.length).toBe(2 * 5 * 4 * 6);
  });

  it("follows terrain height plus 0.05 m", () => {
    const g = flat(3);
    const seg = gridLineSegments(g, { minRow: 0, minCol: 0, maxRow: 1, maxCol: 1 });
    expect(seg.length).toBe(2 * 2 * 1 * 6);
    for (let i = 1; i < seg.length; i += 3) expect(seg[i]).toBeCloseTo(3.05, 5);
  });

  it("returns an empty array for a degenerate window", () => {
    const g = flat();
    expect(gridLineSegments(g, { minRow: 3, minCol: 3, maxRow: 3, maxCol: 3 }).length).toBe(0);
  });
});

describe("contourSegments", () => {
  it("a planar x ramp gives straight segments at integer heights", () => {
    const g = flat();
    // 1 m per 2 m cell along x.
    for (let c = 0; c <= g.cols; c++) {
      for (let r = 0; r <= g.rows; r++) g.heights[terrainIndex(g, r, c)] = c;
    }
    const seg = contourSegments(g, { minRow: 0, minCol: 0, maxRow: 10, maxCol: 10 }, 1);
    expect(seg.length).toBeGreaterThan(0);
    expect(seg.length % 6).toBe(0);
    for (let i = 0; i < seg.length; i += 3) {
      const x = seg[i];
      const y = seg[i + 1];
      expect(y).toBeCloseTo(x / 2, 5);
      expect(Math.abs(y - Math.round(y))).toBeLessThan(1e-5);
    }
    // Every segment is straight along z (both ends share x).
    for (let i = 0; i < seg.length; i += 6) expect(seg[i]).toBeCloseTo(seg[i + 3], 5);
  });

  it("a flat grid between contour levels has none", () => {
    const g = flat(0.5);
    expect(contourSegments(g, { minRow: 0, minCol: 0, maxRow: 10, maxCol: 10 }, 1).length).toBe(0);
  });

  it("rejects non-positive and non-finite intervals", () => {
    const g = flat();
    const w = { minRow: 0, minCol: 0, maxRow: 10, maxCol: 10 };
    expect(contourSegments(g, w, 0).length).toBe(0);
    expect(contourSegments(g, w, -1).length).toBe(0);
    expect(contourSegments(g, w, Number.NaN).length).toBe(0);
  });

  it("a saddle cell yields two segments", () => {
    const g = flat();
    g.heights[terrainIndex(g, 0, 0)] = 1;
    g.heights[terrainIndex(g, 1, 1)] = 1;
    const seg = contourSegments(g, { minRow: 0, minCol: 0, maxRow: 1, maxCol: 1 }, 1);
    expect(seg.length).toBe(2 * 6);
  });
});

describe("zoom check", () => {
  it("cellPixelSize follows the pinhole formula", () => {
    const px = cellPixelSize(100, 60, 1080, 3);
    expect(px).toBeCloseTo((3 * 1080) / (2 * 100 * Math.tan(Math.PI / 6)), 6);
  });
  it("needsZoomHint trips below ZOOM_HINT_MIN_CELL_PX", () => {
    expect(ZOOM_HINT_MIN_CELL_PX).toBe(8);
    expect(needsZoomHint(7.99)).toBe(true);
    expect(needsZoomHint(8)).toBe(false);
    expect(needsZoomHint(50)).toBe(false);
  });
  it("non-finite size counts as needing a hint", () => {
    expect(needsZoomHint(Number.NaN)).toBe(true);
  });
});

describe("roadLockSegments", () => {
  const edge = (id: number, y: number) => ({
    id,
    from: 0,
    to: 1,
    points: [
      [0, y, 0],
      [5, y, 0],
      [10, y, 0],
    ] as [number, number, number][],
  });
  const graph = { edges: [edge(1, 1), edge(2, 2), edge(3, 3)] } as unknown as RoadGraph;

  it("puts every edge in locked when nothing is unlocked", () => {
    const s = roadLockSegments(graph, [], null, 0.4);
    expect(s.locked.length).toBe(3 * 2 * 6);
    expect(s.unlocked.length).toBe(0);
    expect(s.selected.length).toBe(0);
  });

  it("splits unlocked and selected edges and lifts y", () => {
    const s = roadLockSegments(graph, [2, 3], 3, 0.4);
    expect(s.locked.length).toBe(2 * 6);
    expect(s.unlocked.length).toBe(2 * 6);
    expect(s.selected.length).toBe(2 * 6);
    expect(s.locked[1]).toBeCloseTo(1.4);
    expect(s.unlocked[1]).toBeCloseTo(2.4);
    expect(s.selected[1]).toBeCloseTo(3.4);
  });
});

describe("brush footprint overlays (quick 261111-x00)", () => {
  const g = createTerrainGrid({ rows: 40, cols: 40, cellSizeM: 3, originX: -60, originZ: -60 });

  it("window is centred on the true cursor point (grid-offset regression)", () => {
    for (const shape of ["round", "square"] as const) {
      for (const [x, z] of [
        [g.originX + 10.4 * 3, g.originZ + 14.7 * 3],
        [g.originX + 20.5 * 3, g.originZ + 9.01 * 3],
      ]) {
        const w = brushFootprintWindow(g, x, z, 9, shape);
        expect(w).not.toBeNull();
        if (!w) continue;
        const cx = g.originX + ((w.minCol + w.maxCol) / 2) * 3;
        const cz = g.originZ + ((w.minRow + w.maxRow) / 2) * 3;
        expect(Math.abs(cx - x)).toBeLessThanOrEqual(1.5 + 1e-9);
        expect(Math.abs(cz - z)).toBeLessThanOrEqual(1.5 + 1e-9);
      }
    }
    expect(brushFootprintWindow(g, 5000, 5000, 9, "round")).toBeNull();
  });

  it("square grid equals gridLineSegments over the window; round is a strict subset", () => {
    const x = 1.3;
    const z = -2.2;
    const w = brushFootprintWindow(g, x, z, 12, "square");
    if (!w) throw new Error("window");
    const sq = footprintGridSegments(g, x, z, 12, "square");
    expect(sq.length).toBe(gridLineSegments(g, w).length);
    const rd = footprintGridSegments(g, x, z, 12, "round");
    expect(rd.length).toBeLessThan(sq.length);
    expect(rd.length).toBeGreaterThan(0);
    for (let i = 0; i < rd.length; i += 6) {
      const mx = (rd[i] + rd[i + 3]) / 2 - x;
      const mz = (rd[i + 2] + rd[i + 5]) / 2 - z;
      expect(Math.hypot(mx, mz)).toBeLessThanOrEqual(12 + 1e-4);
      expect(rd[i + 1]).toBeCloseTo(0.15, 5);
    }
    expect(footprintGridSegments(g, 9999, 9999, 12, "round").length).toBe(0);
  });

  it("outline is centred exactly and closed", () => {
    const c = footprintOutline(5, -7, 4, "round", 32);
    expect(c.length).toBe(64);
    const q = footprintOutline(5, -7, 4, "square", 32);
    const xs = Array.from(q).filter((_, i) => i % 2 === 0);
    const zs = Array.from(q).filter((_, i) => i % 2 === 1);
    expect(Math.min(...xs)).toBeCloseTo(1, 5);
    expect(Math.max(...xs)).toBeCloseTo(9, 5);
    expect(Math.min(...zs)).toBeCloseTo(-11, 5);
    expect(Math.max(...zs)).toBeCloseTo(-3, 5);
    let found = false;
    for (let i = 0; i < q.length; i += 2) if (q[i] === 1 && q[i + 1] === -11) found = true;
    expect(found).toBe(true);
  });

  it("contour interval follows zoom on the ladder", () => {
    expect(contourIntervalForZoom(CONTOUR_REF_CELL_PX, 1)).toBe(1);
    expect(contourIntervalForZoom(CONTOUR_REF_CELL_PX, 1.2)).toBe(1);
    let prev = Number.POSITIVE_INFINITY;
    for (const px of [1, 2, 4, 8, 16, 32, 64, 128, 512]) {
      const v = contourIntervalForZoom(px, 1);
      expect(CONTOUR_LADDER_M).toContain(v);
      expect(v).toBeLessThanOrEqual(prev);
      prev = v;
    }
    expect(contourIntervalForZoom(CONTOUR_REF_CELL_PX / 4, 1)).toBeGreaterThanOrEqual(2);
    expect(contourIntervalForZoom(0.001, 10)).toBe(10);
    expect(contourIntervalForZoom(1e6, 0.25)).toBe(0.25);
    expect(contourIntervalForZoom(Number.NaN, 2)).toBe(2);
    expect(contourIntervalForZoom(-1, 2)).toBe(2);
  });
});

describe("stampOutline", () => {
  const big = () =>
    createTerrainGrid({ rows: 60, cols: 60, cellSizeM: 1, originX: -30, originZ: -30 });
  const hAt = (g: ReturnType<typeof big>, x: number, z: number) =>
    g.heights[terrainIndex(g, Math.round(z + 30), Math.round(x + 30))];
  // Inside test: point in the outline polygon's local frame.
  const local = (x: number, z: number, rot: number) => ({
    lx: x * Math.cos(rot) + z * Math.sin(rot),
    lz: -x * Math.sin(rot) + z * Math.cos(rot),
  });

  for (const deg of [0, 90, 30]) {
    it(`matches the area stampTerrain raises at ${deg} degrees`, () => {
      const rot = (deg * Math.PI) / 180;
      const spec = { kind: "wedge" as const, x: 0, z: 0, rotationRad: rot, lengthM: 12, widthM: 6 };
      const g = big();
      stampTerrain(g, { ...spec, heightM: 3 });
      const o = stampOutline(spec);
      expect(o.outline.length).toBe(8);
      // Corners lie on the local rectangle.
      for (let i = 0; i < 4; i++) {
        const { lx, lz } = local(o.outline[i * 2], o.outline[i * 2 + 1], rot);
        expect(Math.abs(lx)).toBeCloseTo(6, 6);
        expect(Math.abs(lz)).toBeCloseTo(3, 6);
      }
      // Well inside the high end: raised. 2 cells outside the footprint: untouched.
      const inside = { x: 3.5 * Math.cos(rot), z: 3.5 * Math.sin(rot) };
      expect(hAt(g, inside.x, inside.z)).toBeGreaterThan(0.5);
      const out = { x: 8.5 * Math.cos(rot), z: 8.5 * Math.sin(rot) };
      expect(hAt(g, out.x, out.z)).toBe(0);
      const side = { x: -5 * Math.sin(rot), z: 5 * Math.cos(rot) };
      expect(hAt(g, side.x, side.z)).toBe(0);
    });
  }

  it("arrow points along the rise direction (local +X)", () => {
    const rot = Math.PI / 2;
    const o = stampOutline({ kind: "wedge", x: 5, z: 5, rotationRad: rot, lengthM: 10, widthM: 4 });
    expect(o.arrow.length).toBe(3 * 4);
    // Shaft goes from (5, 5-3.5) to (5, 5+3.5).
    expect(o.arrow[0]).toBeCloseTo(5, 6);
    expect(o.arrow[1]).toBeCloseTo(1.5, 6);
    expect(o.arrow[2]).toBeCloseTo(5, 6);
    expect(o.arrow[3]).toBeCloseTo(8.5, 6);
  });

  it("rotating by 90 degrees rotates the outline about the anchor", () => {
    const a = stampOutline({ kind: "wedge", x: 0, z: 0, rotationRad: 0, lengthM: 12, widthM: 6 });
    const b = stampOutline({
      kind: "wedge",
      x: 0,
      z: 0,
      rotationRad: Math.PI / 2,
      lengthM: 12,
      widthM: 6,
    });
    for (let i = 0; i < 4; i++) {
      expect(b.outline[i * 2]).toBeCloseTo(-a.outline[i * 2 + 1], 6);
      expect(b.outline[i * 2 + 1]).toBeCloseTo(a.outline[i * 2], 6);
    }
  });

  it("mound is a circle of radius widthM/2 with no arrow", () => {
    const o = stampOutline({ kind: "mound", x: 2, z: 3, rotationRad: 1, lengthM: 20, widthM: 10 });
    expect(o.arrow).toEqual([]);
    for (let i = 0; i < o.outline.length; i += 2) {
      expect(Math.hypot(o.outline[i] - 2, o.outline[i + 1] - 3)).toBeCloseTo(5, 6);
    }
  });
});

describe("roadLockCounts", () => {
  const graph = { edges: [{ id: 1 }, { id: 2 }, { id: 3 }] } as unknown as RoadGraph;
  it("counts all locked when nothing is unlocked", () => {
    expect(roadLockCounts(graph, undefined)).toEqual({ locked: 3, unlocked: 0 });
    expect(roadLockCounts(graph, [])).toEqual({ locked: 3, unlocked: 0 });
  });
  it("counts unlocked edges and ignores ids not in the graph", () => {
    expect(roadLockCounts(graph, [2, 3, 99])).toEqual({ locked: 1, unlocked: 2 });
  });
});
