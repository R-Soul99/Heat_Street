import { describe, expect, it } from "vitest";
import { fmt3, fmtCount, fmtKm, fmtMetres } from "./format";

describe("format", () => {
  it("fmt3 rounds to 3dp and trims zeros", () => {
    expect(fmt3(0.9345318244236143)).toBe("0.935");
    expect(fmt3(2)).toBe("2");
    expect(fmt3(1.5)).toBe("1.5");
    expect(fmt3(-0.0004)).toBe("0");
    expect(fmt3(Number.NaN)).toBe("-");
    expect(fmt3(Number.POSITIVE_INFINITY)).toBe("-");
  });
  it("fmtMetres / fmtKm", () => {
    expect(fmtMetres(934.5318)).toBe("934.532 m");
    expect(fmtKm(1960)).toBe("1.96 km");
    expect(fmtKm(934.53)).toBe("0.935 km");
  });
  it("fmtCount pluralises", () => {
    expect(fmtCount(1, "road")).toBe("1 road");
    expect(fmtCount(3, "road")).toBe("3 roads");
    expect(fmtCount(0, "road")).toBe("0 roads");
  });
});
