import { describe, expect, it } from "vitest";
import { RAIL_TOOL_IDS, RAIL_TOOLS } from "./rail-tools.ts";
import { TOOL_KEYS } from "./tool-dispatch.ts";

describe("terrain RAIL_TOOLS", () => {
  it("is ordered by job", () => {
    expect(RAIL_TOOLS.map((t) => t.id)).toEqual([
      "raise",
      "lower",
      "smooth",
      "flatten",
      "gridSelect",
      "block",
      "smoothBox",
      "paint",
      "road",
      "erase",
      "lock",
      "stamp",
    ]);
    expect(RAIL_TOOLS.map((t) => t.group)).toEqual([
      "sculpt",
      "sculpt",
      "sculpt",
      "sculpt",
      "select",
      "select",
      "select",
      "surface",
      "roads",
      "roads",
      "roads",
      "roads",
    ]);
  });

  it("keeps each group contiguous", () => {
    let runs = 0;
    RAIL_TOOLS.forEach((t, i) => {
      if (i === 0 || RAIL_TOOLS[i - 1].group !== t.group) runs++;
    });
    expect(runs).toBe(new Set(RAIL_TOOLS.map((t) => t.group)).size);
  });

  it("pins only raise and lower with arrow glyphs", () => {
    const docked = RAIL_TOOLS.filter((t) => t.dock);
    expect(docked.map((t) => [t.id, t.dock, t.icon])).toEqual([
      ["raise", "top", "▲"],
      ["lower", "top", "▼"],
    ]);
  });

  it("keeps hotkeys mapped to the same tool", () => {
    for (const t of RAIL_TOOLS) expect(TOOL_KEYS[`Key${t.keyLabel}`]).toBe(t.id);
    expect(new Set(RAIL_TOOLS.map((t) => t.id))).toEqual(new Set(Object.values(TOOL_KEYS)));
  });

  it("has short labels and short tips", () => {
    for (const t of RAIL_TOOLS) {
      const word = t.shortLabel ?? t.label;
      expect(word.length).toBeLessThanOrEqual(12);
      expect(`${t.tip} (${t.keyLabel})`.length).toBeLessThanOrEqual(60);
      expect(t.tip.endsWith(".")).toBe(false);
      expect(t.tip.startsWith(`${word}:`)).toBe(true);
      expect(t.tipLong?.length ?? 0).toBeGreaterThan(0);
    }
  });

  it("exposes the id set", () => {
    expect(RAIL_TOOL_IDS.size).toBe(12);
  });
});
