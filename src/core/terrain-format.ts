/**
 * Terrain area on-disk format (phase 04.2, D-11): a versioned little-endian
 * binary (`<id>.terrain.bin`: header + Uint16 heights + paint bytes) and a JSON
 * sidecar (`<id>.terrain.json`: road graph v1 verbatim, objects, buildings, id
 * counters). Normative byte layout: docs/schemas/terrain-area.v1.md.
 *
 * Header layout v1 (offsets in bytes, all little-endian):
 *   0  magic "HSTR"            4  formatVersion u16      6  headerBytes u16
 *   8  rows u32               12  cols u32              16  cellSizeM f32
 *   20 originX f64            28  originZ f64           36  heightOffsetSteps i32
 *   40 heightScaleM f32       44  colliderSubdiv u8     45  paintEncoding u8
 *   46 reserved u16           48  paintWidth u32        52  paintHeight u32
 *   56 paintMetresPerPixel f32 60 paintOriginX f64      68  paintOriginZ f64
 *   76 surfaceCount u8, then per surface: u8 length + ASCII name; zero padded
 *   to a 4-byte multiple. `headerBytes` is the padded total.
 * Then Uint16 heights[(rows+1)*(cols+1)] in `row + col * (rows + 1)` order,
 * zero padded to 4 bytes; then the paint section (raw bytes, or u32
 * compressedLength + deflate-raw bytes).
 *
 * Height quantisation: height = (q + heightOffsetSteps) * heightScaleM in
 * float64. The encoder picks heightOffsetSteps = floor(minHeight / scale), so
 * every multiple of the scale (including exactly 0) round-trips exactly.
 *
 * Hardening (T-04.2-06..09): every size is checked against caps and the exact
 * byte length BEFORE allocating; inflation aborts once it exceeds the declared
 * paint size; the sidecar is rebuilt field by field (no spread / assign from
 * parsed data) and its crest, ramp and building numbers are range-checked
 * (WR-08: they size allocations and Rapier shapes); decoded arrays are fresh
 * copies, never views into the input.
 *
 * Layering: pure core. CompressionStream/DecompressionStream are platform
 * globals (browsers and Node 24).
 */

import { type AuthoredCrest, type RampSpec, rampLengthM } from "./crest-geometry.ts";
import type { MapCollisionBuilding } from "./map-collision.ts";
import { parseRoadGraph, type RoadGraph } from "./road-graph.ts";
import { resolveBuildingStyle, resolveVariant } from "./scenery-catalog.ts";
import { SURFACE_TYPES, type SurfaceType } from "./surface-types.ts";
import { createTerrainGrid, type TerrainGrid } from "./terrain-grid.ts";
import { MAX_AREA_SIZE_M } from "./terrain-limits.ts";
import { MAX_PAINT_PIXELS, type PaintMap } from "./terrain-paint.ts";

export const TERRAIN_MAGIC = "HSTR";
export const TERRAIN_FORMAT_VERSION = 1;
export const MAX_TERRAIN_VERTICES = 4_000_000;
export const DEFAULT_HEIGHT_SCALE_M = 0.01;

const FIXED_HEADER_BYTES = 77;
const SIDECAR_KIND = "heat-street.terrain-area";

export interface TerrainBinary {
  grid: TerrainGrid;
  paint: PaintMap;
  colliderSubdiv: 1 | 2;
}

export type TerrainMigrations = Readonly<Record<number, (bytes: Uint8Array) => Uint8Array>>;

function pad4(n: number): number {
  return (n + 3) & ~3;
}

function fail(label: string, message: string): never {
  throw new Error(`terrain-format: ${label}: ${message}`);
}

async function deflateRaw(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data as BlobPart])
    .stream()
    .pipeThrough(new CompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Inflates `data`, aborting as soon as the output exceeds `expected` bytes. */
async function inflateRawCapped(
  data: Uint8Array,
  expected: number,
  label: string,
): Promise<Uint8Array> {
  const ds = new DecompressionStream("deflate-raw");
  const writer = ds.writable.getWriter();
  // Errors surface on the read side; swallow the write-side duplicates.
  const written = writer
    .write(data as BufferSource)
    .then(() => writer.close())
    .catch(() => undefined);
  const reader = ds.readable.getReader();
  const out = new Uint8Array(expected);
  let n = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (n + value.length > expected) {
        await reader.cancel().catch(() => undefined);
        fail(label, `paint section inflates to more than ${expected} bytes`);
      }
      out.set(value, n);
      n += value.length;
    }
  } catch (e) {
    if (e instanceof Error && e.message.startsWith("terrain-format:")) throw e;
    fail(label, "paint section is not valid deflate data");
  }
  await written;
  if (n !== expected) {
    fail(label, `paint section inflates to ${n} bytes, expected ${expected}`);
  }
  return out;
}

