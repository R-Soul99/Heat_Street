import { describe, expect, it } from "vitest";
import {
  buildJunctionFan,
  buildRibbon,
  buildRoadGeometry,
  type IncidentEdgeAtNode,
  type RoadGeometry,
  type Vec3,
} from "../src/core/road-geometry";
import type { RoadGraph, RoadGraphEdge, RoadGraphNode } from "../src/core/road-graph";

/** Builds a conforming RoadGraphEdge literal, filling in plausible defaults for every field a test doesn't care about. */
function makeEdge(
  overrides: Partial<RoadGraphEdge> & { id: number; from: number; to: number; points: Vec3[] },
): RoadGraphEdge {
  return {
    lengthM: 0,
    surface: "tarmac",
    roadClass: "residential",
    lanes: 2,
    widthM: 6,
    oneway: false,
    speedLimitKph: 50,
    bridge: false,
    tunnel: false,
    layer: 0,
    osmWayId: 0,
    ...overrides,
  };
}

function makeNode(
  overrides: Partial<RoadGraphNode> & { id: number; x: number; y: number; z: number },
): RoadGraphNode {
  return { junction: false, osmNodeId: 0, ...overrides };
}

function makeGraph(nodes: RoadGraphNode[], edges: RoadGraphEdge[]): RoadGraph {
  return {
    schemaVersion: 1,
    areaId: "test-area",
    name: "Test Area",
    source: {
      osmExtract: "test://fixture",
      osmSnapshot: "2026-09-13T00:00:00Z",
      demSource: "usgs-3dep-1m",
      compilerVersion: "0.0.0-test",
    },
    attribution: {
      osm: "© OpenStreetMap contributors",
      osmLicense: "ODbL-1.0",
      osmLicenseUrl: "https://www.openstreetmap.org/copyright",
      dem: "U.S. Geological Survey 3D Elevation Program (public domain)",
    },
    origin: { lat: 0, lon: 0, projection: "local-enu-metres" },
    bounds: { minX: -100, minZ: -100, maxX: 100, maxZ: 100 },
    nodes,
    edges,
  };
}

/** Positive Y-component of `(v1-v0) x (v2-v0)` == counter-clockwise winding viewed from +Y. */
function triangleNormalY(v0: Vec3, v1: Vec3, v2: Vec3): number {
  const ax = v1[0] - v0[0];
  const az = v1[2] - v0[2];
  const bx = v2[0] - v0[0];
  const bz = v2[2] - v0[2];
  return az * bx - ax * bz;
}

function vertexAt(positions: Float32Array, index: number): Vec3 {
  return [positions[index * 3], positions[index * 3 + 1], positions[index * 3 + 2]];
}

/** Asserts every triangle in `indices`/`positions` winds CCW viewed from +Y. */
function expectAllTrianglesCCW(positions: Float32Array, indices: Uint32Array): void {
  for (let t = 0; t < indices.length / 3; t++) {
    const v0 = vertexAt(positions, indices[t * 3]);
    const v1 = vertexAt(positions, indices[t * 3 + 1]);
    const v2 = vertexAt(positions, indices[t * 3 + 2]);
    const normalY = triangleNormalY(v0, v1, v2);
    expect(
      normalY,
      `triangle ${t} (${JSON.stringify([v0, v1, v2])}) should wind CCW from +Y`,
    ).toBeGreaterThan(0);
  }
}

describe("buildRibbon — straight 2-point edge", () => {
  it("produces exactly 4 positions and 6 indices, left/right pairs exactly 6m apart", () => {
    const edge = makeEdge({
      id: 1,
      from: 0,
      to: 1,
      points: [
        [0, 0, 0],
        [10, 0, 0],
      ],
      widthM: 6,
    });
    const ribbon = buildRibbon(edge);
    expect(ribbon.positions).toHaveLength(12);
    expect(ribbon.indices).toHaveLength(6);

    const l0 = vertexAt(ribbon.positions, 0);
    const r0 = vertexAt(ribbon.positions, 1);
    const l1 = vertexAt(ribbon.positions, 2);
    const r1 = vertexAt(ribbon.positions, 3);

    const distXZ = (a: Vec3, b: Vec3) => Math.hypot(a[0] - b[0], a[2] - b[2]);
    expect(distXZ(l0, r0)).toBeCloseTo(6, 6);
    expect(distXZ(l1, r1)).toBeCloseTo(6, 6);
  });

  it("winds every triangle CCW viewed from +Y", () => {
    const edge = makeEdge({
      id: 1,
      from: 0,
      to: 1,
      points: [
        [0, 0, 0],
        [10, 0, 0],
      ],
      widthM: 6,
    });
    const ribbon = buildRibbon(edge);
    expectAllTrianglesCCW(ribbon.positions, ribbon.indices);
  });
});

