import { describe, expect, it } from "vitest";
import { KNOWN_MAP_IDS, resolveMapId } from "../src/core/map-select";

describe("resolveMapId", () => {
  it("defaults to juliette-ga", () => {
    expect(resolveMapId("")).toBe("juliette-ga");
    expect(resolveMapId("?map=juliette-ga&mode=circuit")).toBe("juliette-ga");
  });
  it("accepts grid-test", () => {
    expect(resolveMapId("?map=grid-test")).toBe("grid-test");
    expect(resolveMapId("?mode=circuit&map=grid-test")).toBe("grid-test");
  });
  it("falls back for unknown or hostile values", () => {
    for (const s of [
      "?map=../secret",
      "?map=toString",
      "?map=constructor",
      "?map=__proto__",
      "?map=GRID-TEST",
      "?map=",
    ]) {
      expect(resolveMapId(s)).toBe("juliette-ga");
    }
  });
  it("lists exactly the known maps", () => {
    expect([...KNOWN_MAP_IDS]).toEqual(["juliette-ga", "grid-test", "feel-test"]);
  });
});
