import { describe, expect, it } from "vitest";
import { barToolIds, validateBarSpec } from "../editor-shell/top-bar.ts";
import {
  BRUSH_TOOL_FOR,
  PLACE_KINDS,
  PLACE_MENU,
  PLACE_TOOLS,
  ROAD_MENU,
  TERRAIN_BAR,
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
        "Digit1",
        "Digit2",
        "Digit3",
        "Digit4",
        "Digit5",
        "Digit6",
        "Digit7",
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

  it("TERRAIN_BAR is valid and in D-32 order", () => {
    expect(validateBarSpec(TERRAIN_BAR)).toEqual([]);
    expect(TERRAIN_BAR.map((g) => g.id)).toEqual([
      "selection",
      "brush",
      "raiseLower",
      "smoothFlatten",
      "menus",
      "view",
      "history",
    ]);
    const g = (id: string) => TERRAIN_BAR.find((x) => x.id === id);
    const name = (i: { kind: string; tool?: { id: string }; id?: string }): string =>
      i.kind === "tool" ? (i.tool?.id ?? "") : i.kind === "slot" ? (i.id ?? "") : i.kind;
    expect(g("selection")?.items.map(name)).toEqual(["select", "clearSelection"]);
    expect(g("history")?.items.map(name)).toEqual(["undo", "redo"]);
    const rl = g("raiseLower")?.items ?? [];
    expect(rl).toHaveLength(1);
    expect(rl[0]?.kind === "stack" && rl[0].tools.map((t) => t.id)).toEqual(["raise", "lower"]);
    expect(g("smoothFlatten")?.items.map(name)).toEqual(["smooth", "flatten"]);
    const [terr, road] = g("menus")?.items ?? [];
    expect(terr?.kind === "menu" && terr.tool.id).toBe("terrain");
    expect(terr?.kind === "menu" && terr.items).toEqual([{ kind: "slot", id: "surfaces" }]);
    expect(road?.kind === "menu" && road.tool.id).toBe("road");
    expect(
      road?.kind === "menu" && road.items.flatMap((m) => (m.kind === "tool" ? [m.tool.id] : [])),
    ).toEqual(["roadPaint", "roadErase", "lock", "unlock", "deleteRoad"]);
    expect(g("view")?.items.map(name)).toEqual(["grid", "contours"]);
    expect(g("menus")?.items.map(name)).toEqual(["menu", "menu", "menu"]);
    const place = g("menus")?.items[2];
    expect(place?.kind === "menu" && place.tool.id).toBe("place");
    expect(place?.kind === "menu" && place.items.map(name)).toEqual([
      "placeStart",
      "divider",
      "placeBuilding",
      "placeTree",
      "placeBush",
      "placeHedge",
      "placeFence",
      "placeRamp",
    ]);
  });

  it("PLACE_TOOLS follow the kinds and digit keys 1 to 7", () => {
    expect(PLACE_KINDS).toEqual(["start", "building", "tree", "bush", "hedge", "fence", "ramp"]);
    expect(PLACE_TOOLS.map((t) => t.code)).toEqual([1, 2, 3, 4, 5, 6, 7].map((n) => `Digit${n}`));
    expect(PLACE_TOOLS.map((t) => t.keyLabel)).toEqual(["1", "2", "3", "4", "5", "6", "7"]);
    for (const t of PLACE_TOOLS) expect(TERRAIN_HOTKEYS[t.code]).toBe(t.id);
  });

  it("PLACE_MENU follows tip rules with a distinct glyph", () => {
    expect(PLACE_MENU.tip.startsWith("Place:")).toBe(true);
    expect(PLACE_MENU.tip.endsWith(".")).toBe(false);
    expect((PLACE_MENU as { code?: string }).code).toBeUndefined();
    expect(TOOLBAR_TOOLS.map((t) => t.icon)).not.toContain(PLACE_MENU.icon);
    expect(PLACE_MENU.icon).not.toBe(ROAD_MENU.icon);
  });

  it("every hotkey tool reaches a bar control", () => {
    const ids = barToolIds(TERRAIN_BAR);
    for (const t of TOOLBAR_TOOLS) expect(ids).toContain(t.id);
    expect(ids).toContain("road");
    expect(ids).toContain("place");
  });

  it("ROAD_MENU follows tip rules with a distinct glyph", () => {
    expect(ROAD_MENU.label.length).toBeLessThanOrEqual(12);
    expect(ROAD_MENU.tip.startsWith("Road:")).toBe(true);
    expect(ROAD_MENU.tip.endsWith(".")).toBe(false);
    expect((ROAD_MENU as { code?: string }).code).toBeUndefined();
    expect(TOOLBAR_TOOLS.map((t) => t.icon)).not.toContain(ROAD_MENU.icon);
  });
});
