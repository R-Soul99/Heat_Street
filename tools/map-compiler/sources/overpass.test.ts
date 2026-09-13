import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type Bbox,
  buildingsQuery,
  fetchOverpass,
  loadOrFetchArea,
  OVERPASS_ENDPOINT,
  parseOverpassResponse,
  roadsQuery,
} from "./overpass.ts";

const BBOX: Bbox = { south: 33.0963, west: -83.8242, north: 33.1223, east: -83.7948 };

function jsonResponse(body: unknown, init: { status?: number } = {}): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { "content-type": "application/json" },
  });
}

function textResponse(body: string, status: number): Response {
  return new Response(body, { status });
}

const noDelay = async (): Promise<void> => {};

describe("roadsQuery", () => {
  it("contains out body geom qt and the full highway-class filter, and does not contain out tags geom", () => {
    const query = roadsQuery(BBOX);
    expect(query).toContain("out body geom qt;");
    expect(query).not.toContain("out tags geom");
    expect(query).toContain(
      'way["highway"~"^(motorway|trunk|primary|secondary|tertiary|unclassified|residential|service|living_street|track)"]',
    );
    expect(query).toContain("(33.0963,-83.8242,33.1223,-83.7948)");
    expect(query).toContain("[out:json]");
  });
});

describe("buildingsQuery", () => {
  it("contains building/man_made/amenity filters and out body geom qt", () => {
    const query = buildingsQuery(BBOX);
    expect(query).toContain('way["building"]');
    expect(query).toContain(
      'way["man_made"~"^(water_tower|tower|silo|chimney|communications_tower|storage_tank|bridge)"]',
    );
    expect(query).toContain('way["amenity"~"^(fuel|parking|charging_station)"]');
    expect(query).toContain("out body geom qt;");
    expect(query).toContain("(33.0963,-83.8242,33.1223,-83.7948)");
  });
});

describe("parseOverpassResponse", () => {
  it("throws a named error quoting the first 200 chars on an HTML error page, never reaching JSON.parse", () => {
    const html = `<html><body>${"x".repeat(300)}server is probably too busy</body></html>`;
    expect(() => parseOverpassResponse(html, OVERPASS_ENDPOINT)).toThrowError(
      /overpass-api\.de\/api\/interpreter/,
    );
    try {
      parseOverpassResponse(html, OVERPASS_ENDPOINT);
      throw new Error("expected parseOverpassResponse to throw");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      expect(message).not.toContain("Unexpected token");
      expect(message).toContain(html.slice(0, 200));
    }
  });

  it("returns elements for a valid body", () => {
    const result = parseOverpassResponse(
      JSON.stringify({ elements: [{ type: "way", id: 1 }] }),
      OVERPASS_ENDPOINT,
    );
    expect(result.elements).toEqual([{ type: "way", id: 1 }]);
  });

  it("throws when elements is absent", () => {
    expect(() => parseOverpassResponse(JSON.stringify({}), OVERPASS_ENDPOINT)).toThrow();
  });

  it("throws when elements is not an array", () => {
    expect(() =>
      parseOverpassResponse(JSON.stringify({ elements: "nope" }), OVERPASS_ENDPOINT),
    ).toThrow();
  });

  it("throws when the body is not valid JSON at all (and does not start with <)", () => {
    expect(() => parseOverpassResponse("not json at all", OVERPASS_ENDPOINT)).toThrow();
  });
});

describe("fetchOverpass", () => {
  it("retries on 429 and 5xx with exponential backoff (2s/4s/8s) and succeeds once a request is ok", async () => {
    let calls = 0;
    const fetchImpl = vi.fn(async () => {
      calls += 1;
      if (calls === 1) return textResponse("rate limited", 429);
      if (calls === 2) return textResponse("bad gateway", 502);
      return jsonResponse({ elements: [{ type: "way", id: 42 }] });
    });
    const delayImpl = vi.fn(noDelay);

    const result = await fetchOverpass("[out:json];", { fetchImpl, delayImpl });

    expect(result.elements).toEqual([{ type: "way", id: 42 }]);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(delayImpl).toHaveBeenNthCalledWith(1, 2000);
    expect(delayImpl).toHaveBeenNthCalledWith(2, 4000);
  });

  it("exhausts retries and throws after repeated 5xx responses", async () => {
    const fetchImpl = vi.fn(async () => textResponse("still busy", 503));
    const delayImpl = vi.fn(noDelay);

    await expect(fetchOverpass("[out:json];", { fetchImpl, delayImpl })).rejects.toThrow(/503/);
    expect(fetchImpl).toHaveBeenCalledTimes(4);
    expect(delayImpl).toHaveBeenNthCalledWith(1, 2000);
    expect(delayImpl).toHaveBeenNthCalledWith(2, 4000);
    expect(delayImpl).toHaveBeenNthCalledWith(3, 8000);
  });

  it("does not retry on 400 — a malformed query is not transient", async () => {
    const fetchImpl = vi.fn(async () => textResponse("bad query", 400));
    const delayImpl = vi.fn(noDelay);

    await expect(fetchOverpass("[out:json];", { fetchImpl, delayImpl })).rejects.toThrow(/400/);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(delayImpl).not.toHaveBeenCalled();
  });

  it("parses an HTML error page response body via parseOverpassResponse (never reaches JSON.parse)", async () => {
    const fetchImpl = vi.fn(async () => textResponse("<html>server too busy</html>", 200));
    await expect(fetchOverpass("[out:json];", { fetchImpl, delayImpl: noDelay })).rejects.toThrow(
      /HTML\/XML error page/,
    );
  });
});

