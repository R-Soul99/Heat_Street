// Pure canvas-local coordinate helpers (07.1.1 D-06): the canvas no longer starts at x=0 because of the 240 px sidebar.

export function localPoint(
  clientX: number,
  clientY: number,
  rect: { left: number; top: number },
): { x: number; y: number } {
  return { x: clientX - rect.left, y: clientY - rect.top };
}

/** Canvas-local x where the HUD scale bar starts, right of the tool row. */
export function hudStartX(toolRowRight: number | null, canvasLeft: number, pad = 16): number {
  if (toolRowRight === null) return pad;
  return toolRowRight - canvasLeft + pad;
}
