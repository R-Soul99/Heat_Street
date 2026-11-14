import { describe, expect, it } from "vitest";
import { tipPhase, tipSchedule } from "./tip-phase.ts";

describe("tipSchedule", () => {
  it("short only", () => {
    expect(tipSchedule(false)).toEqual({ showAt: 700, longAt: undefined, fadeAt: 3700 });
  });
  it("with long text", () => {
    expect(tipSchedule(true)).toEqual({ showAt: 700, longAt: 2200, fadeAt: 5200 });
  });
});

describe("tipPhase", () => {
  it("short-only phases", () => {
    expect(tipPhase(0, false)).toBe("hidden");
    expect(tipPhase(699, false)).toBe("hidden");
    expect(tipPhase(700, false)).toBe("short");
    expect(tipPhase(3699, false)).toBe("short");
    expect(tipPhase(3700, false)).toBe("faded");
  });
  it("long phases", () => {
    expect(tipPhase(2199, true)).toBe("short");
    expect(tipPhase(2200, true)).toBe("long");
    expect(tipPhase(5199, true)).toBe("long");
    expect(tipPhase(5200, true)).toBe("faded");
  });
});
