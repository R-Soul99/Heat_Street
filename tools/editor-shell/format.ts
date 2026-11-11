/** Display formatting only. Raw values stay full precision elsewhere (D-05). */

export function fmt3(n: number): string {
  if (!Number.isFinite(n)) return "-";
  const s = n.toFixed(3);
  return s === "-0.000" ? "0.000" : s;
}

export function fmtKm(m: number): string {
  return `${fmt3(m / 1000)} km`;
}

export function fmtMetres(m: number, dp = 1): string {
  if (!Number.isFinite(m)) return "-";
  const s = m.toFixed(dp).replace(/^-(0(\.0+)?)$/, "$1");
  return `${s} m`;
}

export function fmtXY(x: number, y: number): string {
  return `x ${fmtMetres(x)}  y ${fmtMetres(y)}`;
}
