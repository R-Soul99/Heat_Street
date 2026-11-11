import { describe, expect, it } from "vitest";
import type { AreaConfig } from "../map-compiler/areas/juliette-ga.config.ts";
import { buildGraph } from "../map-compiler/graph/build-graph.ts";
import { addBuildingRect } from "./model.ts";
import {
  applyBoxAction,
  buildingsInBox,
  isRoadDisabled,
  normaliseBox,
  segmentIntersectsRect,
  setRoadDisabled,
  waysInBox,
} from "./selection.ts";
import { blankWorld, type LatLon, type RawWay, worldFromBbox } from "./world.ts";

const box = { minX: 0, minY: 0, maxX: 10, maxY: 10 };

describe("segmentIntersectsRect", () => {
  it("handles inside, crossing, touching, outside and degenerate", () => {
    expect(segmentIntersectsRect({ x: 2, y: 2 }, { x: 8, y: 8 }, box)).toBe(true);
    expect(segmentIntersectsRect({ x: -5, y: 5 }, { x: 15, y: 5 }, box)).toBe(true);
    expect(segmentIntersectsRect({ x: -5, y: 0 }, { x: 15, y: 0 }, box)).toBe(true);
    expect(segmentIntersectsRect({ x: -5, y: 20 }, { x: 15, y: 20 }, box)).toBe(false);
    expect(segmentIntersectsRect({ x: -5, y: -5 }, { x: -1, y: 20 }, box)).toBe(false);
    expect(segmentIntersectsRect({ x: 5, y: 5 }, { x: 5, y: 5 }, box)).toBe(true);
  });
});

function setup() {
  const { roads, buildings } = blankWorld("sel", 1, 1, "2026-01-01T00:00:00.000Z");
  const proj = worldFromBbox(roads.bbox).projector;
  const ll = (x: number, y: number): LatLon => proj.toLatLon({ x, y });
  const road = (
    id: number,
    pts: [number, number][],
    tags: Record<string, string> = {},
  ): RawWay => ({
    type: "way",
    id,
    nodes: pts.map((_, i) => id * 100 + i),
    geometry: pts.map(([x, y]) => ll(x, y)),
    tags: { highway: "residential", ...tags },
  });
  return { roads, buildings, proj, ll, road };
}

describe("box queries", () => {
  it("normalises corners and selects crossing roads only", () => {
    expect(normaliseBox({ x: 10, y: 10 }, { x: 0, y: 0 })).toEqual(box);
    const s = setup();
    const a = s.road(1, [
      [-20, 5],
      [30, 5],
    ]);
    const b = s.road(2, [
      [-20, 50],
      [30, 50],
    ]);
    s.roads.response.elements.push(a, b);
    expect(waysInBox(s.roads.response.elements, s.proj, box)).toEqual([a]);
  });
  it("selects buildings by centroid", () => {
    const s = setup();
    const inside = addBuildingRect(s.buildings, s.ll(2, 2), s.ll(6, 6), 5);
    addBuildingRect(s.buildings, s.ll(40, 40), s.ll(46, 46), 5);
    expect(buildingsInBox(s.buildings.response.elements, s.proj, box)).toEqual([inside]);
  });
});

describe("disable", () => {
  it("renames highway reversibly", () => {
    const w: RawWay = { type: "way", id: 1, geometry: [], tags: { highway: "primary" } };
    setRoadDisabled(w, true);
    expect(w.tags?.highway).toBeUndefined();
    expect(w.tags?.["disused:highway"]).toBe("primary");
    expect(isRoadDisabled(w)).toBe(true);
    setRoadDisabled(w, true);
    expect(w.tags?.["disused:highway"]).toBe("primary");
    setRoadDisabled(w, false);
    expect(w.tags?.highway).toBe("primary");
    expect(isRoadDisabled(w)).toBe(false);
    const bare: RawWay = { type: "way", id: 2, geometry: [] };
    setRoadDisabled(bare, true);
    expect(bare.tags?.["disused:highway"]).toBe("unclassified");
  });
});

describe("applyBoxAction", () => {
  it("deletes ticked types, disable/enable only roads", () => {
    const s = setup();
    s.roads.response.elements.push(
      s.road(1, [
        [-20, 5],
        [30, 5],
      ]),
    );
    addBuildingRect(s.buildings, s.ll(2, 2), s.ll(6, 6), 5);
    const base = { roads: s.roads, buildings: s.buildings, proj: s.proj, box };
    const both = { roads: true, buildings: true };
    expect(applyBoxAction({ ...base, types: both, action: "disable" })).toEqual({
      roads: 1,
      buildings: 0,
    });
    expect(s.buildings.response.elements).toHaveLength(1);
    expect(applyBoxAction({ ...base, types: both, action: "enable" })).toEqual({
      roads: 1,
      buildings: 0,
    });
    expect(
      applyBoxAction({ ...base, types: { roads: false, buildings: true }, action: "delete" }),
    ).toEqual({ roads: 0, buildings: 1 });
    expect(s.roads.response.elements).toHaveLength(1);
    expect(applyBoxAction({ ...base, types: both, action: "delete" })).toEqual({
      roads: 1,
      buildings: 0,
    });
  });
});

describe("compiler skips disabled roads", () => {
  it("drops the disabled road's edges", () => {
    const edgeCount = (mode: "both" | "disabled" | "single"): number => {
      const s = setup();
      const a = s.road(1, [
        [100, 100],
        [400, 100],
      ]);
      // Connected to road a (shared end node) so the compiler's largest-component prune keeps both.
      const b = s.road(2, [
        [400, 100],
        [400, 300],
      ]);
      b.nodes = [101, 201];
      if (mode === "disabled") setRoadDisabled(b, true);
      s.roads.response.elements.push(a);
      if (mode !== "single") s.roads.response.elements.push(b);
      const config: AreaConfig = {
        areaId: "sel",
        name: "sel",
        bbox: s.roads.bbox,
        demSource: "none-flat-authored",
        osmSnapshot: "2026-01-01T00:00:00.000Z",
        osmExtract: "authored://heat-street/sel",
        excludeHighwayClasses: [],
        surfaceFallbackAcknowledged: true,
      };
      return buildGraph(s.roads, config).graph.edges.length;
    };
    const single = edgeCount("single");
    expect(single).toBeGreaterThan(0);
    expect(edgeCount("both")).toBeGreaterThan(single);
    expect(edgeCount("disabled")).toBe(single);
  });
});
