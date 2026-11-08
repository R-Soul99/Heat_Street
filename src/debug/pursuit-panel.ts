/**
 * Live sliders for the pursuit AI and the bust meter (issue #9), on the debug
 * panel (`?debug`). Gate-free like the other panels: the composition root decides
 * whether to build it.
 *
 * The values are SESSION-ONLY on purpose. Saving them to localStorage would let a
 * stale slider position hide a newer code default (the same trap the vehicle
 * tuning panel has). Instead "Copy settings (JSON)" puts the current values on the
 * clipboard so good ones can be baked into `defaultPursuerParams` / `DEFAULT_BUST_PARAMS`.
 *
 * The panel mutates the very objects the drivers and `stepBustMeter` read, so a
 * slider takes effect on the next tick. Imports the lil-gui copy vendored inside
 * the pinned three, same as `tuning-panel.ts`.
 */
import GUI from "three/addons/libs/lil-gui.module.min.js";
import type { BustParams } from "../core/bust-meter";
import type { PursuerParams } from "../core/pursuer-driver";

type Row = readonly [key: string, label: string, min: number, max: number, step: number];

type Mutable<T> = { -readonly [K in keyof T]: T[K] };

const BUST_ROWS: readonly Row[] = [
  ["radiusM", "Bust radius (m)", 3, 40, 0.5],
  ["freeSpeedMs", "Free speed (m/s)", 0, 30, 0.5],
  ["fillPerSec", "Fill per sec", 0.02, 2, 0.01],
  ["drainPerSec", "Drain per sec", 0, 2, 0.01],
  ["softCap", "Lone-car cap", 0, 1, 0.01],
  ["escapeRadiusM", "Escape radius (m)", 20, 400, 5],
  ["escapeSec", "Escape time (s)", 1, 30, 0.5],
];

const CHASE_ROWS: readonly Row[] = [
  ["speedEdge", "Speed edge (x)", 1, 1.4, 0.01],
  ["maxSpeedMs", "Speed cap (m/s)", 20, 80, 1],
  ["blockerMaxSpeedMs", "Blocker/all cap (m/s)", 20, 80, 1],
  ["leadMaxSec", "Aim lead (s)", 0, 3, 0.05],
  ["closeGain", "Close gain", 0.1, 3, 0.05],
  ["turnSpeedMs", "Turn-round speed (m/s)", 5, 40, 1],
];

const CATCHUP_ROWS: readonly Row[] = [
  ["catchupEdge", "Catch-up edge (+x)", 0, 0.6, 0.01],
  ["catchupStartM", "Starts at (m)", 0, 100, 1],
  ["catchupFullM", "Full at (m)", 20, 300, 5],
  ["catchupOverspeedMs", "Overspeed (m/s)", 0, 30, 0.5],
];

const BLOCKER_ROWS: readonly Row[] = [
  ["blockHoldM", "Hold distance (m)", 2, 25, 0.5],
  ["blockSpeedFraction", "Speed in lane (x player)", 0.1, 1.2, 0.01],
  ["ramLaneM", "Ram width (m)", 2, 20, 0.5],
  ["slideMinAlongM", "Slide min ahead (m, big = off)", 0, 400, 1],
  ["slideMaxAlongM", "Slide max ahead (m)", 5, 60, 1],
  ["slideLaneM", "Slide lane (m)", 1, 12, 0.5],
];

const RAMMER_ROWS: readonly Row[] = [
  ["tailRamOverspeedMs", "Run-in overspeed (m/s)", 0, 20, 0.5],
  ["tailFallbackAimM", "Fall-back aim (m)", 4, 30, 0.5],
  ["tailRegainM", "Run in from (m)", 4, 30, 0.5],
  ["tailLiftTicks", "Min fall-back (ticks)", 0, 120, 1],
  ["tailLiftSlowdownMs", "Fall-back slowdown (m/s)", 0, 30, 0.5],
  ["tailSideOnRad", "Side-on angle (rad)", 0.2, 1.5, 0.05],
  ["hitDistM", "Hit distance (m)", 3, 9, 0.1],
];

const PITTER_ROWS: readonly Row[] = [
  ["pitOverspeedMs", "Close-in overspeed (m/s)", 0, 15, 0.5],
  ["pitQuarterBackM", "Contact back (m)", 0, 5, 0.1],
  ["pitQuarterOutM", "Contact out (m)", 0, 3, 0.05],
  ["pitApproachBackM", "Wait back (m)", 2, 20, 0.5],
  ["pitApproachOutM", "Wait out (m)", 0.5, 10, 0.25],
  ["pitBackoffTicks", "Back-off (ticks)", 0, 240, 5],
];

const BLOKE_ROWS: readonly Row[] = [
  ["blokeSpeedEdge", "Extra speed (x)", 1, 1.4, 0.01],
  ["blokeLeadSec", "Aim lead (s)", 0, 2, 0.05],
];

export interface PursuitPanel {
  destroy(): void;
}

/**
 * `chase` and `bust` are mutated in place. `defaults` are the values Reset restores.
 */
export function createPursuitPanel(
  chase: Mutable<PursuerParams>,
  bust: Mutable<BustParams>,
  defaults: { readonly chase: PursuerParams; readonly bust: BustParams },
): PursuitPanel {
  const gui = new GUI({ title: "Pursuit [DEV]", width: 320 });
  const chaseRec = chase as unknown as Record<string, number>;
  const bustRec = bust as unknown as Record<string, number>;

  const folder = (
    name: string,
    target: Record<string, number>,
    rows: readonly Row[],
    open = false,
  ) => {
    const f = gui.addFolder(name);
    for (const [key, label, min, max, step] of rows) f.add(target, key, min, max, step).name(label);
    if (!open) f.close();
    return f;
  };

  const bustFolder = folder("Bust meter", bustRec, BUST_ROWS, true);
  // boxedAngleRad is stored in radians; the slider is in degrees.
  const boxed = {
    get deg() {
      return (bust.boxedAngleRad * 180) / Math.PI;
    },
    set deg(v: number) {
      bust.boxedAngleRad = (v * Math.PI) / 180;
    },
  };
  bustFolder.add(boxed, "deg", 20, 180, 1).name("Boxed-in angle (deg)");
  folder("Chase (all cars)", chaseRec, CHASE_ROWS);
  folder("Catch-up", chaseRec, CATCHUP_ROWS);
  folder("Blockers (white)", chaseRec, BLOCKER_ROWS);
  folder("Rammer (red)", chaseRec, RAMMER_ROWS);
  folder("Pitters (navy)", chaseRec, PITTER_ROWS);
  folder("That bloke (green)", chaseRec, BLOKE_ROWS);

  const actions = {
    reset: () => {
      Object.assign(chase, defaults.chase);
      Object.assign(bust, defaults.bust);
      for (const c of gui.controllersRecursive()) c.updateDisplay();
    },
    copy: () => {
      const text = JSON.stringify({ chase, bust }, null, 2);
      try {
        void navigator.clipboard.writeText(text);
      } catch {
        // No clipboard permission: the values stay visible in the sliders.
      }
    },
  };
  gui.add(actions, "reset").name("Reset to code defaults");
  gui.add(actions, "copy").name("Copy settings (JSON)");

  return { destroy: () => gui.destroy() };
}
