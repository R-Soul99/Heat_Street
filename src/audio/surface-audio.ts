/**
 * Six crossfaded, chassis-attached `THREE.PositionalAudio` channels — one
 * per `SurfaceType` — whose gains are driven every RENDER frame by which
 * surface(s) the grounded wheels are currently sliding on.
 *
 * Assumption A3 (03-RESEARCH.md "Surface Audio"): SIX chassis-attached
 * channels crossfaded by grounded-wheel surface share, NOT four independent
 * per-wheel channels — four simultaneous independent positional loops per
 * car would be audibly redundant and wasteful, and this matches the
 * engine-RPM crossfade technique CLAUDE.md already names for later engine
 * sound. Documented revisit trigger: a playtest finding that a
 * two-wheels-on-gravel/two-on-tarmac transition reads as mushy.
 *
 * Explicitly a presentation concern: `update` is called once per RENDER
 * frame, never from the fixed physics tick, and `src/physics/` must never
 * import this module — audio crossfade gain is not simulation state.
 *
 * Analog: `src/render/vehicle-view.ts`'s `updateWheels(vc)` — a per-frame
 * update method that reads sampled/controller state and writes only to
 * objects this module owns (here: gain, not mesh transforms).
 *
 * Layering: may import `three` and `src/core/`. Must not import
 * `@dimforge/rapier3d` and contains none of `tests/layering.test.ts`'s
 * simulation-write identifiers (`world.step`, `applyImpulse`,
 * `setTranslation`, `setRotation`, `setNextKinematic`).
 */
import * as THREE from "three";
import { SURFACE_TYPES, type SurfaceType } from "../core/surface-types";
import { dampFactor } from "../render/camera/camera-math";

/** Fraction of a single wheel's full contribution — four grounded wheels on one surface reach the surface's maximum gain of 1. */
const WHEEL_SHARE = 0.25;

/**
 * Combined slip magnitude (matching `src/render/surface-fx.ts`'s own
 * `hypot(wheelSideImpulse, wheelForwardImpulse)` convention) at/below which
 * a wheel contributes NOTHING — a car rolling gently on tarmac must be
 * silent, not hissing continuously. `[ASSUMED]`, retuneable by feel.
 */
const SLIP_AUDIBLE_THRESHOLD = 5;

/** Slip magnitude at/above which a wheel contributes its full `WHEEL_SHARE`. `[ASSUMED]`, retuneable by feel. */
const SLIP_FOR_MAX_GAIN = 70;

/** Clamp `v` into `[lo, hi]`. */
function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/**
 * Map a raw combined-slip magnitude to a `[0, 1]` intensity. Non-finite
 * input (`NaN`, `Infinity`) returns 0 rather than propagating — a `NaN`
 * reaching a gain node silences or blows out the whole Web Audio graph with
 * no error (T-03-35).
 */
function slipIntensity(slip: number): number {
  if (!Number.isFinite(slip) || slip <= SLIP_AUDIBLE_THRESHOLD) return 0;
  const t = (slip - SLIP_AUDIBLE_THRESHOLD) / (SLIP_FOR_MAX_GAIN - SLIP_AUDIBLE_THRESHOLD);
  return clamp(t, 0, 1);
}

/**
 * PURE mixing function — the same reason `src/physics/vehicle-assists.ts`
 * is shaped as a free function with explicit parameters: directly
 * unit-testable with hand-built inputs, no `AudioContext`. Zeros `out`
 * first, then for each GROUNDED wheel adds `WHEEL_SHARE` of that surface's
 * share scaled by a normalised, clamped slip intensity. A non-finite slip
 * contributes 0. Writing into a caller-supplied record keeps the per-frame
 * path allocation-free — `out` is returned by reference, never a fresh
 * object.
 *
 * By construction (four wheels, each contributing at most `WHEEL_SHARE` to
 * exactly one surface), the six returned gains always sum to at most 1 —
 * straddling a surface boundary is never louder than being fully on one
 * surface.
 */
