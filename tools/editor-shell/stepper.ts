/** Pure stepper maths (07.1-01, 07.1.1 D-10). The DOM value box lives in controls.ts createStepper. */
export interface StepperSpec {
  step: number;
  coarse: number;
  min: number;
  max: number;
  decimals: number;
  /** Discrete values to step through (ascending); typed input snaps to the nearest. */
  presets?: readonly number[];
}

/** Nearest preset to v; a tie goes to the larger. */
export function snapToPreset(v: number, presets: readonly number[]): number {
  let best = presets[0];
  let bestD = Math.abs(v - best);
  for (const p of presets) {
    const d = Math.abs(v - p);
    if (d < bestD || (d === bestD && p > best)) {
      best = p;
      bestD = d;
    }
  }
  return best;
}

function clampRound(x: number, spec: StepperSpec): number {
  const c = Math.min(spec.max, Math.max(spec.min, x));
  const f = 10 ** spec.decimals;
  return Math.round(c * f) / f;
}

/** Step v by `step` (or `step * coarse` with shift), clamped and rounded to display decimals. */
export function stepValue(v: number, dir: 1 | -1, spec: StepperSpec, shift: boolean): number {
  if (spec.presets && spec.presets.length > 0) {
    const ps = spec.presets;
    let i = -1;
    if (dir > 0) i = ps.findIndex((p) => p > v);
    else
      for (let k = ps.length - 1; k >= 0; k--)
        if (ps[k] < v) {
          i = k;
          break;
        }
    if (i < 0) i = dir > 0 ? ps.length - 1 : 0;
    else if (shift) i += dir;
    const n = Math.min(ps.length - 1, Math.max(0, i));
    return ps[n];
  }
  const delta = spec.step * (shift ? spec.coarse : 1) * dir;
  return clampRound(v + delta, spec);
}

/** Parse typed text (comma accepted as decimal point). Undefined if not a number. */
export function parseStepperInput(text: string, spec: StepperSpec): number | undefined {
  const t = text.trim().replace(",", ".");
  if (t === "") return undefined;
  const n = Number(t);
  if (!Number.isFinite(n)) return undefined;
  if (spec.presets && spec.presets.length > 0) return snapToPreset(n, spec.presets);
  return clampRound(n, spec);
}

/** Horizontal drag pixels per value step; under SCRUB_DEAD_ZONE_PX total movement counts as a click. */
export const SCRUB_PX_PER_STEP = 8;
export const SCRUB_DEAD_ZONE_PX = 3;

/** Convert horizontal drag distance to whole steps, carrying the remainder. */
export function scrubSteps(
  dxPx: number,
  carry: number,
  pxPerStep = SCRUB_PX_PER_STEP,
): { steps: number; carry: number } {
  const total = carry + dxPx;
  const steps = Math.trunc(total / pxPerStep);
  return { steps: steps + 0, carry: total - steps * pxPerStep + 0 };
}

/** Apply a signed whole-step count through stepValue (clamp/round reused). */
export function applySteps(v: number, steps: number, spec: StepperSpec, shift: boolean): number {
  const dir: 1 | -1 = steps < 0 ? -1 : 1;
  let out = v;
  for (let i = 0; i < Math.abs(steps); i++) out = stepValue(out, dir, spec, shift);
  return out;
}

/** Wheel up = increase. Shift+wheel arrives as deltaX in Chrome on Windows. */
export function wheelDir(deltaY: number, deltaX = 0): 1 | -1 | 0 {
  const d = deltaY !== 0 ? deltaY : deltaX;
  if (d < 0) return 1;
  if (d > 0) return -1;
  return 0;
}
