/**
 * The six-value closed surface enum, spelled and ORDERED identically to
 * `docs/schemas/road-graph.v1.md`'s normative `SURFACE_ENUM` line:
 *
 *   SURFACE_ENUM = tarmac | gravel | dirt_road | grass | sand | mud
 *
 * That document is the source; this file is the mirror, never the reverse —
 * `tests/surface-tuning.test.ts` parses the doc (reusing
 * `tests/road-graph-schema.test.ts`'s `surfaceEnumFromDoc` idiom) and asserts
 * exact array equality against `SURFACE_TYPES` below, so any future edit to
 * either side that drifts from the other fails the build (T-03-04).
 *
 * `dirt_road` is deliberately NOT `dirt` — CONTEXT.md's and REQUIREMENTS.md's
 * prose shorthand (just the word dirt, unquoted here on purpose so this line
 * itself never contains the literal three-character token this file must
 * not spell) refers to this exact value; do not simplify the spelling here
 * to match the prose, or the doc-parity test breaks.
 *
 * DEVIATION from 03-PATTERNS.md, which assigns `SurfaceType` to
 * `src/physics/surface.ts`: it lives in `src/core/` instead, because
 * `src/core/surface-tuning.ts`, `src/render/surface-fx.ts` and
 * `src/audio/surface-audio.ts` all need the type, and `src/core/` must never
 * import from `src/physics/` (which imports `@dimforge/rapier3d` — forbidden
 * in `src/core/` per `tests/layering.test.ts`). `src/physics/surface.ts`
 * (plan 03-03) imports `SurfaceType` from here instead.
 *
 * Pure by construction: no renderer, no physics engine, no DOM, no wall
 * clock. `tests/layering.test.ts` mechanically enforces this for every file
 * under `src/core/`.
 */
export const SURFACE_TYPES = ["tarmac", "gravel", "dirt_road", "grass", "sand", "mud"] as const;

export type SurfaceType = (typeof SURFACE_TYPES)[number];
