import type * as THREE from "three";
import { describe, expect, it } from "vitest";
import { createAudioBootstrap } from "../src/audio/audio-bootstrap";
import { surfaceGains } from "../src/audio/surface-audio";
import { SURFACE_LOOP_SPECS, type SurfaceLoopSpec } from "../src/audio/surface-loops";
import { SURFACE_TYPES, type SurfaceType } from "../src/core/surface-types";

/**
 * Node-safe: this file must never construct a real `AudioContext`, matching
 * `vitest.config.ts`'s `environment: "node"` (shared by every test in this
 * repo, including every Rapier test). `SURFACE_LOOP_SPECS` is a pure table,
 * assertable with no engine of any kind. `createAudioBootstrap` is exercised
 * ONLY through injected fakes (a fake camera, a fake listener, a fake event
 * target) — mirroring `tests/debug-gate.test.ts`'s hand-built-fake style —
 * so this suite never touches a real `THREE.AudioListener`/`AudioContext` or
 * a real DOM event target.
 */

const NUMERIC_FIELDS: readonly (keyof SurfaceLoopSpec)[] = [
  "cutoffHz",
  "resonanceQ",
  "gain",
  "durationSec",
  "grainHz",
];

describe("SURFACE_LOOP_SPECS", () => {
  it("has exactly one entry per SURFACE_TYPES value, key list equal to SURFACE_TYPES", () => {
    expect(Object.keys(SURFACE_LOOP_SPECS)).toEqual([...SURFACE_TYPES]);
    expect(Object.keys(SURFACE_LOOP_SPECS)).toHaveLength(6);
  });

  it("every spec's numeric field is finite and strictly positive", () => {
    for (const surface of SURFACE_TYPES) {
      const spec = SURFACE_LOOP_SPECS[surface];
      for (const field of NUMERIC_FIELDS) {
        const value = spec[field] as number;
        expect(Number.isFinite(value), `${surface}.${field}`).toBe(true);
        expect(value, `${surface}.${field}`).toBeGreaterThan(0);
      }
    }
  });

  it("D-09: every pair of surfaces differs on at least two numeric fields (no colour-equivalent near-duplicates)", () => {
    for (let i = 0; i < SURFACE_TYPES.length; i++) {
      for (let j = i + 1; j < SURFACE_TYPES.length; j++) {
        const a = SURFACE_LOOP_SPECS[SURFACE_TYPES[i]];
        const b = SURFACE_LOOP_SPECS[SURFACE_TYPES[j]];
        let diffCount = 0;
        for (const field of NUMERIC_FIELDS) {
          if (a[field] !== b[field]) diffCount++;
        }
        expect(
          diffCount,
          `${SURFACE_TYPES[i]} vs ${SURFACE_TYPES[j]} differ on only ${diffCount} field(s)`,
        ).toBeGreaterThanOrEqual(2);
      }
    }
  });

  it('SURF-02\'s "tire chirp vs. muffled rumble" wording, made mechanical: tarmac has the HIGHEST cutoffHz, mud the LOWEST', () => {
    const cutoffs = SURFACE_TYPES.map((s) => SURFACE_LOOP_SPECS[s].cutoffHz);
    expect(SURFACE_LOOP_SPECS.tarmac.cutoffHz).toBe(Math.max(...cutoffs));
    expect(SURFACE_LOOP_SPECS.mud.cutoffHz).toBe(Math.min(...cutoffs));
  });
});

/** Minimal fake camera: only `add`/`remove` are used by `createAudioBootstrap`. */
function makeFakeCamera() {
  const added: unknown[] = [];
  const removed: unknown[] = [];
  return {
    add(obj: unknown): void {
      added.push(obj);
    },
    remove(obj: unknown): void {
      removed.push(obj);
    },
    added,
    removed,
  };
}

interface FakeHandler {
  readonly type: string;
  readonly fn: () => void;
}

