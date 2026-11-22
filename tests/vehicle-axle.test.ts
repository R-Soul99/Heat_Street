import * as RAPIER from "@dimforge/rapier3d";
import type * as THREE from "three";
import { describe, expect, it } from "vitest";
import { NEUTRAL } from "../src/core/input-tape";
import { defaultTuning, type VehicleTuning } from "../src/core/vehicle-tuning";
import { createVehicle } from "../src/physics/vehicle";
import { createWorld } from "../src/physics/world";
import { buildCarMeshes } from "../src/render/vehicle-view";

function settle(tuning: VehicleTuning) {
  const world = createWorld();
  const ground = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(0, -0.5, 0));
  world.createCollider(RAPIER.ColliderDesc.cuboid(500, 0.5, 500), ground);
  const vehicle = createVehicle(world, tuning, { x: 0, y: 1, z: 0 });
  for (let i = 0; i < 300; i++) {
    vehicle.tick({ ...NEUTRAL }, tuning);
    world.step();
  }
  return vehicle;
}

describe("per-wheel rear override (D-03)", () => {
  it("a larger rear radius changes chassis pitch", () => {
    const base = settle(defaultTuning());
    const t = defaultTuning();
    t.wheels.rear = { radius: 0.45 };
    const over = settle(t);
    expect(Math.abs(over.body.rotation().x - base.body.rotation().x)).toBeGreaterThan(1e-3);
  });

  it("a stiffer rear spring sags less than the front", () => {
    const t = defaultTuning();
    t.wheels.rear = { suspensionStiffness: t.wheels.suspensionStiffness * 2 };
    const v = settle(t);
    const front = v.controller.wheelSuspensionLength(0) as number;
    const rear = v.controller.wheelSuspensionLength(2) as number;
    expect(rear).toBeGreaterThan(front);
  });
});

describe("buildCarMeshes rear radius", () => {
  const he = { x: 0.9, y: 0.4, z: 2 };
  const radiusOf = (m: THREE.Object3D): number => {
    const g = (m as THREE.Mesh).geometry as THREE.CylinderGeometry;
    return g.parameters.radiusTop;
  };

  it("draws wheels 2 and 3 at the rear radius", () => {
    const car = buildCarMeshes(0.35, 0.8, 1.4, he, 0xff0000, 0.45);
    expect(radiusOf(car.wheelMeshes[0])).toBe(0.35);
    expect(radiusOf(car.wheelMeshes[1])).toBe(0.35);
    expect(radiusOf(car.wheelMeshes[2])).toBe(0.45);
    expect(radiusOf(car.wheelMeshes[3])).toBe(0.45);
  });

  it("defaults to the front radius", () => {
    const car = buildCarMeshes(0.35, 0.8, 1.4, he, 0xff0000);
    for (let i = 0; i < 4; i++) {
      expect(radiusOf(car.wheelMeshes[i])).toBe(0.35);
    }
  });

  it("rejects a bad rear radius", () => {
    expect(() => buildCarMeshes(0.35, 0.8, 1.4, he, 0xff0000, Number.NaN)).toThrow(RangeError);
    expect(() => buildCarMeshes(0.35, 0.8, 1.4, he, 0xff0000, 0)).toThrow(RangeError);
  });
});
