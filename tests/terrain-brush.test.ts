import { describe, expect, it } from "vitest";
import {
  BLOCK_CELLS_MAX,
  type BrushParams,
  blockWindowAt,
  createStrokeRecorder,
  erasePaintDisc,
  flattenBrush,
  paintSurface,
  raiseBlock,
  raiseLower,
  raiseWindow,
  setWindowFromBase,
  smoothBrush,
  smoothRegion,
  snapshotWindow,
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

  it("WR-03: a tiny dab on pre-existing over-cap terrain changes nothing outside its radius", () => {
    // Converted-DEM style: a uniform 45 degree slope, already steeper than the cap.
    const g = grid();
    for (let c = 0; c <= g.cols; c++) {
      for (let r = 0; r <= g.rows; r++) g.heights[terrainIndex(g, r, c)] = c * 3;
    }
    const before = Float32Array.from(g.heights);
    const radiusM = 4;
    raiseLower(g, brush({ radiusM, strength: 0.01 }), 1, 1);
    let changed = 0;
    for (let c = 0; c <= g.cols; c++) {
      for (let r = 0; r <= g.rows; r++) {
        const i = terrainIndex(g, r, c);
        if (g.heights[i] === before[i]) continue;
        changed++;
        expect(Math.hypot(c * 3 - 90, r * 3 - 90)).toBeLessThanOrEqual(radiusM);
      }
    }
    expect(changed).toBeGreaterThan(0);
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

// ---- phase 04.3 plan 02: block raise/lower and road-safe smoothing (D-18..D-21) ----
describe("blockWindowAt", () => {
  it("returns the vertex window of an N x N cell block anchored at the cell under (x, z)", () => {
    const g = grid();
    // (1, 1) sits in cell row 30 / col 30; N=2 anchor r0 = 30 - floor(1/2) = 30.
    expect(blockWindowAt(g, 1, 1, 2)).toEqual({ minRow: 30, minCol: 30, maxRow: 32, maxCol: 32 });
    // N=3 anchor offset floor(2/2) = 1.
    expect(blockWindowAt(g, 1, 1, 3)).toEqual({ minRow: 29, minCol: 29, maxRow: 32, maxCol: 32 });
  });
  it("clamps inside the grid and returns null outside it", () => {
    const g = grid();
    const w = blockWindowAt(g, -89, -89, 4);
    expect(w?.minRow).toBe(0);
    expect(w?.minCol).toBe(0);
    expect(blockWindowAt(g, 500, 0, 2)).toBeNull();
    expect(blockWindowAt(g, 0, -500, 2)).toBeNull();
    expect(blockWindowAt(g, Number.NaN, 0, 2)).toBeNull();
  });
});

describe("raiseBlock", () => {
  const p = (over: Partial<{ x: number; z: number; blockCells: number; stepM: number }> = {}) => ({
    x: 1,
    z: 1,
    blockCells: 2,
    stepM: 1,
    ...over,
  });

  it("raises exactly the (N+1)^2 window by the step and leaves the rest alone", () => {
    const g = grid();
    const res = raiseBlock(g, p({ stepM: 0.5 }), 1);
    expect(res.window).toBeDefined();
    const win = blockWindowAt(g, 1, 1, 2) as NonNullable<ReturnType<typeof blockWindowAt>>;
    for (let c = 0; c <= g.cols; c++) {
      for (let r = 0; r <= g.rows; r++) {
        const inside = r >= win.minRow && r <= win.maxRow && c >= win.minCol && c <= win.maxCol;
        const h = g.heights[terrainIndex(g, r, c)];
        if (inside) expect(h).toBeCloseTo(0.5, 5);
        else expect(h).toBeLessThanOrEqual(0.5);
      }
    }
    expect(g.heights[terrainIndex(g, 0, 0)]).toBe(0);
  });

  it("lowers with sign -1", () => {
    const g = grid();
    raiseBlock(g, p({ stepM: 0.5 }), -1);
    expect(at(g, 1, 1)).toBeCloseTo(-0.5, 5);
  });

  it("a 5 m step on 3 m cells hits the slope cap", () => {
    const g = grid();
    const res = raiseBlock(g, p({ stepM: 5, blockCells: 3 }), 1);
    expect(res.slopeClamped).toBe(true);
    expect(maxSlopeDegIn(g, whole(g))).toBeLessThanOrEqual(MAX_SLOPE_DEG + 0.01);
  });

  it("never moves road-masked vertices inside the block", () => {
    const g = grid();
    const win = blockWindowAt(g, 1, 1, 3) as NonNullable<ReturnType<typeof blockWindowAt>>;
    const mask = new Uint8Array(g.heights.length);
    for (let r = win.minRow; r <= win.maxRow; r++) mask[terrainIndex(g, r, win.minCol + 1)] = 1;
    raiseBlock(g, p({ blockCells: 3 }), 1, undefined, { roadMask: () => mask });
    for (let r = win.minRow; r <= win.maxRow; r++) {
      expect(g.heights[terrainIndex(g, r, win.minCol + 1)]).toBe(0);
    }
    expect(g.heights[terrainIndex(g, win.minRow, win.minCol)]).toBeGreaterThan(0);
  });

  it("clamps blockCells and stepM, no-ops on non-finite input", () => {
    const g = grid();
    expect(raiseBlock(g, p({ stepM: Number.NaN }), 1).window).toBeUndefined();
    expect(raiseBlock(g, p({ blockCells: Number.POSITIVE_INFINITY }), 1).window).toBeUndefined();
    expect(raiseBlock(g, p({ x: Number.NaN }), 1).window).toBeUndefined();
    expect(g.heights.every((h) => h === 0)).toBe(true);
    raiseBlock(g, p({ blockCells: 999, stepM: 0.001 }), 1); // -> BLOCK_CELLS_MAX cells, 0.25 m
    expect(at(g, 1, 1)).toBeCloseTo(0.25, 5);
    expect(blockWindowAt(g, 1, 1, 999)).toEqual(blockWindowAt(g, 1, 1, BLOCK_CELLS_MAX));
    expect(blockWindowAt(g, 1, 1, BLOCK_CELLS_MAX)).not.toEqual(blockWindowAt(g, 1, 1, 8));
  });
});

describe("road mask holds vertices in every height op (WR-03 / D-16)", () => {
  const roadAtCentre = (g: ReturnType<typeof grid>) => {
    const mask = new Uint8Array(g.heights.length);
    for (let c = 28; c <= 32; c++) for (let r = 28; r <= 32; r++) mask[terrainIndex(g, r, c)] = 1;
    return { roadMask: () => mask };
  };
  const heldAndMoved = (g: ReturnType<typeof grid>) => {
    for (let c = 28; c <= 32; c++) {
      for (let r = 28; r <= 32; r++) expect(g.heights[terrainIndex(g, r, c)]).toBe(0);
    }
    expect(g.heights.some((h) => h !== 0)).toBe(true);
  };

  it("raiseLower", () => {
    const g = grid();
    raiseLower(g, brush({ radiusM: 15, strength: 1 }), 1, 2, undefined, roadAtCentre(g));
    heldAndMoved(g);
  });

  it("flattenBrush", () => {
    const g = grid();
    flattenBrush(g, brush({ radiusM: 15, strength: 1 }), 3, undefined, roadAtCentre(g));
    heldAndMoved(g);
  });

  it("stampTerrain", () => {
    const g = grid();
    stampTerrain(
      g,
      { kind: "mound", x: 0, z: 0, rotationRad: 0, lengthM: 20, widthM: 30, heightM: 3 },
      undefined,
      roadAtCentre(g),
    );
    heldAndMoved(g);
  });

  it("smoothBrush", () => {
    const g = grid();
    let s = 99;
    for (let i = 0; i < g.heights.length; i++) {
      s = (s * 1103515245 + 12345) & 0x7fffffff;
      g.heights[i] = (s / 0x7fffffff) * 0.4;
    }
    const before = Float32Array.from(g.heights);
    smoothBrush(g, brush({ radiusM: 15, strength: 1 }), undefined, roadAtCentre(g));
    for (let c = 28; c <= 32; c++) {
      for (let r = 28; r <= 32; r++) {
        const i = terrainIndex(g, r, c);
        expect(g.heights[i]).toBe(before[i]);
      }
    }
    expect(Array.from(g.heights)).not.toEqual(Array.from(before));
  });
});

describe("smoothRegion", () => {
  function noisy() {
    const g = grid();
    let s = 12345;
    for (let i = 0; i < g.heights.length; i++) {
      s = (s * 1103515245 + 12345) & 0x7fffffff;
      g.heights[i] = (s / 0x7fffffff) * 0.4;
    }
    return g;
  }
  const win = { minRow: 20, minCol: 20, maxRow: 40, maxCol: 40 };
  const variance = (g: ReturnType<typeof grid>) => {
    let n = 0;
    let sum = 0;
    let sq = 0;
    for (let c = win.minCol; c <= win.maxCol; c++) {
      for (let r = win.minRow; r <= win.maxRow; r++) {
        const h = g.heights[terrainIndex(g, r, c)];
        n++;
        sum += h;
        sq += h * h;
      }
    }
    return sq / n - (sum / n) ** 2;
  };

  it("reduces variance, leaves outside untouched, holds road vertices", () => {
    const g = noisy();
    const before = Float32Array.from(g.heights);
    const v0 = variance(g);
    const mask = new Uint8Array(g.heights.length);
    for (let c = win.minCol; c <= win.maxCol; c++) mask[terrainIndex(g, 30, c)] = 1;
    const res = smoothRegion(g, win, { strength: 1, passes: 3 }, undefined, {
      roadMask: () => mask,
    });
    expect(res.window).toBeDefined();
    expect(variance(g)).toBeLessThan(v0);
    for (let c = win.minCol; c <= win.maxCol; c++) {
      const i = terrainIndex(g, 30, c);
      expect(g.heights[i]).toBe(before[i]);
    }
    expect(g.heights[terrainIndex(g, 2, 2)]).toBe(before[terrainIndex(g, 2, 2)]);
    expect(g.heights[terrainIndex(g, 58, 58)]).toBe(before[terrainIndex(g, 58, 58)]);
  });

  it("clamps strength and passes; no-ops on non-finite", () => {
    const a = noisy();
    const b = noisy();
    smoothRegion(a, win, { strength: 50, passes: 500 });
    smoothRegion(b, win, { strength: 1, passes: 10 });
    expect(Array.from(a.heights)).toEqual(Array.from(b.heights));
    const c = noisy();
    expect(smoothRegion(c, win, { strength: Number.NaN, passes: 3 }).window).toBeUndefined();
    expect(smoothRegion(c, win, { strength: 1, passes: Number.NaN }).window).toBeUndefined();
  });

  it("more passes smooth more", () => {
    const a = noisy();
    const b = noisy();
    smoothRegion(a, win, { strength: 1, passes: 1 });
    smoothRegion(b, win, { strength: 1, passes: 4 });
    expect(variance(b)).toBeLessThan(variance(a));
  });
});

describe("height reporting and window ops (07.1-03)", () => {
  const win = { minRow: 28, minCol: 28, maxRow: 32, maxCol: 32 };

  it("raiseLower reports maxDeltaM and heldCount", () => {
    const g = grid();
    const r = raiseLower(g, brush({ strength: 1 }), 1);
    expect(r.maxDeltaM).toBeGreaterThan(0.5);
    expect(r.heldCount).toBe(0);
    const l = raiseLower(g, brush({ strength: 1 }), -1);
    expect(l.maxDeltaM).toBeLessThan(0);
  });

  it("reports held vertices when a road mask holds everything", () => {
    const g = grid();
    const roadMask = () => new Uint8Array(g.heights.length).fill(1);
    const r = raiseLower(g, brush({ strength: 1 }), 1, 1, undefined, { roadMask });
    expect(r.window).toBeUndefined();
    expect(r.maxDeltaM).toBe(0);
    expect(r.heldCount).toBeGreaterThan(0);
  });

  it("raiseWindow raises every vertex by exactly the delta, one diff", () => {
    const g = grid();
    const rec = createStrokeRecorder(g);
    const res = raiseWindow(g, win, 1, rec);
    expect(res.maxDeltaM).toBeCloseTo(1, 5);
    for (let c = 28; c <= 32; c++) {
      for (let r = 28; r <= 32; r++) expect(g.heights[terrainIndex(g, r, c)]).toBeCloseTo(1, 5);
    }
    expect(rec.commit()?.heights).toBeDefined();
  });

  it("raiseWindow holds road-masked vertices and counts them", () => {
    const g = grid();
    const held = terrainIndex(g, 30, 30);
    const roadMask = () => {
      const m = new Uint8Array(g.heights.length);
      m[held] = 1;
      return m;
    };
    const res = raiseWindow(g, win, 1, undefined, { roadMask });
    expect(g.heights[held]).toBe(0);
    expect(res.heldCount).toBe(1);
  });

  it("setWindowFromBase is absolute and restores the base", () => {
    const g = grid();
    const base = snapshotWindow(g, win);
    setWindowFromBase(g, win, base, 2.5);
    expect(g.heights[terrainIndex(g, 30, 30)]).toBeCloseTo(2.5, 5);
    setWindowFromBase(g, win, base, 0);
    expect(g.heights[terrainIndex(g, 30, 30)]).toBe(0);
    expect(g.heights[terrainIndex(g, 28, 28)]).toBe(0);
  });
});
