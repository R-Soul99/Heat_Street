/** Pure stepper maths. The DOM builder lives in stepper-el.ts (plan 07.1-04). */
export interface StepperSpec {
  step: number;
  coarse: number;
  min: number;
  max: number;
  decimals: number;
}

function clampRound(x: number, spec: StepperSpec): number {
  const c = Math.min(spec.max, Math.max(spec.min, x));
  const f = 10 ** spec.decimals;
  return Math.round(c * f) / f;
}

/** Step v by `step` (or `step * coarse` with shift), clamped and rounded to display decimals. */
export function stepValue(v: number, dir: 1 | -1, spec: StepperSpec, shift: boolean): number {
  const delta = spec.step * (shift ? spec.coarse : 1) * dir;
  return clampRound(v + delta, spec);
}

/** Parse typed text (comma accepted as decimal point). Undefined if not a number. */
export function parseStepperInput(text: string, spec: StepperSpec): number | undefined {
  const t = text.trim().replace(",", ".");
  if (t === "") return undefined;
  const n = Number(t);
  if (!Number.isFinite(n)) return undefined;
  return clampRound(n, spec);
}
