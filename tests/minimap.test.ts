import { describe, expect, it } from "vitest";
import { projectCarRotation, projectMinimapPoint, projectRacerMarkers } from "../src/hud/minimap";

describe("minimap projection", () => {
  it("maps world +X to screen-right and world -Z to screen-up (non-mirrored top-down)", () => {
    // Non-mirrored top-down pairing: screen-right = world +X requires
    // screen-up = world -Z (verified via cross(forward, up) = right for a
    // straight-down camera). Pairing +X with world +Z instead produces a
    // left-right-flipped map, which was the root cause of the car marker
    // appearing to turn opposite the real car.
    const projected = projectMinimapPoint({ x: 10, z: -20 }, { x: 0, z: 0 }, 100, 200);
    expect(projected.x).toBe(110);
    expect(projected.y).toBe(80);
    expect(projected.offscreen).toBe(false);
  });

  it("clamps distant objectives to the perimeter with direction", () => {
    // A point at negative z is on the screen-up side under the non-mirrored
    // mapping (y decreases as z decreases), so the clamped perimeter
    // position must stay on that same (upper) side.
    const projected = projectMinimapPoint({ x: 0, z: -500 }, { x: 0, z: 0 }, 100, 200);
    expect(projected.offscreen).toBe(true);
    expect(projected.x).toBeCloseTo(100);
    expect(projected.y).toBeCloseTo(8);
  });

  it("keeps clamped perimeter position continuous with the on-screen mapping at the radius boundary", () => {
    const player = { x: 0, z: 0 };
    const justInside = projectMinimapPoint({ x: 0, z: -99 }, player, 100, 200);
    const justOutside = projectMinimapPoint({ x: 0, z: -101 }, player, 100, 200);
    expect(justInside.offscreen).toBe(false);
    expect(justOutside.offscreen).toBe(true);
    // Both points are on the same (upper) side of the player; the clamped
    // point must not jump to the opposite edge of the minimap.
    expect(Math.sign(justInside.y - 100)).toBe(Math.sign(justOutside.y - 100));
  });

  it("does not project distant road points onto the map perimeter", () => {
    const projected = projectMinimapPoint({ x: 0, z: -500 }, { x: 0, z: 0 }, 100, 200);
    expect(projected.offscreen).toBe(true);
    expect(projected.x).toBe(100);
    expect(projected.y).toBe(8);
  });

  it("rotates the car marker clockwise on screen for an increasing (rightward) heading", () => {
    // headingRad = -pi/2 is the baseline (car facing world -Z, screen-up)
    // where the marker points straight up (rotation 0). Increasing
    // headingRad corresponds to a physical RIGHT turn (derived from
    // vehicle.ts's measured steering-sign convention), and must sweep the
    // canvas rotation angle in the same, clockwise-on-screen direction.
    expect(projectCarRotation(-Math.PI / 2)).toBeCloseTo(0);
    expect(projectCarRotation(0)).toBeCloseTo(Math.PI / 2);
    expect(projectCarRotation(Math.PI / 2)).toBeCloseTo(Math.PI);
  });

  it("points the car marker at a checkpoint that is directly ahead, for an arbitrary heading", () => {
    // Regression guard for the coupling between projectMinimapPoint and
    // projectCarRotation: for any heading, a point placed exactly on the
    // car's forward ray must project to the same screen angle (measured
    // clockwise from screen-up) as projectCarRotation reports.
    const headingRad = 0.7; // arbitrary, non-axis-aligned heading
    const forward = { x: Math.cos(headingRad), z: Math.sin(headingRad) };
    const player = { x: 0, z: 0 };
    const ahead = { x: forward.x * 50, z: forward.z * 50 };
    const projected = projectMinimapPoint(ahead, player, 100, 200);
    const pointScreenAngle = Math.atan2(projected.x - 100, -(projected.y - 100));
    const markerScreenAngle = projectCarRotation(headingRad);
    const normalize = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
    expect(normalize(pointScreenAngle)).toBeCloseTo(normalize(markerScreenAngle));
  });
});

describe("projectRacerMarkers", () => {
  it("projects an on-map racer with radiusPx 4.5 and its own color", () => {
    const markers = projectRacerMarkers(
      [{ point: { x: 10, z: 0 }, color: "#f2c230" }],
      { x: 0, z: 0 },
      420,
      196,
    );
    expect(markers).toHaveLength(1);
    expect(markers[0].offscreen).toBe(false);
    expect(markers[0].radiusPx).toBe(4.5);
    expect(markers[0].color).toBe("#f2c230");
  });

  it("clamps a far-away racer to the edge with radiusPx 3, same as checkpoints", () => {
    const markers = projectRacerMarkers(
      [{ point: { x: 1000, z: 0 }, color: "#2e8b57" }],
      { x: 0, z: 0 },
      420,
      196,
    );
    expect(markers[0].offscreen).toBe(true);
    expect(markers[0].radiusPx).toBe(3);
    expect(markers[0].color).toBe("#2e8b57");
  });
});
