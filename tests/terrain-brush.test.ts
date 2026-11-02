import { describe, expect, it } from "vitest";
import {
  type BrushParams,
  createStrokeRecorder,
  erasePaintDisc,
  flattenBrush,
  paintSurface,
  raiseLower,
  smoothBrush,
  stampTerrain,
} from "../src/core/terrain-brush.ts";
import { createTerrainGrid, terrainIndex } from "../src/core/terrain-grid.ts";
import { MAX_SLOPE_DEG } from "../src/core/terrain-limits.ts";
import {
  createPaintMap,
  decodePaintSurface,
  encodePaintValue,
  PAINT_ROAD_FLAG,
} from "../src/core/terrain-paint.ts";
import { maxSlopeDegIn } from "../src/core/terrain-slope.ts";

// 61x61 vertices, vertex (30,30) sits at world (0,0).
function grid() {
  return createTerrainGrid({ rows: 60, cols: 60, cellSizeM: 3, originX: -90, originZ: -90 });
}
const whole = (g: ReturnType<typeof grid>) => ({
  minRow: 0,
  minCol: 0,
  maxRow: g.rows,
  maxCol: g.cols,
});
const at = (g: ReturnType<typeof grid>, x: number, z: number) =>
  g.heights[terrainIndex(g, Math.round((z + 90) / 3), Math.round((x + 90) / 3))];
const brush = (over: Partial<BrushParams> = {}): BrushParams => ({
  x: 0,
  z: 0,
  radiusM: 12,
  strength: 0.5,
  falloff: "smooth",
  ...over,
});

describe("raiseLower", () => {
  it("raises the centre most, falls off monotonically, leaves outside untouched", () => {
    const g = grid();
    const res = raiseLower(g, brush(), 1);
    expect(res.window).toBeDefined();
    const centre = at(g, 0, 0);
    expect(centre).toBeGreaterThan(0.3);
    let prev = centre;
    for (const x of [3, 6, 9, 12]) {
      const h = at(g, x, 0);
      expect(h).toBeLessThanOrEqual(prev + 1e-6);
      prev = h;
    }
    expect(at(g, 15, 0)).toBe(0);
    expect(at(g, 0, 30)).toBe(0);
  });

  it("lowers symmetrically with sign -1", () => {
    const a = grid();
    const b = grid();
    raiseLower(a, brush(), 1);
    raiseLower(b, brush(), -1);
    for (let i = 0; i < a.heights.length; i++) expect(b.heights[i]).toBeCloseTo(-a.heights[i], 6);
  });

  it("linear and smooth falloff differ as specified", () => {
    const lin = grid();
    const smo = grid();
    raiseLower(lin, brush({ falloff: "linear", strength: 1 }), 1, 1);
    raiseLower(smo, brush({ falloff: "smooth", strength: 1 }), 1, 1);
    // d = 6, r = 12: linear 0.5, smooth 0.5 (symmetric midpoint); d = 3: linear .75, smooth ~.844
    const relaxedIgnoring = (g: typeof lin) => at(g, 3, 0);
    expect(relaxedIgnoring(smo)).toBeGreaterThan(relaxedIgnoring(lin));
  });

  it("ignores non-finite params and clamps absurd radii", () => {
    const g = grid();
    expect(raiseLower(g, brush({ x: Number.NaN }), 1).window).toBeUndefined();
    expect(raiseLower(g, brush({ radiusM: Number.POSITIVE_INFINITY }), 1).window).toBeUndefined();
    expect(g.heights.every((h) => h === 0)).toBe(true);
    raiseLower(g, brush({ radiusM: 1e9, strength: 5 }), 1); // clamped to 200 m / 1
    expect(Number.isFinite(at(g, 0, 0))).toBe(true);
  });

  it("keeps the slope cap and reports slopeClamped", () => {
    const g = grid();
    let clamped = false;
    for (let i = 0; i < 40; i++) {
      const r = raiseLower(g, brush({ radiusM: 4, strength: 1 }), 1, 5);
      clamped = clamped || r.slopeClamped;
    }
    expect(clamped).toBe(true);
    expect(maxSlopeDegIn(g, whole(g))).toBeLessThanOrEqual(MAX_SLOPE_DEG + 1e-3);
  });
});

