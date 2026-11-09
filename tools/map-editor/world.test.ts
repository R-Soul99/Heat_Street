import { describe, expect, it } from "vitest";
import {
  blankWorld,
  DEFAULT_TILE_M,
  fitView,
  gridStep,
  scaleBar,
  syntheticBbox,
  TILE_SIZES_M,
  tileLines,
  visibleRect,
  worldConfigSource,
  worldFromBbox,
  zoomAt,
} from "./world.ts";

describe("worldFromBbox", () => {
  const bbox = { south: 32.996, west: -84.005, north: 33.004, east: -83.995 };

  it("puts the south-west corner at the origin and the north-east at (width, height)", () => {
    const w = worldFromBbox(bbox);
    const sw = w.projector.toLocal({ lat: bbox.south, lon: bbox.west });
    const ne = w.projector.toLocal({ lat: bbox.north, lon: bbox.east });
    expect(sw.x).toBeCloseTo(0, 6);
    expect(sw.y).toBeCloseTo(0, 6);
    expect(ne.x).toBeCloseTo(w.widthM, 6);
    expect(ne.y).toBeCloseTo(w.heightM, 6);
    expect(w.widthM).toBeGreaterThan(0);
    expect(w.heightM).toBeGreaterThan(0);
  });

  it("round-trips toLocal and toLatLon", () => {
    const w = worldFromBbox(bbox);
    const p = { lat: 33.0013, lon: -84.0021 };
    const back = w.projector.toLatLon(w.projector.toLocal(p));
    expect(back.lat).toBeCloseTo(p.lat, 9);
    expect(back.lon).toBeCloseTo(p.lon, 9);
  });

  it("has north positive in y", () => {
    const w = worldFromBbox(bbox);
    const a = w.projector.toLocal({ lat: 33.0, lon: -84.0 });
    const b = w.projector.toLocal({ lat: 33.001, lon: -84.0 });
    expect(b.y).toBeGreaterThan(a.y);
  });
});

describe("syntheticBbox / blankWorld", () => {
  it("gives a world of the requested size", () => {
    const w = worldFromBbox(syntheticBbox(6000, 6000));
    expect(w.widthM).toBeCloseTo(6000, 6);
    expect(w.heightM).toBeCloseTo(6000, 6);
    const r = worldFromBbox(syntheticBbox(4000, 2500));
    expect(r.widthM).toBeCloseTo(4000, 6);
    expect(r.heightM).toBeCloseTo(2500, 6);
  });

  it("builds empty envelopes with identical synthetic bbox", () => {
    const { roads, buildings } = blankWorld("world-test", 6, 6, "2026-11-09T00:00:00.000Z");
    expect(roads.bbox).toEqual(buildings.bbox);
    expect(roads.endpoint).toBe("authored://heat-street/world-test");
    expect(roads.response.elements).toEqual([]);
    expect(buildings.response.elements).toEqual([]);
    expect(roads.fetchedAt).toBe("2026-11-09T00:00:00.000Z");
  });

  it("rejects bad ids and sizes", () => {
    expect(() => blankWorld("Bad_Id", 6, 6, "x")).toThrow();
    expect(() => blankWorld("../x", 6, 6, "x")).toThrow();
    expect(() => blankWorld("ok", 0.1, 6, "x")).toThrow();
    expect(() => blankWorld("ok", 6, 11, "x")).toThrow();
    expect(() => blankWorld("ok", Number.NaN, 6, "x")).toThrow();
  });
});

describe("worldConfigSource", () => {
  it("writes a typed config with the exact bbox numbers", () => {
    const bbox = syntheticBbox(6000, 6000);
    const src = worldConfigSource("world-test", bbox, "2026-11-09T00:00:00.000Z");
    expect(src).toContain("worldTestConfig: AreaConfig");
    expect(src).toContain('areaId: "world-test"');
    expect(src).toContain('demSource: "none-flat-authored"');
    expect(src).toContain('osmExtract: "authored://heat-street/world-test"');
    expect(src).toContain("excludeHighwayClasses: []");
    expect(src).toContain("surfaceFallbackAcknowledged: true");
    for (const n of [bbox.south, bbox.west, bbox.north, bbox.east]) {
      expect(src).toContain(String(n));
    }
  });

  it("rejects bad ids", () => {
    expect(() => worldConfigSource('x"; evil()', syntheticBbox(1000, 1000), "s")).toThrow();
  });
});

describe("gridStep", () => {
  it("picks the smallest 1-2-5 step that is wide enough on screen", () => {
    expect(gridStep(1, 40)).toBe(50);
    expect(gridStep(0.1, 40)).toBe(500);
    expect(gridStep(0.02, 40)).toBe(2000);
    expect(gridStep(10, 40)).toBe(5);
  });
});

describe("scaleBar", () => {
  it("picks the largest 1-2-5 length that fits", () => {
    expect(scaleBar(0.1, 150)).toEqual({ metres: 1000, px: 100, label: "1 km" });
  });
  it("labels metres below 1 km and km at or above", () => {
    expect(scaleBar(1, 150).label).toBe("100 m");
    expect(scaleBar(1, 600).label).toBe("500 m");
    expect(scaleBar(0.05, 150).label).toBe("2 km");
  });
});

describe("tileLines", () => {
  it("includes both edges", () => {
    const t = tileLines(6000, 6000, 1000);
    expect(t.xs).toHaveLength(7);
    expect(t.ys).toHaveLength(7);
  });
  it("includes the far edge when not a multiple", () => {
    expect(tileLines(2500, 2500, 1000).xs).toEqual([0, 1000, 2000, 2500]);
  });
  it("exposes the tile sizes", () => {
    expect(TILE_SIZES_M).toEqual([250, 500, 1000, 2000]);
    expect(DEFAULT_TILE_M).toBe(1000);
  });
});

describe("view maths", () => {
  it("fitView centres the world", () => {
    const v = fitView(6000, 6000, 1000, 800, 40);
    expect(v.scale).toBeCloseTo((800 - 80) / 6000, 9);
    const r = visibleRect(v, 1000, 800);
    expect((r.minX + r.maxX) / 2).toBeCloseTo(3000, 6);
    expect((r.minY + r.maxY) / 2).toBeCloseTo(3000, 6);
  });

  it("zoomAt keeps the point under the cursor fixed", () => {
    const v = fitView(6000, 6000, 1000, 800, 40);
    const sx = 300;
    const sy = 200;
    const wx = (sx - v.panX) / v.scale;
    const wy = (v.panY - sy) / v.scale;
    const z = zoomAt(v, 2.5, sx, sy, 0.001, 20);
    expect(z.scale).toBeCloseTo(v.scale * 2.5, 9);
    expect((sx - z.panX) / z.scale).toBeCloseTo(wx, 6);
    expect((z.panY - sy) / z.scale).toBeCloseTo(wy, 6);
  });

  it("zoomAt clamps the scale", () => {
    const v = { scale: 1, panX: 0, panY: 0 };
    expect(zoomAt(v, 1000, 0, 0, 0.1, 20).scale).toBe(20);
    expect(zoomAt(v, 0.0001, 0, 0, 0.1, 20).scale).toBe(0.1);
  });

  it("visibleRect matches the canvas corners", () => {
    const r = visibleRect({ scale: 2, panX: 100, panY: 300 }, 400, 200);
    expect(r).toEqual({ minX: -50, maxX: 150, maxY: 150, minY: 50 });
  });
});
