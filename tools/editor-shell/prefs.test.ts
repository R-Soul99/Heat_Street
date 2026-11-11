import { describe, expect, it } from "vitest";
import { createPrefs } from "./prefs";

function fakeStore() {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => {
      m.set(k, v);
    },
  };
}

describe("prefs", () => {
  it("round-trips strings", () => {
    const p = createPrefs(fakeStore());
    p.set("a", "1");
    expect(p.get("a", "0")).toBe("1");
    expect(p.get("missing", "dflt")).toBe("dflt");
  });
  it("getBool defaults when missing and accepts only 1/0", () => {
    const s = fakeStore();
    const p = createPrefs(s);
    expect(p.getBool("b", true)).toBe(true);
    p.setBool("b", false);
    expect(p.getBool("b", true)).toBe(false);
    s.setItem("c", "garbage");
    expect(createPrefs(s).getBool("c", true)).toBe(true);
  });
  it("falls back to memory when the store throws", () => {
    const p = createPrefs({
      getItem: () => {
        throw new Error("no");
      },
      setItem: () => {
        throw new Error("no");
      },
    });
    p.set("x", "y");
    expect(p.get("x", "")).toBe("y");
    p.setBool("z", true);
    expect(p.getBool("z", false)).toBe(true);
  });
  it("works with a null store", () => {
    const p = createPrefs(null);
    p.set("k", "v");
    expect(p.get("k", "")).toBe("v");
  });
});
