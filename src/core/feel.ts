/**
 * The simplified "feel" layer: a handful of 0..10 sliders that drive the
 * hundreds of underlying tuning values, so the car can be dialled in by feel
 * (`?feel`) before the result is translated back into proper physics numbers.
 *
 * Every slider is a multiplier (or offset) on the player's CLASS BASE tuning,
 * so the same sliders work for rwd/fwd/awd, and mid-scale (5) is exactly the
 * base handling - except `flick`, which is a new mechanic and so defaults to
 * 4. `applyFeel` is idempotent: it always writes from `base`, never from the
 * live values, so dragging a slider back and forth never drifts.
 *
 * Pure by construction (see `tests/layering.test.ts`): no three, no rapier,
 * no DOM. The localStorage string is untrusted and goes through
 * `parseSavedFeel` like every other persisted blob.
 */

import { clampTuning, type VehicleTuning } from "./vehicle-tuning";

export interface FeelSettings {
  /** Cornering grip. Low = sloppy/understeer, high = planted. Base 5. */
  grip: number;
  /** How much steering lock is left at speed. Low = lazy at speed. Base 5. */
  steerAtSpeed: number;
  /** How fast the steering reaches full lock. Base 5. */
  turnIn: number;
  /** Engine power. Base 5. */
  accel: number;
  /** Extra pull in the low gears (launch). Base 5. */
  lowGearPunch: number;
  /** Top speed. Base 5. */
  topSpeed: number;
  /** Rear looseness: throttle power-slide and a looser tail. Base 5. */
  looseness: number;
  /** Pivot turn: low-speed doughnut helper. 0 = off (the default). */
  pivot: number;
  /** Pivot ease-in: how gently the pivot takes over. Low = abrupt, high = gradual. Default 10. */
  pivotEase: number;
  /** Weight-shift flick: steer one way, then hard the other to kick the tail out. 0 = off. */
  flick: number;
}

export type FeelKey = keyof FeelSettings;

export const FEEL_MIN = 0;
export const FEEL_MAX = 10;

export const FEEL_DEFAULTS: Readonly<FeelSettings> = Object.freeze({
  grip: 5,
  steerAtSpeed: 5,
  turnIn: 5,
  accel: 5,
  lowGearPunch: 5,
  topSpeed: 5,
  looseness: 5,
  pivot: 0,
  // 10 = the gentlest ramp (0.45 s): chosen by the user after trying 5 (0.25 s).
  pivotEase: 10,
  flick: 4,
});

/** Slider order and the wording shown to the player. */
export const FEEL_CONTROLS: readonly { key: FeelKey; label: string }[] = Object.freeze([
  { key: "grip", label: "Grip (low = understeer)" },
  { key: "steerAtSpeed", label: "Steering at speed" },
  { key: "turnIn", label: "Turn-in speed" },
  { key: "accel", label: "Acceleration" },
  { key: "lowGearPunch", label: "Low-gear punch" },
  { key: "topSpeed", label: "Top speed" },
  { key: "looseness", label: "Rear looseness" },
  { key: "pivot", label: "Pivot turn (doughnuts)" },
  { key: "pivotEase", label: "Pivot ease-in (high = smoother)" },
  { key: "flick", label: "Weight-shift flick" },
]);

export const FEEL_STORAGE_KEY = "heat-street.feel.v1";

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/**
 * Piecewise map of a 0..10 slider through three anchor values: `lo` at 0,
 * `mid` at 5 (the base) and `hi` at 10. Keeps 5 exactly neutral while still
 * giving each side its own range.
 */
function anchored(s: number, lo: number, mid: number, hi: number): number {
  return s <= 5 ? lerp(lo, mid, s / 5) : lerp(mid, hi, (s - 5) / 5);
}

/**
 * Write the tuning values implied by `feel` onto `target`, starting from
 * `base` for every value a slider touches. Values are clamped into
 * `TUNING_RANGES` afterwards. `target` is mutated in place because the live
 * game holds one tuning object by reference.
 */
