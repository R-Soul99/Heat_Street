import { describe, expect, it } from "vitest";
import { displayLabel, groupTools } from "./tool-groups.ts";

describe("groupTools", () => {
  it("makes consecutive runs without reordering", () => {
    const a = { id: "a", group: "sculpt" };
    const b = { id: "b", group: "sculpt" };
    const c = { id: "c", group: "select" };
    const d = { id: "d", group: "sculpt" };
    const runs = groupTools([a, b, c, d]);
    expect(runs).toEqual([
      { group: "sculpt", tools: [a, b] },
      { group: "select", tools: [c] },
      { group: "sculpt", tools: [d] },
    ]);
  });
  it("handles empty", () => {
    expect(groupTools([])).toEqual([]);
  });
  it("treats undefined group as one run", () => {
    const runs = groupTools([{ group: undefined }, { group: undefined }]);
    expect(runs.length).toBe(1);
    expect(runs[0]?.group).toBeUndefined();
  });
});

describe("displayLabel", () => {
  it("prefers shortLabel", () => {
    expect(displayLabel({ label: "Surface paint", shortLabel: "Paint" })).toBe("Paint");
    expect(displayLabel({ label: "Smooth" })).toBe("Smooth");
  });
});
