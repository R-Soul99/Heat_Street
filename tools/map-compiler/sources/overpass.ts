/**
 * Overpass API source module: builds the roads/buildings Overpass QL queries,
 * fetches them with retry/backoff, detects an HTML error page before ever
 * calling `JSON.parse`, and caches the raw envelope to disk so a rebuild
 * makes zero network calls unless `--refresh` is passed.
 *
 * This is the first network-fetching module in the project (04-PATTERNS.md
 * "No Analog Found") — there is no existing HTTP client or disk-cache
 * pattern to copy. The binding design is 04-RESEARCH.md's Pitfall 1: the
 * shared public Overpass instance rate-limited this project's own research
 * session twice, returning an HTML error page instead of JSON, so a rebuild
 * that makes a live call every time is not a build a solo dev can rely on.
 *
 * Query construction: the highway-class filter (roadsQuery) and the
 * building/man_made/amenity filter set (buildingsQuery) are ported from the
 * user's own Geomesh tool's Overpass route handlers — real reuse of
 * working, already-production-tested query shapes, per D-05/D-06. The
 * output statement is changed to `out body geom qt;` (D-P6): Geomesh's own
 * `out geom qt <n>;` omits OSM node ids, and junction topology (plan 04-04)
 * is recovered by finding node ids shared between ways, so `nodes` must be
 * present in the response.
 *
 * Geomesh's elevation pipeline (`/api/elevation/grid`, defaulting to 30m
 * Terrarium tiles when no Google key is configured) is deliberately NOT
 * ported here or anywhere in this compiler — Terrarium is not one of ADR
 * 0001's two approved DEM sources (USGS 3DEP / Copernicus GLO-30). Plan
 * 04-05 fetches USGS 3DEP directly instead. This file only ports the
 * road/building Overpass logic, never the elevation logic — do not
 * "complete" that port later.
 *
 * Layering: pure Node I/O (node:fs/promises, node:path, global fetch), no
 * `three`, no Rapier, no DOM. NOT mechanically enforced —
 * `tests/layering.test.ts` does not scan `tools/**`; this file's own
 * discipline is the only guard.
 */
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

/** WGS84 bounding box, structurally identical to `AreaConfig["bbox"]`. */
export interface Bbox {
  readonly south: number;
  readonly west: number;
  readonly north: number;
  readonly east: number;
}

/** The minimal shape `loadOrFetchArea` needs from an area config. */
export interface AreaLike {
  readonly areaId: string;
  readonly bbox: Bbox;
}

export type OverpassKind = "roads" | "buildings";

/**
 * The primary public Overpass instance. A hardcoded module-level constant,
 * never derived from argv or an area config (T-04-08's arbitrary-endpoint
 * concern) — grep for `interpreter` in this file and every match is a
 * constant declaration, never interpolation.
 */
export const OVERPASS_ENDPOINT = "https://overpass-api.de/api/interpreter";

/**
 * Documented fallback the caller (plan 04-02's Task 2 CLI wiring, or a
 * future `--endpoint` flag) may explicitly select if the primary instance
 * persistently rate-limits. Also a hardcoded constant.
 */
export const OVERPASS_ENDPOINT_FALLBACK = "https://overpass.kumi.systems/api/interpreter";

const USER_AGENT = "heat-street-map-compiler/1.0 (offline build tool, not a browser client)";

/**
 * Retry delays, applied in order before each retried request. Three
 * retries after the initial attempt (four total HTTP requests in the worst
 * case) — [ASSUMED, matching the plan's stated "3 attempts, 2s/4s/8s"
 * exponential backoff for a shared, unauthenticated public API].
 */
const RETRY_DELAYS_MS = [2000, 4000, 8000] as const;

