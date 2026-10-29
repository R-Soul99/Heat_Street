/**
 * Height shading for the feel-test jumps. A long, low ramp seen from the
 * helicopter camera reads as a flat slab (drive log feedback, 2026-10-29: "the
 * car doesn't seem to really be on the ramp, it takes off after the lip").
 * Colouring each vertex by its height above the ground, plus a darker band
 * every half metre like map contours, makes the slope readable: the bands
 * crowd together where it is steep and spread out where it is gentle.
 * Purely visual; reads no simulation state.
 */
import * as THREE from "three";

const LOW = new THREE.Color(0x7a4a12);
const HIGH = new THREE.Color(0xffe27a);
/** Height at which the colour reaches `HIGH`, metres. */
const FULL_HEIGHT_M = 3.5;
const BAND_HEIGHT_M = 0.5;
const BAND_DARKEN = 0.72;

/** Writes a `color` attribute from each vertex's world height and switches the material to use it. */
export function shadeByHeight(mesh: THREE.Mesh): void {
  const geometry = mesh.geometry;
  const position = geometry.getAttribute("position");
  if (position === undefined) return;
  const colors = new Float32Array(position.count * 3);
  const c = new THREE.Color();
  for (let i = 0; i < position.count; i++) {
    const y = position.getY(i);
    const t = THREE.MathUtils.clamp(y / FULL_HEIGHT_M, 0, 1);
    c.copy(LOW).lerp(HIGH, t);
    // Contour band: alternate every BAND_HEIGHT_M, starting darker at the ground.
    if (Math.floor(y / BAND_HEIGHT_M + 1e-4) % 2 === 0) c.multiplyScalar(BAND_DARKEN);
    colors[i * 3] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
  }
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  for (const m of materials) {
    if (m instanceof THREE.MeshStandardMaterial) {
      m.color.set(0xffffff);
      m.vertexColors = true;
      m.needsUpdate = true;
    }
  }
}
