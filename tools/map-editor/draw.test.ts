import { describe, expect, it } from "vitest";
import {
  addBuildingRect,
  addRoad,
  makeProjector,
  moveNode,
  type RawEnvelope,
  type RawWay,
  snapPoint,
} from "./model.ts";

const bbox = { south: 50, west: -3, north: 50.002, east: -2.998 };
const proj = makeProjector(bbox);

function envelope(elements: RawWay[]): RawEnvelope {
  return { fetchedAt: "t", endpoint: "e", bbox, query: "q", response: { elements } };
}
const straight = (): RawWay => ({
  type: "way",
  id: 1,
  nodes: [1_000_000_001, 1_000_000_002],
  geometry: [
    { lat: 50.001, lon: -3 },
    { lat: 50.001, lon: -2.998 },
  ],
  tags: { highway: "residential" },
});

describe("projector", () => {
  it("round-trips local <-> lat/lon", () => {
    const ll = { lat: 50.0012, lon: -2.9991 };
    const back = proj.toLatLon(proj.toLocal(ll));
    expect(back.lat).toBeCloseTo(ll.lat, 9);
    expect(back.lon).toBeCloseTo(ll.lon, 9);
  });
});

describe("addRoad", () => {
  it("splits the road it ends on so the compiler sees a shared junction node", () => {
    const roads = envelope([straight()]);
    const start = snapPoint(proj.toLocal({ lat: 50.001, lon: -2.999 }), roads, proj, 10);
    expect(start.kind).toBe("segment");
    const end = snapPoint(proj.toLocal({ lat: 50.0018, lon: -2.999 }), roads, proj, 1);
    expect(end.kind).toBe("free");
    const road = addRoad(roads, proj, [start, end], { highway: "residential" });
    const existing = roads.response.elements[0] as RawWay;
    expect(existing.geometry).toHaveLength(3);
    expect(existing.nodes).toHaveLength(3);
    expect(road?.nodes?.[0]).toBe(existing.nodes?.[1]);
    expect(new Set(roads.response.elements.map((w) => w.id)).size).toBe(2);
  });

  it("reuses an existing node when snapped to it, and rejects single-point roads", () => {
    const roads = envelope([straight()]);
    const a = snapPoint(proj.toLocal({ lat: 50.001, lon: -3 }), roads, proj, 5);
    expect(a.kind).toBe("node");
    expect(addRoad(roads, proj, [a], {})).toBeUndefined();
    const b = snapPoint(proj.toLocal({ lat: 50.0015, lon: -2.9995 }), roads, proj, 1);
    const road = addRoad(roads, proj, [a, b], {});
    expect(road?.nodes?.[0]).toBe(1_000_000_001);
  });
});

describe("moveNode", () => {
  it("moves the node in every way that shares it", () => {
    const a = straight();
    const b: RawWay = { ...straight(), id: 2, nodes: [1_000_000_002, 1_000_000_009] };
    b.geometry = [
      { lat: 50.001, lon: -2.998 },
      { lat: 50.0015, lon: -2.998 },
    ];
    const roads = envelope([a, b]);
    moveNode(roads, 1_000_000_002, { lat: 50.0011, lon: -2.9979 });
    expect(a.geometry[1]).toEqual({ lat: 50.0011, lon: -2.9979 });
    expect(b.geometry[0]).toEqual({ lat: 50.0011, lon: -2.9979 });
  });
});

describe("addBuildingRect", () => {
  it("makes a closed 5-point ring with a height tag", () => {
    const bld = envelope([]);
    const w = addBuildingRect(bld, { lat: 50, lon: -3 }, { lat: 50.0001, lon: -2.9999 }, 8);
    expect(w.geometry).toHaveLength(5);
    expect(w.geometry[0]).toEqual(w.geometry[4]);
    expect(w.tags?.height).toBe("8");
  });
});
