/**
 * The permanent high-angle helicopter camera rig (CAM-01, CAM-02) and its
 * D-12 low chase-cam fallback — two implementations behind one
 * `CameraRig` interface, so the composition root (plan 03-06) can select
 * either with zero call-site change, and so plan 03-11's go/no-go playtest
 * can genuinely compare them rather than compare a real rig against a
 * throwaway placeholder.
 *
 * Pitfall 3 (03-RESEARCH.md): `update(dtMs)` takes a variable RENDER-frame
 * delta and is called from `src/main.ts`'s `render(alpha, dtMs)` callback
 * ONLY — never from `applyInput`/`onTickBegin`/the fixed-tick loop body.
 * No smoothing constant in this file is ever expressed in ticks; every one
 * is a per-second lambda fed through `THREE.MathUtils.damp`/`dampFactor`.
 * Coupling this file to `DT` or calling it from the physics tick would
 * couple camera smoothness to render cadence exactly backwards, and would
 * put a `camera-tuning.ts`-shaped import inside `src/physics/` — a
 * layering violation `tests/layering.test.ts` would not catch on its own,
 * since only THIS file's own discipline prevents it.
 *
 * Layering: `src/render/` reads simulation state and never writes it. This
 * file imports nothing from `src/physics/` — it reads only what
 * `CameraTarget` exposes, mirroring `src/physics/vehicle.ts`'s D-09
 * config-in/controller-out generic factory shape (D-13 explicitly cites
 * D-09 as its precedent).
 */
import * as THREE from "three";
import type { CameraTuning } from "../../core/camera-tuning";
import {
  blendedHeadingRad,
  type CameraFraming,
  type CameraSpeedCurve,
  dampFactor,
  framingForSpeed,
} from "./camera-math";

/**
 * The generic thing a camera rig follows. D-13: nothing in this signature
 * names any specific vehicle — a Phase 7/8 pursuer satisfies this with zero
 * change here, mirroring `src/physics/vehicle.ts`'s own D-09 precedent.
 */
export interface CameraTarget {
  position(): { x: number; y: number; z: number };
  /** World-space velocity, m/s. Only the XZ components are consulted (ground speed/heading). */
  velocity(): { x: number; y: number; z: number };
  /**
   * The target's own chassis-forward world vector. Consulted ONLY below
   * `tuning.heading.blendSpeedMs` (CAM-01's "velocity heading, not chassis
   * yaw" requirement) — at and above that speed this has no influence on
   * the rig's heading at all.
   */
  forward(): { x: number; y: number; z: number };
}

/**
 * The contract both rig implementations satisfy identically, so the
 * composition root can hold a single `CameraRig` reference regardless of
 * which one is active.
 */
export interface CameraRig {
  readonly kind: "helicopter" | "chase";
  /** Advance the rig's damped state and write the pose onto `camera`. `dtMs` is a RENDER-frame delta — see the module doc comment's Pitfall 3 note. */
  update(dtMs: number): void;
  /** Place the camera at its fully-converged pose instantly, no damping — called once at boot so frame 1 is not a swoop in from the origin. */
  snap(): void;
  /** Bias the rig's pitch toward near-vertical (radians, added to the baseline pitch). A bias of 0 is the baseline pose. Plan 03-08's occlusion steepen mitigation is the intended caller. */
  setPitchBiasRad(rad: number): void;
  /** Release any owned resources. */
  dispose(): void;
}

/** Wrap an angle into `(-PI, PI]` — the shortest-arc step for heading damping, never a raw subtraction (03-RESEARCH.md "Don't Hand-Roll"). */
function wrapAngleRad(a: number): number {
  return Math.atan2(Math.sin(a), Math.cos(a));
}

/** Clamp `v` into `[lo, hi]`. */
function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/**
 * Compute the camera's target-relative offset (backward along `headingRad`
 * by `distanceM`, up by `altitudeM`), then rotate that offset toward
 * vertical about the target by `pitchBiasRad` — a bias of 0 reproduces the
 * plain altitude/distance pose exactly. The offset's total length from the
 * target (the "arm") is preserved as the bias changes, so biasing pitch
 * reads as the camera swinging up and over on a fixed-length boom, not as
 * it receding or approaching.
 *
 * Heading convention: `blendedHeadingRad` returns `atan2(x, z)`, i.e. a
 * heading `h` corresponds to a forward direction `(sin h, 0, cos h)` — the
 * camera sits BEHIND that direction, hence the negated sin/cos below.
 */
function computeOffset(
  out: THREE.Vector3,
  headingRad: number,
  altitudeM: number,
  distanceM: number,
  pitchBiasRad: number,
): void {
  const armLength = Math.hypot(distanceM, altitudeM);
  const basePitchRad = Math.atan2(altitudeM, distanceM);
  // Clamped to [0, PI/2 - epsilon]: never let a bias push the arm past
  // straight overhead (a `computeOffset` singularity, not a real camera
  // pose) or below the horizon.
  const pitchRad = clamp(basePitchRad + pitchBiasRad, 0.001, Math.PI / 2 - 0.001);
  const horizontalDistM = armLength * Math.cos(pitchRad);
  const verticalDistM = armLength * Math.sin(pitchRad);
  out.set(
    -Math.sin(headingRad) * horizontalDistM,
    verticalDistM,
    -Math.cos(headingRad) * horizontalDistM,
  );
}

