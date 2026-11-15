import { describe, expect, it } from "vitest";
import { sceneryTriangles } from "../../src/core/scenery-geometry.ts";
import type {
  TerrainBuilding,
  TerrainFeature,
  TerrainObject,
} from "../../src/core/terrain-format.ts";
import { createTerrainGrid, sampleTerrainHeight } from "../../src/core/terrain-grid.ts";
import { createPaintMap, PAINT_ROAD_FLAG } from "../../src/core/terrain-paint.ts";
import { DENSE_BUILDINGS, DENSE_FEATURES } from "../../tests/fixtures/dense-scenery.ts";
import { addRampObject, ON_ROAD_REASON, OUTSIDE_AREA_REASON } from "./features.ts";
import {
  BUDGET_REASON,
  canPlaceRampAt,
  checkSceneryBudget,
  fitScatterToBudget,
  moveSceneryItem,
  NOTHING_SELECTED,
  reseatBuildingsAfterSculpt,
  type SceneryArea,
} from "./scenery-guards.ts";

function oak(i: number): TerrainFeature {
  return { id: `n-${i}`, kind: "tree", variant: "oak", x: i, z: 0, rotationY: 0, scale: 1 };
}

function denseArea(): SceneryArea {
  const grid = createTerrainGrid({ rows: 4, cols: 4, cellSizeM: 5, originX: 0, originZ: 0 });
  const paint = createPaintMap({
    originX: 0,
    originZ: 0,
    widthM: 20,
    depthM: 20,
    metresPerPixel: 1,
    fill: "grass",
  });
  return { grid, paint, features: DENSE_FEATURES, buildings: DENSE_BUILDINGS };
}

describe("checkSceneryBudget", () => {
  it("allows exactly 40,000 and refuses beyond", () => {
    const area = denseArea();
    const more = (n: number) => [...DENSE_FEATURES, ...Array.from({ length: n }, (_, i) => oak(i))];
    const at = checkSceneryBudget(area, { features: more(70) });
    expect(at).toEqual({ ok: true, triangles: 40000 });
    const over = checkSceneryBudget(area, { features: more(71) });
    expect(over.ok).toBe(false);
    if (!over.ok) expect(over.reason).toBe(BUDGET_REASON);
  });
  it("refuses a 2-segment fence on a 39,950 map", () => {
    const base = denseArea();
    // 37,900 + 65 oak (1,950) + 5 bush (100) = 39,950.
    const bush = (i: number): TerrainFeature => ({
      id: `b-${i}`,
      kind: "bush",
      variant: "round",
      x: i,
      z: 1,
      rotationY: 0,
      scale: 1,
    });
    const filler: TerrainFeature[] = [
      ...Array.from({ length: 65 }, (_, i) => oak(i)),
      ...Array.from({ length: 5 }, (_, i) => bush(i)),
    ];
    const area: SceneryArea = { ...base, features: [...DENSE_FEATURES, ...filler] };
    expect(
      sceneryTriangles(area.features ?? [], area.buildings ?? [], { includeStyleless: true }),
    ).toBe(39950);
    const fence: TerrainFeature = {
      id: "fx",
      kind: "fence",
      variant: "picket",
      points: [
        [0, 0],
        [8, 0],
        [16, 0],
      ],
      heightM: 1.2,
    };
    const r = checkSceneryBudget(area, { features: [...(area.features ?? []), fence] });
    expect(r.ok).toBe(false);
  });
  it("never refuses a delete or a move on a map already over budget", () => {
    const area = denseArea();
    const over = [...DENSE_FEATURES, ...Array.from({ length: 200 }, (_, i) => oak(i))];
    const overArea: SceneryArea = { ...area, features: over };
    const fewer = over.slice(0, over.length - 5);
    expect(checkSceneryBudget(overArea, { features: fewer }).ok).toBe(true);
    // A move keeps the same triangle count.
    expect(checkSceneryBudget(overArea, { features: [...over] }).ok).toBe(true);
  });
});