describe("buildRibbon — elevation fidelity", () => {
  it("copies each vertex's Y from its source centreline point exactly, for non-zero non-uniform Y", () => {
    const edge = makeEdge({
      id: 2,
      from: 0,
      to: 1,
      points: [
        [0, 5, 0],
        [10, 7, 0],
      ],
      widthM: 6,
    });
    const ribbon = buildRibbon(edge);
    const l0 = vertexAt(ribbon.positions, 0);
    const r0 = vertexAt(ribbon.positions, 1);
    const l1 = vertexAt(ribbon.positions, 2);
    const r1 = vertexAt(ribbon.positions, 3);
    expect(l0[1]).toBe(5);
    expect(r0[1]).toBe(5);
    expect(l1[1]).toBe(7);
    expect(r1[1]).toBe(7);
  });
});

describe("buildRibbon — miter join at a 90-degree corner", () => {
  it("offsets the interior point by halfWidth / sin(theta/2), computed from the constructed angle", () => {
    const p0: Vec3 = [0, 0, 0];
    const p1: Vec3 = [10, 0, 0];
    const p2: Vec3 = [10, 0, 10];
    const edge = makeEdge({ id: 3, from: 0, to: 1, points: [p0, p1, p2], widthM: 6 });
    const ribbon = buildRibbon(edge);

    // Recompute the expected interior angle independently from the
    // constructed points, per the plan's own instruction not to hardcode a
    // magic number.
    const din = { x: p1[0] - p0[0], z: p1[2] - p0[2] };
    const dout = { x: p2[0] - p1[0], z: p2[2] - p1[2] };
    const dinLen = Math.hypot(din.x, din.z);
    const doutLen = Math.hypot(dout.x, dout.z);
    const dinN = { x: din.x / dinLen, z: din.z / dinLen };
    const doutN = { x: dout.x / doutLen, z: dout.z / doutLen };
    const cross = dinN.x * doutN.z - dinN.z * doutN.x;
    const dot = dinN.x * doutN.x + dinN.z * doutN.z;
    const delta = Math.atan2(Math.abs(cross), dot);
    const theta = Math.PI - delta;
    const halfWidth = 3;
    const expectedDist = halfWidth / Math.sin(theta / 2);

    const l1 = vertexAt(ribbon.positions, 2); // left corner at interior point p1
    const distFromCentreline = Math.hypot(l1[0] - p1[0], l1[2] - p1[2]);
    expect(distFromCentreline).toBeCloseTo(expectedDist, 6);
    expect(expectedDist).toBeCloseTo(halfWidth * Math.SQRT2, 4); // ~1.414x halfWidth at 90 degrees
  });

  it("winds every triangle CCW viewed from +Y for a curving edge", () => {
    const edge = makeEdge({
      id: 3,
      from: 0,
      to: 1,
      points: [
        [0, 0, 0],
        [10, 0, 0],
        [10, 0, 10],
      ],
      widthM: 6,
    });
    const ribbon = buildRibbon(edge);
    expectAllTrianglesCCW(ribbon.positions, ribbon.indices);
  });
});

type Vec3xz = { x: number; z: number };

describe("buildRibbon — hairpin miter clamp", () => {
  it("clamps the offset distance to exactly 3x halfWidth under a ~30-degree interior angle", () => {
    // din = east (1,0); dout is din rotated 150 degrees, giving an interior
    // angle theta = 180 - 150 = 30 degrees, well under the ~40-degree clamp
    // threshold.
    const deltaDeg = 150;
    const deltaRad = (deltaDeg * Math.PI) / 180;
    const din: Vec3xz = { x: 1, z: 0 };
    const dout: Vec3xz = {
      x: din.x * Math.cos(deltaRad) - din.z * Math.sin(deltaRad),
      z: din.x * Math.sin(deltaRad) + din.z * Math.cos(deltaRad),
    };
    const p0: Vec3 = [0, 0, 0];
    const p1: Vec3 = [10, 0, 0];
    const p2: Vec3 = [p1[0] + dout.x * 10, 0, p1[2] + dout.z * 10];

    const edge = makeEdge({ id: 4, from: 0, to: 1, points: [p0, p1, p2], widthM: 6 });
    const ribbon = buildRibbon(edge);
    const l1 = vertexAt(ribbon.positions, 2);
    const distFromCentreline = Math.hypot(l1[0] - p1[0], l1[2] - p1[2]);
    expect(distFromCentreline).toBeCloseTo(9, 6); // 3 * halfWidth(3)
  });
});