export async function encodeTerrainBinary(
  binary: TerrainBinary,
  opts: { paintEncoding?: 0 | 1; heightScaleM?: number } = {},
): Promise<Uint8Array> {
  const { grid, paint, colliderSubdiv } = binary;
  const paintEncoding = opts.paintEncoding ?? 1;
  const scale = Math.fround(opts.heightScaleM ?? DEFAULT_HEIGHT_SCALE_M);
  if (!Number.isFinite(scale) || scale <= 0) {
    throw new RangeError(`heightScaleM must be finite and > 0, got ${scale}`);
  }
  const count = (grid.rows + 1) * (grid.cols + 1);
  if (grid.heights.length !== count) {
    throw new RangeError(`grid heights length ${grid.heights.length} != ${count}`);
  }
  if (count > MAX_TERRAIN_VERTICES) {
    throw new RangeError(`terrain grid has ${count} vertices, max ${MAX_TERRAIN_VERTICES}`);
  }
  if (paint.data.length !== paint.width * paint.height) {
    throw new RangeError(
      `paint data length ${paint.data.length} != ${paint.width}x${paint.height}`,
    );
  }
  if (paint.data.length > MAX_PAINT_PIXELS) {
    throw new RangeError(`paint map exceeds ${MAX_PAINT_PIXELS} pixels`);
  }

  let minH = Number.POSITIVE_INFINITY;
  let maxH = Number.NEGATIVE_INFINITY;
  for (let i = 0; i < count; i++) {
    const h = grid.heights[i];
    if (!Number.isFinite(h)) throw new RangeError(`non-finite height at vertex ${i}`);
    if (h < minH) minH = h;
    if (h > maxH) maxH = h;
  }
  const offsetSteps = Math.floor(minH / scale);
  const maxSteps = Math.round(maxH / scale);
  if (maxSteps - offsetSteps > 65535) {
    throw new RangeError(
      `height span ${(maxH - minH).toFixed(2)} m (${minH} to ${maxH}) exceeds the 16-bit range at ${scale} m per step`,
    );
  }

  // CR-01: quantise and copy the paint SYNCHRONOUSLY, before the deflate await
  // yields to the event loop, so the file is one consistent snapshot even if
  // the caller keeps editing `grid.heights` / `paint.data` during the save.
  // Every quantised value is range-checked: DataView.setUint16 would silently
  // wrap an out-of-range step (a 1 cm dip saved as +655 m).
  const quantised = new Uint16Array(count);
  for (let i = 0; i < count; i++) {
    const v = Math.round(grid.heights[i] / scale) - offsetSteps;
    if (!(v >= 0 && v <= 65535)) {
      throw new RangeError(`height at vertex ${i} is outside the encoded 16-bit range`);
    }
    quantised[i] = v;
  }
  const paintSnapshot = paint.data.slice();

  const enumBytes = SURFACE_TYPES.map((s) => s.length).reduce((a, b) => a + 1 + b, 0);
  const headerBytes = pad4(FIXED_HEADER_BYTES + enumBytes);
  const heightBytes = pad4(count * 2);
  let paintSection: Uint8Array;
  if (paintEncoding === 1) {
    const comp = await deflateRaw(paintSnapshot);
    paintSection = new Uint8Array(4 + comp.length);
    new DataView(paintSection.buffer).setUint32(0, comp.length, true);
    paintSection.set(comp, 4);
  } else {
    paintSection = paintSnapshot;
  }

  const out = new Uint8Array(headerBytes + heightBytes + paintSection.length);
  const dv = new DataView(out.buffer);
  for (let i = 0; i < 4; i++) out[i] = TERRAIN_MAGIC.charCodeAt(i);
  dv.setUint16(4, TERRAIN_FORMAT_VERSION, true);
  dv.setUint16(6, headerBytes, true);
  dv.setUint32(8, grid.rows, true);
  dv.setUint32(12, grid.cols, true);
  dv.setFloat32(16, grid.cellSizeM, true);
  dv.setFloat64(20, grid.originX, true);
  dv.setFloat64(28, grid.originZ, true);
  dv.setInt32(36, offsetSteps, true);
  dv.setFloat32(40, scale, true);
  dv.setUint8(44, colliderSubdiv);
  dv.setUint8(45, paintEncoding);
  dv.setUint16(46, 0, true);
  dv.setUint32(48, paint.width, true);
  dv.setUint32(52, paint.height, true);
  dv.setFloat32(56, paint.metresPerPixel, true);
  dv.setFloat64(60, paint.originX, true);
  dv.setFloat64(68, paint.originZ, true);
  dv.setUint8(76, SURFACE_TYPES.length);
  let p = FIXED_HEADER_BYTES;
  for (const name of SURFACE_TYPES) {
    out[p++] = name.length;
    for (let i = 0; i < name.length; i++) out[p++] = name.charCodeAt(i);
  }
  for (let i = 0; i < count; i++) {
    dv.setUint16(headerBytes + i * 2, quantised[i], true);
  }
  out.set(paintSection, headerBytes + heightBytes);
  return out;
}

