/**
 * The lil-gui vehicle tuning panel: a live slider for every numeric leaf of a
 * `VehicleTuning`, bounded by `TUNING_RANGES`, with `localStorage`
 * persistence and a two-click "Reset to defaults" (D-15, D-16, D-17).
 *
 * Imports the copy of lil-gui already vendored inside the pinned
 * `three@0.185.1` at `three/addons/libs/lil-gui.module.min.js`, typed by the
 * already-pinned `@types/three@0.185.4`. Net dependency change for this
 * plan is zero: `npm install` is not required (02-RESEARCH.md Package
 * Legitimacy Audit ran `slopcheck install lil-gui` -> `[OK]` and then decided
 * NOT to add the standalone package, because this bundled copy supersedes
 * it).
 *
 * RESOLVED CONVENTION CONFLICT — read this before "fixing" the gating back.
 * 02-RESEARCH.md line 995 and 02-UI-SPEC.md's Construction row both gate
 * `DEBUG_ENABLED` and bail out to a null return INSIDE `createTuningPanel`.
 * That inverts the shipped repo convention: `createHud`
 * (`src/debug/profiler-hud.ts`) is gate-free and `src/main.ts` is the only
 * place that decides whether to construct it at all. DECISION: follow the
 * SHIPPED convention. `createTuningPanel` is gate-free and never returns
 * `null`; the `DEBUG_ENABLED` check lives at the composition root (plan
 * 02-09 task 3). Rationale: it keeps this module independently testable and
 * reusable, matching `createHud`'s own stated reason. The ASVS V4 guarantee
 * is unchanged — a normal build still constructs zero panel and registers
 * zero listeners, because the composition root never calls this function
 * unless `DEBUG_ENABLED` is true.
 *
 * Division of responsibility for the persisted blob: this module NEVER reads
 * `TUNING_STORAGE_KEY` at construction. `src/main.ts` already restores it at
 * boot via `parseSavedTuning`, before the vehicle is built — the only point
 * at which mass and CoM can be applied without a mid-drive discontinuity.
 * This module only ever WRITES the storage key, on every change.
 *
 * Layering: `src/debug/**` may import anything but must never affect
 * simulation timing — no `world.step`, no impulses, no body writes. This
 * file only writes plain numbers into a `VehicleTuning` object which the
 * physics layer reads on the next tick.
 */

import type { KeyToValueOfType } from "three/addons/libs/lil-gui.module.min.js";
import GUI from "three/addons/libs/lil-gui.module.min.js";
import {
  defaultTuning,
  serializeTuning,
  TUNING_RANGES,
  TUNING_STORAGE_KEY,
  type TuningRange,
  type VehicleTuning,
} from "../core/vehicle-tuning";

/** How long "Click again to confirm" is shown before reverting to the base label. */
const RESET_CONFIRM_MS = 3000;

const RESET_LABEL = "Reset to defaults";
const RESET_CONFIRM_LABEL = "Click again to confirm";

/** Minimal storage shape the panel needs. `localStorage`-compatible, and
 * injectable so `tests/tuning-persist.test.ts`-style hostile-input tests can
 * exercise this module without a DOM. */
export interface TuningStorage {
  get(key: string): string | null;
  set(key: string, value: string): void;
  remove(key: string): void;
}

/**
 * Lazily-constructed `localStorage` adapter. Built INSIDE `createTuningPanel`
 * only when the caller supplies no `storage` override, so importing this
 * module in Node — Vitest's `node` environment has no `localStorage` — never
 * throws. Mirrors `src/loop.ts`'s `LoopScheduler` injection shape (S5).
 */
function createLocalStorageAdapter(): TuningStorage {
  return {
    get(key: string): string | null {
      return localStorage.getItem(key);
    },
    set(key: string, value: string): void {
      localStorage.setItem(key, value);
    },
    remove(key: string): void {
      localStorage.removeItem(key);
    },
  };
}

/**
 * Bind one numeric leaf. `min`/`max`/`step` are always read from a
 * `TuningRange` — never an inline literal — so the slider bound and
 * `clampTuning`'s load-time clamp (`src/core/vehicle-tuning.ts`) can never
 * drift apart from each other.
 */
