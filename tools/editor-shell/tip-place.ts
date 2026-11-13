/** Pure tooltip placement: pick a side of the anchor that does not cover other controls. */
import type { Rect } from "./dock.ts";

export type TipSide = "below" | "above" | "right" | "left";

const MARGIN = 4;

function overlapArea(x: number, y: number, w: number, h: number, r: Rect): number {
  const ox = Math.min(x + w, r.right) - Math.max(x, r.left);
  const oy = Math.min(y + h, r.bottom) - Math.max(y, r.top);
  return ox > 0 && oy > 0 ? ox * oy : 0;
}

function sameRect(a: Rect, b: Rect): boolean {
  return a.left === b.left && a.top === b.top && a.right === b.right && a.bottom === b.bottom;
}

export function placeTip(
  anchor: Rect,
  tip: { width: number; height: number },
  viewport: { width: number; height: number },
  avoid: readonly Rect[],
  gap = 8,
): { x: number; y: number; side: TipSide } {
  const { width: w, height: h } = tip;
  const clampX = (x: number): number => Math.max(MARGIN, Math.min(viewport.width - w - MARGIN, x));
  const clampY = (y: number): number => Math.max(MARGIN, Math.min(viewport.height - h - MARGIN, y));
  const cx = anchor.left + anchor.width / 2 - w / 2;
  const cy = anchor.top + anchor.height / 2 - h / 2;

  const raw: { side: TipSide; x: number; y: number; fits: boolean }[] = [
    {
      side: "below",
      x: cx,
      y: anchor.bottom + gap,
      fits: anchor.bottom + gap + h <= viewport.height - MARGIN,
    },
    { side: "above", x: cx, y: anchor.top - gap - h, fits: anchor.top - gap - h >= MARGIN },
    {
      side: "right",
      x: anchor.right + gap,
      y: cy,
      fits: anchor.right + gap + w <= viewport.width - MARGIN,
    },
    { side: "left", x: anchor.left - gap - w, y: cy, fits: anchor.left - gap - w >= MARGIN },
  ];
  const others = avoid.filter((r) => !sameRect(r, anchor));
  const cands = raw.map((c) => {
    const x = clampX(c.x);
    const y = clampY(c.y);
    let overlap = 0;
    for (const r of others) overlap += overlapArea(x, y, w, h, r);
    return { side: c.side, x, y, fits: c.fits, overlap };
  });

  const free = cands.find((c) => c.fits && c.overlap === 0);
  if (free) return { x: free.x, y: free.y, side: free.side };
  let best = cands[0] as (typeof cands)[number];
  for (const c of cands) if (c.overlap < best.overlap) best = c;
  return { x: best.x, y: best.y, side: best.side };
}
