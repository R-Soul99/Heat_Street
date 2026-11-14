/** Pure helpers for the shell layout (no DOM types beyond plain rect objects). */

import type { Rect } from "./tip-place.ts";

export type { Rect };

/** Splits tools into the sidebar pair (`dock: "top"`) and the bottom toolbar (everything else). */
export function splitDockTools<T extends { dock?: "top" }>(
  tools: readonly T[],
): { top: T[]; bottom: T[] } {
  const top: T[] = [];
  const bottom: T[] = [];
  for (const t of tools) (t.dock === "top" ? top : bottom).push(t);
  return { top, bottom };
}
