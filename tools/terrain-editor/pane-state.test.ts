import { describe, expect, it } from "vitest";
import {
  isRotatableKind,
  itemPanelHint,
  itemPanelTitle,
  paneChoice,
  type SelectedItemKind,
  shortestTurnDeg,
  wrapDegrees,
} from "./pane-state.ts";

describe("paneChoice", () => {
  it("shows only the armed Place kind's options", () => {
    const c = paneChoice({ mode: "select", placing: "ramp", selectedItem: "building" });
    expect(c.panel).toBe("place");
    expect(c.showGeneralSelect).toBe(false);
    expect(c.showItemPanel).toBe(false);
    expect(c.key).toBe("place:ramp");
  });

  it("shows only the item panel when a placed item is selected in Select mode", () => {
    const kinds: SelectedItemKind[] = ["building", "ramp", "tree", "bush", "hedge", "fence"];
    for (const k of kinds) {
      const c = paneChoice({ mode: "select", placing: null, selectedItem: k });
      expect(c.panel).toBe("item");
      expect(c.showItemPanel).toBe(true);
      expect(c.showGeneralSelect).toBe(false);
      expect(c.key).toBe(`item:${k}`);
    }
  });

  it("brings the general Select sections back when the selection clears", () => {
    const c = paneChoice({ mode: "select", placing: null, selectedItem: null });
    expect(c.panel).toBe("select");
    expect(c.showGeneralSelect).toBe(true);
    expect(c.showItemPanel).toBe(false);
  });

  it("ignores a stale selection in Brush mode", () => {
    const c = paneChoice({ mode: "brush", placing: null, selectedItem: "ramp" });
    expect(c.panel).toBe("brush");
    expect(c.showItemPanel).toBe(false);
  });

  it("names the selected item in the header and hides View", () => {
    const kinds: SelectedItemKind[] = ["building", "ramp", "tree", "bush", "hedge", "fence"];
    for (const k of kinds) {
      const c = paneChoice({ mode: "select", placing: null, selectedItem: k });
      expect(c.headerTitle).toBe(itemPanelTitle(k));
      expect(c.showView).toBe(false);
    }
    expect(paneChoice({ mode: "select", placing: null, selectedItem: "ramp" }).headerTitle).toBe(
      "Ramp",
    );
  });

  it("keeps the toolbar header and View when nothing is selected, in Brush, or in Place", () => {
    const cases = [
      { mode: "select", placing: null, selectedItem: null },
      { mode: "brush", placing: null, selectedItem: "ramp" },
      { mode: "select", placing: "ramp", selectedItem: "ramp" },
    ] as const;
    for (const input of cases) {
      const c = paneChoice(input);
      expect(c.headerTitle).toBeNull();
      expect(c.showView).toBe(true);
    }
  });

  it("changes key between different item kinds so the pane rebuilds", () => {
    const a = paneChoice({ mode: "select", placing: null, selectedItem: "ramp" });
    const b = paneChoice({ mode: "select", placing: null, selectedItem: "tree" });
    expect(a.key).not.toBe(b.key);
  });

  it("flags rotatable kinds only", () => {
    expect(isRotatableKind("building")).toBe(true);
    expect(isRotatableKind("ramp")).toBe(true);
    expect(isRotatableKind("tree")).toBe(true);
    expect(isRotatableKind("bush")).toBe(true);
    expect(isRotatableKind("hedge")).toBe(false);
    expect(isRotatableKind("fence")).toBe(false);
    expect(isRotatableKind(null)).toBe(false);
  });

  it("titles every kind and gives a hint line", () => {
    expect(itemPanelTitle("ramp")).toBe("Ramp");
    expect(itemPanelTitle("fence")).toBe("Fence");
    expect(itemPanelHint("tree")).toContain("Delete");
  });
});

describe("rotation degree helpers", () => {
  it("wraps to 0..359", () => {
    expect(wrapDegrees(360)).toBe(0);
    expect(wrapDegrees(370)).toBe(10);
    expect(wrapDegrees(-10)).toBe(350);
    expect(wrapDegrees(37.4)).toBe(37);
    expect(wrapDegrees(Number.NaN)).toBe(0);
  });

  it("takes the shortest turn between two angles", () => {
    expect(shortestTurnDeg(350, 10)).toBe(20);
    expect(shortestTurnDeg(10, 350)).toBe(-20);
    expect(shortestTurnDeg(0, 180)).toBe(180);
    expect(shortestTurnDeg(90, 90)).toBe(0);
  });
});
