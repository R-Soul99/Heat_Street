/**
 * Allowlisted `?map=` selection. The result becomes part of fetch URLs in
 * `src/main.ts`, so only exact members of `KNOWN_MAP_IDS` are accepted
 * (array `includes`, never an object-key lookup, so prototype keys such as
 * `toString` cannot resolve). Anything else falls back to the default map.
 */
export const KNOWN_MAP_IDS = [
  "juliette-ga",
  "grid-test",
  "feel-test",
  "newton-poppleford",
  "skidders-and-popp",
  "my-map",
  "demo-hills",
  "playground",
  "straight-test",
] as const;
export type MapId = (typeof KNOWN_MAP_IDS)[number];
export const DEFAULT_MAP_ID: MapId = "juliette-ga";

export function resolveMapId(search: string): MapId {
  const requested = new URLSearchParams(search).get("map");
  if (requested === null) return DEFAULT_MAP_ID;
  const match = KNOWN_MAP_IDS.find((id) => id === requested);
  return match ?? DEFAULT_MAP_ID;
}

/** Human names for the in-game map menu. */
export const MAP_LABELS: Readonly<Record<MapId, string>> = {
  "juliette-ga": "Juliette, GA",
  "grid-test": "Grid test",
  "feel-test": "Feel test (proving ground)",
  "newton-poppleford": "Newton Poppleford, Devon",
  "skidders-and-popp": "Skidders and Popp, Devon",
  "my-map": "My Map (hand-authored)",
  "demo-hills": "Demo hills (sculpted)",
  playground: "Playground (domes, gap jumps, ovals)",
  "straight-test": "Straight test (one 4 km road)",
};

/**
 * Per-map data format. Chosen from this static allowlisted table, never by
 * probing URLs (D-08: the legacy ribbon loader stays for non-migrated maps).
 */
export type MapFormat = "legacy" | "terrain";
export const MAP_FORMATS: Readonly<Record<MapId, MapFormat>> = {
  "juliette-ga": "terrain",
  "grid-test": "terrain",
  "feel-test": "terrain",
  "newton-poppleford": "legacy",
  "skidders-and-popp": "legacy",
  "my-map": "legacy",
  "demo-hills": "terrain",
  playground: "terrain",
  "straight-test": "terrain",
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
 * `search` with `?map=` set to `id`, every other parameter kept (`feel`, `debug`...).
 * The default map is written explicitly so a stale `?map=` can't survive.
 */
export function searchForMap(search: string, id: MapId): string {
  const params = new URLSearchParams(search);
  params.set("map", id);
  return `?${params.toString()}`;
}
