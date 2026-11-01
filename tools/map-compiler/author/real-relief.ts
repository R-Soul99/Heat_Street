/**
 * Real-terrain relief for the off-road heightfield, from a grey-scale heightmap
 * PNG that covers the area's bbox (north up, 16-bit or 8-bit, normalised
 * min..max over a real elevation span of `rangeM`).
 *
 * Roads stay flat at y = 0 (project design: relief is an off-road artifact), so
 * the heightmap is used as RELATIVE height: at each point the relief is the
 * heightmap's rise above the heightmap value at the NEAREST ROAD point, scaled
 * by `reliefScale`, clamped to `maxReliefM` upward and `DIP_FRACTION` of that
 * downward (dips beside a flat road read as cliffs and trap cars), and faded to 0 at the paved
 * edge by the same smoothstep falloff as the procedural relief. A hill beside a
 * valley road therefore rises from the road; a road on a ridge does not sit in
 * a pit.
 *
 * Also hosts the minimal PNG decoder (grey, non-interlaced, 8/16-bit) — no
 * dependency needed for one 128x128 file.
 */
import { inflateSync } from "node:zlib";
import type { RoadGraph } from "../../../src/core/road-graph.ts";
import { RELIEF_FALLOFF_DISTANCE_M } from "./heightfield.ts";

export interface GreyImage {
  readonly width: number;
  readonly height: number;
  /** Row-major, 0..1 (value / max for the bit depth). */
  readonly values: Float32Array;
}

/** Decodes a non-interlaced greyscale PNG (colour type 0), 8 or 16 bit. */
export function decodeGreyPng(bytes: Uint8Array): GreyImage {
  const buf = Buffer.from(bytes);
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error("not a PNG");
  let width = 0;
  let height = 0;
  let depth = 0;
  const idat: Buffer[] = [];
  for (let o = 8; o < buf.length; ) {
    const len = buf.readUInt32BE(o);
    const type = buf.toString("ascii", o + 4, o + 8);
    const data = buf.subarray(o + 8, o + 8 + len);
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      depth = data[8] as number;
      if (data[9] !== 0 || data[12] !== 0 || (depth !== 8 && depth !== 16)) {
        throw new Error("only non-interlaced 8/16-bit greyscale PNG is supported");
      }
    } else if (type === "IDAT") idat.push(data);
    o += 12 + len;
  }
  const bpp = depth / 8;
  const stride = width * bpp;
  const raw = inflateSync(Buffer.concat(idat));
  const out = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)] as number;
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? (out[y * stride + i - bpp] as number) : 0;
      const b = y > 0 ? (out[(y - 1) * stride + i] as number) : 0;
      const c = y > 0 && i >= bpp ? (out[(y - 1) * stride + i - bpp] as number) : 0;
      let predictor = 0;
      if (filter === 1) predictor = a;
      else if (filter === 2) predictor = b;
      else if (filter === 3) predictor = (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        predictor = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      } else if (filter !== 0) throw new Error(`bad PNG filter ${filter}`);
      out[y * stride + i] = ((line[i] as number) + predictor) & 0xff;
    }
  }
  const values = new Float32Array(width * height);
  for (let i = 0; i < values.length; i++) {
    values[i] = depth === 16 ? out.readUInt16BE(i * 2) / 65535 : (out[i] as number) / 255;
  }
  return { width, height, values };
}

/** Bilinear sample of `img` at u,v in 0..1 (v = 0 is the top/north row). */
export function sampleGrey(img: GreyImage, u: number, v: number): number {
  const fx = Math.min(img.width - 1, Math.max(0, u * (img.width - 1)));
  const fy = Math.min(img.height - 1, Math.max(0, v * (img.height - 1)));
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const x1 = Math.min(img.width - 1, x0 + 1);
  const y1 = Math.min(img.height - 1, y0 + 1);
  const tx = fx - x0;
  const ty = fy - y0;
  const at = (x: number, y: number) => img.values[y * img.width + x] as number;
  return (
    at(x0, y0) * (1 - tx) * (1 - ty) +
    at(x1, y0) * tx * (1 - ty) +
    at(x0, y1) * (1 - tx) * ty +
    at(x1, y1) * tx * ty
  );
}

export interface RealReliefOptions {
  readonly image: GreyImage;
  /** Real elevation span (metres) that the image's 0..1 covers. */
  readonly rangeM: number;
  /** Multiplier on the real relative height (<1 tames cliffs). */
  readonly reliefScale: number;
  /** Cap on upward relief in metres (dips are capped lower, see `DIP_FRACTION`). */
  readonly maxReliefM: number;
  readonly bbox: { south: number; west: number; north: number; east: number };
  /** Local-ENU (x east, z south) -> lat/lon, from the graph's projector. */
  readonly unproject: (x: number, z: number) => { lat: number; lon: number };
}

/** Dips below road level are capped at this fraction of `maxReliefM`. */
const DIP_FRACTION = 0.3;

const smoothstep = (t: number): number => t * t * (3 - 2 * t);

/** Returns `(x, z, distanceToPavedEdgeM) => reliefMetres`, a drop-in for `reliefAt`. */
export function buildRealRelief(
  graph: RoadGraph,
  opts: RealReliefOptions,
): (x: number, z: number, distanceToPavedEdgeM: number) => number {
  const { bbox, image } = opts;
  const heightAt = (x: number, z: number): number => {
    const ll = opts.unproject(x, z);
    return sampleGrey(
      image,
      (ll.lon - bbox.west) / (bbox.east - bbox.west),
      (bbox.north - ll.lat) / (bbox.north - bbox.south),
    );
  };

  // Spatial hash of road vertices (with their heightmap value) for nearest-road lookup.
  const CELL_M = 200;
  const cells = new Map<string, { x: number; z: number; h: number }[]>();
  const key = (cx: number, cz: number) => `${cx},${cz}`;
  for (const edge of graph.edges) {
    for (const p of edge.points) {
      const x = p[0] as number;
      const z = p[2] as number;
      const k = key(Math.floor(x / CELL_M), Math.floor(z / CELL_M));
      const list = cells.get(k) ?? [];
      list.push({ x, z, h: heightAt(x, z) });
      cells.set(k, list);
    }
  }
  const nearestRoadHeight = (x: number, z: number): number => {
    const cx = Math.floor(x / CELL_M);
    const cz = Math.floor(z / CELL_M);
    let best = Number.POSITIVE_INFINITY;
    let h = 0;
    for (let ring = 0; ring < 40; ring++) {
      for (let dx = -ring; dx <= ring; dx++) {
        for (let dz = -ring; dz <= ring; dz++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== ring) continue;
          for (const p of cells.get(key(cx + dx, cz + dz)) ?? []) {
            const d = (p.x - x) ** 2 + (p.z - z) ** 2;
            if (d < best) {
              best = d;
              h = p.h;
            }
          }
        }
      }
      // Anything in a farther ring is at least ring*CELL_M away.
      if (best < (ring * CELL_M) ** 2) break;
    }
    return h;
  };

  return (x, z, distanceToPavedEdgeM) => {
    const t = Math.min(1, Math.max(0, distanceToPavedEdgeM / RELIEF_FALLOFF_DISTANCE_M));
    const falloff = smoothstep(t);
    if (falloff === 0) return 0;
    const rel = (heightAt(x, z) - nearestRoadHeight(x, z)) * opts.rangeM * opts.reliefScale;
    return Math.max(-opts.maxReliefM * DIP_FRACTION, Math.min(opts.maxReliefM, rel)) * falloff;
  };
}
