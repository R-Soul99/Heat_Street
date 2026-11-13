import * as THREE from "three";

export interface CameraPose {
  position: THREE.Vector3;
  target: THREE.Vector3;
}

/**
 * Zooms toward `point`: scales camera position and target about `point` by 1/factor
 * (factor > 1 zooms in). The view direction is unchanged, so `point` keeps its screen
 * pixel. The effective factor is clamped so |position - target| stays in [minDist, maxDist].
 */
export function zoomTowardPoint(
  position: THREE.Vector3,
  target: THREE.Vector3,
  point: THREE.Vector3,
  factor: number,
  minDist: number,
  maxDist: number,
): CameraPose {
  const dist = position.distanceTo(target);
  let f = Number.isFinite(factor) && factor > 0 ? factor : 1;
  if (dist > 0) {
    const newDist = Math.min(maxDist, Math.max(minDist, dist / f));
    f = dist / newDist;
  }
  const s = 1 / f;
  return {
    position: point.clone().add(position.clone().sub(point).multiplyScalar(s)),
    target: point.clone().add(target.clone().sub(point).multiplyScalar(s)),
  };
}

function phiOf(position: THREE.Vector3, target: THREE.Vector3): number {
  return new THREE.Spherical().setFromVector3(position.clone().sub(target)).phi;
}

/**
 * Orbits camera position and target about `pivot`. theta/phi follow THREE.Spherical of
 * (position - target). Yaw rotates about world Y; pitch rotates about the horizontal camera
 * right axis so the new phi is clamp(phi + dPhi, minPhi, maxPhi).
 */
export function orbitAboutPivot(
  position: THREE.Vector3,
  target: THREE.Vector3,
  pivot: THREE.Vector3,
  dTheta: number,
  dPhi: number,
  minPhi: number,
  maxPhi: number,
): CameraPose {
  const yawQ = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), dTheta);
  const rot = (p: THREE.Vector3) =>
    pivot.clone().add(p.clone().sub(pivot).applyQuaternion(yawQ));
  const pos1 = rot(position);
  const tgt1 = rot(target);

  const offset = pos1.clone().sub(tgt1);
  const sph = new THREE.Spherical().setFromVector3(offset);
  const wantPhi = Math.min(maxPhi, Math.max(minPhi, sph.phi + dPhi));
  const delta = wantPhi - sph.phi;
  // Horizontal right axis, derived from theta so it is defined even for a vertical view.
  const right = new THREE.Vector3(Math.cos(sph.theta), 0, -Math.sin(sph.theta));
  const turn = (angle: number): CameraPose => {
    const q = new THREE.Quaternion().setFromAxisAngle(right, angle);
    const r = (p: THREE.Vector3) => pivot.clone().add(p.clone().sub(pivot).applyQuaternion(q));
    return { position: r(pos1), target: r(tgt1) };
  };
  if (Math.abs(delta) < 1e-12) return { position: pos1, target: tgt1 };
  const a = turn(delta);
  const b = turn(-delta);
  const errA = Math.abs(phiOf(a.position, a.target) - wantPhi);
  const errB = Math.abs(phiOf(b.position, b.target) - wantPhi);
  return errA <= errB ? a : b;
}

/** World units covered by one screen pixel at `distance` for a perspective camera. */
export function worldPerPixel(distance: number, fovDeg: number, viewportHeightPx: number): number {
  return (2 * distance * Math.tan((fovDeg * Math.PI) / 360)) / Math.max(1, viewportHeightPx);
}

/** Offset to add to camera and target so the scene follows the mouse drag (dx, dy in px). */
export function panByPixels(
  right: THREE.Vector3,
  up: THREE.Vector3,
  dx: number,
  dy: number,
  worldPerPx: number,
): THREE.Vector3 {
  return right
    .clone()
    .multiplyScalar(-dx * worldPerPx)
    .add(up.clone().multiplyScalar(dy * worldPerPx));
}
