export interface StepOptions {
  step: number;
  /** Multiplier applied to step while Shift is held. */
  coarse: number;
  min: number;
  max: number;
  decimals: number;
}

const clamp = (v: number, min: number, max: number): number => Math.min(max, Math.max(min, v));

/** Step then clamp, then round to display decimals (no float noise). */
export function stepValue(v: number, dir: 1 | -1, o: StepOptions, coarse: boolean): number {
  const delta = o.step * (coarse ? o.coarse : 1) * dir;
  const clamped = clamp(v + delta, o.min, o.max);
  const f = 10 ** o.decimals;
  return Math.round(clamped * f) / f;
}

/** Parse typed text. Null when empty or not a finite number; full precision kept. */
export function parseNumberInput(text: string, o: Pick<StepOptions, "min" | "max">): number | null {
  const t = text.trim();
  if (t === "") return null;
  const n = Number(t);
  if (!Number.isFinite(n)) return null;
  return clamp(n, o.min, o.max);
}
