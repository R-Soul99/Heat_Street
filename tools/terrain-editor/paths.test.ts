import path from "node:path";
import { describe, expect, it } from "vitest";
import { isSafeAreaId, resolveRouteFile, resolveTerrainFile } from "./paths.ts";

const ROOT = path.resolve("/tmp/heat-root");

describe("resolveRouteFile", () => {
  it("resolves stages and routes files under public/maps", () => {
    expect(resolveRouteFile(ROOT, "demo-hills", "stages")).toMatch(
      new RegExp(
        `${path.join("public", "maps", "demo-hills.stages.json").replace(/\\/g, "\\\\")}$`,
      ),
    );
    expect(resolveRouteFile(ROOT, "demo-hills", "routes")?.endsWith("demo-hills.routes.json")).toBe(
      true,
    );
  });
  it("refuses bad ids and kinds", () => {
    for (const id of ["../x", "A", "", "a".repeat(65), "a/b"]) {
      expect(resolveRouteFile(ROOT, id, "stages")).toBeNull();
    }
    expect(resolveRouteFile(ROOT, "demo-hills", "medals" as never)).toBeNull();
  });
});

describe("existing resolvers", () => {
  it("resolveTerrainFile and isSafeAreaId still behave", () => {
    expect(resolveTerrainFile(ROOT, "demo-hills", "bin")?.endsWith("demo-hills.terrain.bin")).toBe(
      true,
    );
    expect(resolveTerrainFile(ROOT, "demo-hills", "glb")).toBeNull();
    expect(isSafeAreaId("demo-hills")).toBe(true);
    expect(isSafeAreaId("Demo")).toBe(false);
  });
});
