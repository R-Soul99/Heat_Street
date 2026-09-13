/**
 * The audio subsystem's camera-attached `THREE.AudioListener` plus the
 * gesture-gated `AudioContext.resume()` every browser's autoplay policy
 * requires (03-RESEARCH.md "Surface Audio": an `AudioContext` starts
 * SUSPENDED until a user gesture, and a game that plays sound before that
 * gesture produces silence with no error and no console warning).
 *
 * Analog: `src/render/renderer.ts`'s one-time-subsystem-construction-plus-
 * dispose-lifecycle shape (construct once at the composition root, return a
 * handle with `dispose()`).
 *
 * The gesture handlers below are registered DIRECTLY on `target`, never
 * through the `?debug`-gated dev-hotkey registration convention
 * (`src/debug/debug-gate.ts`) that Phase 1/2's dev overlays use. That path
 * only ever arms in a `?debug` build, and routing the resume gesture through
 * it would leave every NORMAL (non-`?debug`) build permanently silent — a
 * failure mode with no thrown error and no console warning, invisible until
 * a playtest notices nothing plays.
 *
 * Layering: may import `three` and `src/core/`. Must not import
 * `@dimforge/rapier3d` and contains none of `tests/layering.test.ts`'s
 * simulation-write identifiers (`world.step`, `applyImpulse`,
 * `setTranslation`, `setRotation`, `setNextKinematic`).
 */
import * as THREE from "three";

/**
 * Injectable event-target shape — the same optional-`deps` precedent
 * `src/input/live-input.ts` establishes for `LiveInputSource`, so this
 * module is fully Node-testable with a hand-built fake and no jsdom.
 */
export interface AudioBootstrapEventTarget {
  addEventListener(type: string, fn: () => void): void;
  removeEventListener(type: string, fn: () => void): void;
}

/** All optional; defaults are built lazily inside `createAudioBootstrap` itself. */
export interface AudioBootstrapDeps {
  readonly listener?: THREE.AudioListener;
  readonly target?: AudioBootstrapEventTarget;
}

export interface AudioBootstrap {
  readonly listener: THREE.AudioListener;
  /**
   * True once the gesture-gated resume has actually fired and the
   * underlying `AudioContext` reports `"running"`. Plan 03-12's playtest
   * uses this to CONFIRM the gate fired rather than inferring it from
   * silence, which is otherwise indistinguishable from "nothing is wrong,
   * the player just hasn't clicked yet."
   */
  resumed(): boolean;
  /** Removes the listener from the camera and both gesture handlers from `target`. */
  dispose(): void;
}

/**
 * Build the audio bootstrap: attach `listener` to `camera` and arm the
 * one-time gesture gate that every build needs, `?debug` or not.
 *
 * `deps` defaults to a real `THREE.AudioListener` and the global event
 * target (`globalThis`, which is `window` in a browser) — following
 * `LiveInputSource`'s "lazy defaults built INSIDE the constructor"
 * convention (`src/input/live-input.ts`), so importing this module never
 * touches a real `AudioContext` or `addEventListener` outside a browser.
 */
export function createAudioBootstrap(
  camera: THREE.Camera,
  deps: AudioBootstrapDeps = {},
): AudioBootstrap {
  const listener = deps.listener ?? new THREE.AudioListener();
  const target = deps.target ?? (globalThis as unknown as AudioBootstrapEventTarget);

  camera.add(listener);

  // PITFALL (browser autoplay policy): an `AudioContext` starts SUSPENDED
  // until a user gesture resumes it. A game that plays a sound before that
  // gesture produces NOTHING — no thrown error, no console warning — which
  // is exactly the kind of bug that survives all the way to a playtest
  // undetected. The handler below is the one-line fix, registered
  // unconditionally in every build (never gated on a query-string flag) so
  // a normal player actually hears sound.
  const handleGesture = (): void => {
    listener.context.resume();
  };

  target.addEventListener("keydown", handleGesture);
  target.addEventListener("click", handleGesture);

  return {
    listener,

    resumed(): boolean {
      return listener.context.state === "running";
    },

    dispose(): void {
      target.removeEventListener("keydown", handleGesture);
      target.removeEventListener("click", handleGesture);
      camera.remove(listener);
    },
  };
}
