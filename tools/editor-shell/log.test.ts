import { describe, expect, it } from "vitest";
import { createMessageLog } from "./log";

describe("message log", () => {
  const clock = () => new Date(2026, 0, 1, 9, 5, 7);
  it("stamps, defaults kind, keeps newest last", () => {
    const l = createMessageLog(10, clock);
    l.add("one");
    l.add("two", "error");
    expect(l.lines()).toEqual([
      { at: "09:05:07", kind: "info", text: "one" },
      { at: "09:05:07", kind: "error", text: "two" },
    ]);
  });
  it("drops oldest beyond cap", () => {
    const l = createMessageLog(2, clock);
    l.add("a");
    l.add("b");
    l.add("c");
    expect(l.lines().map((x) => x.text)).toEqual(["b", "c"]);
    l.clear();
    expect(l.lines()).toHaveLength(0);
  });
});
