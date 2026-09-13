import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { writeArrayBuffer } from "geotiff";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEM_MAX_SIZE_PX,
  demRequestUrl,
  fetchDemRaster,
  loadOrFetchDem,
  makeElevationSampler,
  parseDemRaster,
  USGS_3DEP_ENDPOINT,
} from "./dem.ts";
import type { Bbox } from "./overpass.ts";

const BBOX: Bbox = { south: 33.0963, west: -83.8242, north: 33.1223, east: -83.7948 };

function textResponse(body: string, status = 200): Response {
  return new Response(body, { status });
}

function tiffResponse(buffer: ArrayBuffer, status = 200): Response {
  return new Response(buffer, { status });
}

/**
 * Builds a real, parseable GeoTIFF for test fixtures. Requires
 * `GeographicTypeGeoKey` to be set explicitly — geotiff@3.0.5's writer
 * otherwise unconditionally overwrites any supplied `ModelTiepoint` with a
 * whole-globe default when neither `GeographicTypeGeoKey` nor
 * `ProjectedCSTypeGeoKey` is present (verified empirically against the
 * installed version this session).
 */
function buildTestTiff(opts: {
  readonly width: number;
  readonly height: number;
  readonly bbox: {
    readonly west: number;
    readonly south: number;
    readonly east: number;
    readonly north: number;
  };
  readonly data: Float32Array;
}): ArrayBuffer {
  const { width, height, bbox, data } = opts;
  return writeArrayBuffer(data, {
    width,
    height,
    BitsPerSample: [32],
    SampleFormat: [3],
    PhotometricInterpretation: 1,
    SamplesPerPixel: 1,
    ModelPixelScale: [(bbox.east - bbox.west) / width, (bbox.north - bbox.south) / height, 0],
    ModelTiepoint: [0, 0, 0, bbox.west, bbox.north, 0],
    GeographicTypeGeoKey: 4326,
  });
}

/** Given fractional pixel coordinates, returns the lat/lon of that exact point — the inverse of `makeElevationSampler`'s own pixel-center mapping, used to construct exact test expectations. */
function latLonAtPixel(
  bbox: {
    readonly west: number;
    readonly south: number;
    readonly east: number;
    readonly north: number;
  },
  width: number,
  height: number,
  colF: number,
  rowF: number,
): { readonly lat: number; readonly lon: number } {
  const lon = bbox.west + ((colF + 0.5) / width) * (bbox.east - bbox.west);
  const lat = bbox.north - ((rowF + 0.5) / height) * (bbox.north - bbox.south);
  return { lat, lon };
}

// A 5x4 ramp raster: elevation increases linearly with column (X), constant across rows.
const RAMP_BBOX = { west: -84.0, south: 33.0, east: -83.9, north: 33.08 };
const RAMP_WIDTH = 5;
const RAMP_HEIGHT = 4;
function rampValue(col: number): number {
  return 100 + col * 10; // 100, 110, 120, 130, 140
}
function buildRampData(): Float32Array {
  const data = new Float32Array(RAMP_WIDTH * RAMP_HEIGHT);
  for (let row = 0; row < RAMP_HEIGHT; row++) {
    for (let col = 0; col < RAMP_WIDTH; col++) {
      data[row * RAMP_WIDTH + col] = rampValue(col);
    }
  }
  return data;
}

describe("demRequestUrl", () => {
  it("contains bbox, bboxSR=4326, pixelType=F32, format=tiff and f=image", () => {
    const url = demRequestUrl(BBOX, { width: 487, height: 512 });
    expect(url).toContain(`${USGS_3DEP_ENDPOINT}?bbox=-83.8242,33.0963,-83.7948,33.1223`);
    expect(url).toContain("bboxSR=4326");
    expect(url).toContain("imageSR=4326");
    expect(url).toContain("size=487,512");
    expect(url).toContain("format=tiff");
    expect(url).toContain("pixelType=F32");
    expect(url).toContain("f=image");
  });
});

