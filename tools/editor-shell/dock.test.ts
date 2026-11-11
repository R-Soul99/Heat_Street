import { describe, expect, it } from "vitest";
import { flyoutAnchor, splitDockTools } from "./dock.ts";

const tool = (id: string, dock?: "top") => ({ id, dock });

describe("splitDockTools", () => {
  it("puts dock:top tools in top and the rest in bottom, keeping order", () => {
    const { top, bottom } = splitDockTools([
      tool("raise", "top"),
      tool("smooth"),
      tool("lower", "top"),
      tool("paint"),
    ]);
    expect(top.map((t) => t.id)).toEqual(["raise", "lower"]);
    expect(bottom.map((t) => t.id)).toEqual(["smooth", "paint"]);
  });

  it("handles no top tools", () => {
    const { top, bottom } = splitDockTools([tool("a"), tool("b")]);
    expect(top).toEqual([]);
    expect(bottom).toHaveLength(2);
  });
});

describe("flyoutAnchor", () => {
  const container = { left: 0, top: 0, right: 1000, bottom: 600, width: 1000, height: 600 };
  const rect = (left: number, top: number, w: number, h: number) => ({
    left,
    top,
    right: left + w,
    bottom: top + h,
    width: w,
    height: h,
  });

  it("aligns the flyout's left edge with the button and sits above it", () => {
    const a = flyoutAnchor(rect(100, 540, 40, 40), container, { width: 260, height: 200 });
    expect(a.left).toBe(100);
    expect(a.bottom).toBe(600 - 540 + 6);
  });

  it("clamps inside the container on the right and the left", () => {
    const r = flyoutAnchor(rect(950, 540, 40, 40), container, { width: 260, height: 200 });
    expect(r.left).toBe(1000 - 8 - 260);
    const l = flyoutAnchor(rect(2, 540, 40, 40), container, { width: 260, height: 200 });
    expect(l.left).toBe(8);
  });

  it("is relative to the container origin and honours a custom gap", () => {
    const c = { left: 50, top: 20, right: 1050, bottom: 620, width: 1000, height: 600 };
    const a = flyoutAnchor(rect(150, 560, 40, 40), c, { width: 100, height: 50 }, 10);
    expect(a.left).toBe(100);
    expect(a.bottom).toBe(620 - 560 + 10);
  });
});
