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
 *
 * Export / Import (plan 260920-l94): the "Export tuning to file" /
 * "Import tuning from file" root controls hand every byte read back from a
 * chosen file to `parseTuningSnapshot` (`../core/tuning-snapshot`) rather
 * than a direct `JSON.parse`. An imported file is untrusted input on exactly
 * the same footing as the `localStorage` blob this panel already guards
 * (T-L94-01): a NaN mass or an Infinity friction value reaching
 * `world.step()` would corrupt every body in the physics world, not just the
 * vehicle's own. `parseTuningSnapshot` never throws and never hands this
 * module a raw, unvalidated leaf — see that module's own doc comment for the
 * full security boundary.
 */

import type { KeyToValueOfType } from "three/addons/libs/lil-gui.module.min.js";
import GUI from "three/addons/libs/lil-gui.module.min.js";
import {
  CAMERA_TUNING_RANGES,
  CAMERA_TUNING_STORAGE_KEY,
  type CameraTuning,
  defaultCameraTuning,
  serializeCameraTuning,
} from "../core/camera-tuning";
import {
  defaultSurfaceProfiles,
  SURFACE_PROFILE_RANGES,
  SURFACE_TUNING_STORAGE_KEY,
  type SurfaceProfiles,
  serializeSurfaceProfiles,
} from "../core/surface-tuning";
import { SURFACE_TYPES } from "../core/surface-types";
import { parseTuningSnapshot, serializeTuningSnapshot } from "../core/tuning-snapshot";
import {
  copyRearOverride,
  defaultTuning,
  REAR_OVERRIDE_KEYS,
  serializeTuning,
  TUNING_RANGES,
  TUNING_STORAGE_KEY,
  type TuningRange,
  type TuningRanges,
  type VehicleTuning,
} from "../core/vehicle-tuning";

/** How long "Click again to confirm" is shown before reverting to the base label. */
const RESET_CONFIRM_MS = 3000;

const RESET_LABEL = "Reset to defaults";
const RESET_CONFIRM_LABEL = "Click again to confirm";

const EXPORT_LABEL = "Export tuning to file";
const IMPORT_LABEL = "Import tuning from file";
/** Shown, then reverted after `RESET_CONFIRM_MS`, on a failed import — the
 * reset control's own rename-then-restore-on-timeout pattern, reused rather
 * than an `alert()` or thrown exception (see the module doc comment's
 * Export/Import paragraph). */
const IMPORT_FAILURE_LABEL = "Import failed — file invalid";

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

/** `YYYYMMDD-HHMMSS` from a wall-clock `Date`, for the Export control's
 * downloaded filename. Wall-clock reads are permitted under `src/debug/**`
 * per `tests/layering.test.ts`. */
