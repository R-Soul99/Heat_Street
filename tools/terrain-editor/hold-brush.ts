// Pure timing for brushes that keep applying while the pointer is held still (quick 261116-a53).
// No DOM or timers: the editor feeds real elapsed time in and applies one dab per returned tick.

/** Held brushes apply at this fixed rate (ticks per second). */
export const HOLD_TICK_S = 1 / 20;
/** A long frame (tab stall, slow rebuild) counts as at most this much time. */
export const HOLD_MAX_FRAME_S = 0.1;
/** The pointer counts as "moving" (its own dabs apply, held ticks pause) past this travel in metres. */
export const HOLD_MOVE_EPS_M = 0.05;
/** After a moving dab the held ticks wait this long, so a drag is never applied twice over. */
export const HOLD_IDLE_S = 0.15;

/** Brush tools that add or remove height or smooth. Paint, road and erase brushes never hold. */
const HOLD_TOOLS: readonly string[] = ["raise", "lower", "smooth", "flatten"];

export function isHoldTool(tool: string): boolean {
  return HOLD_TOOLS.includes(tool);
}

export interface HoldAccumulator {
  /** Adds elapsed seconds (clamped); returns how many whole ticks to apply now. */
  advance(dtS: number): number;
  reset(): void;
}

export function createHoldAccumulator(
  tickS: number = HOLD_TICK_S,
  maxFrameS: number = HOLD_MAX_FRAME_S,
): HoldAccumulator {
  let acc = 0;
  return {
    advance(dtS: number): number {
      if (!Number.isFinite(dtS) || dtS <= 0) return 0;
      acc += Math.min(dtS, maxFrameS);
      const ticks = Math.floor(acc / tickS + 1e-9);
      acc -= ticks * tickS;
      if (acc < 0) acc = 0;
      return ticks;
    },
    reset(): void {
      acc = 0;
    },
  };
}

/**
 * Per-tick blend strength for smooth and flatten when `strength` means "fraction per second":
 * after one second of holding the total blend equals one stroke at `strength`. Strength 1 is
 * held just under 1 so a held stroke still builds up over time instead of finishing in a tick.
 */
export function heldTickStrength(strength: number, tickS: number = HOLD_TICK_S): number {
  if (!Number.isFinite(strength) || strength <= 0) return 0;
  const s = Math.min(strength, 0.999);
  return 1 - (1 - s) ** tickS;
}
