import { describe, expect, it } from "vitest";
import { rampLengthM } from "../../src/core/crest-geometry.ts";
import type { RoadGraph } from "../../src/core/road-graph.ts";
import {
  MAX_LINE_FEATURES,
  MAX_POINT_FEATURES,
  parseTerrainSidecar,
  serializeTerrainSidecar,
  type TerrainBuilding,
  type TerrainFeature,
  type TerrainObject,
} from "../../src/core/terrain-format.ts";
import { createTerrainGrid } from "../../src/core/terrain-grid.ts";
import { createPaintMap, PAINT_ROAD_FLAG } from "../../src/core/terrain-paint.ts";
import {
  addLineFeature,
  addPointFeature,
  addRampObject,
  arrowRotateDeg,
  canPlaceAt,
  canPlaceLine,
  deleteBuilding,
  deleteFeature,
  featureIdSeed,
  isEditableBuilding,
  moveFeature,
  nextRampId,
  ON_ROAD_REASON,
  OUTSIDE_AREA_REASON,
  pickFeatureAt,
  pickFeatureByRay,
  removeInMask,
  resolveBuildingIndex,
  rotateFeature,
  scaleFeature,
  scatterPoints,
  seatBuilding,
  updateRamp,
} from "./features.ts";

/** 100 m square at origin (0,0); a road strip over x 40..44 for every z. */
function testArea(withRoad = true) {
  const grid = createTerrainGrid({ rows: 20, cols: 20, cellSizeM: 5, originX: 0, originZ: 0 });
  const paint = createPaintMap({
    originX: 0,
    originZ: 0,
    widthM: 100,
    depthM: 100,
    metresPerPixel: 1,
    fill: "grass",
  });
  if (withRoad) {
    for (let pz = 0; pz < paint.height; pz++) {
      for (let px = 40; px < 44; px++) paint.data[pz * paint.width + px] |= PAINT_ROAD_FLAG;
    }
  }
  return { grid, paint };
}

describe("canPlaceAt / canPlaceLine", () => {
  it("refuses outside the area", () => {
    const a = testArea();
    expect(canPlaceAt(a, -1, 10)).toEqual({ ok: false, reason: OUTSIDE_AREA_REASON });
    expect(canPlaceAt(a, 10, 101)).toEqual({ ok: false, reason: OUTSIDE_AREA_REASON });
  });
  it("refuses on road paint", () => {
    const a = testArea();
    expect(canPlaceAt(a, 41, 10)).toEqual({ ok: false, reason: ON_ROAD_REASON });
    expect(canPlaceAt(a, 10, 10)).toEqual({ ok: true });
  });
  it("never refuses for road on a map with no road paint", () => {
    expect(canPlaceAt(testArea(false), 41, 10)).toEqual({ ok: true });
  });
  it("refuses a line that crosses road even with both ends clear", () => {
    const a = testArea();
    expect(
      canPlaceLine(a, [
        [10, 10],
        [80, 10],
      ]),
    ).toEqual({ ok: false, reason: ON_ROAD_REASON });
    expect(
      canPlaceLine(a, [
        [10, 10],
        [30, 10],
        [30, 60],
      ]).ok,
    ).toBe(true);
  });
  it("refuses a line that leaves the area", () => {
    expect(
      canPlaceLine(testArea(false), [
        [10, 10],
        [10, 120],
      ]),
    ).toEqual({ ok: false, reason: OUTSIDE_AREA_REASON });
  });
});

