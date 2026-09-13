/**
 * Config-in / controller-out vehicle factory over Rapier's
 * `DynamicRayCastVehicleController` (D-09, 02-RESEARCH.md Pattern 1).
 *
 * `createVehicle` takes a world, a `VehicleTuning` object and a spawn point,
 * and names nothing "the player" anywhere in its signature or its returned
 * handle — Phase 7/8 constructs pursuers through this exact same call, per
 * D-09's requirement that the controller be generic and reusable rather than
 * player-hardcoded.
 *
 * Layering: may import `@dimforge/rapier3d` and `src/core/`. Must not import
 * `three` and must not touch the DOM or any wall clock. Wheel meshes for the
 * returned handle are built in `src/render/vehicle-view.ts` in the same
 * `FL/FR/RL/RR` index order exported below.
 */
import * as RAPIER from "@dimforge/rapier3d";
import type { InputFrame } from "../core/input-tape";
import { DT } from "../core/sim-clock";
import type { SurfaceType } from "../core/surface-types";
import type { VehicleTuning } from "../core/vehicle-tuning";
import type { SurfaceContext } from "./surface";
import { applyAssists, boxPrincipalInertia } from "./vehicle-assists";

/**
 * Wheel indices. Front pair sits at -Z, rear pair at +Z. This order is a
 * CONTRACT with `src/render/vehicle-view.ts`'s wheel mesh array — the same
 * hazard as `src/physics/debug-scene.ts`'s body/mesh index contract
 * (threat T-01-16). Do not reorder without updating both sides.
 */
export const FL = 0;
export const FR = 1;
export const RL = 2;
export const RR = 3;

/** Suspension raycast direction: straight down in chassis-local space. */
const DIRECTION = { x: 0, y: -1, z: 0 };

/**
 * Wheel axle axis, chassis-local space. Flipping this sign silently INVERTS
 * steering (02-RESEARCH.md "Steering sign, derived and measured") — the
 * sign is asserted in `tests/vehicle.test.ts -t "steer sign"` rather than
 * discovered in the browser.
 */
const AXLE = { x: -1, y: 0, z: 0 };

/** The neutral orientation quaternion, reused for every `setAdditionalMassProperties` call. */
const IDENTITY_ROTATION = { x: 0, y: 0, z: 0, w: 1 };

/** Clamp `v` into `[lo, hi]`. */
function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** Linear interpolation from `a` to `b` at fraction `t`. */
function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** True when two `{x,y,z}` vectors are exactly equal, component-wise. */
function vecEq(
  a: { x: number; y: number; z: number },
  b: { x: number; y: number; z: number },
): boolean {
  return a.x === b.x && a.y === b.y && a.z === b.z;
}

/**
 * Rotate the vector `(x, y, z)` by quaternion `q`, hand-rolled because this
 * layer may not import `three` for `Vector3.applyQuaternion` — the same
 * layering reason `src/physics/debug-scene.ts:133-141` states next to its
 * hand-built spinner quaternion. This comment is what stops a future editor
 * "simplifying" it back into a `three` import.
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

/**
 * One tick's worth of derived vehicle state, read for the HUD, telemetry and
 * the assist layer's tests. Built by hand-rolled quaternion rotation, not
 * `three` (this layer may not import it).
 */
export interface VehicleSample {
  readonly position: { x: number; y: number; z: number };
  readonly rotation: { x: number; y: number; z: number; w: number };
  readonly linvel: { x: number; y: number; z: number };
  readonly angvel: { x: number; y: number; z: number };
  /** `hypot(linvel.x, linvel.z)`, m/s. Never `currentVehicleSpeed()` — Pitfall 1. */
  readonly groundSpeedMs: number;
  /** `linvel . chassisForward`, m/s, signed. */
  readonly forwardSpeedMs: number;
  /** Signed slip angle, `atan2(lateral, forward)`, radians. */
  readonly slipAngleRad: number;
  /** Angle between chassis up and world up, degrees, always >= 0. */
  readonly tiltDeg: number;
  /** Signed roll about the forward axis, `asin(chassisRight.y)`, degrees. */
  readonly rollDeg: number;
  /** Wheels touching the ground this tick, 0..4. Valid only after `tick()`. */
  readonly contacts: number;
}