describe("buildRibbon — endpoints are exact, no extension or inset", () => {
  it("the first ribbon pair straddles points[0] and the last straddles the final point", () => {
    const p0: Vec3 = [0, 0, 0];
    const p1: Vec3 = [10, 0, 0];
    const p2: Vec3 = [15, 0, 5];
    const edge = makeEdge({ id: 5, from: 0, to: 1, points: [p0, p1, p2], widthM: 6 });
    const ribbon = buildRibbon(edge);

    const l0 = vertexAt(ribbon.positions, 0);
    const r0 = vertexAt(ribbon.positions, 1);
    const lastIndex = ribbon.positions.length / 3 - 2;
    const lLast = vertexAt(ribbon.positions, lastIndex);
    const rLast = vertexAt(ribbon.positions, lastIndex + 1);

    const midpoint = (a: Vec3, b: Vec3): Vec3 => [
      (a[0] + b[0]) / 2,
      (a[1] + b[1]) / 2,
      (a[2] + b[2]) / 2,
    ];
    const mid0 = midpoint(l0, r0);
    const midLast = midpoint(lLast, rLast);
    expect(mid0[0]).toBeCloseTo(p0[0], 5);
    expect(mid0[2]).toBeCloseTo(p0[2], 5);
    expect(midLast[0]).toBeCloseTo(p2[0], 5);
    expect(midLast[2]).toBeCloseTo(p2[2], 5);
  });
});

describe("buildRibbon — collapses near-duplicate consecutive points", () => {
  it("collapses a point 5e-5m from its neighbor, producing the same output as the 2-point case", () => {
    const edge = makeEdge({
      id: 6,
      from: 0,
      to: 1,
      points: [
        [0, 0, 0],
        [0.00005, 0, 0],
        [10, 0, 0],
      ],
      widthM: 6,
    });
    const ribbon = buildRibbon(edge);
    expect(ribbon.positions).toHaveLength(12);
    expect(ribbon.indices).toHaveLength(6);
  });
});

describe("buildRibbon — degenerate 2-point edge", () => {
  it("throws naming the edge id when both points are identical", () => {
    const edge = makeEdge({
      id: 42,
      from: 0,
      to: 1,
      points: [
        [5, 1, 5],
        [5, 1, 5],
      ],
      widthM: 6,
    });
    expect(() => buildRibbon(edge)).toThrow(/42/);
  });
});

// ---------------------------------------------------------------------------
// Task 2: buildJunctionFan / buildRoadGeometry
// ---------------------------------------------------------------------------

describe("buildJunctionFan — surface assignment", () => {
  it("resolves a tarmac tertiary + gravel track + tarmac residential junction to tarmac (tertiary wins)", () => {
    const node = makeNode({ id: 0, x: 0, y: 0, z: 0, junction: true });
    const incident: IncidentEdgeAtNode[] = [
      {
        edgeId: 5,
        surface: "tarmac",
        roadClass: "tertiary",
        nearLeft: [1, 0, 1],
        nearRight: [-1, 0, 1],
        awayPoint: [0, 0, 10],
      },
      {
        edgeId: 2,
        surface: "gravel",
        roadClass: "track",
        nearLeft: [11, 0, -1],
        nearRight: [9, 0, 1],
        awayPoint: [10, 0, 0],
      },
      {
        edgeId: 9,
        surface: "tarmac",
        roadClass: "residential",
        nearLeft: [-9, 0, -1],
        nearRight: [-11, 0, 1],
        awayPoint: [-10, 0, 0],
      },
    ];
    const fan = buildJunctionFan(node, incident);
    expect(fan.surface).toBe("tarmac");
  });

  it("breaks a same-rank (residential) tie by lowest edge id", () => {
    const node = makeNode({ id: 0, x: 0, y: 0, z: 0, junction: true });
    const incident: IncidentEdgeAtNode[] = [
      {
        edgeId: 7,
        surface: "tarmac",
        roadClass: "residential",
        nearLeft: [1, 0, 1],
        nearRight: [-1, 0, 1],
        awayPoint: [0, 0, 10],
      },
      {
        edgeId: 2,
        surface: "gravel",
        roadClass: "residential",
        nearLeft: [11, 0, -1],
        nearRight: [9, 0, 1],
        awayPoint: [10, 0, 0],
      },
      {
        edgeId: 15,
        surface: "mud",
        roadClass: "residential",
        nearLeft: [-9, 0, -1],
        nearRight: [-11, 0, 1],
        awayPoint: [-10, 0, 0],
      },
    ];
    const fan = buildJunctionFan(node, incident);
    expect(fan.surface).toBe("gravel"); // edgeId 2 is the lowest among the tied residential entries
  });
});

