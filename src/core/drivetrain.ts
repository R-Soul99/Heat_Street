/**
 * Arcade gearbox / power-curve model: turns the flat per-wheel engine force
 * into a speed-dependent one. Before this, engine force was constant at every
 * speed, so the only thing stopping the car was linear damping — top speed was
 * far too high and low gear had no extra punch over high gear.
 *
 * Five gears, selected purely from forward speed as a fraction of the
 * tunable top speed. Each gear has a force multiplier (low gears pull
 * harder) and a power band that fades the force as the gear runs out of
 * revs; a final limiter tapers the force to zero at top speed. No state, so
 * the result is a pure function of speed (determinism-safe).
 *
 * Pure by construction (see `tests/layering.test.ts`): no three, no rapier,
 * no DOM.
 */

interface Gear {
  /** Upper speed of this gear as a fraction of top speed. */
  readonly maxFrac: number;
  /** Force multiplier relative to the tuned per-wheel engine force. */
  readonly force: number;
}

const GEARS: readonly Gear[] = [
  { maxFrac: 0.2, force: 1.7 },
  { maxFrac: 0.38, force: 1.3 },
  { maxFrac: 0.58, force: 1.0 },
  { maxFrac: 0.8, force: 0.78 },
  { maxFrac: 1.0, force: 0.62 },
];

/** Fraction of top speed over which the limiter tapers force to zero. */
const LIMITER_BAND = 0.06;

/** Zero-based gear index for a forward speed (m/s). */
export function gearForSpeed(speedMs: number, topSpeedMs: number): number {
  const frac = Math.max(0, speedMs) / topSpeedMs;
  for (let i = 0; i < GEARS.length; i++) {
    if (frac < GEARS[i].maxFrac) return i;
  }
  return GEARS.length - 1;
}

/**
 * Multiplier applied to the tuned engine force at this forward speed.
 * Positive speeds only; non-positive speed uses first gear. `steerAbs`
 * (0..1) fades the low-gear pull up to half way toward 1.0: traction spent cornering is not
 * available for launching, and without this a full-lock, full-throttle exit
 * from a spin at walking pace pivots on the tail instead of recovering.
 */
export function engineForceScale(speedMs: number, topSpeedMs: number, steerAbs = 0): number {
  const frac = Math.max(0, speedMs) / topSpeedMs;
  if (frac >= 1) return 0;
  const i = gearForSpeed(speedMs, topSpeedMs);
  const lo = i === 0 ? 0 : GEARS[i - 1].maxFrac;
  const rev = (frac - lo) / (GEARS[i].maxFrac - lo); // 0..1 through the gear
  const powerBand = 1 - 0.35 * rev * rev;
  const limiter = Math.min(1, (1 - frac) / LIMITER_BAND);
  const g = GEARS[i].force;
  // Only the low-gear boost (g > 1) fades; high gears keep their reduced pull.
  const gearForce = g > 1 ? 1 + (g - 1) * (1 - 0.5 * Math.min(1, Math.max(0, steerAbs))) : g;
  return gearForce * powerBand * limiter;
}

/** Speed (m/s) below which steering lock is not reduced. */
export const STEER_FADE_START_MS = 12;

/** Reverse top speed (m/s): the same gear curve, scaled to this speed. */
export const REVERSE_TOP_MS = 14;

/**
 * Multiplier on max steering lock at this ground speed: 1 up to
 * `STEER_FADE_START_MS`, easing (smoothstep) down to `topFraction` at top
 * speed and beyond.
 */
export function steerLockScale(speedMs: number, topSpeedMs: number, topFraction: number): number {
  const span = Math.max(1e-6, topSpeedMs - STEER_FADE_START_MS);
  const x = Math.min(1, Math.max(0, (speedMs - STEER_FADE_START_MS) / span));
  const ease = x * x * (3 - 2 * x);
  return 1 + (topFraction - 1) * ease;
}