describe("feature add / edit", () => {
  it("adds point features with f-<seed> ids", () => {
    const r = addPointFeature([], 1, { kind: "tree", variant: "oak", x: 1, z: 2 });
    expect(r.error).toBeUndefined();
    expect(r.features?.[0]).toMatchObject({ id: "f-1", scale: 1, rotationY: 0 });
    expect(r.nextSeed).toBe(2);
  });
  it("refuses at the point limit with the pluralised message", () => {
    const full: TerrainFeature[] = Array.from({ length: MAX_POINT_FEATURES }, (_, i) => ({
      id: `f-${i + 1}`,
      kind: "tree" as const,
      variant: "oak",
      x: i,
      z: 0,
      rotationY: 0,
      scale: 1,
    }));
    const r = addPointFeature(full, 5000, { kind: "tree", variant: "oak", x: 0, z: 0 });
    expect(r.error).toBe("Limit reached: 4000 trees per map. Delete some to place more");
    const b = addPointFeature(full, 5000, { kind: "bush", variant: "round", x: 0, z: 0 });
    expect(b.error).toContain("bushes");
  });
  it("refuses at the line limit and for bad point counts", () => {
    const pts: [number, number][] = [
      [0, 0],
      [5, 0],
    ];
    const full: TerrainFeature[] = Array.from({ length: MAX_LINE_FEATURES }, (_, i) => ({
      id: `f-${i + 1}`,
      kind: "fence" as const,
      variant: "picket",
      points: pts,
      heightM: 1.2,
    }));
    expect(
      addLineFeature(full, 9999, { kind: "fence", variant: "picket", points: pts, heightM: 1.2 })
        .error,
    ).toBe("Limit reached: 500 fences per map. Delete some to place more");
    expect(
      addLineFeature([], 1, { kind: "hedge", variant: "box", points: [[0, 0]], heightM: 1.5 })
        .error,
    ).toBe("A line needs at least 2 points");
    const many = Array.from({ length: 65 }, (_, i) => [i, 0] as [number, number]);
    expect(
      addLineFeature([], 1, { kind: "hedge", variant: "box", points: many, heightM: 1.5 }).error,
    ).toBe("A line can have at most 64 points");
  });
  it("featureIdSeed scans f-<n> and never reuses after delete", () => {
    const a = addPointFeature([], 1, { kind: "tree", variant: "oak", x: 0, z: 0 });
    const b = addPointFeature(a.features ?? [], a.nextSeed ?? 0, {
      kind: "bush",
      variant: "round",
      x: 1,
      z: 1,
    });
    const afterDelete = deleteFeature(b.features ?? [], "f-2");
    expect(featureIdSeed(afterDelete)).toBe(2);
    expect(b.nextSeed).toBe(3);
    expect(featureIdSeed([])).toBe(1);
  });
  it("move, rotate, scale, delete return new arrays; unknown id keeps the reference", () => {
    const line: TerrainFeature = {
      id: "f-1",
      kind: "hedge",
      variant: "box",
      points: [
        [0, 0],
        [10, 0],
      ],
      heightM: 1.5,
    };
    const tree: TerrainFeature = {
      id: "f-2",
      kind: "tree",
      variant: "oak",
      x: 5,
      z: 5,
      rotationY: 0,
      scale: 1,
    };
    const list = [line, tree];
    const moved = moveFeature(list, "f-1", 2, 3);
    expect(moved).not.toBe(list);
    expect((moved[0] as { points: unknown }).points).toEqual([
      [2, 3],
      [12, 3],
    ]);
    expect((list[0] as { points: unknown }).points).toEqual([
      [0, 0],
      [10, 0],
    ]);
    expect(moveFeature(list, "f-2", 1, 1)[1]).toMatchObject({ x: 6, z: 6 });
    expect(rotateFeature(list, "f-2", 1.5)[1]).toMatchObject({ rotationY: 1.5 });
    expect(scaleFeature(list, "f-2", 9)[1]).toMatchObject({ scale: 2 });
    expect(scaleFeature(list, "f-2", 0.1)[1]).toMatchObject({ scale: 0.5 });
    expect(moveFeature(list, "nope", 1, 1)).toBe(list);
    expect(rotateFeature(list, "nope", 1)).toBe(list);
    expect(scaleFeature(list, "nope", 1)).toBe(list);
    expect(deleteFeature(list, "nope")).toBe(list);
    expect(deleteFeature(list, "f-1")).toHaveLength(1);
  });
});

describe("seatBuilding", () => {
  const slope = (x: number) => x * 0.1; // rises 0.1 m per metre in x
  it("tops the high corner and sinks below the low corner", () => {
    const r = seatBuilding((x) => slope(x), {
      x: 10,
      z: 0,
      widthM: 10,
      depthM: 4,
      heightM: 3,
      rotationY: 0,
    });
    const b = r.building as TerrainBuilding;
    const top = b.center.y + b.halfExtents.y;
    const bottom = b.center.y - b.halfExtents.y;
    expect(top).toBeCloseTo(slope(15) + 3);
    expect(bottom).toBeCloseTo(slope(5) - 0.3);
    expect(b.halfExtents.x).toBe(5);
    expect(b.halfExtents.z).toBe(2);
  });
  it("keeps the style", () => {
    const r = seatBuilding(() => 0, {
      x: 0,
      z: 0,
      widthM: 4,
      depthM: 3,
      heightM: 2.5,
      rotationY: 0,
      style: "shed",
    });
    expect(r.building?.style).toBe("shed");
  });
  it("rejects too-small footprints", () => {
    const r = seatBuilding(() => 0, {
      x: 0,
      z: 0,
      widthM: 0.5,
      depthM: 4,
      heightM: 3,
      rotationY: 0,
    });
    expect(r.error).toBe("Building too small, drag a larger footprint");
  });
});

