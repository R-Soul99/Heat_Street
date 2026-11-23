import { describe, expect, it } from "vitest";
import { yawFromTravelDirection } from "../../src/core/heading.ts";
import type { StageDraft } from "../../src/core/stage.ts";
import {
  addGate,
  deleteGate,
  deleteLastStageItem,
  deleteStage,
  fallbackGateHeading,
  gateIdSeed,
  insertGate,
  moveGateOrder,
  moveStageItem,
  newStage,
  renameStage,
  setStageFinish,
  setStageItemWidth,
  stageIdSeed,
  stageItemRows,
  stageLengthM,
  stageWarnings,
  turnStageItem,
} from "./stages.ts";

function deepFreeze<T>(v: T): T {
  if (typeof v === "object" && v !== null && !Object.isFrozen(v)) {
    Object.freeze(v);
    for (const k of Object.values(v)) deepFreeze(k);
  }
  return v;
}

const START = { x: 0, z: 0, headingRad: 0 };
const G = { x: 10, z: 0, headingRad: 0.5, widthM: 20 };

function withGates(n: number): StageDraft[] {
  let list: StageDraft[] = deepFreeze(newStage([], 1, START).list ?? []);
  for (let i = 1; i <= n; i++) {
    const r = addGate(list, "stage-1", i, { ...G, x: i * 10 });
    if (r.error !== undefined) throw new Error(r.error);
    list = deepFreeze(r.list);
  }
  return list;
}

describe("newStage", () => {
  it("creates a named empty stage", () => {
    const r = newStage([], 1, START);
    expect(r.error).toBeUndefined();
    expect(r.id).toBe("stage-1");
    expect(r.nextSeed).toBe(2);
    expect(r.list?.[0]).toMatchObject({ name: "Stage 1", gates: [], finish: null });
  });
  it("caps at 20 stages", () => {
    let list: StageDraft[] = [];
    for (let i = 1; i <= 20; i++) list = newStage(list, i, START).list ?? list;
    expect(newStage(list, 21, START).error).toBe("A map can have at most 20 stages");
  });
});

describe("seeds", () => {
  it("uses max numeric suffix + 1 and ignores other ids", () => {
    const list = withGates(2);
    expect(stageIdSeed([...list, { ...list[0], id: "weird" }])).toBe(2);
    expect(stageIdSeed([])).toBe(1);
    expect(gateIdSeed(list[0])).toBe(3);
  });
});

describe("gates", () => {
  it("clamps width and caps at 40", () => {
    const list = deepFreeze(newStage([], 1, START).list ?? []);
    const r = addGate(list, "stage-1", 1, { ...G, widthM: 500 });
    expect(r.list?.[0].gates[0].widthM).toBe(60);
    expect(addGate(list, "stage-1", 1, { ...G, widthM: 1 }).list?.[0].gates[0].widthM).toBe(8);
    const full = withGates(40);
    expect(addGate(full, "stage-1", 41, G).error).toBe("A stage can have at most 40 gates");
  });
  it("inserts at an index", () => {
    const list = withGates(2);
    const r = insertGate(list, "stage-1", 1, 3, G);
    expect(r.list?.[0].gates.map((g) => g.id)).toEqual(["g1", "g3", "g2"]);
  });
  it("move/turn/width edit one element and keep identity of the rest", () => {
    const list = withGates(2);
    const moved = moveStageItem(list, "stage-1", "g1", 5, 6);
    expect(moved[0].gates[0]).toMatchObject({ x: 5, z: 6 });
    expect(moved[0].gates[1]).toBe(list[0].gates[1]);
    expect(turnStageItem(list, "stage-1", "start", 1)[0].start.headingRad).toBe(1);
    expect(setStageItemWidth(list, "stage-1", "g2", 30)[0].gates[1].widthM).toBe(30);
    expect(setStageItemWidth(list, "stage-1", "start", 30)).toBe(list);
  });
  it("returns the same reference for unknown refs", () => {
    const list = withGates(1);
    expect(moveStageItem(list, "nope", "g1", 1, 1)).toBe(list);
    expect(moveStageItem(list, "stage-1", "zzz", 1, 1)).toBe(list);
    expect(moveStageItem(list, "stage-1", "finish", 1, 1)).toBe(list);
    expect(turnStageItem(list, "stage-1", "zzz", 1)).toBe(list);
    expect(deleteGate(list, "stage-1", "zzz")).toBe(list);
  });
  it("reorders and no-ops at the ends", () => {
    const list = withGates(3);
    expect(moveGateOrder(list, "stage-1", "g1", 1)[0].gates.map((g) => g.id)).toEqual([
      "g2",
      "g1",
      "g3",
    ]);
    expect(moveGateOrder(list, "stage-1", "g1", -1)).toBe(list);
    expect(moveGateOrder(list, "stage-1", "g3", 1)).toBe(list);
  });
  it("deletes a gate", () => {
    const list = withGates(2);
    expect(deleteGate(list, "stage-1", "g1")[0].gates.map((g) => g.id)).toEqual(["g2"]);
  });
});

