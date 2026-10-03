import { describe, expect, it } from "vitest";
import {
  nextSliding,
  TYRE_SLIP_RATIO_MAX,
  TYRE_SLIP_RELEASE_MARGIN,
  tyreSlipRatio,
} from "../src/core/tyre-slip";

const DT = 1 / 60;

describe("tyreSlipRatio", () => {
  it("is impulse magnitude over the friction limit", () => {
    // limit = 10 * 600 * (1/60) = 100
    expect(tyreSlipRatio(60, 80, 10, 600, DT)).toBeCloseTo(1, 9);
    expect(tyreSlipRatio(0, 50, 10, 600, DT)).toBeCloseTo(0.5, 9);
  });

  it("does not depend on engine force alone: same impulse, more load -> lower ratio", () => {
    expect(tyreSlipRatio(0, 80, 10, 900, DT)).toBeLessThan(tyreSlipRatio(0, 80, 10, 600, DT));
  });

  it("returns 0 for an unloaded wheel and for non-finite input", () => {
    expect(tyreSlipRatio(50, 50, 10, 0, DT)).toBe(0);
    expect(tyreSlipRatio(Number.NaN, 1, 10, 600, DT)).toBe(0);
    expect(tyreSlipRatio(1, 1, Number.POSITIVE_INFINITY, 600, DT)).toBe(0);
  });

  it("clamps to the ceiling", () => {
    expect(tyreSlipRatio(1e6, 0, 10, 600, DT)).toBe(TYRE_SLIP_RATIO_MAX);
  });
});

describe("nextSliding", () => {
  it("needs to exceed the threshold to start", () => {
    expect(nextSliding(false, 1.0, 1.0)).toBe(false);
    expect(nextSliding(false, 1.01, 1.0)).toBe(true);
  });

  it("keeps sliding inside the release margin and stops below it", () => {
    expect(nextSliding(true, 1.0 - TYRE_SLIP_RELEASE_MARGIN / 2, 1.0)).toBe(true);
    expect(nextSliding(true, 1.0 - TYRE_SLIP_RELEASE_MARGIN - 0.01, 1.0)).toBe(false);
  });
});