describe("addRampObject", () => {
  const params = { heightM: 2, angleDeg: 15, widthM: 8 };
  it("gives unique ramp-N ids that do not collide with existing crest ids", () => {
    const existing: TerrainObject[] = [
      { kind: "crest", crest: { id: "ramp-1", centerX: 0, centerZ: 0, radiusM: 10, heightM: 1 } },
      { kind: "crest", crest: { id: "ramp-3", centerX: 0, centerZ: 0, radiusM: 10, heightM: 1 } },
    ];
    expect(nextRampId(existing)).toBe("ramp-4");
    const out = addRampObject(existing, 5, 6, 1, params);
    expect(out).toHaveLength(3);
    expect(out[2]?.crest.id).toBe("ramp-4");
    expect(addRampObject([], 0, 0, 0, params)[0]?.crest.id).toBe("ramp-1");
  });
  it("produces an ordinary ramp crest that parseTerrainSidecar accepts", () => {
    const objects = addRampObject(addRampObject([], 10, 10, 0.3, params), 40, 10, 1.2, params);
    const graph = {
      schemaVersion: 1,
      areaId: "t",
      name: "t",
      source: {
        osmExtract: "none",
        osmSnapshot: "2026-01-01T00:00:00Z",
        demSource: "none-flat-authored",
        compilerVersion: "0.0.0",
      },
      attribution: { osm: "o", osmLicense: "ODbL-1.0", osmLicenseUrl: "https://x", dem: "d" },
      origin: { lat: 0, lon: 0, projection: "enu" },
      bounds: { minX: 0, minZ: 0, maxX: 10, maxZ: 10 },
      nodes: [],
      edges: [],
    } as unknown as RoadGraph;
    const text = serializeTerrainSidecar({
      areaId: "t",
      name: "t",
      groundSurface: "grass",
      legacyGlbBuildings: false,
      nextEdgeId: 0,
      graph,
      objects,
      buildings: [],
    });
    const parsed = parseTerrainSidecar(text, "t", "test");
    expect(parsed.objects.map((o) => o.crest.id)).toEqual(["ramp-1", "ramp-2"]);
    expect(parsed.objects[0]?.crest.ramp?.footRadiusM).toBeGreaterThan(0);
  });
});

describe("scatterPoints", () => {
  const spec = { cx: 50, cz: 50, radiusM: 10, densityPer100m2: 4, seed: 42 };
  it("is deterministic for a seed and bounded to the circle", () => {
    const a = scatterPoints(spec);
    const b = scatterPoints(spec);
    expect(a).toEqual(b);
    expect(a).toHaveLength(Math.round(((Math.PI * 100) / 100) * 4));
    for (const p of a) expect(Math.hypot(p.x - 50, p.z - 50)).toBeLessThanOrEqual(10 + 1e-9);
    expect(scatterPoints({ ...spec, seed: 43 })).not.toEqual(a);
  });
});

describe("removeInMask", () => {
  it("removes points, lines with any vertex inside, and buildings by centre", () => {
    const features: TerrainFeature[] = [
      { id: "f-1", kind: "tree", variant: "oak", x: 5, z: 5, rotationY: 0, scale: 1 },
      { id: "f-2", kind: "tree", variant: "oak", x: 50, z: 50, rotationY: 0, scale: 1 },
      {
        id: "f-3",
        kind: "fence",
        variant: "picket",
        points: [
          [0, 0],
          [90, 90],
        ],
        heightM: 1.2,
      },
    ];
    const buildings: TerrainBuilding[] = [
      { center: { x: 6, y: 0, z: 6 }, halfExtents: { x: 2, y: 2, z: 2 }, rotationY: 0 },
      { center: { x: 70, y: 0, z: 70 }, halfExtents: { x: 2, y: 2, z: 2 }, rotationY: 0 },
    ];
    const inMask = (x: number, z: number) => x < 20 && z < 20;
    const r = removeInMask(features, buildings, inMask);
    expect(r.features.map((f) => f.id)).toEqual(["f-2"]);
    expect(r.buildings).toHaveLength(1);
    expect(r.removedFeatures).toBe(2);
    expect(r.removedBuildings).toBe(1);
    const none = removeInMask(features, buildings, () => false);
    expect(none.features).toBe(features);
    expect(none.buildings).toBe(buildings);
  });
});

