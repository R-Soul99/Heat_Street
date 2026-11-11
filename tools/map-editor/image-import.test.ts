import { describe, expect, it } from "vitest";
import {
  appendImportedRoads,
  COARSE_M_PER_PX,
  footprintWarnings,
  importScale,
  pixelToWorld,
  planImportWorld,
} from "./image-import.ts";
import type { RoadGraphPx } from "./image-trace.ts";
import { nextNodeId } from "./model.ts";
import { blankWorld, worldFromBbox } from "./world.ts";

describe("importScale", () => {
  it("locks the aspect from the width in km", () => {
    const s = importScale({ imageW: 2083, imageH: 1000, widthKm: 1.96 });
    expect(s.widthM).toBeCloseTo(1960, 6);
    expect(s.heightM).toBeCloseTo((1960 * 1000) / 2083, 6);
    expect(s.mPerPx).toBeCloseTo(0.941, 3);
    expect(s.coarse).toBe(false);
  });

  it("agrees between the two entry modes", () => {
    const a = importScale({ imageW: 2083, imageH: 1000, widthKm: 1.96 });
    const b = importScale({ imageW: 2083, imageH: 1000, mPerPx: a.mPerPx });
    expect(b.widthM).toBeCloseTo(a.widthM, 6);
    expect(b.heightM).toBeCloseTo(a.heightM, 6);
  });

  it("flags coarse pictures", () => {
    const s = importScale({ imageW: 1000, imageH: 500, widthKm: 4 });
    expect(s.mPerPx).toBe(4);
    expect(s.mPerPx).toBeGreaterThan(COARSE_M_PER_PX);
    expect(s.coarse).toBe(true);
    expect(s.warnings[0]).toMatch(/coarse/);
  });

  it("rejects bad input", () => {
    expect(() => importScale({ imageW: 100, imageH: 100 })).toThrow();
    expect(() => importScale({ imageW: 100, imageH: 100, widthKm: -1 })).toThrow();
    expect(() => importScale({ imageW: 0, imageH: 100, widthKm: 1 })).toThrow();
  });
});

describe("footprintWarnings", () => {
  const scale = { widthM: 4000, heightM: 2000 };
  it("warns with the overflow in metres", () => {
    const w = footprintWarnings(scale, { x: 500, y: 0 }, { widthM: 4200, heightM: 2000 });
    expect(w.length).toBe(1);
    expect(w[0]).toMatch(/300 m wider/);
    expect(footprintWarnings(scale, { x: 0, y: 100 }, { widthM: 4000, heightM: 2000 })[0]).toMatch(
      /100 m taller/,
    );
  });
  it("is silent when it fits exactly", () => {
    expect(footprintWarnings(scale, { x: 0, y: 0 }, { widthM: 4000, heightM: 2000 })).toEqual([]);
  });
});

describe("pixelToWorld", () => {
  it("puts the image top at north and the bottom-left at the SW corner", () => {
    const top = pixelToWorld({ x: 0.5, y: 0.5 }, 100, 2, { x: 10, y: 20 });
    expect(top).toEqual({ x: 11, y: 20 + 99.5 * 2 });
    const bl = pixelToWorld({ x: 0.5, y: 99.5 }, 100, 2, { x: 0, y: 0 });
    expect(bl.x).toBeCloseTo(1, 9);
    expect(bl.y).toBeCloseTo(1, 9);
  });
});

