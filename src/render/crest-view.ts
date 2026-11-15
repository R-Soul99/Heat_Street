/**
 * Authored crest meshes (flat-shaded domes seated on the terrain). Extracted from terrain-view.ts
 * (07.1.3 plan 08) so the game view and the editor build them in one place.
 *
 * Layering: three + pure src/core only, never Rapier.
 */
import * as THREE from "three";
import { type AuthoredCrest, buildCrestGeometry } from "../core/crest-geometry.ts";
import type { SurfaceType } from "../core/surface-types.ts";

/** One mesh per crest entry. Meshes are NOT added to any group; the caller decides. */
export function buildCrestMeshes(
  crests: readonly AuthoredCrest[],
  heightAt: (x: number, z: number) => number,
  palette: Readonly<Record<SurfaceType, number>>,
): THREE.Mesh[] {
  const meshes: THREE.Mesh[] = [];
  if (crests.length === 0) return meshes;
  const entries = buildCrestGeometry(crests, heightAt);
  for (const entry of entries) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(entry.positions, 3));
    geo.setIndex(new THREE.BufferAttribute(entry.indices, 1));
    geo.setAttribute("normal", new THREE.BufferAttribute(faceWeightedNormals(entry), 3));
    geo.computeBoundingSphere();
    const mat = new THREE.MeshStandardMaterial({
      color: palette[entry.surface] ?? palette.grass,
      roughness: 0.95,
      metalness: 0,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = true;
    meshes.push(mesh);
  }
  return meshes;
}

/** Area-weighted vertex normals for crest entries (CCW-from-+Y winding). */
export function faceWeightedNormals(entry: {
  positions: Float32Array;
  indices: Uint32Array;
}): Float32Array {
  const p = entry.positions;
  const n = new Float32Array(p.length);
  const idx = entry.indices;
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t] * 3;
    const b = idx[t + 1] * 3;
    const c = idx[t + 2] * 3;
    const ux = p[b] - p[a];
    const uy = p[b + 1] - p[a + 1];
    const uz = p[b + 2] - p[a + 2];
    const vx = p[c] - p[a];
    const vy = p[c + 1] - p[a + 1];
    const vz = p[c + 2] - p[a + 2];
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    for (const i of [a, b, c]) {
      n[i] += nx;
      n[i + 1] += ny;
      n[i + 2] += nz;
    }
  }
  for (let i = 0; i < n.length; i += 3) {
    const len = Math.hypot(n[i], n[i + 1], n[i + 2]) || 1;
    n[i] /= len;
    n[i + 1] /= len;
    n[i + 2] /= len;
  }
  return n;
}