describe("buildJunctionFan — fan centre vertex", () => {
  it("takes the node's authored x, y, z exactly", () => {
    const node = makeNode({ id: 3, x: 12.5, y: 4.25, z: -7.5, junction: true });
    const incident: IncidentEdgeAtNode[] = [
      {
        edgeId: 0,
        surface: "tarmac",
        roadClass: "residential",
        nearLeft: [13, 4.25, -4],
        nearRight: [11, 4.25, -4],
        awayPoint: [12.5, 4.25, 2.5],
      },
      {
        edgeId: 1,
        surface: "tarmac",
        roadClass: "residential",
        nearLeft: [22.5, 4.25, -8],
        nearRight: [22.5, 4.25, -7],
        awayPoint: [22.5, 4.25, -7.5],
      },
      {
        edgeId: 2,
        surface: "tarmac",
        roadClass: "residential",
        nearLeft: [2.5, 4.25, -7],
        nearRight: [2.5, 4.25, -8],
        awayPoint: [2.5, 4.25, -7.5],
      },
    ];
    const fan = buildJunctionFan(node, incident);
    const centre = vertexAt(fan.positions, 0);
    expect(centre).toEqual([12.5, 4.25, -7.5]);
  });
});

/** Builds an asymmetric 4-arm crossroads at the origin (avoids exact bearing ties). */
function buildFourWayGraph(): RoadGraph {
  const bearingsDeg = [0, 80, 190, 290];
  const armLength = 20;
  const nodes: RoadGraphNode[] = [makeNode({ id: 0, x: 0, y: 0, z: 0, junction: true })];
  const edges: RoadGraphEdge[] = [];
  bearingsDeg.forEach((deg, i) => {
    const rad = (deg * Math.PI) / 180;
    const dx = Math.sin(rad) * armLength;
    const dz = Math.cos(rad) * armLength;
    const nodeId = i + 1;
    nodes.push(makeNode({ id: nodeId, x: dx, y: 0, z: dz, junction: false }));
    edges.push(
      makeEdge({
        id: i,
        from: 0,
        to: nodeId,
        points: [
          [0, 0, 0],
          [dx, 0, dz],
        ],
        widthM: 6,
        surface: "tarmac",
        roadClass: "residential",
      }),
    );
  });
  return makeGraph(nodes, edges);
}

describe("buildRoadGeometry — 4-way crossroads fan", () => {
  const geometry = buildRoadGeometry(buildFourWayGraph());
  const fan = geometry.junctions.find((j) => j.nodeId === 0);

  it("returns one edge entry per edge and one junction entry for the crossroads node", () => {
    expect(geometry.edges).toHaveLength(4);
    expect(geometry.junctions).toHaveLength(1);
    expect(fan).toBeDefined();
  });

  it("produces exactly 8 boundary vertices plus 1 centre vertex and 8 triangles", () => {
    expect(fan?.positions).toHaveLength((1 + 8) * 3);
    expect(fan?.indices).toHaveLength(8 * 3);
  });

  it("every fan triangle shares its third vertex with the node centre (index 0)", () => {
    for (let t = 0; t < (fan?.indices.length ?? 0) / 3; t++) {
      expect(fan?.indices[t * 3]).toBe(0);
    }
  });

  it("winds every fan triangle CCW viewed from +Y", () => {
    if (fan) expectAllTrianglesCCW(fan.positions, fan.indices);
  });
});

