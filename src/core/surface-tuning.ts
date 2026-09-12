/**
 * Per-surface grip multipliers: the shape, measured/assumed default values,
 * per-field legal range, and the pure parse/clamp functions that make a
 * user-editable `localStorage` blob safe to feed into Rapier's per-wheel
 * friction setters (plan 03-02/03-03).
 *
 * Structural analog of `src/core/vehicle-tuning.ts` — same
 * `defaultX()`/`X_RANGES`/`clampX`/`parseSavedX`/`serializeX` shape, sharing
 * its generic clamp/copy machinery from `./tuning-utils` rather than
 * re-implementing it (03-RESEARCH.md's "Don't Hand-Roll" section; T-03-03).
 *
 * Pure by construction: no renderer, no physics engine, no DOM, no wall
 * clock. `tests/layering.test.ts` mechanically enforces this for every file
 * under `src/core/`.
 */

import { SURFACE_TYPES, type SurfaceType } from "./surface-types";
import { clampNode, copyLeaves, isPlainObject, type TuningRange } from "./tuning-utils";

/** One surface's grip multipliers, applied on two independent axes rather
 * than one scalar — forward traction and lateral (cornering) grip degrade at
 * different rates per surface (03-RESEARCH.md "Surface Grip Ranking"). */
export interface SurfaceProfile {
  forwardGrip: number;
  lateralGrip: number;
}

/** The full per-surface grip table, one `SurfaceProfile` per `SurfaceType`. */
export type SurfaceProfiles = { [K in SurfaceType]: SurfaceProfile };

/**
 * A fresh, independent `SurfaceProfiles` object literal — a FACTORY, never a
 * shared module-level singleton, mirroring `defaultTuning()`'s own rationale:
 * a caller mutating one call's result must never corrupt another's.
 *
 * Values are 03-RESEARCH.md's "Surface Grip Ranking" table, verbatim. This is
 * a STARTING POINT, not a locked decision (CONTEXT.md D-05) — retune in plan
 * 03-11's feel session, exactly like `rearSideFriction`/`powerOversteerGain`/
 * `bodyRollGain` were in Phase 2's plan 02-10.
 */
export function defaultSurfaceProfiles(): SurfaceProfiles {
  return {
    /**
     * Baseline — matches the existing tuned default
     * (`frictionSlip: 1.2`, `frontSideFriction: 1.0`) exactly, so tarmac
     * driving is byte-for-byte unchanged from Phase 2.
     */
    tarmac: { forwardGrip: 1.0, lateralGrip: 1.0 },
    /**
     * `[CITED: hpwizard.com/tire-friction-coefficient.html]` — real-world peak
     * mu ratio to asphalt is ~0.67 (0.60/0.90), so forwardGrip 0.75 is
     * well-grounded. lateralGrip is deliberately pushed LOWER than that
     * real-world ratio would suggest: this is the D-05 anchor — gravel needs
     * a pronounced, dramatic slide, which only emerges if lateral grip is cut
     * more aggressively than forward grip. Retune in plan 03-11's feel
     * session, exactly like rearSideFriction/powerOversteerGain/bodyRollGain
     * were in Phase 2's plan 02-10.
     */
    gravel: { forwardGrip: 0.75, lateralGrip: 0.55 },
    /**
     * `[CITED: hpwizard.com/tire-friction-coefficient.html]` — real-world dry
     * earth-road peak mu ratio to asphalt is ~0.76-0.85, so forwardGrip 0.78
     * sits in that band. lateralGrip shares gravel's aggressive D-05 cut —
     * dirt_road and gravel are the two surfaces the D-05 anchor names
     * together for a dramatic power-slide character. Retune in plan 03-11's
     * feel session, exactly like rearSideFriction/powerOversteerGain/
     * bodyRollGain were in Phase 2's plan 02-10.
     */
    dirt_road: { forwardGrip: 0.78, lateralGrip: 0.55 },
    /**
     * `[ASSUMED]` — grass is conventionally treated as looser than
     * dirt/gravel in driving games but with less dramatic power-slide
     * character (more "washes out" than "slides"), hence lateralGrip is not
     * pushed as low as gravel/dirt_road despite a lower forwardGrip. Retune
     * in plan 03-11's feel session, exactly like rearSideFriction/
     * powerOversteerGain/bodyRollGain were in Phase 2's plan 02-10.
     */
    grass: { forwardGrip: 0.55, lateralGrip: 0.6 },
    /**
     * `[ASSUMED]` — loose sand's real rolling-resistance figures (0.2-0.4)
     * suggest heavy forward drag; D-04 requires "noticeably slippery but
     * controllable," so forwardGrip is cut meaningfully but not so far the
     * car bogs down, and lateralGrip is kept close to gravel's since sand
     * sliding reads similarly on camera. Retune in plan 03-11's feel session,
     * exactly like rearSideFriction/powerOversteerGain/bodyRollGain were in
     * Phase 2's plan 02-10.
     */
    sand: { forwardGrip: 0.45, lateralGrip: 0.55 },
    /**
     * `[ASSUMED]` — the loosest surface per D-04's explicit ranking intent
     * ("loosest surfaces (mud, sand)"), floored well above zero so the car
     * never becomes genuinely undriveable, matching D-04's "stays
     * controllable" requirement. Retune in plan 03-11's feel session, exactly
     * like rearSideFriction/powerOversteerGain/bodyRollGain were in Phase 2's
     * plan 02-10.
     */
    mud: { forwardGrip: 0.4, lateralGrip: 0.5 },
  };
}