export async function decodeTerrainBinary(
  input: ArrayBuffer | Uint8Array,
  sourceLabel: string,
  migrations: TerrainMigrations = {},
): Promise<TerrainBinary> {
  let bytes = input instanceof Uint8Array ? input : new Uint8Array(input);

  // Version first (needs only 8 bytes), so migrations can reshape older files.
  for (let guard = 0; ; guard++) {
    if (bytes.length < 8)
      fail(sourceLabel, `truncated: ${bytes.length} bytes, header needs at least 8`);
    for (let i = 0; i < 4; i++) {
      if (bytes[i] !== TERRAIN_MAGIC.charCodeAt(i))
        fail(sourceLabel, `bad magic, expected "${TERRAIN_MAGIC}"`);
    }
    const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint16(4, true);
    if (v === TERRAIN_FORMAT_VERSION) break;
    if (v > TERRAIN_FORMAT_VERSION) {
      fail(
        sourceLabel,
        `unknown format version ${v} (this build reads up to ${TERRAIN_FORMAT_VERSION})`,
      );
    }
    const migrate = migrations[v];
    if (!migrate || guard > TERRAIN_FORMAT_VERSION) {
      fail(sourceLabel, `no migration from format version ${v} to ${TERRAIN_FORMAT_VERSION}`);
    }
    bytes = migrate(bytes);
  }

  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const headerBytes = dv.getUint16(6, true);
  if (headerBytes < FIXED_HEADER_BYTES + 1 || headerBytes % 4 !== 0) {
    fail(sourceLabel, `header.headerBytes ${headerBytes} is invalid`);
  }
  if (bytes.length < headerBytes) {
    fail(sourceLabel, `truncated: ${bytes.length} bytes, header needs ${headerBytes}`);
  }

  const rows = dv.getUint32(8, true);
  const cols = dv.getUint32(12, true);
  const cellSizeM = dv.getFloat32(16, true);
  const originX = dv.getFloat64(20, true);
  const originZ = dv.getFloat64(28, true);
  const offsetSteps = dv.getInt32(36, true);
  const scale = dv.getFloat32(40, true);
  const colliderSubdiv = dv.getUint8(44);
  const paintEncoding = dv.getUint8(45);
  const paintWidth = dv.getUint32(48, true);
  const paintHeight = dv.getUint32(52, true);
  const mpp = dv.getFloat32(56, true);
  const paintOriginX = dv.getFloat64(60, true);
  const paintOriginZ = dv.getFloat64(68, true);
  const surfaceCount = dv.getUint8(76);

  if (rows < 1 || cols < 1) fail(sourceLabel, `header rows/cols must be >= 1, got ${rows}x${cols}`);
  const vertexCount = (rows + 1) * (cols + 1);
  if (vertexCount > MAX_TERRAIN_VERTICES) {
    fail(sourceLabel, `header vertex count ${vertexCount} exceeds ${MAX_TERRAIN_VERTICES}`);
  }
  if (paintWidth < 1 || paintHeight < 1) fail(sourceLabel, "header paint size must be >= 1");
  const paintPixels = paintWidth * paintHeight;
  if (paintPixels > MAX_PAINT_PIXELS) {
    fail(sourceLabel, `header paint pixel count ${paintPixels} exceeds ${MAX_PAINT_PIXELS}`);
  }
  if (!Number.isFinite(cellSizeM) || cellSizeM <= 0)
    fail(sourceLabel, "header cellSizeM must be finite and > 0");
  if (!Number.isFinite(scale) || scale <= 0)
    fail(sourceLabel, "header heightScaleM must be finite and > 0");
  if (!Number.isFinite(mpp) || mpp <= 0)
    fail(sourceLabel, "header paintMetresPerPixel must be finite and > 0");
  if (!Number.isFinite(originX) || !Number.isFinite(originZ))
    fail(sourceLabel, "header origin must be finite");
  if (!Number.isFinite(paintOriginX) || !Number.isFinite(paintOriginZ)) {
    fail(sourceLabel, "header paint origin must be finite");
  }
  if (colliderSubdiv !== 1 && colliderSubdiv !== 2) {
    fail(sourceLabel, `header colliderSubdiv must be 1 or 2, got ${colliderSubdiv}`);
  }
  if (paintEncoding !== 0 && paintEncoding !== 1) {
    fail(sourceLabel, `header paintEncoding must be 0 or 1, got ${paintEncoding}`);
  }

  // Surface enum: names must be known; remap file order to current order.
  const fileToCurrent: number[] = [];
  let p = FIXED_HEADER_BYTES;
  for (let s = 0; s < surfaceCount; s++) {
    if (p >= headerBytes) fail(sourceLabel, "header surface enum runs past headerBytes");
    const len = bytes[p++];
    if (p + len > headerBytes) fail(sourceLabel, "header surface enum runs past headerBytes");
    let name = "";
    for (let i = 0; i < len; i++) name += String.fromCharCode(bytes[p + i]);
    p += len;
    const idx = (SURFACE_TYPES as readonly string[]).indexOf(name);
    if (idx < 0) fail(sourceLabel, `header surface enum lists unknown surface "${name}"`);
    fileToCurrent.push(idx);
  }

  const heightBytes = pad4(vertexCount * 2);
  const heightsStart = headerBytes;
  const paintStart = heightsStart + heightBytes;
  let compLen = 0;
  if (paintEncoding === 0) {
    if (bytes.length !== paintStart + paintPixels) {
      fail(sourceLabel, `byte length ${bytes.length} != expected ${paintStart + paintPixels}`);
    }
  } else {
    if (bytes.length < paintStart + 4) {
      fail(sourceLabel, `truncated: ${bytes.length} bytes, need at least ${paintStart + 4}`);
    }
    compLen = dv.getUint32(paintStart, true);
    if (bytes.length !== paintStart + 4 + compLen) {
      fail(sourceLabel, `byte length ${bytes.length} != expected ${paintStart + 4 + compLen}`);
    }
  }

  const grid = createTerrainGrid({ rows, cols, cellSizeM, originX, originZ });
  for (let i = 0; i < vertexCount; i++) {
    grid.heights[i] = (dv.getUint16(heightsStart + i * 2, true) + offsetSteps) * scale;
  }

  let paintData: Uint8Array;
  if (paintEncoding === 0) {
    paintData = bytes.slice(paintStart, paintStart + paintPixels);
  } else {
    paintData = await inflateRawCapped(
      bytes.subarray(paintStart + 4, paintStart + 4 + compLen),
      paintPixels,
      sourceLabel,
    );
  }
  let identity = surfaceCount === SURFACE_TYPES.length;
  for (let i = 0; identity && i < fileToCurrent.length; i++) identity = fileToCurrent[i] === i;
  if (!identity) {
    const lut = new Uint8Array(256);
    for (let b = 0; b < 256; b++) {
      const low = b & 0x0f;
      lut[b] = low < fileToCurrent.length ? (b & 0xf0) | fileToCurrent[low] : b;
    }
    for (let i = 0; i < paintData.length; i++) paintData[i] = lut[paintData[i]];
  }

  return {
    grid,
    paint: {
      width: paintWidth,
      height: paintHeight,
      metresPerPixel: mpp,
      originX: paintOriginX,
      originZ: paintOriginZ,
      data: paintData,
    },
    colliderSubdiv,
  };
}

