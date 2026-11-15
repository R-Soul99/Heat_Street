import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { orbitAboutPivot, panByPixels, worldPerPixel, zoomTowardPoint } from "./camera-nav.ts";

const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

describe("zoomTowardPoint", () => {
  const pos = v(100, 80, 60);
  const target = v(10, 0, -20);
  const point = v(40, 5, 0);

  it("keeps the view direction", () => {
    const r = zoomTowardPoint(pos, target, point, 1.7, 1, 1e6);
    const d0 = target.clone().sub(pos).normalize();
    const d1 = r.target.clone().sub(r.position).normalize();
    expect(d1.distanceTo(d0)).toBeLessThan(1e-9);
  });

  it("keeps the point on the same view ray", () => {
    const r = zoomTowardPoint(pos, target, point, 1.7, 1, 1e6);
    const a = r.position.clone().sub(point);
    const b = pos.clone().sub(point);
    expect(a.cross(b).length()).toBeLessThan(1e-6);
  });

  it("factor 2 halves distances", () => {
    const r = zoomTowardPoint(pos, target, point, 2, 1, 1e6);
    expect(r.position.distanceTo(r.target)).toBeCloseTo(pos.distanceTo(target) / 2, 6);
    expect(r.position.distanceTo(point)).toBeCloseTo(pos.distanceTo(point) / 2, 6);
  });

  it("clamps at min and max distance", () => {
    const d = pos.distanceTo(target);
    const near = zoomTowardPoint(pos, target, point, 1e6, d / 4, d * 4);
    expect(near.position.distanceTo(near.target)).toBeCloseTo(d / 4, 6);
    const far = zoomTowardPoint(pos, target, point, 1e-6, d / 4, d * 4);
    expect(far.position.distanceTo(far.target)).toBeCloseTo(d * 4, 6);
    const stuck = zoomTowardPoint(near.position, near.target, point, 2, d / 4, d * 4);
    expect(stuck.position.distanceTo(near.position)).toBeLessThan(1e-9);
  });

  it("factor 1 is identity and inputs are not mutated", () => {
    const p0 = pos.clone();
    const r = zoomTowardPoint(pos, target, point, 1, 1, 1e6);
    expect(r.position.distanceTo(pos)).toBeLessThan(1e-9);
    expect(r.target.distanceTo(target)).toBeLessThan(1e-9);
    expect(pos.equals(p0)).toBe(true);
  });
});

describe("orbitAboutPivot", () => {
  const minPhi = 0.01;
  const maxPhi = Math.PI / 2 - 0.02;
  const samples: Array<[THREE.Vector3, THREE.Vector3, number, number]> = [
    [v(200, 250, 200), v(0, 0, 0), 0.3, 0.1],
    [v(-50, 120, 30), v(10, 5, -5), -0.8, -0.2],
    [v(30, 400, -90), v(0, 0, 0), 1.2, 0.05],
  ];

  it("matches the Spherical path when pivot equals target", () => {
    for (const [p, t, dTheta, dPhi] of samples) {
      const sph = new THREE.Spherical().setFromVector3(p.clone().sub(t));
      sph.theta += dTheta;
      sph.phi = Math.min(maxPhi, Math.max(minPhi, sph.phi + dPhi));
      const expected = t.clone().add(new THREE.Vector3().setFromSpherical(sph));
      const r = orbitAboutPivot(p, t, t, dTheta, dPhi, minPhi, maxPhi);
      expect(r.position.distanceTo(expected)).toBeLessThan(1e-6);
      expect(r.target.distanceTo(t)).toBeLessThan(1e-6);
    }
  });

  it("preserves distances to the pivot", () => {
    const [p, t] = samples[1];
    const pivot = v(60, 2, 40);
    const r = orbitAboutPivot(p, t, pivot, 0.7, 0.15, minPhi, maxPhi);
    expect(r.position.distanceTo(pivot)).toBeCloseTo(p.distanceTo(pivot), 6);
    expect(r.target.distanceTo(pivot)).toBeCloseTo(t.distanceTo(pivot), 6);
  });

  it("never leaves the phi limits", () => {
    const [p, t] = samples[0];
    const pivot = v(30, 0, 10);
    for (const dPhi of [100, -100, 3, -3]) {
      const r = orbitAboutPivot(p, t, pivot, 0.2, dPhi, minPhi, maxPhi);
      const phi = new THREE.Spherical().setFromVector3(r.position.clone().sub(r.target)).phi;
      expect(phi).toBeGreaterThanOrEqual(minPhi - 1e-9);
      expect(phi).toBeLessThanOrEqual(maxPhi + 1e-9);
    }
  });

  it("pure yaw keeps heights", () => {
    const [p, t] = samples[1];
    const r = orbitAboutPivot(p, t, v(60, 2, 40), 0.9, 0, minPhi, maxPhi);
    expect(r.position.y).toBeCloseTo(p.y, 6);
    expect(r.target.y).toBeCloseTo(t.y, 6);
  });
});

describe("worldPerPixel / panByPixels", () => {
  it("computes world units per pixel", () => {
    expect(worldPerPixel(100, 90, 500)).toBeCloseTo(0.4, 9);
  });

  it("moves the camera opposite to the drag", () => {
    const o = panByPixels(v(1, 0, 0), v(0, 1, 0), 10, 5, 2);
    expect(o.x).toBeCloseTo(-20, 9);
    expect(o.y).toBeCloseTo(10, 9);
  });
});
