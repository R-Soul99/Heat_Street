/**
 * CAM-03: the camera is contextually skinned per mode (police/news chopper
 * for chase modes, sports-broadcast chopper for race modes), "changing
 * presentation only — never distance, damping or targeting". The mechanism
 * is a CSS class swap on the canvas element plus a DOM chrome label, and
 * NOTHING else: this module holds no reference to a camera, a rig,
 * distance, damping or targeting at all, which is what makes the
 * "presentation only" requirement structural rather than a promise kept by
 * review. `tests/camera-skin.test.ts` proves this mechanically at the
 * SOURCE level (no non-comment line references any camera-rig-shaped
 * identifier), not by inspection.
 *
 * A second Three.js post-processing pass was deliberately rejected for this
 * (03-RESEARCH.md "Anti-Patterns to Avoid"): it would break the
 * single-draw-call-per-frame assumption `src/render/renderer.ts` documents,
 * which the profiler HUD's `renderer.info` read depends on. CSS achieves
 * the identical "presentation only" requirement more cheaply.
 *
 * 03-RESEARCH.md Pitfall 4, recorded here because it is invisible from
 * inside this module: a CSS `filter` is a browser-COMPOSITOR operation, not
 * something `renderer.info`/the in-game profiler HUD can see at all — the
 * skins' real frame-time cost must be spot-checked in the browser's own
 * performance panel during plan 03-11's playtest, never trusted to the
 * in-game HUD's numbers.
 *
 * Layering: `src/render/` may import `three`, but this file deliberately
 * does not — swapping a CSS class and a text label needs no scene-graph or
 * renderer access at all.
 */

export const CAMERA_SKINS = ["police", "sports"] as const;
export type CameraSkin = (typeof CAMERA_SKINS)[number];

/**
 * The minimal structural subset of `DOMTokenList` this module needs, so
 * `tests/camera-skin.test.ts` can supply a hand-built fake with no jsdom —
 * mirroring `tests/debug-gate.test.ts`'s Node-safe fake style.
 */
export interface SkinClassList {
  add(token: string): void;
  remove(token: string): void;
}

/**
 * Removes every `skin-*` token, then adds the one for `skin` —
 * remove-all-then-add, never a toggle, so repeated calls can never leave
 * two skin classes on the element at once.
 */
export function applySkinClasses(skin: CameraSkin, classList: SkinClassList): void {
  for (const each of CAMERA_SKINS) {
    classList.remove(`skin-${each}`);
  }
  classList.add(`skin-${skin}`);
}

/**
 * The chrome overlay's label text per skin. `textContent` only — the
 * HTML-fragment DOM write this file's own acceptance grep bans outright is
 * never used here, exactly like `tests/layering.test.ts`'s repo-wide zero
 * count for it. These strings are module constants, never user- or
 * storage-derived (T-03-13).
 */
const CHROME_LABEL: { readonly [K in CameraSkin]: string } = {
  police: "● LIVE",
  sports: "◆ BROADCAST",
};

export interface CameraSkinSwitcher {
  current(): CameraSkin;
  set(skin: CameraSkin): void;
  /** Advances through CAMERA_SKINS with wraparound and returns the new skin. */
  cycle(): CameraSkin;
  /** Removes both skin classes and blanks the chrome label. */
  dispose(): void;
}

/**
 * Builds a `CameraSkinSwitcher` bound to `canvasClassList` and `chrome`.
 * Takes both as PARAMETERS rather than reaching for `document` itself —
 * this is the entire reason the module is Node-testable with zero jsdom.
 */
export function createCameraSkin(
  canvasClassList: SkinClassList,
  chrome: { textContent: string | null },
  initial: CameraSkin = CAMERA_SKINS[0],
): CameraSkinSwitcher {
  let current: CameraSkin = initial;

  function apply(next: CameraSkin): void {
    current = next;
    applySkinClasses(current, canvasClassList);
    chrome.textContent = CHROME_LABEL[current];
  }

  apply(initial);

  return {
    current(): CameraSkin {
      return current;
    },
    set(skin: CameraSkin): void {
      apply(skin);
    },
    cycle(): CameraSkin {
      const index = CAMERA_SKINS.indexOf(current);
      const next = CAMERA_SKINS[(index + 1) % CAMERA_SKINS.length];
      apply(next);
      return next;
    },
    dispose(): void {
      for (const each of CAMERA_SKINS) {
        canvasClassList.remove(`skin-${each}`);
      }
      chrome.textContent = null;
    },
  };
}

/**
 * Builds the chrome overlay element and appends it to `document.body`,
 * matching `createSpeedometer`'s own append-to-body convention
 * (`src/hud/speedometer.ts`). Kept as a SEPARATE export from
 * `createCameraSkin` so the Node test suite above can exercise every bit of
 * switching logic without ever touching a real DOM. Plan 03-06 calls both
 * at the composition root.
 */
export function createCameraSkinChrome(): HTMLElement {
  const chrome = document.createElement("div");
  chrome.id = "camera-chrome";
  document.body.appendChild(chrome);
  return chrome;
}