// CR-01: on a legacy GLB map the style-less boxes are collision for meshes baked into the map
// model, so no editor path may pick, delete or bulk-delete them. Styled buildings stay editable.
describe("legacy GLB buildings are read-only", () => {
  const legacyBox: TerrainBuilding = {
    center: { x: 10, y: 2, z: 10 },
    halfExtents: { x: 3, y: 2, z: 3 },
    rotationY: 0,
  };
  const styled: TerrainBuilding = {
    center: { x: 30, y: 2, z: 10 },
    halfExtents: { x: 3, y: 2, z: 3 },
    rotationY: 0,
    style: "shed",
  };
  const buildings = [legacyBox, styled];
  const down = (x: number, z: number) => ({ ox: x, oy: 50, oz: z, dx: 0, dy: -1, dz: 0 });

  it("isEditableBuilding is false only for a style-less box on a legacy map", () => {
    expect(isEditableBuilding(legacyBox, true)).toBe(false);
    expect(isEditableBuilding(styled, true)).toBe(true);
    expect(isEditableBuilding(legacyBox, false)).toBe(true);
    expect(isEditableBuilding(styled, false)).toBe(true);
  });

  it("ground and ray picks skip the legacy box and still hit the styled one", () => {
    expect(pickFeatureAt([], buildings, [], 10, 10, 1.5, true)).toBeUndefined();
    expect(pickFeatureAt([], buildings, [], 30, 10, 1.5, true)).toEqual({
      kind: "building",
      index: 1,
    });
    const flat = () => 0;
    const ground = { x: 10, z: 10 };
    expect(pickFeatureByRay([], buildings, [], flat, down(10, 10), ground, 1.5, true)).toBe(
      undefined,
    );
    expect(
      pickFeatureByRay([], buildings, [], flat, down(30, 10), { x: 30, z: 10 }, 1.5, true),
    ).toEqual({ kind: "building", index: 1 });
    // The same box on an ordinary map is an editor-drawn building and stays pickable.
    expect(pickFeatureByRay([], buildings, [], flat, down(10, 10), ground, 1.5)).toEqual({
      kind: "building",
      index: 0,
    });
  });

  it("delete and box delete keep the legacy box", () => {
    expect(deleteBuilding(buildings, 0, true)).toBe(buildings);
    expect(deleteBuilding(buildings, 1, true)).toEqual([legacyBox]);
    expect(deleteBuilding(buildings, 0)).toEqual([styled]);
    const all = removeInMask([], buildings, () => true, true);
    expect(all.buildings).toEqual([legacyBox]);
    expect(all.removedBuildings).toBe(1);
    const onlyLegacy = removeInMask([], [legacyBox], () => true, true);
    expect(onlyLegacy.buildings).toHaveLength(1);
    expect(onlyLegacy.removedBuildings).toBe(0);
  });
});

describe("pickFeatureAt", () => {
  const features: TerrainFeature[] = [
    { id: "f-1", kind: "tree", variant: "oak", x: 10, z: 10, rotationY: 0, scale: 1 },
    {
      id: "f-2",
      kind: "hedge",
      variant: "box",
      points: [
        [20, 0],
        [20, 30],
      ],
      heightM: 1.5,
    },
  ];
  const buildings: TerrainBuilding[] = [
    { center: { x: 60, y: 0, z: 60 }, halfExtents: { x: 5, y: 2, z: 2 }, rotationY: Math.PI / 2 },
  ];
  const objects = addRampObject([], 80, 10, 0, { heightM: 2, angleDeg: 15, widthM: 8 });
  it("picks points, lines, buildings and ramps", () => {
    expect(pickFeatureAt(features, buildings, objects, 11, 10, 2)).toEqual({
      kind: "feature",
      id: "f-1",
    });
    expect(pickFeatureAt(features, buildings, objects, 21, 15, 2)).toEqual({
      kind: "feature",
      id: "f-2",
    });
    // Rotated 90 deg: the long axis runs along z.
    expect(pickFeatureAt(features, buildings, objects, 60, 64, 1)).toEqual({
      kind: "building",
      index: 0,
    });
    expect(pickFeatureAt(features, buildings, objects, 64, 60, 1)).toBeUndefined();
    expect(pickFeatureAt(features, buildings, objects, 80, 11, 2)).toEqual({
      kind: "ramp",
      id: "ramp-1",
    });
  });
  it("returns undefined when nothing is near", () => {
    expect(pickFeatureAt(features, buildings, objects, 40, 40, 2)).toBeUndefined();
  });
  it("prefers the nearest", () => {
    const two: TerrainFeature[] = [
      { id: "a", kind: "bush", variant: "round", x: 0, z: 0, rotationY: 0, scale: 1 },
      { id: "b", kind: "bush", variant: "round", x: 1, z: 0, rotationY: 0, scale: 1 },
    ];
    expect(pickFeatureAt(two, [], [], 0.9, 0, 3)).toEqual({ kind: "feature", id: "b" });
  });
});

