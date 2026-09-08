/**
 * Double-buffered rigid-body transforms for render interpolation.
 *
 * Rapier exposes no interpolated or predicted transform for dynamic bodies:
 * `translation()` and `rotation()` return the post-step state only, and
 * `nextTranslation()` / `nextRotation()` are the KINEMATIC target set via
 * `setNextKinematic*`, meaningless for dynamic bodies. So both ends of the
 * interpolation have to be cached here. See 01-RESEARCH.md "Pitfall 4".
 *
 * Placement decision (01-PATTERNS.md, "src/render/interpolator.ts"): this class
 * exposes its raw buffers and does NOT apply transforms to meshes. That keeps
 * `src/physics/` free of any `three` import, matching the `src/core/` purity rule.
 * `src/render/interpolator.ts` (plan 01-05) reads `prev` and `cur` and does the
 * lerp/slerp.
 *
 * Layering: may import `@dimforge/rapier3d` and `src/core/`. Must not import
 * `three` and must not touch the DOM or any wall clock.
 */
import type * as RAPIER from "@dimforge/rapier3d";

/**
 * Floats per body: px, py, pz, qx, qy, qz, qw.
 *
 * Flat typed arrays keyed by a dense body index rather than an array of objects.
 * Phase 1 has seven bodies and would not notice the difference; Phase 7 and 8
 * pursuer counts are the reason to commit to this shape now (01-RESEARCH.md
 * Pattern 4), because changing the storage layout once the render layer, the
 * profiler and the AI all read it is a far larger edit than writing it this way
 * on day one.
 */
export const XFORM_STRIDE = 7;

export class TransformCache {
  /** Transforms as of the tick BEFORE the most recent `world.step()`. */
  readonly prev: Float64Array;

  /** Transforms as of the most recent `world.step()`. */
  readonly cur: Float64Array;

  /** Number of bodies tracked. Buffer length is this times `XFORM_STRIDE`. */
  readonly length: number;

  private readonly bodies: readonly RAPIER.RigidBody[];

  constructor(bodies: readonly RAPIER.RigidBody[]) {
    this.bodies = bodies;
    this.length = bodies.length;
    this.prev = new Float64Array(bodies.length * XFORM_STRIDE);
    this.cur = new Float64Array(bodies.length * XFORM_STRIDE);
    // Prime both buffers so the very first rendered frame interpolates between
    // two real transforms rather than lerping out of a buffer full of zeros.
    this.captureAsCurrent();
    this.prev.set(this.cur);
  }

  /**
   * Roll `cur` into `prev`. Called immediately BEFORE `world.step()`.
   *
   * This is a buffer copy, never a re-read from Rapier. Re-reading here would
   * make `prev` and `cur` identical every frame and interpolation a no-op;
   * swapping the two capture calls runs the render one tick behind the
   * simulation. Neither failure throws, which is why
   * `tests/transform-cache.test.ts` asserts the pre-mutation value explicitly.
   */
  captureAsPrevious(): void {
    this.prev.set(this.cur);
  }

  /**
   * Re-read every body from Rapier into `cur`. Called immediately AFTER
   * `world.step()`. Writes in place — no allocation, so this is safe to call at
   * up to `MAX_STEPS_PER_FRAME` times per frame forever.
   */
  captureAsCurrent(): void {
    for (let i = 0; i < this.bodies.length; i++) {
      const body = this.bodies[i];
      const o = i * XFORM_STRIDE;
      // Rapier returns a `Vector {x,y,z}` and a `Rotation {x,y,z,w}`.
      const t = body.translation();
      const r = body.rotation();
      this.cur[o] = t.x;
      this.cur[o + 1] = t.y;
      this.cur[o + 2] = t.z;
      this.cur[o + 3] = r.x;
      this.cur[o + 4] = r.y;
      this.cur[o + 5] = r.z;
      this.cur[o + 6] = r.w;
    }
  }
}
