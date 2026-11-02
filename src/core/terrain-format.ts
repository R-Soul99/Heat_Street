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
 * parsed data); decoded arrays are fresh copies, never views into the input.
 *
 * Layering: pure core. CompressionStream/DecompressionStream are platform
 * globals (browsers and Node 24).
 */

import type { AuthoredCrest, RampSpec } from "./crest-geometry.ts";
import type { MapCollisionBuilding } from "./map-collision.ts";
import { parseRoadGraph, type RoadGraph } from "./road-graph.ts";
import { SURFACE_TYPES, type SurfaceType } from "./surface-types.ts";
import { createTerrainGrid, type TerrainGrid } from "./terrain-grid.ts";
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
  readonly buildings: readonly MapCollisionBuilding[];
}

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

function parseRamp(label: string, raw: unknown, ctx: string): RampSpec {
  if (!isRec(raw)) fail(label, `${ctx} must be an object`);
  return {
    headingRad: reqNum(label, raw, "headingRad", ctx),
    widthM: reqNum(label, raw, "widthM", ctx),
    angleDeg: reqNum(label, raw, "angleDeg", ctx),
    footRadiusM: reqNum(label, raw, "footRadiusM", ctx),
  };
}

function parseObject(label: string, raw: unknown, index: number): TerrainObject {
  const ctx = `objects[${index}]`;
  if (!isRec(raw)) fail(label, `${ctx} must be an object`);
  const kind = raw.kind;
  if (kind !== "crest") fail(label, `${ctx}.kind unknown object kind ${JSON.stringify(kind)}`);
  const base = {
    id: reqStr(label, raw, "id", ctx),
    centerX: reqNum(label, raw, "centerX", ctx),
    centerZ: reqNum(label, raw, "centerZ", ctx),
    radiusM: reqNum(label, raw, "radiusM", ctx),
    heightM: reqNum(label, raw, "heightM", ctx),
  };
  const crest: AuthoredCrest =
    raw.ramp === undefined ? base : { ...base, ramp: parseRamp(label, raw.ramp, `${ctx}.ramp`) };
  return { kind: "crest", crest };
}

function parseBuilding(label: string, raw: unknown, index: number): MapCollisionBuilding {
  const ctx = `buildings[${index}]`;
  if (!isRec(raw)) fail(label, `${ctx} must be an object`);
  return {
    center: reqVec3(label, raw, "center", ctx),
    halfExtents: reqVec3(label, raw, "halfExtents", ctx),
    rotationY: reqNum(label, raw, "rotationY", ctx),
  };
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
  const buildings = parsed.buildings.map((b, i) => parseBuilding(sourceLabel, b, i));

  return {
    areaId,
    name,
    groundSurface: groundSurface as SurfaceType,
    legacyGlbBuildings,
    nextEdgeId,
    graph,
    objects,
    buildings,
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
  };
}
