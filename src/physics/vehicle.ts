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
import { engineForceScale, REVERSE_TOP_MS, steerLockScale } from "../core/drivetrain";
import type { InputFrame } from "../core/input-tape";
import { DT } from "../core/sim-clock";
import type { SurfaceType } from "../core/surface-types";
import { frontDriveThrustN, wheelEngineForces } from "../core/vehicle-class";
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

/** Physics-owned upright placement supplied by an authored spawn or checkpoint. */
export interface VehiclePose {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly headingRad: number;
}

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
/** Peak yaw acceleration of the flick kick at full blend, rad/s^2. */
const FLICK_YAW_ACCEL = 8;

/** Pivot turn: fully active below this ground speed, m/s... */
const PIVOT_FULL_SPEED_MS = 5;
/** ...fading linearly to zero at this speed, and never engaged at or above it. */
const PIVOT_ZERO_SPEED_MS = 8;
/** Pivot turn: steer / throttle level that counts as "full". */
const PIVOT_FULL_INPUT = 0.8;
/** Pivot turn: seconds full steer + throttle must be held before it engages. */
const PIVOT_HOLD_SEC = 0.3;
/** Pivot turn: first-order time constants, seconds. */
const PIVOT_TAU_OUT = 0.1;
const PIVOT_TAU_YAW = 0.1;
const PIVOT_TAU_CAP = 0.08;
const PIVOT_TAU_DAMP = 0.15;
const PIVOT_TAU_REAR = 0.05;
/** Below this engagement the pivot is snapped fully off (first-order filters never reach 0). */
const PIVOT_OFF_EPS = 0.002;

const IDENTITY_ROTATION = { x: 0, y: 0, z: 0, w: 1 };

