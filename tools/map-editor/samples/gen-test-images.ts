/**
 * Deterministic generator for the image-import sample pictures.
 * Run: node tools/map-editor/samples/gen-test-images.ts
 *
 * Writes 8-bit greyscale PNGs (colour type 0, so the map compiler's
 * decodeGreyPng can read them in tests) with anti-aliased black strokes on white.
 */

import { writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { crc32, deflateSync } from "node:zlib";

type Pt = [number, number];
interface Stroke {
  pts: Pt[];
  width: number;
}

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body) >>> 0);
  return Buffer.concat([len, body, crc]);
}

function encodeGreyPng(w: number, h: number, px: Uint8Array): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 0; // greyscale
  const raw = Buffer.alloc((w + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w + 1)] = 0; // filter: none
    for (let x = 0; x < w; x++) raw[y * (w + 1) + 1 + x] = px[y * w + x] as number;
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function distToSegment(px: number, py: number, a: Pt, b: Pt): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const l2 = dx * dx + dy * dy;
  const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - a[0]) * dx + (py - a[1]) * dy) / l2));
  return Math.hypot(px - (a[0] + t * dx), py - (a[1] + t * dy));
}

function render(w: number, h: number, strokes: Stroke[]): Uint8Array {
  const px = new Uint8Array(w * h).fill(255);
  for (const s of strokes) {
    const r = s.width / 2;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let d = Infinity;
        for (let i = 0; i + 1 < s.pts.length; i++) {
          d = Math.min(d, distToSegment(x + 0.5, y + 0.5, s.pts[i] as Pt, s.pts[i + 1] as Pt));
        }
        const cover = Math.max(0, Math.min(1, r - d + 0.5)); // anti-aliased edge
        const v = Math.round(255 * (1 - cover));
        const i = y * w + x;
        if (v < (px[i] as number)) px[i] = v;
      }
    }
  }
  return px;
}

/** Rounded rectangle outline as a closed polyline. */
function roundedRect(x0: number, y0: number, x1: number, y1: number, r: number): Pt[] {
  const pts: Pt[] = [];
  const corner = (cx: number, cy: number, a0: number): void => {
    for (let i = 0; i <= 16; i++) {
      const a = a0 + (i / 16) * (Math.PI / 2);
      pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
    }
  };
  corner(x1 - r, y0 + r, -Math.PI / 2);
  corner(x1 - r, y1 - r, 0);
  corner(x0 + r, y1 - r, Math.PI / 2);
  corner(x0 + r, y0 + r, Math.PI);
  pts.push(pts[0] as Pt);
  return pts;
}

const images: Record<string, { w: number; h: number; strokes: Stroke[] }> = {
  // Loop with a horizontal chord and a vertical chord (T junctions on the loop,
  // one crossing in the middle) plus a deliberate 3 px nub to prove spur pruning.
  "loop.png": {
    w: 500,
    h: 240,
    strokes: [
      { pts: roundedRect(60, 40, 440, 200, 50), width: 8 },
      {
        pts: [
          [60, 120],
          [440, 120],
        ],
        width: 6,
      },
      {
        pts: [
          [250, 40],
          [250, 200],
        ],
        width: 10,
      },
      {
        pts: [
          [150, 38],
          [150, 31],
        ],
        width: 3,
      },
    ],
  },
  "t-junction.png": {
    w: 200,
    h: 200,
    strokes: [
      {
        pts: [
          [20, 100],
          [180, 100],
        ],
        width: 8,
      },
      {
        pts: [
          [100, 100],
          [100, 180],
        ],
        width: 8,
      },
    ],
  },
  "crossing.png": {
    w: 200,
    h: 200,
    strokes: [
      {
        pts: [
          [100 - 69.3, 100 - 40],
          [100 + 69.3, 100 + 40],
        ],
        width: 8,
      },
      {
        pts: [
          [100 - 69.3, 100 + 40],
          [100 + 69.3, 100 - 40],
        ],
        width: 8,
      },
    ],
  },
  "curve.png": {
    w: 300,
    h: 150,
    strokes: [
      {
        pts: Array.from({ length: 121 }, (_, i): Pt => {
          const x = 20 + (260 * i) / 120;
          return [x, 75 + 40 * Math.sin(((x - 20) / 260) * Math.PI * 2)];
        }),
        width: 6,
      },
    ],
  },
};

const dir = path.dirname(fileURLToPath(import.meta.url));
for (const [name, img] of Object.entries(images)) {
  const png = encodeGreyPng(img.w, img.h, render(img.w, img.h, img.strokes));
  writeFileSync(path.join(dir, name), png);
  console.log(`${name}: ${img.w}x${img.h}, ${png.length} bytes`);
}
