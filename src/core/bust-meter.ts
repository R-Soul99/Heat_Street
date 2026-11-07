/**
 * Bust meter (first pursuit-pressure prototype, 2026-11-07).
 *
 * A pure, deterministic step function. Only pursuers that can SEE the player
 * (line of sight, supplied by the caller) count. A lone pursuer, however close,
 * can raise the meter only to `softCap` (pressure you can feel but cannot be
 * busted by): getting BUSTED needs boxing in (two visible pursuers close on
 * opposite sides) AND a car that cannot get away: the fill rate scales with how
 * stopped the player is and is zero above `freeSpeedMs`, so a player who is
 * still moving, however surrounded, is never busted. A DISABLED player (flipped for a
 * while, so it cannot drive even while being shoved along) counts as stopped, but
 * still has to be boxed in: a flipped car with one pursuer nearby is not a bust,
 * it might right itself. The meter drains when you get
 * away, and latches BUSTED at 1. If every pursuer stays far away long enough it
 * latches ESCAPED instead. Even boxed in and stationary it takes seconds.
 *
 * No physics, no DOM, no clock, no randomness: a function of (state, one tick of
 * input), so it is vitest-testable and replays identically.
 */

export interface BustParams {
  /** Pursuers farther than this contribute nothing, metres. */
  readonly radiusM: number;
  /** Player speed at/above which being chased adds no pressure by itself, m/s. */
  readonly freeSpeedMs: number;
  /** Fill per second at full pressure, 1 = bust in 1 s. */
  readonly fillPerSec: number;
  /** Drain per second when nobody is pressing. */
  readonly drainPerSec: number;
  /** Two close pursuers on opposite sides (bearing gap above this, rad) count as boxing in. */
  readonly boxedAngleRad: number;
  /** Highest level a lone (not boxing in) pursuer can push the meter to. */
  readonly softCap: number;
  /** All pursuers beyond this for `escapeSec` = ESCAPED, metres. */
  readonly escapeRadiusM: number;
  readonly escapeSec: number;
}

export const DEFAULT_BUST_PARAMS: BustParams = Object.freeze({
  radiusM: 10,
  freeSpeedMs: 4.5,
  fillPerSec: 0.3,
  drainPerSec: 0.2,
  boxedAngleRad: (100 * Math.PI) / 180,
  softCap: 0.4,
  escapeRadiusM: 90,
  escapeSec: 6,
});

export interface BustState {
  /** 0..1. */
  readonly level: number;
  readonly busted: boolean;
  readonly escaped: boolean;
  /** Distance to the nearest pursuer, seen or not, metres (Infinity with none). Escape needs ALL pursuers far, so hidden ones still count. */
  readonly nearestM: number;
  readonly boxed: boolean;
  readonly farSec: number;
}

export const INITIAL_BUST_STATE: BustState = Object.freeze({
  level: 0,
  busted: false,
  escaped: false,
  nearestM: Number.POSITIVE_INFINITY,
  boxed: false,
  farSec: 0,
});

export interface BustInput {
  readonly dtSec: number;
  readonly player: {
    readonly x: number;
    readonly z: number;
    readonly speedMs: number;
  };
  /** `visible: false` = a building is in the way; hidden pursuers neither press nor box in nor count as near. Default visible. */
  readonly pursuers: readonly {
    readonly x: number;
    readonly z: number;
    readonly visible?: boolean;
  }[];
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export function stepBustMeter(
  state: BustState,
  input: BustInput,
  params: BustParams = DEFAULT_BUST_PARAMS,
): BustState {
  if (state.busted || state.escaped) return state;

  let nearest = Number.POSITIVE_INFINITY;
  const close: { prox: number; bearing: number }[] = [];
  for (const p of input.pursuers) {
    const dx = p.x - input.player.x;
    const dz = p.z - input.player.z;
    const d = Math.hypot(dx, dz);
    const visible = p.visible !== false;
    if (d < nearest) nearest = d;
    if (visible && d < params.radiusM) {
      close.push({ prox: 1 - d / params.radiusM, bearing: Math.atan2(dz, dx) });
    }
  }

  // Pressure: the closest pursuer counts fully, the others half each (capped).
  close.sort((a, b) => b.prox - a.prox);
  let pressure = 0;
  for (let i = 0; i < close.length; i++) {
    pressure += (close[i] as { prox: number }).prox * (i === 0 ? 1 : 0.5);
  }
  pressure = Math.min(1.5, pressure);

  let boxed = false;
  for (let i = 0; i < close.length && !boxed; i++) {
    for (let j = i + 1; j < close.length; j++) {
      const a = (close[i] as { bearing: number }).bearing;
      const b = (close[j] as { bearing: number }).bearing;
      const gap = Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
      if (gap > params.boxedAngleRad) {
        boxed = true;
        break;
      }
    }
  }

  const slow = 1 - clamp(input.player.speedMs / params.freeSpeedMs, 0, 1);
  const slowness = slow;
  const fillRate = params.fillPerSec * pressure * slowness;
  const relief = 1 - clamp(fillRate / params.fillPerSec, 0, 1);
  const ceiling = boxed ? 1 : params.softCap;
  let net = fillRate - params.drainPerSec * relief;
  if (state.level >= ceiling && net > 0) net = state.level > ceiling ? -params.drainPerSec : 0;
  let level = clamp(state.level + net * input.dtSec, 0, 1);
  if (net > 0 && level > ceiling) level = Math.max(state.level, ceiling);

  const farSec = nearest > params.escapeRadiusM ? state.farSec + input.dtSec : 0;
  return {
    level,
    busted: level >= 1,
    escaped: level < 1 && farSec >= params.escapeSec,
    nearestM: nearest,
    boxed,
    farSec,
  };
}