describe("buildRoadGeometry — degree-2 and degree-1 nodes", () => {
  it("degree-2 node produces no fan, and the two incident ribbons' corners at it are identical", () => {
    const nodeStart = makeNode({ id: 1, x: -10, y: 0, z: 0, junction: false });
    const nodeMid = makeNode({ id: 0, x: 0, y: 0, z: 0, junction: false });
    const nodeEnd = makeNode({ id: 2, x: 10, y: 0, z: 0, junction: false });
    const edgeA = makeEdge({
      id: 0,
      from: 1,
      to: 0,
      points: [
        [-10, 0, 0],
        [0, 0, 0],
      ],
      widthM: 6,
      surface: "tarmac",
    });
    const edgeB = makeEdge({
      id: 1,
      from: 0,
      to: 2,
      points: [
        [0, 0, 0],
        [10, 0, 0],
      ],
      widthM: 6,
      surface: "gravel",
    });
    const graph = makeGraph([nodeStart, nodeMid, nodeEnd], [edgeA, edgeB]);
    const geometry = buildRoadGeometry(graph);

    expect(geometry.junctions.find((j) => j.nodeId === 0)).toBeUndefined();

    const ribbonA = buildRibbon(edgeA);
    const ribbonB = buildRibbon(edgeB);
    // edgeA ends at node 0 (index 1 of its corners); edgeB starts at node 0 (index 0).
    expect(ribbonA.leftCorners[1]).toEqual(ribbonB.leftCorners[0]);
    expect(ribbonA.rightCorners[1]).toEqual(ribbonB.rightCorners[0]);
  });

  it("degree-1 dead end nodes produce no fan", () => {
    const geometry = buildRoadGeometry(buildFourWayGraph());
    for (const armNodeId of [1, 2, 3, 4]) {
      expect(geometry.junctions.find((j) => j.nodeId === armNodeId)).toBeUndefined();
    }
  });
});

describe("buildJunctionFan — throws below 3 incident edges", () => {
  it("throws naming the node id when given only 2 incident edges", () => {
    const node = makeNode({ id: 9, x: 0, y: 0, z: 0, junction: false });
    const incident: IncidentEdgeAtNode[] = [
      {
        edgeId: 0,
        surface: "tarmac",
        roadClass: "residential",
        nearLeft: [1, 0, 1],
        nearRight: [-1, 0, 1],
        awayPoint: [0, 0, 10],
      },
      {
        edgeId: 1,
        surface: "tarmac",
        roadClass: "residential",
        nearLeft: [11, 0, -1],
        nearRight: [9, 0, 1],
        awayPoint: [10, 0, 0],
      },
    ];
    expect(() => buildJunctionFan(node, incident)).toThrow(/9/);
  });
});

