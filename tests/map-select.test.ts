import { describe, expect, it } from "vitest";
import { KNOWN_MAP_IDS, MAP_LABELS, resolveMapId, searchForMap } from "../src/core/map-select";

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

describe("searchForMap", () => {
  it("sets the map and keeps every other parameter", () => {
    expect(searchForMap("?feel&map=feel-test&debug=1", "grid-test")).toBe(
      "?feel=&map=grid-test&debug=1",
    );
    expect(searchForMap("", "feel-test")).toBe("?map=feel-test");
  });
  it("round-trips through resolveMapId and every map has a label", () => {
    for (const id of KNOWN_MAP_IDS) {
      expect(resolveMapId(searchForMap("?feel", id))).toBe(id);
      expect(MAP_LABELS[id].length).toBeGreaterThan(0);
    }
  });
});
