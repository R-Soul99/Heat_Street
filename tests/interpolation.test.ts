import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { XFORM_STRIDE } from "../src/physics/transform-cache";
import { applyAllInterpolated, applyInterpolated } from "../src/render/interpolator";
// Source is pulled off disk through Vite's `?raw` transform rather than
// `node:fs`, matching the convention established in `tests/frame-budget.test.ts`
// (no `@types/node`, no new packages — T-01-SC).
import interpolatorSource from "../src/render/interpolator.ts?raw";

/**
 * SC2's proof, runnable in Node with no WebGL context.
 *
 * `THREE.Object3D`, `Vector3` and `Quaternion` are pure maths classes and
 * construct fine outside a browser. Nothing in this file may construct a
 * `WebGLRenderer` — that would drag a GL context into the one suite that is
 * supposed to prove the interpolation maths on its own.
 */

const IDENTITY = new THREE.Quaternion(0, 0, 0, 1);

function makeBuffers(bodyCount: number): { prev: Float64Array; cur: Float64Array } {
  return {
    prev: new Float64Array(bodyCount * XFORM_STRIDE),
    cur: new Float64Array(bodyCount * XFORM_STRIDE),
  };
}

function write(
  buf: Float64Array,
  index: number,
  p: { x: number; y: number; z: number },
  q: { x: number; y: number; z: number; w: number },
): void {
  const o = index * XFORM_STRIDE;
  buf[o] = p.x;
  buf[o + 1] = p.y;
  buf[o + 2] = p.z;
  buf[o + 3] = q.x;
  buf[o + 4] = q.y;
  buf[o + 5] = q.z;
  buf[o + 6] = q.w;
}

/** A rotation of `deg` about +Y. */
function yaw(deg: number): THREE.Quaternion {
  const half = THREE.MathUtils.degToRad(deg) / 2;
  return new THREE.Quaternion(0, Math.sin(half), 0, Math.cos(half));
}

describe("applyInterpolated — endpoint equivalence", () => {
  const { prev, cur } = makeBuffers(1);
  write(prev, 0, { x: -3, y: 1.25, z: 7 }, yaw(20));
  write(cur, 0, { x: 11, y: -4.5, z: 0.5 }, yaw(95));

  it("at alpha 0 sits exactly on the previous tick transform", () => {
    const target = new THREE.Object3D();
    applyInterpolated(target, prev, cur, 0, 0);

    expect(target.position.x).toBeCloseTo(prev[0], 12);
    expect(target.position.y).toBeCloseTo(prev[1], 12);
    expect(target.position.z).toBeCloseTo(prev[2], 12);
    expect(target.quaternion.x).toBeCloseTo(prev[3], 12);
    expect(target.quaternion.y).toBeCloseTo(prev[4], 12);
    expect(target.quaternion.z).toBeCloseTo(prev[5], 12);
    expect(target.quaternion.w).toBeCloseTo(prev[6], 12);
  });

  it("at alpha 1 sits exactly on the current tick transform", () => {
    const target = new THREE.Object3D();
    applyInterpolated(target, prev, cur, 0, 1);

    expect(target.position.x).toBeCloseTo(cur[0], 12);
    expect(target.position.y).toBeCloseTo(cur[1], 12);
    expect(target.position.z).toBeCloseTo(cur[2], 12);
    expect(target.quaternion.x).toBeCloseTo(cur[3], 12);
    expect(target.quaternion.y).toBeCloseTo(cur[4], 12);
    expect(target.quaternion.z).toBeCloseTo(cur[5], 12);
    expect(target.quaternion.w).toBeCloseTo(cur[6], 12);
  });

  it("at alpha 0.5 with a pure translation lands on the arithmetic midpoint", () => {
    const b = makeBuffers(1);
    write(b.prev, 0, { x: 0, y: 2, z: -6 }, IDENTITY);
    write(b.cur, 0, { x: 10, y: 3, z: 6 }, IDENTITY);

    const target = new THREE.Object3D();
    applyInterpolated(target, b.prev, b.cur, 0, 0.5);

    expect(target.position.x).toBeCloseTo(5, 12);
    expect(target.position.y).toBeCloseTo(2.5, 12);
    expect(target.position.z).toBeCloseTo(0, 12);
  });
});

