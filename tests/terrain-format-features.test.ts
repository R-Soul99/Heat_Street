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
  const raw = JSON.parse(readFileSync(`${MAPS}/demo-hills.terrain.json`, "utf8")) as Record<
    string,
    unknown
  >;
  // The saved map may gain scenery from the editor; these tests need a bare one.
  const { features: _f, ...bare } = raw;
  return { ...bare, buildings: [] };
}

const BUILD = { center: { x: 0, y: 1, z: 0 }, halfExtents: { x: 2, y: 1, z: 2 }, rotationY: 0 };

const FEATURES = [
  { id: "f1", kind: "tree", variant: "pine", x: 1, z: 2, rotationY: 0.5, scale: 1 },
  { id: "f2", kind: "tree", variant: "oak", x: -3, z: 4, rotationY: 0, scale: 1.5 },
  { id: "f3", kind: "bush", variant: "round", x: 5, z: 6, rotationY: 1, scale: 0.5 },
  {
    id: "f4",
    kind: "hedge",
    variant: "box",
    points: [
      [0, 0],
      [5, 0],
      [5, 5],
    ],
    heightM: 1.5,
  },
  {
    id: "f5",
    kind: "fence",
    variant: "picket",
    points: [
      [0, 0],
      [8, 0],
    ],
    heightM: 1.2,
  },
];

function parse(o: Record<string, unknown>) {
  return parseTerrainSidecar(JSON.stringify(o), "demo-hills", "t.json");
}

describe("sidecar features and building style", () => {
  it("round-trips features and building style", () => {
    const a = parse({
      ...baseSidecar(),
      buildings: [{ ...BUILD, style: "house" }, BUILD],
      features: FEATURES,
    });
    expect(a.features).toEqual(FEATURES);
    const b = parseTerrainSidecar(serializeTerrainSidecar(a), "demo-hills", "t.json");
    expect(b.features).toEqual(FEATURES);
    expect(b.buildings[0]?.style).toBe("house");
    expect(b.buildings[1]?.style).toBeUndefined();
    expect("style" in (b.buildings[1] ?? {})).toBe(false);
  });

  it("shipped sidecars without features serialise byte-identically", () => {
    const files = readdirSync(MAPS).filter((f) => f.endsWith(".terrain.json"));
    expect(files.length).toBeGreaterThan(0);
    for (const f of files) {
      if (f.startsWith("arena-test")) continue; // user's in-progress edits
      const id = f.replace(".terrain.json", "");
      const text = readFileSync(`${MAPS}/${f}`, "utf8");
      const side = parseTerrainSidecar(text, id, f);
      if (side.features !== undefined || side.buildings.some((b) => b.style !== undefined))
        continue;
      expect(serializeTerrainSidecar(side), f).toBe(text);
    }
  });

  it("omits an empty array", () => {
    const a = parse({ ...baseSidecar(), features: [] });
    expect(serializeTerrainSidecar(a)).not.toContain("features");
    expect(serializeTerrainSidecar(a)).not.toContain("style");
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
      JSON.stringify({
        ...baseSidecar(),
        buildings: [{ ...BUILD, style: "barn" }],
        features: FEATURES,
      }),
      "demo-hills",
      "t",
    );
    expect(area.features).toEqual(FEATURES);
    expect(area.buildings[0]?.style).toBe("barn");
  });

  const tree = FEATURES[0] as Record<string, unknown>;
  const hedge = FEATURES[3] as Record<string, unknown>;
  const many = (n: number, f: Record<string, unknown>) =>
    Array.from({ length: n }, (_, i) => ({ ...f, id: `g${i}` }));
  const bad: [string, Record<string, unknown>, string][] = [
    ["unknown kind", { features: [{ ...tree, kind: "rock" }] }, "features[0].kind"],
    ["unknown variant", { features: [{ ...tree, variant: "bogus" }] }, "features[0].variant"],
    ["__proto__ variant", { features: [{ ...tree, variant: "__proto__" }] }, "features[0].variant"],
    ["duplicate id", { features: [tree, { ...tree }] }, "features[1].id"],
    ["scale too small", { features: [{ ...tree, scale: 0.4 }] }, "features[0].scale"],
    ["scale too large", { features: [{ ...tree, scale: 2.1 }] }, "features[0].scale"],
    ["1 point line", { features: [{ ...hedge, points: [[0, 0]] }] }, "features[0].points"],
    [
      "65 point line",
      { features: [{ ...hedge, points: Array.from({ length: 65 }, (_, i) => [i, 0]) }] },
      "features[0].points",
    ],
    ["height below min", { features: [{ ...hedge, heightM: 0.9 }] }, "features[0].heightM"],
    ["height above max", { features: [{ ...hedge, heightM: 6.5 }] }, "features[0].heightM"],
    ["non-finite x", { features: [{ ...tree, x: null }] }, "features[0].x"],
    ["coordinate too large", { features: [{ ...tree, x: 100001 }] }, "features[0].x"],
    [
      "bad line point",
      {
        features: [
          {
            ...hedge,
            points: [
              [0, 0],
              [Number.NaN, 1],
            ],
          },
        ],
      },
      "features[0].points[1]",
    ],
    ["4001 point features", { features: many(4001, tree) }, "point features"],
    ["501 line features", { features: many(501, hedge) }, "line features"],
    ["2001 buildings", { buildings: Array.from({ length: 2001 }, () => BUILD) }, "buildings"],
    ["unknown style", { buildings: [{ ...BUILD, style: "castle" }] }, "buildings[0].style"],
    ["__proto__ style", { buildings: [{ ...BUILD, style: "__proto__" }] }, "buildings[0].style"],
  ];
  for (const [name, patch, frag] of bad) {
    it(`rejects ${name}`, () => {
      expect(() => parse({ ...baseSidecar(), ...patch })).toThrow(frag);
    });
  }
});
