/**
 * The Phase 1 debug scene: a bare physics test, per D-01.
 *
 * One static ground plane, six dynamic boxes that drop, bounce and settle, and
 * one kinematic spinner that never stops. Deliberately NO vehicle-shaped
 * placeholder — the vehicle controller is Phase 2's job, and building one here
 * would conflate "the loop is correct" with "the car feels right", which are
 * separate questions with separate failure modes.
 *
 * Layering: may import `@dimforge/rapier3d` and `src/core/`. Must not import
 * `three` and must not touch the DOM or any wall clock. Meshes for these bodies
 * are built in `src/render/` (plan 01-05) in the same dense index order as
 * `bodies` below.
 */
import * as RAPIER from "@dimforge/rapier3d";
import type { InputFrame } from "../core/input-tape";
import { DT } from "../core/sim-clock";

/**
 * Spinner angular speed, radians per second.
 *
 * D-02 / 01-PATTERNS.md R2: the dynamic boxes sleep once settled, and a sleeping
 * body stops moving, so render judder becomes unobservable after roughly ten
 * seconds and SC2 can no longer be checked. The fix chosen is a kinematic body
 * whose rotation is a pure function of the tick index: it never sleeps, its
 * constant angular velocity makes judder maximally visible, and because it is a
 * pure function of `tick` it cannot perturb the SC1 snapshot comparison.
 *
 * 1.5 rad/s is roughly one revolution every four seconds — fast enough that a
 * dropped or duplicated frame reads as a visible hitch, slow enough not to alias
 * at 30 fps.
 */
const SPIN_RAD_PER_SEC = 1.5;

/** Newton-seconds of linear impulse applied at full throttle, per tick. */
const INPUT_IMPULSE_N = 0.12;

/** Newton-metre-seconds of angular impulse applied at full steer lock, per tick. */
const INPUT_TORQUE_NM = 0.05;

/** Brake impulse is half the throttle impulse and points the other way. */
const BRAKE_IMPULSE_SCALE = 0.5;

const GROUND_HALF_EXTENTS = { x: 50, y: 0.5, z: 50 };
const BOX_COUNT = 6;
const BOX_HALF_EXTENT = 0.5;
const BOX_RESTITUTION = 0.45;
const BOX_LINEAR_DAMPING = 0.02;
const BOX_INITIAL_ANGVEL = { x: 0.6, y: 2.4, z: 0.3 };
const SPINNER_POSITION = { x: 0, y: 6, z: -4 };
const SPINNER_HALF_EXTENTS = { x: 1.5, y: 0.15, z: 0.15 };

export interface DebugScene {
  /**
   * Every body the render layer draws, in dense index order. Excludes the
   * ground. `src/render/` builds one mesh per entry and `TransformCache` keys on
   * the same indices, so this order is a contract.
   */
  readonly bodies: readonly RAPIER.RigidBody[];

  /** Index into `bodies` of the never-sleeping kinematic spinner. */
  readonly spinnerIndex: number;

  /**
   * Advance anything that is driven rather than simulated. Called once per fixed
   * tick, immediately before `world.step()`. A pure function of `tick`: it reads
   * no clock, no random source and no stored state, so replaying the same tick
   * sequence reproduces the same motion exactly.
   */
  preTick(tick: number): void;

  /** Apply this tick's latched input. Called once per fixed tick. */
  applyInput(frame: InputFrame): void;
}

/**
 * Build the ground, the boxes and the spinner into `world`.
 *
 * The boxes are deliberately allowed to settle and sleep — that is realistic
 * behaviour and it is exactly the condition the spinner exists to survive.
 */
export function createDebugScene(world: RAPIER.World): DebugScene {
  const ground = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
  world.createCollider(
    RAPIER.ColliderDesc.cuboid(GROUND_HALF_EXTENTS.x, GROUND_HALF_EXTENTS.y, GROUND_HALF_EXTENTS.z),
    ground,
  );

  const bodies: RAPIER.RigidBody[] = [];

  for (let i = 0; i < BOX_COUNT; i++) {
    const box = world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(i * 1.3 - 3, 4 + i * 0.9, 0)
        .setAngvel(BOX_INITIAL_ANGVEL)
        .setLinearDamping(BOX_LINEAR_DAMPING),
    );
    world.createCollider(
      RAPIER.ColliderDesc.cuboid(BOX_HALF_EXTENT, BOX_HALF_EXTENT, BOX_HALF_EXTENT).setRestitution(
        BOX_RESTITUTION,
      ),
      box,
    );
    bodies.push(box);
  }

  const spinner = world.createRigidBody(
    RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(
      SPINNER_POSITION.x,
      SPINNER_POSITION.y,
      SPINNER_POSITION.z,
    ),
  );
  world.createCollider(
    RAPIER.ColliderDesc.cuboid(
      SPINNER_HALF_EXTENTS.x,
      SPINNER_HALF_EXTENTS.y,
      SPINNER_HALF_EXTENTS.z,
    ),
    spinner,
  );
  const spinnerIndex = bodies.length;
  bodies.push(spinner);

  /** The box the input tape drives, so the tape demonstrably affects the world. */
  const driven = bodies[0];

  return {
    bodies,
    spinnerIndex,

    preTick(tick: number): void {
      const angle = tick * DT * SPIN_RAD_PER_SEC;
      // Quaternion about +Y, built by hand: this layer may not import `three`.
      spinner.setNextKinematicRotation({
        x: 0,
        y: Math.sin(angle / 2),
        z: 0,
        w: Math.cos(angle / 2),
      });
    },

    applyInput(frame: InputFrame): void {
      // NEUTRAL must be a true no-op. A zero-magnitude impulse with wakeUp:true
      // would still clear sleeping flags, and that alone changes the snapshot.
      // `handbrake` is accepted and deliberately ignored in Phase 1; Phase 2
      // wires it to the vehicle controller's rear-wheel friction.
      if (frame.throttle === 0 && frame.brake === 0 && frame.steer === 0) {
        return;
      }

      const forward = -frame.throttle * INPUT_IMPULSE_N;
      const rearward = frame.brake * INPUT_IMPULSE_N * BRAKE_IMPULSE_SCALE;
      driven.applyImpulse({ x: 0, y: 0, z: forward + rearward }, true);
      driven.applyTorqueImpulse({ x: 0, y: frame.steer * INPUT_TORQUE_NM, z: 0 }, true);
    },
  };
}
