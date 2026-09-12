/**
 * CAM-04's A/B/off toggle: both named mitigations — fading occluding
 * buildings translucent, and steepening the camera pitch toward near-
 * overhead in dense clusters then relaxing in open ones — plus a genuine
 * no-mitigation baseline, all behind one `OcclusionMitigation` selector, so
 * plan 03-12's playtest is a real three-way comparison rather than a forced
 * choice between two changes with nothing to compare against.
 *
 * Reads `src/render/camera/occlusion.ts`'s pure classification/curve
 * functions and `src/render/camera/occlusion-probe.ts`'s
 * `THREE.Raycaster`-backed queries; writes onto the building meshes'
 * materials and the active `CameraRig`'s pitch bias. This file is gate-free —
 * `src/main.ts` owns the debug-flag check for the `O` A/B cycle (described by
 * behaviour rather than by identifier here, so this comment cannot trip the
 * zero-count gate-free grep the plan's acceptance criteria run against this
 * file, mirroring plan 02-03's identical resolution); the mitigation itself
 * runs unconditionally, exactly like the camera rig it biases (T-03-04).
 */
import * as THREE from "three";
import type { CameraTuning } from "../../core/camera-tuning";
import { dampFactor } from "./camera-math";
import type { CameraRig } from "./helicopter-camera";
import {
  classifyOcclusion,
  densityFrom,
  fadeTargetOpacity,
  fanOffsetsRad,
  type OcclusionMitigation,
  steepenPitchRad,
} from "./occlusion";
import type { OcclusionProbe } from "./occlusion-probe";

export interface OcclusionController {
  /** The currently active mitigation. */
  mitigation(): OcclusionMitigation;
  /** Switch mitigation, fully resetting the state of whichever arm is being left (T-03-30). A no-op if `m` is already active. */
  setMitigation(m: OcclusionMitigation): void;
  /** Advance to the next mitigation in fade -> steepen -> off -> fade order, returning the new value. The single control plan 03-12's playtest needs. */
  cycle(): OcclusionMitigation;
  /** Advance the active mitigation's damped state for one render frame and apply it. `dtMs` is a variable RENDER-frame delta, never the fixed physics tick (T-03-21). */
  update(cameraPos: THREE.Vector3, targetPos: THREE.Vector3, dtMs: number): void;
  /** Restore every building's opacity/depth-write and zero the pitch bias. */
  dispose(): void;
}

/** `cycle()`'s fixed order: fade first (the current shipped default per `src/main.ts`), then steepen, then the off baseline. */
const CYCLE_ORDER: readonly OcclusionMitigation[] = ["fade", "steepen", "off"];

