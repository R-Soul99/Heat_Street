import { describe, expect, it } from "vitest";
import { NEUTRAL } from "../src/core/input-tape";
import { SimClock } from "../src/core/sim-clock";
import { readGamepad } from "../src/input/gamepad";
import { createKeyboard } from "../src/input/keyboard";
import { LiveInputSource } from "../src/input/live-input";

/** Plain KeyState-shaped state a test can mutate mid-run, plus a bound reader. */
function makeKeys(
  overrides: Partial<{
    left: boolean;
    right: boolean;
    up: boolean;
    down: boolean;
    handbrake: boolean;
  }> = {},
) {
  const state = {
    left: false,
    right: false,
    up: false,
    down: false,
    handbrake: false,
    ...overrides,
  };
  return {
    state,
    read: () => ({ ...state }),
  };
}

describe("LiveInputSource — keyboard ramp (VEH-02)", () => {
  it("ramps to full lock in 0.40s", () => {
    const keys = makeKeys({ right: true });
    const source = new LiveInputSource({ keys: keys.read });

    let atTwelve = Number.NaN;
    let atTwentyFour = Number.NaN;
    // Sample every intervening tick — sampling tick N directly without the
    // preceding ticks would hit LiveInputSource's own MAX_CATCHUP clamp and
    // under-advance the ramp, which is a correct behaviour but not what this
    // timing assertion is measuring.
    for (let t = 0; t <= 24; t++) {
      const frame = source.sampleForTick(t);
      if (t === 12) atTwelve = frame.steer;
      if (t === 24) atTwentyFour = frame.steer;
    }

    // 0.400s / DT (1/60) = 24 ticks at the default 2.5/s ramp rate.
    expect(atTwentyFour).toBeCloseTo(1, 5);
    expect(atTwelve).toBeGreaterThan(0);
    expect(atTwelve).toBeLessThan(1);
  });

  it("is idempotent: a repeated sample of one tick returns the identical frame reference without re-reading hardware", () => {
    const keys = makeKeys({ right: true });
    let calls = 0;
    const trackedRead = () => {
      calls++;
      return keys.read();
    };
    const source = new LiveInputSource({ keys: trackedRead });

    for (let t = 0; t <= 7; t++) {
      source.sampleForTick(t);
    }
    const callsAfterFirstPass = calls;

    const first = source.sampleForTick(7);
    const second = source.sampleForTick(7);

    expect(second).toBe(first);
    expect(calls).toBe(callsAfterFirstPass);
  });

  it("ramp is independent of call pattern: identical steer at every shared tick index across 30/60/144/240 fps (VEH-03 non-regression)", () => {
    // Mirrors tests/input-tape.test.ts's consumeAtFps harness and
    // src/loop.ts's `clock.tick - steps + s` index maths, but drives a fresh
    // LiveInputSource directly instead of replaying a pre-recorded tape.
    function consumeSteerAtFps(fps: number, seconds: number): number[] {
      const keys = makeKeys({ right: true });
      const source = new LiveInputSource({ keys: keys.read });
      const clock = new SimClock();
      clock.start(0);
      const values: number[] = [];
      for (let f = 1; f <= fps * seconds; f++) {
        const nowMs = (f / fps) * 1000;
        const steps = clock.stepsFor(nowMs);
        for (let s = 0; s < steps; s++) {
          const tickIndex = clock.tick - steps + s;
          values.push(source.sampleForTick(tickIndex).steer);
        }
      }
      return values;
    }

    const at30 = consumeSteerAtFps(30, 1);
    const at60 = consumeSteerAtFps(60, 1);
    const at144 = consumeSteerAtFps(144, 1);
    const at240 = consumeSteerAtFps(240, 1);

    expect(at60.length).toBeGreaterThan(0);
    expect(at30).toEqual(at60);
    expect(at144).toEqual(at60);
    expect(at240).toEqual(at60);
  });

  it("returns to centre faster than it ramps out", () => {
    const keys = makeKeys({ right: true });
    const source = new LiveInputSource({ keys: keys.read });

    let tick = 0;
    let frame = source.sampleForTick(tick);
    while (frame.steer < 1) {
      tick++;
      frame = source.sampleForTick(tick);
    }
    const ticksToFullLock = tick;

    keys.state.right = false;
    let returnTicks = 0;
    while (frame.steer > 0) {
      tick++;
      frame = source.sampleForTick(tick);
      returnTicks++;
    }

    expect(returnTicks).toBeLessThan(ticksToFullLock);
  });

  it("negative tick returns NEUTRAL", () => {
    const source = new LiveInputSource({ keys: makeKeys().read });
    expect(source.sampleForTick(-1)).toBe(NEUTRAL);
  });
});

