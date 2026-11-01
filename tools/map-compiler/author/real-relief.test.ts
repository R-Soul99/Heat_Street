import { deflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { decodeGreyPng, sampleGrey } from "./real-relief.ts";

/** Builds a tiny 16-bit greyscale PNG from row-major 0..65535 values, filter 0. */
function makePng16(width: number, height: number, values: number[]): Uint8Array {
  const raw = Buffer.alloc(height * (width * 2 + 1));
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      raw.writeUInt16BE(values[y * width + x] as number, y * (width * 2 + 1) + 1 + x * 2);
    }
  }
  const chunk = (type: string, data: Buffer): Buffer => {
    const out = Buffer.alloc(12 + data.length);
    out.writeUInt32BE(data.length, 0);
    out.write(type, 4, "ascii");
    data.copy(out, 8);
    return out; // CRC left zero: the decoder does not verify it
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 16;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

describe("decodeGreyPng", () => {
  it("decodes 16-bit greyscale to 0..1", () => {
    const img = decodeGreyPng(makePng16(2, 2, [0, 65535, 32768, 65535]));
    expect(img.width).toBe(2);
    expect(img.height).toBe(2);
    expect(img.values[0]).toBe(0);
    expect(img.values[1]).toBe(1);
    expect(img.values[2]).toBeCloseTo(0.5, 3);
  });
  it("rejects non-PNG bytes", () => {
    expect(() => decodeGreyPng(new Uint8Array(32))).toThrow("not a PNG");
  });
});

describe("sampleGrey", () => {
  it("interpolates bilinearly and clamps outside 0..1", () => {
    const img = decodeGreyPng(makePng16(2, 1, [0, 65535]));
    expect(sampleGrey(img, 0.5, 0)).toBeCloseTo(0.5, 3);
    expect(sampleGrey(img, 2, 0)).toBe(1);
    expect(sampleGrey(img, -1, 0)).toBe(0);
  });
});