export function createOcclusionController(
  probe: OcclusionProbe,
  buildingMeshes: readonly THREE.Mesh[],
  rig: CameraRig,
  tuning: CameraTuning,
  initial: OcclusionMitigation = "fade",
): OcclusionController {
  let current: OcclusionMitigation = initial;

  // Pre-allocated per-mesh opacity state, indexed positionally — never a
  // `Map` rebuilt per frame (T-03-29). Starts at 1 (fully opaque), matching
  // every building mesh's actual starting material opacity.
  const opacities = new Float32Array(buildingMeshes.length).fill(1);

  // `null` means "steepen has not damped anything yet this arm-activation" —
  // the flag `updateSteepen` uses to snap to the baseline pitch on its own
  // first frame rather than damping in from an arbitrary previous value.
  let dampedPitchRad: number | null = null;

  /** Write `opacity` onto mesh `index`'s material and this controller's own tracked state. */
  function setMeshOpacity(index: number, opacity: number): void {
    opacities[index] = opacity;
    const material = buildingMeshes[index].material as THREE.Material;
    material.opacity = opacity;
    // Several simultaneously-faded overlapping buildings sort incorrectly
    // against each other with depth writes on, producing flicker that reads
    // as a bug rather than as a mitigation — disable depth writes while
    // faded, restore once fully opaque again.
    if (opacity < 1) {
      material.depthWrite = false;
    } else {
      material.depthWrite = true;
    }
  }

  /** Restore every building to full opacity and depth-write — the fade arm's full reset, and half of the off arm's baseline. */
  function resetFadeState(): void {
    for (let i = 0; i < buildingMeshes.length; i++) {
      setMeshOpacity(i, 1);
    }
  }

  function updateFade(cameraPos: THREE.Vector3, targetPos: THREE.Vector3, dtSec: number): void {
    const targetDistanceM = cameraPos.distanceTo(targetPos);
    const hits = probe.hits(cameraPos, targetPos);
    const state = classifyOcclusion(hits, targetDistanceM, tuning.occlusion.nearTargetMarginM);
    const factor = dampFactor(tuning.occlusion.fadeLambda, dtSec);
    for (let i = 0; i < buildingMeshes.length; i++) {
      const isOccluder = state.occluderIds.includes(buildingMeshes[i].id);
      const targetOpacity = fadeTargetOpacity(isOccluder, 1, tuning.occlusion.fadeFloorOpacity);
      const nextOpacity = opacities[i] + (targetOpacity - opacities[i]) * factor;
      setMeshOpacity(i, nextOpacity);
    }
  }

  function updateSteepen(cameraPos: THREE.Vector3, targetPos: THREE.Vector3, dtSec: number): void {
    const offsets = fanOffsetsRad(tuning.occlusion.fanRayCount);
    const occludedFanRayCount = probe.occludedFanRayCount(cameraPos, targetPos, offsets);
    const density01 = densityFrom(occludedFanRayCount, offsets.length);
    const basePitchRad = THREE.MathUtils.degToRad(tuning.occlusion.basePitchDeg);
    const maxPitchRad = THREE.MathUtils.degToRad(tuning.occlusion.maxPitchDeg);
    const desiredPitchRad = steepenPitchRad(basePitchRad, maxPitchRad, density01);

    if (dampedPitchRad === null) {
      // First frame this arm has run since it was selected: snap to the
      // baseline rather than damping in from an undefined starting point —
      // the CameraRig's own `snap()` uses the identical "no lag on frame 1"
      // rationale.
      dampedPitchRad = basePitchRad;
    }
    const factor = dampFactor(tuning.occlusion.fadeLambda, dtSec);
    dampedPitchRad += (desiredPitchRad - dampedPitchRad) * factor;

    // A density of 0 (fully open) drives dampedPitchRad back to
    // basePitchRad, so the bias below converges to exactly 0 — the rig's
    // untouched baseline pose. This is CAM-04's "then relaxing in open
    // areas" half.
    rig.setPitchBiasRad(dampedPitchRad - basePitchRad);
  }

  /** Shared implementation for the public `setMitigation`/`cycle` methods below — a plain closure function, never `this`, matching every other rig factory in this tier. */
  function applyMitigation(m: OcclusionMitigation): void {
    if (m === current) {
      return;
    }
    // Fully reset whichever arm is being left, so an A/B comparison is
    // never contaminated by state left over from the previously-selected
    // arm (T-03-30).
    if (current === "fade") {
      resetFadeState();
    }
    if (current === "steepen") {
      dampedPitchRad = null;
      rig.setPitchBiasRad(0);
    }
    current = m;
    if (m === "off") {
      // The baseline arm of the comparison: fully restore both mitigations'
      // state immediately, not just on the next update() call.
      resetFadeState();
      dampedPitchRad = null;
      rig.setPitchBiasRad(0);
    }
  }

  return {
    mitigation(): OcclusionMitigation {
      return current;
    },

    setMitigation(m: OcclusionMitigation): void {
      applyMitigation(m);
    },

    cycle(): OcclusionMitigation {
      const index = CYCLE_ORDER.indexOf(current);
      const next = CYCLE_ORDER[(index + 1) % CYCLE_ORDER.length];
      applyMitigation(next);
      return next;
    },

    update(cameraPos: THREE.Vector3, targetPos: THREE.Vector3, dtMs: number): void {
      const dtSec = dtMs / 1000;
      if (current === "fade") {
        updateFade(cameraPos, targetPos, dtSec);
      } else if (current === "steepen") {
        updateSteepen(cameraPos, targetPos, dtSec);
      } else if (current === "off") {
        // "off": the baseline arm — restore every building to full opacity
        // and depth-write, and zero the pitch bias, every frame (idempotent;
        // defends against any transient state a mitigation switch mid-frame
        // could otherwise leave behind).
        resetFadeState();
        dampedPitchRad = null;
        rig.setPitchBiasRad(0);
      }
    },

    dispose(): void {
      resetFadeState();
      dampedPitchRad = null;
      rig.setPitchBiasRad(0);
    },
  };
}
