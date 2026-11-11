import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { BUILTIN_MAP_IDS, MAP_FORMATS } from "../../src/core/map-select.ts";
import {
  authoredLabel,
  authoredLegacyIds,
  BUILTIN_TERRAIN_IDS,
  compilerRegistrySource,
  isDrivableTerrain,
  parseAuthoredManifest,
  readAuthoredManifest,
  registerAuthoredMap,
  runtimeRegistrySource,
} from "./authored-registry.ts";

describe("parseAuthoredManifest", () => {
  it("parses a valid manifest", () => {
    expect(parseAuthoredManifest('[{"id":"popp","format":"legacy"}]')).toEqual([
      { id: "popp", format: "legacy" },
    ]);
  });
  it("rejects bad input", () => {
    expect(() => parseAuthoredManifest('[{"id":"../x","format":"legacy"}]')).toThrow(/bad id/);
    expect(() => parseAuthoredManifest('[{"id":"A","format":"legacy"}]')).toThrow(/bad id/);
    expect(() => parseAuthoredManifest('[{"id":"a","format":"odd"}]')).toThrow(/format/);
    expect(() =>
      parseAuthoredManifest('[{"id":"a","format":"legacy"},{"id":"a","format":"legacy"}]'),
    ).toThrow(/duplicate/);
    expect(() => parseAuthoredManifest("{}")).toThrow(/array/);
  });
});

describe("generators", () => {
  it("derives labels", () => {
    expect(authoredLabel("my-new-town")).toBe("My New Town (authored)");
  });
  it("compiler source only imports legacy areas", () => {
    const src = compilerRegistrySource([
      { id: "popp", format: "legacy" },
      { id: "hills", format: "terrain" },
    ]);
    expect(src).toContain('import { poppConfig } from "./popp.config.ts";');
    expect(src).toContain('"popp": poppConfig');
    expect(src).not.toContain("hills");
    expect(compilerRegistrySource([])).toContain(
      "export const AUTHORED_AREAS: Record<string, AreaConfig> = {};",
    );
  });
  it("runtime source lists every id", () => {
    const src = runtimeRegistrySource([
      { id: "popp", format: "legacy" },
      { id: "hills", format: "terrain" },
    ]);
    expect(src).toContain('export const AUTHORED_MAP_IDS = ["popp", "hills"] as const;');
    expect(src).toContain('"hills": "Hills (authored)"');
    expect(src).toContain('"popp": "legacy"');
    expect(runtimeRegistrySource([])).toContain("AUTHORED_MAP_IDS = [] as const");
  });
});

describe("registerAuthoredMap", () => {
  it("registers once, idempotently, and guards inputs", async () => {
    const root = await mkdtemp(join(tmpdir(), "authreg-"));
    try {
      const areas = join(root, "tools", "map-compiler", "areas");
      await mkdir(areas, { recursive: true });
      await writeFile(join(areas, "x.config.ts"), "export {};\n");
      expect(await registerAuthoredMap(root, { id: "x", format: "legacy" })).toEqual({
        added: true,
      });
      const manifest = join(root, "tools", "map-compiler", "authored-maps.json");
      const before = await readFile(manifest, "utf8");
      expect(await readFile(join(areas, "authored-areas.generated.ts"), "utf8")).toContain(
        "xConfig",
      );
      expect(
        await readFile(join(root, "src", "core", "authored-maps.generated.ts"), "utf8"),
      ).toContain('"x"');
      expect(await registerAuthoredMap(root, { id: "x", format: "legacy" })).toEqual({
        added: false,
      });
      expect(await readFile(manifest, "utf8")).toBe(before);
      await expect(registerAuthoredMap(root, { id: "nope", format: "legacy" })).rejects.toThrow(
        /no area config/,
      );
      await expect(registerAuthoredMap(root, { id: "my-map", format: "legacy" })).rejects.toThrow(
        /already a built-in map/,
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe("manifest helpers", () => {
  it("returns [] for a missing manifest and reads entries otherwise", async () => {
    const root = await mkdtemp(join(tmpdir(), "reg-helpers-"));
    try {
      expect(readAuthoredManifest(root)).toEqual([]);
      await mkdir(join(root, "tools", "map-compiler"), { recursive: true });
      await writeFile(
        join(root, "tools", "map-compiler", "authored-maps.json"),
        '[{"id":"a-map","format":"legacy"},{"id":"a-hill","format":"terrain"}]',
      );
      expect(readAuthoredManifest(root)).toHaveLength(2);
      expect(authoredLegacyIds(root)).toEqual(["a-map"]);
      expect(isDrivableTerrain(root, "a-hill")).toBe(true);
      expect(isDrivableTerrain(root, "a-map")).toBe(false);
      expect(isDrivableTerrain(root, "demo-hills")).toBe(true);
      expect(isDrivableTerrain(root, "my-map")).toBe(false);
      expect(isDrivableTerrain(root, "nope")).toBe(false);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
  it("BUILTIN_TERRAIN_IDS matches map-select", () => {
    const expected = BUILTIN_MAP_IDS.filter((id) => MAP_FORMATS[id] === "terrain");
    expect([...BUILTIN_TERRAIN_IDS].sort()).toEqual([...expected].sort());
  });
});
