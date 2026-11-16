/**
 * Pure helpers for File > Save as (quick 261116-a53). No DOM or network: the editor does the I/O.
 * Area names follow the same rules as the New area dialog, and Save as never overwrites.
 */
import type { TerrainArea } from "../../src/core/terrain-format.ts";

export const AREA_NAME_RE = /^[a-z0-9-]{1,64}$/;
export const AREA_NAME_RULE_TEXT = "Name may only use a-z, 0-9 and -, 1-64 characters.";

/** Error text for a bad or taken name, or undefined when the name is fine. */
export function validateAreaName(name: string, existing: readonly string[]): string | undefined {
  const n = name.trim();
  if (!AREA_NAME_RE.test(n)) return AREA_NAME_RULE_TEXT;
  if (existing.includes(n)) return `An area called "${n}" already exists. Pick another name.`;
  return undefined;
}

/** A free suggestion for the dialog: `<id>-copy`, then `<id>-copy-2`, and so on (kept within 64). */
export function suggestCopyName(id: string, existing: readonly string[]): string {
  const clip = (s: string): string => s.slice(0, 64);
  let candidate = clip(`${id}-copy`);
  for (let n = 2; existing.includes(candidate); n++) {
    const suffix = `-copy-${n}`;
    candidate = clip(id).slice(0, 64 - suffix.length) + suffix;
  }
  return candidate;
}

/**
 * A copy of `area` carrying a new id, ready to serialise as its own area. Shares the grid and
 * paint map (they are only read while saving); the original object is not changed.
 */
export function renameAreaForSave(area: TerrainArea, newId: string): TerrainArea {
  return {
    ...area,
    areaId: newId,
    name: newId,
    graph: { ...area.graph, areaId: newId, name: newId },
  };
}
