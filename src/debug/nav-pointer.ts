/**
 * TEMPORARY DEBUG TOOL, added mid-session during the 04.1-10 D-06 human
 * sign-off drive to let the operator navigate to a reported/authored map
 * coordinate (e.g. a crest centre from `src/core/crest-geometry.ts`, or a
 * spot from a bug screenshot's `pos` readout) without hunting for it by eye.
 * Follows the same `?debug`-only, gate-free-factory convention as every
 * other file in this directory (`createHud`, `createTelemetryHud`,
 * `createFreeLookCamera`): `src/main.ts` is the only place that constructs
 * it and owns the `DEBUG_ENABLED` gate and the `KeyN` toggle.
 *
 * The two halves are kept deliberately separate, mirroring
 * `profiler-hud.ts`/`telemetry-hud.ts`: `computeNavigation` is pure and
 * Node-testable (see `tests/nav-pointer.test.ts`), `createNavPointer` is the
 * DOM half that only a browser checkpoint can exercise.
 *
 * Layering: `src/debug/**` may import anything but must never affect
 * simulation timing — this file only reads plain numbers the caller
 * computed and writes its own DOM overlay.
 */

/**
 * Bearing to `(targetX, targetZ)` RELATIVE to the car's current forward
 * direction, plus straight-line distance. All positions/directions are the
 * local ENU metres used throughout the map compiler and `src/core/crest-
 * geometry.ts`.
 *
 * `relativeBearingDeg` is signed and centred on "straight ahead": `0` means
 * the target is directly ahead, positive means turn RIGHT (clockwise) to
 * face it, negative means turn LEFT, and `+-180` means it's directly behind.
 * This is the convention a CSS `rotate()` on an upward-pointing arrow can
 * use directly with no sign flip — `createNavPointer` below relies on that.
 */
export function computeNavigation(
  carX: number,
  carZ: number,
  forwardX: number,
  forwardZ: number,
  targetX: number,
  targetZ: number,
): { distanceM: number; relativeBearingDeg: number } {
  const dx = targetX - carX;
  const dz = targetZ - carZ;
  const distanceM = Math.hypot(dx, dz);

  const targetAngleRad = Math.atan2(dx, dz);
  const forwardAngleRad = Math.atan2(forwardX, forwardZ);
  // `atan2(sin, cos)` normalises into (-pi, pi] — the standard trick for
  // wrapping an angle DIFFERENCE without a branchy modulo.
  const relRad = Math.atan2(
    Math.sin(forwardAngleRad - targetAngleRad),
    Math.cos(forwardAngleRad - targetAngleRad),
  );

  return { distanceM, relativeBearingDeg: (relRad * 180) / Math.PI };
}

/** The nav-pointer tool's public surface. */
export interface NavPointer {
  /** Show/hide the panel. Wired to `onDebugKey("KeyN", …)` at the composition root. */
  toggle(): void;
  /**
   * Feed the car's current position and forward direction in. Safe to call
   * every render frame — cheap (one DOM text/style write), no accumulation
   * or throttling needed unlike the profiler HUD's larger table.
   * A no-op while no target is set.
   */
  update(carX: number, carZ: number, forwardX: number, forwardZ: number): void;
  /** Remove the overlay element from the DOM. */
  dispose(): void;
}

/**
 * Build the DOM overlay: two coordinate inputs, a "Set"/"Clear" pair, and a
 * rotating arrow + distance readout once a target is set. Bottom-left,
 * clear of the profiler HUD (top-left) and the tuning/telemetry panels
 * (top-right) — see each of those files' own position comments.
 */
export function createNavPointer(): NavPointer {
  const el = document.createElement("div");
  el.style.cssText =
    "position:fixed;bottom:16px;left:16px;z-index:11;pointer-events:auto;" +
    "font:11px/1.45 ui-monospace,monospace;color:#e8e8e8;background:rgba(0,0,0,.62);" +
    "padding:6px 9px;border-radius:4px;display:none;min-width:220px";
  document.body.appendChild(el);

  const titleEl = document.createElement("div");
  titleEl.style.cssText = "font:600 20px/1.2 ui-monospace,monospace;margin-bottom:4px";
  titleEl.textContent = "Nav";
  el.appendChild(titleEl);

  const formEl = document.createElement("div");
  formEl.style.cssText = "display:flex;gap:4px;margin-bottom:6px";
  const inputStyle =
    "width:64px;font:11px/1.45 ui-monospace,monospace;padding:3px 4px;" +
    "background:#1c1c1e;color:#e8e8e8;border:1px solid #6E6E73;border-radius:3px";

  const xInput = document.createElement("input");
  xInput.type = "number";
  xInput.placeholder = "x";
  xInput.style.cssText = inputStyle;

  const zInput = document.createElement("input");
  zInput.type = "number";
  zInput.placeholder = "z";
  zInput.style.cssText = inputStyle;

  const setButton = document.createElement("button");
  setButton.textContent = "Set";
  setButton.style.cssText =
    "font:11px/1.45 ui-monospace,monospace;padding:3px 8px;cursor:pointer;" +
    "background:#2A2A2E;color:#e8e8e8;border:1px solid #6E6E73;border-radius:4px";

  const clearButton = document.createElement("button");
  clearButton.textContent = "Clear";
  clearButton.style.cssText = setButton.style.cssText;

  formEl.append(xInput, zInput, setButton, clearButton);
  el.appendChild(formEl);

  const resultEl = document.createElement("div");
  resultEl.style.cssText = "display:flex;align-items:center;gap:8px";
  el.appendChild(resultEl);

  const arrowEl = document.createElement("div");
  arrowEl.textContent = "▲";
  arrowEl.style.cssText = "font-size:22px;line-height:1;transition:transform 80ms linear";
  resultEl.appendChild(arrowEl);

  const readoutEl = document.createElement("div");
  readoutEl.textContent = "No target set";
  resultEl.appendChild(readoutEl);

  let target: { x: number; z: number } | null = null;

  function setTarget(): void {
    const x = Number.parseFloat(xInput.value);
    const z = Number.parseFloat(zInput.value);
    if (!Number.isFinite(x) || !Number.isFinite(z)) return;
    target = { x, z };
    arrowEl.style.display = "";
  }

  function clearTarget(): void {
    target = null;
    arrowEl.style.display = "none";
    readoutEl.textContent = "No target set";
  }

  setButton.addEventListener("click", setTarget);
  clearButton.addEventListener("click", clearTarget);
  arrowEl.style.display = "none";

  return {
    toggle(): void {
      el.style.display = el.style.display === "none" ? "block" : "none";
    },

    update(carX: number, carZ: number, forwardX: number, forwardZ: number): void {
      if (!target) return;
      const { distanceM, relativeBearingDeg } = computeNavigation(
        carX,
        carZ,
        forwardX,
        forwardZ,
        target.x,
        target.z,
      );
      arrowEl.style.transform = `rotate(${relativeBearingDeg.toFixed(1)}deg)`;
      readoutEl.textContent = `${distanceM.toFixed(0)}m  (${target.x.toFixed(1)}, ${target.z.toFixed(1)})`;
    },

    dispose(): void {
      el.remove();
    },
  };
}