function addNumber<T, K extends KeyToValueOfType<T, number>>(
  folder: GUI,
  obj: T,
  key: K,
  range: TuningRange,
) {
  return folder.add(obj, key, range.min, range.max, range.step);
}

/**
 * Writes every field of a fresh `defaultTuning()` onto `target`'s existing
 * nested objects, walking the shape of `TUNING_RANGES`. Deliberately mutates
 * leaves IN PLACE rather than replacing `target.chassis`/`target.wheels`/etc.
 * wholesale — every lil-gui controller above holds a reference to those exact
 * nested objects (e.g. `tuning.chassis.comOffset`), and replacing the object
 * would leave the controllers pointing at stale data.
 */
function writeDefaultsOnto(
  targetNode: Record<string, unknown>,
  freshNode: Record<string, unknown>,
  rangeNode: Record<string, unknown>,
): void {
  for (const key of Object.keys(rangeNode)) {
    const rangeEntry = rangeNode[key];
    const isLeaf =
      typeof rangeEntry === "object" &&
      rangeEntry !== null &&
      typeof (rangeEntry as { min?: unknown }).min === "number" &&
      typeof (rangeEntry as { max?: unknown }).max === "number" &&
      typeof (rangeEntry as { step?: unknown }).step === "number";
    if (isLeaf) {
      targetNode[key] = freshNode[key];
    } else if (typeof rangeEntry === "object" && rangeEntry !== null) {
      writeDefaultsOnto(
        targetNode[key] as Record<string, unknown>,
        freshNode[key] as Record<string, unknown>,
        rangeEntry as Record<string, unknown>,
      );
    }
  }
}

/** The tuning panel's public surface. */
export interface TuningPanel {
  /** Show/hide. Wired to onDebugKey("KeyG") at the composition root. */
  toggle(): void;
  /** Destroy every DOM element and listener lil-gui created. */
  dispose(): void;
}

/**
 * Build the lil-gui panel over `tuning`. GATE-FREE, like `createHud` — see
 * the module doc comment above for why.
 *
 * `onApply` is called after every change that must reach the physics layer.
 * `storage` defaults, lazily, to a real `localStorage` adapter.
 */