describe("applyInterpolated — rotation takes the short arc", () => {
  it("interpolates 175 degrees as 87.5, not 92.5", () => {
    // `far` and `negated` are the SAME rotation — a quaternion and its negation
    // are the same orientation. But a naive component lerp from identity toward
    // `negated` travels the 185-degree route and lands at 92.5 degrees.
    // `THREE.Quaternion.slerp` flips the sign when the dot product is negative
    // and takes the 175-degree route, landing at 87.5. This test is the guard
    // against anyone replacing `.slerp` with a hand-rolled lerp.
    const far = yaw(175);
    const negated = new THREE.Quaternion(-far.x, -far.y, -far.z, -far.w);

    const { prev, cur } = makeBuffers(1);
    write(prev, 0, { x: 0, y: 0, z: 0 }, IDENTITY);
    write(cur, 0, { x: 0, y: 0, z: 0 }, negated);

    const target = new THREE.Object3D();
    applyInterpolated(target, prev, cur, 0, 0.5);

    const deg = THREE.MathUtils.radToDeg(target.quaternion.angleTo(IDENTITY));
    expect(deg).toBeCloseTo(87.5, 6);
    expect(Math.abs(deg - 92.5)).toBeGreaterThan(1);
  });

  it("keeps the result a unit quaternion", () => {
    const { prev, cur } = makeBuffers(1);
    write(prev, 0, { x: 0, y: 0, z: 0 }, yaw(-140));
    write(cur, 0, { x: 0, y: 0, z: 0 }, yaw(160));

    const target = new THREE.Object3D();
    for (const alpha of [0, 0.13, 0.5, 0.87, 1]) {
      applyInterpolated(target, prev, cur, 0, alpha);
      expect(target.quaternion.length()).toBeCloseTo(1, 12);
    }
  });
});

describe("applyInterpolated — alpha bounds", () => {
  const { prev, cur } = makeBuffers(1);
  write(prev, 0, { x: 0, y: 0, z: 0 }, IDENTITY);
  write(cur, 0, { x: 10, y: 0, z: 0 }, yaw(90));

  it("clamps alpha above 1 rather than extrapolating past cur", () => {
    const target = new THREE.Object3D();
    applyInterpolated(target, prev, cur, 0, 1.5);
    expect(target.position.x).toBeCloseTo(10, 12);
  });

  it("clamps alpha below 0 rather than extrapolating before prev", () => {
    const target = new THREE.Object3D();
    applyInterpolated(target, prev, cur, 0, -0.5);
    expect(target.position.x).toBeCloseTo(0, 12);
  });

  it("advances monotonically across a sweep — the zero-step-frame property", () => {
    // This is precisely what removes judder at 144 Hz: on the ~60 percent of
    // frames that run no physics step, `prev` and `cur` are unchanged and only
    // alpha moves, yet the drawn position must still advance.
    const target = new THREE.Object3D();
    let last = Number.NEGATIVE_INFINITY;
    for (let i = 0; i <= 100; i++) {
      applyInterpolated(target, prev, cur, 0, i / 100);
      expect(target.position.x).toBeGreaterThan(last);
      last = target.position.x;
    }
    expect(last).toBeCloseTo(10, 12);
  });
});

