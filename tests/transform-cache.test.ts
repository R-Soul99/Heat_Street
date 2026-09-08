import type * as RAPIER from "@dimforge/rapier3d";
import { beforeEach, describe, expect, it } from "vitest";
import { createDebugScene } from "../src/physics/debug-scene";
import { TransformCache, XFORM_STRIDE } from "../src/physics/transform-cache";
import { createWorld } from "../src/physics/world";

/**
 * `TransformCache` is the render layer's only view of physics state. Rapier
 * exposes no interpolated transform (01-RESEARCH.md "Pitfall 4"), so the previous
 * and current transforms have to be double-buffered by hand, and the ORDER of the
 * two capture calls is the thing most likely to be silently inverted. An inverted
 * cache still renders — it just renders one tick behind reality, which reads as
 * "the physics feels laggy" rather than as a bug in this file.
 */

let world: RAPIER.World;
let bodies: readonly RAPIER.RigidBody[];

beforeEach(() => {
  world = createWorld();
  bodies = createDebugScene(world).bodies;
});

function xform(buf: Float64Array, index: number): number[] {
  const o = index * XFORM_STRIDE;
  return Array.from(buf.subarray(o, o + XFORM_STRIDE));
}

describe("TransformCache", () => {
  it("uses a stride of seven", () => {
    expect(XFORM_STRIDE).toBe(7);
  });

  it("allocates one stride-7 Float64Array pair sized to the body count", () => {
    const cache = new TransformCache(bodies);

    expect(cache.length).toBe(bodies.length);
    expect(cache.prev).toBeInstanceOf(Float64Array);
    expect(cache.cur).toBeInstanceOf(Float64Array);
    expect(cache.prev.length).toBe(bodies.length * XFORM_STRIDE);
    expect(cache.cur.length).toBe(bodies.length * XFORM_STRIDE);
  });

  it("primes both buffers at construction so frame 1 never lerps from zeros", () => {
    const cache = new TransformCache(bodies);

    expect(Array.from(cache.prev)).toEqual(Array.from(cache.cur));
    // Not all zeros — the boxes start spread across x and stacked up y.
    expect(Array.from(cache.cur).some((v) => v !== 0)).toBe(true);
  });

  it("lays each body out as px py pz qx qy qz qw at index * stride", () => {
    for (let i = 0; i < 40; i++) {
      world.step();
    }
    const cache = new TransformCache(bodies);

    for (let i = 0; i < bodies.length; i++) {
      const t = bodies[i].translation();
      const r = bodies[i].rotation();
      // Exact equality, not toBeCloseTo: the cache must copy Rapier's values, not
      // derive anything from them.
      expect(xform(cache.cur, i)).toEqual([t.x, t.y, t.z, r.x, r.y, r.z, r.w]);
    }
  });

  it("round-trips an identity rotation with qw = 1 rather than 0", () => {
    const cache = new TransformCache(bodies);

    for (let i = 0; i < bodies.length; i++) {
      expect(xform(cache.cur, i)[6]).toBe(1);
    }
  });

  it("copies cur into prev on captureAsPrevious without re-reading Rapier", () => {
    const cache = new TransformCache(bodies);

    // Move the body once and capture, so prev and cur genuinely differ. Without
    // this step an inverted `cur.set(prev)` would be indistinguishable.
    bodies[0].setTranslation({ x: 10, y: 5, z: 2 }, true);
    cache.captureAsCurrent();
    const afterFirstMove = xform(cache.cur, 0);
    expect(afterFirstMove.slice(0, 3)).toEqual([10, 5, 2]);

    // Move it again, but capture only as PREVIOUS. prev must become the
    // pre-mutation cur (10, 5, 2), never the live Rapier value (-7, 3, 1).
    bodies[0].setTranslation({ x: -7, y: 3, z: 1 }, true);
    cache.captureAsPrevious();

    expect(xform(cache.prev, 0)).toEqual(afterFirstMove);
    expect(xform(cache.cur, 0)).toEqual(afterFirstMove);
    expect(xform(cache.prev, 0).slice(0, 3)).not.toEqual([-7, 3, 1]);
  });

  it("re-reads every body on captureAsCurrent so a stepped body diverges from prev", () => {
    const cache = new TransformCache(bodies);

    cache.captureAsPrevious();
    world.step();
    cache.captureAsCurrent();

    // The boxes are mid-fall on the first step, so every one of them moved.
    let moved = 0;
    for (let i = 0; i < bodies.length; i++) {
      if (JSON.stringify(xform(cache.cur, i)) !== JSON.stringify(xform(cache.prev, i))) {
        moved++;
      }
    }
    expect(moved).toBeGreaterThan(0);
  });

  it("allocates nothing after construction", () => {
    const cache = new TransformCache(bodies);
    const prevRef = cache.prev;
    const curRef = cache.cur;
    const prevBytes = cache.prev.byteLength;
    const curBytes = cache.cur.byteLength;

    for (let i = 0; i < 1000; i++) {
      cache.captureAsPrevious();
      cache.captureAsCurrent();
    }

    expect(cache.prev).toBe(prevRef);
    expect(cache.cur).toBe(curRef);
    expect(cache.prev.byteLength).toBe(prevBytes);
    expect(cache.cur.byteLength).toBe(curBytes);
  });
});