/** Assemble a `CameraSpeedCurve` from the tuning object's flat `framing` group. */
function curveFromTuning(tuning: CameraTuning): CameraSpeedCurve {
  return {
    lowSpeedMs: tuning.framing.lowSpeedMs,
    highSpeedMs: tuning.framing.highSpeedMs,
    low: {
      altitudeM: tuning.framing.lowAltitudeM,
      distanceM: tuning.framing.lowDistanceM,
      fovDeg: tuning.framing.lowFovDeg,
    },
    high: {
      altitudeM: tuning.framing.highAltitudeM,
      distanceM: tuning.framing.highDistanceM,
      fovDeg: tuning.framing.highFovDeg,
    },
  };
}

/** Reusable scratch objects, allocated once per rig instance so `update` allocates nothing per frame — `src/render/vehicle-view.ts`'s `SCRATCH_AXLE` convention. */
function makeScratch(): { offset: THREE.Vector3 } {
  return { offset: new THREE.Vector3() };
}

/**
 * Build the permanent helicopter camera rig: a velocity-heading follow with
 * speed-driven altitude/distance/FOV framing, all frame-rate-independently
 * damped (CAM-01, CAM-02, D-11).
 */
export function createHelicopterCameraRig(
  camera: THREE.PerspectiveCamera,
  target: CameraTarget,
  tuning: CameraTuning,
): CameraRig {
  const scratch = makeScratch();

  // Damped internal state — never re-derived from the camera's current
  // transform each frame (that would double-damp and drift).
  let headingRad = 0;
  let framing: CameraFraming = {
    altitudeM: tuning.framing.lowAltitudeM,
    distanceM: tuning.framing.lowDistanceM,
    fovDeg: tuning.framing.lowFovDeg,
  };
  let pitchBiasRad = 0;
  let lastAppliedFovDeg: number | null = null;

  function desiredHeadingAndFraming(): { headingRad: number; framing: CameraFraming } {
    const velocity = target.velocity();
    const forward = target.forward();
    const groundSpeedMs = Math.hypot(velocity.x, velocity.z);
    const desiredHeadingRad = blendedHeadingRad(
      { x: velocity.x, z: velocity.z },
      { x: forward.x, z: forward.z },
      groundSpeedMs,
      tuning.heading.blendSpeedMs,
    );
    const desiredFraming = framingForSpeed(groundSpeedMs, curveFromTuning(tuning));
    return { headingRad: desiredHeadingRad, framing: desiredFraming };
  }

  /** Write the current damped state onto `camera`, sharing the offset/lookAt/fov logic between `update` and `snap`. */
  function applyPose(): void {
    const targetPos = target.position();
    computeOffset(scratch.offset, headingRad, framing.altitudeM, framing.distanceM, pitchBiasRad);
    camera.position.set(
      targetPos.x + scratch.offset.x,
      targetPos.y + scratch.offset.y,
      targetPos.z + scratch.offset.z,
    );
    camera.lookAt(targetPos.x, targetPos.y, targetPos.z);

    // Only rebuild the projection matrix when FOV actually changed since
    // last frame — the rebuild is cheap but not free, and this runs every
    // frame (03-04-PLAN.md's own instruction).
    if (framing.fovDeg !== lastAppliedFovDeg) {
      camera.fov = framing.fovDeg;
      camera.updateProjectionMatrix();
      lastAppliedFovDeg = framing.fovDeg;
    }
  }

  return {
    kind: "helicopter",

    update(dtMs: number): void {
      const dtSec = dtMs / 1000;
      const desired = desiredHeadingAndFraming();

      // Shortest-arc heading step: wrap the difference into (-PI, PI]
      // before damping, never a raw subtraction (the wraparound bug
      // `interpolator.ts` already warns about, restated for camera heading
      // in 03-RESEARCH.md).
      const headingDiffRad = wrapAngleRad(desired.headingRad - headingRad);
      headingRad += headingDiffRad * dampFactor(tuning.damping.headingLambda, dtSec);

      framing = {
        altitudeM: THREE.MathUtils.damp(
          framing.altitudeM,
          desired.framing.altitudeM,
          tuning.damping.framingLambda,
          dtSec,
        ),
        distanceM: THREE.MathUtils.damp(
          framing.distanceM,
          desired.framing.distanceM,
          tuning.damping.framingLambda,
          dtSec,
        ),
        fovDeg: THREE.MathUtils.damp(
          framing.fovDeg,
          desired.framing.fovDeg,
          tuning.damping.framingLambda,
          dtSec,
        ),
      };

      // Position itself is damped separately (not hard-set from the
      // heading/framing state above) so a sudden framing change still
      // arrives at the camera smoothly rather than snapping the instant
      // heading/framing converge.
      const targetPos = target.position();
      computeOffset(scratch.offset, headingRad, framing.altitudeM, framing.distanceM, pitchBiasRad);
      const desiredX = targetPos.x + scratch.offset.x;
      const desiredY = targetPos.y + scratch.offset.y;
      const desiredZ = targetPos.z + scratch.offset.z;
      camera.position.x = THREE.MathUtils.damp(
        camera.position.x,
        desiredX,
        tuning.damping.positionLambda,
        dtSec,
      );
      camera.position.y = THREE.MathUtils.damp(
        camera.position.y,
        desiredY,
        tuning.damping.positionLambda,
        dtSec,
      );
      camera.position.z = THREE.MathUtils.damp(
        camera.position.z,
        desiredZ,
        tuning.damping.positionLambda,
        dtSec,
      );

      camera.lookAt(targetPos.x, targetPos.y, targetPos.z);
      if (framing.fovDeg !== lastAppliedFovDeg) {
        camera.fov = framing.fovDeg;
        camera.updateProjectionMatrix();
        lastAppliedFovDeg = framing.fovDeg;
      }
    },

    snap(): void {
      // Every damp factor forced to 1: jump straight to the desired
      // heading/framing/position with no lag, so frame 1 is not a swoop in
      // from wherever the rig's initial state happened to be.
      const desired = desiredHeadingAndFraming();
      headingRad = desired.headingRad;
      framing = desired.framing;
      applyPose();
    },

    setPitchBiasRad(rad: number): void {
      pitchBiasRad = rad;
    },

    dispose(): void {
      // No-op: this rig owns no listeners and no GPU resources — it exists
      // so the composition root's teardown shape is uniform across both
      // rigs (this one and the chase-cam fallback below).
    },
  };
}

