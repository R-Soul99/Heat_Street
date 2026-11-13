import { describe, expect, it } from "vitest";
import type { Rect } from "./dock";
import { placeTip } from "./tip-place";

const rect = (left: number, top: number, w: number, h: number): Rect => ({
  left,
  top,
  right: left + w,
  bottom: top + h,
  width: w,
  height: h,
});
const vp = { width: 800, height: 600 };
const tip = { width: 100, height: 30 };

function hits(x: number, y: number, r: Rect): boolean {
  return x < r.right && x + tip.width > r.left && y < r.bottom && y + tip.height > r.top;
}

describe("placeTip", () => {
  it("open space: below, centred", () => {
    const a = rect(300, 100, 40, 20);
    const p = placeTip(a, tip, vp, [a]);
    expect(p.side).toBe("below");
    expect(p.x).toBe(320 - 50);
    expect(p.y).toBe(128);
  });
  it("clamps inside the viewport", () => {
    const a = rect(0, 100, 20, 20);
    expect(placeTip(a, tip, vp, []).x).toBe(4);
  });
  it("bottom row with a control above: goes right, not over the control", () => {
    const a = rect(10, 560, 30, 30);
    const above = rect(10, 520, 30, 30);
    const p = placeTip(a, tip, vp, [a, above]);
    expect(p.side).toBe("right");
    expect(hits(p.x, p.y, above)).toBe(false);
    expect(hits(p.x, p.y, a)).toBe(false);
  });
  it("goes left when right does not fit", () => {
    const a = rect(760, 560, 30, 30);
    const above = rect(760, 520, 30, 30);
    const p = placeTip(a, tip, vp, [a, above]);
    expect(p.side).toBe("left");
    expect(hits(p.x, p.y, above)).toBe(false);
  });
  it("every side blocked: least overlap, inside viewport", () => {
    const a = rect(300, 300, 40, 20);
    const ring = [
      rect(250, 322, 140, 50),
      rect(250, 250, 140, 48),
      rect(342, 290, 120, 40),
      rect(180, 290, 118, 40),
    ];
    const p = placeTip(a, tip, vp, [a, ...ring]);
    expect(p.x).toBeGreaterThanOrEqual(4);
    expect(p.y).toBeGreaterThanOrEqual(4);
    expect(p.x + tip.width).toBeLessThanOrEqual(vp.width - 4);
    expect(p.y + tip.height).toBeLessThanOrEqual(vp.height - 4);
  });
});
