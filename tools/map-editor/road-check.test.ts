import { describe, expect, it } from "vitest";
import { addRoad, makeProjector, type RawEnvelope } from "./model.ts";
import { checkRoads, fixFoldedRoads } from "./road-check.ts";

const bbox = { south: 50, west: -3, north: 50.01, east: -2.98 };
const proj = makeProjector(bbox);
const env = (): RawEnvelope =>
  ({
    fetchedAt: "2026-11-11T00:00:00.000Z",
    endpoint: "authored://heat-street/test",
    bbox,
    query: "test",
    response: { elements: [] },
  }) as RawEnvelope;
const free = (x: number, y: number) => ({ kind: "free" as const, at: proj.toLatLon({ x, y }) });
const TAGS = { highway: "residential", width: "8", surface: "asphalt" };

/** An 8 m road with a ~1 m hook at a right-angle corner: the ribbon folds there. */
function hooked(): RawEnvelope {
  const roads = env();
  addRoad(
    roads,
    proj,
    [free(100, 500), free(300, 500), free(301, 500.6), free(301.4, 501.5), free(301.5, 700)],
    TAGS,
  );
  return roads;
}

describe("checkRoads", () => {
  it("reports nothing for an empty map or a clean road", () => {
    expect(checkRoads("t", env()).problems).toEqual([]);
    const roads = env();
    addRoad(roads, proj, [free(100, 500), free(300, 500), free(300, 700)], TAGS);
    expect(checkRoads("t", roads).problems).toEqual([]);
  });

  it("a hooked road no longer reports a fold (the ribbon builder pinches it)", () => {
    expect(checkRoads("t", hooked()).problems).toEqual([]);
  });
});

describe("fixFoldedRoads", () => {
  it("removes no points from a hooked road", () => {
    const roads = hooked();
    const way = roads.response.elements[0];
    const before = JSON.stringify(roads);
    const r = fixFoldedRoads("t", roads);
    expect(r.removedPoints).toBe(0);
    expect(r.remaining).toEqual([]);
    expect(JSON.stringify(roads)).toBe(before);
    expect(way.nodes?.length).toBe(way.geometry.length);
  });

  it("changes nothing on a clean map", () => {
    const roads = env();
    addRoad(roads, proj, [free(100, 500), free(300, 500), free(300, 700)], TAGS);
    const before = JSON.stringify(roads);
    expect(fixFoldedRoads("t", roads).removedPoints).toBe(0);
    expect(JSON.stringify(roads)).toBe(before);
  });
});