describe("smooth and flatten", () => {
  it("smoothBrush reduces variance inside, leaves outside alone", () => {
    const g = grid();
    for (let i = 0; i < g.heights.length; i++) g.heights[i] = (i * 7919) % 5 < 2 ? 1 : 0;
    const before = new Float32Array(g.heights);
    const variance = (arr: number[]) => {
      const m = arr.reduce((a, b) => a + b, 0) / arr.length;
      return arr.reduce((a, b) => a + (b - m) ** 2, 0) / arr.length;
    };
    const inside = (h: ArrayLike<number>) => {
      const out: number[] = [];
      for (let r = 28; r <= 32; r++)
        for (let c = 28; c <= 32; c++) out.push(h[terrainIndex(g, r, c)]);
      return out;
    };
    smoothBrush(g, brush({ strength: 1, radiusM: 12 }));
    expect(variance(inside(g.heights))).toBeLessThan(variance(inside(before)));
    expect(g.heights[terrainIndex(g, 2, 2)]).toBe(before[terrainIndex(g, 2, 2)]);
    expect(g.heights[terrainIndex(g, 30, 50)]).toBe(before[terrainIndex(g, 30, 50)]);
  });

  it("flattenBrush sets the target at the centre with strength 1 and pulls others toward it", () => {
    const g = grid();
    g.heights.fill(1);
    flattenBrush(g, brush({ strength: 1 }), 5);
    expect(at(g, 0, 0)).toBe(5);
    const edge = at(g, 9, 0);
    expect(edge).toBeGreaterThan(1);
    expect(edge).toBeLessThan(5);
    expect(at(g, 30, 0)).toBe(1);
  });
});

describe("stampTerrain", () => {
  it("wedge rises along local +X, mound is a dome, both obey the cap", () => {
    const g = grid();
    const res = stampTerrain(g, {
      kind: "wedge",
      x: 0,
      z: 0,
      rotationRad: 0,
      lengthM: 24,
      widthM: 12,
      heightM: 4,
    });
    expect(res.window).toBeDefined();
    expect(at(g, 9, 0)).toBeGreaterThan(at(g, -9, 0));
    expect(at(g, 9, 0)).toBeGreaterThan(at(g, 0, 0));
    expect(at(g, 0, 20)).toBe(0);
    expect(maxSlopeDegIn(g, whole(g))).toBeLessThanOrEqual(MAX_SLOPE_DEG + 1e-3);

    const m = grid();
    stampTerrain(m, {
      kind: "mound",
      x: 0,
      z: 0,
      rotationRad: 0,
      lengthM: 20,
      widthM: 20,
      heightM: 3,
    });
    expect(at(m, 0, 0)).toBeGreaterThan(2);
    expect(at(m, 0, 0)).toBeGreaterThan(at(m, 6, 0));
    expect(at(m, 6, 0)).toBeGreaterThan(at(m, 9, 0));
    expect(at(m, 12, 0)).toBe(0);
  });

  it("rotation PI/2 turns the footprint", () => {
    const g = grid();
    stampTerrain(g, {
      kind: "wedge",
      x: 0,
      z: 0,
      rotationRad: Math.PI / 2,
      lengthM: 24,
      widthM: 12,
      heightM: 4,
    });
    expect(at(g, 0, 9)).toBeGreaterThan(at(g, 0, -9));
    expect(at(g, 9, 0)).toBeCloseTo(at(g, -9, 0), 3);
  });

  it("max-blends: never lowers taller existing terrain", () => {
    const g = grid();
    g.heights.fill(10);
    const centre = terrainIndex(g, 30, 30);
    g.heights[centre] = 12;
    stampTerrain(g, {
      kind: "mound",
      x: 0,
      z: 0,
      rotationRad: 0,
      lengthM: 10,
      widthM: 10,
      heightM: 1,
    });
    expect(at(g, 0, 0)).toBeGreaterThanOrEqual(12 - 1e-3);
    expect(at(g, 3, 0)).toBeGreaterThanOrEqual(10);
  });
});

