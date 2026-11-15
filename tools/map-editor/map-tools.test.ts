import { describe, expect, it } from "vitest";
import { barToolIds, validateBarSpec } from "../editor-shell/top-bar.ts";
import { MAP_BAR, MAP_GRID_TOGGLE, MAP_TOOLS, TOOL_KEYS } from "./map-tools.ts";

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
    expect(MAP_GRID_TOGGLE.tipLong).toContain("sidebar View section");
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

describe("MAP_BAR", () => {
  const ids = (g: string) =>
    (MAP_BAR.find((x) => x.id === g)?.items ?? []).map((i) =>
      i.kind === "tool" ? i.tool.id : i.kind === "slot" ? i.id : i.kind,
    );

  it("is a valid bar spec", () => {
    expect(validateBarSpec(MAP_BAR)).toEqual([]);
  });

  it("orders the groups", () => {
    expect(MAP_BAR.map((g) => g.id)).toEqual(["selection", "tools", "view", "history", "terrain"]);
  });

  it("puts Clear selection and Clear all beside Select", () => {
    expect(ids("selection")).toEqual(["select", "clearSelection", "clearAll"]);
  });

  it("lists the tools, a plain grid toggle, history and the terrain slot", () => {
    expect(ids("tools")).toEqual(["move", "road", "building", "eraser"]);
    expect(ids("view")).toEqual(["grid"]);
    expect(ids("history")).toEqual(["undo", "redo"]);
    expect(ids("terrain")).toEqual(["toTerrain"]);
  });

  it("covers every tool and the grid", () => {
    const all = barToolIds(MAP_BAR);
    for (const t of MAP_TOOLS) expect(all).toContain(t.id);
    expect(all).toContain("grid");
  });
});
