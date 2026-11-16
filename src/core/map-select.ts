import {
  AUTHORED_MAP_FORMATS,
  AUTHORED_MAP_IDS,
  AUTHORED_MAP_LABELS,
} from "./authored-maps.generated.ts";

/**
 * Allowlisted `?map=` selection. The result becomes part of fetch URLs in
 * `src/main.ts`, so only exact members of `KNOWN_MAP_IDS` are accepted
 * (array `includes`, never an object-key lookup, so prototype keys such as
 * `toString` cannot resolve). Anything else falls back to the default map.
 */
export const BUILTIN_MAP_IDS = [
  "juliette-ga",
  "grid-test",
  "feel-test",
  "newton-poppleford",
  "skidders-and-popp",
  "my-map",
  "demo-hills",
  "playground",
  "straight-test",
  "arena-test",
] as const;
export const KNOWN_MAP_IDS = [...BUILTIN_MAP_IDS, ...AUTHORED_MAP_IDS] as const;
export type MapId = (typeof KNOWN_MAP_IDS)[number];
export const DEFAULT_MAP_ID: MapId = "juliette-ga";

export function resolveMapId(search: string): MapId {
  const requested = new URLSearchParams(search).get("map");
  if (requested === null) return DEFAULT_MAP_ID;
  const match = KNOWN_MAP_IDS.find((id) => id === requested);
  return match ?? DEFAULT_MAP_ID;
}

/** Human names for the in-game map menu. */
const BUILTIN_LABELS: Readonly<Record<(typeof BUILTIN_MAP_IDS)[number], string>> = {
  "juliette-ga": "Juliette, GA",
  "grid-test": "Grid test",
  "feel-test": "Feel test (proving ground)",
  "newton-poppleford": "Newton Poppleford, Devon",
  "skidders-and-popp": "Skidders and Popp, Devon",
  "my-map": "My Map (hand-authored)",
  "demo-hills": "Demo hills (sculpted)",
  playground: "Playground (domes, gap jumps, ovals)",
  "straight-test": "Straight test (one 4 km road)",
  "arena-test": "Arena test (editable copy of straight test)",
};
export const MAP_LABELS: Readonly<Record<MapId, string>> = {
  ...BUILTIN_LABELS,
  ...AUTHORED_MAP_LABELS,
};

/**
 * Per-map data format. Chosen from this static allowlisted table, never by
 * probing URLs (D-08: the legacy ribbon loader stays for non-migrated maps).
 */
export type MapFormat = "legacy" | "terrain";
const BUILTIN_FORMATS: Readonly<Record<(typeof BUILTIN_MAP_IDS)[number], MapFormat>> = {
  "juliette-ga": "terrain",
  "grid-test": "terrain",
  "feel-test": "terrain",
  "newton-poppleford": "legacy",
  "skidders-and-popp": "legacy",
  "my-map": "legacy",
  "demo-hills": "terrain",
  playground: "terrain",
  "straight-test": "terrain",
  "arena-test": "terrain",
};
export const MAP_FORMATS: Readonly<Record<MapId, MapFormat>> = {
  ...BUILTIN_FORMATS,
  ...AUTHORED_MAP_FORMATS,
};

const DECIMAL = /^-?\d+(\.\d+)?$/;

/**
 * `?at=x,z` drive-here point: exactly two finite decimals inside `bounds`,
 * raw value at most 32 characters. Anything else is ignored (undefined).
 */
export function parseDriveAt(
  search: string,
  bounds: { minX: number; minZ: number; maxX: number; maxZ: number },
): { x: number; z: number } | undefined {
  const raw = new URLSearchParams(search).get("at");
  if (raw === null || raw.length === 0 || raw.length > 32) return undefined;
  const parts = raw.split(",");
  if (parts.length !== 2) return undefined;
  const [xs, zs] = parts as [string, string];
  if (!DECIMAL.test(xs.trim()) || !DECIMAL.test(zs.trim())) return undefined;
  const x = Number(xs);
  const z = Number(zs);
  if (!Number.isFinite(x) || !Number.isFinite(z)) return undefined;
  if (x < bounds.minX || x > bounds.maxX || z < bounds.minZ || z > bounds.maxZ) return undefined;
  return { x, z };
}

/**
 * `?heading=` degrees (07.1.3 D-04): one decimal in 0..360 inclusive, at most
 * 8 characters; returns RADIANS (VehiclePose yaw, unit conversion only).
 */
export function parseDriveHeading(search: string): number | undefined {
  const raw = new URLSearchParams(search).get("heading");
  if (raw === null || raw.length === 0 || raw.length > 8) return undefined;
  if (!DECIMAL.test(raw)) return undefined;
  const deg = Number(raw);
  if (!Number.isFinite(deg) || deg < 0 || deg > 360) return undefined;
  return (deg * Math.PI) / 180;
}

/** `?start=<id>` (07.1.3 D-04): only `start-N` ids; never used as an object key. */
export function parseStartId(search: string): string | undefined {
  const raw = new URLSearchParams(search).get("start");
  if (raw === null || !/^start-\d{1,3}$/.test(raw)) return undefined;
  return raw;
}

/**
 * `search` with `?map=` set to `id`, every other parameter kept (`feel`, `debug`...).
 * The default map is written explicitly so a stale `?map=` can't survive.
 */
export function searchForMap(search: string, id: MapId): string {
  const params = new URLSearchParams(search);
  params.set("map", id);
  return `?${params.toString()}`;
}

/**
 * `?grid=` override for the flat 10 m reference grid: `1` forces it on, `0`
 * forces it off, on any map. Anything else (missing, `2`, `true`, hostile
 * text) is ignored and the per-map default applies.
 */
export function parseGridOverride(search: string): boolean | undefined {
  const raw = new URLSearchParams(search).get("grid");
  if (raw === "1") return true;
  if (raw === "0") return false;
  return undefined;
}

/**
 * Whether to draw the reference grid. An explicit `?grid=` override wins.
 * Otherwise it is on, except on sculpted terrain maps, where a flat plane at
 * y = 0 only shows where the ground is at or below zero. The flat proving
 * grounds keep it even when they load as terrain, because it is their only
 * speed reference.
 */
export function shouldShowReferenceGrid(
  override: boolean | undefined,
  isTerrain: boolean,
  isFlatTestArea: boolean,
): boolean {
  if (override !== undefined) return override;
  return !isTerrain || isFlatTestArea;
}