describe("paint", () => {
  const mk = () =>
    createPaintMap({
      originX: -30,
      originZ: -30,
      widthM: 60,
      depthM: 60,
      metresPerPixel: 0.5,
      fill: "grass",
    });

  it("paintSurface fills pixel centres within the radius, sparing road pixels", () => {
    const p = mk();
    const roadPx = (60 + 1) * p.width + 60; // near (0.5, 0.5)
    p.data[roadPx] = encodePaintValue("tarmac", true);
    const res = paintSurface(p, brush({ radiusM: 3 }), "mud");
    expect(res.pixelsChanged).toBeGreaterThan(100);
    const wide = (x: number, z: number) =>
      p.data[Math.floor((z + 30) / 0.5) * p.width + Math.floor((x + 30) / 0.5)];
    expect(decodePaintSurface(wide(0.25, 0.25))).toBe("mud");
    expect(wide(0.25, 0.25)).toBe(encodePaintValue("mud", false));
    expect(wide(10, 10)).toBe(encodePaintValue("grass", false));
    expect(p.data[roadPx]).toBe(encodePaintValue("tarmac", true));
    paintSurface(p, brush({ radiusM: 3 }), "sand", { overRoads: true });
    expect(decodePaintSurface(p.data[roadPx])).toBe("sand");
  });

  it("erasePaintDisc clears the road flag and sets the ground surface", () => {
    const p = mk();
    p.data.fill(encodePaintValue("tarmac", true));
    erasePaintDisc(p, brush({ radiusM: 3 }), "dirt_road");
    const i = Math.floor(30.25 / 0.5) * p.width + Math.floor(30.25 / 0.5);
    expect(p.data[i] & PAINT_ROAD_FLAG).toBe(0);
    expect(decodePaintSurface(p.data[i])).toBe("dirt_road");
    expect(p.data[0] & PAINT_ROAD_FLAG).toBe(PAINT_ROAD_FLAG);
  });
});

describe("createStrokeRecorder", () => {
  it("merges overlapping dabs into one minimal, first-touch diff", () => {
    const g = grid();
    const p = createPaintMap({
      originX: -90,
      originZ: -90,
      widthM: 180,
      depthM: 180,
      metresPerPixel: 1,
      fill: "grass",
    });
    const rec = createStrokeRecorder(g, p);
    raiseLower(g, brush(), 1, 1, rec);
    raiseLower(g, brush({ x: 3 }), 1, 1, rec);
    paintSurface(p, brush({ radiusM: 3 }), "mud", {}, rec);
    const diff = rec.commit();
    expect(diff?.heights).toBeDefined();
    const idx = Array.from(diff?.heights?.indices ?? []);
    expect(new Set(idx).size).toBe(idx.length);
    for (let k = 0; k < idx.length; k++) {
      expect(diff?.heights?.before[k]).toBe(0);
      expect(diff?.heights?.after[k]).toBe(g.heights[idx[k]]);
      expect(diff?.heights?.after[k]).not.toBe(0);
    }
    expect(idx.length).toBeLessThan(g.heights.length / 4);
    expect(diff?.paint?.before.every((b) => b === encodePaintValue("grass", false))).toBe(true);
    expect(diff?.paint?.after.every((a) => a === encodePaintValue("mud", false))).toBe(true);
  });

  it("commits an empty stroke to undefined", () => {
    const g = grid();
    const p = createPaintMap({
      originX: -90,
      originZ: -90,
      widthM: 180,
      depthM: 180,
      metresPerPixel: 1,
      fill: "grass",
    });
    const rec = createStrokeRecorder(g, p);
    expect(rec.commit()).toBeUndefined();
    raiseLower(g, brush({ strength: 0 }), 1, 1, rec);
    expect(rec.commit()).toBeUndefined();
  });
});
