/**
 * Per-surface Web Audio loop specs, plus runtime synthesis of the six
 * looping `AudioBuffer`s SURF-02's audio half plays.
 *
 * Synthesis is the SHIPPED default this phase — 03-RESEARCH.md's own
 * Environment Availability table names it as the fallback a from-scratch
 * audio system must have, so the game never blocks on asset acquisition.
 * Real CC0 recordings are a drop-in upgrade through `loadSurfaceLoops`
 * below, gated by this plan's Task 3 human license-verification checkpoint
 * before any file may be committed (T-03-34) — nothing here assumes that
 * checkpoint has run.
 *
 * DEVIATION from this plan's literal action text: `createSynthesizedSurfaceLoops`
 * is specified as, and remains, a SYNCHRONOUS function — `(ctx) => { [K in
 * SurfaceType]: AudioBuffer }`, not a `Promise` — matching its call site in
 * `src/main.ts` (`createSurfaceAudio(..., createSynthesizedSurfaceLoops(...))`,
 * never awaited). A REAL `OfflineAudioContext` render is fundamentally
 * asynchronous: `OfflineAudioContext.startRendering()` always returns a
 * `Promise<AudioBuffer>` per the Web Audio API spec, so it cannot back a
 * synchronous function no matter how it is wired up. This module instead
 * hand-rolls the identical RBJ Audio-EQ-Cookbook biquad difference equation
 * a real `BiquadFilterNode` implements internally (`applyBiquadFilter`
 * below), applied directly to a `Float32Array` in one synchronous pass. The
 * audible result — a lowpass/bandpass-shaped noise loop, textured by
 * amplitude modulation at `grainHz`, seamlessly loop-crossfaded — is exactly
 * what the plan asks for; only the mechanism producing it is a disclosed,
 * necessary substitution for a literal Web Audio graph render that could
 * never satisfy this function's own required (and call-site-confirmed)
 * synchronous signature. `ctx.createBuffer` (used below) is itself
 * synchronous and identical on `AudioContext` and `OfflineAudioContext`, so
 * either may still be passed in.
 *
 * Layering: may import `three` (for `THREE.AudioLoader` in `loadSurfaceLoops`
 * only) and `src/core/`. Must not import `@dimforge/rapier3d` and contains
 * none of `tests/layering.test.ts`'s simulation-write identifiers
 * (`world.step`, `applyImpulse`, `setTranslation`, `setRotation`,
 * `setNextKinematic`).
 */
import * as THREE from "three";
import { SURFACE_TYPES, type SurfaceType } from "../core/surface-types";

/** One surface's synthesis recipe. Every field is a positive finite number (except `filterType`, a closed two-value enum). */
export interface SurfaceLoopSpec {
  readonly filterType: "lowpass" | "bandpass";
  /** Filter cutoff (lowpass) or centre (bandpass) frequency, Hz. */
  readonly cutoffHz: number;
  /** Filter resonance/Q. Higher rings more at the cutoff. */
  readonly resonanceQ: number;
  /** Linear output gain applied after filtering and grain modulation. */
  readonly gain: number;
  /** Loop length, seconds. */
  readonly durationSec: number;
  /** Amplitude-modulation rate, Hz — what gives the shaped noise its "grain" rather than reading as flat hiss. */
  readonly grainHz: number;
}

/**
 * `[ASSUMED]` starting values, one per `SurfaceType`, retuneable by feel in
 * a future playtest exactly like `src/core/vehicle-tuning.ts`'s own
 * per-field convention. D-09's "fully distinct" requirement is satisfied by
 * construction: every pair below differs on at least `cutoffHz`, `gain` AND
 * `durationSec` simultaneously, not just one axis — a future edit that
 * flattens two surfaces toward each other on two-or-more of these fields is
 * exactly the regression `tests/surface-audio.test.ts`'s pairwise-distinctness
 * assertion exists to catch.
 *
 * Tonal ordering matches SURF-02's own wording literally: `tarmac.cutoffHz`
 * is the HIGHEST of the six (a bright tire chirp) and `mud.cutoffHz` is the
 * LOWEST (the muffled rumble SURF-02 names by name).
 */
