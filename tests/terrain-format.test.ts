import { describe, expect, it } from "vitest";
import type { RoadGraph } from "../src/core/road-graph.ts";
import { SURFACE_TYPES } from "../src/core/surface-types.ts";
import {
  decodeTerrainBinary,
  encodeTerrainBinary,
  loadTerrainArea,
  parseTerrainSidecar,
  serializeTerrainSidecar,
  TERRAIN_FORMAT_VERSION,
  type TerrainArea,
} from "../src/core/terrain-format.ts";
import { createTerrainGrid, type TerrainGrid } from "../src/core/terrain-grid.ts";
import { createPaintMap, type PaintMap } from "../src/core/terrain-paint.ts";

const LABEL = "test.terrain.bin";

function makeGrid(rows: number, cols: number, f: (i: number) => number): TerrainGrid {
  const g = createTerrainGrid({ rows, cols, cellSizeM: 3, originX: -10, originZ: 20 });
  for (let i = 0; i < g.heights.length; i++) g.heights[i] = f(i);
  return g;
}

function tinyPaint(): PaintMap {
  return {
    width: 2,
    height: 2,
    metresPerPixel: 1,
    originX: 0,
    originZ: 0,
    data: new Uint8Array([0, 1, 0x83, 0x80]),
  };
}

const GOLDEN = Uint8Array.from(
  "72,83,84,82,1,0,116,0,1,0,0,0,1,0,0,0,0,0,0,64,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,255,255,255,255,10,215,35,60,1,0,0,0,2,0,0,0,2,0,0,0,0,0,128,63,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,6,6,116,97,114,109,97,99,6,103,114,97,118,101,108,9,100,105,114,116,95,114,111,97,100,5,103,114,97,115,115,4,115,97,110,100,3,109,117,100,1,0,2,0,0,0,101,0,0,1,131,128"
    .split(",")
    .map(Number),
);