export function createTuningPanel(
  tuning: VehicleTuning,
  onApply: () => void,
  storage?: TuningStorage,
): TuningPanel {
  const store = storage ?? createLocalStorageAdapter();

  // 320, not lil-gui's 245px default — the default truncates names like
  // "handbrakeRearSideFriction". The "[DEV]" suffix makes a stray screenshot
  // unambiguous (02-UI-SPEC.md).
  const gui = new GUI({ title: "Vehicle Tuning [DEV]", width: 320 });

  // Folder order is a CONTRACT, not a suggestion (02-UI-SPEC.md "Tuning
  // panel"): Chassis -> Suspension -> Grip -> Drive -> Assists -> Telemetry.
  // New knobs append INSIDE their existing folder; folders themselves never
  // reorder, so muscle memory survives a multi-session tuning effort.
  const chassisFolder = gui.addFolder("Chassis");
  const suspensionFolder = gui.addFolder("Suspension");
  const gripFolder = gui.addFolder("Grip");
  const driveFolder = gui.addFolder("Drive");
  const assistsFolder = gui.addFolder("Assists");
  const telemetryFolder = gui.addFolder("Telemetry");

  // ---- Chassis --------------------------------------------------------
  // `mass`, `comOffset.*` and `halfExtents.*` bind on `.onFinishChange`,
  // never `.onChange` — Pitfall 10 (02-RESEARCH.md): `setAdditionalMassProperties`
  // OVERRIDES ALL previous additional mass properties and invalidates the
  // cached principal inertia the assists scale against, so a slider DRAG
  // would produce discontinuities or a launched car. Only a drag-release (or
  // an input blur) should trigger a rebuild.
  addNumber(chassisFolder, tuning.chassis, "mass", TUNING_RANGES.chassis.mass).onFinishChange(
    onApply,
  );
  addNumber(chassisFolder, tuning.chassis.comOffset, "x", TUNING_RANGES.chassis.comOffset.x)
    .name("comOffset.x")
    .onFinishChange(onApply);
  addNumber(chassisFolder, tuning.chassis.comOffset, "y", TUNING_RANGES.chassis.comOffset.y)
    .name("comOffset.y")
    .onFinishChange(onApply);
  addNumber(chassisFolder, tuning.chassis.comOffset, "z", TUNING_RANGES.chassis.comOffset.z)
    .name("comOffset.z")
    .onFinishChange(onApply);
  addNumber(chassisFolder, tuning.chassis.halfExtents, "x", TUNING_RANGES.chassis.halfExtents.x)
    .name("halfExtents.x")
    .onFinishChange(onApply);
  addNumber(chassisFolder, tuning.chassis.halfExtents, "y", TUNING_RANGES.chassis.halfExtents.y)
    .name("halfExtents.y")
    .onFinishChange(onApply);
  addNumber(chassisFolder, tuning.chassis.halfExtents, "z", TUNING_RANGES.chassis.halfExtents.z)
    .name("halfExtents.z")
    .onFinishChange(onApply);
  // Damping is not mass-property-invalidating — safe live, like every wheel
  // property below.
  addNumber(
    chassisFolder,
    tuning.chassis,
    "linearDamping",
    TUNING_RANGES.chassis.linearDamping,
  ).onChange(onApply);
  addNumber(
    chassisFolder,
    tuning.chassis,
    "angularDamping",
    TUNING_RANGES.chassis.angularDamping,
  ).onChange(onApply);

  // ---- Suspension (wheel geometry + suspension physics) ----------------
  // Every WHEEL property below uses `.onChange(onApply)` — Rapier's
  // per-index wheel setters are genuinely per-frame safe, unlike
  // `setAdditionalMassProperties` above.
  addNumber(suspensionFolder, tuning.wheels, "halfTrack", TUNING_RANGES.wheels.halfTrack).onChange(
    onApply,
  );
  addNumber(
    suspensionFolder,
    tuning.wheels,
    "halfWheelbase",
    TUNING_RANGES.wheels.halfWheelbase,
  ).onChange(onApply);
  addNumber(
    suspensionFolder,
    tuning.wheels,
    "connectionY",
    TUNING_RANGES.wheels.connectionY,
  ).onChange(onApply);
  addNumber(suspensionFolder, tuning.wheels, "radius", TUNING_RANGES.wheels.radius).onChange(
    onApply,
  );
  addNumber(
    suspensionFolder,
    tuning.wheels,
    "suspensionRestLength",
    TUNING_RANGES.wheels.suspensionRestLength,
  ).onChange(onApply);
  addNumber(
    suspensionFolder,
    tuning.wheels,
    "maxSuspensionTravel",
    TUNING_RANGES.wheels.maxSuspensionTravel,
  ).onChange(onApply);
  addNumber(
    suspensionFolder,
    tuning.wheels,
    "suspensionStiffness",
    TUNING_RANGES.wheels.suspensionStiffness,
  ).onChange(onApply);
  addNumber(
    suspensionFolder,
    tuning.wheels,
    "suspensionCompression",
    TUNING_RANGES.wheels.suspensionCompression,
  ).onChange(onApply);
  addNumber(
    suspensionFolder,
    tuning.wheels,
    "suspensionRelaxation",
    TUNING_RANGES.wheels.suspensionRelaxation,
  ).onChange(onApply);
  addNumber(
    suspensionFolder,
    tuning.wheels,
    "maxSuspensionForce",
    TUNING_RANGES.wheels.maxSuspensionForce,
  ).onChange(onApply);

  // ---- Grip --------------------------------------------------------------
  // `frictionSlip`: [MEASURED] dead above ~10 (10.5 and 1000 read identical,
  // 3.48g vs 3.49g on the same skidpad) — the useful band is 0.6-2.0, which
  // is why `TUNING_RANGES.wheels.frictionSlip` stays 0.4-3, not a naive
  // 0-1000 range that would waste the whole slider on a dead zone.
  addNumber(gripFolder, tuning.wheels, "frictionSlip", TUNING_RANGES.wheels.frictionSlip).onChange(
    onApply,
  );
  addNumber(
    gripFolder,
    tuning.wheels,
    "frontSideFriction",
    TUNING_RANGES.wheels.frontSideFriction,
  ).onChange(onApply);
  // Pitfall 14 (02-RESEARCH.md): the useful range for this rear-bias dial is
  // a narrow band near zero (0.06-1.0 all meaningfully distinct), which is
  // why this stays bounded to 0..0.3 (`TUNING_RANGES.wheels.rearSideFriction`)
  // rather than a naive 0..1 that would waste 70% of the slider on a dead
  // zone.
  addNumber(
    gripFolder,
    tuning.wheels,
    "rearSideFriction",
    TUNING_RANGES.wheels.rearSideFriction,
  ).onChange(onApply);

  // ---- Drive ---------------------------------------------------------
  addNumber(
    driveFolder,
    tuning.drive,
    "engineForcePerRearWheel",
    TUNING_RANGES.drive.engineForcePerRearWheel,
  ).onChange(onApply);
  addNumber(
    driveFolder,
    tuning.drive,
    "brakeImpulsePerWheel",
    TUNING_RANGES.drive.brakeImpulsePerWheel,
  ).onChange(onApply);
  addNumber(driveFolder, tuning.drive, "maxSteerLock", TUNING_RANGES.drive.maxSteerLock).onChange(
    onApply,
  );
  addNumber(
    driveFolder,
    tuning.drive,
    "steerRampPerSec",
    TUNING_RANGES.drive.steerRampPerSec,
  ).onChange(onApply);
  addNumber(
    driveFolder,
    tuning.drive,
    "steerReturnPerSec",
    TUNING_RANGES.drive.steerReturnPerSec,
  ).onChange(onApply);
  // Pitfall 14 (02-RESEARCH.md): the ENTIRE useful range measured for this
  // dial is 0.004..0.04 — a 10x span inside the bottom 4% of a naive 0..1
  // track. Bounding this to 0..0.05 (`TUNING_RANGES.drive.handbrakeRearSideFriction`)
  // is what makes it tunable at all.
  addNumber(
    driveFolder,
    tuning.drive,
    "handbrakeRearSideFriction",
    TUNING_RANGES.drive.handbrakeRearSideFriction,
  ).onChange(onApply);
  addNumber(
    driveFolder,
    tuning.drive,
    "powerOversteerGain",
    TUNING_RANGES.drive.powerOversteerGain,
  ).onChange(onApply);

  // ---- Assists ---------------------------------------------------------
  // `autoLevelGain`: [MEASURED] load-bearing, not decoration — without it a
  // 120 mph ramp launch with an off-axis spin lands inverted every time.
  addNumber(
    assistsFolder,
    tuning.assists,
    "autoLevelGain",
    TUNING_RANGES.assists.autoLevelGain,
  ).onChange(onApply);
  addNumber(
    assistsFolder,
    tuning.assists,
    "autoLevelDamping",
    TUNING_RANGES.assists.autoLevelDamping,
  ).onChange(onApply);
  // `bodyRollGain`: [MEASURED] POSITIVE FEEDBACK — gain 0.10 -> ~5.5deg,
  // gain 0.20 -> the car flips onto its roof. `bodyRollMaxDeg` below is the
  // cutoff that keeps this assist from running away, not a decoration.
  addNumber(
    assistsFolder,
    tuning.assists,
    "bodyRollGain",
    TUNING_RANGES.assists.bodyRollGain,
  ).onChange(onApply);
  addNumber(
    assistsFolder,
    tuning.assists,
    "bodyRollDamping",
    TUNING_RANGES.assists.bodyRollDamping,
  ).onChange(onApply);
  addNumber(
    assistsFolder,
    tuning.assists,
    "bodyRollMaxDeg",
    TUNING_RANGES.assists.bodyRollMaxDeg,
  ).onChange(onApply);
  addNumber(
    assistsFolder,
    tuning.assists,
    "slideCatchGain",
    TUNING_RANGES.assists.slideCatchGain,
  ).onChange(onApply);
  addNumber(
    assistsFolder,
    tuning.assists,
    "slideCatchDamping",
    TUNING_RANGES.assists.slideCatchDamping,
  ).onChange(onApply);
  // [MEASURED] default is deliberately zero — full lock at 60/110 mph on
  // flat ground produced no more than 1.5deg of tilt with no downforce at
  // all. The knob is retained for Phase 3/4 surfaces, not removed.
  addNumber(
    assistsFolder,
    tuning.assists,
    "downforcePerSpeed2",
    TUNING_RANGES.assists.downforcePerSpeed2,
  ).onChange(onApply);

  // ---- Telemetry ---------------------------------------------------------
  // Reserved slot in the fixed folder order above. The telemetry RESULTS
  // live in their own DOM panel (`src/debug/telemetry-hud.ts`, `KeyT`)
  // rather than inside this lil-gui tree — this folder is a pointer to that
  // surface, not a duplicate set of controls.
  const telemetryPointer = { hint: "Press T for telemetry results" };
  telemetryFolder.add(telemetryPointer, "hint").disable();

  // D-17: persist on ANY change, anywhere in the tree — a controller's
  // change bubbles to its parent GUI and on up to the root regardless of
  // whether that controller itself was bound with `.onChange` or
  // `.onFinishChange` (verified by reading the shipped
  // `lil-gui.module.min.js`: `Controller._callOnChange` always calls
  // `this.parent._callOnChange(this)`). Persisting the plain object
  // (`serializeTuning`), not `gui.save(true)` — see the DEVIATION comment on
  // `serializeTuning` in `src/core/vehicle-tuning.ts` for why.
  gui.onChange(() => {
    store.set(TUNING_STORAGE_KEY, serializeTuning(tuning));
  });

  // Reset: the LAST control in the root. Two-click confirm from the
  // Copywriting Contract, no modal dialog — the project is explicitly
  // hostile to confirmation dialogs (NAV-07).
  let resetArmed = false;
  let resetTimeoutId: ReturnType<typeof setTimeout> | undefined;

  const resetController = gui
    .add(
      {
        reset(): void {
          if (!resetArmed) {
            resetArmed = true;
            resetController.name(RESET_CONFIRM_LABEL);
            resetTimeoutId = setTimeout(() => {
              resetArmed = false;
              resetController.name(RESET_LABEL);
            }, RESET_CONFIRM_MS);
            return;
          }

          // Second click within the window: perform the reset for real.
          clearTimeout(resetTimeoutId);
          resetArmed = false;
          resetController.name(RESET_LABEL);

          writeDefaultsOnto(
            tuning as unknown as Record<string, unknown>,
            defaultTuning() as unknown as Record<string, unknown>,
            TUNING_RANGES as unknown as Record<string, unknown>,
          );
          store.remove(TUNING_STORAGE_KEY);
          onApply();

          // lil-gui 0.17.0 (the version bundled in three@0.185.1, verified
          // by reading the shipped `lil-gui.module.min.js`) ships
          // `controllersRecursive()`, so no destroy/rebuild fallback is
          // needed here to refresh every slider's displayed value after a
          // reset that was written directly onto the tuning object rather
          // than through a controller's own `setValue`.
          for (const controller of gui.controllersRecursive()) {
            controller.updateDisplay();
          }
        },
      },
      "reset",
    )
    .name(RESET_LABEL);

  // Hidden by default. `onDebugKey("KeyG", …)` at the composition root is
  // what shows it — this module never checks `DEBUG_ENABLED` itself.
  gui.hide();

  return {
    toggle(): void {
      if (gui.domElement.style.display === "none") {
        gui.show();
      } else {
        gui.hide();
      }
    },
    dispose(): void {
      clearTimeout(resetTimeoutId);
      gui.destroy();
    },
  };
}
