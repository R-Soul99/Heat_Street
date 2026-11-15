import { describe, expect, it } from "vitest";
import {
  BUILDING_STYLES,
  BUSH_VARIANTS,
  FENCE_VARIANTS,
  HEDGE_VARIANTS,
  resolveBuildingStyle,
  resolveVariant,
  SCENERY_KINDS,
  SCENERY_SOLIDITY,
  SCENERY_TRIANGLES,
  solidityOf,
  TREE_VARIANTS,
} from "../src/core/scenery-catalog.ts";

const ids = (a: readonly { id: string }[]) => a.map((v) => v.id);
const colourOk = (c: number) =>
  Number.isInteger(c) && c >= 0 && c <= 0xffffff && c !== 0 && c !== 0xffffff;

describe("scenery catalog", () => {
  it("lists kinds and unique variant ids", () => {
    expect([...SCENERY_KINDS]).toEqual(["tree", "bush", "hedge", "fence"]);
    expect(ids(TREE_VARIANTS)).toEqual(["pine", "oak", "dead"]);
    expect(ids(BUSH_VARIANTS)).toEqual(["round", "scrub"]);
    expect(ids(HEDGE_VARIANTS)).toEqual(["box"]);
    expect(ids(FENCE_VARIANTS)).toEqual(["post-rail", "picket", "chainlink"]);
    expect(ids(BUILDING_STYLES)).toEqual(["shed", "house", "barn", "shop", "block"]);
  });

  it("resolves known ids and rejects hostile ones", () => {
    expect(resolveVariant("tree", "oak")?.id).toBe("oak");
    for (const bad of ["__proto__", "toString", "constructor"]) {
      expect(resolveVariant("tree", bad)).toBeUndefined();
      expect(resolveBuildingStyle(bad)).toBeUndefined();
    }
    expect(resolveVariant("bush", "pine")).toBeUndefined();
    expect(resolveBuildingStyle("house")?.id).toBe("house");
  });

  it("has sane sizes and colours", () => {
    for (const t of TREE_VARIANTS) {
      const h = t.trunkHeightM + t.canopy.heightM;
      expect(h).toBeGreaterThanOrEqual(2);
      expect(h).toBeLessThanOrEqual(15);
      expect(t.trunkRadiusM).toBeGreaterThan(0);
      expect(colourOk(t.trunkColor) && colourOk(t.canopyColor)).toBe(true);
    }
    for (const b of BUSH_VARIANTS) {
      expect(b.radiusM).toBeGreaterThan(0);
      expect(b.heightM).toBeGreaterThan(0);
      expect(colourOk(b.color)).toBe(true);
    }
    for (const v of [...HEDGE_VARIANTS, ...FENCE_VARIANTS]) {
      expect(v.minHeightM).toBeGreaterThanOrEqual(1.0);
      expect(v.defaultHeightM).toBeGreaterThanOrEqual(v.minHeightM);
      expect(v.defaultHeightM).toBeLessThanOrEqual(6);
      expect(colourOk(v.color)).toBe(true);
    }
    for (const s of BUILDING_STYLES) {
      for (const n of [s.defaultWidthM, s.defaultDepthM, s.defaultHeightM]) {
        expect(Number.isFinite(n) && n > 0).toBe(true);
      }
      expect(colourOk(s.wallColor) && colourOk(s.roofColor)).toBe(true);
    }
    for (const f of FENCE_VARIANTS) expect("postSpacingM" in f).toBe(false);
  });

  it("encodes D-10 solidity", () => {
    expect(solidityOf("tree")).toEqual({ kind: "tree", solid: true, blocksSight: false });
    expect(solidityOf("bush")).toEqual({ kind: "bush", solid: false, blocksSight: false });
    expect(solidityOf("hedge")).toEqual({ kind: "hedge", solid: true, blocksSight: true });
    expect(solidityOf("fence")).toEqual({ kind: "fence", solid: true, blocksSight: false });
    expect(solidityOf("building")).toEqual({ kind: "building", solid: true, blocksSight: true });
  });

  it("freezes the tables", () => {
    for (const t of [
      TREE_VARIANTS,
      BUSH_VARIANTS,
      HEDGE_VARIANTS,
      FENCE_VARIANTS,
      BUILDING_STYLES,
      SCENERY_SOLIDITY,
      SCENERY_TRIANGLES,
    ]) {
      expect(Object.isFrozen(t)).toBe(true);
    }
  });

  it("holds the D-09 triangle contract", () => {
    expect({ ...SCENERY_TRIANGLES }).toEqual({
      trunk: 10,
      coneCanopy: 5,
      sphereCanopy: 20,
      bush: 20,
      unitBox: 12,
      buildingWalls: 12,
      pitchedRoof: 8,
      flatRoof: 12,
    });
    const T = SCENERY_TRIANGLES;
    expect(T.trunk + T.coneCanopy).toBe(15);
    expect(T.trunk + T.sphereCanopy).toBe(30);
    expect(T.trunk).toBe(10);
    expect(T.bush).toBe(20);
    expect(T.unitBox).toBe(12);
    expect(T.unitBox * 2).toBe(24);
    expect(T.buildingWalls + T.pitchedRoof).toBe(20);
    expect(T.buildingWalls + T.flatRoof).toBe(24);
    expect(T.buildingWalls).toBe(12);
  });
});
