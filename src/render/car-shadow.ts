/**
 * A soft dark patch laid on the ground straight below the car. The helicopter
 * camera looks nearly straight down, so a car in the air looks the same size
 * and place as one on the road; this patch stays on the ground while the car
 * leaves it, and grows fainter and wider with height, which is what makes a
 * jump readable. The road is nearly black, so the shadow alone is hard to see
 * on it: a bright outline of the car's footprint stays on the ground too, and
 * a line joins the car to it, so height reads against any surface. Purely
 * visual.
 */
import * as THREE from "three";

/** Chassis centre height above the ground when the car is sitting on its wheels, metres. */
const REST_CLEARANCE_M = 0.95;
/** Metres of air over which the shadow fades to ~37% of its strength. */
const FADE_M = 3;
/** Extra width per metre of air. */
const GROW_PER_M = 0.07;
const MAX_OPACITY = 0.6;

function shadowTexture(): THREE.CanvasTexture {
  const size = 64;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (ctx !== null) {
    const g = ctx.createRadialGradient(
      size / 2,
      size / 2,
      size * 0.18,
      size / 2,
      size / 2,
      size / 2,
    );
    g.addColorStop(0, "rgba(0,0,0,1)");
    g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
  }
  return new THREE.CanvasTexture(canvas);
}

export interface CarShadow {
  readonly object: THREE.Group;
  /** `groundY` is the ground height below the car, or null when nothing is below. */
  update(car: THREE.Object3D, groundY: number | null): void;
  dispose(): void;
}

export function createCarShadow(halfExtents: { x: number; z: number }): CarShadow {
  const geometry = new THREE.PlaneGeometry(halfExtents.x * 2.6, halfExtents.z * 2.4);
  geometry.rotateX(-Math.PI / 2);
  const texture = shadowTexture();
  const material = new THREE.MeshBasicMaterial({
    map: texture,
    transparent: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -4,
    polygonOffsetUnits: -4,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.renderOrder = 2;
  const forward = new THREE.Vector3();

  const outlineGeometry = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(-halfExtents.x, 0, -halfExtents.z),
    new THREE.Vector3(halfExtents.x, 0, -halfExtents.z),
    new THREE.Vector3(halfExtents.x, 0, halfExtents.z),
    new THREE.Vector3(-halfExtents.x, 0, halfExtents.z),
  ]);
  const outlineMaterial = new THREE.LineBasicMaterial({
    color: 0xffffff,
    transparent: true,
    depthWrite: false,
  });
  const outline = new THREE.LineLoop(outlineGeometry, outlineMaterial);
  outline.renderOrder = 3;
  const stemPositions = new Float32Array(6);
  const stemGeometry = new THREE.BufferGeometry();
  stemGeometry.setAttribute("position", new THREE.BufferAttribute(stemPositions, 3));
  const stem = new THREE.Line(stemGeometry, outlineMaterial);
  stem.frustumCulled = false;
  stem.renderOrder = 3;

  const object = new THREE.Group();
  object.add(mesh, outline, stem);
  object.visible = false;

  return {
    object,
    update(car, groundY) {
      if (groundY === null) {
        object.visible = false;
        return;
      }
      const air = Math.max(0, car.position.y - groundY - REST_CLEARANCE_M);
      forward.set(0, 0, -1).applyQuaternion(car.quaternion);
      object.visible = true;
      const yaw = Math.atan2(-forward.x, -forward.z);
      mesh.position.set(car.position.x, groundY + 0.04, car.position.z);
      mesh.rotation.y = yaw;
      mesh.scale.setScalar(1 + air * GROW_PER_M);
      material.opacity = MAX_OPACITY * Math.exp(-air / FADE_M);
      outline.position.set(car.position.x, groundY + 0.06, car.position.z);
      outline.rotation.y = yaw;
      outlineMaterial.opacity = 0.9;
      stemPositions[0] = car.position.x;
      stemPositions[1] = groundY + 0.06;
      stemPositions[2] = car.position.z;
      stemPositions[3] = car.position.x;
      stemPositions[4] = car.position.y;
      stemPositions[5] = car.position.z;
      stemGeometry.attributes.position.needsUpdate = true;
      stem.visible = air > 0.15;
    },
    dispose() {
      geometry.dispose();
      texture.dispose();
      material.dispose();
      outlineGeometry.dispose();
      stemGeometry.dispose();
      outlineMaterial.dispose();
    },
  };
}
