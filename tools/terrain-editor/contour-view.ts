// Contours view modes for the terrain editor (quick 261116-a5q). Pure: no DOM, no three.

/** Off, height lines over the normal view, or height lines alone on a plain dark ground. */
export type ContourMode = "off" | "on" | "only";

export const CONTOUR_MODES: readonly ContourMode[] = ["off", "on", "only"];

/** C key and the top-bar button: off, lines, lines only, back to off. */
export function nextContourMode(m: ContourMode): ContourMode {
  return m === "off" ? "on" : m === "on" ? "only" : "off";
}

/** A stored value back to a mode (anything unknown is off). */
export function parseContourMode(raw: unknown): ContourMode {
  return raw === "on" || raw === "only" ? raw : "off";
}

/** Every Nth contour line is an index line (brighter in the contours-only view). */
export const INDEX_EVERY = 5;

/**
 * Splits contour segments (flat [x0,y0,z0,x1,y1,z1,...], y = the contour level) into ordinary
 * lines and index lines: those whose level is a multiple of `every` x `intervalM`. A segment
 * whose two ends sit at different heights (not a contour) goes to the ordinary list.
 */
export function splitIndexContours(
  segments: Float32Array,
  intervalM: number,
  every: number = INDEX_EVERY,
): { regular: Float32Array; index: Float32Array } {
  if (!(intervalM > 0) || !Number.isFinite(intervalM) || !(every >= 1)) {
    return { regular: segments, index: new Float32Array(0) };
  }
  const regular: number[] = [];
  const index: number[] = [];
  for (let i = 0; i + 5 < segments.length; i += 6) {
    const y0 = segments[i + 1] as number;
    const y1 = segments[i + 4] as number;
    const k = Math.round(y0 / intervalM);
    const isIndex = y0 === y1 && k % every === 0;
    const out = isIndex ? index : regular;
    for (let j = 0; j < 6; j++) out.push(segments[i + j] as number);
  }
  return { regular: Float32Array.from(regular), index: Float32Array.from(index) };
}
