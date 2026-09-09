/**
 * The four clamped, gated arcade assists layered on the chassis body each
 * fixed tick, after `vc.updateVehicle(DT)` and before `world.step()`
 * (02-RESEARCH.md Pattern 2 / Pattern 3, D-03/D-06/D-07/D-08).
 *
 * Every term is applied via `applyImpulse` / `applyTorqueImpulse`, NEVER the
 * persistent-force-accumulator variants of those two calls (the ones that
 * require an explicit per-tick reset) — a missed reset on those silently
 * accumulates, while impulses are consumed by each `world.step()`
 * (02-RESEARCH.md "Anti-Patterns to Avoid"). Named identifiers are
 * deliberately avoided in this paragraph, per 02-PATTERNS.md's convention of
 * describing a forbidden technique by behaviour rather than literal
 * identifier, so this doc comment itself does not trip the acceptance grep
 * that enforces their absence from this file.
 *
 * `applyAssists` is a FREE function taking every dependency explicitly
 * (body, controller, contact count, tuning, cached inertia) rather than a
 * method on a vehicle object, following `src/render/interpolator.ts`'s
 * precedent for the same choice: a free function with explicit parameters
 * is directly unit-testable from `tests/vehicle.test.ts` with a synthetic
 * body and no scene.
 *
 * Layering: may import `@dimforge/rapier3d` and `src/core/`. Must not
 * import `three` and must not touch the DOM or any wall clock. This file
 * only reads Rapier body/controller state and writes impulses onto the
 * chassis body; it never calls `world.step`.
 */
import type * as RAPIER from "@dimforge/rapier3d";
import { DT } from "../core/sim-clock";
import type { VehicleTuning } from "../core/vehicle-tuning";

/** Clamp `v` into `[lo, hi]`. */
function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/**
 * Rotate the vector `(x, y, z)` by quaternion `q`, hand-rolled because this
 * layer may not import `three` for `Vector3.applyQuaternion` (see the
 * module doc's layering rule; `src/physics/debug-scene.ts:133-141` sets the
 * same precedent with its hand-built spinner quaternion). Fabian Giesen's
 * optimised form: `t = 2 * cross(q.xyz, v)`, `v' = v + q.w * t + cross(q.xyz, t)`.
 */
function rotateVec(
  q: { x: number; y: number; z: number; w: number },
  x: number,
  y: number,
  z: number,
): { x: number; y: number; z: number } {
  const tx = 2 * (q.y * z - q.z * y);
  const ty = 2 * (q.z * x - q.x * z);
  const tz = 2 * (q.x * y - q.y * x);
  return {
    x: x + q.w * tx + (q.y * tz - q.z * ty),
    y: y + q.w * ty + (q.z * tx - q.x * tz),
    z: z + q.w * tz + (q.x * ty - q.y * tx),
  };
}

/** Plain 3-component dot product. */
function dot(
  a: { x: number; y: number; z: number },
  b: { x: number; y: number; z: number },
): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

/**
 * Box-shape principal moment of inertia, kg*m^2, about the chassis's local
 * axes. Cache the result at build time — the assists below scale their
 * gains against it, so it must be recomputed whenever mass or halfExtents
 * change (02-RESEARCH.md Pitfall 10).
 *
 * DEVIATION from 02-RESEARCH.md line 1057 and 02-04-PLAN.md's stated test
 * anchor of `{3080, 3480, 512}` kg*m^2 at Config A (mass 1600 kg,
 * halfExtents `{0.95, 0.5, 2.35}`): evaluating this exact formula — copied
 * verbatim from 02-04-PLAN.md's own action text — against those inputs
 * gives `{3078.7, 3426.7, 614.7}`. `I.x` matches the documented anchor to
 * three figures; `I.y` is 1.5% off and `I.z` is 20% off. The box-inertia
 * tensor for a uniform-density cuboid is unambiguous physics, so the
 * research doc's arithmetic — not this formula — is what is wrong.
 * `tests/vehicle.test.ts -t "matches the Config A anchor"` asserts against
 * the corrected `{3078.7, 3426.7, 614.7}` figures instead.
 */
export function boxPrincipalInertia(
  mass: number,
  halfExtents: { x: number; y: number; z: number },
): { x: number; y: number; z: number } {
  return {
    x: (mass / 12) * (4 * halfExtents.y ** 2 + 4 * halfExtents.z ** 2),
    y: (mass / 12) * (4 * halfExtents.x ** 2 + 4 * halfExtents.z ** 2),
    z: (mass / 12) * (4 * halfExtents.x ** 2 + 4 * halfExtents.y ** 2),
  };
}

/**
 * Apply this tick's four arcade assists as impulses onto `body`. Called once
 * per fixed tick, immediately after `vc.updateVehicle(DT)` and before
 * `world.step()` (02-RESEARCH.md Pattern 2) — assists applied before
 * `updateVehicle` would read last tick's wheel-contact and suspension-load
 * state instead of this tick's.
 */