/**
 * A vehicle built into a world. Generic per D-09 — nothing here assumes "the
 * player" is the only caller.
 */
export interface Vehicle {
  readonly body: RAPIER.RigidBody;
  readonly controller: RAPIER.DynamicRayCastVehicleController;
  /** Cached principal inertia, kg*m^2. Recomputed by `applyTuning` when mass or halfExtents change. */
  readonly inertia: { x: number; y: number; z: number };
  /**
   * Each wheel's currently-resolved surface, `FL/FR/RL/RR` order. Allocated
   * ONCE at `createVehicle` time and mutated in place every tick that a
   * `SurfaceContext` is supplied (never reallocated) — same discipline as
   * `TransformCache`'s typed-array buffers. Initialised to `"tarmac"`.
   * Unchanged (stays at its previous values) on any tick called without a
   * `surfaces` argument.
   */
  readonly wheelSurfaces: readonly SurfaceType[];
  /**
   * Advance one fixed tick. Called BEFORE `world.step()`, per
   * 02-RESEARCH.md Pattern 2. `surfaces` is OPTIONAL — when omitted, the
   * per-wheel surface-grip block is skipped entirely (not run with an
   * all-1.0 profile), so there is provably zero numeric change on the
   * Phase 2 path (plan 03-03 T-03-09).
   */
  tick(frame: InputFrame, tuning: VehicleTuning, surfaces?: SurfaceContext): void;
  /** Live retune, no rebuild. Every wheel setter is per-frame safe; mass/CoM only reapplied on change (Pitfall 10). */
  applyTuning(tuning: VehicleTuning): void;
  /** Remove the vehicle controller from its world. */
  dispose(): void;
}

/**
 * Build a tuned vehicle into `world` at `spawn`. Takes a world, a tuning
 * object and a spawn point in — and produces a controller out — with no
 * reference to "the player" (D-09): Phase 7/8 constructs pursuers through
 * this exact same call.
 */
