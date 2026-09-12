/**
 * Generic clamp/copy machinery shared by every `localStorage`-persisted
 * tuning object in the project (`src/core/vehicle-tuning.ts`,
 * `src/core/surface-tuning.ts`, and any future tuning domain). Extracted from
 * `vehicle-tuning.ts` verbatim per 03-RESEARCH.md's "Don't Hand-Roll"
 * section: one ASVS V5 input-validation code path for the whole project, not
 * a second (or third) hand-rolled clamp/validate/persist boundary that can
 * silently drift from this one.
 *
 * Pure by construction: no renderer, no physics engine, no DOM, no wall
 * clock. `tests/layering.test.ts` mechanically enforces this for every file
 * under `src/core/` — no `from "three"`, no `from "@dimforge/rapier3d"`, no
 * `document.`, `window.`, `performance.` or `requestAnimationFrame`.
 */

/** One leaf's legal range, shared verbatim by the lil-gui slider bounds (plan
 * 02-09) and the load-time clamp — a single table so the two can never drift
 * apart. */
export interface TuningRange {
  readonly min: number;
  readonly max: number;
  readonly step: number;
}

/** True for a plain, non-null, non-array object — the shape a group node must be. */
export function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** True for a `TuningRange` leaf (as opposed to a nested group of further leaves). */
export function isTuningRange(v: unknown): v is TuningRange {
  return (
    isPlainObject(v) &&
    typeof v.min === "number" &&
    typeof v.max === "number" &&
    typeof v.step === "number"
  );
}

/**
 * Recursively walks `rangeNode` (a subtree of a `TUNING_RANGES`-shaped
 * table), and for every leaf found there, clamps the corresponding value in
 * `valueNode` (the matching subtree of a tuning object) to `[min, max]`. A
 * value that is not a finite number — `NaN`, `Infinity`, `-Infinity`, `null`,
 * a string, a missing key, an object — is replaced with the corresponding
 * value from `fallbackNode` (always a fresh default-tuning subtree) instead
 * of being clamped to `min`, so a hostile blob cannot even influence WHICH
 * boundary it lands on. Mutates `valueNode` in place.
 */
export function clampNode(
  valueNode: Record<string, unknown>,
  rangeNode: Record<string, unknown>,
  fallbackNode: Record<string, unknown>,
): void {
  for (const key of Object.keys(rangeNode)) {
    const rangeEntry = rangeNode[key];
    if (isTuningRange(rangeEntry)) {
      const raw = valueNode[key];
      const fallback = fallbackNode[key];
      const safe = typeof raw === "number" && Number.isFinite(raw) ? raw : (fallback as number);
      valueNode[key] = Math.min(rangeEntry.max, Math.max(rangeEntry.min, safe));
    } else if (isPlainObject(rangeEntry)) {
      const nextValue = isPlainObject(valueNode[key])
        ? (valueNode[key] as Record<string, unknown>)
        : {};
      valueNode[key] = nextValue;
      clampNode(nextValue, rangeEntry, fallbackNode[key] as Record<string, unknown>);
    }
  }
}

/**
 * Recursively copies only the leaves present in `parsedNode` onto
 * `targetNode`, walking the shape described by `rangeNode` (a subtree of a
 * `TUNING_RANGES`-shaped table). A leaf is copied RAW, with no type or range
 * checking at this stage — the caller's own `clampTuning`-equivalent is the
 * single place that sanitizes values, so there is exactly one code path a
 * non-finite or out-of-range number can be fixed by, not two. Group keys
 * that are missing or not a plain object in `parsedNode` are simply skipped,
 * leaving `targetNode`'s existing (default) values in place for that whole
 * subtree.
 */
export function copyLeaves(
  parsedNode: unknown,
  targetNode: Record<string, unknown>,
  rangeNode: Record<string, unknown>,
): void {
  if (!isPlainObject(parsedNode)) {
    return;
  }
  for (const key of Object.keys(rangeNode)) {
    const rangeEntry = rangeNode[key];
    if (!(key in parsedNode)) {
      continue;
    }
    if (isTuningRange(rangeEntry)) {
      targetNode[key] = parsedNode[key];
    } else if (isPlainObject(rangeEntry)) {
      const nextTarget = isPlainObject(targetNode[key])
        ? (targetNode[key] as Record<string, unknown>)
        : {};
      targetNode[key] = nextTarget;
      copyLeaves(parsedNode[key], nextTarget, rangeEntry);
    }
  }
}
