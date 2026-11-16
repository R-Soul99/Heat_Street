import { describe, expect, it } from "vitest";
import {
  buildingBoxes,
  featureColliders,
  featureInstances,
  lineBoxQuat,
  lineSegments,
  MAX_SCENERY_TRIANGLES,
  sceneryTriangles,
} from "../src/core/scenery-geometry";
import type { TerrainBuilding, TerrainFeature } from "../src/core/terrain-format";
import { DENSE_BUILDINGS, DENSE_FEATURES } from "./fixtures/dense-scenery";

const flat = () => 0;
const slope = (x: number) => 0.1 * x;

const tree = (variant = "pine", scale = 1): TerrainFeature => ({
  id: "t",
  kind: "tree",
  variant,
  x: 3,
  z: 4,
  rotationY: 0,
  scale,
});
const bush = (variant = "round"): TerrainFeature => ({
  id: "b",
  kind: "bush",
  variant,
  x: 1,
  z: 1,
  rotationY: 0,
  scale: 1,
});
const steep = (x: number) => Math.tan((20 * Math.PI) / 180) * x;

/** Rotates a vector by a unit quaternion. */
function rotate(
  q: { x: number; y: number; z: number; w: number },
  v: [number, number, number],
): [number, number, number] {
  const [vx, vy, vz] = v;
  const tx = 2 * (q.y * vz - q.z * vy);
  const ty = 2 * (q.z * vx - q.x * vz);
  const tz = 2 * (q.x * vy - q.y * vx);
  return [
    vx + q.w * tx + (q.y * tz - q.z * ty),
    vy + q.w * ty + (q.z * tx - q.x * tz),
    vz + q.w * tz + (q.x * ty - q.y * tx),
  ];
}

/** A point of a pitched box given in the box's own axes (along, up, across). */
function boxPoint(
  b: { x: number; y: number; z: number; rotationY: number; pitch: number },
  local: [number, number, number],
): [number, number, number] {
  const r = rotate(lineBoxQuat(b.rotationY, b.pitch), local);
  return [b.x + r[0], b.y + r[1], b.z + r[2]];
}

const line = (
  kind: "hedge" | "fence",
  variant: string,
  points: [number, number][],
  heightM = 1.5,
): TerrainFeature => ({ id: "l", kind, variant, points, heightM });

describe("lineSegments", () => {
  it("splits 20 m into 3 equal segments and aligns rotationY", () => {
    const s = lineSegments(
      [
        [0, 0],
        [20, 0],
      ],
      flat,
      1.5,
      1,
    );
    expect(s).toHaveLength(3);
    for (const seg of s) expect(seg.lengthM).toBeCloseTo(20 / 3, 6);
    const d = lineSegments(
      [
        [0, 0],
        [0, 5],
      ],
      flat,
      1.5,
      1,
    )[0];
    expect(Math.cos(d?.rotationY ?? 9)).toBeCloseTo(0, 6);
    expect(-Math.sin(d?.rotationY ?? 9)).toBeCloseTo(1, 6);
  });
  it("follows the ground: pitch and slope length come from the two end heights", () => {
    const s = lineSegments(
      [
        [0, 0],
        [8, 0],
      ],
      slope,
      1.5,
      1,
    )[0];
    expect(s?.startY).toBeCloseTo(0, 6);
    expect(s?.endY).toBeCloseTo(0.8, 6);
    expect(s?.y).toBeCloseTo(0.4, 6);
    expect(s?.lengthM).toBeCloseTo(8, 6);
    expect(s?.slopeLengthM).toBeCloseTo(Math.hypot(8, 0.8), 6);
    expect(s?.pitch).toBeCloseTo(Math.atan(0.1), 6);
    const level = lineSegments(
      [
        [0, 0],
        [8, 0],
      ],
      flat,
      1.5,
      1,
    )[0];
    expect(level?.pitch).toBe(0);
    expect(level?.slopeLengthM).toBe(level?.lengthM);
  });
  it("drops zero-length segments", () => {
    expect(
      lineSegments(
        [
          [1, 1],
          [1, 1],
          [1, 1],
        ],
        flat,
        1,
        1,
      ),
    ).toHaveLength(0);
  });
});