function defaultDelay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * `roadsQuery(bbox)` — the highway-class filter list is ported verbatim
 * from Geomesh's `/api/roads/network` handler.
 * [CITED: github.com/R-Soul99/Geomesh server.ts /api/roads/network]
 * The output statement is `out body geom qt;`, not Geomesh's `out geom qt
 * 4000;` — D-P6 supersedes Geomesh's own query shape here, because `nodes`
 * (present under `body`, absent under the bare `geom` Geomesh uses) is
 * required for junction detection (plan 04-04).
 */
export function roadsQuery(bbox: Bbox): string {
  const { south, west, north, east } = bbox;
  return (
    `[out:json][timeout:25];` +
    `(way["highway"~"^(motorway|trunk|primary|secondary|tertiary|unclassified|residential|service|living_street|track)"]` +
    `(${south},${west},${north},${east}););` +
    `out body geom qt;`
  );
}

/**
 * `buildingsQuery(bbox)` — the building/man_made/amenity filter set is
 * ported from Geomesh's `/api/buildings/structures` handler (its way-level
 * filters only; the handler's synthetic node-based fuel-station footprint
 * is Geomesh-specific rendering logic, not an Overpass filter, and is not
 * ported).
 * [CITED: github.com/R-Soul99/Geomesh server.ts /api/buildings/structures]
 * Output statement changed to `out body geom qt;` for the same D-P6 reason
 * as `roadsQuery`.
 */
export function buildingsQuery(bbox: Bbox): string {
  const { south, west, north, east } = bbox;
  return (
    `[out:json][timeout:25];` +
    `(` +
    `way["building"](${south},${west},${north},${east});` +
    `way["man_made"~"^(water_tower|tower|silo|chimney|communications_tower|storage_tank|bridge)"](${south},${west},${north},${east});` +
    `way["amenity"~"^(fuel|parking|charging_station)"](${south},${west},${north},${east});` +
    `);` +
    `out body geom qt;`
  );
}

/**
 * Parses a raw Overpass HTTP response body. Checks the first non-whitespace
 * character before doing anything else: a `<` means Overpass (or an
 * intermediary) returned an HTML/XML error page — 04-RESEARCH.md Pitfall
 * 1's exact observed failure — and this throws a named error quoting the
 * first 200 characters rather than letting `JSON.parse` throw an opaque
 * `SyntaxError: Unexpected token '<'`. This is threat T-04-05's mitigation.
 */
export function parseOverpassResponse(body: string, endpoint: string): { elements: unknown[] } {
  const trimmed = body.trimStart();

  if (trimmed.startsWith("<")) {
    throw new Error(
      `parseOverpassResponse: ${endpoint} returned an HTML/XML error page instead of JSON ` +
        `(this is what a rate-limited or overloaded Overpass instance returns) — ` +
        `first 200 chars: ${trimmed.slice(0, 200)}`,
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch (err) {
    throw new Error(
      `parseOverpassResponse: ${endpoint} response was not valid JSON: ` +
        `${err instanceof Error ? err.message : String(err)}`,
    );
  }

  if (
    parsed === null ||
    typeof parsed !== "object" ||
    !Array.isArray((parsed as { elements?: unknown }).elements)
  ) {
    throw new Error(`parseOverpassResponse: ${endpoint} response is missing an "elements" array`);
  }

  return { elements: (parsed as { elements: unknown[] }).elements };
}

export interface FetchOverpassOptions {
  /** Defaults to `OVERPASS_ENDPOINT`. */
  readonly endpoint?: string;
  /** Injectable fetch implementation — defaults to global `fetch`. Tests must always inject this. */
  readonly fetchImpl?: typeof fetch;
  /** Injectable delay implementation — defaults to a real `setTimeout`. Tests inject a no-op to avoid real waits. */
  readonly delayImpl?: (ms: number) => Promise<void>;
}

/**
 * Fetches and parses one Overpass query. Retries on HTTP 429 and 5xx with
 * exponential backoff (`RETRY_DELAYS_MS`); a 400 (a malformed query) is not
 * transient and is never retried.
 */
export async function fetchOverpass(
  query: string,
  options: FetchOverpassOptions = {},
): Promise<{ elements: unknown[] }> {
  const endpoint = options.endpoint ?? OVERPASS_ENDPOINT;
  const fetchImpl = options.fetchImpl ?? fetch;
  const delayImpl = options.delayImpl ?? defaultDelay;

  let lastError: Error = new Error("fetchOverpass: unreachable — no attempt was made");

  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    const response = await fetchImpl(`${endpoint}?data=${encodeURIComponent(query)}`, {
      headers: { "User-Agent": USER_AGENT },
    });

    if (response.ok) {
      const body = await response.text();
      return parseOverpassResponse(body, endpoint);
    }

    const isRetryable = response.status === 429 || response.status >= 500;
    if (!isRetryable) {
      const bodyText = await response.text().catch(() => "");
      throw new Error(
        `fetchOverpass: ${endpoint} responded ${response.status} (non-retryable, not retried): ` +
          bodyText.slice(0, 200),
      );
    }

    lastError = new Error(
      `fetchOverpass: ${endpoint} responded ${response.status} after ${attempt + 1} attempt(s)`,
    );
    if (attempt < RETRY_DELAYS_MS.length) {
      await delayImpl(RETRY_DELAYS_MS[attempt]);
    }
  }

  throw lastError;
}

/** The on-disk cache envelope shape — also what a compiled map's `source.osmSnapshot` is derived from (`fetchedAt`). */
export interface OverpassEnvelope {
  readonly fetchedAt: string;
  readonly endpoint: string;
  readonly bbox: Bbox;
  readonly query: string;
  readonly response: { elements: unknown[] };
}

export interface LoadOrFetchAreaOptions {
  /** `true` forces a network fetch even if a cache file exists. Defaults to `false`. */
  readonly refresh?: boolean;
  readonly endpoint?: string;
  readonly fetchImpl?: typeof fetch;
  readonly delayImpl?: (ms: number) => Promise<void>;
  /** Overrides the cache directory — tests point this at an OS-temp-dir fixture directory. Defaults to `tools/map-compiler/areas/`. */
  readonly cacheDir?: string;
}

export interface LoadOrFetchAreaResult {
  readonly envelope: OverpassEnvelope;
  readonly source: "cache" | "network";
}

const DEFAULT_AREAS_DIR = path.join(import.meta.dirname, "..", "areas");

function cacheFileName(areaId: string, kind: OverpassKind): string {
  return kind === "roads" ? `${areaId}.raw-osm.json` : `${areaId}.raw-buildings.json`;
}

function bboxesMatch(a: Bbox, b: Bbox): boolean {
  return a.south === b.south && a.west === b.west && a.north === b.north && a.east === b.east;
}

function isNotFoundError(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { code?: string }).code === "ENOENT";
}

/**
 * Writes `contents` to `filePath` via a temp file plus `rename`, so an
 * interrupted fetch can never leave a truncated cache file behind.
 */
async function writeAtomic(filePath: string, contents: string): Promise<void> {
  const dir = path.dirname(filePath);
  await mkdir(dir, { recursive: true });
  const tempPath = path.join(dir, `.${path.basename(filePath)}.tmp-${process.pid}-${Date.now()}`);
  await writeFile(tempPath, contents, "utf8");
  await rename(tempPath, filePath);
}

/**
 * Loads the cached envelope for `config`/`kind` from disk, or fetches it
 * from Overpass and caches it, per `options.refresh`. A cached payload
 * whose recorded `bbox` no longer matches `config.bbox` is treated as a
 * miss (reported via `console.warn`, never silently reused) and always
 * triggers a fresh network fetch, regardless of `options.refresh`.
 */
export async function loadOrFetchArea(
  config: AreaLike,
  kind: OverpassKind,
  options: LoadOrFetchAreaOptions = {},
): Promise<LoadOrFetchAreaResult> {
  const cacheDir = options.cacheDir ?? DEFAULT_AREAS_DIR;
  const cachePath = path.join(cacheDir, cacheFileName(config.areaId, kind));
  const refresh = options.refresh ?? false;

  if (!refresh) {
    let cachedRaw: string | undefined;
    try {
      cachedRaw = await readFile(cachePath, "utf8");
    } catch (err) {
      if (!isNotFoundError(err)) {
        throw err;
      }
    }

    if (cachedRaw !== undefined) {
      const envelope = JSON.parse(cachedRaw) as OverpassEnvelope;
      if (bboxesMatch(envelope.bbox, config.bbox)) {
        return { envelope, source: "cache" };
      }
      console.warn(
        `loadOrFetchArea: cached bbox for "${config.areaId}" (${kind}) does not match the ` +
          `requested bbox — treating the cache as a miss and re-fetching from Overpass.`,
      );
    }
  }

  const query = kind === "roads" ? roadsQuery(config.bbox) : buildingsQuery(config.bbox);
  const endpoint = options.endpoint ?? OVERPASS_ENDPOINT;
  const response = await fetchOverpass(query, {
    endpoint,
    fetchImpl: options.fetchImpl,
    delayImpl: options.delayImpl,
  });

  const envelope: OverpassEnvelope = {
    fetchedAt: new Date().toISOString(),
    endpoint,
    bbox: config.bbox,
    query,
    response,
  };

  await writeAtomic(cachePath, JSON.stringify(envelope, null, 2));

  return { envelope, source: "network" };
}
