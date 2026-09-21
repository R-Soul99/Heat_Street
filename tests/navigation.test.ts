import { describe, expect, it } from "vitest";
import { buildNavigationGraph, findRoadPath, nearestRoadNode } from "../src/core/navigation";
import type { RoadGraph } from "../src/core/road-graph";

const graph: RoadGraph = {
  schemaVersion: 1,
  areaId: "test",
  name: "test",
  source: { osmExtract: "", osmSnapshot: "", demSource: "", compilerVersion: "" },
  attribution: { osm: "", osmLicense: "", osmLicenseUrl: "", dem: "" },
  origin: { lat: 0, lon: 0, projection: "local-enu-metres" },
  bounds: { minX: 0, minZ: 0, maxX: 100, maxZ: 100 },
  nodes: [
    { id: 0, x: 0, y: 0, z: 0, junction: true, osmNodeId: 0 },
    { id: 1, x: 100, y: 0, z: 0, junction: true, osmNodeId: 1 },
    { id: 2, x: 0, y: 0, z: 100, junction: false, osmNodeId: 2 },
  ],
  edges: [
    {
      id: 0,
      from: 0,
      to: 1,
      points: [
        [0, 0, 0],
        [100, 0, 0],
      ],
      lengthM: 100,
      surface: "tarmac",
      roadClass: "residential",
      lanes: 2,
      widthM: 6,
      oneway: true,
      speedLimitKph: 50,
      bridge: false,
      tunnel: false,
      layer: 0,
      osmWayId: 0,
    },
    {
      id: 1,
      from: 1,
      to: 2,
      points: [
        [100, 0, 0],
        [0, 0, 100],
      ],
      lengthM: 10,
      surface: "gravel",
      roadClass: "track",
      lanes: 1,
      widthM: 4,
      oneway: true,
      speedLimitKph: 30,
      bridge: false,
      tunnel: false,
      layer: 0,
      osmWayId: 1,
    },
    {
      id: 2,
      from: 0,
      to: 2,
      points: [
        [0, 0, 0],
        [0, 0, 100],
      ],
      lengthM: 500,
      surface: "tarmac",
      roadClass: "residential",
      lanes: 2,
      widthM: 6,
      oneway: true,
      speedLimitKph: 50,
      bridge: false,
      tunnel: false,
      layer: 0,
      osmWayId: 2,
    },
  ],
};

describe("road navigation", () => {
  it("honors one-way edges and returns the weighted legal path", () => {
    const navigation = buildNavigationGraph(graph);
    expect(findRoadPath(navigation, 0, 2)).toEqual([0, 1, 2]);
    expect(findRoadPath(navigation, 2, 1)).toEqual([]);
  });

  it("finds the nearest road node from local coordinates", () => {
    const navigation = buildNavigationGraph(graph);
    expect(nearestRoadNode(navigation, [94, 0, 4])).toBe(1);
  });
});
