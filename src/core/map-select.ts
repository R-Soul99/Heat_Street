/**
 * Allowlisted `?map=` selection. The result becomes part of fetch URLs in
 * `src/main.ts`, so only exact members of `KNOWN_MAP_IDS` are accepted
 * (array `includes`, never an object-key lookup, so prototype keys such as
 * `toString` cannot resolve). Anything else falls back to the default map.
 */
export const KNOWN_MAP_IDS = ["juliette-ga", "grid-test", "feel-test"] as const;
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
};

/**
 * `search` with `?map=` set to `id`, every other parameter kept (`feel`, `debug`...).
 * The default map is written explicitly so a stale `?map=` can't survive.
 */
export function searchForMap(search: string, id: MapId): string {
  const params = new URLSearchParams(search);
  params.set("map", id);
  return `?${params.toString()}`;
}
