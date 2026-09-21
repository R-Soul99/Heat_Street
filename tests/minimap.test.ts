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
    const projected = projectMinimapPoint({ x: 0, z: -500 }, { x: 0, z: 0 }, 100, 200);
    expect(projected.offscreen).toBe(true);
    expect(projected.x).toBeCloseTo(100);
    expect(projected.y).toBeCloseTo(8);
  });

  it("rotates only the car marker", () => {
    expect(projectCarRotation(Math.PI / 2)).toBeCloseTo(-Math.PI / 2);
  });
});