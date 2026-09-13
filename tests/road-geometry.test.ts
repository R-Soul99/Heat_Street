import { describe, expect, it } from "vitest";
import { buildRibbon, type Vec3 } from "../src/core/road-geometry";
import type { RoadGraphEdge } from "../src/core/road-graph";

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