describe("fitScatterToBudget", () => {
  it("keeps 70 of 100 oaks with 2,100 triangles of headroom", () => {
    const area = denseArea();
    const cand = Array.from({ length: 100 }, (_, i) => oak(i));
    const r = fitScatterToBudget(area, cand);
    expect(r.accepted).toHaveLength(70);
    expect(r.skipped).toBe(30);
  });
  it("accepts none with no headroom", () => {
    const area = denseArea();
    const full: SceneryArea = {
      ...area,
      features: [...DENSE_FEATURES, ...Array.from({ length: 70 }, (_, i) => oak(500 + i))],
    };
    const r = fitScatterToBudget(full, [oak(1), oak(2)]);
    expect(r.accepted).toHaveLength(0);
    expect(r.skipped).toBe(2);
  });
});

/** 100 m flat area, road strip at x 40..44. */
function moveArea(extra: Partial<SceneryArea>): SceneryArea {
  const grid = createTerrainGrid({ rows: 20, cols: 20, cellSizeM: 5, originX: 0, originZ: 0 });
  const paint = createPaintMap({
    originX: 0,
    originZ: 0,
    widthM: 100,
    depthM: 100,
    metresPerPixel: 1,
    fill: "grass",
  });
  for (let pz = 0; pz < paint.height; pz++) {
    for (let px = 40; px < 44; px++) paint.data[pz * paint.width + px] |= PAINT_ROAD_FLAG;
  }
  return { grid, paint, ...extra };
}

describe("moveSceneryItem", () => {
  const tree: TerrainFeature = {
    id: "f-1",
    kind: "tree",
    variant: "oak",
    x: 30,
    z: 30,
    rotationY: 0,
    scale: 1,
  };
  const line: TerrainFeature = {
    id: "f-2",
    kind: "fence",
    variant: "picket",
    points: [
      [10, 60],
      [30, 60],
    ],
    heightM: 1.2,
  };

  it("refuses moving a tree onto road paint", () => {
    const area = moveArea({ features: [tree] });
    const r = moveSceneryItem(area, { kind: "feature", id: "f-1" }, 12, 0);
    expect(r).toEqual({ ok: false, reason: ON_ROAD_REASON });
  });
  it("refuses moving a line so a sample crosses road", () => {
    const area = moveArea({ features: [line] });
    const r = moveSceneryItem(area, { kind: "feature", id: "f-2" }, 20, 0);
    expect(r).toEqual({ ok: false, reason: ON_ROAD_REASON });
  });
  it("applies a valid move without touching the inputs", () => {
    const features = [tree, line];
    const area = moveArea({ features });
    const r = moveSceneryItem(area, { kind: "feature", id: "f-1" }, -5, 5);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.features?.[0]).toMatchObject({ x: 25, z: 35 });
    expect(features[0]).toMatchObject({ x: 30, z: 30 });
  });
  it("refuses an unknown selection", () => {
    const area = moveArea({ features: [tree] });
    expect(moveSceneryItem(area, { kind: "feature", id: "zzz" }, 1, 1)).toEqual({
      ok: false,
      reason: NOTHING_SELECTED,
    });
    expect(moveSceneryItem(area, { kind: "building", index: 3 }, 1, 1)).toEqual({
      ok: false,
      reason: NOTHING_SELECTED,
    });
  });
  it("refuses a building whose rotated corner reaches the road", () => {
    const b: TerrainBuilding = {
      center: { x: 30, y: 2, z: 30 },
      halfExtents: { x: 4, y: 2, z: 4 },
      rotationY: Math.PI / 4,
      style: "shed",
    };
    const area = moveArea({ buildings: [b] });
    // Centre at x=34 is clear, but a 45 degree corner reaches x ~ 39.7... push closer.
    const r = moveSceneryItem(area, { kind: "building", index: 0 }, 8, 0);
    expect(r.ok).toBe(false);
    const ok = moveSceneryItem(area, { kind: "building", index: 0 }, -10, 0);
    expect(ok.ok).toBe(true);
  });
  it("re-seats a moved styled building keeping its visible height", () => {
    const area = moveArea({
      buildings: [
        {
          center: { x: 20, y: 1.1, z: 20 },
          halfExtents: { x: 2, y: 1.4, z: 2 },
          rotationY: 0,
          style: "shed",
        },
      ],
    });
    // flat zero grid: visible = 1.1 + 1.4 - 0 = 2.5
    const r = moveSceneryItem(area, { kind: "building", index: 0 }, 5, 0);
    expect(r.ok).toBe(true);
    if (r.ok) {
      const b = r.buildings?.[0] as TerrainBuilding;
      expect(b.center.x).toBe(25);
      expect(b.center.y + b.halfExtents.y).toBeCloseTo(2.5);
      expect(b.center.y - b.halfExtents.y).toBeCloseTo(-0.3);
    }
  });
  it("moves a ramp freely over road but not out of the area", () => {
    const objects: TerrainObject[] = addRampObject([], 30, 30, 0, {
      heightM: 2,
      angleDeg: 15,
      widthM: 8,
    });
    const area = moveArea({ objects });
    const onRoad = moveSceneryItem(area, { kind: "ramp", id: "ramp-1" }, 12, 0);
    expect(onRoad.ok).toBe(true);
    if (onRoad.ok) expect(onRoad.objects?.[0]?.crest.centerX).toBe(42);
    const off = moveSceneryItem(area, { kind: "ramp", id: "ramp-1" }, 200, 0);
    expect(off).toEqual({ ok: false, reason: OUTSIDE_AREA_REASON });
    expect(canPlaceRampAt(area, 41, 10)).toEqual({ ok: true });
    expect(canPlaceRampAt(area, -5, 10)).toEqual({ ok: false, reason: OUTSIDE_AREA_REASON });
  });
});

