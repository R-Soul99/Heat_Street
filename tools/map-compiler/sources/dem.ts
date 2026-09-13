/**
 * USGS 3DEP elevation source module: builds the `exportImage` request URL,
 * fetches the raw GeoTIFF bytes with a leading-byte TIFF-magic sniff before
 * ever handing the payload to the `geotiff` parser, caches the raw `.tif`
 * bytes to disk so a rebuild makes zero network calls unless `--refresh` is
 * passed, parses the cached raster into a NoData-substituted `Float32Array`,
 * and exposes a pure bilinear lat/lon sampler over it.
 *
 * Mirrors `tools/map-compiler/sources/overpass.ts`'s conventions (D-P… none —
 * this is 04-RESEARCH.md's own "mirror the Overpass module" instruction, not
 * a locked decision): an injectable `fetchImpl` so tests make zero network
 * calls, atomic temp-file-then-rename writes, and a content sniff before
 * parsing rather than letting a third-party parser throw an opaque error.
 *
 * Elevation is fetched from USGS 3DEP directly, NOT ported from the user's
 * Geomesh tool — see 04-RESEARCH.md's Geomesh Investigation and
 * `docs/adr/0001-map-data-source.md`'s DEM selection rule. Geomesh's own
 * elevation pipeline defaults to 30m Terrarium tiles, which is not one of
 * the ADR's two approved DEM sources.
 *
 * Layering: pure Node I/O (node:fs/promises, node:path, global fetch) plus
 * the pure-math `geotiff` parser and `graph/project.ts`'s projector — no
 * `three`, no Rapier, no DOM. NOT mechanically enforced —
 * `tests/layering.test.ts` does not scan `tools/**`; this file's own
 * discipline is the only guard.
 */
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { fromArrayBuffer } from "geotiff";
import { makeProjector } from "../graph/project.ts";
import type { Bbox } from "./overpass.ts";

/**
 * The USGS 3DEP ArcGIS ImageServer `exportImage` endpoint, per 04-RESEARCH.md's
 * "Code Examples" section. A hardcoded module-level constant, never derived
 * from argv or an area config (matching `overpass.ts`'s T-04-08 discipline for
 * its own endpoint constants).
 */
export const USGS_3DEP_ENDPOINT =
  "https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer/exportImage";

/**
 * Per-axis pixel cap for the `exportImage` request (D-P14). The native 3DEP
 * product is 1m; requesting at full resolution over this project's ~3km
 * areas would mean a ~36MB raster whose extra detail the elevation-smoothing
 * pass (plan 04-05 Task 2) immediately discards. At 512px over Juliette,
 * GA's ~2.9km x 2.4km box this resolves to approximately 5.6 metres per
 * pixel on both axes — far finer than the smoothing window, and small enough
 * (~1MB parsed) to commit to the repo so rebuilds are offline (D-P16). Raise
 * this deliberately, with a recorded reason, if a later area needs finer
 * detail — not by guessing a bigger number.
 */
export const DEM_MAX_SIZE_PX = 512;

/** A width/height pixel size, in the shape `exportImage`'s `size=` parameter and `readRasters` expect. */
export interface SizePx {
  readonly width: number;
  readonly height: number;
}

/**
 * Measures `bbox`'s real-world width/height in metres via the same local-ENU
 * projector `graph/project.ts` already provides (reused rather than
 * duplicating its metres-per-degree series here), evaluated at the bbox's own
 * centre latitude so the flat-plane approximation error stays negligible over
 * areas this small.
 */
function computeBboxMetres(bbox: Bbox): { readonly widthM: number; readonly heightM: number } {
  const centerLat = (bbox.south + bbox.north) / 2;
  const centerLon = (bbox.west + bbox.east) / 2;
  const projector = makeProjector({ lat: centerLat, lon: centerLon });
  const sw = projector.project(bbox.south, bbox.west);
  const ne = projector.project(bbox.north, bbox.east);
  return { widthM: Math.abs(ne.x - sw.x), heightM: Math.abs(sw.z - ne.z) };
}

/**
 * Computes a `width`/`height` request size whose ground sample distance
 * (metres per pixel) is uniform on both axes, with the longer axis capped at
 * `maxSizePx`. Exported (rather than only used internally) so `cli.ts` can
 * derive the same size from an area config's tunable `demSizePx` cap.
 */
export function computeDemSizePx(bbox: Bbox, maxSizePx: number): SizePx {
  const { widthM, heightM } = computeBboxMetres(bbox);
  if (!(widthM > 0) || !(heightM > 0)) {
    return { width: maxSizePx, height: maxSizePx };
  }
  if (widthM >= heightM) {
    return { width: maxSizePx, height: Math.max(1, Math.round(maxSizePx * (heightM / widthM))) };
  }
  return { width: Math.max(1, Math.round(maxSizePx * (widthM / heightM))), height: maxSizePx };
}

