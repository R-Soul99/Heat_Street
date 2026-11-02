/**
 * Ray vs terrain heightfield picking (04.2 plan 12).
 *
 * 2D DDA cell traversal (Amanatides-Woo) in XZ; each visited cell is tested
 * against its two triangles, split along TERRAIN_DIAGONAL so the hit lies on
 * exactly the surface Rapier collides with. Cheaper and more exact than a
 * THREE.Raycaster over chunk meshes, and testable without three.
 *
 * Layering: pure data transform, no three/rapier/DOM.
 */
import { TERRAIN_DIAGONAL, type TerrainGrid } from "./terrain-grid.ts";

export interface TerrainRayHit {
  x: number;
  y: number;
  z: number;
  distance: number;
}

interface Vec3 {
  x: number;
  y: number;
  z: number;
}

const EPS = 1e-9;

/** Moeller-Trumbore, two-sided. Returns the ray parameter or -1. */
function rayTriangle(
  ox: number,
  oy: number,
  oz: number,
  dx: number,
  dy: number,
  dz: number,
  ax: number,
  ay: number,
  az: number,
  bx: number,
  by: number,
  bz: number,
  cx: number,
  cy: number,
  cz: number,
): number {
  const e1x = bx - ax;
  const e1y = by - ay;
  const e1z = bz - az;
  const e2x = cx - ax;
  const e2y = cy - ay;
  const e2z = cz - az;
  const px = dy * e2z - dz * e2y;
  const py = dz * e2x - dx * e2z;
  const pz = dx * e2y - dy * e2x;
  const det = e1x * px + e1y * py + e1z * pz;
  if (Math.abs(det) < 1e-14) return -1;
  const inv = 1 / det;
  const tx = ox - ax;
  const ty = oy - ay;
  const tz = oz - az;
  const u = (tx * px + ty * py + tz * pz) * inv;
  if (u < -EPS || u > 1 + EPS) return -1;
  const qx = ty * e1z - tz * e1y;
  const qy = tz * e1x - tx * e1z;
  const qz = tx * e1y - ty * e1x;
  const v = (dx * qx + dy * qy + dz * qz) * inv;
  if (v < -EPS || u + v > 1 + EPS) return -1;
  return (e2x * qx + e2y * qy + e2z * qz) * inv;
}

/**
 * First intersection of the ray with the terrain surface, or null.
 * `dir` need not be normalised; `distance` is in metres along the ray.
 */
export function raycastTerrain(
  grid: TerrainGrid,
  origin: Vec3,
  dir: Vec3,
  maxDistance = 1e5,
): TerrainRayHit | null {
  const len = Math.hypot(dir.x, dir.y, dir.z);
  if (!(len > 0)) return null;
  const dx = dir.x / len;
  const dy = dir.y / len;
  const dz = dir.z / len;
  const { rows, cols, heights } = grid;
  const cellX = grid.scaleX / cols;
  const cellZ = grid.scaleZ / rows;
  const stride = rows + 1;

  // Ray in cell units: a = column coordinate, b = row coordinate.
  const a0 = (origin.x - grid.originX) / cellX;
  const b0 = (origin.z - grid.originZ) / cellZ;
  const da = dx / cellX;
  const db = dz / cellZ;

  let tMin = 0;
  let tMax = maxDistance;
  const clip = (p: number, d: number, size: number): boolean => {
    if (Math.abs(d) < 1e-12) return p >= 0 && p <= size;
    let t0 = (0 - p) / d;
    let t1 = (size - p) / d;
    if (t0 > t1) [t0, t1] = [t1, t0];
    if (t0 > tMin) tMin = t0;
    if (t1 < tMax) tMax = t1;
    return true;
  };
  if (!clip(a0, da, cols) || !clip(b0, db, rows) || tMin > tMax) return null;

  let col = Math.min(Math.max(Math.floor(a0 + da * tMin), 0), cols - 1);
  let row = Math.min(Math.max(Math.floor(b0 + db * tMin), 0), rows - 1);
  const stepC = da > 0 ? 1 : da < 0 ? -1 : 0;
  const stepR = db > 0 ? 1 : db < 0 ? -1 : 0;
  const tDeltaC = stepC === 0 ? Number.POSITIVE_INFINITY : Math.abs(1 / da);
  const tDeltaR = stepR === 0 ? Number.POSITIVE_INFINITY : Math.abs(1 / db);
  let tNextC = stepC === 0 ? Number.POSITIVE_INFINITY : ((stepC > 0 ? col + 1 : col) - a0) / da;
  let tNextR = stepR === 0 ? Number.POSITIVE_INFINITY : ((stepR > 0 ? row + 1 : row) - b0) / db;

  const diag01 = TERRAIN_DIAGONAL === "row0col1-row1col0";
  let tEnter = tMin;
  for (;;) {
    const tExit = Math.min(tNextC, tNextR, tMax);

    const h00 = heights[row + col * stride];
    const h01 = heights[row + (col + 1) * stride];
    const h10 = heights[row + 1 + col * stride];
    const h11 = heights[row + 1 + (col + 1) * stride];
    // Skip cells the ray passes entirely above or below.
    const yA = origin.y + dy * tEnter;
    const yB = origin.y + dy * tExit;
    const cellMax = Math.max(h00, h01, h10, h11);
    const cellMin = Math.min(h00, h01, h10, h11);
    if (!(Math.min(yA, yB) > cellMax + EPS || Math.max(yA, yB) < cellMin - EPS)) {
      const x0 = grid.originX + col * cellX;
      const x1 = x0 + cellX;
      const z0 = grid.originZ + row * cellZ;
      const z1 = z0 + cellZ;
      let t1: number;
      let t2: number;
      if (diag01) {
        t1 = rayTriangle(
          origin.x,
          origin.y,
          origin.z,
          dx,
          dy,
          dz,
          x0,
          h00,
          z0,
          x1,
          h01,
          z0,
          x0,
          h10,
          z1,
        );
        t2 = rayTriangle(
          origin.x,
          origin.y,
          origin.z,
          dx,
          dy,
          dz,
          x1,
          h01,
          z0,
          x1,
          h11,
          z1,
          x0,
          h10,
          z1,
        );
      } else {
        t1 = rayTriangle(
          origin.x,
          origin.y,
          origin.z,
          dx,
          dy,
          dz,
          x0,
          h00,
          z0,
          x1,
          h01,
          z0,
          x1,
          h11,
          z1,
        );
        t2 = rayTriangle(
          origin.x,
          origin.y,
          origin.z,
          dx,
          dy,
          dz,
          x0,
          h00,
          z0,
          x1,
          h11,
          z1,
          x0,
          h10,
          z1,
        );
      }
      let best = -1;
      if (t1 >= 0) best = t1;
      if (t2 >= 0 && (best < 0 || t2 < best)) best = t2;
      if (best >= 0 && best <= maxDistance) {
        return {
          x: origin.x + dx * best,
          y: origin.y + dy * best,
          z: origin.z + dz * best,
          distance: best,
        };
      }
    }

    if (tExit >= tMax) return null;
    tEnter = tExit;
    if (tNextC < tNextR) {
      col += stepC;
      tNextC += tDeltaC;
    } else {
      row += stepR;
      tNextR += tDeltaR;
    }
    if (col < 0 || col >= cols || row < 0 || row >= rows) return null;
  }
}
