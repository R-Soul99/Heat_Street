import path from "node:path";
import { Readable } from "node:stream";
import { describe, expect, it } from "vitest";
import {
  isSafeAreaId,
  MAX_BIN_BYTES,
  MAX_JSON_BYTES,
  readBodyCapped,
  resolveTerrainFile,
} from "../tools/terrain-editor/paths.ts";

describe("isSafeAreaId", () => {
  it("accepts lowercase ids", () => {
    expect(isSafeAreaId("demo-hills")).toBe(true);
    expect(isSafeAreaId("a1")).toBe(true);
  });
  it("rejects traversal, case, separators, dots, encodings, overlong", () => {
    for (const bad of ["", "../x", "A", "a/b", "a\\b", "a.b", "%2e%2e", "x".repeat(65)]) {
      expect(isSafeAreaId(bad), bad).toBe(false);
    }
  });
});

describe("resolveTerrainFile", () => {
  const root = path.resolve("some", "root");
  it("resolves inside public/maps", () => {
    const p = resolveTerrainFile(root, "demo-hills", "bin");
    expect(p).toBe(path.resolve(root, "public", "maps", "demo-hills.terrain.bin"));
    expect(p?.startsWith(path.resolve(root, "public", "maps") + path.sep)).toBe(true);
  });
  it("rejects bad ids and kinds", () => {
    expect(resolveTerrainFile(root, "../x", "bin")).toBeNull();
    expect(resolveTerrainFile(root, "ok", "exe")).toBeNull();
    expect(resolveTerrainFile(root, "ok", "json")).not.toBeNull();
  });
});

describe("readBodyCapped", () => {
  it("rejects with status 413 over the cap", async () => {
    const stream = Readable.from([Buffer.alloc(10)]);
    await expect(readBodyCapped(stream, 5)).rejects.toMatchObject({ status: 413 });
  });
  it("resolves the buffer at the cap", async () => {
    const buf = await readBodyCapped(Readable.from([Buffer.alloc(10)]), 10);
    expect(buf.length).toBe(10);
  });
});

describe("limits", () => {
  it("are 64 MiB and 8 MiB", () => {
    expect(MAX_BIN_BYTES).toBe(64 * 1024 * 1024);
    expect(MAX_JSON_BYTES).toBe(8 * 1024 * 1024);
  });
});