/** Clamp `v` into `[lo, hi]`. */
function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** Linear interpolation from `a` to `b` at fraction `t`. */
/** Smoothstep of an already-0..1 value: zero slope at both ends. */
function smoothstep01(x: number): number {
  return x * x * (3 - 2 * x);
}

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
  readonly telemetry: VehicleSample;
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
  /** Reset the existing chassis in place to an authored upright pose. */
  resetPose(pose: VehiclePose): void;
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
  frontDriveShare = 0,
): Vehicle {
  if (!Number.isFinite(frontDriveShare) || frontDriveShare < 0 || frontDriveShare > 1) {
    throw new RangeError(`frontDriveShare must be finite and within 0..1, got ${frontDriveShare}`);
  }
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

  function resetPose(pose: VehiclePose): void {
    if (
      !Number.isFinite(pose.x) ||
      !Number.isFinite(pose.y) ||
      !Number.isFinite(pose.z) ||
      !Number.isFinite(pose.headingRad)
    ) {
      throw new Error("Vehicle.resetPose: pose values must be finite");
    }
    body.setTranslation({ x: pose.x, y: pose.y, z: pose.z }, true);
    body.setRotation(
      { x: 0, y: Math.sin(pose.headingRad / 2), z: 0, w: Math.cos(pose.headingRad / 2) },
      true,
    );
    body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    body.wakeUp();
    steerSwing = 0;
    flickEnv = 0;
    pivotHold = 0;
    pivotE = 0;
    pivotRear = 0;
    pivotDir = 0;
  }

  // Allocated ONCE, mutated in place every surfaced tick — never
  // reallocated. See the matching doc comment on `Vehicle.wheelSurfaces`.
  // Smoothed steer input (weight swing) for the flick; see step 4.
  let steerSwing = 0;
  let flickEnv = 0;
  // Pivot turn state (see step 4 and 5d). All zero = inert.
  let pivotHold = 0;
  let pivotE = 0;
  let pivotRear = 0;
  let pivotDir = 0;
  const wheelSurfaces: SurfaceType[] = ["tarmac", "tarmac", "tarmac", "tarmac"];
  let telemetry = sampleVehicle({ body, controller: vc } as Vehicle);

  return {
    body,
    controller: vc,
    get telemetry(): VehicleSample {
      return telemetry;
    },
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
      // Lock shrinks with ground speed (see steerLockScale) so a full-lock
      // keyboard tap at speed cannot spin the car.
      const lv = body.linvel();
      const lockScale = steerLockScale(
        Math.hypot(lv.x, lv.z),
        t.drive.topSpeedMs,
        t.drive.highSpeedSteerFraction,
      );
      const steerAngle = -frame.steer * t.drive.maxSteerLock * lockScale;
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
        ? -frame.throttle *
          t.drive.engineForcePerRearWheel *
          engineForceScale(
            // Total ground speed, not forward speed: a car sliding sideways
            // has low forward speed but is not in a launch, and the low-gear
            // boost would otherwise spin the tail on slide exit.
            forwardSpeedMs < 0 ? forwardSpeedMs : Math.hypot(linvel.x, linvel.z),
            t.drive.topSpeedMs,
            Math.abs(frame.steer),
            t.drive.lowGearPunch,
          )
        : reversing
          ? frame.brake *
            t.drive.reverseEngineForcePerRearWheel *
            engineForceScale(-forwardSpeedMs, REVERSE_TOP_MS)
          : 0;
      // Arcade front-drive model. Rapier's updateFriction scales a steered
      // wheel's forward impulse by maxImpulse/sideImpulse once side slip
      // saturates the friction circle, so drive routed through the steered
      // front wheels collapsed mid-corner (measured FWD 25->22 mph on throttle
      // vs 25->21 coasting at half lock, 1 s). The front share is therefore
      // applied as a chassis impulse after updateVehicle (step 5b); the front
      // wheels get literal +0 engine force (identical to RWD). Front brakes now
      // always work with throttle held; Pitfall 7 still zeroes engineForce while
      // braking, so thrust is 0 then too, and reverse uses the same split
      // (negative thrust).
      const forces = wheelEngineForces(engineForce, frontDriveShare);
      vc.setWheelEngineForce(FL, 0);
      vc.setWheelEngineForce(FR, 0);
      vc.setWheelEngineForce(RL, forces[2]);
      vc.setWheelEngineForce(RR, forces[3]);

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
      // The blend is off below 3 m/s and full from 8 m/s. At walking pace the
      // rear must bite: with the tail kept loose, a car sliding sideways at
      // ~1 m/s (e.g. after a spin) pivoted on full throttle for seconds
      // instead of driving away.
      const crawlFade = clamp((Math.hypot(lv.x, lv.z) - 3) / 5, 0, 1);
      // Weight-swing flick. `steerSwing` is the steer input smoothed over
      // flickSwingSec, standing in for weight swung toward the outside of the
      // last turn. Steering the OTHER way (past 35% of lock) while that swing
      // is still there is a flick: it latches `flickEnv` to the strength of
      // the swing, which then decays over the same time constant, holding the
      // rear loose long enough to actually rotate the car (a single-tick
      // blend measured as no effect at all). The swing is read before it is
      // updated so the reversal tick sees the old value. Zero gain = off.
      const swingK = 1 - Math.exp(-DT / Math.max(0.05, t.drive.flickSwingSec));
      const opposition =
        clamp(-steerSwing * Math.sign(frame.steer), 0, 1) *
        clamp(Math.abs(frame.steer) / 0.35, 0, 1);
      steerSwing += (frame.steer - steerSwing) * swingK;
      flickEnv = Math.max(flickEnv * (1 - swingK), clamp(opposition * 1.6, 0, 1));
      const flickBlend = clamp(
        t.drive.flickGain * flickEnv * clamp((Math.hypot(lv.x, lv.z) - 6) / 6, 0, 1) * lockScale,
        0,
        1,
      );
      // Pivot-turn gate and filters (step 5d applies the impulses). Skipped
      // entirely when off, so the physics is bit-for-bit unchanged. The gate
      // is |steer| > 0.8 with throttle > 0.8 held for 0.3 s, scaled by a speed
      // fade (1 below 5 m/s, linearly to 0 at 8 m/s). The handbrake is
      // deliberately NOT part of it: it neither triggers the pivot, shifts its
      // dwell timer, nor changes its strength. Below the gate the filters are
      // held at exactly 0 (snapped, not decayed), so inputs that never open the
      // gate are bit-for-bit unchanged too.
      let pivotGate = 0;
      if (t.drive.pivotTurn > 0) {
        const groundSpeed = Math.hypot(lv.x, lv.z);
        const speedFade = clamp(
          (PIVOT_ZERO_SPEED_MS - groundSpeed) / (PIVOT_ZERO_SPEED_MS - PIVOT_FULL_SPEED_MS),
          0,
          1,
        );
        const fullSteer = Math.abs(frame.steer) > PIVOT_FULL_INPUT;
        if (speedFade > 0 && fullSteer && frame.throttle > PIVOT_FULL_INPUT) {
          pivotHold += DT;
        } else {
          pivotHold = 0;
        }
        if (pivotHold >= PIVOT_HOLD_SEC) {
          pivotGate = speedFade;
          pivotDir = Math.sign(frame.steer);
        }
        pivotE +=
          (pivotGate - pivotE) *
          (1 -
            Math.exp(
              -DT / (pivotGate > pivotE ? Math.max(0.01, t.drive.pivotEngageSec) : PIVOT_TAU_OUT),
            ));
        // The tail follows the SMOOTHED engagement on the way in (so it does not
        // let go ahead of the yaw torque) and regrips on its own fast filter.
        pivotRear +=
          ((pivotGate > 0 ? smoothstep01(pivotE) : 0) - pivotRear) *
          (1 - Math.exp(-DT / PIVOT_TAU_REAR));
        if (pivotGate === 0) {
          if (pivotE < PIVOT_OFF_EPS) pivotE = 0;
          if (pivotRear < PIVOT_OFF_EPS) pivotRear = 0;
        }
      } else {
        pivotHold = 0;
        pivotE = 0;
        pivotRear = 0;
        pivotDir = 0;
      }
      const rearSfs = frame.handbrake
        ? t.drive.handbrakeRearSideFriction
        : lerp(
            t.wheels.rearSideFriction,
            // The throttle / flick blend has its OWN target (a controllable
            // power slide); the handbrake keeps the much looser value above.
            t.drive.powerOversteerRearSideFriction,
            Math.max(
              flickBlend,
              // The pivot loosens the tail to the power-slide value (fast in,
              // 0.05 s out) so the car actually rotates about the nose.
              pivotRear * t.drive.pivotTurn,
              clamp(
                // Scaled by the speed lock fade: the blend is keyed on steer
                // INPUT, so at speed it must shrink with the real wheel angle
                // or full-lock + throttle frees the tail on a tiny steer angle.
                t.drive.powerOversteerGain *
                  frame.throttle *
                  Math.abs(frame.steer) *
                  lockScale *
                  crawlFade,
                0,
                1,
              ),
            ),
          );
      vc.setWheelSideFrictionStiffness(RL, rearSfs * rearLateralGrip[0]);
      vc.setWheelSideFrictionStiffness(RR, rearSfs * rearLateralGrip[1]);

      // 5. Solve the vehicle — writes suspension + tire impulses onto the
      // chassis body. Imported DT, never a literal.
      vc.updateVehicle(DT);

      // 5b. Front drive share as a chassis impulse along heading. The guard
      // keeps RWD at zero extra Rapier calls (bit-for-bit unchanged).
      // applyImpulse(force * DT), not addForce: matches vehicle-assists.ts;
      // consumed by the next world.step(), so nothing persists, accumulates or
      // leaks into other vehicles. Applied at the centre of mass: no parasitic
      // yaw/pitch torque; squat/dive still emerges from the suspension.
      // Direction is chassis forward (the pre-update `forward` from step 2),
      // not the steered wheel direction: front lateral grip still turns the
      // car. Grip-aware: scaled by front wheels in contact this tick (0..2),
      // zero when airborne.
      if (frontDriveShare > 0) {
        const frontContacts = (vc.wheelIsInContact(FL) ? 1 : 0) + (vc.wheelIsInContact(FR) ? 1 : 0);
        const thrust = frontDriveThrustN(engineForce, frontDriveShare, frontContacts);
        if (thrust !== 0) {
          body.applyImpulse(
            { x: forward.x * thrust * DT, y: forward.y * thrust * DT, z: forward.z * thrust * DT },
            true,
          );
        }
      }

      // 5d. Pivot turn impulses (only while engaged or releasing). Impulse
      // form like the assists: nothing persists past the next world.step().
      if (pivotE > 0) {
        const angvel = body.angvel();
        const iy = inertia.y;
        if (pivotGate > 0) {
          // Torque toward the target yaw rate, ONE-SIDED: it only ever adds
          // rotation in the steer direction. A two-sided controller pulled an
          // already-rotating car DOWN toward a small target at low strength
          // (measured: pivotTurn 0.25 turned less than off). Positive angular
          // velocity about +Y turns LEFT, so steer-direction yaw is -dir * w.
          const pivotS = smoothstep01(pivotE);
          const target = t.drive.pivotYawRate * t.drive.pivotTurn * pivotS;
          const steerYaw = -pivotDir * angvel.y;
          if (steerYaw < target) {
            body.applyTorqueImpulse(
              {
                x: 0,
                y: -pivotDir * iy * (target - steerYaw) * (1 - Math.exp(-DT / PIVOT_TAU_YAW)),
                z: 0,
              },
              true,
            );
          }
          // Front axle speed cap: velocity of the front-axle point is linvel
          // + w x r (r = half a wheelbase ahead of the centre of mass).
          const fwdX = forward.x;
          const fwdZ = forward.z;
          const fLen = Math.hypot(fwdX, fwdZ);
          if (fLen > 1e-6) {
            const fx = fwdX / fLen;
            const fz = fwdZ / fLen;
            const half = t.wheels.halfWheelbase;
            const rx = fx * half;
            const rz = fz * half;
            const lin = body.linvel();
            const px = lin.x + angvel.y * rz;
            const pz = lin.z - angvel.y * rx;
            const speed = Math.hypot(px, pz);
            const cap = t.drive.pivotFrontSpeedCap;
            if (speed > cap) {
              const k = 1 - cap / speed;
              const ex = px * k;
              const ez = pz * k;
              // Split the excess along / across the car: an impulse at the
              // front axle moves the point by J * (1/m + r^2/Iy) across the
              // car but only J/m along it.
              const alongX = ex * fx + ez * fz;
              const acrossX = ex * -fz + ez * fx;
              const mass = t.chassis.mass;
              const massAcross = 1 / (1 / mass + (half * half) / iy);
              const gain = (1 - Math.exp(-DT / PIVOT_TAU_CAP)) * pivotS * t.drive.pivotTurn;
              const jAlong = -mass * alongX * gain;
              const jAcross = -massAcross * acrossX * gain;
              const com = body.worldCom();
              body.applyImpulseAtPoint(
                { x: jAlong * fx + jAcross * -fz, y: 0, z: jAlong * fz + jAcross * fx },
                { x: com.x + rx, y: com.y, z: com.z + rz },
                true,
              );
            }
          }
        } else {
          // Releasing: damp the yaw over ~0.15 s, weighted by what is left of
          // the engagement so it hands back to normal handling smoothly.
          body.applyTorqueImpulse(
            { x: 0, y: -iy * angvel.y * (1 - Math.exp(-DT / PIVOT_TAU_DAMP)) * pivotE, z: 0 },
            true,
          );
        }
      }

      // 5c. Flick yaw kick: the swung weight snaps the nose into the new
      // turn (loosening the rear alone only lets it drift: measured +1 deg of
      // slip at full blend). Positive angular velocity about +Y turns LEFT, so
      // a RIGHT steer (positive) kicks negative. Impulse form, like the assists.
      if (flickBlend > 0) {
        body.applyTorqueImpulse(
          {
            x: 0,
            y: -Math.sign(frame.steer) * FLICK_YAW_ACCEL * inertia.y * flickBlend * DT,
            z: 0,
          },
          true,
        );
      }

      // 6. Fresh telemetry — valid only AFTER updateVehicle.
      let contacts = 0;
      for (let i = 0; i < 4; i++) {
        if (vc.wheelIsInContact(i)) contacts++;
      }
      telemetry = sampleVehicle({ body, controller: vc } as Vehicle);

      // 7. Assists — impulses accumulate onto the same buffer world.step()
      // consumes next. The caller (src/loop.ts via applyInput) then calls
      // world.step().
      applyAssists(body, vc, contacts, t.assists, inertia);
    },

    applyTuning,
    resetPose,

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
