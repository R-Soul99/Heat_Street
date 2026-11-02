import { describe, expect, it } from "vitest";
import { SURFACE_TYPES } from "../src/core/surface-types";
import {
  createPaintMap,
  decodePaintSurface,
  encodePaintValue,
  isRoadAt,
  PAINT_ROAD_FLAG,
  PAINT_SURFACE_MASK,
  paintIndexAt,
  surfaceAt,
  worldToPaintPixel,
} from "../src/core/terrain-paint";

const opts = {
  originX: 0,
  originZ: 0,
  widthM: 10,
  depthM: 5,
  metresPerPixel: 0.5,
  fill: "grass" as const,
};

describe("terrain paint map", () => {
  it("creates a filled map of the right size", () => {
    const p = createPaintMap(opts);
    expect(p.width).toBe(20);
    expect(p.height).toBe(10);
    expect(p.data.length).toBe(200);
    expect(surfaceAt(p, 3, 2)).toBe("grass");
    expect(isRoadAt(p, 3, 2)).toBe(false);
  });

  it("encodes surface index and road flag", () => {
    const v = encodePaintValue("tarmac", true);
    expect(v & PAINT_ROAD_FLAG).toBe(PAINT_ROAD_FLAG);
    expect(v & PAINT_SURFACE_MASK).toBe(SURFACE_TYPES.indexOf("tarmac"));
  });

  it("reads back the painted pixel surface and road flag", () => {
    const p = createPaintMap(opts);
    p.data[2 * p.width + 4] = encodePaintValue("mud", true);
    expect(surfaceAt(p, 2.25, 1.25)).toBe("mud");
    expect(isRoadAt(p, 2.25, 1.25)).toBe(true);
    expect(surfaceAt(p, 2.75, 1.25)).toBe("grass");
  });

  it("clamps outside points and tolerates NaN", () => {
    const p = createPaintMap(opts);
    p.data[0] = encodePaintValue("sand", false);
    p.data[p.data.length - 1] = encodePaintValue("gravel", false);
    expect(surfaceAt(p, -100, -100)).toBe("sand");
    expect(surfaceAt(p, 1e6, 1e6)).toBe("gravel");
    expect(surfaceAt(p, Number.NaN, 0, "mud")).toBe("mud");
    expect(paintIndexAt(p, 0, Number.NaN)).toBe(-1);
  });

  it("returns the fallback for an out-of-enum stored index", () => {
    const p = createPaintMap(opts);
    p.data[0] = 0x0e;
    expect(decodePaintSurface(0x0e)).toBe("tarmac");
    expect(surfaceAt(p, 0.1, 0.1)).toBe("tarmac");
    expect(surfaceAt(p, 0.1, 0.1, "dirt_road")).toBe("dirt_road");
  });

  it("worldToPaintPixel floors and clamps", () => {
    const p = createPaintMap({ ...opts, originX: 10, originZ: -5 });
    expect(worldToPaintPixel(p, 10.74, -4.2)).toEqual({ px: 1, pz: 1 });
    expect(worldToPaintPixel(p, -50, 500)).toEqual({ px: 0, pz: 9 });
    expect(paintIndexAt(p, 10.74, -4.2)).toBe(1 * p.width + 1);
  });

  it("rejects oversized or invalid maps before allocating", () => {
    expect(() => createPaintMap({ ...opts, widthM: 1e6, depthM: 1e6 })).toThrow(RangeError);
    expect(() => createPaintMap({ ...opts, metresPerPixel: 0 })).toThrow(RangeError);
  });
});
