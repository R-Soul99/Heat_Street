/**
 * Pure metre-world model for the dev map editor: the metre projector (same
 * metres-per-degree series as the map compiler, so editor metres equal compiled
 * metres), synthetic bbox / blank-world envelopes, config source text, grid and
 * scale-bar maths, tile lines, and view (zoom/pan) maths.
 *
 * World frame: x east, y north, origin at the world's south-west corner.
 *
 * Layering: no DOM, no fs, no Math.random, no Date. Unit tested in `world.test.ts`.
 */
import { makeProjector as makeCompilerProjector } from "../map-compiler/graph/project.ts";

export interface LatLon {
  lat: number;
  lon: number;
}

export interface RawWay {
  type: "way";
  id: number;
  nodes?: number[];
  geometry: LatLon[];
  tags?: Record<string, string>;
}

export interface Bbox {
  south: number;
  west: number;
  north: number;
  east: number;
}

export interface RawEnvelope {
  fetchedAt: string;
  endpoint: string;
  bbox: Bbox;
  query: string;
  response: { elements: RawWay[] };
}

/** Local metres: x east, y north, relative to the world's south-west corner. */
export interface Projector {
  toLocal(p: LatLon): { x: number; y: number };
  toLatLon(p: { x: number; y: number }): LatLon;
}

export interface World {
  widthM: number;
  heightM: number;
  projector: Projector;
}

export const TILE_SIZES_M = [250, 500, 1000, 2000] as const;
export const DEFAULT_TILE_M = 1000;
export const MIN_WORLD_KM = 0.5;
export const MAX_WORLD_KM = 10;

/** Centre of the synthetic maps (matches the existing synthetic generators). */
const WORLD_CENTRE: LatLon = { lat: 33.0, lon: -84.0 };
const ID_PATTERN = /^[a-z0-9-]+$/;

/** Builds the metre world for a bbox: SW corner at (0,0), y north-positive. */
export function worldFromBbox(bbox: Bbox): World {
  const c = makeCompilerProjector({
    lat: (bbox.south + bbox.north) / 2,
    lon: (bbox.west + bbox.east) / 2,
  });
  const sw = c.project(bbox.south, bbox.west);
  const ne = c.project(bbox.north, bbox.east);
  return {
    widthM: ne.x - sw.x,
    heightM: sw.z - ne.z,
    projector: {
      toLocal: (p) => {
        const q = c.project(p.lat, p.lon);
        return { x: q.x - sw.x, y: sw.z - q.z };
      },
      toLatLon: (p) => c.unproject(p.x + sw.x, sw.z - p.y),
    },
  };
}

/** Bbox of a `widthM` x `heightM` world centred on the synthetic-map centre. */
export function syntheticBbox(widthM: number, heightM: number): Bbox {
  const c = makeCompilerProjector(WORLD_CENTRE);
  const sw = c.unproject(-widthM / 2, heightM / 2);
  const ne = c.unproject(widthM / 2, -heightM / 2);
  return { south: sw.lat, west: sw.lon, north: ne.lat, east: ne.lon };
}

function checkId(id: string): void {
  if (!ID_PATTERN.test(id)) throw new Error(`invalid world id "${id}" (use a-z, 0-9, -)`);
}

function checkKm(name: string, km: number): void {
  if (!Number.isFinite(km) || km < MIN_WORLD_KM || km > MAX_WORLD_KM) {
    throw new Error(`${name} must be between ${MIN_WORLD_KM} and ${MAX_WORLD_KM} km`);
  }
}

/** The bbox a blank world of this size gets (validated). */
export function blankWorldBbox(widthKm: number, heightKm: number): Bbox {
  checkKm("width", widthKm);
  checkKm("height", heightKm);
  return syntheticBbox(widthKm * 1000, heightKm * 1000);
}

/** Empty roads + buildings envelopes for a new authored world. */
export function blankWorld(
  id: string,
  widthKm: number,
  heightKm: number,
  fetchedAt: string,
): { roads: RawEnvelope; buildings: RawEnvelope } {
  checkId(id);
  const bbox = blankWorldBbox(widthKm, heightKm);
  const endpoint = `authored://heat-street/${id}`;
  const envelope = (query: string): RawEnvelope => ({
    fetchedAt,
    endpoint,
    bbox: { ...bbox },
    query,
    response: { elements: [] },
  });
  return {
    roads: envelope(`authored ${id} (map editor, not OSM)`),
    buildings: envelope(`authored ${id} buildings (none)`),
  };
}

export function configExportName(id: string): string {
  checkId(id);
  const camel = id
    .split("-")
    .filter((s) => s !== "")
    .map((s, i) => (i === 0 ? s : s.charAt(0).toUpperCase() + s.slice(1)))
    .join("");
  return `${/^\d/.test(camel) ? "area" : ""}${camel}Config`;
}

