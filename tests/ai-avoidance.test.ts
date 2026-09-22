import * as RAPIER from "@dimforge/rapier3d";
import { describe, expect, it } from "vitest";
import { defaultAiDriverParams } from "../src/core/ai-driver";
import type { RacingLine, RacingLinePoint } from "../src/core/racing-line";
import { defaultSurfaceProfiles } from "../src/core/surface-tuning";
import { defaultTuning } from "../src/core/vehicle-tuning";
import { createAiFleet } from "../src/physics/ai-fleet";
import { probeForwardGapM } from "../src/physics/ai-avoidance";
import { createSurfaceMap, type SurfaceContext } from "../src/physics/surface";
import { buildTelemetryScene } from "../src/physics/telemetry/run";
import { createWorld } from "../src/physics/world";

const tuning = defaultTuning();

// `VehiclePose.headingRad` is the YAW convention `resetPose` feeds into the
// chassis rotation (src/core/heading.ts), NOT the BEARING convention the
// straight racing line below and `headingFromRotation`/pure-pursuit use for
// "current heading". `forwardFromYaw(-PI/2) = (1, 0)` — this is the pose
// heading that actually orients a chassis's world-forward along +X, which
// is what these tests' straight line (running along +X) needs.
const FACING_PLUS_X = -Math.PI / 2;

/** A straight, flat, constant-speed synthetic racing line along +X, z=0, spaced 1m apart (mirrors tests/ai-driver.test.ts's buildStraightLine). */
function buildStraightLine(length = 200, targetSpeedMs = 30): RacingLine {
  const points: RacingLinePoint[] = [];
  for (let i = 0; i < length; i++) {
    points.push(
      Object.freeze({
        x: i,
        y: 0,
        z: 0,
        centreX: i,
        centreZ: 0,
        halfWidthM: 4,
        surface: "tarmac",
        arcM: i,
        curvature: 0,
        targetSpeedMs,
      }),
    );
  }
  return Object.freeze({
    courseId: "synthetic-straight",
    points: Object.freeze(points),
    lapLengthM: length,
    checkpointArcM: Object.freeze([length]),
  });
}

function buildSurfaces(world: RAPIER.World): SurfaceContext {
  const ground = buildTelemetryScene(world);
  const map = createSurfaceMap();
  map.register(ground.handle, "tarmac");
  return { map, profiles: defaultSurfaceProfiles() };
}