// ---------------------------------------------------------------- sidecar

export type TerrainObject = { readonly kind: "crest"; readonly crest: AuthoredCrest };

/** Everything the JSON half carries. */
export interface TerrainSidecar {
  readonly areaId: string;
  readonly name: string;
  readonly groundSurface: SurfaceType;
  readonly legacyGlbBuildings: boolean;
  readonly nextEdgeId: number;
  readonly graph: RoadGraph;
  readonly objects: readonly TerrainObject[];
  readonly buildings: readonly TerrainBuilding[];
  /**
   * Quick 261110-rdx (DD-2): ids of road-graph edges the editor has UNLOCKED (not held by the
   * road mask). Absent or empty = every road locked. Written only when non-empty so all-locked
   * areas serialise exactly as before. The game runtime ignores it.
   */
  readonly unlockedEdgeIds?: readonly number[];
  /**
   * 07.1.3 D-01/D-02: authored start points; the first entry is the map default (D-03).
   * Written only when non-empty so existing sidecars serialise exactly as before.
   */
  readonly startPoints?: readonly TerrainStartPoint[];
  /** 07.1.3 D-07: scenery (trees, bushes, hedges, fences). Written only when non-empty. */
  readonly features?: readonly TerrainFeature[];
}

/** 07.1.3 D-07: a placed tree or bush. `variant` is a scenery-catalog id (D-08). */
export type TerrainPointFeature = {
  readonly id: string;
  readonly kind: "tree" | "bush";
  readonly variant: string;
  readonly x: number;
  readonly z: number;
  readonly rotationY: number;
  readonly scale: number;
};

/** 07.1.3 D-07: a hedge or fence polyline. */
export type TerrainLineFeature = {
  readonly id: string;
  readonly kind: "hedge" | "fence";
  readonly variant: string;
  readonly points: readonly (readonly [number, number])[];
  readonly heightM: number;
};

export type TerrainFeature = TerrainPointFeature | TerrainLineFeature;

/** A building plus an optional catalog style id (07.1.3 D-07). */
export interface TerrainBuilding extends MapCollisionBuilding {
  readonly style?: string;
}

export const MAX_POINT_FEATURES = 4000;
export const MAX_LINE_FEATURES = 500;
export const MAX_LINE_POINTS = 64;
export const MAX_BUILDINGS = 2000;
export const MIN_FEATURE_SCALE = 0.5;
export const MAX_FEATURE_SCALE = 2;
export const MAX_LINE_HEIGHT_M = 6;
export const MAX_FEATURE_ID_CHARS = 32;

/** 07.1.3 D-01: a named spawn pose on the map. headingRad uses the VehiclePose yaw convention. */
export interface TerrainStartPoint {
  readonly id: string;
  readonly name: string;
  readonly x: number;
  readonly z: number;
  readonly headingRad: number;
}

export const MAX_START_POINTS = 32;
export const MAX_START_NAME_CHARS = 40;
export const MAX_COORD_ABS_M = 100000;

export interface TerrainArea extends TerrainSidecar {
  readonly grid: TerrainGrid;
  readonly paint: PaintMap;
  readonly colliderSubdiv: 1 | 2;
}

