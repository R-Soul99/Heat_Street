import { describe, expect, it } from "vitest";
import { parseNumberInput, stepValue } from "./stepper";

const o = { step: 0.5, coarse: 10, min: 0, max: 20, decimals: 1 };

describe("stepValue", () => {
  it("steps fine and coarse", () => {
    expect(stepValue(1, 1, o, false)).toBe(1.5);
    expect(stepValue(1, 1, o, true)).toBe(6);
  });
  it("clamps", () => {
    expect(stepValue(19.5, 1, o, true)).toBe(20);
    expect(stepValue(0.2, -1, o, true)).toBe(0);
  });
  it("avoids float noise", () => {
    expect(stepValue(0.1, 1, { ...o, step: 0.2 }, false)).toBe(0.3);
  });
});

describe("parseNumberInput", () => {
  const r = { min: 0, max: 10 };
  it("parses and trims", () => {
    expect(parseNumberInput(" 2.5 ", r)).toBe(2.5);
  });
  it("rejects empty and junk", () => {
    expect(parseNumberInput("", r)).toBeNull();
    expect(parseNumberInput("abc", r)).toBeNull();
  });
  it("clamps", () => {
    expect(parseNumberInput("1e3", r)).toBe(10);
  });
  it("keeps full precision", () => {
    expect(parseNumberInput("0.9345318244236143", r)).toBe(0.9345318244236143);
  });
});
