import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  encodeTerrainBinary,
  loadTerrainArea,
  parseTerrainSidecar,
  serializeTerrainSidecar,
} from "../src/core/terrain-format.ts";
import { createTerrainGrid } from "../src/core/terrain-grid.ts";
import { createPaintMap } from "../src/core/terrain-paint.ts";

const MAPS = "public/maps";

function baseSidecar(): Record<string, unknown> {
  const text = readFileSync(`${MAPS}/demo-hills.terrain.json`, "utf8");
  return JSON.parse(text) as Record<string, unknown>;
}

const SP = [
  { id: "start-1", name: "Main", x: 1, z: 2, headingRad: 0.5 },
  { id: "start-2", name: "Alt", x: -3, z: 4, headingRad: 3 },
];

function parse(o: Record<string, unknown>) {
  return parseTerrainSidecar(JSON.stringify(o), "demo-hills", "t.json");
}

describe("sidecar startPoints", () => {
  it("round-trips through parse and serialize", () => {
    const a = parse({ ...baseSidecar(), startPoints: SP });
    expect(a.startPoints).toEqual(SP);
    const b = parseTerrainSidecar(serializeTerrainSidecar(a), "demo-hills", "t.json");
    expect(b.startPoints).toEqual(SP);
  });

  it("shipped sidecars without startPoints serialise byte-identically", () => {
    const files = readdirSync(MAPS).filter((f) => f.endsWith(".terrain.json"));
    expect(files.length).toBeGreaterThan(0);
    for (const f of files) {
      if (f.startsWith("arena-test")) continue; // user's in-progress edits
      const id = f.replace(".terrain.json", "");
      const text = readFileSync(`${MAPS}/${f}`, "utf8");
      const side = parseTerrainSidecar(text, id, f);
      if (side.startPoints !== undefined) continue;
      expect(serializeTerrainSidecar(side), f).toBe(text);
    }
  });

  it("omits an empty array", () => {
    const a = parse({ ...baseSidecar(), startPoints: [] });
    expect(serializeTerrainSidecar(a)).not.toContain("startPoints");
  });

  it("passes through loadTerrainArea", async () => {
    const side = parse(baseSidecar());
    const b = side.graph.bounds;
    const grid = createTerrainGrid({
      rows: 400,
      cols: 400,
      cellSizeM: 3,
      originX: b.minX - 10,
      originZ: b.minZ - 10,
    });
    const paint = createPaintMap({
      originX: grid.originX,
      originZ: grid.originZ,
      widthM: 10,
      depthM: 10,
      metresPerPixel: 1,
      fill: "grass",
    });
    const bin = await encodeTerrainBinary({ grid, paint, colliderSubdiv: 1 });
    const area = await loadTerrainArea(
      bin,
      JSON.stringify({ ...baseSidecar(), startPoints: SP }),
      "demo-hills",
      "t",
    );
    expect(area.startPoints).toEqual(SP);
  });

  const bad: [string, unknown, string][] = [
    ["duplicate id", [SP[0], { ...SP[0] }], "startPoints[1].id"],
    [
      "33 entries",
      Array.from({ length: 33 }, (_, i) => ({ ...SP[0], id: `start-${i}` })),
      "startPoints",
    ],
    ["non-finite x", [{ ...SP[0], x: null }], "startPoints[0].x"],
    ["non-finite z", [{ ...SP[0], z: "a" }], "startPoints[0].z"],
    ["non-finite heading", [{ ...SP[0], headingRad: null }], "startPoints[0].headingRad"],
    ["empty name", [{ ...SP[0], name: "" }], "startPoints[0].name"],
    ["long name", [{ ...SP[0], name: "x".repeat(41) }], "startPoints[0].name"],
    ["id not string", [{ ...SP[0], id: 4 }], "startPoints[0].id"],
    ["x too large", [{ ...SP[0], x: 100001 }], "startPoints[0].x"],
    ["not array", { a: 1 }, "startPoints"],
    ["entry not object", [SP[0], 5], "startPoints[1]"],
  ];
  for (const [name, value, frag] of bad) {
    it(`rejects ${name}`, () => {
      expect(() => parse({ ...baseSidecar(), startPoints: value })).toThrow(frag);
    });
  }

  it("ignores __proto__ in an entry", () => {
    const text = JSON.stringify({ ...baseSidecar(), startPoints: [SP[0]] }).replace(
      '"id":"start-1"',
      '"__proto__":{"polluted":true},"id":"start-1"',
    );
    const a = parseTerrainSidecar(text, "demo-hills", "t.json");
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(Object.keys(a.startPoints?.[0] ?? {})).toEqual(["id", "name", "x", "z", "headingRad"]);
  });
});
