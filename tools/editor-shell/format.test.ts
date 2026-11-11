import { describe, expect, it } from "vitest";
import { fmt3, fmtKm, fmtMetres, fmtXY } from "./format";

describe("fmt3", () => {
  it("rounds to 3 dp", () => {
    expect(fmt3(0.9345318244236143)).toBe("0.935");
    expect(fmt3(2)).toBe("2.000");
  });
  it("never shows negative zero", () => {
    expect(fmt3(-0.0001)).toBe("0.000");
  });
  it("handles non-finite", () => {
    expect(fmt3(Number.NaN)).toBe("-");
    expect(fmt3(Number.POSITIVE_INFINITY)).toBe("-");
  });
});

describe("fmtKm / fmtMetres / fmtXY", () => {
  it("formats km at 3 dp", () => {
    expect(fmtKm(934.5318)).toBe("0.935 km");
    expect(fmtKm(1960)).toBe("1.960 km");
  });
  it("formats metres", () => {
    expect(fmtMetres(12.345)).toBe("12.3 m");
    expect(fmtMetres(12.345, 2)).toBe("12.35 m");
  });
  it("formats x/y", () => {
    expect(fmtXY(12.34, -5.6)).toBe("x 12.3 m  y -5.6 m");
  });
});
