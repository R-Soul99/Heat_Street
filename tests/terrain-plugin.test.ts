import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
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
import {
  safeMessage,
  validateAreaPair,
  validateSidecarPut,
  writeAtomic,
} from "../tools/terrain-editor/vite-plugin.ts";

describe("validateSidecarPut (D-17 save guard on the server)", () => {
  const shipped = ["demo-hills", "feel-test", "grid-test", "juliette-ga"];
  for (const id of shipped) {
    it(`accepts the tracked ${id} sidecar`, async () => {
      const text = await readFile(path.join("public", "maps", `${id}.terrain.json`), "utf8");
      expect(() => validateSidecarPut(text, id)).not.toThrow();
    });
  }
  it("rejects a graph with a blocking validation failure with terrain-save:", async () => {
    const text = await readFile(path.join("public", "maps", "feel-test.terrain.json"), "utf8");
    const json = JSON.parse(text);
    // A 60 m spike mid-edge: parses fine but fails GEOMETRY_GRADIENT.
    const pts = json.graph.edges[0].points;
    pts[Math.floor(pts.length / 2)][1] += 60;
    expect(() => validateSidecarPut(JSON.stringify(json), "feel-test")).toThrow(/^terrain-save:/);
  });
  it("still rejects malformed JSON as a format error", () => {
    expect(() => validateSidecarPut("{not json", "feel-test")).toThrow(
      /^(terrain-format|parseRoadGraph):/,
    );
  });
});

describe("safeMessage (WR-01)", () => {
  it("redacts a Windows path that contains spaces, whole", () => {
    const winPath = String.raw`d:\Projects 2\Heat Street - Copy\public\maps\x.bin`;
    const msg = safeMessage(new Error(`ENOENT: cannot open ${winPath}`));
    expect(msg).toBe("ENOENT: cannot open <path>");
  });
  it("still redacts a path inside quotes and a POSIX path", () => {
    const quoted = String.raw`failed "C:\a b\c" now`;
    expect(safeMessage(new Error(quoted))).toBe('failed "<path>" now');
    expect(safeMessage(new Error("bad /home/me/dir/file.bin"))).toBe("bad <path>");
  });
  it("leaves validation prefixes and plain text alone", () => {
    expect(safeMessage(new Error("terrain-format: x.bin: bad magic"))).toBe(
      "terrain-format: x.bin: bad magic",
    );
  });
});

describe("validateAreaPair (WR-02)", () => {
  const read = (ext: string) => readFile(path.join("public", "maps", `feel-test.terrain.${ext}`));
  it("accepts the tracked feel-test pair", async () => {
    const bin = new Uint8Array(await read("bin"));
    const text = (await read("json")).toString("utf8");
    await expect(validateAreaPair("feel-test", bin, text)).resolves.toBeUndefined();
  });
  it("skips the check while one half is missing (new area)", async () => {
    const bin = new Uint8Array(await read("bin"));
    await expect(validateAreaPair("feel-test", bin, undefined)).resolves.toBeUndefined();
    await expect(validateAreaPair("feel-test", undefined, "{}")).resolves.toBeUndefined();
  });
  it("rejects a sidecar whose graph lies outside the saved grid", async () => {
    const bin = new Uint8Array(await read("bin"));
    const json = JSON.parse((await read("json")).toString("utf8"));
    json.graph.bounds.maxX += 5000;
    await expect(validateAreaPair("feel-test", bin, JSON.stringify(json))).rejects.toThrow(
      /^terrain-format:/,
    );
  });
});

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
  it("leaves the stream alive so the 413 response can still be sent (WR-03)", async () => {
    const stream = Readable.from([Buffer.alloc(10), Buffer.alloc(10), Buffer.alloc(10)]);
    await expect(readBodyCapped(stream, 5)).rejects.toMatchObject({ status: 413 });
    expect(stream.destroyed).toBe(false);
    expect(stream.isPaused()).toBe(true);
  });
  it("resolves the buffer at the cap", async () => {
    const buf = await readBodyCapped(Readable.from([Buffer.alloc(10)]), 10);
    expect(buf.length).toBe(10);
  });
});

describe("writeAtomic (WR-07)", () => {
  it("concurrent writes to one file all succeed and publish one intact body", async () => {
    // Scratch directory under the OS temp dir, removed afterwards.
    const dir = await mkdtemp(path.join(tmpdir(), "hs-write-atomic-"));
    try {
      const file = path.join(dir, "a.terrain.bin");
      const bodies = Array.from({ length: 8 }, (_, i) => Buffer.alloc(256 * 1024, i + 1));
      await Promise.all(bodies.map((b) => writeAtomic(file, b)));
      const out = await readFile(file);
      expect(out.length).toBe(256 * 1024);
      // Every byte comes from the same writer (no interleaving).
      expect(out.every((v) => v === out[0])).toBe(true);
      // No temp files left behind.
      expect(await readdir(dir)).toEqual(["a.terrain.bin"]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("limits", () => {
  it("are 64 MiB and 8 MiB", () => {
    expect(MAX_BIN_BYTES).toBe(64 * 1024 * 1024);
    expect(MAX_JSON_BYTES).toBe(8 * 1024 * 1024);
  });
});
