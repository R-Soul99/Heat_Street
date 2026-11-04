import { describe, expect, it } from "vitest";
import {
  KNOWN_MAP_IDS,
  MAP_FORMATS,
  MAP_LABELS,
  parseDriveAt,
  resolveMapId,
  searchForMap,
} from "../src/core/map-select";

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
    expect([...KNOWN_MAP_IDS]).toEqual([
      "juliette-ga",
      "grid-test",
      "feel-test",
      "newton-poppleford",
      "skidders-and-popp",
      "my-map",
      "demo-hills",
      "playground",
    ]);
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

describe("demo-hills and formats", () => {
  it("resolves demo-hills with a label", () => {
    expect(resolveMapId("?map=demo-hills")).toBe("demo-hills");
    expect(MAP_LABELS["demo-hills"]).toBe("Demo hills (sculpted)");
  });
  it("formats: migrated maps are terrain, the rest stay legacy (D-08)", () => {
    const terrain = ["demo-hills", "feel-test", "grid-test", "juliette-ga", "playground"];
    for (const id of KNOWN_MAP_IDS) {
      expect(MAP_FORMATS[id]).toBe(terrain.includes(id) ? "terrain" : "legacy");
    }
    expect(MAP_FORMATS["my-map"]).toBe("legacy");
    expect(MAP_FORMATS["newton-poppleford"]).toBe("legacy");
    expect(MAP_FORMATS["skidders-and-popp"]).toBe("legacy");
  });
});

describe("parseDriveAt", () => {
  const b = { minX: -100, minZ: -100, maxX: 100, maxZ: 100 };
  it("parses two finite decimals", () => {
    expect(parseDriveAt("?at=12.5,-40", b)).toEqual({ x: 12.5, z: -40 });
  });
  it("rejects malformed values", () => {
    for (const s of [
      "",
      "?at=",
      "?at=1,2,3",
      "?at=a,b",
      "?at=NaN,1",
      "?at=Infinity,0",
      "?at=1e999,0",
      "?at=1",
      "?at=,",
    ]) {
      expect(parseDriveAt(s, b)).toBeUndefined();
    }
  });
  it("rejects out of bounds and overlong", () => {
    expect(parseDriveAt("?at=101,0", b)).toBeUndefined();
    expect(parseDriveAt("?at=0,-100.5", b)).toBeUndefined();
    expect(parseDriveAt(`?at=0.${"0".repeat(40)},0`, b)).toBeUndefined();
  });
});