describe("terrain binary codec", () => {
  it("round-trips heights, paint and header fields", async () => {
    const grid = makeGrid(5, 7, (i) => -3.27 + (i / 47) * (12.5 + 3.27));
    const paint = createPaintMap({
      originX: -10,
      originZ: 20,
      widthM: 30,
      depthM: 22,
      metresPerPixel: 1,
      fill: "grass",
    });
    for (let i = 0; i < paint.data.length; i++) paint.data[i] = (i * 7) & 0x85;
    const bytes = await encodeTerrainBinary({ grid, paint, colliderSubdiv: 2 });
    const out = await decodeTerrainBinary(bytes, LABEL);
    expect(out.grid.rows).toBe(5);
    expect(out.grid.cols).toBe(7);
    expect(out.grid.cellSizeM).toBe(3);
    expect(out.grid.originX).toBe(-10);
    expect(out.grid.originZ).toBe(20);
    expect(out.grid.scaleX).toBe(21);
    expect(out.grid.scaleZ).toBe(15);
    expect(out.colliderSubdiv).toBe(2);
    for (let i = 0; i < grid.heights.length; i++) {
      expect(
        Math.abs(out.grid.heights[i] - Math.round(grid.heights[i] / 0.01) * 0.01),
      ).toBeLessThanOrEqual(0.005);
    }
    expect(out.paint.width).toBe(30);
    expect(out.paint.height).toBe(22);
    expect(out.paint.metresPerPixel).toBe(1);
    expect(out.paint.originX).toBe(-10);
    expect(Array.from(out.paint.data)).toEqual(Array.from(paint.data));
  });

  it("keeps a flat zero exactly zero", async () => {
    const grid = makeGrid(3, 3, () => 0);
    const out = await decodeTerrainBinary(
      await encodeTerrainBinary({ grid, paint: tinyPaint(), colliderSubdiv: 1 }),
      LABEL,
    );
    for (const h of out.grid.heights) expect(Object.is(h, 0)).toBe(true);
  });

  it("matches the golden bytes for a 1x1 grid", async () => {
    const grid = createTerrainGrid({ rows: 1, cols: 1, cellSizeM: 2, originX: 0, originZ: 0 });
    grid.heights.set([0, 0.01, -0.01, 1.0]);
    const bytes = await encodeTerrainBinary(
      { grid, paint: tinyPaint(), colliderSubdiv: 1 },
      { paintEncoding: 0 },
    );
    expect(String.fromCharCode(...bytes.subarray(0, 4))).toBe("HSTR");
    expect(bytes[4] | (bytes[5] << 8)).toBe(1);
    expect(Array.from(bytes)).toEqual(Array.from(GOLDEN));
    const out = await decodeTerrainBinary(GOLDEN, LABEL);
    expect(out.grid.heights[3]).toBeCloseTo(1.0, 5);
  });

  it("deflate encoding round-trips and is smaller than raw for uniform paint", async () => {
    const grid = makeGrid(2, 2, () => 1);
    const paint = createPaintMap({
      originX: 0,
      originZ: 0,
      widthM: 1000,
      depthM: 1000,
      metresPerPixel: 1,
      fill: "gravel",
    });
    const raw = await encodeTerrainBinary({ grid, paint, colliderSubdiv: 1 }, { paintEncoding: 0 });
    const zip = await encodeTerrainBinary({ grid, paint, colliderSubdiv: 1 }, { paintEncoding: 1 });
    expect(zip.length).toBeLessThan(raw.length);
    const out = await decodeTerrainBinary(zip, LABEL);
    expect(out.paint.data.length).toBe(1_000_000);
    expect(out.paint.data[123456]).toBe(1);
  });

  it("rejects an unknown future version by name", async () => {
    const bytes = GOLDEN.slice();
    bytes[4] = 99;
    await expect(decodeTerrainBinary(bytes, LABEL)).rejects.toThrow("unknown format version 99");
  });

  it("runs an older version through the injected migration", async () => {
    const bytes = GOLDEN.slice();
    bytes[4] = 0;
    let called = 0;
    const out = await decodeTerrainBinary(bytes, LABEL, {
      0: (b) => {
        called++;
        const c = b.slice();
        c[4] = 1;
        return c;
      },
    });
    expect(called).toBe(1);
    expect(out.grid.rows).toBe(1);
    await expect(decodeTerrainBinary(bytes, LABEL)).rejects.toThrow("no migration");
  });

  it("rejects truncated input at every short length", async () => {
    for (let n = 0; n <= 116; n++) {
      await expect(decodeTerrainBinary(GOLDEN.slice(0, n), LABEL)).rejects.toThrow(
        /terrain-format/,
      );
    }
    await expect(decodeTerrainBinary(GOLDEN.slice(0, GOLDEN.length - 1), LABEL)).rejects.toThrow(
      /terrain-format/,
    );
    await expect(decodeTerrainBinary(new Uint8Array(GOLDEN.length + 1), LABEL)).rejects.toThrow(
      /terrain-format/,
    );
  });

  it("rejects oversized headers before allocating", async () => {
    const big = GOLDEN.slice();
    new DataView(big.buffer).setUint32(8, 100_000, true);
    new DataView(big.buffer).setUint32(12, 100_000, true);
    await expect(decodeTerrainBinary(big, LABEL)).rejects.toThrow(/vertex count/);
    const bigPaint = GOLDEN.slice();
    new DataView(bigPaint.buffer).setUint32(48, 2 ** 20, true);
    new DataView(bigPaint.buffer).setUint32(52, 2 ** 20, true);
    await expect(decodeTerrainBinary(bigPaint, LABEL)).rejects.toThrow(/paint pixel count/);
  });

  it("rejects a deflated paint section that inflates past its declared size", async () => {
    const grid = makeGrid(1, 1, () => 0);
    const mk = (w: number, h: number): PaintMap => ({
      width: w,
      height: h,
      metresPerPixel: 1,
      originX: 0,
      originZ: 0,
      data: new Uint8Array(w * h),
    });
    const bytes = await encodeTerrainBinary({ grid, paint: mk(1000, 1000), colliderSubdiv: 1 });
    const dv = new DataView(bytes.buffer);
    dv.setUint32(48, 10, true);
    dv.setUint32(52, 10, true);
    await expect(decodeTerrainBinary(bytes, LABEL)).rejects.toThrow(/inflates/);
  });

  it("rejects an unknown surface name and remaps a reordered enum", async () => {
    const bad = GOLDEN.slice();
    // first enum name "tarmac" starts at 78; corrupt one letter
    bad[78] = "x".charCodeAt(0);
    await expect(decodeTerrainBinary(bad, LABEL)).rejects.toThrow(/unknown surface/);

    // swap "tarmac" and "gravel" in the file enum (same lengths) so file index 0 = gravel
    const swapped = GOLDEN.slice();
    const t = Array.from("tarmac").map((c) => c.charCodeAt(0));
    const g = Array.from("gravel").map((c) => c.charCodeAt(0));
    swapped.set(g, 78);
    swapped.set(t, 85);
    const out = await decodeTerrainBinary(swapped, LABEL);
    // file bytes [0,1,0x83,0x80]: file0=gravel(1), file1=tarmac(0), file3=grass(3)
    expect(Array.from(out.paint.data)).toEqual([1, 0, 0x83, 0x81]);
    expect(SURFACE_TYPES[out.paint.data[0] & 0x0f]).toBe("gravel");
  });

  it("rejects a height span beyond 16 bits", async () => {
    const grid = makeGrid(1, 1, (i) => (i === 0 ? 0 : 700));
    await expect(
      encodeTerrainBinary({ grid, paint: tinyPaint(), colliderSubdiv: 1 }),
    ).rejects.toThrow(RangeError);
  });
});

