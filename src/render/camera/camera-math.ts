/**
 * Pure TypeScript camera maths. This file imports NOTHING — not `three`, not
 * `@dimforge/rapier3d` — so it runs under `vitest.config.ts`'s
 * `environment: "node"` harness with zero setup, exactly like
 * `src/physics/vehicle-assists.ts` (see that file's own doc comment for the
 * same rationale: directly unit-testable with hand-built inputs, no scene,
 * no WASM).
 *
 * `dampFactor` is deliberately hand-written rather than delegated to
 * `THREE.MathUtils.damp`: `damp()` applies the factor to a scalar and does
 * not expose the factor itself, but `THREE.Quaternion.slerp` in plan 03-04
 * needs the raw `t`. `THREE.MathUtils.damp` is still the required call for
 * scalar damping in the rig itself — this function is the rotation-side
 * companion, not a replacement.
 */

/** Clamp `v` into `[lo, hi]`. */
function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/**
 * Classic smoothstep: `t*t*(3-2*t)` with the input clamped to [0,1] first.
 * Used for blend weights that must have zero derivative at both ends (no
 * visible snap entering/leaving a transition).
 */
export function smoothstep01(t: number): number {
  const c = clamp(t, 0, 1);
  return c * c * (3 - 2 * c);
}

/**
 * Frame-rate-independent damping factor, the frame-rate-independent form
 * named in 03-RESEARCH.md Pattern 3: `1 - exp(-lambda * dtSec)`. Guarded so
 * a non-positive `dtSec` (e.g. a stalled/rebaselined frame) returns 0 —
 * "no movement this frame" — rather than a negative or NaN factor.
 */
export function dampFactor(lambda: number, dtSec: number): number {
  if (dtSec <= 0) return 0;
  return 1 - Math.exp(-lambda * dtSec);
}

/** A 2D vector in the XZ ground plane. */
interface Vec2XZ {
  readonly x: number;
  readonly z: number;
}

/** Normalise `v`; returns `null` if `v` is (numerically) zero-length. */
function normalizeXZ(v: Vec2XZ): Vec2XZ | null {
  const len = Math.hypot(v.x, v.z);
  if (len < 1e-9) return null;
  return { x: v.x / len, z: v.z / len };
}

/**
 * Blend the vehicle's velocity heading and chassis-forward heading into a
 * single yaw angle (radians, about +Y), following CAM-01's "follows
 * velocity heading, not chassis yaw" requirement above a speed threshold,
 * while never producing the atan2-on-noise instability 03-RESEARCH.md warns
 * about at near-zero speed.
 *
 * This function blends VECTORS and then takes one `Math.atan2`, never blends
 * two angles — angle blending breaks at the +/-PI wraparound, which is the
 * project's own established rule (`src/render/interpolator.ts`'s slerp
 * discipline, restated in 03-RESEARCH.md "Don't Hand-Roll").
 *
 * Uses the `Math.atan2(x, z)` argument order (X first, Z second) so the
 * returned angle is a yaw about `+Y` consistent with the vehicle's `-Z`
 * forward convention — swapping the arguments silently mirrors the camera.
 */
export function blendedHeadingRad(
  velocityXZ: { x: number; z: number },
  chassisForwardXZ: { x: number; z: number },
  groundSpeedMs: number,
  blendSpeedMs: number,
): number {
  // A zero-length chassis-forward input is not expected (a rigid body always
  // has SOME orientation), but guard it the same way as velocity so this
  // function never throws on a degenerate input.
  const chassisUnit = normalizeXZ(chassisForwardXZ) ?? { x: 0, z: 1 };
  // A zero-length velocity normalises to the chassis-forward vector — a
  // parked car has no velocity heading of its own.
  const velocityUnit = normalizeXZ(velocityXZ) ?? chassisUnit;

  // Guard blendSpeedMs <= 0 by treating the weight as 1 (pure velocity
  // heading) rather than dividing by zero/negative.
  const w = blendSpeedMs <= 0 ? 1 : smoothstep01(groundSpeedMs / blendSpeedMs);

  let blendedX = chassisUnit.x + (velocityUnit.x - chassisUnit.x) * w;
  let blendedZ = chassisUnit.z + (velocityUnit.z - chassisUnit.z) * w;

  // Exactly-anti-parallel case (or near it) at a mid blend weight: the two
  // unit vectors can partially or fully cancel, producing a near-zero-length
  // blended vector whose atan2 is numerically unstable. Fall back to the
  // chassis-forward vector, matching the near-zero-speed fallback above.
  if (Math.hypot(blendedX, blendedZ) < 1e-6) {
    blendedX = chassisUnit.x;
    blendedZ = chassisUnit.z;
  }

  return Math.atan2(blendedX, blendedZ);
}

/** The camera rig's altitude/distance/FOV triple at a given point on the speed curve. */
export interface CameraFraming {
  readonly altitudeM: number;
  readonly distanceM: number;
  readonly fovDeg: number;
}

/**
 * A low-speed -> high-speed `CameraFraming` curve. `distanceM` exists
 * separately from `altitudeM` because the helicopter rig is a high ANGLE,
 * not a top-down: both legs of the offset must scale together or the pitch
 * angle drifts with speed. `highSpeedMs` is intended to be aligned to the
 * speedometer's existing 120 mph amber transition (53.64 m/s,
 * `src/hud/speedometer.ts`'s `REDLINE_MPH`) so the camera stops changing at
 * the same speed the gauge changes colour — the actual default VALUES for
 * this curve live in `src/core/camera-tuning.ts` (plan 03-04), matching the
 * way `src/physics/vehicle-assists.ts` takes its gains as parameters while
 * `src/core/vehicle-tuning.ts` owns the numbers. This file never hardcodes
 * curve values.
 */
export interface CameraSpeedCurve {
  readonly lowSpeedMs: number;
  readonly highSpeedMs: number;
  readonly low: CameraFraming;
  readonly high: CameraFraming;
}

/**
 * Linear-clamped speed factor: 0 at or below `lowMs`, 1 at or above `highMs`,
 * linear in between. Guarded against a degenerate `highMs === lowMs` range
 * (returns 0 rather than dividing by zero).
 */
export function speedFactor01(speedMs: number, lowMs: number, highMs: number): number {
  const range = highMs - lowMs;
  if (range <= 0) return 0;
  return clamp((speedMs - lowMs) / range, 0, 1);
}

/**
 * Interpolate a `CameraSpeedCurve`'s low/high `CameraFraming` triples by
 * `speedMs`. Non-finite `speedMs` (e.g. `NaN`) is treated as `curve.lowSpeedMs`
 * before anything else runs — a `NaN` reaching `camera.fov` +
 * `updateProjectionMatrix()` produces a blank canvas with no console error,
 * which is the hardest class of camera bug to diagnose.
 */
export function framingForSpeed(speedMs: number, curve: CameraSpeedCurve): CameraFraming {
  const safeSpeedMs = Number.isFinite(speedMs) ? speedMs : curve.lowSpeedMs;
  const t = speedFactor01(safeSpeedMs, curve.lowSpeedMs, curve.highSpeedMs);
  return {
    altitudeM: curve.low.altitudeM + (curve.high.altitudeM - curve.low.altitudeM) * t,
    distanceM: curve.low.distanceM + (curve.high.distanceM - curve.low.distanceM) * t,
    fovDeg: curve.low.fovDeg + (curve.high.fovDeg - curve.low.fovDeg) * t,
  };
}