/** Minimal fake event target recording every registration/removal by reference. */
function makeFakeTarget() {
  const handlers: FakeHandler[] = [];
  return {
    addEventListener(type: string, fn: () => void): void {
      handlers.push({ type, fn });
    },
    removeEventListener(type: string, fn: () => void): void {
      const index = handlers.findIndex((h) => h.type === type && h.fn === fn);
      if (index >= 0) handlers.splice(index, 1);
    },
    handlers,
  };
}

/** Minimal fake `THREE.AudioListener`: only `context.resume()`/`context.state` are read. */
function makeFakeListener() {
  const context = {
    state: "suspended" as "suspended" | "running",
    resume(): void {
      context.state = "running";
    },
  };
  return { context };
}

describe("createAudioBootstrap", () => {
  it("registers exactly one keydown and one click handler", () => {
    const camera = makeFakeCamera();
    const target = makeFakeTarget();
    const listener = makeFakeListener();

    createAudioBootstrap(camera as unknown as THREE.Camera, {
      listener: listener as unknown as THREE.AudioListener,
      target,
    });

    expect(target.handlers.filter((h) => h.type === "keydown")).toHaveLength(1);
    expect(target.handlers.filter((h) => h.type === "click")).toHaveLength(1);
  });

  it("adds the listener to the camera at construction", () => {
    const camera = makeFakeCamera();
    const target = makeFakeTarget();
    const listener = makeFakeListener();

    createAudioBootstrap(camera as unknown as THREE.Camera, {
      listener: listener as unknown as THREE.AudioListener,
      target,
    });

    expect(camera.added).toContain(listener);
  });

  it("dispose() removes the listener from the camera and removes both handlers", () => {
    const camera = makeFakeCamera();
    const target = makeFakeTarget();
    const listener = makeFakeListener();

    const bootstrap = createAudioBootstrap(camera as unknown as THREE.Camera, {
      listener: listener as unknown as THREE.AudioListener,
      target,
    });
    bootstrap.dispose();

    expect(camera.removed).toContain(listener);
    expect(target.handlers).toHaveLength(0);
  });

  it("resumed() reports whether the listener's AudioContext is running", () => {
    const camera = makeFakeCamera();
    const target = makeFakeTarget();
    const listener = makeFakeListener();

    const bootstrap = createAudioBootstrap(camera as unknown as THREE.Camera, {
      listener: listener as unknown as THREE.AudioListener,
      target,
    });

    expect(bootstrap.resumed()).toBe(false);
    listener.context.resume();
    expect(bootstrap.resumed()).toBe(true);
  });
});

/** Fresh, zeroed output record for `surfaceGains` — every test builds its own so no state leaks between assertions. */
function makeOut(): { [K in SurfaceType]: number } {
  const out = {} as { [K in SurfaceType]: number };
  for (const surface of SURFACE_TYPES) out[surface] = 0;
  return out;
}

