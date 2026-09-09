/**
 * The retro analog speedometer: a pure mph/angle/damping half plus a
 * `createElementNS`-built SVG DOM half.
 *
 * Layering: receives plain numbers; imports neither `three` nor Rapier; never
 * writes simulation state; never reads a clock. `src/hud/` is a new tier
 * (02-UI-SPEC.md Architecture Call 2) that sits alongside `src/render/` (the
 * 3D scene) and `src/debug/` (dev-only overlays) — this file is player-facing
 * and always on.
 *
 * The two halves are kept deliberately separate, mirroring
 * `src/debug/profiler-hud.ts:9-13`: the pure half (`mphFromGroundSpeed`,
 * `needleAngleDeg`, `dampStep`, `readoutColour`) is Node-testable (see
 * `tests/speedometer.test.ts`); `createSpeedometer` needs a real DOM and is
 * covered only by the human browser checkpoint in plan 02-10.
 */

/** m/s -> mph. NHTSA/NIST conversion factor, not a rounded approximation. */
export const MS_TO_MPH = 2.2369362920544;

/** D-12: the dial's displayed range is 0-160 mph. */
export const MAX_MPH = 160;

/**
 * The redline starts at exactly the 120 mph ramp-jump target (02-UI-SPEC.md
 * "Redline start: 120 mph") so entering amber is the legible "fast enough to
 * jump" signal. BOTH colour switches — the redline band start and the digital
 * readout turning amber — use this same threshold, so the instrument tells
 * one story instead of two.
 */
export const REDLINE_MPH = 120;

/** Needle angle at 0 mph: lower-left. 02-UI-SPEC.md Speedometer Geometry Contract. */
export const SWEEP_START_DEG = -120;

/** Total needle sweep, 0 mph to MAX_MPH. */
export const SWEEP_DEG = 240;

/**
 * Digit-damping time constant, in seconds. Used in the `1 - exp(-dt/tau)`
 * form below, chosen to settle within ~95% of a step change in ~0.36s
 * (0.36 / 0.12 = 3 time constants, 1 - e^-3 ~= 0.95).
 */
export const DIGIT_TAU_SEC = 0.12;

/**
 * Convert ground speed (m/s) to mph for display.
 *
 * Pitfall 1 (02-RESEARCH.md, [MEASURED]): the vehicle controller's own
 * built-in speed getter must NEVER be used as the source here. It returns the
 * full 3D velocity magnitude including vertical motion (measured -23.32 where
 * true ground speed was 20.0), and its sign is `linvel . forwardAxis` where
 * the forward axis defaults to +X — numerical noise for a -Z-forward car
 * (measured -19.135 while true forward speed was +19.185). The composition
 * root must instead pass `Math.hypot(linvel.x, linvel.z)` into this function.
 */
export function mphFromGroundSpeed(groundSpeedMs: number): number {
  return groundSpeedMs * MS_TO_MPH;
}

/**
 * Map an mph value onto the needle's rotation angle in degrees, clamped so
 * the needle can never sweep past 0 mph or MAX_MPH. The needle pins at both
 * ends rather than continuing to rotate.
 */
export function needleAngleDeg(mph: number): number {
  const t = Math.min(1, Math.max(0, mph / MAX_MPH));
  return SWEEP_START_DEG + t * SWEEP_DEG;
}

/**
 * Advance the damped digital-readout value one step toward `targetMph`,
 * given the elapsed frame time `dtMs`.
 *
 * Uses the `1 - exp(-dt/tau)` exponential-decay form rather than a fixed
 * lerp (`damped += (target - damped) * 0.2`). The fixed-lerp form smooths
 * ~2.4x harder at 144 Hz than at 60 Hz (more, smaller steps per second
 * converge faster in wall-clock time), and would reintroduce the
 * framerate-dependence Phase 1 spent seven plans eliminating. This form
 * converges to the same value in the same wall-clock time regardless of how
 * many frames it is split across.
 */
export function dampStep(damped: number, targetMph: number, dtMs: number): number {
  const alpha = 1 - Math.exp(-(dtMs / 1000) / DIGIT_TAU_SEC);
  return damped + (targetMph - damped) * alpha;
}

/** Digital readout colour: amber at/above the redline, off-white below it. */
export function readoutColour(dampedMph: number): string {
  return dampedMph >= REDLINE_MPH ? "#E8A33D" : "#F2EFE6";
}
