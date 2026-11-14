import { describe, expect, it } from "vitest";
import { dropdownNext } from "./dropdown.ts";

describe("dropdownNext", () => {
  it("toggles on trigger", () => {
    expect(dropdownNext(null, { type: "trigger", id: "road" })).toBe("road");
    expect(dropdownNext("road", { type: "trigger", id: "road" })).toBeNull();
    expect(dropdownNext("road", { type: "trigger", id: "terrain" })).toBe("terrain");
  });
  it("opens explicitly", () => {
    expect(dropdownNext(null, { type: "open", id: "x" })).toBe("x");
  });
  it("closes on pick, escape, outside, close", () => {
    for (const type of ["pick", "escape", "outside", "close"] as const) {
      expect(dropdownNext("road", { type })).toBeNull();
      expect(dropdownNext(null, { type })).toBeNull();
    }
  });
});
