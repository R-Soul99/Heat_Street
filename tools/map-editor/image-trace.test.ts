import { describe, expect, it } from "vitest";
import {
  imageToRoadGraph,
  pruneSpurs,
  removeSpecks,
  simplifyPath,
  skeletonize,
  smoothPath,
  threshold,
  traceSkeleton,
} from "./image-trace.ts";

interface Img {
  w: number;
  h: number;
  lum: Uint8Array;
}
const blank = (w: number, h: number): Img => ({ w, h, lum: new Uint8Array(w * h).fill(255) });

/** Draws a thick segment (stroke = diameter in px). */
function line(img: Img, x0: number, y0: number, x1: number, y1: number, stroke: number): void {
  const r = stroke / 2;
  const minX = Math.max(0, Math.floor(Math.min(x0, x1) - r - 1));
  const maxX = Math.min(img.w - 1, Math.ceil(Math.max(x0, x1) + r + 1));
  const minY = Math.max(0, Math.floor(Math.min(y0, y1) - r - 1));
  const maxY = Math.min(img.h - 1, Math.ceil(Math.max(y0, y1) + r + 1));
  const dx = x1 - x0;
  const dy = y1 - y0;
  const len2 = dx * dx + dy * dy;
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const px = x + 0.5;
      const py = y + 0.5;
      const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - x0) * dx + (py - y0) * dy) / len2));
      if (Math.hypot(px - (x0 + t * dx), py - (y0 + t * dy)) <= r) img.lum[y * img.w + x] = 0;
    }
  }
}
function ring(img: Img, cx: number, cy: number, rx: number, ry: number, stroke: number): void {
  const n = 180;
  for (let i = 0; i < n; i++) {
    const a0 = (i / n) * Math.PI * 2;
    const a1 = ((i + 1) / n) * Math.PI * 2;
    line(
      img,
      cx + rx * Math.cos(a0),
      cy + ry * Math.sin(a0),
      cx + rx * Math.cos(a1),
      cy + ry * Math.sin(a1),
      stroke,
    );
  }
}
const skelOf = (img: Img): Uint8Array =>
  skeletonize(threshold(img.lum, img.w, img.h, 128), img.w, img.h);
function pixels(s: Uint8Array, w: number): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = [];
  for (let i = 0; i < s.length; i++)
    if (s[i]) out.push({ x: (i % w) + 0.5, y: Math.floor(i / w) + 0.5 });
  return out;
}
const near = (p: { x: number; y: number }, set: { x: number; y: number }[]): number =>
  Math.min(...set.map((q) => Math.hypot(p.x - q.x, p.y - q.y)));
const trace = (img: Img, opts = {}) => imageToRoadGraph(img.lum, img.w, img.h, opts);

describe("threshold", () => {
  it("marks dark pixels and honours the level", () => {
    const lum = Uint8Array.from([0, 100, 150, 255]);
    expect(Array.from(threshold(lum, 4, 1, 128))).toEqual([1, 1, 0, 0]);
    expect(Array.from(threshold(lum, 4, 1, 100))).toEqual([1, 0, 0, 0]);
    expect(Array.from(threshold(lum, 4, 1, 200))).toEqual([1, 1, 1, 0]);
  });
});

describe("removeSpecks", () => {
  it("drops tiny blobs and keeps big ones", () => {
    const img = blank(60, 30);
    line(img, 5, 15, 55, 15, 5);
    img.lum[2 * 60 + 2] = 0;
    img.lum[2 * 60 + 3] = 0;
    const m = removeSpecks(threshold(img.lum, 60, 30, 128), 60, 30, 20);
    expect(m[2 * 60 + 2]).toBe(0);
    expect(m[15 * 60 + 30]).toBe(1);
  });
});

