/**
 * Tyre "slip" for visual/audio effects: how close a wheel is to its friction
 * limit, as a dimensionless ratio. Pure and Rapier-free so it is unit-testable.
 *
 * Why not the raw impulse: `hypot(wheelSideImpulse, wheelForwardImpulse)` is how
 * hard the tyre is pushing, not whether it is sliding. Under full throttle the
 * forward impulse is simply `engineForce * DT` (80 at the current tuning) at
 * every speed, so thresholds in impulse units flagged every flat-out run as a
 * skid and had to be recalibrated whenever the engine was retuned.
 *
 * `[MEASURED]` (headless run, default tuning, flat ground, rear wheels), with
 * ratio = hypot(side, forward) / (frictionSlip * suspensionForce * DT):
 *   - tarmac, full throttle, straight (any speed): 0.88   -> gripping
 *   - tarmac, launch wheelspin (first ~1.5 s):     ~1.0-1.6 -> sliding
 *   - tarmac, sustained turn (steer 0.12):         ~1.1   -> sliding
 *   - tarmac, handbrake slide:                     ~1.25-1.4 -> sliding
 *   - loose surfaces rise with their lower grip: gravel/dirt ~1.15 and
 *     grass 1.6, sand 1.95, mud 2.0 at full throttle (wheelspin by design).
 * The ratio saturates near 2.
 */

/** Ratio ceiling; keeps a degenerate (near-zero load) reading from spiking downstream maths. */
export const TYRE_SLIP_RATIO_MAX = 3;

/** How far below its trigger threshold a wheel's ratio must fall before it counts as gripping again — stops marks/smoke chattering at the boundary. */
export const TYRE_SLIP_RELEASE_MARGIN = 0.08;

/**
 * `hypot(side, forward) / (frictionSlip * suspensionForce * dt)`, clamped to
 * `[0, TYRE_SLIP_RATIO_MAX]`. Returns 0 for a wheel with no load (airborne) or
 * any non-finite input.
 */
export function tyreSlipRatio(
  sideImpulse: number,
  forwardImpulse: number,
  frictionSlip: number,
  suspensionForce: number,
  dt: number,
): number {
  const limit = frictionSlip * suspensionForce * dt;
  if (!Number.isFinite(limit) || limit <= 1e-6) return 0;
  const ratio = Math.hypot(sideImpulse, forwardImpulse) / limit;
  if (!Number.isFinite(ratio)) return 0;
  return ratio < 0 ? 0 : ratio > TYRE_SLIP_RATIO_MAX ? TYRE_SLIP_RATIO_MAX : ratio;
}

/** Latch with hysteresis: starts sliding above `threshold`, stops below `threshold - TYRE_SLIP_RELEASE_MARGIN`. */
export function nextSliding(wasSliding: boolean, ratio: number, threshold: number): boolean {
  return wasSliding ? ratio > threshold - TYRE_SLIP_RELEASE_MARGIN : ratio > threshold;
}