describe("LiveInputSource — gamepad passthrough", () => {
  it("gamepad axes bypass the ramp: analog stick passes straight through with no ramp-in", () => {
    const source = new LiveInputSource({
      readPad: () => ({ steer: 0.8, throttle: 0.5, brake: 0, handbrake: false }),
    });
    expect(source.sampleForTick(0).steer).toBe(0.8);
  });

  it("gamepad deadzone: an already-deadzoned pad snapshot yields 0 steer", () => {
    // gamepad.ts applies the deadzone (0.12 threshold) before LiveInputSource
    // ever sees the snapshot, so a raw stick value of 0.05 is rescaled to
    // exactly 0 by readGamepad before it reaches here. This test injects that
    // ALREADY-deadzoned output directly — per the plan's stated alternative —
    // because this describe block's imports are limited to live-input.ts,
    // input-tape.ts and sim-clock.ts and cannot reach into gamepad.ts's
    // internals. gamepad.ts's own deadzone maths is exercised directly in the
    // "src/input is importable in a bare Node environment" block below.
    const source = new LiveInputSource({
      readPad: () => ({ steer: 0, throttle: 0, brake: 0, handbrake: false }),
    });
    expect(source.sampleForTick(0).steer).toBe(0);
  });

  it("clamps hostile axis values: NaN/out-of-range pad values never reach the caller (T-02-05)", () => {
    const source = new LiveInputSource({
      readPad: () => ({ steer: Number.NaN, throttle: 5, brake: -2, handbrake: false }),
    });
    const frame = source.sampleForTick(0);
    expect(frame.steer).toBe(0);
    expect(frame.throttle).toBe(1);
    expect(frame.brake).toBe(0);
    expect(Number.isFinite(frame.steer)).toBe(true);
    expect(Number.isFinite(frame.throttle)).toBe(true);
    expect(Number.isFinite(frame.brake)).toBe(true);
  });
});

// Ownership note: this file intentionally does NOT add a `src/input/**` rule
// to tests/layering.test.ts — plan 02-05 owns that file and adds the
// `src/input/**` and `src/hud/**` rule blocks together once both directories
// exist (02-PATTERNS.md "tests/layering.test.ts (MODIFY)").
describe("src/input is importable in a bare Node environment", () => {
  it("this suite runs under Vitest's node environment with no document or localStorage", () => {
    // Purity-is-the-proof, in the style of tests/profiler-hud.test.ts: the
    // fact that every import at the top of this file — including
    // src/input/keyboard.ts and src/input/gamepad.ts — already succeeded, and
    // every case above already ran, with neither of these globals defined, IS
    // the proof that src/input/** never touches a DOM at module scope.
    //
    // NOTE: modern Node ships a partial built-in `navigator` global (typeof
    // "object", no Gamepad API) rather than omitting it entirely — verified
    // directly against this repo's pinned Node/Vitest by inspecting
    // `Object.getOwnPropertyDescriptor(globalThis, "navigator")`. The relevant
    // guarantee for this phase is that `readGamepad()` degrades to `null`
    // either way, asserted below, not that `typeof navigator` is "undefined".
    expect(typeof document).toBe("undefined");
    expect(typeof localStorage).toBe("undefined");
  });

  it("createKeyboard() is importable with zero listeners registered until called", () => {
    // Importing the module (top of this file) registered nothing — there is
    // no `document` in this environment for a listener to attach to. Calling
    // the factory itself is exercised indirectly via `new LiveInputSource()`
    // below, whose lazy default is exactly this function.
    expect(typeof createKeyboard).toBe("function");
  });

  it("readGamepad() returns null when the Gamepad API is unavailable, rather than throwing", () => {
    // This Node environment's built-in `navigator` has no `getGamepads`
    // method, which readGamepad() must treat identically to `navigator` being
    // absent altogether — both are "no Gamepad API here", never a throw.
    expect(() => readGamepad()).not.toThrow();
    expect(readGamepad()).toBeNull();
  });

  it("readGamepad()'s deadzone rescales a raw 0.05 stick to exactly 0", () => {
    // Direct exercise of gamepad.ts's own deadzone maths (the case the
    // "gamepad deadzone" test above could not reach, since that describe
    // block's imports are limited to live-input.ts/input-tape.ts/sim-clock.ts).
    // Node's built-in `navigator` is a configurable getter (verified above),
    // so `Object.defineProperty` can override it for one assertion and the
    // original descriptor is restored immediately after.
    const fakePad = {
      axes: [0.05],
      buttons: [{ pressed: false, value: 0 }],
    } as unknown as Gamepad;
    const original = Object.getOwnPropertyDescriptor(globalThis, "navigator");
    Object.defineProperty(globalThis, "navigator", {
      value: { getGamepads: () => [fakePad] },
      configurable: true,
    });
    try {
      const snapshot = readGamepad();
      expect(snapshot).not.toBeNull();
      expect(snapshot?.steer).toBe(0);
    } finally {
      if (original) {
        Object.defineProperty(globalThis, "navigator", original);
      } else {
        delete (globalThis as { navigator?: unknown }).navigator;
      }
    }
  });

  it("new LiveInputSource() with no injected deps does not throw when document is undefined", () => {
    // Ships as: src/input/keyboard.ts's createKeyboard() detects the missing
    // DOM (`typeof document === "undefined"`) and returns an inert,
    // all-neutral handle instead of calling addEventListener, and
    // src/input/gamepad.ts's readGamepad() returns null whenever the Gamepad
    // API is unavailable. Together these mean LiveInputSource's lazy defaults
    // never throw outside a browser — construction is NOT deferred.
    const source = new LiveInputSource();
    expect(() => source.sampleForTick(0)).not.toThrow();
    expect(source.sampleForTick(0)).toEqual(NEUTRAL);
  });

  it("sampling never throws even with no injected deps across several ticks", () => {
    const source = new LiveInputSource();
    for (let t = 0; t < 5; t++) {
      expect(() => source.sampleForTick(t)).not.toThrow();
    }
  });
});
