/**
 * The single source of truth for the helicopter camera rig's tunable
 * numbers: the shape of every knob, the measured/assumed default values, the
 * per-field legal range, and the pure parse/clamp functions that make a
 * user-editable `localStorage` blob safe to feed into `camera.fov` and
 * `camera.position` (plan 03-06's lil-gui panel, plan 03-11's go/no-go
 * playtest).
 *
 * Structural analog of `src/core/surface-tuning.ts` — same
 * `defaultX()`/`X_RANGES`/`clampX`/`parseSavedX`/`serializeX` shape, sharing
 * its generic clamp/copy machinery from `./tuning-utils` rather than
 * re-implementing it (03-RESEARCH.md's "Don't Hand-Roll" section; T-03-03).
 *
 * Pure by construction: no renderer, no physics engine, no DOM, no wall
 * clock. `tests/layering.test.ts` mechanically enforces this for every file
 * under `src/core/` — no `from "three"`, no `from "@dimforge/rapier3d"`, no
 * `document.`, `window.`, `performance.` or `requestAnimationFrame`.
 */

import { clampNode, copyLeaves, isPlainObject, type TuningRange } from "./tuning-utils";

/**
 * The full tunable configuration for the helicopter camera rig (and its
 * D-12 chase-cam fallback). Every leaf is a plain, mutable number — no
 * `readonly` group keys, mirroring `SurfaceProfiles`' shape rather than
 * `VehicleTuning`'s, since this object is expected to be swept live by
 * plan 03-06's lil-gui panel exactly like the surface table is.
 */
