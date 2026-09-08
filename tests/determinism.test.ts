import { type InputFrame, NEUTRAL } from "../src/core/input-tape";
import { DT } from "../src/core/sim-clock";
import { createDebugScene } from "../src/physics/debug-scene";
import { createWorld } from "../src/physics/world";
import { describe, expect, it } from "vitest";

/**
 * The VEH-03 / SC1 proof.
 *
 * The equality primitive here is the raw bytes of `world.takeSnapshot()`, never a
 * float comparison. 01-RESEARCH.md "Pitfall 1" measured a naive accumulator
 * producing 599 ticks at 144 fps where the absolute clock produces 600, and a
 * position-with-epsilon comparison passes straight through that bug because the
 * boxes have already settled: it is the internal solver state (islands, sleeping
 * flags, contact caches) that has diverged. Snapshot bytes cover all of it.
 */

/**
 * FNV-1a, 32-bit. A NON-CRYPTOGRAPHIC fingerprint used only to compare two
 * snapshots for equality inside this test file. It is not a checksum, it provides
 * no integrity guarantee, and nothing outside this file may treat it as one
 * (01-RESEARCH.md "Security Domain", ASVS V6).
 */
function fnv1a(bytes: Uint8Array): string {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < bytes.length; i++) {
    h ^= bytes[i];
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h.toString(16);
}

/** Step a fresh scene a fixed number of ticks, bypassing the clock entirely. */
function stepScene(ticks: number, input?: (tick: number) => InputFrame) {
  const world = createWorld();
  const scene = createDebugScene(world);
  for (let t = 0; t < ticks; t++) {
    scene.preTick(t);
    if (input) {
      scene.applyInput(input(t));
    }
    world.step();
  }
  return { world, scene, hash: fnv1a(world.takeSnapshot()) };
}

describe("debug scene", () => {
  it("binds the world timestep to the single DT constant", () => {
    const world = createWorld();

    // Rapier's `Real` is f32 in the JS build, so the f64 `DT` is rounded on the
    // way into the solver. `Math.fround(DT)` is therefore the strongest equality
    // available, and it still fails loudly if anyone re-declares 1/60 here or
    // leaves the Rapier default of 1/60-as-written. Measured: DT is
    // 0.016666666666666666, world.timestep reads back 0.01666666753590107.
    expect(world.timestep).toBe(Math.fround(DT));
  });

  it("builds one ground body, six dynamic boxes and one spinner", () => {
    const world = createWorld();
    const scene = createDebugScene(world);

    // 8 = ground + 6 boxes + spinner. `scene.bodies` excludes the ground because
    // the render layer in plan 01-05 builds one mesh per entry, in this order.
    expect(world.bodies.len()).toBe(8);
    expect(scene.bodies.length).toBe(7);
    expect(scene.spinnerIndex).toBe(6);
    expect(scene.bodies[scene.spinnerIndex].isKinematic()).toBe(true);
    for (let i = 0; i < scene.spinnerIndex; i++) {
      expect(scene.bodies[i].isDynamic()).toBe(true);
    }
  });

  it("drives the spinner from the tick index alone", () => {
    // Two fresh scenes reach the same rotation at tick 500 regardless of what
    // preTick was called with beforehand. If preTick accumulated state, or read a
    // wall clock, or advanced by a stored delta, this fails.
    const a = createWorld();
    const sceneA = createDebugScene(a);
    sceneA.preTick(500);
    a.step();

    const b = createWorld();
    const sceneB = createDebugScene(b);
    sceneB.preTick(123);
    sceneB.preTick(500);
    b.step();

    const ra = sceneA.bodies[sceneA.spinnerIndex].rotation();
    const rb = sceneB.bodies[sceneB.spinnerIndex].rotation();
    expect([ra.x, ra.y, ra.z, ra.w]).toEqual([rb.x, rb.y, rb.z, rb.w]);
  });

  it("keeps the spinner awake and moving long after the boxes have settled", () => {
    // This is what makes SC2 checkable after the first ten seconds. See
    // 01-PATTERNS.md R2 and the D-02 note in 01-RESEARCH.md.
    const world = createWorld();
    const scene = createDebugScene(world);
    const spinner = scene.bodies[scene.spinnerIndex];

    for (let t = 0; t < 1199; t++) {
      scene.preTick(t);
      world.step();
    }
    const at1199 = spinner.rotation().y;
    scene.preTick(1199);
    world.step();
    const at1200 = spinner.rotation().y;

    expect(spinner.isSleeping()).toBe(false);
    expect(Math.abs(at1200 - at1199)).toBeGreaterThan(1e-4);
  });

  it("lets the dynamic boxes settle and sleep, which is why the spinner exists", () => {
    const { scene } = stepScene(600);
    for (let i = 0; i < scene.spinnerIndex; i++) {
      expect(scene.bodies[i].isSleeping()).toBe(true);
    }
  });

  it("changes the world when input is applied", () => {
    const driven = stepScene(300, () => ({
      steer: 0,
      throttle: 1,
      brake: 0,
      handbrake: false,
    }));
    const idle = stepScene(300, () => NEUTRAL);

    expect(driven.hash).not.toBe(idle.hash);
  });

  it("treats NEUTRAL as a true no-op", () => {
    // Applying NEUTRAL must be byte-identical to never calling applyInput at all.
    // A zero-magnitude impulse with wakeUp:true would still perturb sleeping
    // flags, and that difference would show up in the snapshot.
    const applied = stepScene(300, () => NEUTRAL);
    const untouched = stepScene(300);

    expect(applied.hash).toBe(untouched.hash);
  });
});
