import { describe, expect, it } from "vitest";
import { displayLabel, type ShellTool } from "./tool-rail.ts";
import {
  type BarGroup,
  barToolIds,
  menuFace,
  RESERVED_SLOTS,
  validateBarSpec,
  withHistoryGroup,
} from "./top-bar.ts";

const tool = (id: string, tip = "A tip"): ShellTool => ({ id, label: id, icon: `i-${id}`, tip });
const group = (id: string, items: BarGroup["items"]): BarGroup => ({ id, label: id, items });

describe("validateBarSpec", () => {
  it("accepts a full valid spec", () => {
    const g: BarGroup[] = [
      group("a", [
        { kind: "tool", tool: tool("t1") },
        { kind: "stack", tools: [tool("s1"), tool("s2")] },
        { kind: "divider" },
        { kind: "slot", id: "s" },
        {
          kind: "menu",
          tool: tool("m"),
          items: [
            { kind: "tool", tool: tool("c1") },
            { kind: "divider" },
            { kind: "slot", id: "ms" },
          ],
        },
      ]),
    ];
    expect(validateBarSpec(g)).toEqual([]);
  });
  it("flags duplicate group id and empty group", () => {
    const g = [group("a", [{ kind: "tool", tool: tool("x") }]), group("a", [])];
    const e = validateBarSpec(g).join(" ");
    expect(e).toContain("duplicate group");
    expect(e).toContain("empty");
  });
  it("flags duplicate tool ids including menu children and triggers", () => {
    const g = [
      group("a", [
        { kind: "tool", tool: tool("dup") },
        { kind: "menu", tool: tool("m"), items: [{ kind: "tool", tool: tool("dup") }] },
      ]),
      group("b", [{ kind: "menu", tool: tool("c"), items: [{ kind: "tool", tool: tool("c") }] }]),
    ];
    const e = validateBarSpec(g);
    expect(e.filter((x) => x.includes("duplicate tool")).length).toBe(2);
  });
  it("flags empty tips in stack and menu children", () => {
    const g = [
      group("a", [
        { kind: "stack", tools: [tool("a1", " "), tool("a2")] },
        { kind: "menu", tool: tool("m"), items: [{ kind: "tool", tool: tool("c", "") }] },
      ]),
    ];
    expect(validateBarSpec(g).filter((x) => x.includes("empty tip")).length).toBe(2);
  });
  it("flags duplicate slot ids across bar and menu, and empty menus", () => {
    const g = [
      group("a", [
        { kind: "slot", id: "q" },
        { kind: "menu", tool: tool("m"), items: [{ kind: "slot", id: "q" }] },
        { kind: "menu", tool: tool("n"), items: [] },
      ]),
    ];
    const e = validateBarSpec(g).join(" ");
    expect(e).toContain("duplicate slot");
    expect(e).toContain("no items");
  });
});

describe("barToolIds", () => {
  it("lists stack tools, menu triggers and children in order", () => {
    const g = [
      group("a", [
        { kind: "tool", tool: tool("t1") },
        { kind: "stack", tools: [tool("s1"), tool("s2")] },
        { kind: "menu", tool: tool("m"), items: [{ kind: "tool", tool: tool("c1") }] },
      ]),
    ];
    expect(barToolIds(g)).toEqual(["t1", "s1", "s2", "m", "c1"]);
  });
});

describe("withHistoryGroup", () => {
  const base = [group("a", [{ kind: "tool", tool: tool("t") }])];
  it("appends unplaced available reserved slots in RESERVED_SLOTS order", () => {
    const out = withHistoryGroup(base, ["redo", "undo", "clearSelection"]);
    expect(out.length).toBe(2);
    expect(out[1]?.id).toBe("history");
    expect(out[1]?.items).toEqual([
      { kind: "slot", id: "clearSelection" },
      { kind: "slot", id: "undo" },
      { kind: "slot", id: "redo" },
    ]);
    expect(base.length).toBe(1);
  });
  it("returns input unchanged when all are placed", () => {
    const placed = [
      group(
        "h",
        RESERVED_SLOTS.map((id) => ({ kind: "slot" as const, id })),
      ),
    ];
    expect(withHistoryGroup(placed, RESERVED_SLOTS).length).toBe(1);
  });
});

describe("menuFace", () => {
  const trig = tool("road");
  const kids = [tool("roadDraw"), tool("roadErase")];
  it("shows the active child", () => {
    expect(menuFace(trig, kids, "roadErase")).toEqual({
      icon: "i-roadErase",
      word: "roadErase",
      active: true,
    });
  });
  it("falls back to the trigger", () => {
    expect(menuFace(trig, kids, null)).toEqual({ icon: "i-road", word: "road", active: false });
    expect(menuFace(trig, kids, "nope").active).toBe(false);
  });
});

describe("displayLabel", () => {
  it("prefers shortLabel", () => {
    expect(displayLabel({ label: "Surface paint", shortLabel: "Paint" })).toBe("Paint");
    expect(displayLabel({ label: "Smooth" })).toBe("Smooth");
  });
});
