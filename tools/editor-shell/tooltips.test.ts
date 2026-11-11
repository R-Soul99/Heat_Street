import { describe, expect, it } from "vitest";
import { tipPosition } from "./tooltips";

const vp = { width: 1000, height: 800 };
const tip = { width: 200, height: 40 };

describe("tipPosition", () => {
  it("places below with a 6px gap", () => {
    const p = tipPosition({ left: 100, top: 100, right: 160, bottom: 120 }, tip, vp);
    expect(p.top).toBe(126);
    expect(p.left).toBe(100);
  });
  it("flips above near the bottom", () => {
    const p = tipPosition({ left: 100, top: 760, right: 160, bottom: 780 }, tip, vp);
    expect(p.top).toBe(760 - 6 - 40);
  });
  it("clamps horizontally", () => {
    const p = tipPosition({ left: 980, top: 100, right: 1000, bottom: 120 }, tip, vp);
    expect(p.left + tip.width).toBeLessThanOrEqual(vp.width - 4);
    const q = tipPosition({ left: -50, top: 100, right: -10, bottom: 120 }, tip, vp);
    expect(q.left).toBeGreaterThanOrEqual(4);
  });
  it("never negative", () => {
    const p = tipPosition(
      { left: 0, top: 0, right: 10, bottom: 10 },
      { width: 2000, height: 2000 },
      vp,
    );
    expect(p.left).toBeGreaterThanOrEqual(0);
    expect(p.top).toBeGreaterThanOrEqual(0);
  });
});