describe("applyInterpolated — allocation", () => {
  it("mutates the target's own vector and quaternion in place over 10000 calls", () => {
    const { prev, cur } = makeBuffers(1);
    write(prev, 0, { x: 0, y: 0, z: 0 }, IDENTITY);
    write(cur, 0, { x: 1, y: 2, z: 3 }, yaw(45));

    const target = new THREE.Object3D();
    const position = target.position;
    const quaternion = target.quaternion;

    for (let i = 0; i < 10000; i++) {
      applyInterpolated(target, prev, cur, 0, i / 10000);
    }

    expect(target.position).toBe(position);
    expect(target.quaternion).toBe(quaternion);
  });

  it("declares its scratch Vector3 and Quaternion once, at module scope", () => {
    const firstFn = interpolatorSource.indexOf("export function");
    expect(firstFn).toBeGreaterThan(-1);

    const vec = interpolatorSource.indexOf("new THREE.Vector3(");
    const quat = interpolatorSource.indexOf("new THREE.Quaternion(");
    expect(vec).toBeGreaterThan(-1);
    expect(quat).toBeGreaterThan(-1);
    expect(vec).toBeLessThan(firstFn);
    expect(quat).toBeLessThan(firstFn);

    const constructions = interpolatorSource.match(/new THREE\.(Vector3|Quaternion)\(/g) ?? [];
    expect(constructions).toHaveLength(2);
  });
});

describe("applyAllInterpolated — index mapping", () => {
  it("maps target i onto buffer offset i * XFORM_STRIDE with no swapping", () => {
    const bodyCount = 3;
    const { prev, cur } = makeBuffers(bodyCount);
    write(prev, 0, { x: 0, y: 0, z: 0 }, yaw(0));
    write(prev, 1, { x: 100, y: 0, z: 0 }, yaw(30));
    write(prev, 2, { x: 200, y: 0, z: 0 }, yaw(60));
    write(cur, 0, { x: 10, y: 0, z: 0 }, yaw(10));
    write(cur, 1, { x: 110, y: 0, z: 0 }, yaw(40));
    write(cur, 2, { x: 210, y: 0, z: 0 }, yaw(70));

    const targets = [new THREE.Object3D(), new THREE.Object3D(), new THREE.Object3D()];
    applyAllInterpolated(targets, { prev, cur }, 0.5);

    // Distinct by 100 metres: any swap moves a target by two orders of magnitude.
    expect(targets[0].position.x).toBeCloseTo(5, 12);
    expect(targets[1].position.x).toBeCloseTo(105, 12);
    expect(targets[2].position.x).toBeCloseTo(205, 12);

    expect(THREE.MathUtils.radToDeg(targets[0].quaternion.angleTo(IDENTITY))).toBeCloseTo(5, 6);
    expect(THREE.MathUtils.radToDeg(targets[1].quaternion.angleTo(IDENTITY))).toBeCloseTo(35, 6);
    expect(THREE.MathUtils.radToDeg(targets[2].quaternion.angleTo(IDENTITY))).toBeCloseTo(65, 6);
  });

  it("agrees with applyInterpolated called per index", () => {
    const bodyCount = 4;
    const { prev, cur } = makeBuffers(bodyCount);
    for (let i = 0; i < bodyCount; i++) {
      write(prev, i, { x: i, y: i * 2, z: -i }, yaw(i * 17));
      write(cur, i, { x: i + 3, y: i * 2 + 1, z: -i - 4 }, yaw(i * 17 + 25));
    }

    const batched = Array.from({ length: bodyCount }, () => new THREE.Object3D());
    applyAllInterpolated(batched, { prev, cur }, 0.37);

    for (let i = 0; i < bodyCount; i++) {
      const single = new THREE.Object3D();
      applyInterpolated(single, prev, cur, i, 0.37);
      expect(batched[i].position.x).toBeCloseTo(single.position.x, 12);
      expect(batched[i].position.y).toBeCloseTo(single.position.y, 12);
      expect(batched[i].position.z).toBeCloseTo(single.position.z, 12);
      // Component-wise, not `angleTo`: `angleTo` is `2 * acos(dot)` and `acos`
      // is catastrophically ill-conditioned near 1, so two quaternions differing
      // by one ULP in the dot product report an angle of ~3e-8 radians. That is
      // a property of the measurement, not of the interpolation.
      expect(batched[i].quaternion.x).toBeCloseTo(single.quaternion.x, 12);
      expect(batched[i].quaternion.y).toBeCloseTo(single.quaternion.y, 12);
      expect(batched[i].quaternion.z).toBeCloseTo(single.quaternion.z, 12);
      expect(batched[i].quaternion.w).toBeCloseTo(single.quaternion.w, 12);
    }
  });
});

describe("interpolator layering (T-01-15)", () => {
  const code = interpolatorSource
    .split("\n")
    .filter((line) => !/^\s*(\/\/|\/\*|\*)/.test(line))
    .join("\n");

  it("never writes simulation state", () => {
    expect(code).not.toMatch(/world\.step|applyImpulse|setTranslation|setRotation/);
  });

  it("takes the stride from the physics layer rather than hardcoding 7", () => {
    expect(interpolatorSource).toContain("XFORM_STRIDE");
    expect(interpolatorSource).toContain("../physics/transform-cache");
    expect(code).not.toMatch(/\*\s*7\b/);
  });

  it("uses THREE.Quaternion.slerp rather than a hand-rolled quaternion path", () => {
    expect(code).toContain(".slerp(");
  });
});