describe("buildRoadGeometry — whole-graph watertightness across every node degree", () => {
  // A single synthetic graph covering all four node degrees the plan
  // requires: node 0 (degree 4, crossroads), node 2 (degree 3, a T-junction
  // grafted onto one arm), node 3 (degree 2, a surface-change split with no
  // fan), and several degree-1 dead ends (nodes 1, 4, 5, 6, 7).
  function buildSyntheticGraph(): RoadGraph {
    const n0 = makeNode({ id: 0, x: 0, y: 0, z: 0, junction: true });
    const n1 = makeNode({ id: 1, x: 0, y: 0, z: 20, junction: false });
    const n2 = makeNode({ id: 2, x: 19.696, y: 0, z: 3.472, junction: true });
    const n3 = makeNode({ id: 3, x: -3.472, y: 0, z: -19.696, junction: false });
    const n4 = makeNode({ id: 4, x: -18.794, y: 0, z: 6.84, junction: false });
    // n5/n6 are deliberately NOT collinear-opposite through n2 (that would give
    // e4/e5 identical corner bearings at equal width, producing an exact
    // duplicate boundary vertex and a zero-area fan triangle).
    const n5 = makeNode({ id: 5, x: 24.696, y: 0, z: 18.472, junction: false });
    const n6 = makeNode({ id: 6, x: 27.696, y: 0, z: -8.528, junction: false });
    const n7 = makeNode({ id: 7, x: -6.076, y: 0, z: -34.468, junction: false });

    const e0 = makeEdge({
      id: 0,
      from: 0,
      to: 1,
      points: [
        [0, 0, 0],
        [0, 0, 20],
      ],
      widthM: 6,
      surface: "tarmac",
      roadClass: "residential",
    });
    const e1 = makeEdge({
      id: 1,
      from: 0,
      to: 2,
      points: [
        [0, 0, 0],
        [19.696, 0, 3.472],
      ],
      widthM: 6,
      surface: "tarmac",
      roadClass: "residential",
    });
    const e2 = makeEdge({
      id: 2,
      from: 0,
      to: 3,
      points: [
        [0, 0, 0],
        [-3.472, 0, -19.696],
      ],
      widthM: 6,
      surface: "tarmac",
      roadClass: "tertiary",
    });
    const e3 = makeEdge({
      id: 3,
      from: 0,
      to: 4,
      points: [
        [0, 0, 0],
        [-18.794, 0, 6.84],
      ],
      widthM: 6,
      surface: "tarmac",
      roadClass: "residential",
    });
    const e4 = makeEdge({
      id: 4,
      from: 2,
      to: 5,
      points: [
        [19.696, 0, 3.472],
        [24.696, 0, 18.472],
      ],
      widthM: 5,
      surface: "tarmac",
      roadClass: "residential",
    });
    const e5 = makeEdge({
      id: 5,
      from: 2,
      to: 6,
      points: [
        [19.696, 0, 3.472],
        [27.696, 0, -8.528],
      ],
      widthM: 5,
      surface: "tarmac",
      roadClass: "residential",
    });
    const e6 = makeEdge({
      id: 6,
      from: 3,
      to: 7,
      points: [
        [-3.472, 0, -19.696],
        [-6.076, 0, -34.468],
      ],
      widthM: 6, // must match e2's width — a degree-2 collinear split requires equal width to butt seamlessly
      surface: "gravel",
      roadClass: "track",
    });

    return makeGraph([n0, n1, n2, n3, n4, n5, n6, n7], [e0, e1, e2, e3, e4, e5, e6]);
  }

  const graph = buildSyntheticGraph();
  const geometry = buildRoadGeometry(graph);

  it("produces a junction fan for the degree-4 and degree-3 nodes only", () => {
    const junctionNodeIds = geometry.junctions.map((j) => j.nodeId).sort((a, b) => a - b);
    expect(junctionNodeIds).toEqual([0, 2]);
  });

  it("every fan boundary vertex matches some ribbon corner position exactly, zero unmatched vertices", () => {
    const cornerKeys = new Set<string>();
    for (const edgeEntry of geometry.edges) {
      const n = edgeEntry.positions.length / 6; // points per ribbon
      const pushCorner = (index: number) => {
        const v = vertexAt(edgeEntry.positions, index);
        cornerKeys.add(`${v[0]},${v[1]},${v[2]}`);
      };
      pushCorner(0); // L0
      pushCorner(1); // R0
      pushCorner(2 * (n - 1)); // L_last
      pushCorner(2 * (n - 1) + 1); // R_last
    }

    const unmatched: { nodeId: number; vertex: Vec3 }[] = [];
    for (const fan of geometry.junctions) {
      const boundaryCount = fan.positions.length / 3 - 1;
      for (let i = 1; i <= boundaryCount; i++) {
        const v = vertexAt(fan.positions, i);
        const key = `${v[0]},${v[1]},${v[2]}`;
        if (!cornerKeys.has(key)) {
          unmatched.push({ nodeId: fan.nodeId, vertex: v });
        }
      }
    }

    expect(unmatched, `unmatched fan boundary vertices: ${JSON.stringify(unmatched)}`).toEqual([]);
  });

  it("winds every triangle CCW viewed from +Y across every edge ribbon and junction fan", () => {
    for (const edgeEntry of geometry.edges) {
      expectAllTrianglesCCW(edgeEntry.positions, edgeEntry.indices);
    }
    for (const fan of geometry.junctions) {
      expectAllTrianglesCCW(fan.positions, fan.indices);
    }
  });

  it("degree-2 node 3 produces no fan", () => {
    expect(geometry.junctions.find((j) => j.nodeId === 3)).toBeUndefined();
  });

  it("has no unused RoadGeometry export left untyped (sanity import check)", () => {
    const g: RoadGeometry = geometry;
    expect(g.edges.length + g.junctions.length).toBeGreaterThan(0);
  });
});
