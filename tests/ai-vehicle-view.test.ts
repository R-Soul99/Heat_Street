import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { AI_PAINTS } from "../src/core/race-start";
import { createAiVehicleViews } from "../src/render/ai-vehicle-view";

const WHEEL_RADIUS = 0.36;
const HALF_TRACK = 0.85;
const HALF_WHEELBASE = 1.55;
const CHASSIS_HALF_EXTENTS = { x: 0.95, y: 0.5, z: 2.35 };

describe("createAiVehicleViews", () => {
  it("adds exactly 3 chassis children into the given scene, one per AI_PAINTS colour", () => {
    const scene = new THREE.Scene();
    const views = createAiVehicleViews(
      scene,
      WHEEL_RADIUS,
      HALF_TRACK,
      HALF_WHEELBASE,
      CHASSIS_HALF_EXTENTS,
      AI_PAINTS.map((p) => p.hex),
    );

    expect(scene.children).toHaveLength(3);
    expect(views.chassisMeshes).toHaveLength(3);
    expect(scene.children).toEqual(views.chassisMeshes);
  });

  it("each chassis has exactly 4 wheel children", () => {
    const scene = new THREE.Scene();
    const views = createAiVehicleViews(
      scene,
      WHEEL_RADIUS,
      HALF_TRACK,
      HALF_WHEELBASE,
      CHASSIS_HALF_EXTENTS,
      AI_PAINTS.map((p) => p.hex),
    );

    for (const chassis of views.chassisMeshes) {
      expect(chassis.children).toHaveLength(4);
    }
  });

  it("each chassis material colour hex equals AI_PAINTS[i].hex", () => {
    const scene = new THREE.Scene();
    const views = createAiVehicleViews(
      scene,
      WHEEL_RADIUS,
      HALF_TRACK,
      HALF_WHEELBASE,
      CHASSIS_HALF_EXTENTS,
      AI_PAINTS.map((p) => p.hex),
    );

    for (let i = 0; i < views.chassisMeshes.length; i++) {
      const chassis = views.chassisMeshes[i] as THREE.Mesh;
      const material = chassis.material as THREE.MeshStandardMaterial;
      expect(material.color.getHex()).toBe(AI_PAINTS[i].hex);
    }
  });

  it("dispose() does not throw", () => {
    const scene = new THREE.Scene();
    const views = createAiVehicleViews(
      scene,
      WHEEL_RADIUS,
      HALF_TRACK,
      HALF_WHEELBASE,
      CHASSIS_HALF_EXTENTS,
      AI_PAINTS.map((p) => p.hex),
    );

    expect(() => views.dispose()).not.toThrow();
  });

  it("updateWheels(carIndex, vc) writes only that car's own wheel meshes", () => {
    const scene = new THREE.Scene();
    const views = createAiVehicleViews(
      scene,
      WHEEL_RADIUS,
      HALF_TRACK,
      HALF_WHEELBASE,
      CHASSIS_HALF_EXTENTS,
      AI_PAINTS.map((p) => p.hex),
    );

    const fakeController = {
      wheelChassisConnectionPointCs: () => ({ x: 0, y: -0.3, z: 0 }),
      wheelSuspensionLength: () => 0.2,
      wheelSteering: () => 0,
      wheelRotation: () => 0,
      wheelAxleCs: () => ({ x: -1, y: 0, z: 0 }),
    };

    const before = (views.chassisMeshes[1] as THREE.Mesh).children.map(
      (child) => (child as THREE.Mesh).position.y,
    );
    views.updateWheels(1, fakeController as never);
    const after = (views.chassisMeshes[1] as THREE.Mesh).children.map(
      (child) => (child as THREE.Mesh).position.y,
    );
    expect(after).not.toEqual(before);

    // A different car's wheels are untouched by updating car 1.
    const otherBefore = (views.chassisMeshes[0] as THREE.Mesh).children.map(
      (child) => (child as THREE.Mesh).position.y,
    );
    expect(otherBefore).toEqual([0, 0, 0, 0]);
  });
});