describe("featureColliders", () => {
  it("makes a trunk cylinder, nothing for a bush, sight rules for hedge and fence", () => {
    const c = featureColliders(
      [
        tree("pine", 2),
        bush(),
        line("hedge", "box", [
          [0, 0],
          [8, 0],
        ]),
        line("fence", "picket", [
          [0, 5],
          [8, 5],
        ]),
      ],
      flat,
    );
    expect(c).toHaveLength(3);
    const trunk = c[0];
    expect(trunk?.shape).toBe("cylinder");
    if (trunk?.shape === "cylinder") {
      expect(trunk.radius).toBeCloseTo(0.5, 6);
      expect(trunk.halfHeight).toBeCloseTo(2.5, 6);
      expect(trunk.blocksSight).toBe(false);
    }
    expect(c[1]?.kind).toBe("hedge");
    expect(c[1]?.blocksSight).toBe(true);
    expect(c[2]?.kind).toBe("fence");
    expect(c[2]?.blocksSight).toBe(false);
  });
  it("a level line box sinks 0.3 m below the ground and stands the full height above it", () => {
    const c = featureColliders(
      [
        line("hedge", "box", [
          [0, 0],
          [8, 0],
        ]),
      ],
      () => 2,
    );
    const b = c[0];
    expect(b?.shape).toBe("cuboid");
    if (b?.shape === "cuboid") {
      expect(b.pitch).toBe(0);
      expect(b.hx).toBeCloseTo(4, 6);
      expect(b.y - b.hy).toBeCloseTo(2 - 0.3, 6);
      expect(b.y + b.hy).toBeCloseTo(2 + 1.5, 6);
    }
  });

  // WR-06: a level slab at the average height left the low end ~1.2 m in the air on 20 degrees.
  it("line colliders follow a 20 degree slope: neither end floats or is buried", () => {
    for (const kind of ["hedge", "fence"] as const) {
      const c = featureColliders(
        [
          line(
            kind,
            kind === "hedge" ? "box" : "post-rail",
            [
              [0, 3],
              [8, 3],
            ],
            1.2,
          ),
        ],
        steep,
      );
      const b = c[0];
      expect(b?.shape).toBe("cuboid");
      if (b?.shape !== "cuboid") continue;
      expect(b.pitch).toBeCloseTo((20 * Math.PI) / 180, 6);
      expect(b.hx).toBeCloseTo(Math.hypot(8, steep(8)) / 2, 6);
      // Bottom face at each end sits just under the ground there (within the 0.3 m sink).
      const low = boxPoint(b, [-b.hx, -b.hy, 0]);
      const high = boxPoint(b, [b.hx, -b.hy, 0]);
      for (const p of [low, high]) {
        const gap = p[1] - steep(p[0]);
        expect(gap).toBeLessThan(0);
        expect(gap).toBeGreaterThan(-0.35);
      }
      // Top face at each end is the full 1.2 m above the ground line (measured along the box).
      const topLow = boxPoint(b, [-b.hx, b.hy, 0]);
      const topHigh = boxPoint(b, [b.hx, b.hy, 0]);
      expect(Math.hypot(topLow[0] - 0, topLow[1] - steep(0))).toBeCloseTo(1.2, 6);
      expect(Math.hypot(topHigh[0] - 8, topHigh[1] - steep(8))).toBeCloseTo(1.2, 6);
      expect(low[2]).toBeCloseTo(3, 6);
    }
  });

  it("a line running downhill along z tilts the right way", () => {
    // Ground falls 0.5 m per metre of z; the line runs from z 0 to z 6.
    const c = featureColliders(
      [
        line("hedge", "box", [
          [5, 0],
          [5, 6],
        ]),
      ],
      (_x, z) => -0.5 * z,
    );
    const b = c[0];
    if (b?.shape !== "cuboid") throw new Error("expected a cuboid");
    const start = boxPoint(b, [-b.hx, -b.hy + 0.3, 0]);
    const end = boxPoint(b, [b.hx, -b.hy + 0.3, 0]);
    expect(start[0]).toBeCloseTo(5, 6);
    expect(start[1]).toBeCloseTo(0, 6);
    expect(start[2]).toBeCloseTo(0, 6);
    expect(end[1]).toBeCloseTo(-3, 6);
    expect(end[2]).toBeCloseTo(6, 6);
  });
});

