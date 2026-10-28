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
