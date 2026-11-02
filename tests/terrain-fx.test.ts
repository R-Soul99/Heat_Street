import * as THREE from "three";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { createSurfaceFx } from "../src/render/surface-fx";

function flatMeshAt(y: number): THREE.Mesh {
  const geometry = new THREE.PlaneGeometry(100, 100, 10, 10);
  geometry.rotateX(-Math.PI / 2);
  const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial());
  mesh.position.y = y;
  mesh.updateMatrixWorld(true);
  return mesh;
}

function visibleDecals(group: THREE.Group): THREE.Mesh[] {
  const out: THREE.Mesh[] = [];
  for (const child of group.children) {
    if ((child as THREE.Mesh).isMesh === true && child.visible) out.push(child as THREE.Mesh);
  }
  return out;
}

const slidingWheel = (x: number, z: number, surface: "tarmac" | "grass" = "grass") => ({
  surface,
  grounded: true,
  slip: 10,
  position: new THREE.Vector3(x, 3, z),
});

// surface-fx builds a puff texture from a 2D canvas; the node test env has no DOM.
beforeAll(() => {
  vi.stubGlobal("document", {
    createElement: () => ({ width: 0, height: 0, getContext: () => null }),
  });
});

describe("createSurfaceFx terrain target", () => {
  it("projects a decal onto the terrain mesh at terrain height for any surface", () => {
    const terrain = flatMeshAt(3);
    const calls: [number, number][] = [];
    const fx = createSurfaceFx([], [], {
      meshAt: (x, z) => {
        calls.push([x, z]);
        return terrain;
      },
      heightAt: () => 3,
    });
    fx.update([slidingWheel(5, 7)], 16);
    expect(calls).toContainEqual([5, 7]);
    const decals = visibleDecals(fx.group);
    expect(decals.length).toBe(1);
    const pos = decals[0]?.geometry.getAttribute("position");
    expect(pos).toBeDefined();
    expect(pos?.count ?? 0).toBeGreaterThan(0);
    for (let i = 0; i < (pos?.count ?? 0); i++) {
      expect(pos?.getY(i)).toBeCloseTo(3, 1);
    }
  });

  it("spawns nothing and does not throw when meshAt returns undefined", () => {
    const fx = createSurfaceFx([], [], { meshAt: () => undefined, heightAt: () => 0 });
    expect(() => fx.update([slidingWheel(1, 1)], 16)).not.toThrow();
    expect(visibleDecals(fx.group).length).toBe(0);
  });

  it("without a terrain target and no zone mesh, spawns nothing (legacy path unchanged)", () => {
    const fx = createSurfaceFx([], []);
    expect(() => fx.update([slidingWheel(1, 1)], 16)).not.toThrow();
    expect(visibleDecals(fx.group).length).toBe(0);
  });

  it("without a terrain target uses the surface zone mesh as before", () => {
    const zone = flatMeshAt(0);
    const fx = createSurfaceFx([zone], ["grass"]);
    fx.update([slidingWheel(2, 2)], 16);
    expect(visibleDecals(fx.group).length).toBe(1);
  });
});