export function surfaceGains(
  wheelSurfaces: readonly SurfaceType[],
  grounded: readonly boolean[],
  slip: readonly number[],
  out: { [K in SurfaceType]: number },
): { [K in SurfaceType]: number } {
  for (const surface of SURFACE_TYPES) {
    out[surface] = 0;
  }

  const wheelCount = wheelSurfaces.length;
  for (let i = 0; i < wheelCount; i++) {
    if (!grounded[i]) continue;
    const intensity = slipIntensity(slip[i]);
    if (intensity <= 0) continue;
    const surface = wheelSurfaces[i];
    out[surface] = clamp(out[surface] + WHEEL_SHARE * intensity, 0, 1);
  }

  return out;
}

/** Volume damping rate, 1/sec, fed to `dampFactor` — high enough to track a fast surface transition, low enough to avoid an audible zipper/stepping artefact. `[ASSUMED]`, retuneable by feel. */
const VOLUME_DAMP_LAMBDA = 12;

export interface SurfaceAudio {
  /**
   * Advance every channel's gain toward this frame's `surfaceGains(...)`
   * result. `dtMs` is a variable RENDER-frame delta, matching every other
   * render-tier `update` in this codebase — never the fixed physics tick.
   */
  update(
    wheelSurfaces: readonly SurfaceType[],
    grounded: readonly boolean[],
    slip: readonly number[],
    dtMs: number,
  ): void;
  /** Stops, detaches and disconnects every channel this module created. */
  dispose(): void;
}

/**
 * Build the (up to) six chassis-attached looping channels from `buffers`. A
 * surface whose buffer is absent from `buffers` gets no channel at all, and
 * `update` simply never touches it — the partial-asset degradation path
 * `loadSurfaceLoops` (`src/audio/surface-loops.ts`) relies on.
 *
 * Every channel is started with `play()` ONCE, at construction, and only
 * its gain ever changes thereafter — starting and stopping a looping source
 * per transition produces audible clicks and restarts the loop phase, which
 * would read as a stutter every time a wheel crosses a surface boundary.
 */
export function createSurfaceAudio(
  listener: THREE.AudioListener,
  attachTo: THREE.Object3D,
  buffers: Partial<{ [K in SurfaceType]: AudioBuffer }>,
): SurfaceAudio {
  const channels: Partial<Record<SurfaceType, THREE.PositionalAudio>> = {};

  for (const surface of SURFACE_TYPES) {
    const buffer = buffers[surface];
    if (buffer === undefined) continue; // Partial-asset degradation: no channel, nothing to update.

    const sound = new THREE.PositionalAudio(listener);
    sound.setRefDistance(8);
    sound.setRolloffFactor(1.5);
    sound.setBuffer(buffer);
    sound.setLoop(true);
    sound.setVolume(0);
    attachTo.add(sound);
    sound.play();
    channels[surface] = sound;
  }

  // Reused, mutated-in-place every frame — no per-frame allocation
  // (T-03-38), mirroring `src/render/vehicle-view.ts`'s scratch-object
  // convention.
  const targetGains = {} as { [K in SurfaceType]: number };
  const currentVolumes = {} as { [K in SurfaceType]: number };
  for (const surface of SURFACE_TYPES) {
    targetGains[surface] = 0;
    currentVolumes[surface] = 0;
  }

  return {
    update(
      wheelSurfaces: readonly SurfaceType[],
      grounded: readonly boolean[],
      slip: readonly number[],
      dtMs: number,
    ): void {
      surfaceGains(wheelSurfaces, grounded, slip, targetGains);
      const factor = dampFactor(VOLUME_DAMP_LAMBDA, dtMs / 1000);

      for (const surface of SURFACE_TYPES) {
        const channel = channels[surface];
        if (channel === undefined) continue;
        currentVolumes[surface] += (targetGains[surface] - currentVolumes[surface]) * factor;
        // Clamp immediately before `setVolume` as the last line of defence
        // against a non-finite value ever reaching a real gain node
        // (T-03-35) — belt-and-braces alongside `surfaceGains`' own guard.
        const safeVolume = Number.isFinite(currentVolumes[surface])
          ? clamp(currentVolumes[surface], 0, 1)
          : 0;
        channel.setVolume(safeVolume);
      }
    },

    dispose(): void {
      for (const surface of SURFACE_TYPES) {
        const channel = channels[surface];
        if (channel === undefined) continue;
        channel.stop();
        attachTo.remove(channel);
        channel.disconnect();
      }
    },
  };
}