export interface CameraTuning {
  framing: {
    /** m/s. Below this speed, framing holds at its `low*` values. `[ASSUMED]` — corrected in plan 03-11's go/no-go playtest. */
    lowSpeedMs: number;
    /**
     * m/s. At or above this speed, framing holds at its `high*` values.
     * Aligned to the speedometer's existing 120 mph amber transition
     * (`REDLINE_MPH`, `src/hud/speedometer.ts`) so the camera stops
     * changing at the same speed the gauge changes colour. `[ASSUMED]`.
     */
    highSpeedMs: number;
    /** Metres. Camera height above the target at `lowSpeedMs`. `[ASSUMED]`. */
    lowAltitudeM: number;
    /** Metres. Camera follow distance behind the target at `lowSpeedMs`. `[ASSUMED]`. */
    lowDistanceM: number;
    /** Degrees. Vertical FOV at `lowSpeedMs`. `[ASSUMED]`. */
    lowFovDeg: number;
    /** Metres. Camera height above the target at `highSpeedMs`. `[ASSUMED]`. */
    highAltitudeM: number;
    /** Metres. Camera follow distance behind the target at `highSpeedMs`. `[ASSUMED]`. */
    highDistanceM: number;
    /**
     * Degrees. Vertical FOV at `highSpeedMs`. `[ASSUMED]`. Together with
     * the other seven `framing` leaves above, this gives a 7.0 degree FOV
     * and 22.5 m altitude separation between 60 mph (26.82 m/s) and 110 mph
     * (49.17 m/s) on `framingForSpeed`, and holds the pitch
     * (`atan(altitudeM/distanceM)`) at a CONSTANT ~79.9 degrees across the
     * entire speed range — `lowAltitudeM`/`lowDistanceM` and
     * `highAltitudeM`/`highDistanceM` are exact multiples of the same 45:8
     * ratio, so linear interpolation never drifts the pitch even between the
     * two ends. This is the near-overhead "news helicopter" framing: the
     * point is area/route visibility, not a chase-cam angle — the shipped
     * SC4 separation proof, asserted directly by `tests/camera-tuning.test.ts`.
     * Corrected in plan 03-11's go/no-go playtest, exactly like
     * `rearSideFriction`/`powerOversteerGain`/`bodyRollGain` were in Phase
     * 2's plan 02-10.
     */
    highFovDeg: number;
  };
  damping: {
    /**
     * Per second. `THREE.MathUtils.damp` lambda for camera position.
     *
     * [TUNED live, 260920-sm2]: supersedes the previous `[ASSUMED]` default
     * of 6.0 — this is no longer assumed, it is the product of the
     * developer's own live `?debug` session, exported as JSON via quick task
     * 260920-l94's Export feature. Lowered to 3.3: a lower `positionLambda`
     * means the rig follows the car more loosely (slower to catch up to
     * position changes), a deliberate looser-feeling follow the developer
     * chose by eye.
     */
    positionLambda: number;
    /**
     * Per second. `dampFactor`/slerp lambda for the camera's heading lag —
     * the literal implementation of D-11: the camera's lag behind a
     * changing velocity heading IS this one number, a deliberate output
     * rather than an accident, "like a real chopper pilot tracking a car,
     * not a rigid instant lock".
     *
     * [TUNED live, 260920-sm2]: supersedes the previous `[ASSUMED]` default
     * of 2.5 — this is no longer assumed, it is the product of the
     * developer's own live `?debug` session, exported as JSON via quick task
     * 260920-l94's Export feature. Raised to 4.5: a higher `headingLambda`
     * means the camera tracks a heading change more tightly, which NARROWS
     * — but does not erase — D-11's deliberate chopper-pilot lag described
     * above; the lag is still present, just shorter.
     */
    headingLambda: number;
    /**
     * Per second. `THREE.MathUtils.damp` lambda for altitude/distance/FOV.
     *
     * [TUNED live, 260920-sm2]: supersedes the previous `[ASSUMED]` default
     * of 1.5 — this is no longer assumed, it is the product of the
     * developer's own live `?debug` session, exported as JSON via quick task
     * 260920-l94's Export feature. Raised to 1.9, a modest increase in how
     * quickly the framing (altitude/distance/FOV) settles to its target.
     */
    framingLambda: number;
  };
  heading: {
    /** m/s. Passed straight through to `blendedHeadingRad`'s `blendSpeedMs` parameter. `[ASSUMED]`. */
    blendSpeedMs: number;
  };
  occlusion: {
    /** Metres. `classifyOcclusion`'s near-target margin — see that function's doc comment. `[ASSUMED]`. */
    nearTargetMarginM: number;
    /**
     * 0..1. The low-but-non-zero opacity floor an occluded building fades
     * to — a fully-invisible building removes spatial context
     * (03-RESEARCH.md's explicit "low but non-zero floor"). `[ASSUMED]`.
     */
    fadeFloorOpacity: number;
    /** Per second. Damping lambda for the fade-opacity mitigation. `[ASSUMED]`. */
    fadeLambda: number;
    /**
     * Degrees. The rig's baseline (non-steepened) pitch. `[ASSUMED]`. Kept
     * aligned to `framing`'s geometric pitch (`atan(altitudeM/distanceM)`,
     * ~79.9 deg) — see that field's own doc comment. A few tenths of a
     * degree of drift between this constant and the framing geometry is
     * expected and negligible, exactly as it was at the old ~41 deg baseline.
     */
    basePitchDeg: number;
    /**
     * Degrees. The steepen mitigation's near-overhead pitch ceiling.
     * `[ASSUMED]`. Must stay above `basePitchDeg` — now that the baseline
     * itself is near-overhead, this is the last few degrees toward vertical,
     * not the large swing it was at the old ~41 deg baseline.
     */
    maxPitchDeg: number;
    /** Count. Number of rays in the steepen mitigation's occlusion-density fan. `[ASSUMED]`. */
    fanRayCount: number;
  };
  chaseFallback: {
    /**
     * Metres. D-12's fallback rig's fixed altitude above the target. MUST
     * MATCH `src/main.ts`'s existing `CHASE_OFFSET.y` and
     * `src/render/renderer.ts`'s `FOV_DEG`, so selecting the fallback
     * reproduces the exact view plan 02-10's feel session was signed off
     * through.
     */
    altitudeM: number;
    /** Metres. D-12's fallback rig's fixed distance behind the target. MUST MATCH `src/main.ts`'s `CHASE_OFFSET`. */
    distanceM: number;
    /** Degrees. D-12's fallback rig's fixed FOV. MUST MATCH `src/render/renderer.ts`'s `FOV_DEG`. */
    fovDeg: number;
  };
}

/**
 * A fresh, independent `CameraTuning` object literal — a FACTORY, never a
 * shared module-level singleton, mirroring `defaultSurfaceProfiles()`'s own
 * rationale: a caller mutating one call's result must never corrupt
 * another's.
 *
 * Every value below is `[ASSUMED]` — a starting point, not a locked
 * decision. Plan 03-11's go/no-go playtest is where these get corrected,
 * exactly like `rearSideFriction`/`powerOversteerGain`/`bodyRollGain` were
 * corrected in Phase 2's plan 02-10 feel session.
 *
 * [TUNED live, 260920-sm2]: the three `damping` leaves below
 * (`positionLambda`, `headingLambda`, `framingLambda`) are no longer
 * `[ASSUMED]` — carve them out of the blanket claim above. They are now the
 * product of the developer's own live `?debug` session (exported as JSON
 * via quick task 260920-l94's Export feature), not an automated sweep. See
 * the `damping` block below for why the REST of that same export was
 * deliberately not applied.
 */
