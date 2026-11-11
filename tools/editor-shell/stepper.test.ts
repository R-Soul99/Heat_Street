import { describe, expect, it } from "vitest";
import { parseStepperInput, type StepperSpec, stepValue } from "./stepper";

const spec: StepperSpec = { step: 0.25, coarse: 4, min: 0.25, max: 5, decimals: 2 };

describe("stepValue", () => {
  it("steps fine and coarse", () => {
    expect(stepValue(1, 1, spec, false)).toBe(1.25);
    expect(stepValue(1, 1, spec, true)).toBe(2);
    expect(stepValue(1, -1, spec, false)).toBe(0.75);
  });
  it("clamps", () => {
    expect(stepValue(4.9, 1, spec, true)).toBe(5);
    expect(stepValue(0.25, -1, spec, false)).toBe(0.25);
  });
  it("has no float noise", () => {
    const s = { step: 0.1, coarse: 10, min: 0, max: 10, decimals: 1 };
    expect(stepValue(0.1 + 0.2, 1, s, false)).toBe(0.4);
  });
});

describe("parseStepperInput", () => {
  it("parses comma decimals", () => {
    expect(parseStepperInput("1,5", spec)).toBe(1.5);
  });
  it("rejects junk", () => {
    expect(parseStepperInput("abc", spec)).toBeUndefined();
    expect(parseStepperInput("  ", spec)).toBeUndefined();
  });
  it("clamps", () => {
    expect(parseStepperInput("99", spec)).toBe(5);
    expect(parseStepperInput("-3", spec)).toBe(0.25);
  });
});
