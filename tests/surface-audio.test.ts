import type * as THREE from "three";
import { describe, expect, it } from "vitest";
import { createAudioBootstrap } from "../src/audio/audio-bootstrap";
import { SURFACE_LOOP_SPECS, type SurfaceLoopSpec } from "../src/audio/surface-loops";
import { SURFACE_TYPES } from "../src/core/surface-types";

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
