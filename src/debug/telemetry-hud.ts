/**
 * The in-browser telemetry results panel: runs the exact same
 * `runAllRoutines` that `tests/vehicle-telemetry.test.ts` runs, against
 * whatever `VehicleTuning` object the tuning panel (plan 02-09 task 1)
 * currently holds, and prints a pass/fail row per routine. This shared code
 * path is what makes SC5's "retuned live … and re-verified … with no code
 * edit" literally true rather than aspirational.
 *
 * Layering: `src/debug/**` may import anything but must never affect
 * simulation timing — no `world.step`, no impulses, no body writes. This
 * file builds a SEPARATE throwaway Rapier world through `runRoutine` (via
 * `runAllRoutines`) on every button press and never touches the live game
 * world or the simulation clock — `runRoutine` (`src/physics/telemetry/run.ts`)
 * frees that throwaway world in a `finally` before returning.
 *
 * The two halves are kept deliberately separate, mirroring
 * `src/debug/profiler-hud.ts`: `formatTelemetryRow` / `formatTelemetrySummary`
 * are pure and Node-testable (see `tests/telemetry-hud.test.ts`),
 * `createTelemetryHud` is the DOM half that only a browser checkpoint can
 * exercise.
 */

import type { VehicleTuning } from "../core/vehicle-tuning";
import type { RoutineResult } from "../physics/telemetry/routines";
import { runAllRoutines } from "../physics/telemetry/run";

/**
 * Routine id -> 02-UI-SPEC.md's exact display label. Deliberately NOT
 * `RoutineResult.label` (e.g. `brake`'s own label is "60-0 mph braking
 * distance") — the panel's copy is a separate, shorter contract
 * (02-UI-SPEC.md "Copywriting Contract"). Keeping this as an explicit id ->
 * label table means a routine id rename shows up here as a MISSING label
 * (falls back to the raw id, which visibly does not match any of the six
 * strings this file's own test asserts) rather than silently drifting.
 */
const ROUTINE_LABELS: Readonly<Record<string, string>> = {
  accel: "0-60 mph",
  brake: "60-0 braking",
  skidpad: "Skidpad",
  slalom: "Slalom",
  ramp: "Ramp landing",
  stability: "Roll stability",
};

// Fixed column widths for the padded-string table (02-UI-SPEC.md "Layout:
// Fixed-width monospace table … via padded strings, not DOM tables"). Sized
// to the widest real value: `ROUTINE_COL` fits "Roll stability" (14 chars),
// `MEASURED_COL` fits "Infinityft" (an unreached routine's value, per
// `routines.ts`'s `Number.POSITIVE_INFINITY` failure convention), and
// `TARGET_COL` fits the longest target string, the `ramp` routine's
// "<20 deg tilt, >40 mph forward speed (0.5 s after landing)" (59 chars).
const ROUTINE_COL = 16;
const MEASURED_COL = 12;
const TARGET_COL = 60;

/**
 * One routine's result as a fixed-width monospace row: label, measured value
 * (with unit, `toFixed(2)` for byte-stability like `formatHudText`), target
 * band, and the literal word `PASS`/`FAIL`. Colour is never the sole carrier
 * of meaning (02-UI-SPEC.md Accessibility) — the word is always present, so
 * the panel is legible to a colourblind developer and to a text diff.
 */
export function formatTelemetryRow(r: RoutineResult): string {
  const label = (ROUTINE_LABELS[r.id] ?? r.id).padEnd(ROUTINE_COL);
  const measured = `${r.value.toFixed(2)}${r.unit}`.padEnd(MEASURED_COL);
  const target = r.target.padEnd(TARGET_COL);
  const verdict = r.pass ? "PASS" : "FAIL";
  return `${label}${measured}${target}${verdict}`;
}

/** `"{n} of {total} passed"` — `total` is `rs.length`, which is 6 for the
 * shipped `ROUTINES` list (`src/physics/telemetry/routines.ts`). */
export function formatTelemetrySummary(rs: readonly RoutineResult[]): string {
  const passed = rs.filter((r) => r.pass).length;
  return `${passed} of ${rs.length} passed`;
}

/** The telemetry panel's public surface. */
export interface TelemetryHud {
  /** Show/hide. Wired to onDebugKey("KeyT") at the composition root. */
  toggle(): void;
  /** Remove the overlay element from the DOM. */
  dispose(): void;
}

/**
 * Build the DOM overlay. GATE-FREE like `createHud`/`createTuningPanel` — the
 * `DEBUG_ENABLED` check lives at the composition root (plan 02-09 task 3).
 *
 * `getTuning` is a CALLBACK, not a captured `VehicleTuning` value, so a run
 * triggered after the tuning panel has mutated its object reads the LIVE
 * values rather than a stale copy taken at construction time — this is the
 * whole point of SC5.
 */
