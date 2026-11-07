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
import { applyAssists, applyLandingCushion, boxPrincipalInertia } from "./vehicle-assists";
import type { WheelRayPatch } from "./wheel-ray-patch";

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
/**
 * One tick of a wheel's surface-grip blend: first-order toward `target`, with
 * `surfaceRegripSec` when grip is rising and `surfaceDegripSec` when it falls
 * (0 = instant).
 */
function blendToward(
  current: number,
  target: number,
  w: { surfaceRegripSec: number; surfaceDegripSec: number },
): number {
  const tau = target > current ? w.surfaceRegripSec : w.surfaceDegripSec;
  if (tau <= 0) return target;
  return current + (target - current) * (1 - Math.exp(-DT / tau));
}

/** Hermite smoothstep of `x` between `lo` and `hi`. */
function smoothstep(lo: number, hi: number, x: number): number {
  const t = clamp((x - lo) / (hi - lo), 0, 1);
  return t * t * (3 - 2 * t);
}

/** Peak yaw acceleration of the flick kick at full blend, rad/s^2. */
const FLICK_YAW_ACCEL = 8;
const CHASSIS_FRICTION = 0.15;
/** Fraction of the suspension travel after which the bump stop starts to stiffen the spring. */
const BUMP_STOP_ONSET = 0.75;
/** The weakest wheel may be this far short of the onset (m) and the stop still counts as a four-wheel load. */
const BUMP_STOP_GATE_M = 0.06;

/** Pivot turn: fully active below this ground speed, m/s... */
const PIVOT_FULL_SPEED_MS = 5;
/** ...fading smoothly to zero at this speed, and never engaged at or above it. */
const PIVOT_ZERO_SPEED_MS = 12;
/**
 * The full window above only applies once the pivot is ARMED: the car has been
 * through this speed (m/s) with steer and throttle held, i.e. a doughnut from
 * (near) rest. Armed until the throttle is lifted or the car passes 12 m/s. A car
 * that merely slows into a corner (2026-11-06 recordings: full lock, full throttle
 * at 10-25 mph) is never armed, so it only meets the narrow window below and is
 * not captured into a ~8 mph doughnut.
 */
const PIVOT_ARM_SPEED_MS = 2.5;
const PIVOT_UNARMED_FULL_SPEED_MS = 1.5;
const PIVOT_UNARMED_ZERO_SPEED_MS = 3;
/**
 * On loose ground (rear lateral grip at or under this, so gravel, dirt, grass,
 * sand and mud, not tarmac) gunning it at full lock arms the pivot from a rolling
 * start below PIVOT_SLIPPERY_ARM_SPEED_MS: the tail steps out round a pinned nose
 * instead of the car driving away in a wide arc (mud recording 2026-11-06, 20 mph).
 * Tarmac keeps the near-rest arming, so the 10-25 mph cornering bog stays fixed.
 */
const PIVOT_SLIPPERY_LATERAL_GRIP = 0.65;
const PIVOT_SLIPPERY_ARM_SPEED_MS = 11.5;
/** Pivot turn: steer / throttle fade in continuously between these levels (no threshold, no dwell). */
const PIVOT_INPUT_START = 0.5;
const PIVOT_INPUT_FULL = 0.9;
/** Pivot turn: first-order time constants, seconds. */
const PIVOT_TAU_OUT = 0.1;
const PIVOT_TAU_YAW = 0.1;
const PIVOT_TAU_CAP = 0.08;
const PIVOT_TAU_DAMP = 0.15;
const PIVOT_TAU_REAR = 0.05;
/** Below this engagement the pivot is snapped fully off (first-order filters never reach 0). */
const PIVOT_OFF_EPS = 0.002;
/** Rear grip loosens with this time constant (fast), however slowly it recovers. */
const REAR_GRIP_LOOSEN_TAU = 0.05;
/** Lift-off oversteer: time constant of the 'recent throttle' reference. */
const LIFT_OFF_REF_TAU = 0.3;
/** The lift-off loosening decays over this long, so reapplying the throttle
 * does not regrip the tail at once (drive log 2026-10-28: rear side impulse
 * 24 to 90 in 0.1 s and yaw rate -37%). */
const LIFT_OFF_HOLD_TAU = 0.5;
/** Falloff grip returns over this long, so catching a slide is not a one-frame snap. */
const FALLOFF_RECOVER_TAU = 0.12;
/** Body roll (deg) where the roll guard starts withdrawing tyre grip, and where it is complete. */
const ROLL_GUARD_ONSET_DEG = 12;
const ROLL_GUARD_FULL_DEG = 25;
/** Soft ground digs in: the guard leaves these alone so the car can still trip and roll. */
const ROLL_GUARD_EXEMPT: ReadonlySet<SurfaceType> = new Set<SurfaceType>(["grass", "sand", "mud"]);
/** Tyre grip falloff: slip (rad) where the rear starts to lose grip, and where the loss is complete. */
const TYRE_FALLOFF_ONSET = 0.2;
const TYRE_FALLOFF_FULL = 0.7;

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