describe("loadOrFetchArea", () => {
  let cacheDir: string;

  beforeEach(async () => {
    cacheDir = await mkdtemp(path.join(tmpdir(), "heat-street-overpass-test-"));
  });

  afterEach(async () => {
    await rm(cacheDir, { recursive: true, force: true });
  });

  it("returns the cached file's contents and performs zero fetches when the cache exists and refresh is false", async () => {
    const envelope = {
      fetchedAt: "2026-09-13T00:00:00.000Z",
      endpoint: OVERPASS_ENDPOINT,
      bbox: BBOX,
      query: roadsQuery(BBOX),
      response: { elements: [{ type: "way", id: 7 }] },
    };
    await writeFile(
      path.join(cacheDir, "juliette-ga.raw-osm.json"),
      JSON.stringify(envelope),
      "utf8",
    );
    const fetchImpl = vi.fn();

    const result = await loadOrFetchArea({ areaId: "juliette-ga", bbox: BBOX }, "roads", {
      cacheDir,
      refresh: false,
      fetchImpl,
    });

    expect(result.source).toBe("cache");
    expect(result.envelope.response.elements).toEqual([{ type: "way", id: 7 }]);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("with refresh: true fetches, writes the cache atomically, and records an ISO-8601 timestamp", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ elements: [{ type: "way", id: 99 }] }));

    const result = await loadOrFetchArea({ areaId: "juliette-ga", bbox: BBOX }, "roads", {
      cacheDir,
      refresh: true,
      fetchImpl,
      delayImpl: noDelay,
    });

    expect(result.source).toBe("network");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(result.envelope.fetchedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);

    const cachedFile = await readFile(path.join(cacheDir, "juliette-ga.raw-osm.json"), "utf8");
    const cachedEnvelope = JSON.parse(cachedFile);
    expect(cachedEnvelope.response.elements).toEqual([{ type: "way", id: 99 }]);

    // No leftover temp file — writeAtomic must rename, not leave a `.tmp-*` behind.
    const entries = await readdir(cacheDir);
    expect(entries.some((name) => name.includes(".tmp-"))).toBe(false);
  });

  it("uses the buildings cache filename for kind: buildings", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ elements: [] }));

    await loadOrFetchArea({ areaId: "juliette-ga", bbox: BBOX }, "buildings", {
      cacheDir,
      refresh: true,
      fetchImpl,
      delayImpl: noDelay,
    });

    const entries = await readdir(cacheDir);
    expect(entries).toContain("juliette-ga.raw-buildings.json");
  });

  it("treats a cached payload with a different bbox as a miss and reports it, not silently reusing it", async () => {
    const staleEnvelope = {
      fetchedAt: "2020-01-01T00:00:00.000Z",
      endpoint: OVERPASS_ENDPOINT,
      bbox: { south: 0, west: 0, north: 1, east: 1 },
      query: "stale",
      response: { elements: [{ type: "way", id: -1 }] },
    };
    await writeFile(
      path.join(cacheDir, "juliette-ga.raw-osm.json"),
      JSON.stringify(staleEnvelope),
      "utf8",
    );
    const fetchImpl = vi.fn(async () => jsonResponse({ elements: [{ type: "way", id: 123 }] }));
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const result = await loadOrFetchArea({ areaId: "juliette-ga", bbox: BBOX }, "roads", {
      cacheDir,
      refresh: false,
      fetchImpl,
      delayImpl: noDelay,
    });

    expect(result.source).toBe("network");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(result.envelope.response.elements).toEqual([{ type: "way", id: 123 }]);
    expect(warnSpy).toHaveBeenCalled();

    warnSpy.mockRestore();
  });
});