function timestampForFilename(now: Date): string {
  const pad = (n: number): string => String(n).padStart(2, "0");
  return (
    `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-` +
    `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
  );
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
 * Writes every leaf of `sourceNode` onto `target`'s existing nested objects,
 * walking the shape of a `*_RANGES` table. Deliberately mutates leaves IN
 * PLACE rather than replacing `target.chassis`/`target.wheels`/etc.
 * wholesale — every lil-gui controller above holds a reference to those exact
 * nested objects (e.g. `tuning.chassis.comOffset`), and replacing the object
 * would leave the controllers pointing at stale data.
 *
 * Two callers, one function (renamed from its old defaults-only name when the
 * import path below was added): "Reset to defaults" passes a fresh
 * `defaultX()` as `sourceNode`; the Import control passes an already-validated
 * domain from `parseTuningSnapshot` instead. Both are already-trusted,
 * fully-populated objects of the matching shape by the time they reach this
 * function — Import's own validation happens upstream, in
 * `../core/tuning-snapshot.ts`, not here.
 */
function writeLeavesOnto(
  targetNode: Record<string, unknown>,
  sourceNode: Record<string, unknown>,
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
      targetNode[key] = sourceNode[key];
    } else if (typeof rangeEntry === "object" && rangeEntry !== null) {
      writeLeavesOnto(
        targetNode[key] as Record<string, unknown>,
        sourceNode[key] as Record<string, unknown>,
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

/** The three independent write paths this panel's controls fan out to — one per persisted tuning domain (T-03-01's three-key rationale). */
export interface TuningPanelHandlers {
  onApplyVehicle(): void;
  onApplySurfaces(): void;
  onApplyCamera(): void;
}

/**
 * Build the lil-gui panel over `tuning`, `surfaces` and `cameraTuning`.
 * GATE-FREE, like `createHud` — see the module doc comment above for why.
 *
 * `handlers` is called after every change that must reach the matching
 * layer: `onApplyVehicle` for the physics/vehicle tier (unchanged from
 * plan 02-09), `onApplySurfaces` for the live `SurfaceProfiles` object the
 * scene reads per wheel per tick, and `onApplyCamera` for the camera rig's
 * tuning. `storage` defaults, lazily, to a real `localStorage` adapter.
 */
export function createTuningPanel(
  tuning: VehicleTuning,
  surfaces: SurfaceProfiles,
  cameraTuning: CameraTuning,
  handlers: TuningPanelHandlers,
  storage?: TuningStorage,
  persist: {
    readonly storageKey: string;
    readonly defaults: () => VehicleTuning;
    readonly ranges?: TuningRanges;
  } = { storageKey: TUNING_STORAGE_KEY, defaults: defaultTuning },
): TuningPanel {
  const store = storage ?? createLocalStorageAdapter();
  const ranges = persist.ranges ?? TUNING_RANGES;

  // 320, not lil-gui's 245px default — the default truncates names like
  // "handbrakeRearSideFriction". The "[DEV]" suffix makes a stray screenshot
  // unambiguous (02-UI-SPEC.md).
  const gui = new GUI({ title: "Vehicle Tuning [DEV]", width: 320 });

  // Folder order is a CONTRACT, not a suggestion (02-UI-SPEC.md "Tuning
  // panel"): Chassis -> Suspension -> Grip -> Drive -> Assists -> Telemetry,
  // now followed by Phase 3's Surfaces -> Camera. New knobs append INSIDE
  // their existing folder; folders themselves never reorder (nor does a new
  // folder insert itself before an existing one), so muscle memory survives
  // a multi-session tuning effort.
  const chassisFolder = gui.addFolder("Chassis");
  const suspensionFolder = gui.addFolder("Suspension");
  const gripFolder = gui.addFolder("Grip");
  const driveFolder = gui.addFolder("Drive");
  const assistsFolder = gui.addFolder("Assists");
  const telemetryFolder = gui.addFolder("Telemetry");
  const surfacesFolder = gui.addFolder("Surfaces");
  const cameraFolder = gui.addFolder("Camera");

  // ---- Chassis --------------------------------------------------------
  // `mass`, `comOffset.*` and `halfExtents.*` bind on `.onFinishChange`,
  // never `.onChange` — Pitfall 10 (02-RESEARCH.md): `setAdditionalMassProperties`
  // OVERRIDES ALL previous additional mass properties and invalidates the
  // cached principal inertia the assists scale against, so a slider DRAG
  // would produce discontinuities or a launched car. Only a drag-release (or
  // an input blur) should trigger a rebuild.
  addNumber(chassisFolder, tuning.chassis, "mass", ranges.chassis.mass).onFinishChange(
    handlers.onApplyVehicle,
  );
  addNumber(chassisFolder, tuning.chassis.comOffset, "x", ranges.chassis.comOffset.x)
    .name("comOffset.x")
    .onFinishChange(handlers.onApplyVehicle);
  addNumber(chassisFolder, tuning.chassis.comOffset, "y", ranges.chassis.comOffset.y)
    .name("comOffset.y")
    .onFinishChange(handlers.onApplyVehicle);
  addNumber(chassisFolder, tuning.chassis.comOffset, "z", ranges.chassis.comOffset.z)
    .name("comOffset.z")
    .onFinishChange(handlers.onApplyVehicle);
  addNumber(chassisFolder, tuning.chassis.halfExtents, "x", ranges.chassis.halfExtents.x)
    .name("halfExtents.x")
    .onFinishChange(handlers.onApplyVehicle);
  addNumber(chassisFolder, tuning.chassis.halfExtents, "y", ranges.chassis.halfExtents.y)
    .name("halfExtents.y")
    .onFinishChange(handlers.onApplyVehicle);
  addNumber(chassisFolder, tuning.chassis.halfExtents, "z", ranges.chassis.halfExtents.z)
    .name("halfExtents.z")
    .onFinishChange(handlers.onApplyVehicle);
  // Damping is not mass-property-invalidating — safe live, like every wheel
  // property below.
  addNumber(chassisFolder, tuning.chassis, "linearDamping", ranges.chassis.linearDamping).onChange(
    handlers.onApplyVehicle,
  );
  addNumber(
    chassisFolder,
    tuning.chassis,
    "angularDamping",
    ranges.chassis.angularDamping,
  ).onChange(handlers.onApplyVehicle);

  // ---- Suspension (wheel geometry + suspension physics) ----------------
  // Every WHEEL property below uses `.onChange(handlers.onApplyVehicle)` — Rapier's
  // per-index wheel setters are genuinely per-frame safe, unlike
  // `setAdditionalMassProperties` above.
  addNumber(suspensionFolder, tuning.wheels, "halfTrack", ranges.wheels.halfTrack).onChange(
    handlers.onApplyVehicle,
  );
  addNumber(suspensionFolder, tuning.wheels, "halfWheelbase", ranges.wheels.halfWheelbase).onChange(
    handlers.onApplyVehicle,
  );
  addNumber(suspensionFolder, tuning.wheels, "connectionY", ranges.wheels.connectionY).onChange(
    handlers.onApplyVehicle,
  );
  addNumber(suspensionFolder, tuning.wheels, "radius", ranges.wheels.radius).onChange(
    handlers.onApplyVehicle,
  );
  addNumber(
    suspensionFolder,
    tuning.wheels,
    "suspensionRestLength",
    ranges.wheels.suspensionRestLength,
  ).onChange(handlers.onApplyVehicle);
  addNumber(
    suspensionFolder,
    tuning.wheels,
    "maxSuspensionTravel",
    ranges.wheels.maxSuspensionTravel,
  ).onChange(handlers.onApplyVehicle);
  addNumber(
    suspensionFolder,
    tuning.wheels,
    "bumpStopStiffness",
    ranges.wheels.bumpStopStiffness,
  ).onChange(handlers.onApplyVehicle);
  addNumber(
    suspensionFolder,
    tuning.wheels,
    "suspensionStiffness",
    ranges.wheels.suspensionStiffness,
  ).onChange(handlers.onApplyVehicle);
  addNumber(
    suspensionFolder,
    tuning.wheels,
    "suspensionCompression",
    ranges.wheels.suspensionCompression,
  ).onChange(handlers.onApplyVehicle);
  addNumber(
    suspensionFolder,
    tuning.wheels,
    "suspensionRelaxation",
    ranges.wheels.suspensionRelaxation,
  ).onChange(handlers.onApplyVehicle);
  addNumber(
    suspensionFolder,
    tuning.wheels,
    "maxSuspensionForce",
    ranges.wheels.maxSuspensionForce,
  ).onChange(handlers.onApplyVehicle);
  // The "Rear axle" sub-folder is bound to the `wheels.rear` object itself,
  // which Reset and Import replace or remove (`copyRearOverride`), so it is
  // rebuilt after each of those. It is the last child of the Suspension
  // folder, so a rebuild puts it back in the same place.
  let rearFolder: GUI | undefined;
  function rebuildRearFolder(): void {
    rearFolder?.destroy();
    rearFolder = undefined;
    const rearOverride = tuning.wheels.rear;
    if (rearOverride === undefined || typeof rearOverride !== "object") {
      return;
    }
    rearFolder = suspensionFolder.addFolder("Rear axle");
    for (const key of REAR_OVERRIDE_KEYS) {
      if (key in rearOverride) {
        addNumber(
          rearFolder,
          rearOverride as Record<string, number>,
          key,
          ranges.wheels[key],
        ).onChange(handlers.onApplyVehicle);
      }
    }
  }
  rebuildRearFolder();

  // ---- Grip --------------------------------------------------------------
  // `frictionSlip`: [MEASURED] dead above ~10 (10.5 and 1000 read identical,
  // 3.48g vs 3.49g on the same skidpad) — the useful band is 0.6-2.0, which
  // is why `TUNING_RANGES.wheels.frictionSlip` stays 0.4-3, not a naive
  // 0-1000 range that would waste the whole slider on a dead zone.
  addNumber(gripFolder, tuning.wheels, "frictionSlip", ranges.wheels.frictionSlip).onChange(
    handlers.onApplyVehicle,
  );
  // Surface blend: how fast a wheel adopts a new surface's grip (slow to regrip, fast to degrip).
  addNumber(gripFolder, tuning.wheels, "surfaceRegripSec", ranges.wheels.surfaceRegripSec).onChange(
    handlers.onApplyVehicle,
  );
  addNumber(gripFolder, tuning.wheels, "surfaceDegripSec", ranges.wheels.surfaceDegripSec).onChange(
    handlers.onApplyVehicle,
  );
  addNumber(
    gripFolder,
    tuning.wheels,
    "frontSideFriction",
    ranges.wheels.frontSideFriction,
  ).onChange(handlers.onApplyVehicle);
  // Pitfall 14 (02-RESEARCH.md): the useful range for this rear-bias dial is
  // a narrow band near zero (0.06-1.0 all meaningfully distinct), which is
  // why this stays bounded to 0..0.3 (`TUNING_RANGES.wheels.rearSideFriction`)
  // rather than a naive 0..1 that would waste 70% of the slider on a dead
  // zone.
  addNumber(gripFolder, tuning.wheels, "rearSideFriction", ranges.wheels.rearSideFriction).onChange(
    handlers.onApplyVehicle,
  );

  // ---- Drive ---------------------------------------------------------
  addNumber(
    driveFolder,
    tuning.drive,
    "engineForcePerRearWheel",
    ranges.drive.engineForcePerRearWheel,
  ).onChange(handlers.onApplyVehicle);
  addNumber(
    driveFolder,
    tuning.drive,
    "brakeImpulsePerWheel",
    ranges.drive.brakeImpulsePerWheel,
  ).onChange(handlers.onApplyVehicle);
  addNumber(driveFolder, tuning.drive, "maxSteerLock", ranges.drive.maxSteerLock).onChange(
    handlers.onApplyVehicle,
  );
  addNumber(driveFolder, tuning.drive, "steerRampPerSec", ranges.drive.steerRampPerSec).onChange(
    handlers.onApplyVehicle,
  );
  addNumber(
    driveFolder,
    tuning.drive,
    "steerReturnPerSec",
    ranges.drive.steerReturnPerSec,
  ).onChange(handlers.onApplyVehicle);
  // Pitfall 14 (02-RESEARCH.md): the ENTIRE useful range measured for this
  // dial is 0.004..0.04 — a 10x span inside the bottom 4% of a naive 0..1
  // track. Bounding this to 0..0.05 (`TUNING_RANGES.drive.handbrakeRearSideFriction`)
  // is what makes it tunable at all.
  addNumber(
    driveFolder,
    tuning.drive,
    "handbrakeRearSideFriction",
    ranges.drive.handbrakeRearSideFriction,
  ).onChange(handlers.onApplyVehicle);
  addNumber(
    driveFolder,
    tuning.drive,
    "powerOversteerGain",
    ranges.drive.powerOversteerGain,
  ).onChange(handlers.onApplyVehicle);
  addNumber(
    driveFolder,
    tuning.drive,
    "powerOversteerRearSideFriction",
    ranges.drive.powerOversteerRearSideFriction,
  ).onChange(handlers.onApplyVehicle);
  // Throttle-slide floor at low/medium speed (fades to the one above by the power fade speeds).
  addNumber(
    driveFolder,
    tuning.drive,
    "powerOversteerLowSpeedRearSideFriction",
    ranges.drive.powerOversteerLowSpeedRearSideFriction,
  ).onChange(handlers.onApplyVehicle);
  addNumber(driveFolder, tuning.drive, "pivotTurn", ranges.drive.pivotTurn).onChange(
    handlers.onApplyVehicle,
  );
  addNumber(driveFolder, tuning.drive, "pivotYawRate", ranges.drive.pivotYawRate).onChange(
    handlers.onApplyVehicle,
  );
  addNumber(
    driveFolder,
    tuning.drive,
    "pivotFrontSpeedCap",
    ranges.drive.pivotFrontSpeedCap,
  ).onChange(handlers.onApplyVehicle);
  addNumber(driveFolder, tuning.drive, "pivotEngageSec", ranges.drive.pivotEngageSec).onChange(
    handlers.onApplyVehicle,
  );
  addNumber(driveFolder, tuning.drive, "pivotAssist", ranges.drive.pivotAssist).onChange(
    handlers.onApplyVehicle,
  );
  addNumber(
    driveFolder,
    tuning.drive,
    "reverseEngineForcePerRearWheel",
    ranges.drive.reverseEngineForcePerRearWheel,
  ).onChange(handlers.onApplyVehicle);
  addNumber(
    driveFolder,
    tuning.drive,
    "reverseEngageSpeedMs",
    ranges.drive.reverseEngageSpeedMs,
  ).onChange(handlers.onApplyVehicle);
  addNumber(driveFolder, tuning.drive, "topSpeedMs", ranges.drive.topSpeedMs).onChange(
    handlers.onApplyVehicle,
  );
  addNumber(
    driveFolder,
    tuning.drive,
    "highSpeedSteerFraction",
    ranges.drive.highSpeedSteerFraction,
  ).onChange(handlers.onApplyVehicle);
  addNumber(driveFolder, tuning.drive, "lowGearPunch", ranges.drive.lowGearPunch).onChange(
    handlers.onApplyVehicle,
  );
  addNumber(driveFolder, tuning.drive, "flickGain", ranges.drive.flickGain).onChange(
    handlers.onApplyVehicle,
  );
  addNumber(driveFolder, tuning.drive, "flickSwingSec", ranges.drive.flickSwingSec).onChange(
    handlers.onApplyVehicle,
  );
  addNumber(
    driveFolder,
    tuning.drive,
    "rearGripRecoverySec",
    ranges.drive.rearGripRecoverySec,
  ).onChange(handlers.onApplyVehicle);
  addNumber(driveFolder, tuning.drive, "slideSurge", ranges.drive.slideSurge).onChange(
    handlers.onApplyVehicle,
  );
  addNumber(driveFolder, tuning.drive, "liftOffOversteer", ranges.drive.liftOffOversteer).onChange(
    handlers.onApplyVehicle,
  );
  // Front tyre falloff: the steered axle lets go past a front slip angle, so all four tyres can slide.
  for (const key of [
    "frontFalloff",
    "frontFalloffOnsetDeg",
    "frontFalloffFullDeg",
    "driftHold",
    "driftHoldSlipDeg",
    "looseTraction",
  ] as const) {
    addNumber(driveFolder, tuning.drive, key, ranges.drive[key]).onChange(handlers.onApplyVehicle);
  }
  addNumber(driveFolder, tuning.drive, "tyreFalloff", ranges.drive.tyreFalloff).onChange(
    handlers.onApplyVehicle,
  );
  addNumber(driveFolder, tuning.drive, "rollGuard", ranges.drive.rollGuard).onChange(
    handlers.onApplyVehicle,
  );
  addNumber(driveFolder, tuning.drive, "powerFadeStartMs", ranges.drive.powerFadeStartMs).onChange(
    handlers.onApplyVehicle,
  );
  addNumber(driveFolder, tuning.drive, "powerFadeEndMs", ranges.drive.powerFadeEndMs).onChange(
    handlers.onApplyVehicle,
  );
  addNumber(driveFolder, tuning.drive, "powerSlipOpenDeg", ranges.drive.powerSlipOpenDeg).onChange(
    handlers.onApplyVehicle,
  );
  // Wheelspin oversteer: rear drive demand vs rear traction (0 gain = off).
  addNumber(driveFolder, tuning.drive, "wheelspinGain", ranges.drive.wheelspinGain).onChange(
    handlers.onApplyVehicle,
  );
  addNumber(driveFolder, tuning.drive, "wheelspinOnset", ranges.drive.wheelspinOnset).onChange(
    handlers.onApplyVehicle,
  );
  addNumber(driveFolder, tuning.drive, "yawDampingGain", ranges.drive.yawDampingGain).onChange(
    handlers.onApplyVehicle,
  );
  addNumber(
    driveFolder,
    tuning.drive,
    "yawDampingStartMs",
    ranges.drive.yawDampingStartMs,
  ).onChange(handlers.onApplyVehicle);
  addNumber(driveFolder, tuning.drive, "yawDampingFullMs", ranges.drive.yawDampingFullMs).onChange(
    handlers.onApplyVehicle,
  );
  addNumber(
    driveFolder,
    tuning.drive,
    "yawDampingSteerOff",
    ranges.drive.yawDampingSteerOff,
  ).onChange(handlers.onApplyVehicle);
  addNumber(
    driveFolder,
    tuning.drive,
    "yawDampingSlipOffDeg",
    ranges.drive.yawDampingSlipOffDeg,
  ).onChange(handlers.onApplyVehicle);

  // ---- Assists ---------------------------------------------------------
  // `autoLevelGain`: [MEASURED] load-bearing, not decoration — without it a
  // 120 mph ramp launch with an off-axis spin lands inverted every time.
  addNumber(assistsFolder, tuning.assists, "autoLevelGain", ranges.assists.autoLevelGain).onChange(
    handlers.onApplyVehicle,
  );
  addNumber(
    assistsFolder,
    tuning.assists,
    "autoLevelDamping",
    ranges.assists.autoLevelDamping,
  ).onChange(handlers.onApplyVehicle);
  // `airPitchGain`: steers the nose toward the flight path while airborne so
  // a ramp launch doesn't nose-dive (0 = off).
  addNumber(assistsFolder, tuning.assists, "airPitchGain", ranges.assists.airPitchGain).onChange(
    handlers.onApplyVehicle,
  );
  addNumber(
    assistsFolder,
    tuning.assists,
    "airPitchDamping",
    ranges.assists.airPitchDamping,
  ).onChange(handlers.onApplyVehicle);
  // `landingCushionG`: virtual extra suspension stroke on a hard touchdown (0 = off).
  addNumber(
    assistsFolder,
    tuning.assists,
    "landingCushionG",
    ranges.assists.landingCushionG,
  ).onChange(handlers.onApplyVehicle);
  addNumber(
    assistsFolder,
    tuning.assists,
    "landingCushionSinkMs",
    ranges.assists.landingCushionSinkMs,
  ).onChange(handlers.onApplyVehicle);
  // `bodyRollGain`: [MEASURED] POSITIVE FEEDBACK — gain 0.10 -> ~5.5deg,
  // gain 0.20 -> the car flips onto its roof. `bodyRollMaxDeg` below is the
  // cutoff that keeps this assist from running away, not a decoration.
  addNumber(assistsFolder, tuning.assists, "bodyRollGain", ranges.assists.bodyRollGain).onChange(
    handlers.onApplyVehicle,
  );
  addNumber(
    assistsFolder,
    tuning.assists,
    "bodyRollDamping",
    ranges.assists.bodyRollDamping,
  ).onChange(handlers.onApplyVehicle);
  addNumber(
    assistsFolder,
    tuning.assists,
    "bodyRollMaxDeg",
    ranges.assists.bodyRollMaxDeg,
  ).onChange(handlers.onApplyVehicle);
  addNumber(
    assistsFolder,
    tuning.assists,
    "slideCatchGain",
    ranges.assists.slideCatchGain,
  ).onChange(handlers.onApplyVehicle);
  addNumber(
    assistsFolder,
    tuning.assists,
    "slideCatchDamping",
    ranges.assists.slideCatchDamping,
  ).onChange(handlers.onApplyVehicle);
  // [MEASURED] default is deliberately zero — full lock at 60/110 mph on
  // flat ground produced no more than 1.5deg of tilt with no downforce at
  // all. The knob is retained for Phase 3/4 surfaces, not removed.
  addNumber(
    assistsFolder,
    tuning.assists,
    "downforcePerSpeed2",
    ranges.assists.downforcePerSpeed2,
  ).onChange(handlers.onApplyVehicle);

  // ---- Telemetry ---------------------------------------------------------
  // Reserved slot in the fixed folder order above. The telemetry RESULTS
  // live in their own DOM panel (`src/debug/telemetry-hud.ts`, `KeyT`)
  // rather than inside this lil-gui tree — this folder is a pointer to that
  // surface, not a duplicate set of controls.
  const telemetryPointer = { hint: "Press T for telemetry results" };
  telemetryFolder.add(telemetryPointer, "hint").disable();

  // ---- Surfaces (plan 03-07) ---------------------------------------------
  // Twelve controls: forwardGrip + lateralGrip per SURFACE_TYPES entry, in
  // SURFACE_TYPES order. Named "{surface} fwd" / "{surface} lat" so both the
  // surface and the axis stay visible inside this panel's 320px width. All
  // twelve bind `.onChange` — these are plain per-wheel multipliers applied
  // fresh every tick (`src/physics/vehicle.ts`) and none of them invalidates
  // cached mass properties the way `chassis.mass` does, so Pitfall 10's
  // drag-release-only restriction on the Chassis folder above does not apply
  // here. The asymmetry with the Chassis folder is deliberate, not an
  // oversight.
  for (const surface of SURFACE_TYPES) {
    addNumber(
      surfacesFolder,
      surfaces[surface],
      "forwardGrip",
      SURFACE_PROFILE_RANGES[surface].forwardGrip,
    )
      .name(`${surface} fwd`)
      .onChange(handlers.onApplySurfaces);
    addNumber(
      surfacesFolder,
      surfaces[surface],
      "lateralGrip",
      SURFACE_PROFILE_RANGES[surface].lateralGrip,
    )
      .name(`${surface} lat`)
      .onChange(handlers.onApplySurfaces);
  }

  // ---- Camera (plan 03-07) -----------------------------------------------
  // One control per numeric leaf of `CAMERA_TUNING_RANGES` (~21 total),
  // grouped into sub-folders so the flat leaf count stays navigable. All
  // bind `.onChange(handlers.onApplyCamera)` — the rig re-reads its
  // `CameraTuning` object by reference every `update(dtMs)`, so every one of
  // these is safe live, matching the Suspension/Grip/Drive folders' own
  // per-frame-safe convention rather than the Chassis folder's
  // drag-release-only one.
  const framingFolder = cameraFolder.addFolder("Framing");
  addNumber(
    framingFolder,
    cameraTuning.framing,
    "lowSpeedMs",
    CAMERA_TUNING_RANGES.framing.lowSpeedMs,
  ).onChange(handlers.onApplyCamera);
  addNumber(
    framingFolder,
    cameraTuning.framing,
    "highSpeedMs",
    CAMERA_TUNING_RANGES.framing.highSpeedMs,
  ).onChange(handlers.onApplyCamera);
  addNumber(
    framingFolder,
    cameraTuning.framing,
    "lowAltitudeM",
    CAMERA_TUNING_RANGES.framing.lowAltitudeM,
  ).onChange(handlers.onApplyCamera);
  addNumber(
    framingFolder,
    cameraTuning.framing,
    "lowDistanceM",
    CAMERA_TUNING_RANGES.framing.lowDistanceM,
  ).onChange(handlers.onApplyCamera);
  addNumber(
    framingFolder,
    cameraTuning.framing,
    "lowFovDeg",
    CAMERA_TUNING_RANGES.framing.lowFovDeg,
  ).onChange(handlers.onApplyCamera);
  addNumber(
    framingFolder,
    cameraTuning.framing,
    "highAltitudeM",
    CAMERA_TUNING_RANGES.framing.highAltitudeM,
  ).onChange(handlers.onApplyCamera);
  addNumber(
    framingFolder,
    cameraTuning.framing,
    "highDistanceM",
    CAMERA_TUNING_RANGES.framing.highDistanceM,
  ).onChange(handlers.onApplyCamera);
  addNumber(
    framingFolder,
    cameraTuning.framing,
    "highFovDeg",
    CAMERA_TUNING_RANGES.framing.highFovDeg,
  ).onChange(handlers.onApplyCamera);

  const dampingFolder = cameraFolder.addFolder("Damping");
  addNumber(
    dampingFolder,
    cameraTuning.damping,
    "positionLambda",
    CAMERA_TUNING_RANGES.damping.positionLambda,
  ).onChange(handlers.onApplyCamera);
  addNumber(
    dampingFolder,
    cameraTuning.damping,
    "headingLambda",
    CAMERA_TUNING_RANGES.damping.headingLambda,
  ).onChange(handlers.onApplyCamera);
  addNumber(
    dampingFolder,
    cameraTuning.damping,
    "framingLambda",
    CAMERA_TUNING_RANGES.damping.framingLambda,
  ).onChange(handlers.onApplyCamera);

  const headingFolder = cameraFolder.addFolder("Heading");
  addNumber(
    headingFolder,
    cameraTuning.heading,
    "blendSpeedMs",
    CAMERA_TUNING_RANGES.heading.blendSpeedMs,
  ).onChange(handlers.onApplyCamera);

  const occlusionFolder = cameraFolder.addFolder("Occlusion");
  addNumber(
    occlusionFolder,
    cameraTuning.occlusion,
    "nearTargetMarginM",
    CAMERA_TUNING_RANGES.occlusion.nearTargetMarginM,
  ).onChange(handlers.onApplyCamera);
  addNumber(
    occlusionFolder,
    cameraTuning.occlusion,
    "fadeFloorOpacity",
    CAMERA_TUNING_RANGES.occlusion.fadeFloorOpacity,
  ).onChange(handlers.onApplyCamera);
  addNumber(
    occlusionFolder,
    cameraTuning.occlusion,
    "fadeLambda",
    CAMERA_TUNING_RANGES.occlusion.fadeLambda,
  ).onChange(handlers.onApplyCamera);
  addNumber(
    occlusionFolder,
    cameraTuning.occlusion,
    "basePitchDeg",
    CAMERA_TUNING_RANGES.occlusion.basePitchDeg,
  ).onChange(handlers.onApplyCamera);
  addNumber(
    occlusionFolder,
    cameraTuning.occlusion,
    "maxPitchDeg",
    CAMERA_TUNING_RANGES.occlusion.maxPitchDeg,
  ).onChange(handlers.onApplyCamera);
  addNumber(
    occlusionFolder,
    cameraTuning.occlusion,
    "fanRayCount",
    CAMERA_TUNING_RANGES.occlusion.fanRayCount,
  ).onChange(handlers.onApplyCamera);

  const chaseFallbackFolder = cameraFolder.addFolder("Chase fallback");
  addNumber(
    chaseFallbackFolder,
    cameraTuning.chaseFallback,
    "altitudeM",
    CAMERA_TUNING_RANGES.chaseFallback.altitudeM,
  ).onChange(handlers.onApplyCamera);
  addNumber(
    chaseFallbackFolder,
    cameraTuning.chaseFallback,
    "distanceM",
    CAMERA_TUNING_RANGES.chaseFallback.distanceM,
  ).onChange(handlers.onApplyCamera);
  addNumber(
    chaseFallbackFolder,
    cameraTuning.chaseFallback,
    "fovDeg",
    CAMERA_TUNING_RANGES.chaseFallback.fovDeg,
  ).onChange(handlers.onApplyCamera);

  /**
   * D-17's three small writes, factored into one helper so both the
   * blanket `gui.onChange` below and the Import success path (further down)
   * share exactly one persistence call site rather than duplicating the
   * three lines. Three separate keys, not one merged blob, is deliberate: a
   * corrupt camera blob can never take the vehicle tuning down with it.
   */
  function persistAll(): void {
    store.set(persist.storageKey, serializeTuning(tuning));
    store.set(SURFACE_TUNING_STORAGE_KEY, serializeSurfaceProfiles(surfaces));
    store.set(CAMERA_TUNING_STORAGE_KEY, serializeCameraTuning(cameraTuning));
  }

  // D-17: persist on ANY change, anywhere in the tree — a controller's
  // change bubbles to its parent GUI and on up to the root regardless of
  // whether that controller itself was bound with `.onChange` or
  // `.onFinishChange` (verified by reading the shipped
  // `lil-gui.module.min.js`: `Controller._callOnChange` always calls
  // `this.parent._callOnChange(this)`). Persisting the plain objects
  // (`serializeTuning`/`serializeSurfaceProfiles`/`serializeCameraTuning`),
  // not `gui.save(true)` — see the DEVIATION comment on `serializeTuning` in
  // `src/core/vehicle-tuning.ts` for why.
  gui.onChange(() => {
    persistAll();
  });

  // ---- Export / Import (plan 260920-l94) ---------------------------------
  // Both live at the ROOT, immediately BEFORE "Reset to defaults" below —
  // "Reset to defaults" staying the LAST root control is an existing,
  // explicit convention this plan does not disturb. Gate-free by
  // construction, like every other control in this file: `src/main.ts`
  // remains the sole `DEBUG_ENABLED` gate.
  gui
    .add(
      {
        exportTuning(): void {
          // Pretty-printed, three-domain JSON, meant to be opened/diffed by
          // hand — see `serializeTuningSnapshot`'s own doc comment.
          const raw = serializeTuningSnapshot(tuning, surfaces, cameraTuning);
          const blob = new Blob([raw], { type: "application/json" });
          const url = URL.createObjectURL(blob);

          const anchor = document.createElement("a");
          anchor.href = url;
          // Plain property assignment, never the DOM-injection sink this
          // repo bans outright (T-01-28, mechanically enforced by
          // `tests/layering.test.ts`).
          anchor.download = `heat-street-tuning-${timestampForFilename(new Date())}.json`;
          document.body.appendChild(anchor);
          anchor.click();
          document.body.removeChild(anchor);
          URL.revokeObjectURL(url);
        },
      },
      "exportTuning",
    )
    .name(EXPORT_LABEL);

  // A hidden, never-appended-to-a-form file input is the standard way to
  // drive the browser's native file picker from a button click — clicking it
  // programmatically from INSIDE the button's own click handler (below)
  // keeps the picker's `.click()` call inside the same user gesture Chrome
  // and Firefox both require to allow it.
  const importFileInput = document.createElement("input");
  importFileInput.type = "file";
  importFileInput.accept = "application/json,.json";
  importFileInput.style.display = "none";
  document.body.appendChild(importFileInput);

  let importFailureTimeoutId: ReturnType<typeof setTimeout> | undefined;

  const importController = gui
    .add(
      {
        importTuning(): void {
          importFileInput.click();
        },
      },
      "importTuning",
    )
    .name(IMPORT_LABEL);

  importFileInput.addEventListener("change", () => {
    const file = importFileInput.files?.[0];
    // Clearing the value lets the SAME file be re-selected consecutively —
    // otherwise a second pick of an identical path never fires `change`.
    importFileInput.value = "";
    if (!file) {
      return;
    }

    file.text().then((raw) => {
      // The security boundary: every byte read back from the file goes
      // through `parseTuningSnapshot`, never a direct `JSON.parse` — see the
      // module doc comment's Export/Import paragraph.
      const snapshot = parseTuningSnapshot(raw, ranges, persist.defaults);

      if (snapshot === null) {
        // Failure is surfaced through the control's own label, exactly like
        // the reset control's confirm-then-restore pattern — no `alert()`,
        // no thrown exception, and nothing is mutated.
        clearTimeout(importFailureTimeoutId);
        importController.name(IMPORT_FAILURE_LABEL);
        importFailureTimeoutId = setTimeout(() => {
          importController.name(IMPORT_LABEL);
        }, RESET_CONFIRM_MS);
        return;
      }

      // Per-domain independence: only the domains that actually came back
      // non-null are written and re-applied — mirrors D-17's
      // three-separate-keys rationale (see `../core/tuning-snapshot.ts`'s
      // module doc comment).
      if (snapshot.vehicle !== null) {
        writeLeavesOnto(
          tuning as unknown as Record<string, unknown>,
          snapshot.vehicle as unknown as Record<string, unknown>,
          TUNING_RANGES as unknown as Record<string, unknown>,
        );
        handlers.onApplyVehicle();
      }
      if (snapshot.surfaces !== null) {
        writeLeavesOnto(
          surfaces as unknown as Record<string, unknown>,
          snapshot.surfaces as unknown as Record<string, unknown>,
          SURFACE_PROFILE_RANGES as unknown as Record<string, unknown>,
        );
        handlers.onApplySurfaces();
      }
      if (snapshot.camera !== null) {
        writeLeavesOnto(
          cameraTuning as unknown as Record<string, unknown>,
          snapshot.camera as unknown as Record<string, unknown>,
          CAMERA_TUNING_RANGES as unknown as Record<string, unknown>,
        );
        handlers.onApplyCamera();
      }

      for (const controller of gui.controllersRecursive()) {
        controller.updateDisplay();
      }

      // An import is a change and must persist like one (D-17).
      persistAll();
    });
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

          const defaults = persist.defaults();
          writeLeavesOnto(
            tuning as unknown as Record<string, unknown>,
            defaults as unknown as Record<string, unknown>,
            ranges as unknown as Record<string, unknown>,
          );
          // The leaf walk skips `wheels.rear` (no range-table key), so a stale
          // override would survive the reset and be re-saved on the next change.
          copyRearOverride(tuning, defaults);
          rebuildRearFolder();
          writeLeavesOnto(
            surfaces as unknown as Record<string, unknown>,
            defaultSurfaceProfiles() as unknown as Record<string, unknown>,
            SURFACE_PROFILE_RANGES as unknown as Record<string, unknown>,
          );
          writeLeavesOnto(
            cameraTuning as unknown as Record<string, unknown>,
            defaultCameraTuning() as unknown as Record<string, unknown>,
            CAMERA_TUNING_RANGES as unknown as Record<string, unknown>,
          );
          store.remove(persist.storageKey);
          store.remove(SURFACE_TUNING_STORAGE_KEY);
          store.remove(CAMERA_TUNING_STORAGE_KEY);
          handlers.onApplyVehicle();
          handlers.onApplySurfaces();
          handlers.onApplyCamera();

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
      clearTimeout(importFailureTimeoutId);
      importFileInput.remove();
      gui.destroy();
    },
  };
}
