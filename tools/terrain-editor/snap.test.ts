import { describe, expect, it } from "vitest";
import {
  DEFAULT_SNAP_M,
  parseSnapSize,
  SNAP_GRID_MAX_LINES,
  SNAP_SIZES_M,
  snapDelta,
  snapGridSegments,
  snapPoint,
  snapValue,
} from "./snap.ts";

describe("snapValue", () => {
  it("rounds to the nearest multiple", () => {
    expect(snapValue(7.4, 5)).toBe(5);
    expect(snapValue(7.6, 5)).toBe(10);
    expect(snapValue(0.4, 1)).toBe(0);
  });
  it("handles negative coordinates symmetrically", () => {
    expect(snapValue(-7.4, 5)).toBe(-5);
    expect(snapValue(-7.6, 5)).toBe(-10);
    expect(snapValue(-0.2, 1)).toBe(0);
    expect(Object.is(snapValue(-0.2, 1), -0)).toBe(false);
  });
  it("rounds exactly half-way away from zero on both sides", () => {
    expect(snapValue(2.5, 5)).toBe(5);
    expect(snapValue(-2.5, 5)).toBe(-5);
    expect(snapValue(0.5, 1)).toBe(1);
    expect(snapValue(-0.5, 1)).toBe(-1);
    expect(snapValue(7.5, 5)).toBe(10);
  });
  it("leaves bad input alone", () => {
    expect(snapValue(3.3, 0)).toBe(3.3);
    expect(snapValue(3.3, -5)).toBe(3.3);
    expect(snapValue(Number.NaN, 5)).toBeNaN();
    expect(snapValue(3.3, Number.NaN)).toBe(3.3);
  });
});

describe("snapPoint and snapDelta", () => {
  it("snaps both axes when on", () => {
    expect(snapPoint(12.4, -7.6, { on: true, sizeM: 5 })).toEqual({ x: 10, z: -10 });
  });
  it("returns the point untouched when off or bypassed (Alt)", () => {
    expect(snapPoint(12.4, -7.6, { on: false, sizeM: 5 })).toEqual({ x: 12.4, z: -7.6 });
    expect(snapPoint(12.4, -7.6, { on: true, sizeM: 5, bypass: true })).toEqual({
      x: 12.4,
      z: -7.6,
    });
  });
  it("snapDelta lands the anchor on the grid", () => {
    const d = snapDelta(3, 4, 6.2, 1.1, { on: true, sizeM: 5 });
    expect(3 + d.dx).toBeCloseTo(10, 9);
    expect(4 + d.dz).toBeCloseTo(5, 9);
    expect(snapDelta(3, 4, 6.2, 1.1, { on: true, sizeM: 5, bypass: true })).toEqual({
      dx: 6.2,
      dz: 1.1,
    });
    expect(snapDelta(3, 4, 6.2, 1.1, { on: false, sizeM: 5 })).toEqual({ dx: 6.2, dz: 1.1 });
  });
});

describe("parseSnapSize", () => {
  it("accepts only the offered sizes", () => {
    for (const s of SNAP_SIZES_M) {
      expect(parseSnapSize(String(s))).toBe(s);
      expect(parseSnapSize(s)).toBe(s);
    }
    expect(parseSnapSize("7")).toBe(DEFAULT_SNAP_M);
    expect(parseSnapSize("")).toBe(DEFAULT_SNAP_M);
    expect(parseSnapSize(null)).toBe(DEFAULT_SNAP_M);
    expect(DEFAULT_SNAP_M).toBe(5);
  });
});

describe("snapGridSegments", () => {
  const bounds = { minX: 0, maxX: 100, minZ: 0, maxZ: 100 };
  const flat = () => 3;
  it("draws lines on multiples of the size, draped with the lift", () => {
    const seg = snapGridSegments(bounds, 50, 50, 10, 5, flat, 0.1);
    expect(seg.length % 6).toBe(0);
    expect(seg.length).toBeGreaterThan(0);
    for (let i = 0; i < seg.length; i += 3) expect(seg[i + 1]).toBeCloseTo(3.1, 5);
    // Every segment is axis-aligned and sits on a multiple of 5 in the other axis.
    for (let i = 0; i < seg.length; i += 6) {
      const sameX = seg[i] === seg[i + 3];
      const sameZ = seg[i + 2] === seg[i + 5];
      expect(sameX || sameZ).toBe(true);
      if (sameX) expect(seg[i] % 5).toBeCloseTo(0, 5);
      if (sameZ) expect(seg[i + 2] % 5).toBeCloseTo(0, 5);
    }
  });
  it("is clipped to the area", () => {
    const seg = snapGridSegments(bounds, 2, 2, 30, 5, flat, 0);
    for (let i = 0; i < seg.length; i += 3) {
      expect(seg[i]).toBeGreaterThanOrEqual(0);
      expect(seg[i + 2]).toBeGreaterThanOrEqual(0);
    }
  });
  it("draws nothing for bad input or an over-dense window", () => {
    expect(snapGridSegments(bounds, 50, 50, 10, 0, flat, 0).length).toBe(0);
    expect(snapGridSegments(bounds, Number.NaN, 50, 10, 5, flat, 0).length).toBe(0);
    const wide = { minX: -1e6, maxX: 1e6, minZ: -1e6, maxZ: 1e6 };
    expect(snapGridSegments(wide, 0, 0, SNAP_GRID_MAX_LINES * 2, 1, flat, 0).length).toBe(0);
    expect(snapGridSegments(bounds, 500, 500, 10, 5, flat, 0).length).toBe(0);
  });
});