describe("skeletonize", () => {
  it.each([1, 5, 15])("reduces a %i px horizontal stroke to one row at its centre", (stroke) => {
    const img = blank(120, 60);
    line(img, 10, 30, 110, 30, stroke);
    const s = skelOf(img);
    const px = pixels(s, 120).filter((p) => p.x > 25 && p.x < 95);
    expect(px.length).toBeGreaterThan(50);
    for (const p of px) expect(Math.abs(p.y - 30)).toBeLessThanOrEqual(1);
    const rows = new Set(px.map((p) => p.y));
    expect(rows.size).toBe(1);
  });

  it("is one pixel wide: no 2x2 blocks", () => {
    const img = blank(150, 100);
    line(img, 10, 10, 140, 90, 9);
    line(img, 10, 90, 140, 20, 9);
    const s = skelOf(img);
    for (let y = 0; y < 99; y++) {
      for (let x = 0; x < 149; x++) {
        const sum =
          (s[y * 150 + x] as number) +
          (s[y * 150 + x + 1] as number) +
          (s[(y + 1) * 150 + x] as number) +
          (s[(y + 1) * 150 + x + 1] as number);
        expect(sum).toBeLessThan(4);
      }
    }
  });

  it("gives the same centreline for thin and thick rings", () => {
    const a = blank(200, 150);
    const b = blank(200, 150);
    ring(a, 100, 75, 70, 45, 3);
    ring(b, 100, 75, 70, 45, 11);
    const pa = pixels(skelOf(a), 200);
    const pb = pixels(skelOf(b), 200);
    for (const p of pa) expect(near(p, pb)).toBeLessThanOrEqual(1.5);
    for (const p of pb) expect(near(p, pa)).toBeLessThanOrEqual(1.5);
  });
});

describe("tracing", () => {
  it("traces an isolated ring as a closed path with no dead ends and no self-loop", () => {
    const img = blank(200, 150);
    ring(img, 100, 75, 70, 45, 6);
    const g = trace(img);
    expect(g.nodes.length).toBeGreaterThanOrEqual(2);
    expect(g.paths.length).toBeGreaterThanOrEqual(2);
    for (const n of g.nodes) expect(n.degree).toBe(2);
    for (const p of g.paths) expect(p.a).not.toBe(p.b);
  });

  it("traces a T-junction to one degree-3 node and 3 endpoints", () => {
    const img = blank(200, 200);
    line(img, 20, 100, 180, 100, 7);
    line(img, 100, 100, 100, 180, 7);
    const g = trace(img);
    expect(g.nodes.length).toBe(4);
    expect(g.paths.length).toBe(3);
    const j = g.nodes.filter((n) => n.degree === 3);
    expect(j.length).toBe(1);
    expect(Math.hypot((j[0]?.x ?? 0) - 100, (j[0]?.y ?? 0) - 100)).toBeLessThanOrEqual(2);
  });

  it.each([
    [
      "+",
      [
        [20, 100, 180, 100],
        [100, 20, 100, 180],
      ],
    ],
    [
      "X",
      [
        [30, 30, 170, 170],
        [170, 30, 30, 170],
      ],
    ],
    [
      "thick X at 60 degrees",
      [
        [20, 100 - 60, 180, 100 + 60],
        [20, 100 + 60, 180, 100 - 60],
      ],
    ],
  ] as const)("traces a %s crossing to ONE degree-4 node", (_n, segs) => {
    const img = blank(200, 200);
    for (const s of segs) line(img, s[0], s[1], s[2], s[3], 9);
    const g = trace(img);
    expect(g.nodes.filter((n) => n.degree === 4).length).toBe(1);
    expect(g.nodes.length).toBe(5);
    expect(g.paths.length).toBe(4);
  });

  it.each([
    [45, 140, 140],
    [30, 160, 92],
  ])("traces a %i degree line to one 2-point path", (_a, dx, dy) => {
    const img = blank(220, 200);
    line(img, 20, 20, 20 + dx, 20 + dy, 5);
    const g = trace(img);
    expect(g.paths.length).toBe(1);
    expect(g.nodes.length).toBe(2);
    expect(g.paths[0]?.points.length).toBe(2);
  });

  it("removes a short spur and merges the halves, but keeps a long branch", () => {
    const spur = blank(200, 100);
    line(spur, 10, 50, 190, 50, 5);
    line(spur, 100, 50, 100, 44, 5); // nub ~ 4 px beyond the stroke
    const gs = trace(spur);
    expect(gs.paths.length).toBe(1);
    expect(gs.nodes.length).toBe(2);

    const branch = blank(200, 100);
    line(branch, 10, 50, 190, 50, 5);
    line(branch, 100, 50, 100, 12, 5);
    expect(trace(branch).paths.length).toBe(3);
  });

  it("pruneSpurs merges degree-2 nodes left behind", () => {
    const g = pruneSpurs(
      {
        nodes: [
          { id: 0, x: 0, y: 0, degree: 1 },
          { id: 1, x: 50, y: 0, degree: 3 },
          { id: 2, x: 100, y: 0, degree: 1 },
          { id: 3, x: 50, y: 4, degree: 1 },
        ],
        paths: [
          {
            a: 0,
            b: 1,
            points: [
              { x: 0, y: 0 },
              { x: 50, y: 0 },
            ],
          },
          {
            a: 1,
            b: 2,
            points: [
              { x: 50, y: 0 },
              { x: 100, y: 0 },
            ],
          },
          {
            a: 1,
            b: 3,
            points: [
              { x: 50, y: 0 },
              { x: 50, y: 4 },
            ],
          },
        ],
      },
      10,
    );
    expect(g.paths.length).toBe(1);
    expect(g.paths[0]?.points.length).toBe(3);
  });
});

