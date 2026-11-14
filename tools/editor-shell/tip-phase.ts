// Pure tooltip timing (07.1.1 D-08). tooltips.ts drives its timers from this.
// Discretion choice: the 3 s visible window restarts when the long text swaps in,
// so the long how-to gets a full 3 s to read; without long text the tip fades
// 3 s after it first shows.

export const TIP_DELAY_MS = 700;
export const TIP_LONG_EXTRA_MS = 1500;
export const TIP_VISIBLE_MS = 3000;
export const TIP_FADE_OUT_MS = 250;

export type TipPhase = "hidden" | "short" | "long" | "faded";

export function tipSchedule(hasLong: boolean): {
  showAt: number;
  longAt: number | undefined;
  fadeAt: number;
} {
  const showAt = TIP_DELAY_MS;
  const longAt = hasLong ? showAt + TIP_LONG_EXTRA_MS : undefined;
  const fadeAt = (longAt ?? showAt) + TIP_VISIBLE_MS;
  return { showAt, longAt, fadeAt };
}

export function tipPhase(elapsedMs: number, hasLong: boolean): TipPhase {
  const { showAt, longAt, fadeAt } = tipSchedule(hasLong);
  if (elapsedMs < showAt) return "hidden";
  if (elapsedMs >= fadeAt) return "faded";
  if (longAt !== undefined && elapsedMs >= longAt) return "long";
  return "short";
}
