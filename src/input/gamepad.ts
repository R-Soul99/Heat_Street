/**
 * Injectable gamepad snapshot reader. Polls `navigator.getGamepads()` once per
 * call — never on a self-scheduled timer, since `tests/layering.test.ts`
 * bans `performance.now(`/`Date.now(` outside `src/loop.ts` and `src/debug/**`,
 * which makes a self-scheduled polling timer inexpressible here. The fixed
 * tick (via `LiveInputSource.advance`) is what drives every read.
 *
 * Layering: touches `document`/`navigator`; may import `src/core/`; never writes
 * simulation state; all smoothing advances by `DT` per fixed tick, never per frame.
 */

/** One tick's raw gamepad axis/button snapshot, already deadzoned and clamped. */
export interface PadSnapshot {
  steer: number;
  throttle: number;
  brake: number;
  handbrake: boolean;
}

/** Below this absolute stick deflection, steer reads as exactly 0. */
const STEER_DEADZONE = 0.12;
/** Below this trigger depression, the trigger reads as exactly 0. */
const TRIGGER_DEADZONE = 0.06;

/**
 * Rescales `raw` so the deadzone has no step discontinuity at its edge: the
 * output is 0 inside the deadzone and still reaches +/-1 (or 1, for a
 * one-sided trigger) at full deflection outside it.
 */
function applyDeadzone(raw: number, deadzone: number): number {
  const value = Number.isFinite(raw) ? raw : 0;
  const magnitude = Math.abs(value);
  if (magnitude <= deadzone) return 0;
  const sign = Math.sign(value);
  const rescaled = (magnitude - deadzone) / (1 - deadzone);
  return sign * rescaled;
}

function clamp(value: number, lo: number, hi: number): number {
  const v = Number.isFinite(value) ? value : 0;
  return v < lo ? lo : v > hi ? hi : v;
}

/**
 * Returns the first connected pad's snapshot, or `null` when no pad is
 * available. Every read is defensive: a missing axis/button index or a
 * non-finite value yields 0/false rather than throwing.
 *
 * Mapping is the "standard" Gamepad API layout: `steer = axes[0]`,
 * `throttle = buttons[7].value` (right trigger), `brake = buttons[6].value`
 * (left trigger), `handbrake = buttons[0].pressed` (A/cross — D-02 allows a
 * face button or bumper). 02-RESEARCH.md Assumption A1 marks these indices
 * `[ASSUMED]` / LOW confidence — verified only by the SC2 human playtest in
 * plan 02-10. A wrong index here is a one-line fix at this comment.
 */
export function readGamepad(): PadSnapshot | null {
  if (typeof navigator === "undefined") return null;
  if (typeof navigator.getGamepads !== "function") return null;

  const pads = navigator.getGamepads();
  let pad: Gamepad | null = null;
  for (let i = 0; i < pads.length; i++) {
    if (pads[i]) {
      pad = pads[i];
      break;
    }
  }
  if (pad === null) return null;

  const rawSteer = pad.axes?.[0] ?? 0;
  const rawThrottle = pad.buttons?.[7]?.value ?? 0;
  const rawBrake = pad.buttons?.[6]?.value ?? 0;
  const rawHandbrake = pad.buttons?.[0]?.pressed ?? false;

  return {
    steer: clamp(applyDeadzone(rawSteer, STEER_DEADZONE), -1, 1),
    throttle: clamp(applyDeadzone(rawThrottle, TRIGGER_DEADZONE), 0, 1),
    brake: clamp(applyDeadzone(rawBrake, TRIGGER_DEADZONE), 0, 1),
    handbrake: rawHandbrake === true,
  };
}