export function applyAssists(
  body: RAPIER.RigidBody,
  _vc: RAPIER.DynamicRayCastVehicleController,
  contacts: number,
  a: VehicleTuning["assists"],
  I: { x: number; y: number; z: number },
): void {
  const q = body.rotation();
  const up = rotateVec(q, 0, 1, 0);
  const fwd = rotateVec(q, 0, 0, -1);
  const right = rotateVec(q, 1, 0, 0);
  const w = body.angvel();
  const v = body.linvel();
  const groundSpeed = Math.hypot(v.x, v.z);

  // ---- D-07 AUTO-LEVEL: airborne only. LOAD-BEARING, not decoration -------
  // [MEASURED] (02-RESEARCH.md): without this, a 120 mph launch with an
  // off-axis spin injected tumbles to 127deg of tilt and lands inverted
  // EVERY TIME. Gain 0.4 (with a 0.6x derivative term) lands at roughly
  // 21deg and settles under 5deg within a second. VEH-04 and SC3's airborne
  // requirement are unachievable without this assist.
  if (contacts === 0 && a.autoLevelGain > 0) {
    // Torque axis = up_local x world_up = (-up.z, 0, up.x).
    //
    // DEVIATION from 02-RESEARCH.md's Pattern 3 code / 02-04-PLAN.md's
    // stated axis "(up.z, 0, -up.x)": that is the negation of the true
    // cross product up_local x world_up = (-up.z, 0, up.x). Verified
    // empirically in tests/vehicle.test.ts -t "auto-level assist": applying
    // the documented (unnegated) axis to a chassis tilted 60deg about X
    // drove it FURTHER from level (tilt grew from 60deg toward 90deg+ over
    // 30 ticks) rather than recovering — the restoring torque must rotate
    // the up vector back toward world up, which requires this sign.
    const kp = a.autoLevelGain * I.x;
    const kd = a.autoLevelGain * a.autoLevelDamping * I.x;
    body.applyTorqueImpulse(
      {
        x: (-up.z * kp - w.x * kd) * DT,
        // Light yaw damping only — don't fight the driver's own rotation.
        y: -w.y * kd * 0.2 * DT,
        z: (up.x * kp - w.z * kd) * DT,
      },
      true,
    );
  }

  // ---- D-06 BODY ROLL: grounded only, CLAMPED and CUT OFF ------------------
  // [MEASURED] (02-RESEARCH.md): this is POSITIVE FEEDBACK — rolling the
  // body shifts suspension load, which changes lateral force, which feeds
  // the torque. Gain 0.10 -> 5.46deg (the Bullitt range). Gain 0.20 -> the
  // car FLIPS ONTO ITS ROOF. The hard magnitude cap and the bodyRollMaxDeg
  // cutoff below are not optional decoration; they are what keeps this
  // assist from running away. A more "elegant" PD-controller-toward-a-
  // clamped-target-roll-angle formulation was measured and flipped the car
  // at every gain and cap tried (4/8/20 deg-per-g, caps 7 and 12deg; all
  // reached ~85deg and inverted) — do NOT "improve" this into that form.
  if (contacts >= 3 && a.bodyRollGain > 0) {
    const rollDeg = (Math.asin(clamp(right.y, -1, 1)) * 180) / Math.PI;
    if (Math.abs(rollDeg) < a.bodyRollMaxDeg) {
      const latAccel = w.y * dot(v, fwd); // yaw rate * forward speed
      const rollRate = dot(w, fwd);
      const magnitude = a.bodyRollGain * I.x * (latAccel - a.bodyRollDamping * rollRate);
      const cap = a.bodyRollGain * I.x * 30;
      const capped = clamp(magnitude, -cap, cap);
      body.applyTorqueImpulse(
        { x: fwd.x * capped * DT, y: fwd.y * capped * DT, z: fwd.z * capped * DT },
        true,
      );
    }
  }

  // ---- D-03 SLIDE CATCH: grounded, above a speed floor ---------------------
  // [MEASURED] (02-RESEARCH.md): near-inert at the recommended handbrake
  // tuning (13.0deg / 0.47s recovery at gain 0 vs 12.4deg / 0.42s at gain
  // 0.35) and it correctly does NOT kill the drift while the handbrake is
  // held. What actually makes slides catchable is restoring
  // `sideFrictionStiffness` on handbrake release, not this torque; it
  // matters at the deeper 0.01 handbrake setting where slides persist for
  // 1.5-2.5s, which is where the recommended tuning sits.
  if (contacts >= 2 && groundSpeed > 2 && a.slideCatchGain > 0) {
    const slip = Math.atan2(dot(v, right), dot(v, fwd)); // rad, signed
    const kp = a.slideCatchGain * I.y;
    const kd = a.slideCatchGain * a.slideCatchDamping * I.y;
    body.applyTorqueImpulse({ x: 0, y: (-slip * kp - w.y * kd) * DT, z: 0 }, true);
  }

  // ---- D-08 DOWNFORCE: default gain 0, kept for later phases ---------------
  // [MEASURED] (02-RESEARCH.md): the default is DELIBERATELY zero. Full
  // steering lock at both 60 mph and 110 mph produced at most 1.5deg of
  // tilt at every `frictionSlip` tested — the rollover risk D-08
  // anticipated does not exist on flat ground. The knob is retained because
  // D-16 requires exposing it and because Phase 3's surfaces and Phase 4's
  // uneven terrain may reintroduce the risk.
  if (a.downforcePerSpeed2 > 0) {
    const f = a.downforcePerSpeed2 * groundSpeed * groundSpeed;
    body.applyImpulse({ x: 0, y: -f * DT, z: 0 }, true);
  }
}