function titleFromId(id: string): string {
  return id
    .split("-")
    .filter((s) => s !== "")
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
    .join(" ");
}

/** TypeScript source for `<id>.config.ts`, built only from the validated id and numbers. */
export function worldConfigSource(id: string, bbox: Bbox, snapshot: string): string {
  const name = configExportName(id);
  if (!/^[0-9TZ:.-]+$/.test(snapshot)) throw new Error("snapshot must be an ISO date");
  for (const n of [bbox.south, bbox.west, bbox.north, bbox.east]) {
    if (!Number.isFinite(n)) throw new Error("bbox must be finite numbers");
  }
  return `/**
 * Area config for "${id}": a HAND-AUTHORED blank world made with the dev map
 * editor (\`/tools/map-editor/index.html\`, New world). Its raw caches carry this
 * exact bbox so \`loadOrFetchArea\` hits the cache.
 *
 * Layering: plain data module - no I/O, no network, no fs.
 */
import type { AreaConfig } from "./juliette-ga.config.ts";

export const ${name}: AreaConfig = {
  areaId: "${id}",
  name: "${titleFromId(id)} (authored world)",
  bbox: {
    south: ${String(bbox.south)},
    west: ${String(bbox.west)},
    north: ${String(bbox.north)},
    east: ${String(bbox.east)},
  },
  demSource: "none-flat-authored",
  osmSnapshot: "${snapshot}",
  osmExtract: "authored://heat-street/${id}",
  excludeHighwayClasses: [],
  surfaceFallbackAcknowledged: true,
};
`;
}

// ---------- grid / scale bar ----------

/** 1-2-5 x 10^k sequence, ascending, from 1 mm-ish up to 10^7 m. */
function* nice125(): Generator<number> {
  for (let k = -3; k <= 7; k++) {
    for (const m of [1, 2, 5]) yield Number((m * 10 ** k).toPrecision(12));
  }
}

/** Smallest 1-2-5 step (metres) whose on-screen size is at least `minPx`. */
export function gridStep(pxPerM: number, minPx: number): number {
  let last = 1;
  for (const s of nice125()) {
    last = s;
    if (s * pxPerM >= minPx - 1e-9) return s;
  }
  return last;
}

/** Largest 1-2-5 length (metres) that fits in `maxPx`, with its pixel size and label. */
export function scaleBar(
  pxPerM: number,
  maxPx: number,
): { metres: number; px: number; label: string } {
  let best = 1;
  for (const s of nice125()) {
    if (s * pxPerM <= maxPx + 1e-9) best = s;
    else break;
  }
  const label = best < 1000 ? `${best} m` : `${Number((best / 1000).toFixed(2))} km`;
  return { metres: best, px: best * pxPerM, label };
}

/** Tile border positions (metres) along each axis, always including the far edge. */
export function tileLines(
  widthM: number,
  heightM: number,
  tileM: number,
): { xs: number[]; ys: number[] } {
  const along = (len: number): number[] => {
    const out: number[] = [];
    for (let p = 0; p < len; p += tileM) out.push(p);
    out.push(len);
    return out;
  };
  return { xs: along(widthM), ys: along(heightM) };
}

// ---------- view maths ----------

/** scale = px per metre; screen y is down, world y is up. */
export interface View {
  scale: number;
  panX: number;
  panY: number;
}

export function fitView(
  widthM: number,
  heightM: number,
  canvasW: number,
  canvasH: number,
  marginPx: number,
): View {
  const scale = Math.max(
    1e-6,
    Math.min((canvasW - 2 * marginPx) / widthM, (canvasH - 2 * marginPx) / heightM),
  );
  return { scale, panX: (canvasW - widthM * scale) / 2, panY: (canvasH + heightM * scale) / 2 };
}

/** Zooms by `factor` keeping the world point under screen (sx, sy) fixed; clamps scale. */
export function zoomAt(
  view: View,
  factor: number,
  sx: number,
  sy: number,
  minScale: number,
  maxScale: number,
): View {
  const scale = Math.min(maxScale, Math.max(minScale, view.scale * factor));
  const wx = (sx - view.panX) / view.scale;
  const wy = (view.panY - sy) / view.scale;
  return { scale, panX: sx - wx * scale, panY: sy + wy * scale };
}

export function visibleRect(
  view: View,
  canvasW: number,
  canvasH: number,
): { minX: number; minY: number; maxX: number; maxY: number } {
  return {
    minX: -view.panX / view.scale,
    maxX: (canvasW - view.panX) / view.scale,
    maxY: view.panY / view.scale,
    minY: (view.panY - canvasH) / view.scale,
  };
}