/**
 * Per-leaf legal ranges, mirroring `SurfaceProfiles`' exact shape — the same
 * table backs both a future lil-gui slider (plan 03-11) and the load-time
 * clamp below, so the two can never drift apart (mirrors
 * `vehicle-tuning.ts`'s `TUNING_RANGES` rationale).
 *
 * Every leaf uses `{ min: 0.2, max: 1.2, step: 0.01 }`: the floor is
 * deliberately 0.2 rather than 0 because D-04 rules out surfaces that can bog
 * the car down — `handbrakeRearSideFriction`'s own doc comment in
 * `vehicle-tuning.ts` already warns what a near-zero side-friction value
 * does — and the ceiling sits above 1.0 so a feel session can try a
 * grippier-than-tarmac surface without a code edit.
 */
export const SURFACE_PROFILE_RANGES: {
  [K in SurfaceType]: { forwardGrip: TuningRange; lateralGrip: TuningRange };
} = {
  tarmac: {
    forwardGrip: { min: 0.2, max: 1.2, step: 0.01 },
    lateralGrip: { min: 0.2, max: 1.2, step: 0.01 },
  },
  gravel: {
    forwardGrip: { min: 0.2, max: 1.2, step: 0.01 },
    lateralGrip: { min: 0.2, max: 1.2, step: 0.01 },
  },
  dirt_road: {
    forwardGrip: { min: 0.2, max: 1.2, step: 0.01 },
    lateralGrip: { min: 0.2, max: 1.2, step: 0.01 },
  },
  grass: {
    forwardGrip: { min: 0.2, max: 1.2, step: 0.01 },
    lateralGrip: { min: 0.2, max: 1.2, step: 0.01 },
  },
  sand: {
    forwardGrip: { min: 0.2, max: 1.2, step: 0.01 },
    lateralGrip: { min: 0.2, max: 1.2, step: 0.01 },
  },
  mud: {
    forwardGrip: { min: 0.2, max: 1.2, step: 0.01 },
    lateralGrip: { min: 0.2, max: 1.2, step: 0.01 },
  },
};

/**
 * ASVS V5 (Input Validation) control, half one of two (T-03-02). Walks
 * `SURFACE_PROFILE_RANGES` recursively and clamps every numeric leaf of `p`
 * to its legal range, substituting the matching `defaultSurfaceProfiles()`
 * value for anything that is not a finite number. This is the control that
 * stops a `NaN` or absurd multiplier from ever reaching
 * `setWheelFrictionSlip`/`setWheelSideFrictionStiffness` (plan 03-03), where
 * it would corrupt every body in `world.step()`, not just this vehicle —
 * exactly the reasoning `clampTuning`'s own doc comment already records.
 * Delegates to the shared `clampNode` from `./tuning-utils` — never a second
 * hand-rolled clamp pipeline (T-03-03). Mutates `p` in place and returns the
 * same object reference for convenient chaining.
 */
export function clampSurfaceProfiles(p: SurfaceProfiles): SurfaceProfiles {
  const fallback = defaultSurfaceProfiles() as unknown as Record<string, unknown>;
  clampNode(
    p as unknown as Record<string, unknown>,
    SURFACE_PROFILE_RANGES as unknown as Record<string, unknown>,
    fallback,
  );
  return p;
}

/**
 * The `localStorage` key this module's saved surface-tuning blob lives under.
 * Its own dedicated key — never merged into `TUNING_STORAGE_KEY`'s vehicle
 * blob, so the two domains can be read/written/cleared independently.
 */
export const SURFACE_TUNING_STORAGE_KEY = "heat-street.surface-tuning.v1";

/**
 * ASVS V5 (Input Validation) control, half two of two (T-03-01). Parses a raw
 * `localStorage` string into a fully-validated `SurfaceProfiles`, or `null`
 * if the input cannot be trusted even partially. Mirrors `parseSavedTuning`
 * exactly: null-guard, a try/catch `JSON.parse` that never rethrows, an
 * `isPlainObject` guard, a required-keys guard over `SURFACE_TYPES` (the
 * analogue of `REQUIRED_GROUP_KEYS`), then `copyLeaves` onto a fresh
 * `defaultSurfaceProfiles()`, then `clampSurfaceProfiles`. Never throws for
 * any string input.
 */
export function parseSavedSurfaceProfiles(raw: string | null): SurfaceProfiles | null {
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

  for (const surface of SURFACE_TYPES) {
    if (!(surface in parsed)) {
      return null;
    }
  }

  const result = defaultSurfaceProfiles();
  copyLeaves(
    parsed,
    result as unknown as Record<string, unknown>,
    SURFACE_PROFILE_RANGES as unknown as Record<string, unknown>,
  );
  clampSurfaceProfiles(result);
  return result;
}

/**
 * Serializes a `SurfaceProfiles` for persistence under
 * `SURFACE_TUNING_STORAGE_KEY`. Persists the plain object directly, same
 * rationale as `serializeTuning`'s own doc comment: keeps the validation path
 * pure and Node-testable, with no lil-gui-format coupling.
 */
export function serializeSurfaceProfiles(p: SurfaceProfiles): string {
  return JSON.stringify(p);
}