/**
 * Builds the `exportImage` request URL. Interpolated directly into a plain
 * string (matching `overpass.ts`'s own query-building style) rather than
 * `URLSearchParams`, which would percent-encode the commas inside `bbox=`/
 * `size=` — the interface's own documented shape keeps them literal.
 */
export function demRequestUrl(bbox: Bbox, sizePx: SizePx): string {
  const { south, west, north, east } = bbox;
  return (
    `${USGS_3DEP_ENDPOINT}?bbox=${west},${south},${east},${north}` +
    `&bboxSR=4326` +
    // [Rule 1 fix, verified empirically against the live service this session]
    // `imageSR` is NOT in 04-RESEARCH.md's documented parameter set (that
    // section was never executed, MEDIUM confidence). Omitting it makes the
    // ImageServer return the raster in its service default spatial
    // reference — verified empirically to be Web Mercator (EPSG:3857) here,
    // NOT the requested `bboxSR`. `getBoundingBox()` on that raster then
    // returns metre coordinates in the ~9.3 million range, silently breaking
    // every downstream lat/lon <-> pixel calculation in this file (a
    // corrupted-georeferencing bug, not a cosmetic one). Explicitly forcing
    // `imageSR=4326` makes the returned raster's bounding box match `bboxSR`
    // exactly, which `makeElevationSampler`'s lat/lon math requires.
    `&imageSR=4326` +
    `&size=${sizePx.width},${sizePx.height}` +
    `&format=tiff` +
    `&pixelType=F32` +
    `&interpolation=RSP_BilinearInterpolation` +
    `&f=image`
  );
}

const TIFF_MAGIC_LITTLE_ENDIAN = [0x49, 0x49, 0x2a, 0x00]; // "II*\0"
const TIFF_MAGIC_BIG_ENDIAN = [0x4d, 0x4d, 0x00, 0x2a]; // "MM\0*"

function matchesMagic(bytes: Uint8Array, magic: readonly number[]): boolean {
  return magic.every((byte, i) => bytes[i] === byte);
}

/**
 * Checks the leading 4 bytes for a TIFF magic number before the buffer ever
 * reaches `geotiff`. The ArcGIS ImageServer returns a JSON or HTML error
 * payload with an HTTP 200 status on a malformed request (no `!response.ok`
 * signal to rely on), so this content sniff — not the HTTP status — is the
 * actual error boundary. Threat T-04-17's mitigation.
 */
function assertTiffMagic(buffer: ArrayBuffer, endpoint: string): void {
  const bytes = new Uint8Array(buffer.slice(0, 4));
  if (matchesMagic(bytes, TIFF_MAGIC_LITTLE_ENDIAN) || matchesMagic(bytes, TIFF_MAGIC_BIG_ENDIAN)) {
    return;
  }
  const text = new TextDecoder("utf-8", { fatal: false }).decode(buffer.slice(0, 200));
  throw new Error(
    `fetchDemRaster: ${endpoint} did not return a TIFF (no "II*\\0" or "MM\\0*" magic bytes) — ` +
      `this is what the ArcGIS ImageServer returns for a malformed or rejected request — ` +
      `first 200 chars: ${text}`,
  );
}

export interface FetchDemOptions {
  /** Injectable fetch implementation — defaults to global `fetch`. Tests must always inject this. */
  readonly fetchImpl?: typeof fetch;
}

/**
 * Fetches one `exportImage` request and returns the raw TIFF bytes, having
 * verified the leading TIFF magic bytes first. Never calls into `geotiff` —
 * that parse step is `parseDemRaster`'s job, kept separate so a malformed
 * response is caught by a cheap byte check rather than an opaque parser
 * exception.
 */
export async function fetchDemRaster(
  bbox: Bbox,
  sizePx: SizePx,
  options: FetchDemOptions = {},
): Promise<ArrayBuffer> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const url = demRequestUrl(bbox, sizePx);
  const response = await fetchImpl(url);
  const buffer = await response.arrayBuffer();
  assertTiffMagic(buffer, USGS_3DEP_ENDPOINT);
  return buffer;
}

