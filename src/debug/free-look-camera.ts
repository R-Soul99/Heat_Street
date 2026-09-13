/**
 * TEMPORARY DEBUG TOOL, added to assist the Phase 3 plan 03-12 manual
 * occlusion playtest (developer flies around to inspect the CAM-04
 * mitigation from angles the fixed helicopter shot cannot show). It must
 * NEVER be reachable outside `DEBUG_ENABLED` — `src/main.ts` is the only
 * place that constructs it, gated exactly like every other `?debug`-only
 * tool in this directory.
 *
 * It deliberately does NOT modify the permanent helicopter rig
 * (CLAUDE.md's non-negotiable "permanent high-angle helicopter cam"
 * constraint) — this module owns no `CameraRig` and calls no rig method. It
 * only overwrites `camera.position`/`camera.quaternion` AFTER the rig has
 * already written its own pose for the frame and the occlusion mitigation
 * has already READ that pose — see the load-bearing call-order comment at
 * this factory's call site in `src/main.ts`'s `render` callback.
 *
 * Follows the repo's gate-free-factory convention (`createTuningPanel`,
 * `createTelemetryHud`): this factory never reads `DEBUG_ENABLED` itself —
 * `src/main.ts` owns the gate, so a normal (non-`?debug`) build constructs
 * nothing here and registers zero listeners.
 */
import * as THREE from "three";

/** Radians of yaw/pitch per pixel of pointer drag. */
const YAW_SENSITIVITY_RAD_PER_PX = 0.006;
const PITCH_SENSITIVITY_RAD_PER_PX = 0.006;
/** Metres of orbit distance per wheel-event delta unit. */
const ZOOM_SENSITIVITY_M_PER_UNIT = 0.02;

/** Never quite the horizon and never quite straight overhead — both are `computeOffset`-style singularities for a lookAt-based orbit. */
const PITCH_MIN_RAD = 0.05;
const PITCH_MAX_RAD = Math.PI / 2 - 0.05;
const DISTANCE_MIN_M = 4;
const DISTANCE_MAX_M = 120;

/** A reasonable starting orbit before the first engage seeds real values from the rig's current pose. */
const INITIAL_PITCH_RAD = 0.6;
const INITIAL_DISTANCE_M = 20;

/** Clamp `v` into `[lo, hi]`. */
function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** The temporary free-look tool's public surface. */
export interface FreeLookCamera {
  /** True while the orbit override is active. */
  engaged(): boolean;
  /** Toggle engaged/disengaged. Wired to `onDebugKey("KeyF", …)` at the composition root. */
  toggle(): void;
  /**
   * A no-op while disengaged. While engaged, writes the saved rig pose back
   * onto `camera`. MUST be called BEFORE `activeRig.update(dtMs)` every
   * frame: the rig damps `camera.position` using `camera.position` itself as
   * its own state, so leaving last frame's free-look pose there would
   * poison the rig's damping and make it snap on disengage.
   */
  restoreRigPose(): void;
  /**
   * A no-op while disengaged. While engaged, SAVES the camera's current
   * (this frame's rig-updated) position+quaternion for the NEXT frame's
   * `restoreRigPose()` call, then writes the orbit pose around
   * `(targetX, targetY, targetZ)`. MUST be called AFTER the occlusion
   * mitigation has read `camera.position` for this frame (so occlusion keeps
   * sampling the SHIPPING rig pose, not the developer's flown-to pose) and
   * BEFORE `renderer.render`.
   */
  apply(targetX: number, targetY: number, targetZ: number): void;
  /** Remove every listener this factory registered. */
  dispose(): void;
}

/**
 * Build a mouse-drag orbit camera override bound to `canvas`. Controls, all
 * registered on `canvas` at construction time and all INERT while
 * disengaged (each handler's own `if (!isEngaged) return` guard, so a normal
 * `?debug` driving session with free-look never toggled on sees zero
 * behavioural change): `pointerdown` starts a drag, `pointermove` maps
 * drag delta to yaw/pitch, `pointerup`/`pointercancel` ends the drag, and
 * `wheel` changes orbit distance.
 *
 * Deliberately NOT `WASD`/arrow keys: `src/input/keyboard.ts` owns those as
 * driving keys and calls `preventDefault` on every one of them, so they are
 * unavailable to any camera control (this module's own interfaces block,
 * from `src/input/keyboard.ts`).
 */