/**
 * D-12's fallback rig: the low, fixed chase-cam offset `src/main.ts`
 * currently hardcodes as a placeholder, promoted to a genuine `CameraRig`
 * implementation. Per CONTEXT.md D-12 this is a real candidate for the
 * SHIPPED camera if the helicopter rig fails plan 03-11's go/no-go gate —
 * not a dev escape hatch. Position and heading are damped with the SAME
 * lambdas the helicopter rig uses, so a playtest comparison judges framing,
 * not smoothing quality.
 */
export function createChaseCameraRig(
  camera: THREE.PerspectiveCamera,
  target: CameraTarget,
  tuning: CameraTuning,
): CameraRig {
  const scratch = makeScratch();
  let headingRad = 0;
  let fovApplied = false;

  function desiredHeadingRad(): number {
    const velocity = target.velocity();
    const forward = target.forward();
    const groundSpeedMs = Math.hypot(velocity.x, velocity.z);
    return blendedHeadingRad(
      { x: velocity.x, z: velocity.z },
      { x: forward.x, z: forward.z },
      groundSpeedMs,
      tuning.heading.blendSpeedMs,
    );
  }

  /** The fixed chase offset never rotates toward vertical — `pitchBiasRad` is always 0 for this rig (`setPitchBiasRad` is a documented no-op below). */
  function applyPose(dtSec: number | null): void {
    const targetPos = target.position();
    computeOffset(
      scratch.offset,
      headingRad,
      tuning.chaseFallback.altitudeM,
      tuning.chaseFallback.distanceM,
      0,
    );
    const desiredX = targetPos.x + scratch.offset.x;
    const desiredY = targetPos.y + scratch.offset.y;
    const desiredZ = targetPos.z + scratch.offset.z;

    if (dtSec === null) {
      camera.position.set(desiredX, desiredY, desiredZ);
    } else {
      camera.position.x = THREE.MathUtils.damp(
        camera.position.x,
        desiredX,
        tuning.damping.positionLambda,
        dtSec,
      );
      camera.position.y = THREE.MathUtils.damp(
        camera.position.y,
        desiredY,
        tuning.damping.positionLambda,
        dtSec,
      );
      camera.position.z = THREE.MathUtils.damp(
        camera.position.z,
        desiredZ,
        tuning.damping.positionLambda,
        dtSec,
      );
    }
    camera.lookAt(targetPos.x, targetPos.y, targetPos.z);

    if (!fovApplied) {
      camera.fov = tuning.chaseFallback.fovDeg;
      camera.updateProjectionMatrix();
      fovApplied = true;
    }
  }

  return {
    kind: "chase",

    update(dtMs: number): void {
      const dtSec = dtMs / 1000;
      const headingDiffRad = wrapAngleRad(desiredHeadingRad() - headingRad);
      headingRad += headingDiffRad * dampFactor(tuning.damping.headingLambda, dtSec);
      applyPose(dtSec);
    },

    snap(): void {
      headingRad = desiredHeadingRad();
      applyPose(null);
    },

    setPitchBiasRad(_rad: number): void {
      // Documented no-op: the D-12 fallback is a fixed low chase offset by
      // design — it has no steepen mitigation to bias. Implemented as a
      // real (empty) method rather than omitted so plan 03-08's occlusion
      // mitigation needs no interface change regardless of which rig is
      // active.
    },

    dispose(): void {
      // No-op: this rig owns no listeners and no GPU resources, mirroring
      // the helicopter rig's own dispose() for a uniform teardown shape.
    },
  };
}
