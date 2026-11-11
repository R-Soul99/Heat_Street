import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { registerAuthoredMap } from "../authored-registry.ts";
import { AUTHORED_TARGET_VERTICES, authoredConvertConfig, CONVERT_CONFIG } from "./convert.ts";
import { convertAuthoredMap, findAuthoredId } from "./convert-authored.ts";

describe("authoredConvertConfig", () => {
  it("uses 3 m cells and 0.5 m paint for a small map", () => {
    expect(authoredConvertConfig(800, 600, true)).toEqual({
      cellSizeM: 3,
      paintMetresPerPixel: 0.5,
      legacyGlbBuildings: true,
      roadWidenM: 2,
    });
  });
  it("keeps a 2 km square map at 3 m cells and 0.5 m paint", () => {
    const c = authoredConvertConfig(1960, 1960, false);
    expect(c.cellSizeM).toBe(3);
    expect(c.paintMetresPerPixel).toBe(0.5);
    expect(c.legacyGlbBuildings).toBe(false);
    expect((Math.ceil(1960 / c.cellSizeM) + 1) ** 2).toBeLessThanOrEqual(AUTHORED_TARGET_VERTICES);
  });
  it("coarsens the grid and paint for a much bigger map", () => {
    const c = authoredConvertConfig(5000, 5000, true);
    expect(c.cellSizeM).toBeGreaterThan(3);
    expect(c.paintMetresPerPixel).toBeGreaterThan(0.5);
    expect((5000 / c.cellSizeM) ** 2).toBeLessThanOrEqual(AUTHORED_TARGET_VERTICES * 1.05);
  });
  it("leaves the built-in table alone", () => {
    expect(CONVERT_CONFIG["juliette-ga"].cellSizeM).toBe(8);
    expect(Object.keys(CONVERT_CONFIG)).toHaveLength(6);
  });
});

describe("convertAuthoredMap id allowlist", () => {
  it("rejects ids that are not on the authored list, including path tricks", async () => {
    const root = await mkdtemp(join(tmpdir(), "hs-conv-"));
    try {
      await registerAuthoredMap(root, { id: "terrain-fmt", format: "terrain" });
      expect(findAuthoredId(root, "terrain-fmt")).toBe("terrain-fmt");
      expect(findAuthoredId(root, "terrain-fm")).toBeUndefined();
      for (const bad of ["../x", "juliette-ga", "", "TERRAIN-FMT", "terrain-fmt/.."]) {
        await expect(convertAuthoredMap(root, bad)).rejects.toThrow(/not one of your maps/);
      }
      await expect(convertAuthoredMap(root, "terrain-fmt")).rejects.toThrow(/not been compiled/);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
