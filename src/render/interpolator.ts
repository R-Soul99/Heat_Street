/**
 * Render interpolation: turn the fixed 60 Hz tick into smooth motion at any
 * refresh rate.
 *
 * Rapier exposes no interpolated transform (01-RESEARCH.md "Pitfall 4"), so both
 * ends of the interpolation are cached by `src/physics/transform-cache.ts` and
 * blended here. On the roughly 60 percent of frames at 144 Hz that run ZERO
 * physics steps, `prev` and `cur` are unchanged and only `alpha` advances — yet
 * the drawn transform still moves. That is the whole mechanism behind SC2: draw
 * `body.translation()` directly instead and you get a 60 Hz stutter inside a
 * 144 Hz presentation.
 *
 * Placement (01-PATTERNS.md, 01-05-PLAN.md "placement_decision"): a free function
 * here rather than a method on `TransformCache`, so `src/physics/` stays free of
 * any `three` import, consistent with the `src/core/` purity rule.
 *
 * Layering: `src/render/` may READ simulation state and must never write it.
 * No stepping, no impulses, no writing a body transform, no mutation of the
 * cache buffers. The dependency is one-way: render reads sim. A write here would
 * make render cadence affect medal times, defeating VEH-03 (threat T-01-15).
 */
import * as THREE from "three";
import { XFORM_STRIDE } from "../physics/transform-cache";

/**
 * Module-scope scratch objects, reused by every call so the interpolator
 * allocates nothing per body per frame. At 7 bodies and 144 Hz that is ~2000
 * avoided allocations a second in Phase 1, and Phase 7's pursuer counts make it
 * matter properly. Not re-entrant, which is fine: there is exactly one render
 * thread and the values are dead the instant `lerp`/`slerp` returns.
 */
const TMP_POSITION = new THREE.Vector3();
const TMP_ROTATION = new THREE.Quaternion();

/**
 * Blend body `index` between its previous and current tick transforms and write
 * the result onto `target`.
 *
 * @param target Object3D to pose. Its `position` and `quaternion` are mutated in
 *   place; neither is ever replaced.
 * @param prev Stride-`XFORM_STRIDE` buffer as of the tick before the last step.
 * @param cur Stride-`XFORM_STRIDE` buffer as of the last step.
 * @param index Dense body index, the same index used by `DebugScene.bodies`.
 * @param alpha Fraction of the way from `prev` to `cur`, clamped into [0, 1].
 */
export function applyInterpolated(
  target: THREE.Object3D,
  prev: Float64Array,
  cur: Float64Array,
  index: number,
  alpha: number,
): void {
  // `SimClock.alpha` already clamps, but this function is exported and must be
  // safe standalone: an alpha above 1 would extrapolate past the current tick
  // and put the mesh somewhere the simulation has never been, which reads as a
  // physics glitch rather than as a caller bug. NaN falls through to 0.
  const t = alpha > 0 ? (alpha < 1 ? alpha : 1) : 0;

  const o = index * XFORM_STRIDE;

  // `.set(...)` rather than `.copy(...)`: Rapier's `Vector` and `Rotation` are
  // structurally compatible with the three types, but relying on that couples
  // this code to `@types/three` internals (01-RESEARCH.md Pattern 4).
  target.position
    .set(prev[o], prev[o + 1], prev[o + 2])
    .lerp(TMP_POSITION.set(cur[o], cur[o + 1], cur[o + 2]), t);

  // Always `THREE.Quaternion.prototype.slerp`, never a hand-rolled one.
  // Shortest-arc and sign-flip handling is where hand-rolled slerps break, and
  // the symptom is a body visibly spinning the long way round once per
  // revolution (01-RESEARCH.md "Don't Hand-Roll").
  target.quaternion
    .set(prev[o + 3], prev[o + 4], prev[o + 5], prev[o + 6])
    .slerp(TMP_ROTATION.set(cur[o + 3], cur[o + 4], cur[o + 5], cur[o + 6]), t);
}

/**
 * Pose every target from the matching entry in the transform cache.
 *
 * Target array index `i` maps onto buffer offset `i * XFORM_STRIDE`. That
 * mapping is the contract between `src/render/debug-scene.ts` and
 * `src/physics/debug-scene.ts`: build meshes in the same dense order as
 * `DebugScene.bodies` or every body draws at another body's transform
 * (threat T-01-16).
 *
 * Takes a structural `{ prev, cur }` rather than the `TransformCache` class so
 * tests can drive it with plain buffers, and so `src/render/` needs no class
 * import from `src/physics/` beyond the stride constant.
 */
export function applyAllInterpolated(
  targets: readonly THREE.Object3D[],
  cache: { prev: Float64Array; cur: Float64Array },
  alpha: number,
): void {
  for (let i = 0; i < targets.length; i++) {
    applyInterpolated(targets[i], cache.prev, cache.cur, i, alpha);
  }
}
