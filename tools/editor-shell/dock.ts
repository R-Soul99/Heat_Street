/** Pure helpers for the opt-in "dock" shell layout (no DOM types beyond plain rect objects). */

export interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
}

/** Splits tools into the compact top row (`dock: "top"`) and the bottom row (everything else). */
export function splitDockTools<T extends { dock?: "top" }>(
  tools: readonly T[],
): { top: T[]; bottom: T[] } {
  const top: T[] = [];
  const bottom: T[] = [];
  for (const t of tools) (t.dock === "top" ? top : bottom).push(t);
  return { top, bottom };
}

const EDGE_MARGIN_PX = 8;

/**
 * Position for a flyout that sits directly above a bottom-row tool button, in container
 * pixels: `left` from the container's left edge, `bottom` from the container's bottom edge.
 * The flyout's left edge lines up with the button's and is clamped inside the container.
 */
export function flyoutAnchor(
  buttonRect: Rect,
  containerRect: Rect,
  flyoutSize: { width: number; height: number },
  gap = 6,
): { left: number; bottom: number } {
  const maxLeft = containerRect.width - EDGE_MARGIN_PX - flyoutSize.width;
  const wanted = buttonRect.left - containerRect.left;
  const left = Math.max(EDGE_MARGIN_PX, Math.min(wanted, maxLeft));
  return { left, bottom: containerRect.bottom - buttonRect.top + gap };
}