export interface LoadOrFetchDemOptions {
  /** `true` forces a network fetch even if a cache file exists. Defaults to `false`. */
  readonly refresh?: boolean;
  readonly fetchImpl?: typeof fetch;
  /** Overrides the cache directory — tests point this at an OS-temp-dir fixture directory. Defaults to `tools/map-compiler/areas/`. */
  readonly cacheDir?: string;
  /** Per-axis pixel cap passed to `computeDemSizePx`. Defaults to `DEM_MAX_SIZE_PX`. */
  readonly maxSizePx?: number;
}

export interface LoadOrFetchDemResult {
  readonly bytes: ArrayBuffer;
  readonly source: "cache" | "network";
}

const DEFAULT_AREAS_DIR = path.join(import.meta.dirname, "..", "areas");

function demCacheFileName(areaId: string): string {
  return `${areaId}.dem.tif`;
}

function isNotFoundError(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { code?: string }).code === "ENOENT";
}

/** Converts a Node `Buffer` (a view that may be offset into a shared pool allocation) into a standalone `ArrayBuffer`. */
function bufferToArrayBuffer(buffer: Buffer): ArrayBuffer {
  return buffer.buffer.slice(
    buffer.byteOffset,
    buffer.byteOffset + buffer.byteLength,
  ) as ArrayBuffer;
}

/**
 * Writes `contents` to `filePath` via a temp file plus `rename`, so an
 * interrupted fetch can never leave a truncated cache file behind. Mirrors
 * `overpass.ts`'s `writeAtomic`, adapted for binary content.
 */
async function writeAtomic(filePath: string, contents: Uint8Array): Promise<void> {
  const dir = path.dirname(filePath);
  await mkdir(dir, { recursive: true });
  const tempPath = path.join(dir, `.${path.basename(filePath)}.tmp-${process.pid}-${Date.now()}`);
  await writeFile(tempPath, contents);
  await rename(tempPath, filePath);
}

/**
 * Loads the cached `.tif` bytes for `config.areaId` from disk, or fetches
 * them from USGS 3DEP and caches them, per `options.refresh`. Never inspects
 * the cached bytes' content — a cache hit is trusted as-is, matching
 * `overpass.ts`'s cache-trust model (bbox-mismatch detection there has no
 * DEM analogue since the DEM cache key is the areaId alone).
 */
export async function loadOrFetchDem(
  config: { readonly areaId: string; readonly bbox: Bbox },
  options: LoadOrFetchDemOptions = {},
): Promise<LoadOrFetchDemResult> {
  const cacheDir = options.cacheDir ?? DEFAULT_AREAS_DIR;
  const cachePath = path.join(cacheDir, demCacheFileName(config.areaId));
  const refresh = options.refresh ?? false;

  if (!refresh) {
    try {
      const cached = await readFile(cachePath);
      return { bytes: bufferToArrayBuffer(cached), source: "cache" };
    } catch (err) {
      if (!isNotFoundError(err)) {
        throw err;
      }
    }
  }

  const sizePx = computeDemSizePx(config.bbox, options.maxSizePx ?? DEM_MAX_SIZE_PX);
  const bytes = await fetchDemRaster(config.bbox, sizePx, { fetchImpl: options.fetchImpl });
  await writeAtomic(cachePath, new Uint8Array(bytes));
  return { bytes, source: "network" };
}

/**
 * A parsed elevation raster: georeferenced bounds, dimensions, a single-band
 * `Float32Array` held in one allocation (no per-sample allocation — the
 * "allocate once, read in place" discipline `src/physics/transform-cache.ts`
 * establishes for the runtime tier, applied here at build time), and the
 * count of NoData sentinel pixels that were substituted on load.
 */
export interface DemRaster {
  readonly west: number;
  readonly south: number;
  readonly east: number;
  readonly north: number;
  readonly width: number;
  readonly height: number;
  /** Row-major, row 0 = north (the raster's own pixel-space convention — pixel (0,0) is the north-west corner). */
  readonly data: Float32Array;
  readonly noDataSubstitutions: number;
}

/**
 * A pixel value at or below this is unambiguously a NoData sentinel — 3DEP
 * rasters commonly use values in the -3e38 range (near Float32's most
 * negative representable value).
 */
const NODATA_SENTINEL_THRESHOLD = -1e30;
/**
 * A pixel value at or below this is treated as NoData even if it is not the
 * literal sentinel — no land on Earth is this far below sea level, so a
 * value here is a corrupted or unhandled gap, not real elevation data. This
 * threshold subsumes `NODATA_SENTINEL_THRESHOLD` numerically; both are kept
 * as separately named, documented constants rather than folded into one,
 * since they describe two different failure modes (a literal sentinel vs. a
 * physically impossible value from some other kind of corruption).
 */
const NODATA_BELOW_SEA_LEVEL_FLOOR = -500;

