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

/** The live gauge's public surface. No `toggle()` — the speedometer is always visible. */
export interface Speedometer {
  /**
   * Called once per rAF. `groundSpeedMs` is `Math.hypot(linvel.x, linvel.z)`;
   * `dtMs` comes from the render loop.
   */
  update(groundSpeedMs: number, dtMs: number): void;
  /** Remove the gauge's SVG root from the DOM. */
  dispose(): void;
}

const SVG_NS = "http://www.w3.org/2000/svg";

/** cx/cy of the dial, in the 200x200 viewBox's own coordinate space. */
const CENTER = 100;

/** Major ticks / numerals at every 20 mph from 0 to 160. */
const MAJOR_STEP_MPH = 20;

/** Minor ticks at every 5 mph, skipping majors. */
const MINOR_STEP_MPH = 5;

/** mph values whose numeral is inside the redline band and rendered in amber. */
const AMBER_NUMERALS = new Set([120, 140, 160]);

/** Point on a circle of radius `r` centred at (CENTER, CENTER) for a given needle-space angle. */
function pointOnCircle(r: number, angleDeg: number): { x: number; y: number } {
  // The needle is authored pointing straight up (toward -y) and rotated by
  // `needleAngleDeg`, so 0 degrees here means straight up, matching the
  // `rotate(angle 100 100)` convention used for the needle itself.
  const rad = ((angleDeg - 90) * Math.PI) / 180;
  return { x: CENTER + r * Math.cos(rad), y: CENTER + r * Math.sin(rad) };
}

/**
 * Create the SVG speedometer and append it to `document.body`.
 *
 * GATE-FREE: unlike `src/debug/tuning-panel.ts` and
 * `src/debug/telemetry-hud.ts`, this factory does not check `DEBUG_ENABLED`.
 * The speedometer is player-facing and always on (NAV-01) — mirroring
 * `createHud`'s own "this module never checks `DEBUG_ENABLED` itself so it
 * stays independently testable" comment, restated here for the player-facing
 * reason rather than the dev-tool one.
 */