/** Which rear-grip term is largest this tick (read-only diagnostics, see `Vehicle.rearGrip`). */
export type RearGripTerm = "none" | "handbrake" | "power" | "spin" | "flick" | "pivot" | "lift";

/**
 * Read-only per-tick view of the rear side-friction decision, for the
 * feel-dossier script and the like. Nothing in the physics reads it.
 */
export interface RearGripDebug {
  /** Effective rear side friction applied this tick (after smoothing, before surface grip). */
  readonly sideFriction: number;
  /** The largest term pulling the tail loose, `none` when the base grip is untouched. */
  readonly dominant: RearGripTerm;
  /** Pivot gate (speed fade x dwell ramp) before the engagement filter, 0..1. */
  readonly pivotGate: number;
  /** Tyre-falloff multiplier on the rear's maximum grip this tick (1 = full grip). */
  readonly gripScale: number;
  /** Rear drive demand over rear traction limit (>= 1 means the rears are spinning), 0 airborne. */
  readonly wheelspin: number;
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
  /** Diagnostics of the last `tick()`'s rear-grip decision. Mutated in place, never reallocated. */
  readonly rearGrip: RearGripDebug;
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
  /**
   * Attach a wheel-ray patch (terrain heightfield ray-miss workaround). It is
   * re-centred from this chassis' position every tick before the wheel rays
   * are cast, and disposed with the vehicle. Replaces any previous patch.
   */
  attachWheelRayPatch(patch: WheelRayPatch | undefined): void;
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