describe("reseatBuildingsAfterSculpt", () => {
  const flat = () => 0;
  const raised = () => 2;
  const win = { minX: 0, minZ: 0, maxX: 100, maxZ: 100 };
  const styled: TerrainBuilding = {
    center: { x: 20, y: 1.1, z: 20 },
    halfExtents: { x: 3, y: 1.4, z: 3 },
    rotationY: 0,
    style: "shed",
  };
  const legacy: TerrainBuilding = {
    center: { x: 30, y: 1, z: 30 },
    halfExtents: { x: 3, y: 1, z: 3 },
    rotationY: 0,
  };

  it("raises top and bottom by exactly the terrain rise, visible height unchanged", () => {
    const out = reseatBuildingsAfterSculpt([styled, legacy], flat, raised, win);
    const b = out[0] as TerrainBuilding;
    expect(b.center.y + b.halfExtents.y).toBeCloseTo(styled.center.y + styled.halfExtents.y + 2);
    expect(b.center.y - b.halfExtents.y).toBeCloseTo(styled.center.y - styled.halfExtents.y + 2);
    expect(out[1]).toBe(legacy);
  });
  it("keeps identity for buildings outside the window and when nothing changed", () => {
    const list = [styled, legacy];
    expect(reseatBuildingsAfterSculpt(list, flat, raised, { ...win, minX: 50 })).toBe(list);
    expect(reseatBuildingsAfterSculpt(list, flat, flat, win)).toBe(list);
  });
  it("works against a real grid", () => {
    const grid = createTerrainGrid({ rows: 20, cols: 20, cellSizeM: 5, originX: 0, originZ: 0 });
    const before = (x: number, z: number) => sampleTerrainHeight(grid, x, z);
    const out = reseatBuildingsAfterSculpt([styled], before, before, win);
    expect(out[0]).toBe(styled);
  });
});