export function defaultCameraTuning(): CameraTuning {
  return {
    framing: {
      // 20 mph.
      lowSpeedMs: 8.94,
      // 120 mph — aligned to the speedometer's existing amber transition
      // (REDLINE_MPH) so the camera stops changing where the gauge changes
      // colour.
      highSpeedMs: 53.64,
      // 45:8 pitch ratio (atan(45/8) ~= 79.9 deg) — near-overhead, held
      // constant through `highAltitudeM`/`highDistanceM` below being an
      // exact 2x multiple of this pair. See the `highFovDeg` doc comment on
      // `CameraTuning` above for the full arithmetic.
      lowAltitudeM: 45,
      lowDistanceM: 8,
      lowFovDeg: 48,
      highAltitudeM: 90,
      highDistanceM: 16,
      highFovDeg: 62,
    },
    // [TUNED live, 260920-sm2]: these three damping leaves come from the
    // developer's own live `?debug` session, exported as JSON via quick task
    // 260920-l94's Export feature. That SAME export also contained new
    // `framing.*AltitudeM`/`*DistanceM`/`*FovDeg`/`*SpeedMs` values, which
    // were DELIBERATELY NOT applied here — see `CameraTuning.framing`'s
    // `highFovDeg` doc comment above: `lowAltitudeM`/`lowDistanceM` (45:8)
    // and `highAltitudeM`/`highDistanceM` (90:16) are exact multiples of the
    // same ratio, which is what holds the geometric pitch CONSTANT at
    // ~79.9deg across the whole speed range, a design invariant from quick
    // task 260919-cam that is asserted directly by
    // `tests/camera-tuning.test.ts`. Applying the exported framing values
    // wholesale would have broken that invariant. The developer chose to
    // keep the shipped framing geometry and only take the damping numbers
    // from this export. DO NOT "helpfully" apply the remaining framing
    // fields from the same exported JSON without re-reading this decision.
    damping: {
      positionLambda: 3.3,
      // The literal implementation of D-11 — see the field's doc comment.
      headingLambda: 4.5,
      framingLambda: 1.9,
    },
    heading: {
      blendSpeedMs: 1.5,
    },
    occlusion: {
      nearTargetMarginM: 2.0,
      fadeFloorOpacity: 0.15,
      fadeLambda: 8.0,
      basePitchDeg: 80,
      maxPitchDeg: 88,
      fanRayCount: 5,
    },
    chaseFallback: {
      // MUST MATCH src/main.ts's existing CHASE_OFFSET = { x: 0, y: 8, z: 16 }
      // and src/render/renderer.ts's FOV_DEG = 55, so selecting the D-12
      // fallback reproduces the exact view plan 02-10's feel session was
      // signed off through.
      altitudeM: 8,
      distanceM: 16,
      fovDeg: 55,
    },
  };
}

/**
 * Per-leaf legal ranges, mirroring `CameraTuning`'s exact shape — the same
 * table backs both a future lil-gui slider (plan 03-06) and the load-time
 * clamp below, so the two can never drift apart (mirrors
 * `SURFACE_PROFILE_RANGES`'s rationale).
 *
 * `fadeFloorOpacity`'s minimum (0.05) and every `*Lambda`'s minimum (0.2)
 * are both strictly greater than zero — see `CameraTuning`'s own field doc
 * comments (and T-03-11) for why a zero floor/lambda would be a Denial of
 * Service, not merely an unhelpful tuning value.
 */
export const CAMERA_TUNING_RANGES: {
  framing: {
    lowSpeedMs: TuningRange;
    highSpeedMs: TuningRange;
    lowAltitudeM: TuningRange;
    lowDistanceM: TuningRange;
    lowFovDeg: TuningRange;
    highAltitudeM: TuningRange;
    highDistanceM: TuningRange;
    highFovDeg: TuningRange;
  };
  damping: {
    positionLambda: TuningRange;
    headingLambda: TuningRange;
    framingLambda: TuningRange;
  };
  heading: {
    blendSpeedMs: TuningRange;
  };
  occlusion: {
    nearTargetMarginM: TuningRange;
    fadeFloorOpacity: TuningRange;
    fadeLambda: TuningRange;
    basePitchDeg: TuningRange;
    maxPitchDeg: TuningRange;
    fanRayCount: TuningRange;
  };
  chaseFallback: {
    altitudeM: TuningRange;
    distanceM: TuningRange;
    fovDeg: TuningRange;
  };
} = {
  framing: {
    lowSpeedMs: { min: 0, max: 80, step: 0.5 },
    highSpeedMs: { min: 0, max: 80, step: 0.5 },
    lowAltitudeM: { min: 3, max: 120, step: 0.5 },
    lowDistanceM: { min: 3, max: 80, step: 0.5 },
    lowFovDeg: { min: 25, max: 100, step: 1 },
    highAltitudeM: { min: 3, max: 120, step: 0.5 },
    highDistanceM: { min: 3, max: 80, step: 0.5 },
    highFovDeg: { min: 25, max: 100, step: 1 },
  },
  damping: {
    positionLambda: { min: 0.2, max: 20, step: 0.1 },
    headingLambda: { min: 0.2, max: 20, step: 0.1 },
    framingLambda: { min: 0.2, max: 20, step: 0.1 },
  },
  heading: {
    blendSpeedMs: { min: 0.1, max: 10, step: 0.1 },
  },
  occlusion: {
    nearTargetMarginM: { min: 0, max: 10, step: 0.1 },
    fadeFloorOpacity: { min: 0.05, max: 0.6, step: 0.01 },
    fadeLambda: { min: 0.2, max: 20, step: 0.1 },
    basePitchDeg: { min: 10, max: 89, step: 1 },
    maxPitchDeg: { min: 10, max: 89, step: 1 },
    fanRayCount: { min: 1, max: 9, step: 1 },
  },
  chaseFallback: {
    altitudeM: { min: 3, max: 80, step: 0.5 },
    distanceM: { min: 3, max: 80, step: 0.5 },
    fovDeg: { min: 25, max: 100, step: 1 },
  },
};

