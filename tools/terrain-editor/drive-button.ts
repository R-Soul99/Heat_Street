// Pure text for the always-visible Drive button in the top bar (quick 261116-a53).

export const DRIVE_FALLBACK_STATUS =
  "No start point on this map, so driving from the centre of the view.";

/** Tooltip: names the start the click will use, or says it falls back to the view centre. */
export function driveButtonTip(startName: string | undefined): string {
  return startName === undefined
    ? "Drive: no start point on this map, so this saves and drives from the centre of the view (D)"
    : `Drive: saves, then drives from ${startName} (D)`;
}