describe("pickFeatureByRay", () => {
  const flat = () => 0;
  const tree: TerrainFeature = {
    id: "t1",
    kind: "tree",
    variant: "oak",
    x: 0,
    z: 0,
    rotationY: 0,
    scale: 1,
  };
  const hedge: TerrainFeature = {
    id: "h1",
    kind: "hedge",
    variant: "box",
    points: [
      [20, -5],
      [20, 5],
    ],
    heightM: 2,
  };
  // Helicopter-style ray: from above and to the south, aimed at a point in the canopy.
  const toward = (x: number, y: number, z: number) => ({
    ox: x,
    oy: y + 40,
    oz: z + 40,
    dx: 0,
    dy: -40,
    dz: -40,
  });

  it("selects a tree by clicking its canopy, away from its trunk base", () => {
    // Canopy top (y 8) is hit well before the ground behind it, which is ~8 m north of the trunk.
    const ray = toward(0, 8, 0);
    const ground = { x: 0, z: -8 };
    expect(pickFeatureByRay([tree], [], [], flat, ray, ground, 1.5)).toEqual({
      kind: "feature",
      id: "t1",
    });
    // The old ground-distance test misses from that ground point.
    expect(pickFeatureAt([tree], [], [], ground.x, ground.z, 1.5)).toBeUndefined();
  });

  it("selects a hedge by clicking along its height", () => {
    const ray = toward(20, 1.8, 0);
    expect(pickFeatureByRay([hedge], [], [], flat, ray, { x: 20, z: -2 }, 1.5)).toEqual({
      kind: "feature",
      id: "h1",
    });
  });

  it("falls back to the ground test, and returns undefined on a clean miss", () => {
    const ray = toward(50, 0, 50);
    expect(pickFeatureByRay([tree], [], [], flat, ray, { x: 1, z: 0 }, 1.5)).toEqual({
      kind: "feature",
      id: "t1",
    });
    expect(pickFeatureByRay([tree], [], [], flat, ray, { x: 50, z: 50 }, 1.5)).toBeUndefined();
    expect(pickFeatureByRay([tree], [], [], flat, ray, null, 1.5)).toBeUndefined();
  });

  it("picks the nearer of two overlapping items along the ray", () => {
    const front: TerrainFeature = { ...tree, id: "front", z: 10 };
    const ray = { ox: 0, oy: 3, oz: 40, dx: 0, dy: 0, dz: -1 };
    expect(pickFeatureByRay([tree, front], [], [], flat, ray, null, 1.5)).toEqual({
      kind: "feature",
      id: "front",
    });
  });
});

describe("pickFeatureByRay ramps", () => {
  const flat = () => 0;
  const objects = addRampObject([], 10, 10, 0, { heightM: 2, angleDeg: 20, widthM: 10 });
  const crest = objects[0]?.crest;
  const len = crest?.ramp ? rampLengthM(crest.heightM, crest.ramp) : 0;
  const toward = (x: number, y: number, z: number) => ({
    ox: x,
    oy: y + 40,
    oz: z + 40,
    dx: 0,
    dy: -40,
    dz: -40,
  });
  it("picks a ramp by its middle and by its top end, not only its start", () => {
    expect(len).toBeGreaterThan(4);
    const mid = toward(10 + len / 2, 0.5, 10);
    expect(pickFeatureByRay([], [], objects, flat, mid, null, 1.5)).toEqual({
      kind: "ramp",
      id: "ramp-1",
    });
    const top = toward(10 + len - 0.3, 1.8, 10);
    expect(pickFeatureByRay([], [], objects, flat, top, null, 1.5)).toEqual({
      kind: "ramp",
      id: "ramp-1",
    });
  });
  it("ground pick covers the whole footprint and misses beside it", () => {
    expect(pickFeatureAt([], [], objects, 10 + len * 0.8, 12, 0.5)).toEqual({
      kind: "ramp",
      id: "ramp-1",
    });
    expect(pickFeatureAt([], [], objects, 10 + len * 0.5, 30, 0.5)).toBeUndefined();
  });
});