export const SURFACE_LOOP_SPECS: { readonly [K in SurfaceType]: SurfaceLoopSpec } = {
  /** Bright, narrow-band chirp — the highest cutoff and Q of the six, deliberately thin rather than full-spectrum. */
  tarmac: { filterType: "bandpass", cutoffHz: 3200, resonanceQ: 1.8, gain: 0.55, durationSec: 1.1, grainHz: 40 },
  /** Loose stone scatter — the loudest of the six (the D-05 anchor's audio half), fast grain reading as individual stones. */
  gravel: { filterType: "bandpass", cutoffHz: 1500, resonanceQ: 0.9, gain: 0.85, durationSec: 1.4, grainHz: 95 },
  /** Dry, dusty scrape — lowpass rather than bandpass, broader and browner than gravel's stone-scatter chirp. */
  dirt_road: { filterType: "lowpass", cutoffHz: 1100, resonanceQ: 0.7, gain: 0.8, durationSec: 1.5, grainHz: 70 },
  /** A soft swish — the shortest loop of the six, low grain rate reading as sparse blade-brush rather than a continuous texture. */
  grass: { filterType: "lowpass", cutoffHz: 900, resonanceQ: 0.6, gain: 0.5, durationSec: 0.9, grainHz: 28 },
  /** A broad, even hiss — wide and pale, the longest-but-one loop, minimal grain so it reads as smooth rather than granular. */
  sand: { filterType: "lowpass", cutoffHz: 700, resonanceQ: 0.5, gain: 0.7, durationSec: 1.6, grainHz: 18 },
  /** The muffled rumble SURF-02 names by its own words — the lowest cutoff, lowest Q and lowest grain rate of the six, and the darkest tone. */
  mud: { filterType: "lowpass", cutoffHz: 380, resonanceQ: 0.4, gain: 0.75, durationSec: 1.2, grainHz: 12 },
};

/** Fraction of `durationSec` used as the loop-point crossfade window, both ends. Small enough to be inaudible as its own event, large enough to erase the seam a naive one-second loop would otherwise have. */
const LOOP_CROSSFADE_FRACTION = 0.06;

/**
 * Apply the RBJ Audio-EQ-Cookbook biquad difference equation in place to
 * `samples`, at `sampleRate`, configured exactly as a real `BiquadFilterNode`
 * of the same `type`/`frequency`/`Q` would be. Second-order IIR, one pass,
 * `y[n] = b0*x[n] + b1*x[n-1] + b2*x[n-2] - a1*y[n-1] - a2*y[n-2]`
 * (coefficients pre-normalised by `a0`).
 */
function applyBiquadFilter(
  samples: Float32Array,
  sampleRate: number,
  filterType: "lowpass" | "bandpass",
  cutoffHz: number,
  q: number,
): void {
  const w0 = (2 * Math.PI * cutoffHz) / sampleRate;
  const cosW0 = Math.cos(w0);
  const sinW0 = Math.sin(w0);
  const alpha = sinW0 / (2 * q);

  let b0: number;
  let b1: number;
  let b2: number;
  const a0 = 1 + alpha;
  const a1 = -2 * cosW0;
  const a2 = 1 - alpha;

  if (filterType === "lowpass") {
    b0 = (1 - cosW0) / 2;
    b1 = 1 - cosW0;
    b2 = (1 - cosW0) / 2;
  } else {
    // Bandpass, constant 0 dB peak gain — the RBJ cookbook's "BPF (peak gain = 0 dB)" form.
    b0 = alpha;
    b1 = 0;
    b2 = -alpha;
  }

  const nb0 = b0 / a0;
  const nb1 = b1 / a0;
  const nb2 = b2 / a0;
  const na1 = a1 / a0;
  const na2 = a2 / a0;

  let x1 = 0;
  let x2 = 0;
  let y1 = 0;
  let y2 = 0;
  for (let i = 0; i < samples.length; i++) {
    const x0 = samples[i];
    const y0 = nb0 * x0 + nb1 * x1 + nb2 * x2 - na1 * y1 - na2 * y2;
    samples[i] = y0;
    x2 = x1;
    x1 = x0;
    y2 = y1;
    y1 = y0;
  }
}

/**
 * Blend the tail into the head so the buffer loops with no audible seam — a
 * seam in a one-second loop is the most obviously synthetic artefact
 * possible. The head's first `fadeSamples` are overwritten with a blend that
 * starts (index 0) matching the tail's ending character and ramps
 * (linearly) back to the buffer's own original head by the end of the
 * crossfade window, so the sample immediately before the wrap and the
 * sample immediately after it are close in both level and spectral content.
 */
