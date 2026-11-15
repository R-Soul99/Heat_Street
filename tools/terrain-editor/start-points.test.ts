import { describe, expect, it } from "vitest";
import type { TerrainStartPoint } from "../../src/core/terrain-format.ts";
import {
  addStartPoint,
  defaultStartPoint,
  makeDefault,
  moveStartPoint,
  removeStartPoint,
  renameStartPoint,
  startIdSeed,
  turnStartPoint,
} from "./start-points.ts";

const sp = (n: number): TerrainStartPoint => ({
  id: `start-${n}`,
  name: `Start ${n}`,
  x: n,
  z: n * 2,
  headingRad: 0,
});

describe("startIdSeed", () => {
  it("is 1 for empty and max+1 otherwise, ignoring odd ids", () => {
    expect(startIdSeed([])).toBe(1);
    expect(startIdSeed([sp(2), sp(7)])).toBe(8);
    expect(startIdSeed([{ ...sp(1), id: "start-x" }, sp(3)])).toBe(4);
  });
});

describe("addStartPoint", () => {
  it("appends with id and name from the seed without mutating", () => {
    const list = [sp(1)];
    const r = addStartPoint(list, 2, 5, 6, 1);
    expect(r.error).toBeUndefined();
    expect(r.list).toEqual([sp(1), { id: "start-2", name: "Start 2", x: 5, z: 6, headingRad: 1 }]);
    expect(r.nextSeed).toBe(3);
    expect(list).toHaveLength(1);
  });
  it("errors at 32 entries", () => {
    const full = Array.from({ length: 32 }, (_, i) => sp(i + 1));
    const r = addStartPoint(full, 33, 0, 0, 0);
    expect(r.error).toBe("A map can have at most 32 start points");
  });
  it("never reuses an id within a session", () => {
    let seed = 1;
    let list: readonly TerrainStartPoint[] = [];
    for (let i = 0; i < 2; i++) {
      const r = addStartPoint(list, seed, 0, 0, 0);
      if (!r.list) throw new Error("add failed");
      list = r.list;
      seed = r.nextSeed;
    }
    list = removeStartPoint(list, "start-2");
    const r = addStartPoint(list, seed, 0, 0, 0);
    expect(r.list?.map((s) => s.id)).toEqual(["start-1", "start-3"]);
  });
});

describe("edits", () => {
  it("remove, move, turn, rename return new arrays", () => {
    const list = [sp(1), sp(2)];
    expect(removeStartPoint(list, "start-1")).toEqual([sp(2)]);
    expect(moveStartPoint(list, "start-2", 9, 8)[1]).toMatchObject({ x: 9, z: 8 });
    expect(turnStartPoint(list, "start-2", 2)[1].headingRad).toBe(2);
    expect(renameStartPoint(list, "start-1", "  Pit  ")[0].name).toBe("Pit");
    expect(list[1].x).toBe(2);
  });
  it("unknown id returns the same reference", () => {
    const list = [sp(1)];
    expect(removeStartPoint(list, "nope")).toBe(list);
    expect(moveStartPoint(list, "nope", 0, 0)).toBe(list);
    expect(turnStartPoint(list, "nope", 0)).toBe(list);
    expect(renameStartPoint(list, "nope", "x")).toBe(list);
    expect(makeDefault(list, "nope")).toBe(list);
  });
  it("rename rejects empty and over-long names", () => {
    const list = [sp(1)];
    expect(renameStartPoint(list, "start-1", "   ")).toBe(list);
    expect(renameStartPoint(list, "start-1", "x".repeat(41))).toBe(list);
    expect(renameStartPoint(list, "start-1", "x".repeat(40))).not.toBe(list);
  });
  it("makeDefault moves to the front keeping the relative order of the rest", () => {
    const list = [sp(1), sp(2), sp(3)];
    const out = makeDefault(list, "start-3");
    expect(out.map((s) => s.id)).toEqual(["start-3", "start-1", "start-2"]);
    expect(defaultStartPoint(out)?.id).toBe("start-3");
    expect(defaultStartPoint([])).toBeUndefined();
  });
});
