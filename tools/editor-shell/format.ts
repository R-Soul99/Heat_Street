/**
 * Display-only number formatting for the editor shell.
 * Never parse these strings back into a model value: full precision is kept
 * internally (D-05) and only the presentation is rounded.
 */

/** Round to at most 3 decimal places, trimming trailing zeros. "-" if not finite. */
export function fmt3(n: number): string {
  if (!Number.isFinite(n)) return "-";
  const r = Math.round(n * 1000) / 1000;
  return String(r === 0 ? 0 : r);
}

/** Metres, e.g. "934.532 m". */
export function fmtMetres(m: number): string {
  return `${fmt3(m)} m`;
}

/** Input in metres, output in kilometres, e.g. "1.96 km". */
export function fmtKm(m: number): string {
  return `${fmt3(m / 1000)} km`;
}

/** "1 road" / "3 roads". */
export function fmtCount(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? "" : "s"}`;
}
