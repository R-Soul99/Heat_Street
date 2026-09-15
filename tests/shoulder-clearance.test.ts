import { describe, expect, it } from "vitest";
import {
  buildingBoundingRadius,
  type ClearanceBuilding,
  resolvePointShoulderWidth,
} from "../src/core/shoulder-clearance";

const HALF_WIDTH = 3; // a 6m-wide road

describe("buildingBoundingRadius", () => {
  it("is the hypotenuse of the two half-extents", () => {
    expect(buildingBoundingRadius(3, 4)).toBeCloseTo(5, 9);
    expect(buildingBoundingRadius(0, 0)).toBe(0);
  });
});

describe("resolvePointShoulderWidth", () => {
  it("returns targetWidthM unchanged with no buildings nearby", () => {
    const width = resolvePointShoulderWidth(0, 10, HALF_WIDTH, [], 20, 3, 2);
    expect(width).toBe(20);
  });

  it("returns targetWidthM unchanged when every building is far away", () => {
    const farBuildings: ClearanceBuilding[] = [{ centerX: 500, centerZ: 500, radiusM: 5 }];
    const width = resolvePointShoulderWidth(0, 10, HALF_WIDTH, farBuildings, 20, 3, 2);
    expect(width).toBe(20);
  });

  it("narrows to the available clearance when a building sits closer than targetWidthM", () => {
    // Building centre 15m from the query point (x=15, same z), radius 5,
    // halfWidth 3, safety margin 2: available = 15 - 5 - 3 - 2 = 5.
    const closeBuilding: ClearanceBuilding[] = [{ centerX: 15, centerZ: 10, radiusM: 5 }];
    const width = resolvePointShoulderWidth(0, 10, HALF_WIDTH, closeBuilding, 20, 3, 2);
    expect(width).toBeCloseTo(5, 6);
  });

  it("never returns less than minWidthM, however close the building is", () => {
    const veryCloseBuilding: ClearanceBuilding[] = [{ centerX: 3.5, centerZ: 10, radiusM: 1 }];
    // available = 3.5 - 1 - 3 - 2 = -2.5 -- clamped up to minWidthM.
    const width = resolvePointShoulderWidth(0, 10, HALF_WIDTH, veryCloseBuilding, 20, 3, 2);
    expect(width).toBe(3);
  });

  it("resolves independently per point -- a query point far from a building is unaffected by that building even on the same edge", () => {
    const buildingNearOnePoint: ClearanceBuilding[] = [{ centerX: 4, centerZ: 10, radiusM: 1 }];
    // Point right next to the building: available = 4 - 1 - 3 - 2 = -2 -> clamped to min.
    const nearWidth = resolvePointShoulderWidth(0, 10, HALF_WIDTH, buildingNearOnePoint, 20, 3, 2);
    expect(nearWidth).toBe(3);
    // A different point 200m away on the "same edge" (caller's concern, not
    // this function's) sees the SAME building as irrelevant -- this is the
    // exact property that fixes the plan 04-11 "whole edge dragged down to
    // its tightest point" regression: each query point gets its own answer.
    const farWidth = resolvePointShoulderWidth(0, 210, HALF_WIDTH, buildingNearOnePoint, 20, 3, 2);
    expect(farWidth).toBe(20);
  });

  it("uses the road's own paved-edge distance, not the query point itself, as the zero point", () => {
    // A wider road (larger halfWidthM) has LESS available clearance to the
    // same building than a narrower one at the identical point, all else equal.
    const building: ClearanceBuilding[] = [{ centerX: 15, centerZ: 10, radiusM: 5 }];
    const narrowWidth = resolvePointShoulderWidth(0, 10, 3, building, 20, 3, 2);
    const wideWidth = resolvePointShoulderWidth(0, 10, 10, building, 20, 3, 2);
    expect(wideWidth).toBeLessThan(narrowWidth);
  });
});
