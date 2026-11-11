import { describe, expect, it } from "vitest";
import type { Tool, ToolOptions } from "./tool-dispatch";
import {
  adjustPrimary,
  editFeedback,
  NO_AREA_MESSAGE,
  primaryValue,
  pushPullDelta,
} from "./value-keys";

const opts = (patch: Partial<ToolOptions> = {}): ToolOptions =>
  ({
    radiusM: 12,
    widthM: 6,
    blockCells: 2,
    smoothPasses: 3,
    gridStepM: 1,
    ...patch,
  }) as ToolOptions;

describe("primaryValue", () => {
  it("brush tools use radius", () => {
    for (const t of ["raise", "lower", "smooth", "flatten", "paint", "erase", "lock"] as Tool[]) {
      expect(primaryValue(t)).toEqual({
        key: "radiusM",
        label: "Radius",
        unit: "m",
        step: 0.5,
        coarse: 5,
        min: 0.5,
        max: 200,
        decimals: 1,
      });
    }
  });
  it("other tools", () => {
    expect(primaryValue("road")?.key).toBe("widthM");
    expect(primaryValue("road")).toMatchObject({ min: 3, max: 20, step: 0.5, coarse: 2 });
    expect(primaryValue("block")).toMatchObject({
      key: "blockCells",
      min: 1,
      max: 64,
      step: 1,
      coarse: 8,
      decimals: 0,
    });
    expect(primaryValue("smoothBox")).toMatchObject({
      key: "smoothPasses",
      min: 1,
      max: 10,
      coarse: 3,
    });
    expect(primaryValue("gridSelect")).toMatchObject({
      key: "gridStepM",
      min: 0.25,
      max: 5,
      step: 0.25,
      coarse: 1,
      decimals: 2,
    });
    expect(primaryValue("stamp")).toBeNull();
  });
});

describe("adjustPrimary", () => {
  it("steps and clamps", () => {
    expect(adjustPrimary("raise", opts(), 1, false)).toEqual({ radiusM: 12.5 });
    expect(adjustPrimary("raise", opts(), 1, true)).toEqual({ radiusM: 17 });
    expect(adjustPrimary("raise", opts({ radiusM: 200 }), 1, false)).toEqual({ radiusM: 200 });
    expect(adjustPrimary("raise", opts({ radiusM: 0.5 }), -1, true)).toEqual({ radiusM: 0.5 });
  });
  it("returns null for stamp", () => {
    expect(adjustPrimary("stamp", opts(), 1, false)).toBeNull();
  });
});

describe("pushPullDelta", () => {
  it("converts pixels to metres", () => {
    expect(pushPullDelta(-100, 0.05, false)).toBeCloseTo(5, 10);
    expect(pushPullDelta(40, 0.05, false)).toBeCloseTo(-2, 10);
    expect(pushPullDelta(-100, 0.05, true)).toBeCloseTo(1, 10);
  });
});

describe("editFeedback", () => {
  it("formats messages", () => {
    expect(editFeedback({ heightChange: { maxUpM: 0.42, maxDownM: 0 } }, "raise")).toBe(
      "Raised up to +0.42 m.",
    );
    expect(editFeedback({ heightChange: { maxUpM: 0, maxDownM: 0.38 } }, "lower")).toBe(
      "Lowered up to -0.38 m.",
    );
    expect(editFeedback({ heightChange: { maxUpM: 0.42, maxDownM: 0.1 } }, "smooth")).toBe(
      "Moved +0.42 m / -0.10 m.",
    );
    expect(editFeedback({ heightChange: { maxUpM: 0, maxDownM: 0 } }, "raise")).toBe(
      "Nothing changed.",
    );
    expect(editFeedback({}, "raise")).toBeNull();
    expect(editFeedback({ heightChange: { maxUpM: 1, maxDownM: 0 } }, "gridSelect")).toBe(
      "Selection moved +1.00 m.",
    );
  });
  it("exports the no-area message", () => {
    expect(NO_AREA_MESSAGE).toBe(
      "Load or create an area first: pick one at the top and press Load, or use File > New...",
    );
  });
});