describe("surfaceGains", () => {
  it("returns a record keyed by every SurfaceType, every value finite and in [0, 1]", () => {
    const out = makeOut();
    const result = surfaceGains(
      ["tarmac", "tarmac", "tarmac", "tarmac"],
      [true, true, true, true],
      [50, 50, 50, 50],
      out,
    );
    expect(Object.keys(result).sort()).toEqual([...SURFACE_TYPES].sort());
    for (const surface of SURFACE_TYPES) {
      expect(Number.isFinite(result[surface]), surface).toBe(true);
      expect(result[surface], surface).toBeGreaterThanOrEqual(0);
      expect(result[surface], surface).toBeLessThanOrEqual(1);
    }
  });

  it("all four wheels grounded on gravel at high slip gives gravel a gain near its maximum and every other surface exactly 0", () => {
    const out = makeOut();
    const result = surfaceGains(
      ["gravel", "gravel", "gravel", "gravel"],
      [true, true, true, true],
      [100, 100, 100, 100],
      out,
    );
    expect(result.gravel).toBeCloseTo(1, 5);
    for (const surface of SURFACE_TYPES) {
      if (surface !== "gravel") expect(result[surface]).toBe(0);
    }
  });

  it("two wheels on tarmac and two on gravel at equal slip gives each roughly half its single-surface value and every other surface 0", () => {
    const out = makeOut();
    const result = surfaceGains(
      ["tarmac", "tarmac", "gravel", "gravel"],
      [true, true, true, true],
      [100, 100, 100, 100],
      out,
    );
    expect(result.tarmac).toBeCloseTo(0.5, 5);
    expect(result.gravel).toBeCloseTo(0.5, 5);
    for (const surface of SURFACE_TYPES) {
      if (surface !== "tarmac" && surface !== "gravel") expect(result[surface]).toBe(0);
    }
  });

  it("fully airborne (no wheel grounded) gives every surface exactly 0", () => {
    const out = makeOut();
    const result = surfaceGains(
      ["tarmac", "gravel", "sand", "mud"],
      [false, false, false, false],
      [100, 100, 100, 100],
      out,
    );
    for (const surface of SURFACE_TYPES) {
      expect(result[surface]).toBe(0);
    }
  });

  it("slip below the audible threshold gives every surface 0 (a car rolling gently on tarmac is silent)", () => {
    const out = makeOut();
    const result = surfaceGains(
      ["tarmac", "tarmac", "tarmac", "tarmac"],
      [true, true, true, true],
      [0.1, 0.1, 0.1, 0.1],
      out,
    );
    for (const surface of SURFACE_TYPES) {
      expect(result[surface]).toBe(0);
    }
  });

  it("the six gains sum to at most 1 — straddling a boundary is never louder than being fully on one surface", () => {
    const out = makeOut();
    const result = surfaceGains(
      ["tarmac", "gravel", "sand", "mud"],
      [true, true, true, true],
      [100, 100, 100, 100],
      out,
    );
    const sum = SURFACE_TYPES.reduce((acc, surface) => acc + result[surface], 0);
    expect(sum).toBeLessThanOrEqual(1 + 1e-9);
  });

  it("non-finite slip (NaN, Infinity) yields 0 for every surface rather than propagating into a gain node", () => {
    const outNaN = makeOut();
    const resultNaN = surfaceGains(
      ["tarmac", "tarmac", "tarmac", "tarmac"],
      [true, true, true, true],
      [Number.NaN, Number.NaN, Number.NaN, Number.NaN],
      outNaN,
    );
    for (const surface of SURFACE_TYPES) {
      expect(resultNaN[surface]).toBe(0);
    }

    const outInfinity = makeOut();
    const resultInfinity = surfaceGains(
      ["tarmac", "tarmac", "tarmac", "tarmac"],
      [true, true, true, true],
      [
        Number.POSITIVE_INFINITY,
        Number.POSITIVE_INFINITY,
        Number.POSITIVE_INFINITY,
        Number.POSITIVE_INFINITY,
      ],
      outInfinity,
    );
    for (const surface of SURFACE_TYPES) {
      expect(resultInfinity[surface]).toBe(0);
    }
  });

  it("called twice with the same inputs and the same caller-supplied output record produces the same values and allocates no new object", () => {
    const out = makeOut();
    const wheelSurfaces: SurfaceType[] = ["tarmac", "gravel", "sand", "mud"];
    const grounded = [true, true, true, true];
    const slip = [50, 50, 50, 50];

    const result1 = surfaceGains(wheelSurfaces, grounded, slip, out);
    expect(result1).toBe(out);
    const snapshot = { ...result1 };

    const result2 = surfaceGains(wheelSurfaces, grounded, slip, out);
    expect(result2).toBe(out);
    for (const surface of SURFACE_TYPES) {
      expect(result2[surface]).toBe(snapshot[surface]);
    }
  });
});