describe("finish and delete", () => {
  it("deleteLastStageItem peels finish, gate, then stage", () => {
    let list = setStageFinish(withGates(1), "stage-1", { x: 50, z: 0, headingRad: 0, widthM: 20 });
    expect(list[0].finish).not.toBeNull();
    list = deleteLastStageItem(list, "stage-1");
    expect(list[0].finish).toBeNull();
    expect(list[0].gates).toHaveLength(1);
    list = deleteLastStageItem(list, "stage-1");
    expect(list[0].gates).toHaveLength(0);
    expect(deleteLastStageItem(list, "stage-1")).toEqual([]);
  });
  it("rename trims and rejects bad names", () => {
    const list = withGates(0);
    expect(renameStage(list, "stage-1", "  Hill  ")[0].name).toBe("Hill");
    expect(renameStage(list, "stage-1", "   ")).toBe(list);
    expect(renameStage(list, "stage-1", "x".repeat(61))).toBe(list);
  });
  it("deleteStage removes by id", () => {
    const list = withGates(0);
    expect(deleteStage(list, "stage-1")).toEqual([]);
    expect(deleteStage(list, "nope")).toBe(list);
  });
});

describe("rows, length, warnings", () => {
  it("builds rows", () => {
    const list = setStageFinish(withGates(2), "stage-1", {
      x: 99,
      z: 0,
      headingRad: 0,
      widthM: 20,
    });
    expect(stageItemRows(list[0])).toEqual([
      { ref: "start", label: "Start", number: 1 },
      { ref: "g1", label: "Gate 1", number: 2 },
      { ref: "g2", label: "Gate 2", number: 3 },
      { ref: "finish", label: "Finish", number: 4 },
    ]);
    expect(stageItemRows(withGates(0)[0])).toHaveLength(1);
  });
  it("sums length", () => {
    const list = setStageFinish(withGates(2), "stage-1", {
      x: 30,
      z: 0,
      headingRad: 0,
      widthM: 20,
    });
    expect(stageLengthM(list[0])).toBeCloseTo(30);
  });
  it("warns on spacing and slope, none otherwise", () => {
    const base = withGates(0);
    const far = addGate(base, "stage-1", 1, { ...G, x: 640 }).list ?? base;
    const flat = () => 0;
    expect(stageWarnings(far[0], flat, 20)).toEqual(["Gate 1 is 640 m from the previous gate"]);
    const near = withGates(3);
    expect(stageWarnings(near[0], flat, 20)).toEqual([]);
    expect(stageWarnings(near[0], (x) => (x === 30 ? 40 : 0), 20)).toEqual([
      "Gate 3 sits on a steep slope",
    ]);
    const fin = setStageFinish(near, "stage-1", { x: 1000, z: 0, headingRad: 0, widthM: 20 });
    expect(stageWarnings(fin[0], flat, 20)).toEqual(["Finish is 970 m from the previous gate"]);
  });
});

describe("fallbackGateHeading", () => {
  it("points toward the cursor when far enough, else keeps previous heading", () => {
    const prev = { x: 0, z: 0, headingRad: 0.7 };
    expect(fallbackGateHeading(prev, 0, -10)).toBeCloseTo(yawFromTravelDirection(0, -10));
    expect(fallbackGateHeading(prev, 0.5, 0)).toBe(0.7);
  });
});
