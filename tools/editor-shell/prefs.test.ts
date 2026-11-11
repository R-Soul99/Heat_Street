import { afterEach, describe, expect, it } from "vitest";
import { getBoolPref, getPref, setBoolPref, setPref, setPrefStorage } from "./prefs";

const throwing = {
  getItem(): string | null {
    throw new Error("denied");
  },
  setItem(): void {
    throw new Error("denied");
  },
};

afterEach(() => setPrefStorage(undefined));

describe("prefs", () => {
  it("returns default when storage throws", () => {
    setPrefStorage(throwing);
    expect(getPref("a", "def")).toBe("def");
  });
  it("memory fallback round-trips when storage throws", () => {
    setPrefStorage(throwing);
    setPref("b", "x");
    expect(getPref("b", "def")).toBe("x");
  });
  it("persists to storage with namespaced key", () => {
    const m = new Map<string, string>();
    setPrefStorage({ getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v) });
    setPref("c", "y");
    expect(m.get("heat-street.editor.c")).toBe("y");
    expect(getPref("c", "")).toBe("y");
  });
  it("bool prefs parse 0/1", () => {
    const m = new Map<string, string>();
    setPrefStorage({ getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v) });
    expect(getBoolPref("tooltips", true)).toBe(true);
    setBoolPref("tooltips", false);
    expect(m.get("heat-street.editor.tooltips")).toBe("0");
    expect(getBoolPref("tooltips", true)).toBe(false);
    setBoolPref("tooltips", true);
    expect(getBoolPref("tooltips", false)).toBe(true);
  });
});