describe("simplify and smooth", () => {
  it("simplifyPath keeps endpoints and drops collinear points", () => {
    const pts = [0, 1, 2, 3, 4].map((i) => ({ x: i, y: 0 }));
    expect(simplifyPath(pts, 0.5)).toEqual([
      { x: 0, y: 0 },
      { x: 4, y: 0 },
    ]);
  });

  it("smoothPath pins endpoints and softens a right-angle zigzag", () => {
    const pts = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 20, y: 10 },
    ];
    const sm = smoothPath(pts, 2);
    expect(sm[0]).toEqual(pts[0]);
    expect(sm[sm.length - 1]).toEqual(pts[3]);
    const maxTurn = (p: { x: number; y: number }[]): number => {
      let m = 0;
      for (let i = 1; i < p.length - 1; i++) {
        const a = Math.atan2(
          (p[i] as { y: number }).y - (p[i - 1] as { y: number }).y,
          (p[i] as { x: number }).x - (p[i - 1] as { x: number }).x,
        );
        const b = Math.atan2(
          (p[i + 1] as { y: number }).y - (p[i] as { y: number }).y,
          (p[i + 1] as { x: number }).x - (p[i] as { x: number }).x,
        );
        let d = Math.abs(b - a);
        if (d > Math.PI) d = 2 * Math.PI - d;
        m = Math.max(m, d);
      }
      return m;
    };
    expect(maxTurn(sm)).toBeLessThan(maxTurn(pts));
  });
});

describe("imageToRoadGraph", () => {
  it("returns only junction/endpoint nodes with valid references for a ring with chords", () => {
    const img = blank(240, 160);
    ring(img, 120, 80, 100, 60, 7);
    line(img, 20, 80, 220, 80, 7);
    line(img, 120, 20, 120, 140, 7);
    const g = trace(img);
    const ids = new Set(g.nodes.map((n) => n.id));
    expect(g.nodes.every((n) => n.degree !== 2 || g.nodes.length <= 3)).toBe(true);
    for (const p of g.paths) {
      expect(p.points.length).toBeGreaterThanOrEqual(2);
      expect(ids.has(p.a)).toBe(true);
      expect(ids.has(p.b)).toBe(true);
    }
    expect(g.nodes.filter((n) => n.degree === 4).length).toBe(1);
  });

  it("rejects a size mismatch", () => {
    expect(() => imageToRoadGraph(new Uint8Array(10), 4, 4)).toThrow();
  });

  it("handles a 2000x1000 picture with 12 px strokes in time", { timeout: 20000 }, () => {
    const img = blank(2000, 1000);
    ring(img, 1000, 500, 900, 400, 12);
    for (let x = 200; x <= 1800; x += 400) line(img, x, 100, x, 900, 12);
    for (let y = 300; y <= 700; y += 200) line(img, 100, y, 1900, y, 12);
    const g = trace(img);
    expect(g.paths.length).toBeGreaterThan(10);
    expect(g.nodes.every((n) => n.degree >= 1)).toBe(true);
  });
});

describe("traceSkeleton", () => {
  it("never emits a self-loop path", () => {
    const img = blank(100, 100);
    ring(img, 50, 50, 30, 30, 5);
    line(img, 50, 20, 50, 5, 5);
    const g = traceSkeleton(skelOf(img), 100, 100);
    for (const p of g.paths) expect(p.a).not.toBe(p.b);
  });
});
