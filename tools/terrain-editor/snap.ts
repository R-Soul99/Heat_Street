// Snap to grid for the terrain editor (quick 261116-a5q). Pure: no DOM, no three.

/** Choices in the top-bar drop-down, in metres. */
export const SNAP_SIZES_M = [1, 2, 5, 10] as const;
export const DEFAULT_SNAP_M = 5;

/** A stored or typed size back to one of the allowed choices (anything else gives the default). */
export function parseSnapSize(raw: unknown): number {
  const n = typeof raw === "number" ? raw : Number(raw);
  return (SNAP_SIZES_M as readonly number[]).includes(n) ? n : DEFAULT_SNAP_M;
}

/**
 * Nearest multiple of `size`. Exactly half-way rounds away from zero, so 2.5 -> 5 and -2.5 -> -5
 * (the grid reads the same on both sides of the origin). Never returns -0. A size that is not a
 * positive finite number, or a non-finite value, returns the value unchanged.
 */
export function snapValue(v: number, size: number): number {
  if (!Number.isFinite(v) || !Number.isFinite(size) || size <= 0) return v;
  const q = Math.floor(Math.abs(v) / size + 0.5 + 1e-9);
  const out = Math.sign(v) * q * size;
  return out === 0 ? 0 : out;
}

export interface SnapOptions {
  readonly on: boolean;
  readonly sizeM: number;
  /** Alt held: bypass the snap for this one placement or drag. */
  readonly bypass?: boolean;
}

/** A point snapped to the grid, or returned as it is when Snap is off or bypassed. */
export function snapPoint(x: number, z: number, o: SnapOptions): { x: number; z: number } {
  if (!o.on || o.bypass === true) return { x, z };
  return { x: snapValue(x, o.sizeM), z: snapValue(z, o.sizeM) };
}

/**
 * Move delta that puts an item's anchor on the grid: the anchor is at (ax, az) and the pointer
 * wants to move it by (dx, dz). Returns the delta to apply instead (unchanged when off/bypassed).
 */
export function snapDelta(
  ax: number,
  az: number,
  dx: number,
  dz: number,
  o: SnapOptions,
): { dx: number; dz: number } {
  if (!o.on || o.bypass === true) return { dx, dz };
  return {
    dx: snapValue(ax + dx, o.sizeM) - ax,
    dz: snapValue(az + dz, o.sizeM) - az,
  };
}

export interface SnapGridBounds {
  readonly minX: number;
  readonly maxX: number;
  readonly minZ: number;
  readonly maxZ: number;
}

/** Most lines per axis one grid build may emit (cap on cost; zoomed-out views just show nothing). */
export const SNAP_GRID_MAX_LINES = 160;
/** Sub-segment length (m) so the lines hug the ground. */
const SNAP_GRID_STEP_M = 2;

/**
 * World-aligned grid lines every `sizeM` metres inside a square of half-width `halfM` around
 * (cx, cz), clipped to `bounds`. Flat [x0,y0,z0,x1,y1,z1,...], draped on `heightAt` + `liftM`.
 * Empty when the window would need more than SNAP_GRID_MAX_LINES lines per axis.
 */
export function snapGridSegments(
  bounds: SnapGridBounds,
  cx: number,
  cz: number,
  halfM: number,
  sizeM: number,
  heightAt: (x: number, z: number) => number,
  liftM: number,
): Float32Array {
  if (![cx, cz, halfM, sizeM].every(Number.isFinite) || sizeM <= 0 || halfM <= 0) {
    return new Float32Array(0);
  }
  const x0 = Math.max(bounds.minX, cx - halfM);
  const x1 = Math.min(bounds.maxX, cx + halfM);
  const z0 = Math.max(bounds.minZ, cz - halfM);
  const z1 = Math.min(bounds.maxZ, cz + halfM);
  if (!(x0 < x1) || !(z0 < z1)) return new Float32Array(0);
  const kx0 = Math.ceil(x0 / sizeM);
  const kx1 = Math.floor(x1 / sizeM);
  const kz0 = Math.ceil(z0 / sizeM);
  const kz1 = Math.floor(z1 / sizeM);
  if (kx1 - kx0 + 1 > SNAP_GRID_MAX_LINES || kz1 - kz0 + 1 > SNAP_GRID_MAX_LINES) {
    return new Float32Array(0);
  }
  const out: number[] = [];
  const seg = (ax: number, az: number, bx: number, bz: number): void => {
    out.push(ax, heightAt(ax, az) + liftM, az, bx, heightAt(bx, bz) + liftM, bz);
  };
  for (let k = kx0; k <= kx1; k++) {
    const x = k * sizeM;
    const n = Math.max(1, Math.ceil((z1 - z0) / SNAP_GRID_STEP_M));
    for (let i = 0; i < n; i++) {
      seg(x, z0 + ((z1 - z0) * i) / n, x, z0 + ((z1 - z0) * (i + 1)) / n);
    }
  }
  for (let k = kz0; k <= kz1; k++) {
    const z = k * sizeM;
    const n = Math.max(1, Math.ceil((x1 - x0) / SNAP_GRID_STEP_M));
    for (let i = 0; i < n; i++) {
      seg(x0 + ((x1 - x0) * i) / n, z, x0 + ((x1 - x0) * (i + 1)) / n, z);
    }
  }
  return Float32Array.from(out);
}
