import { describe, expect, it } from "vitest";
import {
  createHoldAccumulator,
  HOLD_MAX_FRAME_S,
  HOLD_TICK_S,
  heldTickStrength,
  isHoldTool,
} from "./hold-brush.ts";

describe("isHoldTool", () => {
  it("holds height and smooth brushes only", () => {
    for (const t of ["raise", "lower", "smooth", "flatten"]) expect(isHoldTool(t)).toBe(true);
    for (const t of ["paint", "road", "erase", "select", "lock"]) expect(isHoldTool(t)).toBe(false);
  });
});

describe("createHoldAccumulator", () => {
  it("emits one tick per fixed step and carries the remainder", () => {
    const a = createHoldAccumulator(0.05, 0.1);
    expect(a.advance(0.02)).toBe(0);
    expect(a.advance(0.02)).toBe(0);
    expect(a.advance(0.02)).toBe(1); // 0.06 total, 0.01 left
    expect(a.advance(0.04)).toBe(1); // 0.05 total
  });
  it("is steady: one second of small frames gives about 20 ticks", () => {
    const a = createHoldAccumulator();
    let n = 0;
    for (let i = 0; i < 100; i++) n += a.advance(0.01);
    expect(n).toBe(20);
  });
  it("clamps a long frame", () => {
    const a = createHoldAccumulator();
    const ticks = a.advance(5);
    expect(ticks).toBe(Math.floor(HOLD_MAX_FRAME_S / HOLD_TICK_S + 1e-9));
  });
  it("ignores bad and negative time, and reset drops the remainder", () => {
    const a = createHoldAccumulator(0.05, 0.1);
    expect(a.advance(Number.NaN)).toBe(0);
    expect(a.advance(-1)).toBe(0);
    a.advance(0.04);
    a.reset();
    expect(a.advance(0.04)).toBe(0);
  });
});

describe("heldTickStrength", () => {
  it("compounds to the stroke strength over one second", () => {
    const per = heldTickStrength(0.5);
    const total = 1 - (1 - per) ** (1 / HOLD_TICK_S);
    expect(total).toBeCloseTo(0.5, 6);
  });
  it("never finishes in one tick at strength 1, and is 0 for 0 or bad input", () => {
    expect(heldTickStrength(1)).toBeLessThan(0.5);
    expect(heldTickStrength(0)).toBe(0);
    expect(heldTickStrength(Number.NaN)).toBe(0);
  });
});
