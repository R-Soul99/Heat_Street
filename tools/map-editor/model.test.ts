import { describe, expect, it } from "vitest";
import {
  effectiveSurface,
  makeProjector,
  pickBuilding,
  pickRoad,
  type RawWay,
  setSurface,
  setTag,
} from "./model.ts";

const bbox = { south: 50, west: -3, north: 50.002, east: -2.998 };
const proj = makeProjector(bbox);
const road = (id: number, lat: number, tags: Record<string, string> = {}): RawWay => ({
  type: "way",
  id,
  geometry: [
    { lat, lon: -3 },
    { lat, lon: -2.998 },
  ],
  tags: { highway: "residential", ...tags },
});

describe("effectiveSurface", () => {
  it("falls back on highway class, honours explicit surface", () => {
    expect(effectiveSurface({ highway: "track" })).toBe("dirt_road");
    expect(effectiveSurface({ highway: "residential" })).toBe("tarmac");
    expect(effectiveSurface({ highway: "residential", surface: "gravel" })).toBe("gravel");
  });
});

describe("tag edits", () => {
  it("setSurface writes an OSM value the compiler maps back, and clears on null", () => {
    const w = road(1, 50.001);
    setSurface(w, "dirt_road");
    expect(effectiveSurface(w.tags)).toBe("dirt_road");
    setSurface(w, null);
    expect(w.tags?.surface).toBeUndefined();
  });
  it("setTag clears on empty", () => {
    const w = road(1, 50.001);
    setTag(w, "width", "5");
    expect(w.tags?.width).toBe("5");
    setTag(w, "width", "");
    expect(w.tags?.width).toBeUndefined();
  });
});

describe("picking", () => {
  it("picks the nearest road within tolerance only", () => {
    const a = road(1, 50.0005);
    const b = road(2, 50.0015);
    const p = proj.toLocal({ lat: 50.0006, lon: -2.999 });
    expect(pickRoad(p, [a, b], proj, 20)?.id).toBe(1);
    expect(pickRoad(proj.toLocal({ lat: 50.001, lon: -2.999 }), [a, b], proj, 5)).toBeUndefined();
  });
  it("picks a building by point-in-polygon", () => {
    const bld: RawWay = {
      type: "way",
      id: 9,
      geometry: [
        { lat: 50.0004, lon: -2.9992 },
        { lat: 50.0004, lon: -2.999 },
        { lat: 50.0006, lon: -2.999 },
        { lat: 50.0006, lon: -2.9992 },
        { lat: 50.0004, lon: -2.9992 },
      ],
    };
    expect(pickBuilding(proj.toLocal({ lat: 50.0005, lon: -2.9991 }), [bld], proj)?.id).toBe(9);
    expect(pickBuilding(proj.toLocal({ lat: 50.0015, lon: -2.9991 }), [bld], proj)).toBeUndefined();
  });
});
