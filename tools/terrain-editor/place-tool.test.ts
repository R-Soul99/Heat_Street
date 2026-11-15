import { describe, expect, it } from "vitest";
import { forwardFromYaw } from "../../src/core/heading.ts";
import { createDragGesture, DRAG_HEADING_MIN_M } from "./place-tool.ts";

describe("createDragGesture", () => {
  it("yields position and heading for a long drag", () => {
    const g = createDragGesture();
    g.down(10, 20);
    g.move(10, 10);
    expect(g.active()).toBe(true);
    expect(g.preview()).toEqual({ from: { x: 10, z: 20 }, to: { x: 10, z: 10 } });
    const r = g.up();
    expect(r?.x).toBe(10);
    expect(r?.z).toBe(20);
    const f = forwardFromYaw(r?.headingRad as number);
    expect(f.x).toBeCloseTo(0);
    expect(f.z).toBeCloseTo(-1);
    expect(g.active()).toBe(false);
  });
  it("drag due east round-trips through forwardFromYaw", () => {
    const g = createDragGesture();
    g.down(0, 0);
    g.move(5, 0);
    const f = forwardFromYaw(g.up()?.headingRad as number);
    expect(f.x).toBeCloseTo(1);
    expect(f.z).toBeCloseTo(0);
  });
  it("short drag has no heading", () => {
    expect(DRAG_HEADING_MIN_M).toBe(1);
    const g = createDragGesture();
    g.down(0, 0);
    g.move(0.5, 0.5);
    expect(g.up()?.headingRad).toBeUndefined();
  });
  it("cancel returns to idle", () => {
    const g = createDragGesture();
    g.down(0, 0);
    g.cancel();
    expect(g.active()).toBe(false);
    expect(g.up()).toBeUndefined();
    expect(g.preview()).toBeUndefined();
  });
});