describe("appendImportedRoads", () => {
  const tGraph: RoadGraphPx = {
    nodes: [
      { id: 0, x: 0, y: 100, degree: 1 },
      { id: 1, x: 100, y: 100, degree: 3 },
      { id: 2, x: 200, y: 100, degree: 1 },
      { id: 3, x: 100, y: 200, degree: 1 },
    ],
    paths: [
      {
        a: 0,
        b: 1,
        points: [
          { x: 0, y: 100 },
          { x: 50, y: 100 },
          { x: 100, y: 100 },
        ],
      },
      {
        a: 1,
        b: 2,
        points: [
          { x: 100, y: 100 },
          { x: 200, y: 100 },
        ],
      },
      {
        a: 1,
        b: 3,
        points: [
          { x: 100, y: 100 },
          { x: 100, y: 200 },
        ],
      },
    ],
  };
  const place = { imageH: 200, mPerPx: 10, offset: { x: 0, y: 0 } };

  it("makes ordinary ways with shared junction nodes", () => {
    const { roads } = blankWorld("t", 4, 4, "2026-01-01T00:00:00.000Z");
    const proj = worldFromBbox(roads.bbox).projector;
    // pre-existing way so ids must not collide
    const before = appendImportedRoads(roads, proj, tGraph, place);
    const ways = appendImportedRoads(roads, proj, tGraph, place);
    expect(before.length).toBe(3);
    expect(ways.length).toBe(3);
    for (const w of ways) {
      expect(w.tags).toEqual({ highway: "residential", width: "8", surface: "asphalt" });
      expect(w.geometry.length).toBe(w.nodes?.length);
    }
    const ids = roads.response.elements.map((w) => w.id);
    expect(new Set(ids).size).toBe(ids.length);
    const junction = ways[0]?.nodes?.[ways[0].nodes.length - 1];
    expect(ways[1]?.nodes?.[0]).toBe(junction);
    expect(ways[2]?.nodes?.[0]).toBe(junction);
    const endpoints = [ways[0]?.nodes?.[0], ways[1]?.nodes?.[1], ways[2]?.nodes?.[1]];
    expect(new Set(endpoints).size).toBe(3);
    // Only the junction id is shared between the second batch's ways.
    const all = ways.flatMap((w) => w.nodes ?? []);
    expect(all.length - new Set(all).size).toBe(2);
    expect(nextNodeId(roads)).toBeGreaterThan(Math.max(...all));
  });

  it("round-trips geometry to the expected metres", () => {
    const { roads } = blankWorld("t", 4, 4, "2026-01-01T00:00:00.000Z");
    const proj = worldFromBbox(roads.bbox).projector;
    const ways = appendImportedRoads(roads, proj, tGraph, place, {
      widthM: 8,
      highway: "residential",
      surface: "tarmac",
    });
    const p = proj.toLocal(
      (ways[0] as { geometry: { lat: number; lon: number }[] }).geometry[1] as {
        lat: number;
        lon: number;
      },
    );
    const want = pixelToWorld({ x: 50, y: 100 }, 200, 10, { x: 0, y: 0 });
    expect(Math.hypot(p.x - want.x, p.y - want.y)).toBeLessThan(1e-3);
  });

  it("applies width / highway / surface options", () => {
    const { roads } = blankWorld("t", 4, 4, "2026-01-01T00:00:00.000Z");
    const proj = worldFromBbox(roads.bbox).projector;
    const ways = appendImportedRoads(roads, proj, tGraph, place, {
      widthM: 12,
      highway: "tertiary",
      surface: "gravel",
    });
    expect(ways[0]?.tags).toEqual({ highway: "tertiary", width: "12", surface: "gravel" });
  });
});

describe("planImportWorld", () => {
  it("plans the poppmap case", () => {
    const p = planImportWorld(1960, 941, 1.96);
    expect(p.widthKm).toBe(1.96);
    expect(p.heightKm).toBeCloseTo(0.941, 6);
    expect(p.mPerPx).toBeCloseTo(1, 6);
    expect(p.errors).toEqual([]);
  });

  it("rejects a derived height that is too small and hints a wider width", () => {
    const p = planImportWorld(2000, 400, 2);
    expect(p.errors).toContain(
      "Height from the image would be 0.4 km; maps must be 0.5 to 10 km. Use a wider Width (at least 2.5 km) or a taller image.",
    );
  });

  it("rejects a derived height that is too large", () => {
    const p = planImportWorld(400, 2000, 2.5);
    expect(p.errors[0]).toContain("Use a narrower Width (at most 2 km)");
  });

  it("rejects a width over the limit", () => {
    expect(planImportWorld(1000, 1000, 12).errors).toContain(
      "Width must be between 0.5 and 10 km.",
    );
  });

  it("passes the coarse warning through", () => {
    const p = planImportWorld(1000, 1000, 5);
    expect(p.mPerPx).toBe(5);
    expect(p.errors).toEqual([]);
    expect(p.warnings.length).toBe(1);
  });

  it("does not throw on bad width", () => {
    expect(planImportWorld(100, 100, 0).errors).toEqual(["Enter a width in km."]);
    expect(planImportWorld(100, 100, Number.NaN).errors).toEqual(["Enter a width in km."]);
  });
});