describe("lineBoxQuat", () => {
  it("with no pitch is a plain turn about Y", () => {
    const q = lineBoxQuat(0.7, 0);
    expect(q.x).toBeCloseTo(0, 12);
    expect(q.z).toBeCloseTo(0, 12);
    expect(q.y).toBeCloseTo(Math.sin(0.35), 12);
    expect(q.w).toBeCloseTo(Math.cos(0.35), 12);
  });
  it("tilts the length axis up by the pitch, then turns it by rotationY", () => {
    const [x, y, z] = rotate(lineBoxQuat(Math.PI / 2, 0.3), [1, 0, 0]);
    // rotationY of +90 degrees points the length along -z (three.js Y rotation).
    expect(x).toBeCloseTo(0, 9);
    expect(y).toBeCloseTo(Math.sin(0.3), 9);
    expect(z).toBeCloseTo(-Math.cos(0.3), 9);
  });
});

describe("featureInstances", () => {
  it("groups trees and bushes, and places fence posts at every start plus the end", () => {
    const i = featureInstances(
      [
        tree("pine"),
        tree("pine"),
        tree("oak"),
        bush(),
        line("fence", "picket", [
          [0, 0],
          [20, 0],
        ]),
      ],
      flat,
    );
    expect(i.trees.find((t) => t.variant === "pine")?.transforms).toHaveLength(2);
    expect(i.bushes).toHaveLength(1);
    // 20 m picket = 3 segments of 6.67 m: backing rail + 8 slats each
    expect(i.fenceRails).toHaveLength(27);
    expect(i.fencePosts).toHaveLength(4);
    const j = featureInstances(
      [
        line("fence", "picket", [
          [0, 0],
          [8, 0],
          [16, 0],
        ]),
      ],
      flat,
    );
    expect(j.fenceRails).toHaveLength(22);
    expect(j.fencePosts).toHaveLength(3);
  });

  // WR-06: rails and hedge boxes run from one end's ground to the other's, like the collider.
  it("on a slope the rail meets both posts and the hedge box sits on the ground line", () => {
    const pts: [number, number][] = [
      [0, 0],
      [8, 0],
    ];
    const f = featureInstances([line("fence", "post-rail", pts, 1.2)], steep);
    expect(f.fenceRails).toHaveLength(1);
    const rail = f.fenceRails[0];
    if (rail === undefined) throw new Error("expected a rail");
    expect(rail.pitch).toBeCloseTo((20 * Math.PI) / 180, 6);
    // post-rail sits 0.7 of the height up each post; posts are seated at steep(x).
    const a = boxPoint(rail, [-rail.lengthM / 2, 0, 0]);
    const b = boxPoint(rail, [rail.lengthM / 2, 0, 0]);
    expect(Math.hypot(a[0] - 0, a[1] - steep(0))).toBeCloseTo(0.84, 6);
    expect(Math.hypot(b[0] - 8, b[1] - steep(8))).toBeCloseTo(0.84, 6);
    expect(f.fencePosts.map((p) => p.y)).toEqual([steep(0), steep(8)]);

    const h = featureInstances([line("hedge", "box", pts, 1.5)], steep).hedges[0];
    if (h === undefined) throw new Error("expected a hedge box");
    const base0 = boxPoint(h, [-h.lengthM / 2, -h.heightM / 2, 0]);
    const base1 = boxPoint(h, [h.lengthM / 2, -h.heightM / 2, 0]);
    expect(base0[1]).toBeCloseTo(steep(base0[0]), 6);
    expect(base1[1]).toBeCloseTo(steep(base1[0]), 6);
    expect(base0[0]).toBeCloseTo(0, 6);
    expect(base1[0]).toBeCloseTo(8, 6);
  });

  it("picket slats stay upright and box counts do not change on a slope", () => {
    const pts: [number, number][] = [
      [0, 0],
      [20, 0],
    ];
    const onFlat = featureInstances([line("fence", "picket", pts)], flat);
    const onSlope = featureInstances([line("fence", "picket", pts)], steep);
    expect(onSlope.fenceRails).toHaveLength(onFlat.fenceRails.length);
    expect(onSlope.fencePosts).toHaveLength(onFlat.fencePosts.length);
    const slats = onSlope.fenceRails.filter((r) => r.lengthM < 1);
    expect(slats.length).toBeGreaterThan(0);
    for (const s of slats) expect(s.pitch).toBe(0);
  });
});

