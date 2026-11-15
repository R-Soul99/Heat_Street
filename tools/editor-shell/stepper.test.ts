import { describe, expect, it } from "vitest";
import {
  applySteps,
  parseStepperInput,
  type StepperSpec,
  scrubSteps,
  snapToPreset,
  stepValue,
  wheelDir,
} from "./stepper";

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

describe("scrubSteps", () => {
  it("converts px to steps with carry", () => {
    expect(scrubSteps(8, 0)).toEqual({ steps: 1, carry: 0 });
    expect(scrubSteps(20, 0)).toEqual({ steps: 2, carry: 4 });
    expect(scrubSteps(5, 0)).toEqual({ steps: 0, carry: 5 });
    expect(scrubSteps(3, 5)).toEqual({ steps: 1, carry: 0 });
    expect(scrubSteps(-20, 0)).toEqual({ steps: -2, carry: -4 });
    expect(scrubSteps(0, 0)).toEqual({ steps: 0, carry: 0 });
    expect(scrubSteps(10, 0, 5)).toEqual({ steps: 2, carry: 0 });
  });
});

describe("applySteps", () => {
  it("applies signed steps via stepValue", () => {
    expect(applySteps(1, 3, spec, false)).toBe(1.75);
    expect(applySteps(1, -2, spec, false)).toBe(0.5);
    expect(applySteps(4, 10, spec, false)).toBe(5);
    expect(applySteps(1, 1, spec, true)).toBe(2);
    expect(applySteps(1, 0, spec, false)).toBe(1);
  });
});

describe("wheelDir", () => {
  it("maps wheel direction", () => {
    expect(wheelDir(-100)).toBe(1);
    expect(wheelDir(100)).toBe(-1);
    expect(wheelDir(0)).toBe(0);
    expect(wheelDir(0, -50)).toBe(1);
    expect(wheelDir(0, 50)).toBe(-1);
    expect(wheelDir(-3, 50)).toBe(1);
  });
});

describe("presets", () => {
  const ps = [1, 2, 5, 10, 20, 50] as const;
  const pspec = { step: 1, coarse: 2, min: 1, max: 50, decimals: 0, presets: ps };
  it("steps through presets and clamps at ends", () => {
    expect(stepValue(5, 1, pspec, false)).toBe(10);
    expect(stepValue(5, -1, pspec, false)).toBe(2);
    expect(stepValue(50, 1, pspec, false)).toBe(50);
    expect(stepValue(1, -1, pspec, false)).toBe(1);
    expect(stepValue(5, 1, pspec, true)).toBe(20);
    expect(applySteps(1, 3, pspec, false)).toBe(10);
  });
  it("snaps typed input to nearest preset, tie up", () => {
    expect(parseStepperInput("7", pspec)).toBe(5);
    expect(parseStepperInput("8", pspec)).toBe(10);
    expect(parseStepperInput("1.5", pspec)).toBe(2);
    expect(snapToPreset(3.5, ps)).toBe(5);
  });
});
