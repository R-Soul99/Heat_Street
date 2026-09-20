/**
 * A pure, DOM-free three-domain tuning snapshot envelope: bundles the current
 * `VehicleTuning` + `SurfaceProfiles` + `CameraTuning` into one exportable
 * JSON artifact, and parses one back — for the live `?debug` tuning panel's
 * Export/Import controls (`src/debug/tuning-panel.ts`).
 *
 * SECURITY BOUNDARY, the whole point of this module: `parseTuningSnapshot`
 * NEVER hand-reads a leaf off the parsed envelope and NEVER runs a second
 * clamp pipeline. Each of the three domains is re-stringified and handed to
 * that domain's OWN existing, already-hardened parser — `parseSavedTuning`,
 * `parseSavedSurfaceProfiles`, `parseSavedCameraTuning` — the exact same
 * required-keys / `copyLeaves` / `clamp*` pipeline the `localStorage` round
 * trip already uses. An imported file is untrusted input on exactly the same
 * footing as the `localStorage` blob those functions already guard: a NaN
 * mass or an Infinity friction value reaching `world.step()` corrupts every
 * body in the world, not just the vehicle's. This module therefore adds ZERO
 * new validation surface — do not add a second clamp pipeline here, do not
 * call `clampNode`/`copyLeaves` directly, and do not read leaves off the
 * parsed envelope by hand.
 *
 * PER-DOMAIN INDEPENDENCE, deliberately NOT all-or-nothing: this mirrors the
 * shipped three-separate-`localStorage`-keys rationale already commented in
 * `src/debug/tuning-panel.ts` (D-17) — three small writes, one per domain, so
 * a corrupt camera blob can never take the vehicle tuning down with it. Here,
 * an envelope carrying a valid `vehicle` and a garbage `camera` still returns
 * a usable snapshot: `vehicle` populated, `camera` `null`. The caller applies
 * only the domains that came back non-`null`.
 *
 * VERSIONING: `TUNING_SNAPSHOT_VERSION` is recorded in every exported file but
 * not acted on beyond that — there is exactly one version today. A future
 * version bump's migration logic belongs HERE, in `parseTuningSnapshot`, not
 * at the call site in `src/debug/tuning-panel.ts`.
 *
 * Pure by construction: no renderer, no physics engine, no DOM, no wall
 * clock. `tests/layering.test.ts` mechanically enforces this for every file
 * under `src/core/` — no `from "three"`, no `from "@dimforge/rapier3d"`, no
 * `document.`, `window.`, `performance.` or `requestAnimationFrame`.
 */

import { type CameraTuning, parseSavedCameraTuning, serializeCameraTuning } from "./camera-tuning";
import {
  parseSavedSurfaceProfiles,
  type SurfaceProfiles,
  serializeSurfaceProfiles,
} from "./surface-tuning";
import { isPlainObject } from "./tuning-utils";
import { parseSavedTuning, serializeTuning, type VehicleTuning } from "./vehicle-tuning";

/** Identifies this file as a Heat Street tuning snapshot, distinct from any
 * of the three single-domain `localStorage` blobs. */
export const TUNING_SNAPSHOT_KIND = "heat-street.tuning-snapshot";

/** There is exactly one version today. See the module doc comment above for
 * where a future migration would live. */
export const TUNING_SNAPSHOT_VERSION = 1;

/** The three tuning domains, independently nullable — see the module doc
 * comment's "PER-DOMAIN INDEPENDENCE" section. */
export interface TuningSnapshot {
  vehicle: VehicleTuning | null;
  surfaces: SurfaceProfiles | null;
  camera: CameraTuning | null;
}

/**
 * Builds the exportable envelope. Pretty-printed (`JSON.stringify(…, null,
 * 2)`), deliberately unlike the three compact `localStorage` serializers —
 * this artifact is meant to be opened, diffed and hand-edited by the
 * developer, not just round-tripped silently.
 *
 * Each domain value is built by calling that domain's OWN existing
 * `serializeX` and parsing the result back in, so the exported shape is
 * guaranteed identical to what each domain already persists — never
 * hand-derived from the tuning objects' fields directly.
 */
export function serializeTuningSnapshot(
  tuning: VehicleTuning,
  surfaces: SurfaceProfiles,
  cameraTuning: CameraTuning,
): string {
  const envelope = {
    kind: TUNING_SNAPSHOT_KIND,
    version: TUNING_SNAPSHOT_VERSION,
    vehicle: JSON.parse(serializeTuning(tuning)),
    surfaces: JSON.parse(serializeSurfaceProfiles(surfaces)),
    camera: JSON.parse(serializeCameraTuning(cameraTuning)),
  };
  return JSON.stringify(envelope, null, 2);
}

/**
 * The security boundary. NEVER throws for any string input. Order: null
 * guard; a try/catch `JSON.parse` that never rethrows; an `isPlainObject`
 * guard (shared with every other `parseSavedX`, never a hand-rolled second type
 * guard); a `kind` guard; then, independently for each of the three domains,
 * `JSON.stringify` the raw field back out and hand it to that domain's own
 * validated parser. Returns `null` only when all three domains came back
 * `null` — an envelope yielding nothing is not a usable snapshot.
 */
export function parseTuningSnapshot(raw: string | null): TuningSnapshot | null {
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

  if (parsed.kind !== TUNING_SNAPSHOT_KIND) {
    return null;
  }

  // Re-stringify-and-delegate: this is the whole point of this module (see
  // the module doc comment's SECURITY BOUNDARY section). Each domain is
  // handed, as a fresh JSON string, to the SAME parser that already guards
  // the `localStorage` round trip — no leaf here is ever read by hand.
  const vehicle = "vehicle" in parsed ? parseSavedTuning(JSON.stringify(parsed.vehicle)) : null;
  const surfaces =
    "surfaces" in parsed ? parseSavedSurfaceProfiles(JSON.stringify(parsed.surfaces)) : null;
  const camera = "camera" in parsed ? parseSavedCameraTuning(JSON.stringify(parsed.camera)) : null;

  if (vehicle === null && surfaces === null && camera === null) {
    return null;
  }

  return { vehicle, surfaces, camera };
}
