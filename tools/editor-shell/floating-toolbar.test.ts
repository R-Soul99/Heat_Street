import { describe, expect, it } from "vitest";
import { type FloatRow, validateFloatSpec } from "./floating-toolbar.ts";
import { displayLabel, type ShellTool } from "./tool-rail.ts";

const tool = (id: string, tip = "A tip"): ShellTool => ({ id, label: id, icon: "x", tip });

describe("validateFloatSpec", () => {
  it("accepts a valid spec", () => {
    const rows: FloatRow[] = [
      [
        {
          id: "a",
          label: "A",
          direction: "row",
          items: [
            { kind: "tool", tool: tool("t1") },
            { kind: "divider" },
            { kind: "slot", id: "s" },
          ],
        },
      ],
      [
        {
          id: "b",
          label: "B",
          direction: "column",
          items: [{ kind: "tool", tool: tool("t2"), size: "big" }],
        },
      ],
    ];
    expect(validateFloatSpec(rows)).toEqual([]);
  });
  it("flags a duplicate tool id", () => {
    const rows: FloatRow[] = [
      [
        { id: "a", label: "A", direction: "row", items: [{ kind: "tool", tool: tool("dup") }] },
        { id: "b", label: "B", direction: "row", items: [{ kind: "tool", tool: tool("dup") }] },
      ],
    ];
    expect(validateFloatSpec(rows).join(" ")).toContain("dup");
  });
  it("flags duplicate chip, empty chip, empty tip, duplicate slot", () => {
    const item = (id: string): FloatRow[0] => ({
      id: "c",
      label: "C",
      direction: "row",
      items: [{ kind: "tool", tool: tool(id) }],
    });
    expect(validateFloatSpec([[item("x"), item("y")]]).length).toBe(1);
    expect(validateFloatSpec([[{ id: "e", label: "E", direction: "row", items: [] }]]).length).toBe(
      1,
    );
    expect(
      validateFloatSpec([
        [
          {
            id: "t",
            label: "T",
            direction: "row",
            items: [{ kind: "tool", tool: tool("z", " ") }],
          },
        ],
      ]).length,
    ).toBe(1);
    expect(
      validateFloatSpec([
        [
          {
            id: "s",
            label: "S",
            direction: "row",
            items: [
              { kind: "slot", id: "q" },
              { kind: "slot", id: "q" },
            ],
          },
        ],
      ]).length,
    ).toBe(1);
  });
});

describe("displayLabel", () => {
  it("prefers shortLabel", () => {
    expect(displayLabel({ label: "Surface paint", shortLabel: "Paint" })).toBe("Paint");
    expect(displayLabel({ label: "Smooth" })).toBe("Smooth");
  });
});
