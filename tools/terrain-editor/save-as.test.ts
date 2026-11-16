import { describe, expect, it } from "vitest";
import { createEmptyTerrainArea } from "./new-area.ts";
import {
  AREA_NAME_RULE_TEXT,
  renameAreaForSave,
  suggestCopyName,
  validateAreaName,
} from "./save-as.ts";

describe("validateAreaName", () => {
  it("accepts a free valid name", () => {
    expect(validateAreaName("my-map-2", ["a", "b"])).toBeUndefined();
  });
  it("rejects bad characters, empty and over-long names with the New area rule text", () => {
    expect(validateAreaName("Bad Name", [])).toBe(AREA_NAME_RULE_TEXT);
    expect(validateAreaName("", [])).toBe(AREA_NAME_RULE_TEXT);
    expect(validateAreaName("a".repeat(65), [])).toBe(AREA_NAME_RULE_TEXT);
  });
  it("refuses an existing name so nothing is overwritten", () => {
    expect(validateAreaName("demo-hills", ["demo-hills"])).toContain("already exists");
  });
});

describe("suggestCopyName", () => {
  it("adds -copy, then numbers it", () => {
    expect(suggestCopyName("demo", [])).toBe("demo-copy");
    expect(suggestCopyName("demo", ["demo-copy"])).toBe("demo-copy-2");
    expect(suggestCopyName("demo", ["demo-copy", "demo-copy-2"])).toBe("demo-copy-3");
  });
  it("stays a valid name when the source id is long", () => {
    const long = "a".repeat(64);
    const s = suggestCopyName(long, [long.slice(0, 59) + "-copy"]);
    expect(s.length).toBeLessThanOrEqual(64);
    expect(validateAreaName(s, [])).toBeUndefined();
  });
});

describe("renameAreaForSave", () => {
  it("renames the area and its graph without touching the original", () => {
    const area = createEmptyTerrainArea({ areaId: "src", widthM: 60, depthM: 60, cellSizeM: 3 });
    const copy = renameAreaForSave(area, "dst");
    expect(copy.areaId).toBe("dst");
    expect(copy.name).toBe("dst");
    expect(copy.graph.areaId).toBe("dst");
    expect(copy.graph.name).toBe("dst");
    expect(copy.grid).toBe(area.grid);
    expect(area.areaId).toBe("src");
    expect(area.graph.areaId).toBe("src");
  });
});