describe("probeForwardGapM: chassis-only forward raycast (first world.castRay consumer)", () => {
  it("two cuboid chassis 20m apart: probing from A's front bumper toward B returns a gap within 0.05m of the bumper-to-B-face distance", () => {
    const world = createWorld();
    try {
      buildTelemetryScene(world);
      const bodyA = world.createRigidBody(
        RAPIER.RigidBodyDesc.fixed().setTranslation(0, 1, 0),
      );
      const colliderA = world.createCollider(RAPIER.ColliderDesc.cuboid(1, 1, 1), bodyA);
      const bodyB = world.createRigidBody(
        RAPIER.RigidBodyDesc.fixed().setTranslation(20, 1, 0),
      );
      const colliderB = world.createCollider(RAPIER.ColliderDesc.cuboid(1, 1, 1), bodyB);

      // Rapier's broad-phase only picks up newly-created colliders on the
      // NEXT world.step() — a raycast against colliders created this same
      // tick, before any step, finds nothing. One step here settles the
      // scene for the query below (fixed bodies do not move).
      world.step();

      const obstacles = new Set<number>([colliderA.handle, colliderB.handle]);
      // Origin AT A's own front bumper (its +X face, half-extent 1) — filterExcludeRigidBody
      // is what makes an origin exactly on A's own surface safe.
      const gap = probeForwardGapM(world, bodyA, obstacles, { x: 1, y: 1, z: 0 }, { x: 1, z: 0 }, 30);

      expect(gap).not.toBeNull();
      // B's near face is at x = 20 - 1 = 19; origin is at x = 1; expected gap = 18.
      expect(gap as number).toBeCloseTo(18, 1);
      expect(Math.abs((gap as number) - 18)).toBeLessThanOrEqual(0.05);
    } finally {
      world.free();
    }
  });

  it("never reports A's own chassis even when the origin is inside A's collider (filterExcludeRigidBody)", () => {
    const world = createWorld();
    try {
      buildTelemetryScene(world);
      const bodyA = world.createRigidBody(
        RAPIER.RigidBodyDesc.fixed().setTranslation(0, 1, 0),
      );
      const colliderA = world.createCollider(RAPIER.ColliderDesc.cuboid(1, 1, 1), bodyA);
      const bodyB = world.createRigidBody(
        RAPIER.RigidBodyDesc.fixed().setTranslation(20, 1, 0),
      );
      const colliderB = world.createCollider(RAPIER.ColliderDesc.cuboid(1, 1, 1), bodyB);

      // See bullet 1's comment: one step settles the broad-phase for these
      // freshly-created colliders before the query below.
      world.step();

      const obstacles = new Set<number>([colliderA.handle, colliderB.handle]);
      // Origin at A's own centre — deep inside A's collider.
      const gap = probeForwardGapM(world, bodyA, obstacles, { x: 0, y: 1, z: 0 }, { x: 1, z: 0 }, 30);

      expect(gap).not.toBeNull();
      // Must report B (near face x=19), never A (which would read ~0 or 1).
      expect(gap as number).toBeGreaterThan(15);
      expect(gap as number).toBeCloseTo(19, 1);
    } finally {
      world.free();
    }
  });

  it("a fixed wall collider NOT in the obstacle handle set is ignored (B still reported); ground is never reported", () => {
    const world = createWorld();
    try {
      buildTelemetryScene(world);
      const bodyA = world.createRigidBody(
        RAPIER.RigidBodyDesc.fixed().setTranslation(0, 1, 0),
      );
      const colliderA = world.createCollider(RAPIER.ColliderDesc.cuboid(1, 1, 1), bodyA);
      const bodyB = world.createRigidBody(
        RAPIER.RigidBodyDesc.fixed().setTranslation(20, 1, 0),
      );
      const colliderB = world.createCollider(RAPIER.ColliderDesc.cuboid(1, 1, 1), bodyB);
      // A wall directly between A and B, deliberately excluded from the
      // obstacle set below.
      const wallBody = world.createRigidBody(
        RAPIER.RigidBodyDesc.fixed().setTranslation(10, 1, 0),
      );
      world.createCollider(RAPIER.ColliderDesc.cuboid(1, 1, 1), wallBody);

      // See bullet 1's comment: one step settles the broad-phase.
      world.step();

      const obstacles = new Set<number>([colliderA.handle, colliderB.handle]);
      const gap = probeForwardGapM(world, bodyA, obstacles, { x: 1, y: 1, z: 0 }, { x: 1, z: 0 }, 30);

      expect(gap).not.toBeNull();
      // Same result as the ground-truth bullet 1 case — the wall (and the
      // flat ground, also never in `obstacles`) must not shorten the gap.
      expect(Math.abs((gap as number) - 18)).toBeLessThanOrEqual(0.05);
    } finally {
      world.free();
    }
  });

  it("nothing inside maxDistanceM returns null", () => {
    const world = createWorld();
    try {
      buildTelemetryScene(world);
      const bodyA = world.createRigidBody(
        RAPIER.RigidBodyDesc.fixed().setTranslation(0, 1, 0),
      );
      const colliderA = world.createCollider(RAPIER.ColliderDesc.cuboid(1, 1, 1), bodyA);
      const bodyB = world.createRigidBody(
        RAPIER.RigidBodyDesc.fixed().setTranslation(20, 1, 0),
      );
      const colliderB = world.createCollider(RAPIER.ColliderDesc.cuboid(1, 1, 1), bodyB);

      // See bullet 1's comment: one step settles the broad-phase.
      world.step();

      const obstacles = new Set<number>([colliderA.handle, colliderB.handle]);
      // maxDistanceM (5) is far short of the real 18m gap to B.
      const gap = probeForwardGapM(world, bodyA, obstacles, { x: 1, y: 1, z: 0 }, { x: 1, z: 0 }, 5);

      expect(gap).toBeNull();
    } finally {
      world.free();
    }
  });
});

