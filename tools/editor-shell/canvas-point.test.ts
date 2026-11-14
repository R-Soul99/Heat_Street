import { describe, expect, it } from "vitest";
import { hudStartX, localPoint } from "./canvas-point.ts";

describe("localPoint", () => {
  it("subtracts the canvas rect origin", () => {
    expect(localPoint(300, 100, { left: 240, top: 28 })).toEqual({ x: 60, y: 72 });
  });
});

describe("hudStartX", () => {
  it("handles missing tool row and sidebar offset", () => {
    expect(hudStartX(null, 240)).toBe(16);
    expect(hudStartX(700, 240)).toBe(476);
    expect(hudStartX(700, 0)).toBe(716);
    expect(hudStartX(700, 240, 8)).toBe(468);
  });
});