describe("fetchDemRaster", () => {
  it("throws a named error identifying the ImageServer, without reaching the GeoTIFF parser, on a non-TIFF body", async () => {
    const html = `<html><body>${"x".repeat(300)}Invalid or missing input parameters.</body></html>`;
    const fetchImpl = vi.fn(async () => textResponse(html));

    await expect(fetchDemRaster(BBOX, { width: 100, height: 100 }, { fetchImpl })).rejects.toThrow(
      /elevation\.nationalmap\.gov/,
    );

    try {
      await fetchDemRaster(BBOX, { width: 100, height: 100 }, { fetchImpl });
      throw new Error("expected fetchDemRaster to throw");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      expect(message).not.toContain("GeoTIFF");
      expect(message).not.toContain("Unexpected token");
      expect(message).toContain(html.slice(0, 200));
    }
  });

  it("throws the same way on a JSON error payload (the ArcGIS ImageServer's actual error shape, HTTP 200)", async () => {
    const json = JSON.stringify({
      error: { code: 400, message: "Invalid or missing input parameters: bbox" },
    });
    const fetchImpl = vi.fn(async () => textResponse(json, 200));

    await expect(fetchDemRaster(BBOX, { width: 100, height: 100 }, { fetchImpl })).rejects.toThrow(
      /elevation\.nationalmap\.gov/,
    );
  });

  it("returns the raw bytes unchanged for a real TIFF response", async () => {
    const tiff = buildTestTiff({
      width: RAMP_WIDTH,
      height: RAMP_HEIGHT,
      bbox: RAMP_BBOX,
      data: buildRampData(),
    });
    const fetchImpl: typeof fetch = vi.fn(async () => tiffResponse(tiff));

    const bytes = await fetchDemRaster(
      BBOX,
      { width: RAMP_WIDTH, height: RAMP_HEIGHT },
      { fetchImpl },
    );

    expect(bytes.byteLength).toBe(tiff.byteLength);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const calledUrl = String((fetchImpl as ReturnType<typeof vi.fn>).mock.calls[0]?.[0]);
    expect(calledUrl).toContain(USGS_3DEP_ENDPOINT);
  });
});