describe("AiFleet.avoidanceScale: throttle-only slowdown wired from the probe", () => {
  it("a clear road ahead keeps avoidanceScale at 1", () => {
    const world = createWorld();
    try {
      const surfaces = buildSurfaces(world);
      const line = buildStraightLine();
      const fleet = createAiFleet(
        world,
        tuning,
        surfaces,
        line,
        [{ x: 100, y: 1, z: 0, headingRad: FACING_PLUS_X }],
        defaultAiDriverParams(tuning),
      );

      // See probeForwardGapM's bullet-1 comment: one step settles the
      // broad-phase for the freshly-created chassis colliders.
      world.step();

      expect(fleet.avoidanceScale(0)).toBe(1);
      fleet.tick(0);
      expect(fleet.avoidanceScale(0)).toBe(1);

      fleet.dispose();
    } finally {
      world.free();
    }
  });

  it("another fleet car inside the following distance drops avoidanceScale below 1 (never negative, never > 1)", () => {
    const world = createWorld();
    try {
      const surfaces = buildSurfaces(world);
      const line = buildStraightLine();
      // Trailing car at x=0, leading car at x=10 — the near-face gap
      // (HALF_CHASSIS_Z=2.35 subtracted from each side of the 10m centre
      // separation) is well inside followDistanceM(0)=8's span down to
      // minGapM=3.
      const fleet = createAiFleet(
        world,
        tuning,
        surfaces,
        line,
        [
          { x: 0, y: 1, z: 0, headingRad: FACING_PLUS_X },
          { x: 10, y: 1, z: 0, headingRad: FACING_PLUS_X },
        ],
        defaultAiDriverParams(tuning),
      );

      world.step();
      fleet.tick(0);
      const trailingScale = fleet.avoidanceScale(0);
      expect(trailingScale).toBeLessThan(1);
      expect(trailingScale).toBeGreaterThanOrEqual(0);

      // The leading car has clear road ahead of IT (nothing beyond car 1 on
      // the straight), so its own scale stays at 1.
      expect(fleet.avoidanceScale(1)).toBe(1);

      fleet.dispose();
    } finally {
      world.free();
    }
  });

  it("an externally-supplied obstacle body inside the following distance drops avoidanceScale below 1", () => {
    const world = createWorld();
    try {
      const surfaces = buildSurfaces(world);
      const line = buildStraightLine();
      const obstacleBody = world.createRigidBody(
        RAPIER.RigidBodyDesc.fixed().setTranslation(6, 1, 0),
      );
      world.createCollider(RAPIER.ColliderDesc.cuboid(1, 1, 1), obstacleBody);

      const fleet = createAiFleet(
        world,
        tuning,
        surfaces,
        line,
        [{ x: 0, y: 1, z: 0, headingRad: FACING_PLUS_X }],
        defaultAiDriverParams(tuning),
        { obstacleBodies: [obstacleBody] },
      );

      world.step();
      fleet.tick(0);
      const scale = fleet.avoidanceScale(0);
      expect(scale).toBeLessThan(1);
      expect(scale).toBeGreaterThanOrEqual(0);

      fleet.dispose();
    } finally {
      world.free();
    }
  });

  it("avoidanceScale resets to 1 after resetCar", () => {
    const world = createWorld();
    try {
      const surfaces = buildSurfaces(world);
      const line = buildStraightLine();
      const fleet = createAiFleet(
        world,
        tuning,
        surfaces,
        line,
        [
          { x: 0, y: 1, z: 0, headingRad: FACING_PLUS_X },
          { x: 10, y: 1, z: 0, headingRad: FACING_PLUS_X },
        ],
        defaultAiDriverParams(tuning),
      );

      world.step();
      fleet.tick(0);
      expect(fleet.avoidanceScale(0)).toBeLessThan(1);

      fleet.resetCar(0, { x: 0, y: 1, z: 0, headingRad: FACING_PLUS_X });
      expect(fleet.avoidanceScale(0)).toBe(1);

      fleet.dispose();
    } finally {
      world.free();
    }
  });
});