export function createVehicle(
  world: RAPIER.World,
  tuning: VehicleTuning,
  spawn: { x: number; y: number; z: number },
): Vehicle {
  const c = tuning.chassis;

  const body = world.createRigidBody(
    RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(spawn.x, spawn.y, spawn.z)
      // Rapier only auto-wakes the chassis when engine_force is STRICTLY
      // positive, and this car's forward is -Z, so it drives on NEGATIVE
      // engine force — the auto-wake condition never fires and a parked car
      // would ignore the throttle (02-RESEARCH.md Pitfall 9).
      .setCanSleep(false)
      // 120 mph is 53.6 m/s, i.e. 0.894 m of travel per fixed tick at the
      // imported DT — any collider thinner than that is a tunnelling
      // candidate (02-RESEARCH.md Pitfall 6).
      .setCcdEnabled(true)
      .setLinearDamping(c.linearDamping)
      .setAngularDamping(c.angularDamping),
  );

  world.createCollider(
    RAPIER.ColliderDesc.cuboid(c.halfExtents.x, c.halfExtents.y, c.halfExtents.z).setFriction(0.8),
    body,
  );

  // Cache the principal inertia — the assists scale their gains against it,
  // so it must be recomputed whenever mass or halfExtents change (Pitfall 10).
  const inertia = boxPrincipalInertia(c.mass, c.halfExtents);
  body.setAdditionalMassProperties(c.mass, c.comOffset, inertia, IDENTITY_ROTATION, true);
  // DEVIATION / Rule 1 fix (discovered empirically, not in 02-RESEARCH.md):
  // the shipped @dimforge/rapier3d@0.20.0 `.d.ts` states the TOTAL mass
  // properties (additional + collider-derived) are only updated "at the
  // next physics step" after `setAdditionalMassProperties`. Without this
  // explicit recompute, `applyTorqueImpulse` on tick 0 (before the first
  // `world.step()`) divides by the tiny collider-default inertia instead of
  // the cached `inertia` above — measured to inflate the assists' angular
  // response by roughly two orders of magnitude on that first tick.
  body.recomputeMassPropertiesFromColliders();
  let lastMass = c.mass;
  let lastComOffset = { ...c.comOffset };
  let lastHalfExtents = { ...c.halfExtents };

  const vc = world.createVehicleController(body);
  // Assignment to a WRITE-ONLY accessor misnamed in the shipped
  // @dimforge/rapier3d@0.20.0 bindings (`get indexForwardAxis` /
  // `set setIndexForwardAxis`) — not a typo (02-RESEARCH.md Pitfall 2). This
  // affects ONLY the sign of `currentVehicleSpeed()`; driving direction
  // comes entirely from the `axleCs`/`directionCs` passed to `addWheel`.
  vc.setIndexForwardAxis = 2;

  const w0 = tuning.wheels;
  const conn: readonly { x: number; y: number; z: number }[] = [
    { x: -w0.halfTrack, y: w0.connectionY, z: -w0.halfWheelbase }, // FL
    { x: w0.halfTrack, y: w0.connectionY, z: -w0.halfWheelbase }, // FR
    { x: -w0.halfTrack, y: w0.connectionY, z: w0.halfWheelbase }, // RL
    { x: w0.halfTrack, y: w0.connectionY, z: w0.halfWheelbase }, // RR
  ];
  for (let i = 0; i < 4; i++) {
    vc.addWheel(conn[i], DIRECTION, AXLE, w0.suspensionRestLength, w0.radius);
  }

  /**
   * Live-retune every per-wheel property. Rapier's own `WheelTuning`
   * defaults are Bullet-era demo values and every one of these seven is
   * wrong for a car (02-RESEARCH.md Pitfalls 3, 4, 5) — set them ALL
   * explicitly on every call, never rely on a default.
   */
  function applyTuning(t: VehicleTuning): void {
    const w = t.wheels;
    for (let i = 0; i < 4; i++) {
      vc.setWheelSuspensionStiffness(i, w.suspensionStiffness);
      vc.setWheelSuspensionCompression(i, w.suspensionCompression);
      vc.setWheelSuspensionRelaxation(i, w.suspensionRelaxation);
      vc.setWheelMaxSuspensionTravel(i, w.maxSuspensionTravel);
      vc.setWheelMaxSuspensionForce(i, w.maxSuspensionForce);
      vc.setWheelFrictionSlip(i, w.frictionSlip);
      vc.setWheelSideFrictionStiffness(i, i < 2 ? w.frontSideFriction : w.rearSideFriction);
    }

    // `setAdditionalMassProperties` overrides ALL previous additional mass
    // properties and invalidates the cached inertia, so calling it every
    // frame from a slider drag produces discontinuities (Pitfall 10). Only
    // call it when mass, comOffset or halfExtents actually changed since
    // the last call — never rebuild the vehicle on retune.
    const cc = t.chassis;
    const shapeOrMassChanged = cc.mass !== lastMass || !vecEq(cc.halfExtents, lastHalfExtents);
    const comChanged = !vecEq(cc.comOffset, lastComOffset);
    if (shapeOrMassChanged || comChanged) {
      if (shapeOrMassChanged) {
        const next = boxPrincipalInertia(cc.mass, cc.halfExtents);
        inertia.x = next.x;
        inertia.y = next.y;
        inertia.z = next.z;
      }
      body.setAdditionalMassProperties(cc.mass, cc.comOffset, inertia, IDENTITY_ROTATION, true);
      // See the matching comment at construction time: without this, the
      // retuned mass/inertia would not take effect until the next
      // `world.step()`, one tick after the panel's `onFinishChange` fires.
      body.recomputeMassPropertiesFromColliders();
      lastMass = cc.mass;
      lastComOffset = { ...cc.comOffset };
      lastHalfExtents = { ...cc.halfExtents };
    }
  }

  applyTuning(tuning);

  // Allocated ONCE, mutated in place every surfaced tick — never
  // reallocated. See the matching doc comment on `Vehicle.wheelSurfaces`.
  const wheelSurfaces: SurfaceType[] = ["tarmac", "tarmac", "tarmac", "tarmac"];

  return {
    body,
    controller: vc,
    inertia,
    wheelSurfaces,

    tick(frame: InputFrame, t: VehicleTuning, surfaces?: SurfaceContext): void {
      // The order below is 02-RESEARCH.md Pattern 2 and is LOAD-BEARING:
      // `updateVehicle` raycasts, computes suspension/tire impulses and
      // writes them onto the chassis; telemetry is valid only after it
      // runs, and the assists must read THIS tick's contact/load state.

      // 0. Per-wheel surface grip (03-RESEARCH.md Pattern 1), inserted at
      // the TOP of tick, BEFORE steering. `surfaces` is OPTIONAL: when
      // omitted this whole block is skipped — not run with an all-1.0
      // profile — so the Phase 2 path is provably byte-identical (T-03-09).
      //
      // The per-wheel ground-collider read below reflects the PREVIOUS
      // tick's raycast (it is only refreshed by THIS tick's own
      // `updateVehicle` call, further down, step 5) — a one-tick (~16.6ms)
      // lag between crossing a surface boundary and the new friction
      // values taking effect. This is 03-RESEARCH.md Pitfall 2, intentional
      // and accepted: do NOT move `updateVehicle` earlier or add a second
      // call to get a "fresher" read, that would break the load-bearing
      // tick order this whole comment block sits inside of.
      //
      // Rear wheels' per-wheel lateralGrip multiplier is captured here but
      // APPLIED in step 4 below, composed onto (never replacing) the
      // handbrake/power-oversteer blend that step already computes — see
      // the comment there.
      const rearLateralGrip: number[] = [1, 1];
      if (surfaces) {
        for (let i = 0; i < 4; i++) {
          const ground = vc.wheelGroundObject(i);
          const surface = surfaces.map.lookup(ground?.handle);
          wheelSurfaces[i] = surface;
          const profile = surfaces.profiles[surface];
          vc.setWheelFrictionSlip(i, t.wheels.frictionSlip * profile.forwardGrip);
          if (i < 2) {
            vc.setWheelSideFrictionStiffness(i, t.wheels.frontSideFriction * profile.lateralGrip);
          } else {
            rearLateralGrip[i - 2] = profile.lateralGrip;
          }
        }
      }

      // 1. Steering. InputFrame.steer is -1 = LEFT / +1 = RIGHT; with
      // forward = local -Z, up = +Y and axleCs = {-1,0,0}, a POSITIVE
      // setWheelSteering angle produces a POSITIVE yaw rate about +Y, which
      // turns LEFT — measured setWheelSteering(+0.2618) -> angvel.y =
      // +0.25 rad/s (02-RESEARCH.md "Steering sign, derived and measured").
      // Hence the leading minus.
      const steerAngle = -frame.steer * t.drive.maxSteerLock;
      vc.setWheelSteering(FL, steerAngle);
      vc.setWheelSteering(FR, steerAngle);

      // 2. Engine force, zeroed while braking. Rapier's friction solver is
      // `if engineForce != 0 { rollingFriction = engineForce * dt } else {
      // ...brake path... }`, so a non-zero engine force silently disables
      // the brake on that wheel — measured, throttle + full brake together
      // went 40.1 mph -> 41.1 mph after 2s, versus 40.1 -> -0.2 with brake
      // alone (02-RESEARCH.md Pitfall 7). Zeroing engine force while
      // braking is mandatory, not defensive. Reverse (below) must ALSO zero
      // the BRAKE, not just the engine force: Pitfall 7 only disables the
      // brake on the wheels carrying engine force (the rears), so leaving
      // front brake impulse on while reversing would hold the car against
      // its own reverse drive.
      //
      // Reverse is DERIVED from physics state (this tick's chassis-forward
      // speed) rather than from a new `InputFrame` field — `InputFrame`'s
      // shape is frozen by `tests/determinism.test.ts` and the recorded-tape
      // contract (src/core/input-tape.ts). Deriving it here instead keeps
      // reverse a pure function of the SAME inputs every other branch of this
      // tick already reads, so determinism is preserved with no tape-format
      // change.
      const q = body.rotation();
      const forward = rotateVec(q, 0, 0, -1);
      const linvel = body.linvel();
      const forwardSpeedMs = linvel.x * forward.x + linvel.y * forward.y + linvel.z * forward.z;
      const braking = frame.brake > 0;
      const reversing = braking && forwardSpeedMs < t.drive.reverseEngageSpeedMs;
      const engineForce = !braking
        ? -frame.throttle * t.drive.engineForcePerRearWheel
        : reversing
          ? frame.brake * t.drive.reverseEngineForcePerRearWheel
          : 0;
      vc.setWheelEngineForce(RL, engineForce);
      vc.setWheelEngineForce(RR, engineForce);

      // 3. Brake, all four wheels — zero while reversing (see the comment
      // above step 2).
      const brakeImpulse = reversing ? 0 : frame.brake * t.drive.brakeImpulsePerWheel;
      for (let i = 0; i < 4; i++) {
        vc.setWheelBrake(i, brakeImpulse);
      }

      // 4. Rear side friction: handbrake, or the authored throttle-
      // oversteer term. Power oversteer is NOT emergent — measured,
      // throttle cannot break the rear loose at ANY engine force
      // (4000 N -> 1.8deg slip, 8000 N -> 0.8deg, 25000 N -> 0.4deg)
      // because the friction-circle clamp scales the side impulse down
      // proportionally instead of releasing it. SC1's "provoke oversteer
      // with throttle OR handbrake" therefore requires this authored term.
      //
      // COMPOSITION, not replacement (03-RESEARCH.md Pattern 1 / this
      // plan's threat T-03-09): the surface's lateralGrip multiplier SCALES
      // this blended value, it never replaces it. Step 0 deliberately does
      // NOT write RL/RR's side friction itself — if it did, this block
      // would silently overwrite it and discard the surface effect on
      // exactly the two wheels the game's oversteer feel depends on. When
      // `surfaces` is undefined, `rearLateralGrip` stays at its `[1, 1]`
      // initialiser (an explicit local default, not a second code path),
      // so this line is unchanged from the Phase 2 behaviour.
      const rearSfs = frame.handbrake
        ? t.drive.handbrakeRearSideFriction
        : lerp(
            t.wheels.rearSideFriction,
            t.drive.handbrakeRearSideFriction,
            clamp(t.drive.powerOversteerGain * frame.throttle * Math.abs(frame.steer), 0, 1),
          );
      vc.setWheelSideFrictionStiffness(RL, rearSfs * rearLateralGrip[0]);
      vc.setWheelSideFrictionStiffness(RR, rearSfs * rearLateralGrip[1]);

      // 5. Solve the vehicle — writes suspension + tire impulses onto the
      // chassis body. Imported DT, never a literal.
      vc.updateVehicle(DT);

      // 6. Fresh telemetry — valid only AFTER updateVehicle.
      let contacts = 0;
      for (let i = 0; i < 4; i++) {
        if (vc.wheelIsInContact(i)) contacts++;
      }

      // 7. Assists — impulses accumulate onto the same buffer world.step()
      // consumes next. The caller (src/loop.ts via applyInput) then calls
      // world.step().
      applyAssists(body, vc, contacts, t.assists, inertia);
    },

    applyTuning,

    dispose(): void {
      world.removeVehicleController(vc);
    },
  };
}

