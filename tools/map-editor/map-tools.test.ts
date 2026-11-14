import { describe, expect, it } from "vitest";
import { MAP_GRID_TOGGLE, MAP_TOOLS, TOOL_KEYS } from "./map-tools.ts";

describe("MAP_TOOLS", () => {
  it("is ordered Select, Move, Draw, Building, Eraser", () => {
    expect(MAP_TOOLS.map((t) => t.id)).toEqual(["select", "move", "road", "building", "eraser"]);
  });

  it("keeps hotkeys mapped to the same tool", () => {
    expect(Object.keys(TOOL_KEYS).sort()).toEqual(["KeyB", "KeyE", "KeyM", "KeyR", "KeyV"]);
    for (const t of MAP_TOOLS) {
      expect(TOOL_KEYS[t.code]).toBe(t.id);
      expect(t.code).toBe(`Key${t.keyLabel}`);
    }
  });

  it("puts the grid toggle on X and avoids reserved codes", () => {
    expect(MAP_GRID_TOGGLE.code).toBe("KeyX");
    const codes = [...MAP_TOOLS.map((t) => t.code), MAP_GRID_TOGGLE.code];
    for (const reserved of ["KeyT", "KeyD", "KeyZ", "KeyY", "Escape", "KeyF"]) {
      expect(codes).not.toContain(reserved);
    }
    expect(new Set(codes).size).toBe(codes.length);
    expect(MAP_GRID_TOGGLE.tipLong?.endsWith(".")).toBe(true);
  });

  it("has short labels and short tips", () => {
    for (const t of [...MAP_TOOLS, MAP_GRID_TOGGLE]) {
      expect((t.shortLabel ?? t.label).length).toBeLessThanOrEqual(12);
      expect(`${t.tip} (${t.keyLabel})`.length).toBeLessThanOrEqual(60);
      expect(t.tip.endsWith(".")).toBe(false);
      if (t.tipLong) {
        expect(t.tipLong.startsWith(t.tip)).toBe(false);
        expect(t.tipLong.endsWith(".")).toBe(true);
      }
    }
  });
});