function isNoDataValue(value: number): boolean {
  return value < NODATA_SENTINEL_THRESHOLD || value < NODATA_BELOW_SEA_LEVEL_FLOOR;
}

/**
 * Finds the nearest valid (non-NoData) pixel to `index` by an outward
 * Chebyshev-ring search, per 04-RESEARCH.md's Task 1 action. Reads from
 * `data`, which may already contain earlier substitutions from this same
 * pass — that is intentional flood-fill-style propagation for a cluster of
 * adjacent NoData pixels, not a bug, since an already-substituted neighbour
 * is itself a valid elevation value by the time it is read.
 */
function findNearestValidValue(
  data: Float32Array,
  width: number,
  height: number,
  index: number,
): number {
  const row0 = Math.floor(index / width);
  const col0 = index % width;
  const maxRadius = Math.max(width, height);

  for (let radius = 1; radius <= maxRadius; radius++) {
    for (let dr = -radius; dr <= radius; dr++) {
      for (let dc = -radius; dc <= radius; dc++) {
        // Only visit cells on this ring's boundary (Chebyshev distance ===
        // radius) — interior cells were already checked at a smaller radius.
        if (Math.max(Math.abs(dr), Math.abs(dc)) !== radius) continue;
        const r = row0 + dr;
        const c = col0 + dc;
        if (r < 0 || r >= height || c < 0 || c >= width) continue;
        const value = data[r * width + c];
        if (!isNoDataValue(value)) return value;
      }
    }
  }

  throw new Error(
    `findNearestValidValue: no valid elevation value found anywhere in the raster to substitute ` +
      `for the NoData pixel at index ${index} — every pixel is NoData, which means the fetched ` +
      `raster is entirely invalid, not just gappy.`,
  );
}

/**
 * Parses raw GeoTIFF bytes (as returned by `fetchDemRaster`/`loadOrFetchDem`)
 * into a `DemRaster`: reads the georeferenced bounding box and the single
 * elevation band, then scans it once, substituting any NoData sentinel with
 * its nearest valid neighbour and counting the substitutions (threat T-04-18's
 * mitigation).
 */
export async function parseDemRaster(bytes: ArrayBuffer): Promise<DemRaster> {
  const tiff = await fromArrayBuffer(bytes);
  const image = await tiff.getImage();
  const [west, south, east, north] = image.getBoundingBox();
  const width = image.getWidth();
  const height = image.getHeight();

  const rasters = await image.readRasters();
  const band = rasters[0];
  const data = new Float32Array(band.length);
  data.set(band as ArrayLike<number>);

  let noDataSubstitutions = 0;
  for (let i = 0; i < data.length; i++) {
    if (isNoDataValue(data[i])) {
      data[i] = findNearestValidValue(data, width, height, i);
      noDataSubstitutions++;
    }
  }

  return { west, south, east, north, width, height, data, noDataSubstitutions };
}

export interface ElevationSampler {
  /** Bilinear-interpolated elevation, in metres, at `(lat, lon)`. Clamps to the raster's edge outside its bounds. Pure — repeated calls with the same input return the same output. */
  sample(lat: number, lon: number): number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Builds a pure bilinear sampler over `raster`. Pixel `i`'s centre is defined
 * to sit at the fractional pixel coordinate `i` exactly (so `(i + 0.5) /
 * width` is the pixel's normalized position across `[west, east]`), which is
 * what makes sampling at a pixel centre return that exact stored value with
 * no interpolation error.
 */
export function makeElevationSampler(raster: DemRaster): ElevationSampler {
  const { west, east, south, north, width, height, data } = raster;
  const lonSpan = east - west;
  const latSpan = north - south;

  return {
    sample(lat: number, lon: number): number {
      const u = lonSpan === 0 ? 0.5 : (lon - west) / lonSpan;
      const v = latSpan === 0 ? 0.5 : (north - lat) / latSpan;

      const colF = clamp(u * width - 0.5, 0, width - 1);
      const rowF = clamp(v * height - 0.5, 0, height - 1);

      const x0 = Math.floor(colF);
      const x1 = Math.min(x0 + 1, width - 1);
      const y0 = Math.floor(rowF);
      const y1 = Math.min(y0 + 1, height - 1);
      const tx = colF - x0;
      const ty = rowF - y0;

      const v00 = data[y0 * width + x0];
      const v10 = data[y0 * width + x1];
      const v01 = data[y1 * width + x0];
      const v11 = data[y1 * width + x1];

      const top = v00 * (1 - tx) + v10 * tx;
      const bottom = v01 * (1 - tx) + v11 * tx;
      return top * (1 - ty) + bottom * ty;
    },
  };
}