/**
 * Sample derived state for one vehicle. Vectors are built by hand-rolled
 * quaternion rotation — this layer may not import `three`.
 */
export function sampleVehicle(v: Vehicle): VehicleSample {
  const position = v.body.translation();
  const q = v.body.rotation();
  const linvel = v.body.linvel();
  const angvel = v.body.angvel();

  const forward = rotateVec(q, 0, 0, -1);
  const up = rotateVec(q, 0, 1, 0);
  const right = rotateVec(q, 1, 0, 0);

  const groundSpeedMs = Math.hypot(linvel.x, linvel.z);
  const forwardSpeedMs = linvel.x * forward.x + linvel.y * forward.y + linvel.z * forward.z;
  const lateralSpeedMs = linvel.x * right.x + linvel.y * right.y + linvel.z * right.z;
  const slipAngleRad = Math.atan2(lateralSpeedMs, forwardSpeedMs);
  const tiltDeg = (Math.acos(clamp(up.y, -1, 1)) * 180) / Math.PI;
  const rollDeg = (Math.asin(clamp(right.y, -1, 1)) * 180) / Math.PI;

  let contacts = 0;
  for (let i = 0; i < 4; i++) {
    if (v.controller.wheelIsInContact(i)) contacts++;
  }

  return {
    position: { x: position.x, y: position.y, z: position.z },
    rotation: { x: q.x, y: q.y, z: q.z, w: q.w },
    linvel: { x: linvel.x, y: linvel.y, z: linvel.z },
    angvel: { x: angvel.x, y: angvel.y, z: angvel.z },
    groundSpeedMs,
    forwardSpeedMs,
    slipAngleRad,
    tiltDeg,
    rollDeg,
    contacts,
  };
}