function sampleGraph(areaId = "t-area"): RoadGraph {
  return {
    schemaVersion: 1,
    areaId,
    name: "Test",
    source: {
      osmExtract: "none",
      osmSnapshot: "2026-01-01T00:00:00Z",
      demSource: "none-flat-authored",
      compilerVersion: "0.0.0",
    },
    attribution: { osm: "o", osmLicense: "ODbL-1.0", osmLicenseUrl: "https://x", dem: "d" },
    origin: { lat: 0, lon: 0, projection: "enu" },
    bounds: { minX: -10, minZ: 20, maxX: 11, maxZ: 35 },
    nodes: [
      { id: 0, x: -5, y: 0, z: 25, junction: false, osmNodeId: 0 },
      { id: 1, x: 5, y: 0, z: 25, junction: false, osmNodeId: 0 },
    ],
    edges: [
      {
        id: 4,
        from: 0,
        to: 1,
        points: [
          [-5, 0, 25],
          [5, 0, 25],
        ],
        lengthM: 10,
        surface: "tarmac",
        roadClass: "residential",
        lanes: 2,
        widthM: 7,
        oneway: false,
        speedLimitKph: 50,
        bridge: false,
        tunnel: false,
        layer: 0,
        osmWayId: 0,
      },
    ],
  };
}

function sampleArea(): TerrainArea {
  const grid = makeGrid(5, 7, () => 0);
  const bin = { grid, paint: tinyPaint(), colliderSubdiv: 1 as const };
  return {
    areaId: "t-area",
    name: "Test",
    grid: bin.grid,
    paint: bin.paint,
    colliderSubdiv: 1,
    groundSurface: "grass",
    graph: sampleGraph(),
    objects: [
      { kind: "crest", crest: { id: "c1", centerX: 1, centerZ: 2, radiusM: 30, heightM: 5 } },
      {
        kind: "crest",
        crest: {
          id: "r1",
          centerX: 0,
          centerZ: 0,
          radiusM: 0,
          heightM: 3,
          ramp: { headingRad: 1.5, widthM: 8, angleDeg: 20, footRadiusM: 50 },
        },
      },
    ],
    buildings: [
      {
        center: { x: 1, y: 2, z: 3 },
        halfExtents: { x: 4, y: 5, z: 6 },
        rotationY: 0.5,
      },
    ],
    legacyGlbBuildings: false,
    nextEdgeId: 9,
  };
}

describe("terrain sidecar", () => {
  it("round-trips graph, objects, buildings and nextEdgeId", () => {
    const area = sampleArea();
    const side = parseTerrainSidecar(serializeTerrainSidecar(area), "t-area", "t.json");
    expect(side.graph).toEqual(area.graph);
    expect(side.objects).toEqual(area.objects);
    expect(side.buildings).toEqual(area.buildings);
    expect(side.nextEdgeId).toBe(9);
    expect(side.groundSurface).toBe("grass");
    expect(serializeTerrainSidecar(area).endsWith("\n")).toBe(true);
  });

  function mutate(f: (o: Record<string, unknown>) => void): string {
    const o = JSON.parse(serializeTerrainSidecar(sampleArea())) as Record<string, unknown>;
    f(o);
    return JSON.stringify(o);
  }

  it("rejects bad kind, version, area id, edge counter, object kind and non-finite numbers", () => {
    const p = (t: string) => () => parseTerrainSidecar(t, "t-area", "t.json");
    expect(p(mutate((o) => (o.kind = "nope")))).toThrow(/kind/);
    expect(p(mutate((o) => (o.formatVersion = 2)))).toThrow(/expected 1, found 2/);
    expect(() =>
      parseTerrainSidecar(serializeTerrainSidecar(sampleArea()), "other", "t.json"),
    ).toThrow(/expected "other", found "t-area"/);
    expect(p(mutate((o) => (o.nextEdgeId = 4)))).toThrow(/nextEdgeId/);
    expect(p(mutate((o) => ((o.objects as Record<string, unknown>[])[0].kind = "stamp")))).toThrow(
      /unknown object kind/,
    );
    const inf = serializeTerrainSidecar(sampleArea()).replace(
      '"rotationY": 0.5',
      '"rotationY": 1e999',
    );
    expect(() => parseTerrainSidecar(inf, "t-area", "t.json")).toThrow(/finite/);
  });

  it("is not polluted by __proto__ payloads", () => {
    const text = serializeTerrainSidecar(sampleArea())
      .replace(
        '"kind": "heat-street.terrain-area",',
        '"__proto__": {"polluted": true}, "kind": "heat-street.terrain-area",',
      )
      .replace('"id": "c1",', '"id": "c1", "__proto__": {"polluted": true},');
    const side = parseTerrainSidecar(text, "t-area", "t.json");
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(Object.hasOwn(side, "__proto__")).toBe(false);
    expect(Object.hasOwn(side.objects[0].crest, "__proto__")).toBe(false);
  });

  it("loadTerrainArea combines both halves and checks graph extent", async () => {
    const area = sampleArea();
    const bin = await encodeTerrainBinary(area);
    const loaded = await loadTerrainArea(bin, serializeTerrainSidecar(area), "t-area", "t");
    expect(loaded.grid.rows).toBe(5);
    expect(loaded.graph.edges[0].id).toBe(4);
    expect(loaded.nextEdgeId).toBe(9);
    const far = { ...area, graph: { ...area.graph, bounds: { ...area.graph.bounds, maxX: 500 } } };
    await expect(loadTerrainArea(bin, serializeTerrainSidecar(far), "t-area", "t")).rejects.toThrow(
      /outside the terrain grid/,
    );
    expect(TERRAIN_FORMAT_VERSION).toBe(1);
  });
});