type Rec = Record<string, unknown>;

function isRec(v: unknown): v is Rec {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function reqNum(label: string, o: Rec, key: string, ctx: string): number {
  const v = o[key];
  if (typeof v !== "number" || !Number.isFinite(v))
    fail(label, `${ctx}.${key} must be a finite number`);
  return v;
}

function reqStr(label: string, o: Rec, key: string, ctx: string): string {
  const v = o[key];
  if (typeof v !== "string") fail(label, `${ctx}.${key} must be a string`);
  return v;
}

function reqBool(label: string, o: Rec, key: string, ctx: string): boolean {
  const v = o[key];
  if (typeof v !== "boolean") fail(label, `${ctx}.${key} must be a boolean`);
  return v;
}

function reqRec(label: string, o: Rec, key: string, ctx: string): Rec {
  const v = o[key];
  if (!isRec(v)) fail(label, `${ctx}.${key} must be an object`);
  return v;
}

function reqVec3(label: string, o: Rec, key: string, ctx: string) {
  const r = reqRec(label, o, key, ctx);
  const c = `${ctx}.${key}`;
  return { x: reqNum(label, r, "x", c), y: reqNum(label, r, "y", c), z: reqNum(label, r, "z", c) };
}

/**
 * WR-08: a finite number inside `(min, max]` (or `[min, max]` when
 * `minInclusive`). Consumers allocate from these values (ramp length ->
 * Float32Array size) or hand them to Rapier, so "finite" alone is not enough.
 */
function reqRange(
  label: string,
  o: Rec,
  key: string,
  ctx: string,
  min: number,
  max: number,
  minInclusive = false,
): number {
  const v = reqNum(label, o, key, ctx);
  const okMin = minInclusive ? v >= min : v > min;
  if (!okMin || v > max) {
    fail(label, `${ctx}.${key} must be in ${minInclusive ? "[" : "("}${min}, ${max}], got ${v}`);
  }
  return v;
}

/** Largest crest / ramp height accepted from a sidecar (m). */
export const MAX_CREST_HEIGHT_M = 200;

function parseRamp(label: string, raw: unknown, ctx: string): RampSpec {
  if (!isRec(raw)) fail(label, `${ctx} must be an object`);
  const angleDeg = reqNum(label, raw, "angleDeg", ctx);
  if (!(angleDeg > 0 && angleDeg < 90)) {
    fail(label, `${ctx}.angleDeg must be in (0, 90), got ${angleDeg}`);
  }
  return {
    headingRad: reqNum(label, raw, "headingRad", ctx),
    widthM: reqRange(label, raw, "widthM", ctx, 0, MAX_AREA_SIZE_M),
    angleDeg,
    footRadiusM: reqRange(label, raw, "footRadiusM", ctx, 0, MAX_AREA_SIZE_M, true),
  };
}

function parseObject(label: string, raw: unknown, index: number): TerrainObject {
  const ctx = `objects[${index}]`;
  if (!isRec(raw)) fail(label, `${ctx} must be an object`);
  const kind = raw.kind;
  if (kind !== "crest") fail(label, `${ctx}.kind unknown object kind ${JSON.stringify(kind)}`);
  const isRamp = raw.ramp !== undefined;
  const base = {
    id: reqStr(label, raw, "id", ctx),
    centerX: reqNum(label, raw, "centerX", ctx),
    centerZ: reqNum(label, raw, "centerZ", ctx),
    // A ramp derives its length from the ramp spec; radiusM is unused (0).
    radiusM: reqRange(label, raw, "radiusM", ctx, 0, MAX_AREA_SIZE_M, isRamp),
    heightM: reqRange(label, raw, "heightM", ctx, 0, MAX_CREST_HEIGHT_M),
  };
  if (!isRamp) return { kind: "crest", crest: base };
  const ramp = parseRamp(label, raw.ramp, `${ctx}.ramp`);
  const length = rampLengthM(base.heightM, ramp);
  if (!(Number.isFinite(length) && length <= MAX_AREA_SIZE_M)) {
    fail(label, `${ctx}.ramp is ${length} m long, max ${MAX_AREA_SIZE_M} (angle too shallow?)`);
  }
  return { kind: "crest", crest: { ...base, ramp } };
}

function parseBuilding(label: string, raw: unknown, index: number): TerrainBuilding {
  const ctx = `buildings[${index}]`;
  if (!isRec(raw)) fail(label, `${ctx} must be an object`);
  const he = reqRec(label, raw, "halfExtents", ctx);
  const hctx = `${ctx}.halfExtents`;
  let style: string | undefined;
  if (raw.style !== undefined) {
    if (typeof raw.style !== "string" || resolveBuildingStyle(raw.style) === undefined) {
      fail(label, `${ctx}.style unknown building style ${JSON.stringify(raw.style)}`);
    }
    style = raw.style;
  }
  return {
    center: reqVec3(label, raw, "center", ctx),
    halfExtents: {
      x: reqRange(label, he, "x", hctx, 0, MAX_AREA_SIZE_M),
      y: reqRange(label, he, "y", hctx, 0, MAX_AREA_SIZE_M),
      z: reqRange(label, he, "z", hctx, 0, MAX_AREA_SIZE_M),
    },
    rotationY: reqNum(label, raw, "rotationY", ctx),
    ...(style !== undefined ? { style } : {}),
  };
}

function reqCoord(label: string, o: Rec, key: string, ctx: string): number {
  const v = reqNum(label, o, key, ctx);
  if (Math.abs(v) > MAX_COORD_ABS_M) fail(label, `${ctx}.${key} out of range, got ${v}`);
  return v;
}

function parseFeatures(label: string, raw: unknown): TerrainFeature[] {
  if (!Array.isArray(raw)) fail(label, "root.features must be an array");
  const ids = new Set<string>();
  const out: TerrainFeature[] = [];
  let pointCount = 0;
  let lineCount = 0;
  for (const [i, e] of (raw as unknown[]).entries()) {
    const ctx = `features[${i}]`;
    if (!isRec(e)) fail(label, `${ctx} must be an object`);
    const id = reqStr(label, e, "id", ctx);
    if (id.length < 1 || id.length > MAX_FEATURE_ID_CHARS) {
      fail(label, `${ctx}.id must be 1..${MAX_FEATURE_ID_CHARS} characters`);
    }
    if (ids.has(id)) fail(label, `${ctx}.id duplicate feature id ${JSON.stringify(id)}`);
    ids.add(id);
    const kind = e.kind;
    const variantId = reqStr(label, e, "variant", ctx);
    if (kind === "tree" || kind === "bush") {
      if (++pointCount > MAX_POINT_FEATURES) {
        fail(label, `root.features has more than ${MAX_POINT_FEATURES} point features`);
      }
      if (resolveVariant(kind, variantId) === undefined) {
        fail(label, `${ctx}.variant unknown ${kind} variant ${JSON.stringify(variantId)}`);
      }
      const scale = reqNum(label, e, "scale", ctx);
      if (scale < MIN_FEATURE_SCALE || scale > MAX_FEATURE_SCALE) {
        fail(
          label,
          `${ctx}.scale must be in [${MIN_FEATURE_SCALE}, ${MAX_FEATURE_SCALE}], got ${scale}`,
        );
      }
      out.push({
        id,
        kind,
        variant: variantId,
        x: reqCoord(label, e, "x", ctx),
        z: reqCoord(label, e, "z", ctx),
        rotationY: reqNum(label, e, "rotationY", ctx),
        scale,
      });
    } else if (kind === "hedge" || kind === "fence") {
      if (++lineCount > MAX_LINE_FEATURES) {
        fail(label, `root.features has more than ${MAX_LINE_FEATURES} line features`);
      }
      const variant =
        kind === "hedge" ? resolveVariant("hedge", variantId) : resolveVariant("fence", variantId);
      if (variant === undefined) {
        fail(label, `${ctx}.variant unknown ${kind} variant ${JSON.stringify(variantId)}`);
      }
      const rawPts = e.points;
      if (!Array.isArray(rawPts) || rawPts.length < 2 || rawPts.length > MAX_LINE_POINTS) {
        fail(label, `${ctx}.points must be an array of 2..${MAX_LINE_POINTS} points`);
      }
      const points: [number, number][] = [];
      for (const [j, p] of (rawPts as unknown[]).entries()) {
        const pc = `${ctx}.points[${j}]`;
        if (!Array.isArray(p) || p.length !== 2) fail(label, `${pc} must be [x, z]`);
        const [px, pz] = p as unknown[];
        for (const v of [px, pz]) {
          if (typeof v !== "number" || !Number.isFinite(v) || Math.abs(v) > MAX_COORD_ABS_M) {
            fail(label, `${pc} must hold finite coordinates within +-${MAX_COORD_ABS_M}`);
          }
        }
        points.push([px as number, pz as number]);
      }
      const heightM = reqNum(label, e, "heightM", ctx);
      if (heightM < variant.minHeightM || heightM > MAX_LINE_HEIGHT_M) {
        fail(
          label,
          `${ctx}.heightM must be in [${variant.minHeightM}, ${MAX_LINE_HEIGHT_M}], got ${heightM}`,
        );
      }
      out.push({ id, kind, variant: variantId, points, heightM });
    } else {
      fail(label, `${ctx}.kind unknown feature kind ${JSON.stringify(kind)}`);
    }
  }
  return out;
}

function parseStartPoints(label: string, raw: unknown): TerrainStartPoint[] {
  if (!Array.isArray(raw)) fail(label, "root.startPoints must be an array");
  if (raw.length > MAX_START_POINTS) {
    fail(label, `root.startPoints has ${raw.length} entries, max ${MAX_START_POINTS}`);
  }
  const ids = new Set<string>();
  const out: TerrainStartPoint[] = [];
  for (const [i, e] of (raw as unknown[]).entries()) {
    const ctx = `startPoints[${i}]`;
    if (!isRec(e)) fail(label, `${ctx} must be an object`);
    const id = reqStr(label, e, "id", ctx);
    if (id.length === 0) fail(label, `${ctx}.id must be non-empty`);
    if (ids.has(id)) fail(label, `${ctx}.id duplicate start point id ${JSON.stringify(id)}`);
    ids.add(id);
    const name = reqStr(label, e, "name", ctx);
    if (name.length < 1 || name.length > MAX_START_NAME_CHARS) {
      fail(label, `${ctx}.name must be 1..${MAX_START_NAME_CHARS} characters`);
    }
    const x = reqNum(label, e, "x", ctx);
    const z = reqNum(label, e, "z", ctx);
    if (Math.abs(x) > MAX_COORD_ABS_M) fail(label, `${ctx}.x out of range, got ${x}`);
    if (Math.abs(z) > MAX_COORD_ABS_M) fail(label, `${ctx}.z out of range, got ${z}`);
    out.push({ id, name, x, z, headingRad: reqNum(label, e, "headingRad", ctx) });
  }
  return out;
}

export function serializeTerrainSidecar(area: TerrainSidecar): string {
  const objects = area.objects.map((o) => {
    const c = o.crest;
    const base = {
      kind: o.kind,
      id: c.id,
      centerX: c.centerX,
      centerZ: c.centerZ,
      radiusM: c.radiusM,
      heightM: c.heightM,
    };
    return c.ramp
      ? {
          ...base,
          ramp: {
            headingRad: c.ramp.headingRad,
            widthM: c.ramp.widthM,
            angleDeg: c.ramp.angleDeg,
            footRadiusM: c.ramp.footRadiusM,
          },
        }
      : base;
  });
  const buildings = area.buildings.map((b) => ({
    center: { x: b.center.x, y: b.center.y, z: b.center.z },
    halfExtents: { x: b.halfExtents.x, y: b.halfExtents.y, z: b.halfExtents.z },
    rotationY: b.rotationY,
    ...(b.style !== undefined ? { style: b.style } : {}),
  }));
  const wire = {
    kind: SIDECAR_KIND,
    formatVersion: TERRAIN_FORMAT_VERSION,
    areaId: area.areaId,
    name: area.name,
    groundSurface: area.groundSurface,
    legacyGlbBuildings: area.legacyGlbBuildings,
    nextEdgeId: area.nextEdgeId,
    graph: area.graph,
    objects,
    buildings,
    ...(area.unlockedEdgeIds !== undefined && area.unlockedEdgeIds.length > 0
      ? { unlockedEdgeIds: [...area.unlockedEdgeIds].sort((a, b) => a - b) }
      : {}),
    ...(area.startPoints !== undefined && area.startPoints.length > 0
      ? {
          startPoints: area.startPoints.map((p) => ({
            id: p.id,
            name: p.name,
            x: p.x,
            z: p.z,
            headingRad: p.headingRad,
          })),
        }
      : {}),
    ...(area.features !== undefined && area.features.length > 0
      ? {
          features: area.features.map((f) =>
            !("points" in f)
              ? {
                  id: f.id,
                  kind: f.kind,
                  variant: f.variant,
                  x: f.x,
                  z: f.z,
                  rotationY: f.rotationY,
                  scale: f.scale,
                }
              : {
                  id: f.id,
                  kind: f.kind,
                  variant: f.variant,
                  points: f.points.map((p) => [p[0], p[1]]),
                  heightM: f.heightM,
                },
          ),
        }
      : {}),
  };
  return `${JSON.stringify(wire, null, 2)}\n`;
}

export function parseTerrainSidecar(
  text: string,
  expectedAreaId: string,
  sourceLabel: string,
): TerrainSidecar {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    fail(sourceLabel, "not valid JSON");
  }
  if (!isRec(parsed)) fail(sourceLabel, "root value must be a JSON object");
  if (parsed.kind !== SIDECAR_KIND) {
    fail(sourceLabel, `kind must be "${SIDECAR_KIND}", got ${JSON.stringify(parsed.kind)}`);
  }
  if (parsed.formatVersion !== TERRAIN_FORMAT_VERSION) {
    fail(
      sourceLabel,
      `formatVersion mismatch: expected ${TERRAIN_FORMAT_VERSION}, found ${JSON.stringify(parsed.formatVersion)}`,
    );
  }
  const areaId = reqStr(sourceLabel, parsed, "areaId", "root");
  if (areaId !== expectedAreaId) {
    fail(sourceLabel, `areaId mismatch: expected "${expectedAreaId}", found "${areaId}"`);
  }
  const name = reqStr(sourceLabel, parsed, "name", "root");
  const groundSurface = reqStr(sourceLabel, parsed, "groundSurface", "root");
  if (!(SURFACE_TYPES as readonly string[]).includes(groundSurface)) {
    fail(sourceLabel, `root.groundSurface unknown surface "${groundSurface}"`);
  }
  const legacyGlbBuildings = reqBool(sourceLabel, parsed, "legacyGlbBuildings", "root");
  const nextEdgeId = reqNum(sourceLabel, parsed, "nextEdgeId", "root");
  if (!Number.isInteger(nextEdgeId) || nextEdgeId < 0) {
    fail(sourceLabel, "root.nextEdgeId must be a non-negative integer");
  }

  if (!isRec(parsed.graph)) fail(sourceLabel, "root.graph must be an object");
  const graph = parseRoadGraph(JSON.stringify(parsed.graph), `${sourceLabel}#graph`);
  if (graph.areaId !== expectedAreaId) {
    fail(
      sourceLabel,
      `graph.areaId mismatch: expected "${expectedAreaId}", found "${graph.areaId}"`,
    );
  }
  let maxEdgeId = -1;
  for (const e of graph.edges) if (e.id > maxEdgeId) maxEdgeId = e.id;
  if (nextEdgeId <= maxEdgeId) {
    fail(sourceLabel, `root.nextEdgeId ${nextEdgeId} must exceed the largest edge id ${maxEdgeId}`);
  }

  if (!Array.isArray(parsed.objects)) fail(sourceLabel, "root.objects must be an array");
  if (!Array.isArray(parsed.buildings)) fail(sourceLabel, "root.buildings must be an array");
  const objects = parsed.objects.map((o, i) => parseObject(sourceLabel, o, i));
  const crestIds = new Set<string>();
  for (const [i, o] of objects.entries()) {
    if (crestIds.has(o.crest.id)) {
      fail(sourceLabel, `objects[${i}].id duplicate crest id ${JSON.stringify(o.crest.id)}`);
    }
    crestIds.add(o.crest.id);
  }
  if (parsed.buildings.length > MAX_BUILDINGS) {
    fail(
      sourceLabel,
      `root.buildings has ${parsed.buildings.length} entries, max ${MAX_BUILDINGS}`,
    );
  }
  const buildings = parsed.buildings.map((b, i) => parseBuilding(sourceLabel, b, i));

  let unlockedEdgeIds: number[] = [];
  if (parsed.unlockedEdgeIds !== undefined) {
    if (!Array.isArray(parsed.unlockedEdgeIds)) {
      fail(sourceLabel, "root.unlockedEdgeIds must be an array");
    }
    const edgeIds = new Set(graph.edges.map((e) => e.id));
    const seen = new Set<number>();
    for (const [i, v] of (parsed.unlockedEdgeIds as unknown[]).entries()) {
      if (typeof v !== "number" || !Number.isInteger(v) || v < 0) {
        fail(sourceLabel, `root.unlockedEdgeIds[${i}] must be a non-negative integer`);
      }
      if (seen.has(v)) fail(sourceLabel, `root.unlockedEdgeIds[${i}] duplicate edge id ${v}`);
      if (!edgeIds.has(v)) fail(sourceLabel, `root.unlockedEdgeIds[${i}] unknown edge id ${v}`);
      seen.add(v);
      unlockedEdgeIds.push(v);
    }
    unlockedEdgeIds = unlockedEdgeIds.sort((a, b) => a - b);
  }

  const startPoints =
    parsed.startPoints !== undefined ? parseStartPoints(sourceLabel, parsed.startPoints) : [];

  const features = parsed.features !== undefined ? parseFeatures(sourceLabel, parsed.features) : [];

  return {
    areaId,
    name,
    groundSurface: groundSurface as SurfaceType,
    legacyGlbBuildings,
    nextEdgeId,
    graph,
    objects,
    buildings,
    ...(unlockedEdgeIds.length > 0 ? { unlockedEdgeIds } : {}),
    ...(startPoints.length > 0 ? { startPoints } : {}),
    ...(features.length > 0 ? { features } : {}),
  };
}

