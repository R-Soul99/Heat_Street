import { describe, expect, it } from "vitest";
import {
  BRUSH_TOOL_FOR,
  TERRAIN_HOTKEYS,
  TOOLBAR_GLOBAL_CODES,
  TOOLBAR_TOOLS,
} from "./rail-tools.ts";

describe("toolbar data", () => {
  it("maps every code back to its id", () => {
    for (const t of TOOLBAR_TOOLS) expect(TERRAIN_HOTKEYS[t.code]).toBe(t.id);
  });

  it("has unique codes with the expected set", () => {
    const codes = TOOLBAR_TOOLS.map((t) => t.code);
    expect(new Set(codes).size).toBe(codes.length);
    expect(new Set(codes)).toEqual(
      new Set([
        "KeyS",
        "KeyB",
        "KeyH",
        "KeyJ",
        "KeyG",
        "KeyF",
        "KeyP",
        "KeyR",
        "KeyE",
        "KeyL",
        "KeyU",
        "Delete",
        "KeyC",
        "KeyX",
      ]),
    );
  });

  it("has no clash with global codes", () => {
    for (const t of TOOLBAR_TOOLS) {
      expect((TOOLBAR_GLOBAL_CODES as readonly string[]).includes(t.code)).toBe(false);
    }
  });

  it("follows tip rules and distinct glyphs", () => {
    for (const t of TOOLBAR_TOOLS) {
      const word = t.shortLabel ?? t.label;
      expect(word.length).toBeLessThanOrEqual(12);
      expect(`${t.tip} (${t.keyLabel})`.length).toBeLessThanOrEqual(60);
      expect(t.tip.endsWith(".")).toBe(false);
      expect(t.tip.startsWith(`${word}:`)).toBe(true);
      if (t.tipLong) {
        expect(t.tipLong.startsWith(t.tip)).toBe(false);
        expect(t.tipLong.endsWith(".")).toBe(true);
      }
    }
    expect(new Set(TOOLBAR_TOOLS.map((t) => t.icon)).size).toBe(TOOLBAR_TOOLS.length);
  });

  it("maps operations to dispatcher tool names", () => {
    expect(BRUSH_TOOL_FOR).toEqual({
      raise: "raise",
      lower: "lower",
      smooth: "smooth",
      flatten: "flatten",
      terrain: "paint",
      roadPaint: "road",
      roadErase: "erase",
    });
  });
});
