/**
 * The small "feel" panel (`?feel`): a few sliders that drive the full tuning
 * object through `src/core/feel.ts`, so the car can be dialled in by feel
 * without the several-hundred-slider debug panel.
 *
 * GATE-FREE like `createTuningPanel`: the caller decides whether to build it
 * (`parseFeelFlag`). Imports the lil-gui copy vendored inside the pinned
 * three, same as `tuning-panel.ts`.
 *
 * Persistence is its own `localStorage` key, read and written through
 * `parseSavedFeel` / `serializeFeel` so a hand-edited blob can never put a
 * NaN into the physics world.
 */

import GUI from "three/addons/libs/lil-gui.module.min.js";
import {
  FEEL_CONTROLS,
  FEEL_DEFAULTS,
  FEEL_MAX,
  FEEL_MIN,
  FEEL_STORAGE_KEY,
  type FeelSettings,
  parseSavedFeel,
  serializeFeel,
} from "../core/feel";

/** The live settings, read from storage (or defaults) before the panel exists. */
export function loadFeel(): FeelSettings {
  try {
    if (typeof localStorage !== "undefined") {
      return parseSavedFeel(localStorage.getItem(FEEL_STORAGE_KEY)) ?? { ...FEEL_DEFAULTS };
    }
  } catch {
    // Storage blocked (private window, etc.): fall through to defaults.
  }
  return { ...FEEL_DEFAULTS };
}

function saveFeel(feel: FeelSettings): void {
  try {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(FEEL_STORAGE_KEY, serializeFeel(feel));
    }
  } catch {
    // Quota/blocked storage must never break driving.
  }
}

export interface FeelPanel {
  destroy(): void;
}

/**
 * Build the panel over `feel`, mutating it in place. `onChange` runs after
 * every slider move (and Reset) - the caller re-derives the tuning from it.
 */
export function createFeelPanel(feel: FeelSettings, onChange: () => void): FeelPanel {
  const gui = new GUI({ title: "Feel [DEV]", width: 300 });

  for (const { key, label } of FEEL_CONTROLS) {
    gui
      .add(feel, key, FEEL_MIN, FEEL_MAX, 0.1)
      .name(label)
      .onChange(() => {
        saveFeel(feel);
        onChange();
      });
  }

  const actions = {
    reset: () => {
      Object.assign(feel, FEEL_DEFAULTS);
      for (const c of gui.controllersRecursive()) c.updateDisplay();
      saveFeel(feel);
      onChange();
    },
    copy: () => {
      const text = serializeFeel(feel);
      try {
        void navigator.clipboard.writeText(text);
      } catch {
        // No clipboard permission: the values stay visible in the sliders.
      }
    },
  };
  gui.add(actions, "reset").name("Reset to base");
  gui.add(actions, "copy").name("Copy settings (JSON)");

  return { destroy: () => gui.destroy() };
}
