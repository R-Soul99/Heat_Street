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
      if (t.tipLong) {
        // Long tier adds how-to text only; it must not repeat the short tip (IN-01).
        expect(t.tipLong.startsWith(t.tip)).toBe(false);
        expect(t.tipLong.endsWith(".")).toBe(true);
      }
    }
  });

  it("has no docked tools", () => {
    expect(MAP_TOOLS.some((t) => t.dock)).toBe(false);
  });
});