export function createFreeLookCamera(
  camera: THREE.PerspectiveCamera,
  canvas: HTMLCanvasElement,
): FreeLookCamera {
  let isEngaged = false;
  let dragging = false;
  let yawRad = 0;
  let pitchRad = INITIAL_PITCH_RAD;
  let distanceM = INITIAL_DISTANCE_M;

  // Reused scratch, allocated ONCE — never reallocated per frame or per
  // call (`src/render/camera/occlusion-probe.ts`'s SCRATCH convention).
  const savedPosition = new THREE.Vector3();
  const savedQuaternion = new THREE.Quaternion();

  // The most recent target `apply()` was called with, tracked EVEN WHILE
  // DISENGAGED — `apply()`'s POSE WRITE is the documented no-op, not this
  // bookkeeping. `toggle()` needs a target to seed yaw/pitch/distance from
  // on first engage and has no other way to learn where the car is (it is
  // called from a keydown handler, outside the render loop that carries the
  // car's position).
  let lastTargetX = 0;
  let lastTargetY = 0;
  let lastTargetZ = 0;

  let lastPointerX = 0;
  let lastPointerY = 0;

  function onPointerDown(e: PointerEvent): void {
    if (!isEngaged) return;
    dragging = true;
    lastPointerX = e.clientX;
    lastPointerY = e.clientY;
  }

  function onPointerMove(e: PointerEvent): void {
    if (!isEngaged || !dragging) return;
    const dx = e.clientX - lastPointerX;
    const dy = e.clientY - lastPointerY;
    lastPointerX = e.clientX;
    lastPointerY = e.clientY;
    yawRad -= dx * YAW_SENSITIVITY_RAD_PER_PX;
    pitchRad = clamp(pitchRad + dy * PITCH_SENSITIVITY_RAD_PER_PX, PITCH_MIN_RAD, PITCH_MAX_RAD);
  }

  function onPointerUp(): void {
    dragging = false;
  }

  function onWheel(e: WheelEvent): void {
    if (!isEngaged) return;
    // preventDefault ONLY while engaged, so the page scrolls normally while
    // free-look is off.
    e.preventDefault();
    distanceM = clamp(
      distanceM + e.deltaY * ZOOM_SENSITIVITY_M_PER_UNIT,
      DISTANCE_MIN_M,
      DISTANCE_MAX_M,
    );
  }

  canvas.addEventListener("pointerdown", onPointerDown);
  canvas.addEventListener("pointermove", onPointerMove);
  canvas.addEventListener("pointerup", onPointerUp);
  canvas.addEventListener("pointercancel", onPointerUp);
  // `{ passive: false }` — required for `preventDefault()` to have any
  // effect on a wheel listener at all.
  canvas.addEventListener("wheel", onWheel, { passive: false });

  function restoreRigPose(): void {
    if (!isEngaged) return;
    camera.position.copy(savedPosition);
    camera.quaternion.copy(savedQuaternion);
  }

  return {
    engaged(): boolean {
      return isEngaged;
    },

    toggle(): void {
      if (isEngaged) {
        // Disengaging: restore the rig's own last pose ONCE, while
        // `isEngaged` is STILL true (restoreRigPose()'s own guard would make
        // this a no-op the instant `isEngaged` flips), so the very next
        // render frame's `activeRig.update` starts from the rig's own pose
        // with no snap.
        restoreRigPose();
        isEngaged = false;
        console.info("[free-look] disengaged");
        return;
      }

      // Engaging: save the rig's current pose (for the first
      // `restoreRigPose()` call next frame), then seed yaw/pitch/distance
      // from that SAME pose relative to the last known target, so engaging
      // produces no jump.
      savedPosition.copy(camera.position);
      savedQuaternion.copy(camera.quaternion);
      const dx = camera.position.x - lastTargetX;
      const dy = camera.position.y - lastTargetY;
      const dz = camera.position.z - lastTargetZ;
      const dist = Math.hypot(dx, dy, dz);
      distanceM = clamp(dist, DISTANCE_MIN_M, DISTANCE_MAX_M);
      yawRad = Math.atan2(dx, dz);
      if (dist > 1e-6) {
        pitchRad = clamp(Math.asin(clamp(dy / dist, -1, 1)), PITCH_MIN_RAD, PITCH_MAX_RAD);
      }
      isEngaged = true;
      console.info("[free-look] engaged");
    },

    restoreRigPose,

    apply(targetX: number, targetY: number, targetZ: number): void {
      lastTargetX = targetX;
      lastTargetY = targetY;
      lastTargetZ = targetZ;
      if (!isEngaged) return;

      // Save THIS frame's rig-updated pose so the NEXT frame's
      // `restoreRigPose()` call can put it back before the rig advances its
      // own damping again.
      savedPosition.copy(camera.position);
      savedQuaternion.copy(camera.quaternion);

      const horizontalM = distanceM * Math.cos(pitchRad);
      const verticalM = distanceM * Math.sin(pitchRad);
      camera.position.set(
        targetX + horizontalM * Math.sin(yawRad),
        targetY + verticalM,
        targetZ + horizontalM * Math.cos(yawRad),
      );
      camera.lookAt(targetX, targetY, targetZ);
    },

    dispose(): void {
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerup", onPointerUp);
      canvas.removeEventListener("pointercancel", onPointerUp);
      canvas.removeEventListener("wheel", onWheel);
    },
  };
}
