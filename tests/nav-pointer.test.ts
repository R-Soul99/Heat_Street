import { describe, expect, it } from "vitest";
import { computeNavigation } from "../src/debug/nav-pointer";

/**
 * Only `computeNavigation` is exercised here — it is the pure half of the
 * module. `createNavPointer` needs a DOM, which does not exist in Vitest's
 * `node` environment; a browser checkpoint covers that half.
 */
describe("computeNavigation", () => {
  it("reads 0 degrees when the target is directly ahead", () => {
    const { relativeBearingDeg } = computeNavigation(0, 0, 0, -1, 0, -100);
    expect(relativeBearingDeg).toBeCloseTo(0, 5);
  });

  it("reads +90 degrees when the target is directly to the right of a car facing -Z", () => {
    const { relativeBearingDeg } = computeNavigation(0, 0, 0, -1, 100, 0);
    expect(relativeBearingDeg).toBeCloseTo(90, 5);
  });

  it("reads -90 degrees when the target is directly to the left of a car facing -Z", () => {
    const { relativeBearingDeg } = computeNavigation(0, 0, 0, -1, -100, 0);
    expect(relativeBearingDeg).toBeCloseTo(-90, 5);
  });

  it("reads +-180 degrees when the target is directly behind", () => {
    const { relativeBearingDeg } = computeNavigation(0, 0, 0, -1, 0, 100);
    expect(Math.abs(relativeBearingDeg)).toBeCloseTo(180, 5);
  });

  it("is independent of car position: only the car-to-target vector matters", () => {
    const a = computeNavigation(0, 0, 0, -1, 100, -100);
    const b = computeNavigation(500, 500, 0, -1, 600, 400);
    expect(a.relativeBearingDeg).toBeCloseTo(b.relativeBearingDeg, 5);
  });

  it("computes straight-line distance regardless of forward direction", () => {
    const { distanceM } = computeNavigation(0, 0, 1, 0, 3, 4);
    expect(distanceM).toBeCloseTo(5, 5);
  });

  it("rotates with the car: the same target reads a different relative bearing from a different heading", () => {
    const facingNorth = computeNavigation(0, 0, 0, -1, 100, 0);
    const facingEast = computeNavigation(0, 0, 1, 0, 100, 0);
    expect(facingNorth.relativeBearingDeg).not.toBeCloseTo(facingEast.relativeBearingDeg, 0);
  });
});
