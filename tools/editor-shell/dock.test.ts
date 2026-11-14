import { describe, expect, it } from "vitest";
import { splitDockTools } from "./dock.ts";

const tool = (id: string, dock?: "top") => ({ id, dock });

describe("splitDockTools", () => {
  it("puts dock:top tools in top and the rest in bottom, keeping order", () => {
    const { top, bottom } = splitDockTools([
      tool("raise", "top"),
      tool("smooth"),
      tool("lower", "top"),
      tool("paint"),
    ]);
    expect(top.map((t) => t.id)).toEqual(["raise", "lower"]);
    expect(bottom.map((t) => t.id)).toEqual(["smooth", "paint"]);
  });

  it("handles no top tools", () => {
    const { top, bottom } = splitDockTools([tool("a"), tool("b")]);
    expect(top).toEqual([]);
    expect(bottom).toHaveLength(2);
  });
});