export async function loadTerrainArea(
  binBytes: ArrayBuffer | Uint8Array,
  sidecarText: string,
  expectedAreaId: string,
  sourceLabel: string,
  migrations?: TerrainMigrations,
): Promise<TerrainArea> {
  const bin = await decodeTerrainBinary(binBytes, `${sourceLabel}.bin`, migrations);
  const side = parseTerrainSidecar(sidecarText, expectedAreaId, `${sourceLabel}.json`);
  const g = bin.grid;
  const b = side.graph.bounds;
  const slack = g.cellSizeM;
  if (
    b.minX < g.originX - slack ||
    b.maxX > g.originX + g.scaleX + slack ||
    b.minZ < g.originZ - slack ||
    b.maxZ > g.originZ + g.scaleZ + slack
  ) {
    fail(sourceLabel, "graph bounds lie outside the terrain grid extent by more than one cell");
  }
  return {
    areaId: side.areaId,
    name: side.name,
    grid: bin.grid,
    paint: bin.paint,
    colliderSubdiv: bin.colliderSubdiv,
    groundSurface: side.groundSurface,
    graph: side.graph,
    objects: side.objects,
    buildings: side.buildings,
    legacyGlbBuildings: side.legacyGlbBuildings,
    nextEdgeId: side.nextEdgeId,
    ...(side.unlockedEdgeIds !== undefined ? { unlockedEdgeIds: side.unlockedEdgeIds } : {}),
    ...(side.startPoints !== undefined ? { startPoints: side.startPoints } : {}),
    ...(side.features !== undefined ? { features: side.features } : {}),
  };
}
