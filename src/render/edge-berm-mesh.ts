/**
 * Edge berm mesh: ONE merged mesh built from the exact boxes the physics scene
 * collides with (04.3 D-09), shared by the terrain view and the compiled-map
 * game path so the visible berm can never disagree with its colliders.
 */
import * as THREE from "three";
import type { BermBox } from "../core/terrain-edge-berm.ts";

export const BERM_COLOR_HEX = 0xd8d2c4;

/** Returns undefined for an empty box list. Caller owns disposal (geometry + material). */
export function buildBermMesh(boxes: readonly BermBox[]): THREE.Mesh | undefined {
  if (boxes.length === 0) return undefined;
  const unit = new THREE.BoxGeometry(1, 1, 1);
  const up = unit.getAttribute("position");
  const un = unit.getAttribute("normal");
  const ui = unit.getIndex();
  if (ui === null) throw new Error("edge-berm-mesh: BoxGeometry has no index");
  const vPer = up.count; // 24
  const iPer = ui.count; // 36
  const n = boxes.length;
  const positions = new Float32Array(n * vPer * 3);
  const normals = new Float32Array(n * vPer * 3);
  const indices = new Uint32Array(n * iPer);
  boxes.forEach((b, k) => {
    for (let v = 0; v < vPer; v++) {
      const o = (k * vPer + v) * 3;
      positions[o] = up.getX(v) * b.hx * 2 + b.cx;
      positions[o + 1] = up.getY(v) * b.hy * 2 + b.cy;
      positions[o + 2] = up.getZ(v) * b.hz * 2 + b.cz;
      normals[o] = un.getX(v);
      normals[o + 1] = un.getY(v);
      normals[o + 2] = un.getZ(v);
    }
    for (let i = 0; i < iPer; i++) indices[k * iPer + i] = ui.getX(i) + k * vPer;
  });
  unit.dispose();
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geo.setAttribute("normal", new THREE.BufferAttribute(normals, 3));
  geo.setIndex(new THREE.BufferAttribute(indices, 1));
  geo.computeBoundingBox();
  geo.computeBoundingSphere();
  const mat = new THREE.MeshStandardMaterial({
    color: BERM_COLOR_HEX,
    roughness: 0.9,
    metalness: 0,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  mesh.castShadow = false;
  return mesh;
}