  // Body friction is low on purpose: the wheels do the gripping. With 0.8 the
  // underside clipping a ramp lip or scraping on a bottomed-out landing acted as
  // a brake (5 mph in one tick off a 0.9 m lip at 90 mph; roughly half of the
  // 15-23 mph lost on big landings in the drive logs, 2026-10-28).
  const chassisCollider = world.createCollider(
    RAPIER.ColliderDesc.cuboid(c.halfExtents.x, c.halfExtents.y, c.halfExtents.z)
      .setFriction(CHASSIS_FRICTION)
      // Rapier averages the two colliders' friction by default, so against 1.0
      // tarmac this body was still 0.575. Min makes it really 0.15.
      .setFrictionCombineRule(RAPIER.CoefficientCombineRule.Min),
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

  /** Latest applied suspension rest length, the neutral seed for `lastSuspensionLength`. */
  let restLength = w0.suspensionRestLength;

  /**
   * Live-retune every per-wheel property. Rapier's own `WheelTuning`
   * defaults are Bullet-era demo values and every one of these seven is
   * wrong for a car (02-RESEARCH.md Pitfalls 3, 4, 5) — set them ALL
   * explicitly on every call, never rely on a default.
   */
  function applyTuning(t: VehicleTuning): void {
    const w = t.wheels;
    restLength = w.suspensionRestLength;
    // Chassis damping and wheel geometry are live too, so the sliders for them
    // do something and the assist maths (which reads `t.wheels`) agrees with
    // the real wheel positions.
    body.setLinearDamping(t.chassis.linearDamping);
    body.setAngularDamping(t.chassis.angularDamping);
    for (let i = 0; i < 4; i++) {
      vc.setWheelChassisConnectionPointCs(i, {
        x: i % 2 === 0 ? -w.halfTrack : w.halfTrack,
        y: w.connectionY,
        z: i < 2 ? -w.halfWheelbase : w.halfWheelbase,
      });
      vc.setWheelSuspensionRestLength(i, w.suspensionRestLength);
      vc.setWheelRadius(i, w.radius);
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
        chassisCollider.setHalfExtents(cc.halfExtents);
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
    pivotE = 0;
    pivotRear = 0;
    pivotDir = 0;
    pivotArmed = false;
    rearSfsSmoothed = -1;
    throttleRef = 0;
    liftHold = 0;
    rearGripScale = 1;
    frontGripScale = 1;
    // A rolled car's stale rollDeg would otherwise make the first tick after
    // the respawn apply the roll guard's friction cut.
    rollGuardWasOn = false;
    lastSuspensionLength.fill(restLength);
    wheelSurfaces.fill("tarmac");
    blendSeeded = false;
    telemetry = sampleVehicle({ body, controller: vc } as Vehicle);
  }

  // Allocated ONCE, mutated in place every surfaced tick — never
  // reallocated. See the matching doc comment on `Vehicle.wheelSurfaces`.
  // Smoothed steer input (weight swing) for the flick; see step 4.
  let steerSwing = 0;
  let flickEnv = 0;
  // Pivot turn state (see step 4 and 5d). All zero = inert.
  let pivotE = 0;
  let pivotRear = 0;
  let pivotDir = 0;
  let pivotArmed = false;
  // Slew-limited rear side friction (-1 = not yet seeded); see step 4.
  let rearSfsSmoothed = -1;
  /** Low-passed throttle: what the driver was recently asking for. */
  let throttleRef = 0;
  let liftHold = 0;
  /** Last rear grip scale written by the tyre falloff (1 = untouched). */
  let rearGripScale = 1;
  /** Last front grip scale written by the front tyre falloff (1 = untouched). */
  let frontGripScale = 1;
  let rollGuardWasOn = false;
  /** Suspension length per wheel on the previous tick, for the bump stop's compressing-only rule. */
  const lastSuspensionLength = new Array<number>(4).fill(restLength);
  const wheelSurfaces: SurfaceType[] = ["tarmac", "tarmac", "tarmac", "tarmac"];
  /** Per-wheel blended surface grip (lags the paint under the wheel); reseeded on the first tick after a reset. */
  const blendLateral = [1, 1, 1, 1];
  const blendForward = [1, 1, 1, 1];
  let blendSeeded = false;
  /** Scratch target for `wheelContactPoint` (paint-map surface lookup): no per-tick allocation. */
  const contactScratch = { x: 0, y: 0, z: 0 };
  const rearGrip = {
    sideFriction: 0,
    dominant: "none" as RearGripTerm,
    pivotGate: 0,
    gripScale: 1,
    wheelspin: 0,
  };
  let telemetry = sampleVehicle({ body, controller: vc } as Vehicle);
  let wheelRayPatch: WheelRayPatch | undefined;

  return {
    body,
    controller: vc,
    get telemetry(): VehicleSample {
      return telemetry;
    },
    inertia,
    wheelSurfaces,
    rearGrip,

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
      // Progressive bump stop: stiffen the springs near full compression so a
      // heavy vertical load (a ramp's foot, a hard landing) is cushioned over
      // the last of the travel instead of slamming into a hard stop. Reads last
      // tick's suspension lengths. Only when ALL FOUR wheels are deep in their
      // travel together (a vertical load, not cornering roll, which unloads the
      // inside pair) and only while still compressing (the extra stiffness is not
      // handed back on rebound, so it cushions without bouncing the car).
      {
        const w = t.wheels;
        const onset = w.maxSuspensionTravel * BUMP_STOP_ONSET;
        const span = w.maxSuspensionTravel - onset;
        let minCompression = Number.POSITIVE_INFINITY;
        const lengths: number[] = [0, 0, 0, 0];
        for (let i = 0; i < 4; i++) {
          lengths[i] = vc.wheelSuspensionLength(i) ?? w.suspensionRestLength;
          minCompression = Math.min(minCompression, w.suspensionRestLength - lengths[i]);
        }
        const heavy =
          w.bumpStopStiffness > 1 && span > 0 && minCompression > onset - BUMP_STOP_GATE_M;
        for (let i = 0; i < 4; i++) {
          let k = w.suspensionStiffness;
          if (heavy && lengths[i] < lastSuspensionLength[i]) {
            const f = clamp((w.suspensionRestLength - lengths[i] - onset) / span, 0, 1);
            k *= 1 + (w.bumpStopStiffness - 1) * f * f;
          }
          vc.setWheelSuspensionStiffness(i, k);
          lastSuspensionLength[i] = lengths[i];
        }
      }

      const rearLateralGrip: number[] = [1, 1];
      const rearForwardGrip: number[] = [1, 1];
      const frontForwardGrip: number[] = [1, 1];
      if (surfaces) {
        for (let i = 0; i < 4; i++) {
          const ground = vc.wheelGroundObject(i);
          // Find the painted heightfield this wheel stands on (usually one; the
          // feel-test gate course adds a second). No allocation.
          let paint = surfaces.paint;
          while (
            paint !== undefined &&
            (ground === null ||
              (ground.handle !== paint.colliderHandle && !paint.aliasHandles?.has(ground.handle)))
          ) {
            paint = paint.next;
          }
          let surface: SurfaceType;
          if (paint !== undefined && ground !== null) {
            const p = vc.wheelContactPoint(i, contactScratch);
            // Null contact (airborne): keep the previous surface.
            surface = p === null ? (wheelSurfaces[i] as SurfaceType) : paint.surfaceAt(p.x, p.z);
          } else {
            surface = surfaces.map.lookup(ground?.handle);
          }
          wheelSurfaces[i] = surface;
          const profile = surfaces.profiles[surface];
          // Blend toward the painted surface's grip: slow to regrip (the tyre
          // sheds mud/sand), fast to degrip. Seeded to the target after a reset
          // so a spawn does not blend in from a stale surface.
          if (!blendSeeded) {
            blendLateral[i] = profile.lateralGrip;
            blendForward[i] = profile.forwardGrip;
          } else {
            blendLateral[i] = blendToward(blendLateral[i] as number, profile.lateralGrip, t.wheels);
            blendForward[i] = blendToward(blendForward[i] as number, profile.forwardGrip, t.wheels);
          }
          const lateralGrip = blendLateral[i] as number;
          const forwardGrip = blendForward[i] as number;
          vc.setWheelFrictionSlip(i, t.wheels.frictionSlip * forwardGrip);
          if (i < 2) {
            frontForwardGrip[i] = forwardGrip;
            vc.setWheelSideFrictionStiffness(i, t.wheels.frontSideFriction * lateralGrip);
          } else {
            rearLateralGrip[i - 2] = lateralGrip;
            rearForwardGrip[i - 2] = forwardGrip;
          }
        }
        blendSeeded = true;
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
      // entirely when off, so the physics is bit-for-bit unchanged. The gate is
      // CONTINUOUS: smoothsteps of |steer| and throttle (0.5 to 0.9) times a
      // speed fade (1 below 5 m/s, smoothly to 0 at 12 m/s), so it grows with
      // how hard the inputs are held and how slow the car is, like the power
      // oversteer it extends, with no dwell timer and no threshold to cross.
      // The handbrake is deliberately NOT part of it. Where the gate is 0 the
      // filters are held at exactly 0 (snapped, not decayed), so inputs that
      // never open the gate are bit-for-bit unchanged too.
      let pivotGate = 0;
      if (t.drive.pivotTurn > 0) {
        const groundSpeed = Math.hypot(lv.x, lv.z);
        const looseGround =
          ((rearLateralGrip[0] as number) + (rearLateralGrip[1] as number)) * 0.5 <=
          PIVOT_SLIPPERY_LATERAL_GRIP;
        const armSpeed = looseGround ? PIVOT_SLIPPERY_ARM_SPEED_MS : PIVOT_ARM_SPEED_MS;
        if (groundSpeed < armSpeed && frame.throttle >= PIVOT_INPUT_START) {
          pivotArmed = true;
        } else if (groundSpeed >= PIVOT_ZERO_SPEED_MS || frame.throttle < PIVOT_INPUT_START) {
          pivotArmed = false;
        }
        const zeroMs = pivotArmed ? PIVOT_ZERO_SPEED_MS : PIVOT_UNARMED_ZERO_SPEED_MS;
        const fullMs = pivotArmed ? PIVOT_FULL_SPEED_MS : PIVOT_UNARMED_FULL_SPEED_MS;
        const speedFade = smoothstep01(clamp((zeroMs - groundSpeed) / (zeroMs - fullMs), 0, 1));
        const inputRamp = (x: number) =>
          smoothstep01(
            clamp((x - PIVOT_INPUT_START) / (PIVOT_INPUT_FULL - PIVOT_INPUT_START), 0, 1),
          );
        pivotGate = speedFade * inputRamp(Math.abs(frame.steer)) * inputRamp(frame.throttle);
        if (pivotGate > 0) pivotDir = Math.sign(frame.steer);
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
        pivotE = 0;
        pivotRear = 0;
        pivotDir = 0;
      }
      // Steering AGAINST the slip (catching the slide) must not loosen the
      // tail further. The power-oversteer blend above is keyed on |steer|, so
      // counter-steering under throttle used to free the rear even more and
      // spin the car (measured, slide-exit routine: slip 130 deg and no
      // recovery; with this fade 1.1 s and no spin). Fades in over 6-17 deg
      // of slip, so straight-line and normal cornering are untouched.
      const rightV = rotateVec(q, 1, 0, 0);
      const latMs = lv.x * rightV.x + lv.y * rightV.y + lv.z * rightV.z;
      const slipRad = Math.atan2(latMs, Math.max(Math.abs(forwardSpeedMs), 0.1));
      const against = frame.steer * slipRad > 0 ? 1 : 0;
      const sm = clamp((Math.abs(slipRad) - 0.1) / 0.2, 0, 1);
      const counterSteerFade = 1 - sm * sm * (3 - 2 * sm) * against;
      // Lift-off oversteer: lifting the throttle while turning at speed moves
      // load forward and puts engine braking on the driven axle, so the tail
      // steps out. `lift` is how much throttle was just removed relative to
      // what was recently held; the reference decays with LIFT_OFF_REF_TAU,
      // so the effect fades by itself. Keyed on steer like the power blend.
      const lift = Math.max(0, throttleRef - frame.throttle);
      throttleRef += (frame.throttle - throttleRef) * (1 - Math.exp(-DT / LIFT_OFF_REF_TAU));
      const liftRaw = clamp(
        t.drive.liftOffOversteer *
          lift *
          Math.abs(frame.steer) *
          lockScale *
          clamp((Math.hypot(lv.x, lv.z) - 8) / 10, 0, 1),
        0,
        1,
      );
      liftHold = Math.max(liftRaw, liftHold * Math.exp(-DT / LIFT_OFF_HOLD_TAU));
      const liftBlend = liftHold * counterSteerFade;
      const pivotBlend = pivotRear * t.drive.pivotTurn;
      // Power oversteer is a low/medium-speed move: faded out by speed
      // (powerFadeStartMs..powerFadeEndMs) unless the rear is already sliding
      // (slip past powerSlipOpenDeg), so a keyboard tap with the throttle held
      // at 100 mph cannot free the tail (drive log 2026-11-03).
      const powerGroundSpeed = Math.hypot(lv.x, lv.z);
      const powerSpeedFade =
        1 -
        smoothstep(
          t.drive.powerFadeStartMs,
          Math.max(t.drive.powerFadeEndMs, t.drive.powerFadeStartMs + 0.1),
          powerGroundSpeed,
        );
      const powerSlipOpen = smoothstep(
        (t.drive.powerSlipOpenDeg * Math.PI) / 180,
        ((t.drive.powerSlipOpenDeg + 6) * Math.PI) / 180,
        Math.abs(slipRad),
      );
      const powerGate = Math.max(powerSpeedFade, powerSlipOpen);
      const powerBlend = clamp(
        // Scaled by the speed lock fade: the blend is keyed on steer
        // INPUT, so at speed it must shrink with the real wheel angle
        // or full-lock + throttle frees the tail on a tiny steer angle.
        t.drive.powerOversteerGain *
          frame.throttle *
          Math.abs(frame.steer) *
          lockScale *
          crawlFade *
          counterSteerFade *
          powerGate,
        0,
        1,
      );
      // Wheelspin oversteer: the rear drive force against what the rear tyres can
      // hold (frictionSlip x surface forward grip x tyre falloff x the wheels'
      // real load from last tick's suspension). Past the onset the tail loosens
      // toward the power-slide grip. Steer-weighted (a little with none, so a
      // straight launch is not twitchy). NOT scaled by the speed steering lock (this
      // is traction demand, not steering input) and not speed-gated: demand falls
      // through the gears by itself.
      const rearLoad =
        ((vc.wheelSuspensionForce(RL) ?? 0) + (vc.wheelSuspensionForce(RR) ?? 0)) / 2;
      const rearLimit =
        t.wheels.frictionSlip *
        ((rearForwardGrip[0] ?? 1) + (rearForwardGrip[1] ?? 1)) *
        0.5 *
        rearGripScale *
        rearLoad;
      // Traction circle: the rears are also spending grip on cornering. Lateral
      // force per rear wheel ~ mass x lateral acceleration x rear share (half) over
      // two wheels, with lateral acceleration taken as yaw rate x ground speed
      // (capped), so a hard corner leaves less grip for driving.
      const spinYaw = body.angvel().y;
      const spinSpeed = Math.hypot(lv.x, lv.z);
      const spinLatAccel = Math.min(Math.abs(spinYaw) * spinSpeed, 1.3 * 9.81);
      const spinLatForce = t.chassis.mass * spinLatAccel * 0.25;
      const spinDrive = Math.abs(forces[2] ?? 0);
      const wheelspinRatio = rearLimit > 1 ? Math.hypot(spinDrive, spinLatForce) / rearLimit : 0;
      // Needs real drive demand: coasting or lifting in a corner never counts.
      const spinDriveGate = rearLimit > 1 ? smoothstep(0.15, 0.4, spinDrive / rearLimit) : 0;
      const spinBlend =
        t.drive.wheelspinGain > 0
          ? clamp(
              t.drive.wheelspinGain *
                smoothstep(t.drive.wheelspinOnset, t.drive.wheelspinOnset + 0.6, wheelspinRatio) *
                spinDriveGate *
                (0.3 + 0.7 * Math.abs(frame.steer)) *
                crawlFade *
                counterSteerFade,
              0,
              1,
            )
          : 0;
      rearGrip.wheelspin = wheelspinRatio;
      // The throttle terms (power oversteer, wheelspin) head to a floor that is
      // lower at low/medium speed (a held drift) and fades to the old floor over
      // the same speed range as the power gate; flick, pivot and lift keep the
      // old floor. The looser of the two wins.
      const throttleFloor = lerp(
        t.drive.powerOversteerLowSpeedRearSideFriction,
        t.drive.powerOversteerRearSideFriction,
        1 - powerSpeedFade,
      );
      const rearSfsTarget = frame.handbrake
        ? t.drive.handbrakeRearSideFriction
        : Math.min(
            lerp(
              t.wheels.rearSideFriction,
              // The flick / pivot / lift blend has its own target (a controllable
              // slide); the handbrake keeps the much looser value above.
              t.drive.powerOversteerRearSideFriction,
              // The pivot loosens the tail to the power-slide value (fast in,
              // 0.05 s out) so the car actually rotates about the nose.
              Math.max(flickBlend, pivotBlend, liftBlend),
            ),
            lerp(t.wheels.rearSideFriction, throttleFloor, Math.max(powerBlend, spinBlend)),
          );
      // Regrip smoothing (opt-in): the tail loosens fast but regrips over
      // `rearGripRecoverySec`, so the lateral-velocity cancel that follows a
      // slide is spread out instead of deleting speed in one tick. Off (0) =
      // the target is used as-is, numerically unchanged.
      let rearSfs = rearSfsTarget;
      if (t.drive.rearGripRecoverySec > 0) {
        if (rearSfsSmoothed < 0) rearSfsSmoothed = rearSfsTarget;
        const tau =
          rearSfsTarget < rearSfsSmoothed
            ? REAR_GRIP_LOOSEN_TAU
            : Math.max(0.01, t.drive.rearGripRecoverySec);
        rearSfsSmoothed += (rearSfsTarget - rearSfsSmoothed) * (1 - Math.exp(-DT / tau));
        rearSfs = rearSfsSmoothed;
      } else {
        rearSfsSmoothed = -1;
      }
      // Diagnostics only (rearGrip): nothing above or below reads these.
      rearGrip.sideFriction = rearSfs;
      rearGrip.pivotGate = pivotGate;
      const strongest = Math.max(powerBlend, spinBlend, flickBlend, pivotBlend, liftBlend);
      rearGrip.dominant = frame.handbrake
        ? "handbrake"
        : strongest <= 0
          ? "none"
          : strongest === pivotBlend
            ? "pivot"
            : strongest === flickBlend
              ? "flick"
              : strongest === liftBlend
                ? "lift"
                : strongest === spinBlend && spinBlend > powerBlend
                  ? "spin"
                  : "power";
      vc.setWheelSideFrictionStiffness(RL, rearSfs * rearLateralGrip[0]);
      vc.setWheelSideFrictionStiffness(RR, rearSfs * rearLateralGrip[1]);

      // Tyre grip falloff: a real tyre gives LESS force once the slide is
      // well past its peak slip angle, which is what lets a slide be held.
      // Rapier's friction is a flat maximum, so at 40 deg of slip the tail
      // still pushed back with full grip and snapped the car straight (drive
      // log 2026-10-28, rear side impulse 90 with the side friction at its
      // minimum). The rear's maximum grip fades with |slip| between
      // TYRE_FALLOFF_ONSET and TYRE_FALLOFF_FULL. 0 gain = never touched.
      const fo = clamp(
        (Math.abs(slipRad) - TYRE_FALLOFF_ONSET) / (TYRE_FALLOFF_FULL - TYRE_FALLOFF_ONSET),
        0,
        1,
      );
      // Not while counter-steering: the driver catching a slide keeps full rear
      // grip (counterSteerFade is 0 once the correction is firmly applied).
      const gripTarget = 1 - t.drive.tyreFalloff * fo * fo * (3 - 2 * fo) * counterSteerFade;
      const gripScale =
        gripTarget > rearGripScale
          ? rearGripScale + (gripTarget - rearGripScale) * (1 - Math.exp(-DT / FALLOFF_RECOVER_TAU))
          : gripTarget;
      if (t.drive.tyreFalloff > 0 || rearGripScale !== 1) {
        vc.setWheelFrictionSlip(RL, t.wheels.frictionSlip * rearForwardGrip[0] * gripScale);
        vc.setWheelFrictionSlip(RR, t.wheels.frictionSlip * rearForwardGrip[1] * gripScale);
        rearGripScale = t.drive.tyreFalloff > 0 ? gripScale : 1;
      }
      rearGrip.gripScale = rearGripScale;

      // Front tyre falloff: the same idea for the steered axle. Rapier's side
      // force is a flat maximum, so a front tyre 60-90 deg off its heading
      // (measured in a 100 mph slide, 2026-11-06) still pulled the car at full
      // strength and the nose kept dragging the car round. Past the onset the
      // front's maximum grip fades, so all four tyres can slide together. Slip
      // is the angle between the front axle's velocity and the wheel direction.
      if (t.drive.frontFalloff > 0 || frontGripScale !== 1) {
        const fSpeed = Math.hypot(lv.x, lv.z);
        let frontTarget = 1;
        if (t.drive.frontFalloff > 0 && fSpeed > 3) {
          const fLen = Math.hypot(forward.x, forward.z);
          if (fLen > 1e-6) {
            const ux = forward.x / fLen;
            const uz = forward.z / fLen;
            const w = body.angvel().y;
            const half = t.wheels.halfWheelbase;
            const vx = lv.x + w * uz * half;
            const vz = lv.z - w * ux * half;
            const diff = Math.atan2(-vx, -vz) - (Math.atan2(-ux, -uz) + steerAngle);
            const slipF = Math.abs(Math.atan2(Math.sin(diff), Math.cos(diff)));
            const onset = (t.drive.frontFalloffOnsetDeg * Math.PI) / 180;
            const full = Math.max((t.drive.frontFalloffFullDeg * Math.PI) / 180, onset + 0.01);
            const ff = clamp((slipF - onset) / (full - onset), 0, 1);
            frontTarget = 1 - t.drive.frontFalloff * ff * ff * (3 - 2 * ff);
          }
        }
        frontGripScale =
          frontTarget > frontGripScale
            ? frontGripScale +
              (frontTarget - frontGripScale) * (1 - Math.exp(-DT / FALLOFF_RECOVER_TAU))
            : frontTarget;
        if (t.drive.frontFalloff <= 0 && Math.abs(frontGripScale - 1) < 1e-3) frontGripScale = 1;
        vc.setWheelFrictionSlip(
          FL,
          t.wheels.frictionSlip * (frontForwardGrip[0] ?? 1) * frontGripScale,
        );
        vc.setWheelFrictionSlip(
          FR,
          t.wheels.frictionSlip * (frontForwardGrip[1] ?? 1) * frontGripScale,
        );
      }

      // Roll guard: withdraw tyre grip as the body rolls past the onset angle
      // (previous tick's roll), per wheel, on firm ground only. Grip is the
      // cap, so this removes the sideways force that tips a sliding car.
      const rollFade = smoothstep01(
        clamp(
          (Math.abs(telemetry.rollDeg) - ROLL_GUARD_ONSET_DEG) /
            (ROLL_GUARD_FULL_DEG - ROLL_GUARD_ONSET_DEG),
          0,
          1,
        ),
      );
      const guardOn = t.drive.rollGuard > 0 && rollFade > 0;
      if (guardOn || rollGuardWasOn) {
        for (let i = 0; i < 4; i++) {
          const g = ROLL_GUARD_EXEMPT.has(wheelSurfaces[i] as SurfaceType)
            ? 1
            : 1 - t.drive.rollGuard * rollFade;
          const base =
            i < 2
              ? t.wheels.frictionSlip * (frontForwardGrip[i] ?? 1) * frontGripScale
              : t.wheels.frictionSlip * (rearForwardGrip[i - 2] ?? 1) * rearGripScale;
          vc.setWheelFrictionSlip(i, base * g);
        }
        rollGuardWasOn = guardOn;
      }

      // 5. Solve the vehicle — writes suspension + tire impulses onto the
      // chassis body. Imported DT, never a literal.
      // Keep the wheel-ray patch under the car (fixed-step state only), so the
      // wheel rays below also see the contact-free trimesh window.
      if (wheelRayPatch !== undefined) {
        const pos = body.translation();
        wheelRayPatch.update(pos.x, pos.z);
      }
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
          const target = t.drive.pivotYawRate * t.drive.pivotTurn * t.drive.pivotAssist * pivotS;
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
              const gain =
                (1 - Math.exp(-DT / PIVOT_TAU_CAP)) *
                pivotS *
                t.drive.pivotTurn *
                t.drive.pivotAssist;
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

      // 5b'. Slide surge (opt-in): while the car is sliding, add a forward
      // push along the heading. Rapier scales forward and side tyre impulses
      // down together once the traction circle saturates, and a sliding rear
      // spends the circle cancelling lateral velocity, so engine force barely
      // gets through (the same collapse the FWD chassis thrust works around).
      // Gated by slip (smoothstep 8-26 deg) and a 4-10 m/s speed ramp, scaled
      // by the real engine force (already gear-curved, limited and zeroed
      // under brake), so it fades with top speed and never fights the brakes.
      if (t.drive.slideSurge > 0 && engineForce < 0) {
        const rearContacts = (vc.wheelIsInContact(RL) ? 1 : 0) + (vc.wheelIsInContact(RR) ? 1 : 0);
        const gate =
          smoothstep(0.14, 0.45, Math.abs(slipRad)) * clamp((Math.hypot(lv.x, lv.z) - 4) / 6, 0, 1);
        if (rearContacts > 0 && gate > 0) {
          const thrust = -engineForce * rearContacts * t.drive.slideSurge * gate;
          body.applyImpulse(
            { x: forward.x * thrust * DT, y: forward.y * thrust * DT, z: forward.z * thrust * DT },
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

      // 5c'. Drift hold (opt-in): a held, powered, steered slide keeps rotating
      // so the car stays sideways instead of the front axle dragging it back
      // to the nose (measured 2026-11-06: yaw rate falls 1.7 -> 0 in ~0.9 s while
      // the front side force stays pinned). One-sided: yaw is only ever added in
      // the slide's own direction, and only while slip is under the target, so it
      // can hold an angle but never spin the car past it. Needs throttle, steer
      // into the slide, speed and a rear wheel on the ground; easing the throttle
      // or steering out switches it off, handing back to normal handling.
      if (t.drive.driftHold > 0 && engineForce < 0 && !frame.handbrake) {
        const speedH = Math.hypot(lv.x, lv.z);
        const slipDeg = Math.abs(slipRad) * 57.2958;
        const dir = Math.sign(slipRad); // yaw direction of the slide (slip < 0 yaws negative, measured)
        const into = -frame.steer * dir; // positive steer yaws negative, so this is steering into the slide
        const rearGround = (vc.wheelIsInContact(RL) ? 1 : 0) + (vc.wheelIsInContact(RR) ? 1 : 0);
        if (rearGround > 0 && dir !== 0 && speedH > 8 && forwardSpeedMs > 0) {
          // Keyboard-friendly: steering is on/off, so the keys pick a mode rather
          // than an angle. Steering into the slide deepens it to the full target;
          // the opposite key (counter-steer) holds ~75% of it so the car keeps
          // travelling the same way, sideways, instead of flipping; no steer eases
          // the slide out toward straight. Over the target is always pulled back.
          const target =
            into > 0.5
              ? t.drive.driftHoldSlipDeg
              : into < -0.5
                ? t.drive.driftHoldSlipDeg * 0.75
                : 0;
          const gate = smoothstep(8, 14, slipDeg) * smoothstep(8, 14, speedH);
          const drive = clamp((target - slipDeg) / 10, -1, 1);
          if (gate * drive !== 0) {
            body.applyTorqueImpulse(
              { x: 0, y: dir * inertia.y * t.drive.driftHold * gate * drive * DT, z: 0 },
              true,
            );
          }
        }
      }

      // 5e. High-speed yaw damping assist (plan 04.3-05): opposes the yaw rate
      // the steering did not ask for. Impulse form like the other assists, in
      // the fixed tick only, a pure function of this tick's state (medal times
      // stay deterministic). Zero at low speed, strongest with steer near 0,
      // backs off for big steer, large slip and the handbrake. Needs a rear
      // wheel on the ground (the airborne assists own the in-air case).
      if (t.drive.yawDampingGain > 0 && !frame.handbrake) {
        const dampSpeed = Math.hypot(lv.x, lv.z);
        const speedGate = smoothstep(
          t.drive.yawDampingStartMs,
          Math.max(t.drive.yawDampingFullMs, t.drive.yawDampingStartMs + 0.1),
          dampSpeed,
        );
        const steerOff = Math.max(0.1, t.drive.yawDampingSteerOff);
        const steerGate = 1 - smoothstep(steerOff / 3, steerOff, Math.abs(frame.steer));
        const slipOff = (Math.max(2, t.drive.yawDampingSlipOffDeg) * Math.PI) / 180;
        const slipGate = 1 - smoothstep(slipOff / 2, slipOff, Math.abs(slipRad));
        const gate = speedGate * steerGate * slipGate;
        const groundedRear = (vc.wheelIsInContact(RL) ? 1 : 0) + (vc.wheelIsInContact(RR) ? 1 : 0);
        if (gate > 0 && groundedRear > 0 && forwardSpeedMs > 0) {
          const av = body.angvel();
          // Yaw the steering demands (kinematic, positive = left like angvel.y).
          const demanded =
            (forwardSpeedMs * Math.tan(steerAngle)) / (2 * Math.max(0.1, t.wheels.halfWheelbase));
          // One-sided: only ever REDUCES |yaw| (toward the demanded yaw when it
          // has the same sign, else toward 0). It never adds rotation, so an
          // understeering car on a low-grip surface is not helped round.
          const target = demanded * av.y > 0 ? demanded : 0;
          const unwanted = av.y - target;
          if (unwanted * av.y > 0) {
            const k = 1 - Math.exp(-t.drive.yawDampingGain * gate * DT);
            body.applyTorqueImpulse({ x: 0, y: -inertia.y * unwanted * k, z: 0 }, true);
          }
        }
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
      applyLandingCushion(body, vc, t.assists);
    },

    applyTuning,
    resetPose,

    attachWheelRayPatch(patch: WheelRayPatch | undefined): void {
      if (wheelRayPatch !== undefined && wheelRayPatch !== patch) wheelRayPatch.dispose();
      wheelRayPatch = patch;
    },

    dispose(): void {
      wheelRayPatch?.dispose();
      wheelRayPatch = undefined;
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
