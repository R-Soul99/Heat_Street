import { describe, expect, it } from "vitest";
import type { RouteDraft } from "../../src/core/route-draft.ts";
import {
  addRouteCheckpoint,
  checkpointIdSeed,
  deleteLastRouteItem,
  deleteRoute,
  deleteRouteCheckpoint,
  moveCheckpointOrder,
  moveRouteItem,
  newRoute,
  renameRoute,
  routeIdSeed,
  routeItemRows,
  setRouteFinish,
  setRouteLaps,
  turnRouteStart,
} from "./route-ops.ts";

function deepFreeze<T>(v: T): T {
  if (typeof v === "object" && v !== null && !Object.isFrozen(v)) {
    Object.freeze(v);
    for (const k of Object.values(v)) deepFreeze(k);
  }
  return v;
}

const START = { x: 0, z: 0, headingRad: 0 };
const ID = "demo-hills-route-1";

function base(mode: "p2p" | "circuit" = "p2p", cps = 0): RouteDraft[] {
  let list: RouteDraft[] = deepFreeze(newRoute([], 1, "demo-hills", mode, START).list ?? []);
  for (let i = 1; i <= cps; i++) {
    const r = addRouteCheckpoint(list, ID, i, i * 10, 0);
    if (r.error !== undefined) throw new Error(r.error);
    list = deepFreeze(r.list);
  }
  return list;
}

describe("newRoute", () => {
  it("creates defaults with a schema-valid id", () => {
    const r = newRoute([], 1, "demo-hills", "p2p", START);
    expect(r.id).toBe(ID);
    expect(r.id).toMatch(/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/);
    expect(r.list?.[0]).toMatchObject({ name: "Route 1", laps: 1, checkpoints: [], finish: null });
    expect(newRoute([], 1, "a", "circuit", START).list?.[0].laps).toBe(3);
  });
  it("caps at 20 routes", () => {
    let list: RouteDraft[] = [];
    for (let i = 1; i <= 20; i++) list = newRoute(list, i, "a", "p2p", START).list ?? list;
    expect(newRoute(list, 21, "a", "p2p", START).error).toBe("A map can have at most 20 routes");
  });
});

describe("seeds", () => {
  it("derive from suffixes", () => {
    const list = base("p2p", 2);
    expect(routeIdSeed(list)).toBe(2);
    expect(routeIdSeed([])).toBe(1);
    expect(checkpointIdSeed(list[0])).toBe(3);
  });
});

describe("checkpoints", () => {
  it("ids and cap counting the finish", () => {
    const list = base("p2p", 1);
    expect(list[0].checkpoints[0].id).toBe(`${ID}-cp-1`);
    const full = base("p2p", 39);
    const withFinish = setRouteFinish(full, ID, 5, 5);
    expect(withFinish[0].finish).toEqual({ id: `${ID}-finish`, x: 5, z: 5 });
    expect(addRouteCheckpoint(withFinish, ID, 40, 1, 1).error).toBe(
      "A route can have at most 40 checkpoints",
    );
    expect(addRouteCheckpoint(full, ID, 40, 1, 1).list).toBeDefined();
    const atCap = base("p2p", 40);
    expect(addRouteCheckpoint(atCap, ID, 41, 1, 1).error).toBe(
      "A route can have at most 40 checkpoints",
    );
  });
  it("move, turn, reorder, delete without mutation", () => {
    const list = base("p2p", 3);
    expect(moveRouteItem(list, ID, `${ID}-cp-2`, 7, 8)[0].checkpoints[1]).toMatchObject({
      x: 7,
      z: 8,
    });
    expect(moveRouteItem(list, ID, "start", 1, 2)[0].start).toMatchObject({ x: 1, z: 2 });
    expect(turnRouteStart(list, ID, 2)[0].start?.headingRad).toBe(2);
    expect(moveCheckpointOrder(list, ID, `${ID}-cp-1`, 1)[0].checkpoints.map((c) => c.id)).toEqual([
      `${ID}-cp-2`,
      `${ID}-cp-1`,
      `${ID}-cp-3`,
    ]);
    expect(moveCheckpointOrder(list, ID, `${ID}-cp-1`, -1)).toBe(list);
    expect(deleteRouteCheckpoint(list, ID, `${ID}-cp-1`)[0].checkpoints).toHaveLength(2);
  });
  it("same reference on unknown ids", () => {
    const list = base("p2p", 1);
    expect(moveRouteItem(list, "x", "start", 1, 1)).toBe(list);
    expect(moveRouteItem(list, ID, "nope", 1, 1)).toBe(list);
    expect(moveRouteItem(list, ID, "finish", 1, 1)).toBe(list);
    expect(deleteRouteCheckpoint(list, ID, "nope")).toBe(list);
    expect(turnRouteStart(list, "x", 1)).toBe(list);
    expect(renameRoute(list, "x", "a")).toBe(list);
    expect(deleteRoute(list, "x")).toBe(list);
    expect(deleteLastRouteItem(list, "x")).toBe(list);
  });
  it("deleteLastRouteItem peels finish, checkpoint, then route", () => {
    let list = setRouteFinish(base("p2p", 1), ID, 9, 9);
    list = deleteLastRouteItem(list, ID);
    expect(list[0].finish).toBeNull();
    list = deleteLastRouteItem(list, ID);
    expect(list[0].checkpoints).toHaveLength(0);
    expect(deleteLastRouteItem(list, ID)).toEqual([]);
  });
});

describe("laps, rename, delete", () => {
  it("clamps laps and ignores p2p", () => {
    const c = base("circuit");
    expect(setRouteLaps(c, ID, 99)[0].laps).toBe(20);
    expect(setRouteLaps(c, ID, 0)[0].laps).toBe(1);
    expect(setRouteLaps(base("p2p"), ID, 5)).toEqual(base("p2p"));
    const p = base("p2p");
    expect(setRouteLaps(p, ID, 5)).toBe(p);
  });
  it("renames with trim and length checks", () => {
    const list = base();
    expect(renameRoute(list, ID, " Ridge ")[0].name).toBe("Ridge");
    expect(renameRoute(list, ID, "")).toBe(list);
    expect(renameRoute(list, ID, "x".repeat(61))).toBe(list);
    expect(deleteRoute(list, ID)).toEqual([]);
  });
});

describe("routeItemRows", () => {
  it("labels finish for p2p and lap line for circuit", () => {
    const p = setRouteFinish(base("p2p", 1), ID, 1, 1)[0];
    expect(routeItemRows(p).map((r) => r.label)).toEqual(["Start", "Checkpoint 1", "Finish"]);
    const c = setRouteFinish(base("circuit", 1), ID, 1, 1)[0];
    expect(routeItemRows(c).map((r) => r.label)).toEqual(["Start", "Checkpoint 1", "Lap line"]);
    expect(routeItemRows(c)[2]).toMatchObject({ ref: "finish", number: 3 });
  });
});
