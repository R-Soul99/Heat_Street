/**
 * Where the sun's shadow window sits each frame. The sun's shadow camera only
 * frames a small box (see SHADOW_AREA_HALF in vehicle-view.ts); it has to be
 * carried along with the car or the car leaves the box and casts no shadow.
 * To stop the shadow edges shimmering as the window moves, the window centre
 * is snapped to whole shadow-map texels in the light's own right/up plane.
 * Pure maths, no Three.js.
 */

export interface Vec3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/**
 * Snap `target` to a whole number of texels along the light's right and up
 * axes. `lightDir` points from the target toward the sun (need not be unit).
 * `texelSize` is one shadow-map texel in metres. The depth component (along
 * the light) is left alone, so the result stays on the same light ray.
 */
export function snapShadowTarget(target: Vec3, lightDir: Vec3, texelSize: number): Vec3 {
  const len = Math.hypot(lightDir.x, lightDir.y, lightDir.z);
  if (!(len > 0) || !(texelSize > 0)) return target;
  const dx = lightDir.x / len;
  const dy = lightDir.y / len;
  const dz = lightDir.z / len;
  // Light view axes for an up of (0,1,0): right = up x dir, then up = dir x right.
  const ry = 0;
  let rx = dz;
  let rz = -dx;
  const rLen = Math.hypot(rx, rz);
  if (rLen < 1e-6) return target; // sun straight overhead: no defined right axis
  rx /= rLen;
  rz /= rLen;
  const ux = dy * rz - dz * ry;
  const uy = dz * rx - dx * rz;
  const uz = dx * ry - dy * rx;

  const a = target.x * rx + target.y * ry + target.z * rz;
  const b = target.x * ux + target.y * uy + target.z * uz;
  const da = Math.round(a / texelSize) * texelSize - a;
  const db = Math.round(b / texelSize) * texelSize - b;
  return {
    x: target.x + da * rx + db * ux,
    y: target.y + da * ry + db * uy,
    z: target.z + da * rz + db * uz,
  };
}
