import * as RAPIER from "@dimforge/rapier3d";
import { describe, expect, it } from "vitest";

// Wave 0 de-risking test. Its job is to fail loudly and immediately if
// vitest.config.ts's resolver settings are wrong, because every later test in
// this phase (determinism, interpolation, input tape) imports Rapier the same
// way. See 01-RESEARCH.md "Pitfall 3".

const GRAVITY = { x: 0, y: -9.81, z: 0 };
const START_Y = 4;

function makeWorld(): { world: RAPIER.World; box: RAPIER.RigidBody } {
  const world = new RAPIER.World(GRAVITY);

  const ground = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
  world.createCollider(RAPIER.ColliderDesc.cuboid(50, 0.5, 50), ground);

  const box = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(0, START_Y, 0));
  world.createCollider(RAPIER.ColliderDesc.cuboid(0.5, 0.5, 0.5), box);

  return { world, box };
}

describe("rapier smoke", () => {
  it("resolves the pinned non-compat build under Node", () => {
    // Catches both a resolver failure and accidental version drift. A patch bump
    // can alter solver behaviour and silently invalidate recorded medal times.
    expect(RAPIER.version()).toBe("0.20.0");
  });

  it("constructs a world, creates bodies and steps them under gravity", () => {
    const { world, box } = makeWorld();

    for (let i = 0; i < 60; i++) {
      world.step();
    }

    const y = box.translation().y;
    expect(Number.isFinite(y)).toBe(true);
    expect(y).toBeLessThan(START_Y);
  });

  it("exposes takeSnapshot as a non-empty Uint8Array", () => {
    // This is the equality primitive every determinism test in plan 01-04
    // depends on, so prove it exists and returns bytes here.
    const { world } = makeWorld();
    world.step();

    const snapshot = world.takeSnapshot();
    expect(snapshot).toBeInstanceOf(Uint8Array);
    expect(snapshot.length).toBeGreaterThan(0);
  });

  it("exposes the body-count and active-body sources the profiler HUD needs", () => {
    // Both are profiler-HUD data sources in plan 01-06.
    const { world } = makeWorld();

    expect(world.bodies.len()).toBe(2);
    expect(typeof world.forEachActiveRigidBody).toBe("function");
  });
});
