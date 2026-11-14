import { describe, expect, it } from "vitest";
import { MAP_TOOLS, TOOL_KEYS } from "./map-tools.ts";

describe("MAP_TOOLS", () => {
  it("is ordered and grouped Select | Draw | Remove", () => {
    expect(MAP_TOOLS.map((t) => t.id)).toEqual(["select", "move", "road", "building", "eraser"]);
    expect(MAP_TOOLS.map((t) => t.group)).toEqual(["select", "select", "draw", "draw", "remove"]);
  });

  it("keeps hotkeys mapped to the same tool", () => {
    expect(Object.keys(TOOL_KEYS).sort()).toEqual(["KeyB", "KeyE", "KeyM", "KeyR", "KeyV"]);
    for (const t of MAP_TOOLS) expect(TOOL_KEYS[`Key${t.keyLabel}`]).toBe(t.id);
  });

  it("has short labels and short tips", () => {
    for (const t of MAP_TOOLS) {
      expect((t.shortLabel ?? t.label).length).toBeLessThanOrEqual(12);
      expect(`${t.tip} (${t.keyLabel})`.length).toBeLessThanOrEqual(60);
      expect(t.tip.endsWith(".")).toBe(false);
      expect(t.tipLong?.length ?? 0).toBeGreaterThan(0);
    }
  });

  it("has no docked tools", () => {
    expect(MAP_TOOLS.some((t) => t.dock)).toBe(false);
  });
});