describe("loadOrFetchDem", () => {
  let cacheDir: string;

  beforeEach(async () => {
    cacheDir = await mkdtemp(path.join(tmpdir(), "heat-street-dem-test-"));
  });

  afterEach(async () => {
    await rm(cacheDir, { recursive: true, force: true });
  });

  it("returns the cached .tif bytes and performs zero fetches when the cache exists and refresh is false", async () => {
    const tiff = buildTestTiff({
      width: RAMP_WIDTH,
      height: RAMP_HEIGHT,
      bbox: RAMP_BBOX,
      data: buildRampData(),
    });
    await writeFile(path.join(cacheDir, "juliette-ga.dem.tif"), Buffer.from(tiff));
    const fetchImpl = vi.fn();

    const result = await loadOrFetchDem(
      { areaId: "juliette-ga", bbox: BBOX },
      { cacheDir, refresh: false, fetchImpl },
    );

    expect(result.source).toBe("cache");
    expect(result.bytes.byteLength).toBe(tiff.byteLength);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("with refresh: true fetches and writes the cache atomically with no leftover temp file", async () => {
    const tiff = buildTestTiff({
      width: RAMP_WIDTH,
      height: RAMP_HEIGHT,
      bbox: RAMP_BBOX,
      data: buildRampData(),
    });
    const fetchImpl = vi.fn(async () => tiffResponse(tiff));

    const result = await loadOrFetchDem(
      { areaId: "juliette-ga", bbox: BBOX },
      { cacheDir, refresh: true, fetchImpl },
    );

    expect(result.source).toBe("network");
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    const cachedBytes = await readFile(path.join(cacheDir, "juliette-ga.dem.tif"));
    expect(cachedBytes.byteLength).toBe(tiff.byteLength);

    const entries = await readdir(cacheDir);
    expect(entries.some((name) => name.includes(".tmp-"))).toBe(false);
  });
});

describe("parseDemRaster + makeElevationSampler", () => {
  it("returns exact pixel values when sampling at pixel centres", async () => {
    const bytes = buildTestTiff({
      width: RAMP_WIDTH,
      height: RAMP_HEIGHT,
      bbox: RAMP_BBOX,
      data: buildRampData(),
    });
    const raster = await parseDemRaster(bytes);
    const sampler = makeElevationSampler(raster);

    for (let col = 0; col < RAMP_WIDTH; col++) {
      const { lat, lon } = latLonAtPixel(RAMP_BBOX, RAMP_WIDTH, RAMP_HEIGHT, col, 1.5);
      expect(sampler.sample(lat, lon)).toBeCloseTo(rampValue(col), 6);
    }
  });

  it("returns the arithmetic mean of two neighbouring pixel centres at their midpoint (bilinear correctness)", async () => {
    const bytes = buildTestTiff({
      width: RAMP_WIDTH,
      height: RAMP_HEIGHT,
      bbox: RAMP_BBOX,
      data: buildRampData(),
    });
    const raster = await parseDemRaster(bytes);
    const sampler = makeElevationSampler(raster);

    // Midpoint between column 1 (value 110) and column 2 (value 120) is at fractional pixel-x 1.5.
    const { lat, lon } = latLonAtPixel(RAMP_BBOX, RAMP_WIDTH, RAMP_HEIGHT, 1.5, 1.5);
    const expected = (rampValue(1) + rampValue(2)) / 2;
    expect(sampler.sample(lat, lon)).toBeCloseTo(expected, 4);
  });

  it("clamps to the nearest edge pixel when sampling outside the raster bounds", async () => {
    const bytes = buildTestTiff({
      width: RAMP_WIDTH,
      height: RAMP_HEIGHT,
      bbox: RAMP_BBOX,
      data: buildRampData(),
    });
    const raster = await parseDemRaster(bytes);
    const sampler = makeElevationSampler(raster);

    const farWest = sampler.sample(33.04, -84.5); // west of the whole bbox
    expect(farWest).toBeCloseTo(rampValue(0), 6);

    const farEast = sampler.sample(33.04, -83.0); // east of the whole bbox
    expect(farEast).toBeCloseTo(rampValue(RAMP_WIDTH - 1), 6);

    // -83.95 sits exactly at column 2's pixel centre (u=0.5 -> colF=2.0); clamping the row to the
    // top (north) edge should therefore return exactly column 2's ramp value.
    const farNorth = sampler.sample(34.0, -83.95); // north of the whole bbox
    expect(farNorth).toBeCloseTo(rampValue(2), 6);
  });

  it("substitutes a NoData sentinel with its nearest valid neighbour and counts the substitution", async () => {
    const data = buildRampData();
    // Poison the pixel at row=2, col=2 with a NoData sentinel.
    const poisonedIndex = 2 * RAMP_WIDTH + 2;
    data[poisonedIndex] = -3.4e38;

    const bytes = buildTestTiff({ width: RAMP_WIDTH, height: RAMP_HEIGHT, bbox: RAMP_BBOX, data });
    const raster = await parseDemRaster(bytes);

    expect(raster.noDataSubstitutions).toBe(1);
    // The nearest valid neighbour search should replace it with one of its immediate (radius-1)
    // neighbours' real ramp values — any of columns 1-3 across the three rows — never the sentinel.
    expect(raster.data[poisonedIndex]).toBeGreaterThan(-500);
    expect([rampValue(1), rampValue(2), rampValue(3)]).toContain(raster.data[poisonedIndex]);
  });

  it("also treats a value far below any real elevation (but above the -1e30 sentinel threshold) as NoData", async () => {
    const data = buildRampData();
    const poisonedIndex = 1 * RAMP_WIDTH + 3;
    data[poisonedIndex] = -600; // below -500, but nowhere near -1e30

    const bytes = buildTestTiff({ width: RAMP_WIDTH, height: RAMP_HEIGHT, bbox: RAMP_BBOX, data });
    const raster = await parseDemRaster(bytes);

    expect(raster.noDataSubstitutions).toBe(1);
    expect(raster.data[poisonedIndex]).toBeGreaterThan(-500);
  });

  it("is pure: the same lat/lon returns the same value on repeated calls", async () => {
    const bytes = buildTestTiff({
      width: RAMP_WIDTH,
      height: RAMP_HEIGHT,
      bbox: RAMP_BBOX,
      data: buildRampData(),
    });
    const raster = await parseDemRaster(bytes);
    const sampler = makeElevationSampler(raster);

    const first = sampler.sample(33.04, -83.95);
    const second = sampler.sample(33.04, -83.95);
    const third = sampler.sample(33.04, -83.95);
    expect(first).toBe(second);
    expect(second).toBe(third);
  });
});

describe("DEM_MAX_SIZE_PX", () => {
  it("is the documented 512px cap", () => {
    expect(DEM_MAX_SIZE_PX).toBe(512);
  });
});
