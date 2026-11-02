/**
 * Surface paint map: one byte per pixel, row-major (index = pz * width + px).
 * Low nibble = index into SURFACE_TYPES; bit 0x80 = road flag (the renderer
 * draws a road on same-surface ground; physics reads only the low bits).
 *
 * Layering: pure data, no three/rapier/DOM. surfaceAt/paintIndexAt run four
 * times per physics tick and never allocate.
 */
import { SURFACE_TYPES, type SurfaceType } from "./surface-types.ts";

export const PAINT_SURFACE_MASK = 0x0f;
export const PAINT_ROAD_FLAG = 0x80;
/** Upper bound on width*height, checked before allocating (T-04.2-01). */
export const MAX_PAINT_PIXELS = 2 ** 27;

export interface PaintMap {
  readonly width: number;
  readonly height: number;
  readonly metresPerPixel: number;
  readonly originX: number;
  readonly originZ: number;
  readonly data: Uint8Array;
}

export function encodePaintValue(surface: SurfaceType, road: boolean): number {
  const idx = SURFACE_TYPES.indexOf(surface);
  if (idx < 0) throw new RangeError(`unknown surface ${String(surface)}`);
  return idx | (road ? PAINT_ROAD_FLAG : 0);
}

/** Decodes the surface; any index outside SURFACE_TYPES yields `fallback` (T-04.2-02). */
export function decodePaintSurface(value: number, fallback: SurfaceType = "tarmac"): SurfaceType {
  return SURFACE_TYPES[value & PAINT_SURFACE_MASK] ?? fallback;
}

export function createPaintMap(opts: {
  originX: number;
  originZ: number;
  widthM: number;
  depthM: number;
  metresPerPixel: number;
  fill: SurfaceType;
  road?: boolean;
}): PaintMap {
  const { originX, originZ, widthM, depthM, metresPerPixel, fill, road = false } = opts;
  if (!Number.isFinite(metresPerPixel) || metresPerPixel <= 0) {
    throw new RangeError(`metresPerPixel must be finite and > 0, got ${metresPerPixel}`);
  }
  if (!Number.isFinite(widthM) || widthM <= 0)
    throw new RangeError(`widthM must be finite and > 0, got ${widthM}`);
  if (!Number.isFinite(depthM) || depthM <= 0)
    throw new RangeError(`depthM must be finite and > 0, got ${depthM}`);
  const width = Math.ceil(widthM / metresPerPixel);
  const height = Math.ceil(depthM / metresPerPixel);
  if (width * height > MAX_PAINT_PIXELS) {
    throw new RangeError(`paint map ${width}x${height} exceeds ${MAX_PAINT_PIXELS} pixels`);
  }
  const data = new Uint8Array(width * height);
  data.fill(encodePaintValue(fill, road));
  return { width, height, metresPerPixel, originX, originZ, data };
}

function clampPixel(v: number, max: number): number {
  return v < 0 ? 0 : v > max ? max : v;
}

/** Row-major pixel index covering (x, z), clamped to the border; -1 for non-finite input. Allocation-free. */
export function paintIndexAt(paint: PaintMap, x: number, z: number): number {
  const fx = Math.floor((x - paint.originX) / paint.metresPerPixel);
  const fz = Math.floor((z - paint.originZ) / paint.metresPerPixel);
  if (Number.isNaN(fx) || Number.isNaN(fz)) return -1;
  return clampPixel(fz, paint.height - 1) * paint.width + clampPixel(fx, paint.width - 1);
}

export function worldToPaintPixel(
  paint: PaintMap,
  x: number,
  z: number,
): { px: number; pz: number } {
  const fx = Math.floor((x - paint.originX) / paint.metresPerPixel);
  const fz = Math.floor((z - paint.originZ) / paint.metresPerPixel);
  return {
    px: Number.isNaN(fx) ? 0 : clampPixel(fx, paint.width - 1),
    pz: Number.isNaN(fz) ? 0 : clampPixel(fz, paint.height - 1),
  };
}

export function surfaceAt(
  paint: PaintMap,
  x: number,
  z: number,
  fallback: SurfaceType = "tarmac",
): SurfaceType {
  const i = paintIndexAt(paint, x, z);
  return i < 0 ? fallback : decodePaintSurface(paint.data[i], fallback);
}

export function isRoadAt(paint: PaintMap, x: number, z: number): boolean {
  const i = paintIndexAt(paint, x, z);
  return i >= 0 && (paint.data[i] & PAINT_ROAD_FLAG) !== 0;
}
