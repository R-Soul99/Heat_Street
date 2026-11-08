import { describe, expect, it } from "vitest";
import { createRoleAssigner } from "../src/core/pursuit-roles";

// Player at the origin heading -Z (fx 0, fz -1), so "behind" is +Z.
const player = { x: 0, z: 0, fx: 0, fz: -1 };

describe("pursuit role assigner", () => {
  it("blockers stay blockers; the car nearest the rear bumper is the rammer, the rest pitters", () => {
    const a = createRoleAssigner();
    const roles = a.assign(player, [
      { x: 0, z: 30, blocker: false },
      { x: -7, z: 4, blocker: false },
      { x: 7, z: 10, blocker: false },
      { x: 0, z: -20, blocker: true },
    ]);
    expect(roles).toEqual(["pitter", "rammer", "pitter", "blocker"]);
  });

  it("a flanker that is better placed than the tail takes over the rammer job", () => {
    const a = createRoleAssigner();
    const cars = [
      { x: 0, z: 25, blocker: false },
      { x: -7, z: 3, blocker: false },
    ];
    expect(a.assign(player, cars)).toEqual(["pitter", "rammer"]);
    // The first car sweeps up right behind the player; the second drops away.
    const roles = a.assign(player, [
      { x: 0, z: 4, blocker: false },
      { x: -7, z: 20, blocker: false },
    ]);
    expect(roles).toEqual(["rammer", "pitter"]);
  });

  it("does not swap rammers between two cars that are about equally well placed", () => {
    const a = createRoleAssigner();
    a.assign(player, [
      { x: 0, z: 6, blocker: false },
      { x: 4, z: 9, blocker: false },
    ]);
    const roles = a.assign(player, [
      { x: 0, z: 7, blocker: false },
      { x: 3, z: 6, blocker: false },
    ]);
    expect(roles).toEqual(["rammer", "pitter"]);
  });

  it("a car ahead of the player cannot be the rammer", () => {
    const a = createRoleAssigner();
    const roles = a.assign(player, [
      { x: 0, z: -15, blocker: false },
      { x: 0, z: 40, blocker: false },
    ]);
    expect(roles).toEqual(["pitter", "rammer"]);
  });
});
