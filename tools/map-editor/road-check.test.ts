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

  it("explains a folded road in plain English and marks it fixable", () => {
    const { problems } = checkRoads("t", hooked());
    expect(problems.length).toBeGreaterThan(0);
    expect(problems[0].category).toBe("GEOMETRY_SELF_INTERSECTION");
    expect(problems[0].fixable).toBe(true);
    expect(problems[0].text).toMatch(/bends back on itself/);
    expect(problems[0].wayId).toBeDefined();
  });
});

describe("fixFoldedRoads", () => {
  it("removes kink points until the road compiles, keeping both ends", () => {
    const roads = hooked();
    const way = roads.response.elements[0];
    const [first, last] = [way.nodes?.[0], way.nodes?.at(-1)];
    const r = fixFoldedRoads("t", roads);
    expect(r.removedPoints).toBeGreaterThan(0);
    expect(r.changedWays).toEqual([way.id]);
    expect(r.remaining).toEqual([]);
    expect(way.nodes?.[0]).toBe(first);
    expect(way.nodes?.at(-1)).toBe(last);
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
