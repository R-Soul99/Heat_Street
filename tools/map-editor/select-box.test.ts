import { describe, expect, it } from "vitest";
import { addBuildingRect, addRoad, makeProjector, type RawEnvelope } from "./model.ts";
import {
  buildingsInBox,
  disableRoad,
  enableRoad,
  isDisabledRoad,
  waysInBox,
} from "./select-box.ts";

const bbox = { south: 50, west: -3, north: 50.01, east: -2.98 };
const proj = makeProjector(bbox);
const env = (): RawEnvelope => ({ bbox, response: { elements: [] } }) as unknown as RawEnvelope;
const free = (x: number, y: number) => ({ kind: "free" as const, at: proj.toLatLon({ x, y }) });

describe("waysInBox", () => {
  it("includes crossing roads, excludes outside ones, any corner order", () => {
    const roads = env();
    addRoad(roads, proj, [free(0, 500), free(1000, 500)], { highway: "residential" }); // crosses
    const inside = addRoad(roads, proj, [free(520, 520), free(540, 530)], {
      highway: "residential",
    });
    addRoad(roads, proj, [free(0, 100), free(1000, 100)], { highway: "residential" }); // outside
    const hit = waysInBox(roads, proj, { a: { x: 600, y: 600 }, b: { x: 500, y: 400 } });
    expect(hit).toHaveLength(2);
    expect(hit).toContain(inside);
  });
});

describe("buildingsInBox", () => {
  it("uses the centroid", () => {
    const b = env();
    addBuildingRect(b, proj.toLatLon({ x: 100, y: 100 }), proj.toLatLon({ x: 140, y: 140 }), 8);
    addBuildingRect(b, proj.toLatLon({ x: 900, y: 900 }), proj.toLatLon({ x: 940, y: 940 }), 8);
    expect(buildingsInBox(b, proj, { a: { x: 90, y: 90 }, b: { x: 200, y: 200 } })).toHaveLength(1);
    // box covers a corner only, not the centroid
    expect(buildingsInBox(b, proj, { a: { x: 0, y: 0 }, b: { x: 110, y: 110 } })).toHaveLength(0);
  });
});

describe("disable / enable", () => {
  it("round-trips and drops the highway key", () => {
    const roads = env();
    const w = addRoad(roads, proj, [free(0, 0), free(10, 10)], { highway: "track" });
    if (w === undefined) throw new Error("no way");
    expect(isDisabledRoad(w)).toBe(false);
    expect(disableRoad(w)).toBe(true);
    expect(w.tags?.highway).toBeUndefined();
    expect(isDisabledRoad(w)).toBe(true);
    expect(disableRoad(w)).toBe(false);
    expect(enableRoad(w)).toBe(true);
    expect(w.tags?.highway).toBe("track");
    expect(isDisabledRoad(w)).toBe(false);
    expect(enableRoad(w)).toBe(false);
  });
});
