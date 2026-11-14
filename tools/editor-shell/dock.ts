/** Pure helpers for the shell layout (no DOM types beyond plain rect objects). */

export interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
}

/** Splits tools into the sidebar pair (`dock: "top"`) and the bottom toolbar (everything else). */
export function splitDockTools<T extends { dock?: "top" }>(
  tools: readonly T[],
): { top: T[]; bottom: T[] } {
  const top: T[] = [];
  const bottom: T[] = [];
  for (const t of tools) (t.dock === "top" ? top : bottom).push(t);
  return { top, bottom };
}