export function applyFeel(target: VehicleTuning, base: VehicleTuning, feel: FeelSettings): void {
  const f: FeelSettings = {
    grip: clamp(feel.grip, FEEL_MIN, FEEL_MAX),
    steerAtSpeed: clamp(feel.steerAtSpeed, FEEL_MIN, FEEL_MAX),
    turnIn: clamp(feel.turnIn, FEEL_MIN, FEEL_MAX),
    accel: clamp(feel.accel, FEEL_MIN, FEEL_MAX),
    lowGearPunch: clamp(feel.lowGearPunch, FEEL_MIN, FEEL_MAX),
    topSpeed: clamp(feel.topSpeed, FEEL_MIN, FEEL_MAX),
    looseness: clamp(feel.looseness, FEEL_MIN, FEEL_MAX),
    pivot: clamp(feel.pivot, FEEL_MIN, FEEL_MAX),
    pivotEase: clamp(feel.pivotEase, FEEL_MIN, FEEL_MAX),
    flick: clamp(feel.flick, FEEL_MIN, FEEL_MAX),
  };

  // Grip: scales the friction circle. Above ~1.8 the body-roll assist and ramp
  // landings blow their limits (measured, see vehicle-tuning.ts), so the roll
  // assist gain is cut as grip rises.
  const gripF = anchored(f.grip, 0.6, 1, 1.12);
  target.wheels.frictionSlip = base.wheels.frictionSlip * gripF;
  target.assists.bodyRollGain = base.assists.bodyRollGain * (gripF > 1 ? gripF ** -3 : 1);

  target.drive.highSpeedSteerFraction =
    base.drive.highSpeedSteerFraction * anchored(f.steerAtSpeed, 0.4, 1, 2.2);
  target.drive.steerRampPerSec = base.drive.steerRampPerSec * lerp(0.4, 1.6, f.turnIn / 10);

  target.drive.engineForcePerRearWheel =
    base.drive.engineForcePerRearWheel * lerp(0.5, 1.5, f.accel / 10);
  target.drive.lowGearPunch = base.drive.lowGearPunch * lerp(0, 2, f.lowGearPunch / 10);
  target.drive.topSpeedMs = base.drive.topSpeedMs * lerp(0.6, 1.4, f.topSpeed / 10);

  target.drive.powerOversteerGain = base.drive.powerOversteerGain * lerp(0, 2, f.looseness / 10);
  target.wheels.rearSideFriction =
    base.wheels.rearSideFriction * anchored(f.looseness, 1.07, 1, 0.8);

  target.drive.pivotTurn = lerp(0, 1, f.pivot / 10);
  target.drive.pivotEngageSec = base.drive.pivotEngageSec * anchored(f.pivotEase, 0.2, 1, 1.8);
  target.drive.flickGain = lerp(0, 1, f.flick / 10);

  clampTuning(target);
}

/** Serialise for persistence under `FEEL_STORAGE_KEY`. */
export function serializeFeel(feel: FeelSettings): string {
  return JSON.stringify(feel);
}

/**
 * Parse an untrusted `localStorage` string into a complete, in-range
 * `FeelSettings`. Never throws; unknown keys are dropped and any missing or
 * non-finite value falls back to its default. Returns null only for input
 * that is not a plain JSON object.
 */
export function parseSavedFeel(raw: string | null): FeelSettings | null {
  if (raw === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
  const src = parsed as Record<string, unknown>;
  const out: FeelSettings = { ...FEEL_DEFAULTS };
  for (const { key } of FEEL_CONTROLS) {
    const v = Object.hasOwn(src, key) ? src[key] : undefined;
    if (typeof v === "number" && Number.isFinite(v)) {
      out[key] = clamp(v, FEEL_MIN, FEEL_MAX);
    }
  }
  return out;
}

/** True when the page URL asks for the feel panel. Presence only, value never read. */
export function parseFeelFlag(search: string): boolean {
  return new URLSearchParams(search).has("feel");
}
