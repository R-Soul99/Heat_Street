import { describe, expect, it } from "vitest";
import type { Stage, StageData } from "../src/core/stage";
import { parseStageRequest, selectStage } from "../src/core/stage-mode";

const mk = (id: string): Stage => ({
  id,
  name: id,
  start: { x: 0, z: 0, headingRad: 0 },
  gates: [],
  finish: { x: 0, z: 0, headingRad: 0, widthM: 20 },
});
const data = (areaId: string, ids: string[]): StageData => ({
  schemaVersion: 1,
  areaId,
  stages: ids.map(mk),
});
const ctx = { isTerrain: true, areaId: "a" };

describe("parseStageRequest", () => {
  it("returns null unless mode=stage", () => {
    expect(parseStageRequest("?map=x")).toBeNull();
    expect(parseStageRequest("?mode=p2p")).toBeNull();
  });
  it("parses stage ids", () => {
    expect(parseStageRequest("?mode=stage")).toEqual({ stageId: null, badStageId: false });
    expect(parseStageRequest("?mode=stage&stage=dust-run")).toEqual({
      stageId: "dust-run",
      badStageId: false,
    });
    expect(parseStageRequest("?mode=stage&stage=Bad%20Id")).toEqual({
      stageId: null,
      badStageId: true,
    });
  });
});

describe("selectStage", () => {
  const req = { stageId: null, badStageId: false };
  it("falls back on legacy maps", () => {
    const r = selectStage(data("a", ["s"]), req, { isTerrain: false, areaId: "a" });
    expect(r.kind).toBe("free-drive");
    expect(r.warning).toContain("terrain map");
  });
  it("falls back with no file", () => {
    const r = selectStage(undefined, req, ctx);
    expect(r.kind).toBe("free-drive");
    expect(r.warning).toContain("no stages file");
  });
  it("falls back on area mismatch", () => {
    const r = selectStage(data("b", ["s"]), req, ctx);
    expect(r.kind).toBe("free-drive");
    expect(r.warning).toContain("area");
  });
  it("falls back on empty list", () => {
    const r = selectStage(data("a", []), req, ctx);
    expect(r.kind).toBe("free-drive");
    expect(r.warning).toContain("no stages");
  });
  it("selects by id, first otherwise", () => {
    const d = data("a", ["one", "two"]);
    const hit = selectStage(d, { stageId: "two", badStageId: false }, ctx);
    expect(hit).toMatchObject({ kind: "stage", stage: { id: "two" } });
    expect(hit.warning).toBeUndefined();
    const miss = selectStage(d, { stageId: "zzz", badStageId: false }, ctx);
    expect(miss).toMatchObject({ kind: "stage", stage: { id: "one" } });
    expect(miss.warning).toContain("zzz");
    const bad = selectStage(d, { stageId: null, badStageId: true }, ctx);
    expect(bad).toMatchObject({ kind: "stage", stage: { id: "one" } });
    expect(bad.warning).toBeDefined();
  });
});