// WR-04: buildings have no id, so the selection follows the object, never just the index.
describe("resolveBuildingIndex", () => {
  const b = (x: number, style?: string): TerrainBuilding => ({
    center: { x, y: 2, z: 10 },
    halfExtents: { x: 3, y: 2, z: 3 },
    rotationY: 0,
    ...(style !== undefined ? { style } : {}),
  });
  const b0 = b(0);
  const b1 = b(20);
  const b2 = b(40);

  it("keeps the index while the same object is there", () => {
    expect(resolveBuildingIndex([b0, b1, b2], 1, b1)).toBe(1);
  });

  it("follows the building when undo puts an earlier one back", () => {
    // b1 was deleted, b2 was selected at index 1, then Ctrl+Z restored b1.
    const afterDelete = deleteBuilding([b0, b1, b2], 1);
    expect(resolveBuildingIndex(afterDelete, 1, b2)).toBe(1);
    expect(resolveBuildingIndex([b0, b1, b2], 1, b2)).toBe(2);
  });

  it("follows the building when a delete in front shifts it down", () => {
    expect(resolveBuildingIndex([b1, b2], 2, b2)).toBe(1);
  });

  it("is -1 when the building is gone, never the one that took its index", () => {
    expect(resolveBuildingIndex([b0, b2], 1, b1)).toBe(-1);
    expect(resolveBuildingIndex([b0], 1, b1)).toBe(-1);
    expect(resolveBuildingIndex([], 0, b0)).toBe(-1);
  });

  it("keeps a building a sculpt re-seated in place (only its height changed)", () => {
    const styled = b(20, "shed");
    const reseated: TerrainBuilding = {
      ...styled,
      center: { ...styled.center, y: 5 },
      halfExtents: { ...styled.halfExtents, y: 3 },
    };
    expect(resolveBuildingIndex([b0, reseated], 1, styled)).toBe(1);
    // Undoing a move puts a building with another position at the index: not the same one.
    const moved: TerrainBuilding = { ...styled, center: { ...styled.center, x: 25 } };
    expect(resolveBuildingIndex([b0, moved], 1, styled)).toBe(-1);
  });
});

describe("arrowRotateDeg", () => {
  it("Left and Right turn 15 degrees, Shift makes it 1 degree", () => {
    expect(arrowRotateDeg("ArrowLeft", false)).toBe(15);
    expect(arrowRotateDeg("ArrowRight", false)).toBe(-15);
    expect(arrowRotateDeg("ArrowLeft", true)).toBe(1);
    expect(arrowRotateDeg("ArrowRight", true)).toBe(-1);
  });
  it("ignores every other key", () => {
    expect(arrowRotateDeg("ArrowUp", false)).toBeUndefined();
    expect(arrowRotateDeg("BracketRight", true)).toBeUndefined();
  });
});

describe("updateRamp", () => {
  const objects = addRampObject([], 10, 10, 0, { heightM: 2, angleDeg: 20, widthM: 10 });
  it("changes height, angle, width and heading and keeps the foot radius", () => {
    const r = updateRamp(objects, "ramp-1", {
      heightM: 3,
      angleDeg: 30,
      widthM: 12,
      headingRad: 1,
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      const c = r.objects[0]?.crest;
      expect(c?.heightM).toBe(3);
      expect(c?.ramp).toEqual({ headingRad: 1, widthM: 12, angleDeg: 30, footRadiusM: 150 });
      expect(c?.centerX).toBe(10);
    }
    expect(objects[0]?.crest.heightM).toBe(2); // input untouched
  });
  it("refuses an unknown id", () => {
    expect(updateRamp(objects, "nope", { heightM: 3 }).ok).toBe(false);
  });
});