export function createTelemetryHud(getTuning: () => VehicleTuning): TelemetryHud {
  const el = document.createElement("div");
  // Surface styling is DELIBERATELY IDENTICAL to `profiler-hud.ts:84-87` —
  // same background, padding, border-radius and font — so the two dev
  // panels read as one tool family (02-UI-SPEC.md "Telemetry panel"). Only
  // `top`/`right`/`z-index` differ, plus `pointer-events`: this panel and
  // the tuning panel are the only interactive DOM in the entire phase,
  // because this one has a button.
  //
  // Position: top-right, meant to sit `24px` below the tuning panel
  // (02-UI-SPEC.md). lil-gui's own panel height varies with how many
  // folders are open, and this module holds no reference to the tuning
  // panel at all (by design — the two dev tools stay independently
  // testable), so a byte-exact "below" offset isn't derivable from here.
  // This fixed value clears the tuning panel's default (open) height with
  // comfortable margin; a real visual collision, if any, is caught by the
  // plan's own browser checkpoint (02-10).
  el.style.cssText =
    "position:fixed;top:400px;right:16px;z-index:11;pointer-events:auto;" +
    "font:11px/1.45 ui-monospace,monospace;color:#e8e8e8;background:rgba(0,0,0,.62);" +
    "padding:6px 9px;border-radius:4px;white-space:pre;display:none;min-width:280px";
  document.body.appendChild(el);

  const titleEl = document.createElement("div");
  titleEl.style.cssText = "font:600 20px/1.2 ui-monospace,monospace;margin-bottom:4px";
  titleEl.textContent = "Telemetry";
  el.appendChild(titleEl);

  // Cycles through the three copy states: "No telemetry run yet" ->
  // "Running…" -> "{n} of 6 passed" (02-UI-SPEC.md "Telemetry states").
  const stateHeadingEl = document.createElement("div");
  stateHeadingEl.style.cssText = "font:600 20px/1.2 ui-monospace,monospace;margin-bottom:4px";
  stateHeadingEl.textContent = "No telemetry run yet";
  el.appendChild(stateHeadingEl);

  const bodyTextEl = document.createElement("div");
  bodyTextEl.style.cssText = "margin-bottom:6px";
  bodyTextEl.textContent =
    "Run the suite to measure the current tuning against its targets. Takes about 300ms.";
  el.appendChild(bodyTextEl);

  const rowsEl = document.createElement("div");
  rowsEl.style.cssText = "white-space:pre;display:none;margin-bottom:6px";
  el.appendChild(rowsEl);

  const runButton = document.createElement("button");
  runButton.textContent = "Run telemetry suite";
  runButton.style.cssText =
    "font:11px/1.45 ui-monospace,monospace;padding:4px 8px;cursor:pointer;" +
    "background:#2A2A2E;color:#e8e8e8;border:1px solid #6E6E73;border-radius:4px";
  el.appendChild(runButton);

  // Opening the panel does NOT auto-run: it opens into the empty state above
  // and waits for a deliberate button press. Auto-running on a keypress
  // (`KeyT`) would stall the frame unexpectedly mid-drive — the suite costs
  // roughly 100-300ms (02-RESEARCH.md Pattern 4 measurement), which is
  // several frames at 60 fps.
  runButton.addEventListener("click", () => {
    // The suite runs synchronously (no `requestAnimationFrame`/`setTimeout`
    // boundary), so this "Running…" write and the final results write below
    // land in the same task and the browser never paints the intermediate
    // state. It is kept anyway: this is the code path a future async
    // refactor (splitting the six routines across frames) would build on,
    // and the DOM element genuinely does hold this text for the duration of
    // the (currently synchronous) run.
    stateHeadingEl.textContent = "Running…";
    stateHeadingEl.style.color = "#9A9AA0";
    bodyTextEl.style.display = "none";

    const results = runAllRoutines(getTuning());

    rowsEl.textContent = "";
    for (const r of results) {
      const rowEl = document.createElement("div");
      rowEl.textContent = formatTelemetryRow(r);
      rowEl.style.color = r.pass ? "#6FBF73" : "#C8402F";
      rowsEl.appendChild(rowEl);
    }
    rowsEl.style.display = "block";

    stateHeadingEl.style.color = "";
    stateHeadingEl.textContent = formatTelemetrySummary(results);
  });

  return {
    toggle(): void {
      el.style.display = el.style.display === "none" ? "block" : "none";
    },
    dispose(): void {
      el.remove();
    },
  };
}