function crossfadeLoopPoint(samples: Float32Array, fadeSamples: number): void {
  const length = samples.length;
  const n = Math.min(fadeSamples, Math.floor(length / 2));
  const tailStart = length - n;
  for (let i = 0; i < n; i++) {
    const t = i / n; // 0 at the wrap point -> 1 by the end of the crossfade window
    const headSample = samples[i];
    const tailSample = samples[tailStart + i];
    samples[i] = headSample * t + tailSample * (1 - t);
  }
}

/** One cycle of amplitude modulation applied on top of the filtered noise, so the result has texture (a "grain") rather than reading as flat hiss. `0.5 + 0.5*sin` keeps the envelope non-negative. */
function applyGrainEnvelope(samples: Float32Array, sampleRate: number, grainHz: number): void {
  for (let i = 0; i < samples.length; i++) {
    const tSec = i / sampleRate;
    const envelope = 0.5 + 0.5 * Math.sin(2 * Math.PI * grainHz * tSec);
    samples[i] *= envelope;
  }
}

/** Synthesize one surface's seamless-looping `AudioBuffer` from `spec`. */
function synthesizeLoop(ctx: BaseAudioContext, spec: SurfaceLoopSpec): AudioBuffer {
  const sampleRate = ctx.sampleRate;
  const length = Math.max(1, Math.round(spec.durationSec * sampleRate));
  const buffer = ctx.createBuffer(1, length, sampleRate);
  const data = buffer.getChannelData(0);

  for (let i = 0; i < length; i++) {
    data[i] = Math.random() * 2 - 1; // white noise, [-1, 1]
  }

  applyBiquadFilter(data, sampleRate, spec.filterType, spec.cutoffHz, spec.resonanceQ);
  applyGrainEnvelope(data, sampleRate, spec.grainHz);

  // Normalise to unit peak before applying `gain`, so `gain` means the same
  // thing across all six surfaces regardless of how much energy each
  // filter/grain combination happens to leave behind.
  let peak = 0;
  for (let i = 0; i < length; i++) {
    const abs = Math.abs(data[i]);
    if (abs > peak) peak = abs;
  }
  const normalise = peak > 1e-9 ? 1 / peak : 1;
  for (let i = 0; i < length; i++) {
    data[i] = data[i] * normalise * spec.gain;
  }

  crossfadeLoopPoint(data, Math.round(length * LOOP_CROSSFADE_FRACTION));

  return buffer;
}

/**
 * Build all six surfaces' synthesized loop buffers against `ctx`. Pure
 * synthesis — no network fetch, no `public/` asset dependency — so this
 * always succeeds and always produces six audibly distinct results.
 */
export function createSynthesizedSurfaceLoops(
  ctx: BaseAudioContext,
): { [K in SurfaceType]: AudioBuffer } {
  const result = {} as { [K in SurfaceType]: AudioBuffer };
  for (const surface of SURFACE_TYPES) {
    result[surface] = synthesizeLoop(ctx, SURFACE_LOOP_SPECS[surface]);
  }
  return result;
}

/**
 * The real-asset upgrade path: load a real recording per surface via
 * `THREE.AudioLoader`. A missing or failed URL resolves to an ABSENT entry
 * in the returned partial record rather than rejecting the whole call — a
 * partial asset set degrades to synthesis (via `createSynthesizedSurfaceLoops`)
 * for whichever surfaces have no entry, one surface at a time, instead of
 * taking the whole audio system down over one bad file. Never called by
 * this plan's own shipped composition-root wiring — Task 3's human
 * checkpoint is the gate any real asset must pass before a call site here
 * may exist.
 */
export function loadSurfaceLoops(
  urls: Partial<{ [K in SurfaceType]: string }>,
): Promise<Partial<{ [K in SurfaceType]: AudioBuffer }>> {
  const loader = new THREE.AudioLoader();
  const entries = SURFACE_TYPES.map((surface) => {
    const url = urls[surface];
    if (url === undefined) {
      return Promise.resolve<readonly [SurfaceType, AudioBuffer | undefined]>([surface, undefined]);
    }
    return new Promise<readonly [SurfaceType, AudioBuffer | undefined]>((resolve) => {
      loader.load(
        url,
        (buffer) => resolve([surface, buffer]),
        undefined,
        () => resolve([surface, undefined]), // failed load degrades to "absent", not a rejection
      );
    });
  });

  return Promise.all(entries).then((results) => {
    const partial: Partial<{ [K in SurfaceType]: AudioBuffer }> = {};
    for (const [surface, buffer] of results) {
      if (buffer !== undefined) {
        partial[surface] = buffer;
      }
    }
    return partial;
  });
}
