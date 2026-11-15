import { describe, expect, it } from "vitest";
import {
  buildingBoxes,
  featureColliders,
  featureInstances,
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
  it("sinks line boxes 0.3 m below the average end height on a slope", () => {
    const c = featureColliders(
      [
        line(
          "hedge",
          "box",
          [
            [0, 0],
            [8, 0],
          ],
          1.5,
        ),
      ],
      slope,
    );
    const b = c[0];
    expect(b?.shape).toBe("cuboid");
    if (b?.shape === "cuboid") {
      const avg = 0.4;
      expect(b.y - b.hy).toBeCloseTo(avg - 0.3, 6);
      expect(b.y + b.hy).toBeCloseTo(avg + 1.5, 6);
    }
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