export function createSpeedometer(): Speedometer {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 200 200");
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", "Speedometer");
  // `font-variant-numeric:tabular-nums` is non-negotiable: the readout
  // changes up to 60x/sec and proportional digits make the number visibly
  // shimmer as `1` swaps for `8`. Tabular figures pin the glyph width.
  svg.style.cssText =
    "position:fixed;right:16px;bottom:16px;width:200px;height:200px;" +
    "z-index:5;pointer-events:none;" +
    'font-family:"Arial Narrow","Helvetica Neue",Helvetica,Arial,sans-serif;' +
    "font-stretch:condensed;font-variant-numeric:tabular-nums";

  // Dial face.
  const face = document.createElementNS(SVG_NS, "circle");
  face.setAttribute("cx", String(CENTER));
  face.setAttribute("cy", String(CENTER));
  face.setAttribute("r", "92");
  face.setAttribute("fill", "#0B0B0C");
  svg.appendChild(face);

  // Bezel ring.
  const bezel = document.createElementNS(SVG_NS, "circle");
  bezel.setAttribute("cx", String(CENTER));
  bezel.setAttribute("cy", String(CENTER));
  bezel.setAttribute("r", "94");
  bezel.setAttribute("stroke", "#2A2A2E");
  bezel.setAttribute("stroke-width", "4");
  bezel.setAttribute("fill", "none");
  svg.appendChild(bezel);

  // Redline arc, 120 -> 160 mph at r 84. Endpoints are computed from
  // `needleAngleDeg` rather than a hardcoded `d` string, so the band can
  // never drift from the needle mapping if the sweep constants ever change.
  const redlineStart = pointOnCircle(84, needleAngleDeg(REDLINE_MPH));
  const redlineEnd = pointOnCircle(84, needleAngleDeg(MAX_MPH));
  const redline = document.createElementNS(SVG_NS, "path");
  redline.setAttribute(
    "d",
    `M ${redlineStart.x} ${redlineStart.y} A 84 84 0 0 1 ${redlineEnd.x} ${redlineEnd.y}`,
  );
  redline.setAttribute("stroke", "#E8A33D");
  redline.setAttribute("stroke-width", "6");
  redline.style.strokeLinecap = "butt";
  redline.setAttribute("fill", "none");
  svg.appendChild(redline);

  // Ticks and numerals, 0..160 by MINOR_STEP_MPH, majors every MAJOR_STEP_MPH.
  for (let mph = 0; mph <= MAX_MPH; mph += MINOR_STEP_MPH) {
    const isMajor = mph % MAJOR_STEP_MPH === 0;
    const angle = needleAngleDeg(mph);
    const outer = pointOnCircle(92, angle);
    const tick = document.createElementNS(SVG_NS, "line");
    tick.setAttribute("x1", String(outer.x));
    tick.setAttribute("y1", String(outer.y));
    if (isMajor) {
      const inner = pointOnCircle(78, angle);
      tick.setAttribute("x2", String(inner.x));
      tick.setAttribute("y2", String(inner.y));
      tick.setAttribute("stroke", "#F2EFE6");
      tick.setAttribute("stroke-width", "3");
    } else {
      const inner = pointOnCircle(85, angle);
      tick.setAttribute("x2", String(inner.x));
      tick.setAttribute("y2", String(inner.y));
      tick.setAttribute("stroke", "#6E6E73");
      tick.setAttribute("stroke-width", "1.5");
    }
    svg.appendChild(tick);

    if (isMajor) {
      const numeralPos = pointOnCircle(62, angle);
      const numeral = document.createElementNS(SVG_NS, "text");
      numeral.setAttribute("x", String(numeralPos.x));
      numeral.setAttribute("y", String(numeralPos.y));
      numeral.style.fontSize = "14px";
      numeral.style.fontWeight = "600";
      numeral.style.textAnchor = "middle";
      numeral.style.dominantBaseline = "central";
      numeral.setAttribute("fill", AMBER_NUMERALS.has(mph) ? "#E8A33D" : "#F2EFE6");
      numeral.textContent = String(mph);
      svg.appendChild(numeral);
    }
  }

  // Readout window.
  const readoutWindow = document.createElementNS(SVG_NS, "rect");
  readoutWindow.setAttribute("x", "69");
  readoutWindow.setAttribute("y", "124");
  readoutWindow.setAttribute("width", "62");
  readoutWindow.setAttribute("height", "32");
  readoutWindow.setAttribute("rx", "3");
  readoutWindow.setAttribute("fill", "#16161A");
  readoutWindow.setAttribute("stroke", "#2A2A2E");
  readoutWindow.setAttribute("stroke-width", "1");
  svg.appendChild(readoutWindow);

  // Digital readout digits.
  const digits = document.createElementNS(SVG_NS, "text");
  digits.setAttribute("x", String(CENTER));
  digits.setAttribute("y", "140");
  digits.style.fontSize = "28px";
  digits.style.fontWeight = "600";
  digits.style.textAnchor = "middle";
  digits.style.dominantBaseline = "central";
  digits.setAttribute("fill", "#F2EFE6");
  digits.textContent = "0";
  svg.appendChild(digits);

  // MPH unit label.
  const mphLabel = document.createElementNS(SVG_NS, "text");
  mphLabel.setAttribute("x", String(CENTER));
  mphLabel.setAttribute("y", "168");
  mphLabel.style.fontSize = "11px";
  mphLabel.style.fontWeight = "600";
  mphLabel.style.letterSpacing = "1px";
  mphLabel.style.textAnchor = "middle";
  mphLabel.setAttribute("fill", "#9A9AA0");
  mphLabel.textContent = "MPH";
  svg.appendChild(mphLabel);

  // Needle casing + needle, authored pointing straight up (100,112)->(100,26)
  // and rotated together each frame. The dark casing beneath the red needle
  // is a mandatory legibility mitigation, not decoration: red-on-amber
  // contrast is poor at 120+ mph where the needle overlaps the redline band,
  // and the dark casing is what separates the needle from the band beneath
  // it (02-UI-SPEC.md Color section).
  const needleCasing = document.createElementNS(SVG_NS, "line");
  needleCasing.setAttribute("x1", "100");
  needleCasing.setAttribute("y1", "112");
  needleCasing.setAttribute("x2", "100");
  needleCasing.setAttribute("y2", "26");
  needleCasing.setAttribute("stroke", "#0B0B0C");
  needleCasing.setAttribute("stroke-width", "7");
  needleCasing.style.strokeLinecap = "round";
  svg.appendChild(needleCasing);

  const needle = document.createElementNS(SVG_NS, "line");
  needle.setAttribute("x1", "100");
  needle.setAttribute("y1", "112");
  needle.setAttribute("x2", "100");
  needle.setAttribute("y2", "26");
  needle.setAttribute("stroke", "#C8402F");
  needle.setAttribute("stroke-width", "4");
  needle.style.strokeLinecap = "round";
  svg.appendChild(needle);

  // Needle hub.
  const hub = document.createElementNS(SVG_NS, "circle");
  hub.setAttribute("cx", String(CENTER));
  hub.setAttribute("cy", String(CENTER));
  hub.setAttribute("r", "6");
  hub.setAttribute("fill", "#2A2A2E");
  hub.setAttribute("stroke", "#F2EFE6");
  hub.setAttribute("stroke-width", "1.5");
  svg.appendChild(hub);

  document.body.appendChild(svg);

  let damped = 0;

  return {
    update(groundSpeedMs: number, dtMs: number): void {
      const mph = mphFromGroundSpeed(groundSpeedMs);
      const angle = needleAngleDeg(mph);
      const transform = `rotate(${angle} ${CENTER} ${CENTER})`;
      // Instant, unsmoothed (D-13). The needle's rotation must never be
      // animated with a CSS timing/easing property: 02-UI-SPEC.md forbids it
      // because it would reintroduce refresh-rate-dependent lag between the
      // physics and the display.
      needleCasing.setAttribute("transform", transform);
      needle.setAttribute("transform", transform);

      damped = dampStep(damped, mph, dtMs);
      // Damping is applied BEFORE rounding, so the integer cannot flicker
      // between two neighbours mid-transit.
      digits.textContent = String(Math.round(damped));
      digits.setAttribute("fill", readoutColour(damped));

      // DELIBERATELY runs on EVERY call — do not add a per-frame counter
      // that skips writes until some accumulated duration has elapsed, the
      // way `src/debug/profiler-hud.ts` throttles its own DOM write to
      // roughly 7 Hz. A needle updating 7x/sec reads as broken hardware
      // (02-UI-SPEC.md Interaction & Motion Contract). The cost is 2
      // `setAttribute` calls plus 1 `textContent` write plus 1 `fill` write
      // per frame — negligible against the 16.6ms frame budget in
      // `docs/frame-budget.md`. Without this comment the next reader will
      // "fix" it back in.
    },

    dispose(): void {
      svg.remove();
    },
  };
}
