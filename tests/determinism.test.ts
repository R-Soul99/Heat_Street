import { describe, expect, it } from "vitest";
import { type InputFrame, type InputSource, NEUTRAL, ReplayInput } from "../src/core/input-tape";
import { DT, SimClock } from "../src/core/sim-clock";
import { createDebugScene } from "../src/physics/debug-scene";
import { createWorld } from "../src/physics/world";

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

// The eight refresh rates are written inline at each `it.each` rather than
// hoisted into a constant, so the list a reader sees is the list that runs.

/** A tape long enough to cover a 10 second run at 60 ticks per second. */
const TAPE_FRAMES = 600;

/** Sampled every tick when no tape is supplied. Out of range resolves to NEUTRAL. */
const NEUTRAL_TAPE = new ReplayInput([]);

/**
 * A 600-frame tape whose values are a closed-form function of the frame index.
 * No random source appears anywhere in this file: every run of this suite, on
 * every machine, drives the world with byte-identical input.
 */
function buildVaryingTape(): ReplayInput {
  const frames: InputFrame[] = [];
  for (let i = 0; i < TAPE_FRAMES; i++) {
    frames.push({
      steer: Math.sin(i / 37),
      throttle: (i % 120) / 120,
      brake: 0,
      handbrake: false,
    });
  }
  return new ReplayInput(frames);
}

/**
 * Drive the REAL `SimClock` with synthetic frame timestamps for a given refresh
 * rate, stepping the REAL world.
 *
 * `(f / fps) * 1000` is an ABSOLUTE millisecond timestamp, recomputed from the
 * frame index every frame. It is deliberately never accumulated — that is the
 * whole point of the test, and an `acc += 1000 / fps` rewrite of this line
 * reproduces the 599-ticks-at-144 fps failure the suite exists to catch.
 */
function simulate(fps: number, seconds: number, input: InputSource = NEUTRAL_TAPE) {
  const world = createWorld();
  const scene = createDebugScene(world);
  const clock = new SimClock();
  clock.start(0);

  const frames = Math.round(seconds * fps);
  for (let f = 1; f <= frames; f++) {
    const steps = clock.stepsFor((f / fps) * 1000);
    for (let s = 0; s < steps; s++) {
      // `stepsFor` has already advanced `clock.tick` past every step it returned,
      // so the index of step `s` is counted back from the new tick.
      const tickIndex = clock.tick - steps + s;
      scene.preTick(tickIndex);
      scene.applyInput(input.sampleForTick(tickIndex));
      world.step();
    }
  }

  return {
    ticks: clock.tick,
    hash: fnv1a(world.takeSnapshot()),
    simTimeSec: clock.simTimeSec,
    scene,
    world,
  };
}

describe("VEH-03: framerate-independent simulation", () => {
  it.each([30, 60, 75, 90, 120, 144, 165, 240])(
    "produces an identical tick count and end state at %ifps",
    (fps) => {
      const baseline = simulate(60, 10);
      const actual = simulate(fps, 10);

      expect(actual.ticks).toBe(baseline.ticks);
      // Byte-exact world snapshot, not a position epsilon. A float comparison
      // passes while islands, sleeping flags and contact caches have diverged.
      expect(actual.hash).toBe(baseline.hash);
    },
  );

  it("is reproducible across runs", () => {
    expect(simulate(60, 5).hash).toBe(simulate(60, 5).hash);
  });

  it("has a snapshot hash sensitive enough to detect a one-tick difference", () => {
    // Not padding. Without this, a takeSnapshot() that returned a constant — or a
    // hash that collapsed everything to one value — would make the entire suite
    // trivially green while proving nothing at all.
    expect(stepScene(600).hash).not.toBe(stepScene(601).hash);
  });

  it.each([30, 60, 75, 90, 120, 144, 165, 240])(
    "runs exactly ten seconds of simulated time at %ifps",
    (fps) => {
      const run = simulate(fps, 10);

      expect(Math.abs(run.simTimeSec - 10)).toBeLessThan(1e-12);
      expect(run.simTimeSec).toBe(run.ticks * DT);
    },
  );
});

describe("VEH-03: recorded input tape", () => {
  it("replays an input tape to the same end state at 30 fps and at 144 fps", () => {
    const tape = buildVaryingTape();

    const slow = simulate(30, 10, tape);
    const fast = simulate(144, 10, tape);

    expect(fast.ticks).toBe(slow.ticks);
    expect(fast.hash).toBe(slow.hash);
  });

  it("proves the input tape is load-bearing rather than a no-op", () => {
    // 01-PATTERNS.md R3: without this assertion the test above would pass even if
    // applyInput did nothing, because both runs would then be identical for
    // reasons that have nothing to do with the tape.
    const varying = simulate(30, 10, buildVaryingTape());
    const neutral = simulate(30, 10, NEUTRAL_TAPE);

    expect(varying.hash).not.toBe(neutral.hash);
  });

  it("keeps the spinner awake through 1200 tape-driven ticks", () => {
    const tape = buildVaryingTape();
    const run = simulate(60, 20, tape);
    const spinner = run.scene.bodies[run.scene.spinnerIndex];

    expect(run.ticks).toBe(1200);
    expect(spinner.isSleeping()).toBe(false);

    const before = spinner.rotation().y;
    run.scene.preTick(1200);
    run.world.step();
    expect(Math.abs(spinner.rotation().y - before)).toBeGreaterThan(1e-4);
  });
});

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