/**
 * ASVS V5 (Input Validation) control, half one of two (T-03-05, T-03-11).
 * Walks `CAMERA_TUNING_RANGES` recursively and clamps every numeric leaf of
 * `t` to its legal range, substituting the matching `defaultCameraTuning()`
 * value for anything that is not a finite number. This is the control that
 * stops a `NaN`/`Infinity`/absurd FOV or a zero damping lambda from ever
 * reaching `camera.fov` + `updateProjectionMatrix()`, where it would blank
 * the canvas or freeze the rig permanently with no console error. Delegates
 * to the shared `clampNode` from `./tuning-utils` — never a second
 * hand-rolled clamp pipeline (T-03-03). Mutates `t` in place and returns the
 * same object reference for convenient chaining.
 */
export function clampCameraTuning(t: CameraTuning): CameraTuning {
  const fallback = defaultCameraTuning() as unknown as Record<string, unknown>;
  clampNode(
    t as unknown as Record<string, unknown>,
    CAMERA_TUNING_RANGES as unknown as Record<string, unknown>,
    fallback,
  );
  return t;
}

/**
 * The `localStorage` key this module's saved camera-tuning blob lives
 * under. Its own dedicated key — never merged into `TUNING_STORAGE_KEY`'s
 * vehicle blob or `SURFACE_TUNING_STORAGE_KEY`'s surface blob, so all three
 * domains can be read/written/cleared independently.
 */
export const CAMERA_TUNING_STORAGE_KEY = "heat-street.camera-tuning.v1";

/** The five required top-level group keys of a `CameraTuning` object. */
const REQUIRED_GROUP_KEYS = [
  "framing",
  "damping",
  "heading",
  "occlusion",
  "chaseFallback",
] as const;

/**
 * ASVS V5 (Input Validation) control, half two of two (T-03-01). Parses a
 * raw `localStorage` string into a fully-validated `CameraTuning`, or
 * `null` if the input cannot be trusted even partially. Mirrors
 * `parseSavedSurfaceProfiles`/`parseSavedTuning` exactly: null-guard, a
 * try/catch `JSON.parse` that never rethrows, an `isPlainObject` guard, a
 * required-keys guard over the five top-level groups, then `copyLeaves`
 * onto a fresh `defaultCameraTuning()`, then `clampCameraTuning`. Never
 * throws for any string input.
 */
export function parseSavedCameraTuning(raw: string | null): CameraTuning | null {
  if (raw === null) {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  if (!isPlainObject(parsed)) {
    return null;
  }

  for (const groupKey of REQUIRED_GROUP_KEYS) {
    if (!(groupKey in parsed)) {
      return null;
    }
  }

  const result = defaultCameraTuning();
  copyLeaves(
    parsed,
    result as unknown as Record<string, unknown>,
    CAMERA_TUNING_RANGES as unknown as Record<string, unknown>,
  );
  clampCameraTuning(result);
  return result;
}

/**
 * Serializes a `CameraTuning` for persistence under
 * `CAMERA_TUNING_STORAGE_KEY`. Persists the plain object directly, same
 * rationale as `serializeTuning`/`serializeSurfaceProfiles`'s own doc
 * comments: keeps the validation path pure and Node-testable, with no
 * lil-gui-format coupling.
 */
export function serializeCameraTuning(t: CameraTuning): string {
  return JSON.stringify(t);
}