describe("sceneryTriangles", () => {
  const opt = { includeStyleless: false };
  it("counts per catalog part", () => {
    expect(sceneryTriangles([tree("pine")], [], opt)).toBe(15);
    expect(sceneryTriangles([tree("oak", 3)], [], opt)).toBe(30);
    expect(sceneryTriangles([tree("dead")], [], opt)).toBe(10);
    expect(sceneryTriangles([bush()], [], opt)).toBe(20);
    expect(
      sceneryTriangles(
        [
          line("hedge", "box", [
            [0, 0],
            [8, 0],
          ]),
        ],
        [],
        opt,
      ),
    ).toBe(12);
    expect(
      sceneryTriangles(
        [
          line(
            "fence",
            "picket",
            [
              [0, 0],
              [8, 0],
            ],
            3,
          ),
        ],
        [],
        opt,
      ),
    ).toBe(156); // 8 m picket: backing rail + 10 slats + start post + closing post = 13 boxes
    const chain = line("fence", "chainlink", [
      [0, 0],
      [8, 0],
    ]);
    expect(sceneryTriangles([chain], [], opt)).toBe(60); // 3 wires + 2 posts
    expect(
      sceneryTriangles(
        [
          line("fence", "post-rail", [
            [0, 0],
            [8, 0],
          ]),
        ],
        [],
        opt,
      ),
    ).toBe(36);
    const mk = (style?: string): TerrainBuilding => ({
      center: { x: 0, y: 0, z: 0 },
      halfExtents: { x: 1, y: 1, z: 1 },
      rotationY: 0,
      ...(style !== undefined ? { style } : {}),
    });
    expect(sceneryTriangles([], [mk("house")], opt)).toBe(20);
    expect(sceneryTriangles([], [mk("shop")], opt)).toBe(24);
    expect(sceneryTriangles([], [mk()], opt)).toBe(0);
    expect(sceneryTriangles([], [mk()], { includeStyleless: true })).toBe(12);
  });
  it("dense fixture is exactly 37900, under the limit", () => {
    // trees 300x15 + 300x30 + 200x10 = 15,500; bushes 400x20 = 8,000; hedges 300x12 = 3,600;
    // fences 10 lines: 1 post-rail x252 + 3 picket x1,452 + 6 chainlink x492 = 7,560; buildings 90x20 + 60x24 = 3,240; total 37,900
    const n = sceneryTriangles(DENSE_FEATURES, DENSE_BUILDINGS, { includeStyleless: false });
    expect(n).toBe(37900);
    expect(n).toBeLessThanOrEqual(MAX_SCENERY_TRIANGLES);
  });
});

describe("buildingBoxes", () => {
  it("groups by style and gates style-less", () => {
    const b: TerrainBuilding[] = [
      {
        center: { x: 0, y: 1, z: 0 },
        halfExtents: { x: 1, y: 1, z: 1 },
        rotationY: 0,
        style: "shop",
      },
      { center: { x: 5, y: 1, z: 0 }, halfExtents: { x: 1, y: 1, z: 1 }, rotationY: 0 },
    ];
    const without = buildingBoxes(b, { includeStyleless: false });
    expect(Object.keys(without)).toEqual(["shop"]);
    expect(without.shop?.[0]?.roof).toBe("flat");
    const withAll = buildingBoxes(b, { includeStyleless: true });
    expect(withAll[""]).toHaveLength(1);
    expect(withAll[""]?.[0]?.roof).toBe("flat");
  });
});
