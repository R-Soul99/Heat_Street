import { describe, expect, it } from "vitest";
import { projectCarRotation, projectMinimapPoint } from "../src/hud/minimap";

describe("minimap projection", () => {
  it("keeps world north-up while following the player", () => {
    const projected = projectMinimapPoint({ x: 10, z: -20 }, { x: 0, z: 0 }, 100, 200);
    expect(projected.x).toBe(110);
    expect(projected.y).toBe(120);
    expect(projected.offscreen).toBe(false);
  });

  it("clamps distant objectives to the perimeter with direction", () => {
    // Due south of the player (negative z): on-screen mapping puts negative-z
    // points toward the bottom of the canvas (larger y), so the clamped
    // perimeter position must stay on that same side, not flip to the top.
    const projected = projectMinimapPoint({ x: 0, z: -500 }, { x: 0, z: 0 }, 100, 200);
    expect(projected.offscreen).toBe(true);
    expect(projected.x).toBeCloseTo(100);
    expect(projected.y).toBeCloseTo(192);
  });

  it("keeps clamped perimeter position continuous with the on-screen mapping at the radius boundary", () => {
    const player = { x: 0, z: 0 };
    const justInside = projectMinimapPoint({ x: 0, z: -99 }, player, 100, 200);
    const justOutside = projectMinimapPoint({ x: 0, z: -101 }, player, 100, 200);
    expect(justInside.offscreen).toBe(false);
    expect(justOutside.offscreen).toBe(true);
    // Both points are on the same side (south of the player); the clamped
    // point must not jump to the opposite edge of the minimap.
    expect(Math.sign(justInside.y - 100)).toBe(Math.sign(justOutside.y - 100));
  });

  it("rotates only the car marker", () => {
    expect(projectCarRotation(Math.PI / 2)).toBeCloseTo(0);
    expect(projectCarRotation(-Math.PI / 2)).toBeCloseTo(Math.PI);
  });

  it("does not project distant road points onto the map perimeter", () => {
    const projected = projectMinimapPoint({ x: 0, z: -500 }, { x: 0, z: 0 }, 100, 200);
    expect(projected.offscreen).toBe(true);
    expect(projected.x).toBe(100);
    expect(projected.y).toBe(192);
  });
});
