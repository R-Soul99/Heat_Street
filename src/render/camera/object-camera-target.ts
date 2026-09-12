/**
 * Adapts any `THREE.Object3D` plus a velocity callback into a `CameraTarget`
 * (`src/render/camera/helicopter-camera.ts`), so the camera rig can follow
 * the player's chassis mesh today and a Phase 7/8 pursuer mesh later with
 * zero rig-side change (D-13).
 *
 * Layering: this file imports `three` and the `CameraTarget` type only — it
 * must import NOTHING from `src/physics/`, which is what keeps the whole
 * camera tier physics-free and D-13-generic. `tests/layering.test.ts`'s
 * T-03-20 rule enforces this mechanically for the whole `src/render/camera/`
 * tier, not just this file.
 */
import * as THREE from "three";
import type { CameraTarget } from "./helicopter-camera";

/** Local -Z, the vehicle's forward direction — reused as the un-rotated basis vector every call. */
const LOCAL_FORWARD = new THREE.Vector3(0, 0, -1);

/**
 * Build a `CameraTarget` bound to `object`. `position()` returns `object`'s
 * own `THREE.Vector3` reference directly (never cloned) — callers must treat
 * it as read-only for the duration of the call, matching the interpolated
 * mesh's own per-frame-mutated contract. `forward()` rotates `LOCAL_FORWARD`
 * by `object`'s current quaternion into a reused scratch vector, so this
 * function allocates nothing per call.
 *
 * `velocity` is a callback, not a captured value, so a target built once at
 * boot always reports the LIVE velocity of whatever it is bound to (mirrors
 * `createTelemetryHud`'s own `getTuning` callback rationale).
 */
export function createObjectCameraTarget(
  object: THREE.Object3D,
  velocity: () => { x: number; y: number; z: number },
): CameraTarget {
  const scratchForward = new THREE.Vector3();

  return {
    position(): { x: number; y: number; z: number } {
      return object.position;
    },
    velocity(): { x: number; y: number; z: number } {
      return velocity();
    },
    forward(): { x: number; y: number; z: number } {
      return scratchForward.copy(LOCAL_FORWARD).applyQuaternion(object.quaternion);
    },
  };
}
