/**
 * "Seen through the building" ghost for the player car.
 *
 * A second, flat-coloured, translucent copy of the chassis is parented to the
 * real mesh (so it inherits every transform for free) and
 * drawn with `GreaterDepth`: it only shows where something NEARER than the car
 * — a building — is already in the depth buffer. Where the car is unobstructed
 * the real car's own surface is at the same depth, the strict "greater" test
 * fails, and nothing extra is drawn. A small negative polygon offset pulls the
 * ghost toward the camera so the car's own surfaces (and the road under the
 * wheels) reliably lose that test, while a building metres closer still wins.
 *
 * Chassis only, deliberately: the wheels sit partly inside the chassis box, so
 * the box hides them and their ghosts would show through the car's own roof
 * even in the open.
 *
 * Front faces only, deliberately: back faces of the car are always "behind" its
 * own front faces and would draw a see-through box even in the open.
 *
 * This replaces fading buildings out of the way, so the map stays solid.
 */
import * as THREE from "three";

const GHOST_COLOUR = 0xffe08a;
const GHOST_OPACITY = 0.6;

export interface CarXray {
  dispose(): void;
}

export function createCarXray(chassis: THREE.Object3D): CarXray {
  const material = new THREE.MeshBasicMaterial({
    color: GHOST_COLOUR,
    transparent: true,
    opacity: GHOST_OPACITY,
    depthFunc: THREE.GreaterDepth,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
    toneMapped: false,
  });

  const ghosts: THREE.Mesh[] = [];
  if (chassis instanceof THREE.Mesh) {
    const ghost = new THREE.Mesh(chassis.geometry, material);
    ghost.renderOrder = 10;
    ghost.castShadow = false;
    ghost.receiveShadow = false;
    chassis.add(ghost);
    ghosts.push(ghost);
  }

  return {
    dispose(): void {
      for (const ghost of ghosts) ghost.removeFromParent();
      // Geometry is shared with the real meshes and disposed by their owner.
      material.dispose();
    },
  };
}
