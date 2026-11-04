/**
 * Plan 04.2-09: road brush behaviour (stroke prep, profile, banking, band
 * levelling, applyRoadStroke, eraseRoad). Graph results are round-tripped
 * through parseRoadGraph and the real map-compiler validator (T-04.2-25).
 */
import { describe, expect, it } from "vitest";
import { buildRoadGeometry } from "../src/core/road-geometry.ts";
import { parseRoadGraph, type RoadGraph } from "../src/core/road-graph.ts";
import {
  createTerrainGrid,
  sampleTerrainHeight,
  type TerrainGrid,
} from "../src/core/terrain-grid.ts";
import { DEFAULT_MAX_BANK_DEG, MAX_SLOPE_DEG } from "../src/core/terrain-limits.ts";
import {
  createPaintMap,
  decodePaintSurface,
  encodePaintValue,
  PAINT_ROAD_FLAG,
} from "../src/core/terrain-paint.ts";
import {
  applyRoadStroke,
  eraseRoad,
  levelRoadBand,
  prepareStrokePolyline,
  ROAD_PRESETS,
  type RoadEditTarget,
  roadBankAngles,
  roadHeightProfile,
  roadLevelRadiusM,
  roadVertexMaskFromPaint,
} from "../src/core/terrain-road.ts";
import { applyStrokeDiff } from "../src/core/terrain-undo.ts";
import { validateGraph } from "../tools/map-compiler/validate/validator.ts";

function emptyGraph(half: number): RoadGraph {
  return {
    schemaVersion: 1,
    areaId: "test",
    name: "Test",
    source: { osmExtract: "n/a", osmSnapshot: "n/a", demSource: "n/a", compilerVersion: "test" },
    attribution: { osm: "n/a", osmLicense: "n/a", osmLicenseUrl: "n/a", dem: "n/a" },
    origin: { lat: 0, lon: 0, projection: "local" },
    bounds: { minX: -half, minZ: -half, maxX: half, maxZ: half },
    nodes: [],
    edges: [],
  };
}

function hilly(x: number, z: number): number {
  return 1.5 * Math.sin(x * 0.045) * Math.cos(z * 0.035);
}

function makeArea(cell: number, sizeM: number, hill = true): RoadEditTarget {
  const n = Math.round(sizeM / cell);
  const grid = createTerrainGrid({
    rows: n,
    cols: n,
    cellSizeM: cell,
    originX: -sizeM / 2,
    originZ: -sizeM / 2,
  });
  const stride = n + 1;
  if (hill) {
    for (let c = 0; c <= n; c++) {
      for (let r = 0; r <= n; r++) {
        grid.heights[r + c * stride] = hilly(grid.originX + c * cell, grid.originZ + r * cell);
      }
    }
  }
  return {
    grid,
    paint: createPaintMap({
      originX: -sizeM / 2,
      originZ: -sizeM / 2,
      widthM: sizeM,
      depthM: sizeM,
      metresPerPixel: 0.5,
      fill: "grass",
    }),
    groundSurface: "grass",
    graph: emptyGraph(sizeM / 2),
    nextEdgeId: 0,
  };
}

function line(x0: number, z0: number, x1: number, z1: number, step = 1) {
  const len = Math.hypot(x1 - x0, z1 - z0);
  const n = Math.max(2, Math.ceil(len / step));
  return Array.from({ length: n + 1 }, (_, i) => ({
    x: x0 + ((x1 - x0) * i) / n,
    z: z0 + ((z1 - z0) * i) / n,
  }));
}

function assertValid(graph: RoadGraph): RoadGraph {
  const parsed = parseRoadGraph(JSON.stringify(graph), "terrain-road.test");
  const failures = validateGraph(parsed, buildRoadGeometry(parsed)).filter(
    (f) => f.category.startsWith("GEOMETRY") || f.category === "REFERENTIAL_INTEGRITY",
  );
  expect(failures).toEqual([]);
  return parsed;
}

function roadHeightsSnapshot(grid: TerrainGrid, mask: Uint8Array): Float32Array {
  const out: number[] = [];
  for (let i = 0; i < mask.length; i++) if (mask[i]) out.push(grid.heights[i]);
  return Float32Array.from(out);
}

// ------------------------------------------------------------------ task 1

describe("presets", () => {
  it("has exactly the four classes with the UI-SPEC values", () => {
    expect(Object.keys(ROAD_PRESETS).sort()).toEqual(["dirt", "highway", "street", "track"]);
    const row = (k: keyof typeof ROAD_PRESETS) => {
      const p = ROAD_PRESETS[k];
      return [
        p.widthM,
        p.lanes,
        p.surface,
        p.roadClass,
        p.speedLimitKph,
        p.designSpeedKph,
        p.maxBankDeg,
      ];
    };
    expect(row("street")).toEqual([10, 2, "tarmac", "residential", 40, 40, 0]);
    expect(row("highway")).toEqual([14, 2, "tarmac", "primary", 100, 100, DEFAULT_MAX_BANK_DEG]);
    expect(row("track")).toEqual([8, 1, "gravel", "track", 60, 60, 6]);
    expect(row("dirt")).toEqual([7, 1, "dirt_road", "unclassified", 50, 50, 0]);
  });
});

describe("prepareStrokePolyline", () => {
  it("reduces 200 jittered cursor points on a straight line to a handful on the line", () => {
    const raw = Array.from({ length: 200 }, (_, i) => ({
      x: (i / 199) * 100,
      z: 0.12 * Math.sin(i * 12.9898) + 0.08 * Math.cos(i * 78.233),
    }));
    const out = prepareStrokePolyline(raw, 3);
    expect(out.length).toBeGreaterThanOrEqual(2);
    expect(out.length).toBeLessThanOrEqual(5);
    for (const p of out) expect(Math.abs(p.z)).toBeLessThan(0.3);
    expect(out[0].x).toBeCloseTo(0, 6);
    expect(out[out.length - 1].x).toBeCloseTo(100, 6);
  });

  it("drops duplicate and non-finite points and rejects fewer than 2 distinct", () => {
    expect(
      prepareStrokePolyline(
        [
          { x: 1, z: 1 },
          { x: 1, z: 1 },
          { x: Number.NaN, z: 2 },
        ],
        3,
      ),
    ).toEqual([]);
    expect(prepareStrokePolyline([], 3)).toEqual([]);
    const out = prepareStrokePolyline(
      [
        { x: 0, z: 0 },
        { x: 0, z: 0 },
        { x: Number.POSITIVE_INFINITY, z: 5 },
        { x: 20, z: 0 },
      ],
      3,
    );
    expect(out.length).toBe(2);
    expect(out.every((p) => Number.isFinite(p.x) && Number.isFinite(p.z))).toBe(true);
  });
});

describe("roadHeightProfile", () => {
  it("is a 15 m moving average of the sampled heights", () => {
    const grid = createTerrainGrid({
      rows: 100,
      cols: 100,
      cellSizeM: 2,
      originX: -100,
      originZ: -100,
    });
    for (let c = 0; c <= 100; c++) {
      for (let r = 0; r <= 100; r++) {
        // deterministic +-0.5 m noise
        grid.heights[r + c * 101] = Math.sin((r * 12.9898 + c * 78.233) * 43758.5453) * 0.5;
      }
    }
    const pts = Array.from({ length: 51 }, (_, i) => ({ x: -50 + i * 2, z: 0 }));
    const raw = pts.map((p) => sampleTerrainHeight(grid, p.x, p.z));
    const prof = roadHeightProfile(grid, pts, { smoothM: 15 });
    for (let i = 4; i < pts.length - 4; i++) {
      let sum = 0;
      let k = 0;
      for (let j = 0; j < pts.length; j++) {
        if (Math.abs(pts[j].x - pts[i].x) <= 7.5 + 1e-9) {
          sum += raw[j];
          k++;
        }
      }
      expect(prof[i]).toBeCloseTo(sum / k, 6);
    }
  });

  it("clamps grade to min(0.5, tan(cap)) and keeps pinned heights exact", () => {
    const grid = createTerrainGrid({
      rows: 80,
      cols: 80,
      cellSizeM: 2,
      originX: -80,
      originZ: -80,
    });
    for (let c = 0; c <= 80; c++)
      for (let r = 0; r <= 80; r++) grid.heights[r + c * 81] = c > 40 ? 20 : 0;
    const pts = Array.from({ length: 41 }, (_, i) => ({ x: -40 + i * 2, z: 0 }));
    const prof = roadHeightProfile(grid, pts, {
      pins: [
        { index: 3, heightM: 0.25 },
        { index: 36, heightM: 19 },
      ],
    });
    const lim = Math.min(0.5, Math.tan((MAX_SLOPE_DEG * Math.PI) / 180));
    for (let i = 1; i < pts.length; i++) {
      if (i === 3 || i === 36 || i - 1 === 3 || i - 1 === 36) continue;
      expect(Math.abs(prof[i] - prof[i - 1])).toBeLessThanOrEqual(lim * 2 + 1e-6);
    }
    expect(prof[3]).toBe(0.25);
    expect(prof[36]).toBe(19);
  });
});

describe("roadBankAngles", () => {
  const arc = (R: number, spanRad: number, step = 2) => {
    const n = Math.ceil((R * spanRad) / step);
    return Array.from({ length: n + 1 }, (_, i) => {
      const a = (spanRad * i) / n;
      return { x: R * Math.sin(a), z: R * (1 - Math.cos(a)) };
    });
  };

  it("is zero on a straight stroke and always zero for streets", () => {
    const straight = line(0, 0, 100, 0, 2);
    expect(Array.from(roadBankAngles(straight, ROAD_PRESETS.highway, 8))).toEqual(
      straight.map(() => 0),
    );
    const curved = arc(60, 1.5);
    expect(Array.from(roadBankAngles(curved, ROAD_PRESETS.street, 8)).every((b) => b === 0)).toBe(
      true,
    );
  });

  it("follows atan(v^2/(g R)) on an arc, capped at the max bank, ramping in and out", () => {
    const curved = arc(60, 1.6);
    const capped = roadBankAngles(curved, ROAD_PRESETS.highway, 8);
    const mid = capped[Math.floor(capped.length / 2)];
    expect(Math.abs(mid)).toBeCloseTo((8 * Math.PI) / 180, 9);
    const free = roadBankAngles(curved, ROAD_PRESETS.highway, 80);
    const v = 100 / 3.6;
    expect(Math.abs(free[Math.floor(free.length / 2)])).toBeCloseTo(
      Math.atan((v * v) / (9.81 * 60)),
      6,
    );
    // ramp: the 20 m window turns the 0 -> cap jump into a ramp (no step bigger than a third of the cap)
    let maxStep = 0;
    for (let i = 1; i < capped.length; i++)
      maxStep = Math.max(maxStep, Math.abs(capped[i] - capped[i - 1]));
    expect(maxStep).toBeLessThan((8 * Math.PI) / 180 / 3);
    // WR-04: the padded start window is as wide as the end's, so the first point is
    // a partial ramp (well below the cap) that mirrors the last one, not a collapsed 0.
    const last = capped[capped.length - 1];
    expect(Math.abs(capped[0])).toBeLessThan(Math.abs(mid) / 2);
    expect(capped[0]).toBeCloseTo(last, 9);
  });

  it("ramps symmetrically: a reversed stroke gives the mirrored, sign-flipped profile (WR-04)", () => {
    const curved = arc(60, 1.6);
    const fwd = roadBankAngles(curved, ROAD_PRESETS.highway, 8);
    const rev = roadBankAngles([...curved].reverse(), ROAD_PRESETS.highway, 8);
    const n = curved.length;
    for (let i = 0; i < n; i++) expect(rev[n - 1 - i]).toBeCloseTo(-fwd[i], 9);
  });
});

describe("roadLevelRadiusM", () => {
  it("is max(halfWidth, cell * sqrt2)", () => {
    expect(roadLevelRadiusM(4, 8)).toBe(8 * Math.SQRT2);
    expect(roadLevelRadiusM(6, 3)).toBe(6);
  });
});

// ------------------------------------------------------------------ task 2

describe("levelRoadBand", () => {
  it("levels whole triangles on coarse (8 m) cells so the surface reads the planned height", () => {
    const area = makeArea(8, 400);
    const pts = line(-100, 3, 100, 3, 2);
    const heights = pts.map((p) => 5 + 0.02 * p.x);
    const banks = pts.map(() => 0);
    const res = levelRoadBand(area.grid, pts, heights, banks, 3, undefined);
    expect(res.window).toBeDefined();
    for (let i = 0; i < 50; i++) {
      const x = -90 + i * 3.7;
      expect(Math.abs(sampleTerrainHeight(area.grid, x, 3) - (5 + 0.02 * x))).toBeLessThan(1e-3);
    }
    // the whole width reads the same height at a fixed x (zero bank)
    for (const z of [0.5, 1.5, 3, 4.5, 5.5]) {
      expect(Math.abs(sampleTerrainHeight(area.grid, 10, z) - (5 + 0.02 * 10))).toBeLessThan(1e-3);
    }
  });

  it("roadVertexMaskFromPaint marks vertices under road-flagged pixels", () => {
    const area = makeArea(3, 120, false);
    const idx = (x: number, z: number) =>
      Math.floor((z - area.paint.originZ) / 0.5) * area.paint.width +
      Math.floor((x - area.paint.originX) / 0.5);
    area.paint.data[idx(0, 0)] = encodePaintValue("tarmac", true);
    const mask = roadVertexMaskFromPaint(area.grid, area.paint);
    const vi = (x: number, z: number) =>
      Math.round((z - area.grid.originZ) / 3) +
      Math.round((x - area.grid.originX) / 3) * (area.grid.rows + 1);
    expect(mask[vi(0, 0)]).toBe(1);
    expect(mask[vi(30, 30)]).toBe(0);
  });
});

describe("applyRoadStroke", () => {
  it("paints, levels flat across the road, records valid graph edges and undoes exactly", () => {
    const area = makeArea(3, 240);
    const origHeights = new Float32Array(area.grid.heights);
    const origPaint = new Uint8Array(area.paint.data);
    const origGraph = JSON.stringify(area.graph);
    const res = applyRoadStroke(area, line(-60, 0, 60, 0, 0.7), "street");
    expect(res.warnings).toEqual([]);
    expect(res.newEdgeIds.length).toBeGreaterThan(0);
    expect(res.diff?.heights).toBeDefined();
    expect(res.diff?.paint).toBeDefined();
    expect(res.diff?.graph).toBeDefined();

    // crossfall: heights across the road at a fixed x match the centre
    const centre = sampleTerrainHeight(area.grid, 10, 0);
    for (let k = 0; k < 20; k++) {
      const z = -3.8 + (7.6 * k) / 19;
      expect(Math.abs(sampleTerrainHeight(area.grid, 10, z) - centre)).toBeLessThanOrEqual(0.05);
    }
    // paint
    const half = ROAD_PRESETS.street.widthM / 2;
    for (let px = 0; px < area.paint.width; px += 3) {
      for (let pz = 0; pz < area.paint.height; pz += 3) {
        const x = area.paint.originX + (px + 0.5) * 0.5;
        const z = area.paint.originZ + (pz + 0.5) * 0.5;
        if (Math.abs(x) < 55 && Math.abs(z) < half - 0.3) {
          const v = area.paint.data[pz * area.paint.width + px];
          expect(v & PAINT_ROAD_FLAG).toBe(PAINT_ROAD_FLAG);
          expect(decodePaintSurface(v)).toBe("tarmac");
        }
      }
    }
    // graph: valid, y == terrain, default spawn
    const parsed = assertValid(area.graph);
    for (const e of parsed.edges) {
      for (const p of e.points)
        expect(Math.abs(p[1] - sampleTerrainHeight(area.grid, p[0], p[2]))).toBeLessThan(1e-3);
    }
    for (const n of parsed.nodes)
      expect(Math.abs(n.y - sampleTerrainHeight(area.grid, n.x, n.z))).toBeLessThan(1e-3);
    expect(parsed.spawns?.some((s) => s.id === "default")).toBe(true);

    // undo restores the area exactly
    applyStrokeDiff(area, res.diff as NonNullable<typeof res.diff>, "before");
    expect(Array.from(area.grid.heights)).toEqual(Array.from(origHeights));
    expect(Array.from(area.paint.data)).toEqual(Array.from(origPaint));
    expect(JSON.stringify(parseRoadGraph(JSON.stringify(area.graph), "x"))).toEqual(
      JSON.stringify(parseRoadGraph(origGraph, "x")),
    );
    expect(area.nextEdgeId).toBe(0);
  });

  it("clamps the width slider range", () => {
    const area = makeArea(3, 240);
    applyRoadStroke(area, line(-40, 0, 40, 0, 0.7), "street", { widthM: 100 });
    expect(area.graph.edges.every((e) => e.widthM === 20)).toBe(true);
    const area2 = makeArea(3, 240);
    applyRoadStroke(area2, line(-40, 0, 40, 0, 0.7), "street", { widthM: 0 });
    expect(area2.graph.edges.every((e) => e.widthM === 3)).toBe(true);
  });

  it("pins heights where a second stroke crosses the first (D-13)", () => {
    const area = makeArea(3, 240);
    applyRoadStroke(area, line(-60, 0, 60, 0, 0.7), "street");
    const before = sampleTerrainHeight(area.grid, 0, 0);
    const res = applyRoadStroke(area, line(0, -60, 0, 60, 0.7), "street");
    expect(res.warnings).toEqual([]);
    const parsed = assertValid(area.graph);
    const junction = parsed.nodes.find((n) => n.junction && Math.hypot(n.x, n.z) < 1.5);
    expect(junction).toBeDefined();
    expect(Math.abs((junction?.y ?? 0) - before)).toBeLessThan(0.02);
    expect(
      Math.abs(sampleTerrainHeight(area.grid, junction?.x ?? 0, junction?.z ?? 0) - before),
    ).toBeLessThan(0.02);
    expect(
      Math.abs(
        (junction?.y ?? 0) - sampleTerrainHeight(area.grid, junction?.x ?? 0, junction?.z ?? 0),
      ),
    ).toBeLessThan(1e-3);
  });

  it("T junction: ends on an existing road at the same height (snap-edge pin)", () => {
    const area = makeArea(3, 240);
    applyRoadStroke(area, line(-60, 0, 60, 0, 0.7), "street");
    const target = sampleTerrainHeight(area.grid, 20, 0);
    const res = applyRoadStroke(area, line(20, 60, 20, 2.5, 0.7), "street");
    expect(res.warnings).toEqual([]);
    const parsed = assertValid(area.graph);
    const j = parsed.nodes.find(
      (n) => n.junction && Math.abs(n.x - 20) < 1.5 && Math.abs(n.z) < 1.5,
    );
    expect(j).toBeDefined();
    expect(
      Math.abs((j?.y ?? 0) - sampleTerrainHeight(area.grid, j?.x ?? 0, j?.z ?? 0)),
    ).toBeLessThan(1e-3);
    expect(Math.abs((j?.y ?? 0) - target)).toBeLessThan(0.02);
  });

  it("reuses an existing dead-end node and keeps its height (snap-node pin)", () => {
    const area = makeArea(3, 240);
    applyRoadStroke(area, line(-60, 0, 0, 0, 0.7), "street");
    const end = area.graph.nodes.reduce((a, b) => (b.x > a.x ? b : a));
    const yBefore = end.y;
    const nodesBefore = area.graph.nodes.length;
    const res = applyRoadStroke(area, line(end.x + 1, end.z + 0.5, 60, 20, 0.7), "street");
    expect(res.warnings).toEqual([]);
    const parsed = assertValid(area.graph);
    const reused = parsed.nodes.find((n) => Math.hypot(n.x - end.x, n.z - end.z) < 1e-6);
    expect(reused).toBeDefined();
    expect(Math.abs((reused?.y ?? 0) - yBefore)).toBeLessThan(0.02);
    expect(Math.abs((reused?.y ?? 0) - sampleTerrainHeight(area.grid, end.x, end.z))).toBeLessThan(
      1e-3,
    );
    expect(parsed.nodes.length).toBe(nodesBefore + 1);
  });

  it("parallel road: a second stroke's shoulder blend never changes the first road", () => {
    const area = makeArea(3, 240);
    applyRoadStroke(area, line(-60, 0, 60, 0, 0.7), "street");
    const mask = roadVertexMaskFromPaint(area.grid, area.paint);
    const before = roadHeightsSnapshot(area.grid, mask);
    expect(before.length).toBeGreaterThan(50);
    applyRoadStroke(area, line(-60, 13, 60, 13, 0.7), "street");
    const after = roadHeightsSnapshot(area.grid, mask);
    expect(Array.from(after)).toEqual(Array.from(before));
  });

  it("WR-01: a later stroke's slope limiter never moves an earlier road's graph-levelled vertices (D-16)", () => {
    // 8 m cells, road 1 runs mid-cell at z = 4: its paint covers no vertex, so
    // only the graph-derived levelled radius (8*sqrt2 = 11.3 m) protects the
    // z = 0 and z = 8 rows that form the triangles under its centreline.
    const area = makeArea(8, 240, false);
    applyRoadStroke(area, line(-60, 4, 60, 4, 0.7), "dirt");
    const road1 = area.graph.edges.map((e) => e.id);
    // A pre-existing cliff between the z = 8 row (0 m) and a 20 m plateau from z = 16.
    const stride = area.grid.rows + 1;
    for (let c = 0; c <= area.grid.cols; c++) {
      for (let r = 0; r <= area.grid.rows; r++) {
        if (area.grid.originZ + r * 8 >= 16) area.grid.heights[r + c * stride] = 20;
      }
    }
    // Road 2 on the plateau: its limiter window reaches the z = 8 row.
    applyRoadStroke(area, line(-60, 32, 60, 32, 0.7), "dirt");
    let worst = 0;
    for (const e of area.graph.edges) {
      if (!road1.includes(e.id)) continue;
      for (const [x, y, z] of e.points) {
        worst = Math.max(worst, Math.abs(sampleTerrainHeight(area.grid, x, z) - y));
      }
    }
    expect(road1.length).toBeGreaterThan(0);
    expect(worst).toBeLessThan(1e-6);
  });

  it("re-painting along an existing road replaces it (one road, D-15)", () => {
    const area = makeArea(3, 240);
    applyRoadStroke(area, line(-60, 0, 60, 0, 0.7), "street");
    applyRoadStroke(area, line(-60, 0.5, 60, 0.5, 0.7), "street");
    const parsed = assertValid(area.graph);
    expect(parsed.edges.length).toBe(1);
  });

  it("warns 'Slope limit reached' when a fixed road vertex makes the cap unreachable, never moving road vertices", () => {
    const area = makeArea(2, 120, false);
    // an existing road-flagged pixel on a tall spike next to where the new road will run
    const stride = area.grid.rows + 1;
    const vi = (x: number, z: number) =>
      Math.round((z - area.grid.originZ) / 2) + Math.round((x - area.grid.originX) / 2) * stride;
    for (let x = -20; x <= 20; x += 2) {
      area.grid.heights[vi(x, 10)] = 20;
      const px = Math.floor((x - area.paint.originX) / 0.5);
      const pz = Math.floor((10 - area.paint.originZ) / 0.5);
      area.paint.data[pz * area.paint.width + px] = encodePaintValue("tarmac", true);
    }
    const res = applyRoadStroke(area, line(-30, 6, 30, 6, 0.7), "street", { widthM: 6 });
    expect(res.warnings.some((w) => w.includes("Slope limit reached"))).toBe(true);
    for (let x = -20; x <= 20; x += 2) expect(area.grid.heights[vi(x, 10)]).toBe(20);
  });

  it("a stroke on an empty graph gets a default spawn; a stroke with fewer than 2 points does nothing", () => {
    const area = makeArea(3, 240);
    const none = applyRoadStroke(area, [{ x: 0, z: 0 }], "dirt");
    expect(none.diff).toBeUndefined();
    expect(none.warnings.length).toBe(1);
    applyRoadStroke(area, line(-30, 0, 30, 0, 0.7), "dirt");
    expect(area.graph.spawns?.[0]?.id).toBe("default");
    expect(area.graph.edges[0].surface).toBe("dirt_road");
  });

  it("banks highway curves and leaves a graph the validator accepts", () => {
    const area = makeArea(3, 400, false);
    const R = 80;
    const pts = Array.from({ length: 120 }, (_, i) => {
      const a = (i / 119) * 1.4;
      return { x: -80 + R * Math.sin(a), z: -60 + R * (1 - Math.cos(a)) };
    });
    const res = applyRoadStroke(area, pts, "highway");
    expect(res.warnings).toEqual([]);
    assertValid(area.graph);
    // somewhere across the road the surface is not flat any more
    let tilted = false;
    for (const e of area.graph.edges) {
      const p = e.points[Math.floor(e.points.length / 2)];
      const hL = sampleTerrainHeight(area.grid, p[0] + 3, p[2]);
      const hR = sampleTerrainHeight(area.grid, p[0] - 3, p[2]);
      if (Math.abs(hL - hR) > 0.05) tilted = true;
    }
    expect(tilted).toBe(true);
  });
});

describe("eraseRoad", () => {
  it("clears road paint and the graph edge inside the radius and leaves heights untouched (D-15)", () => {
    const area = makeArea(3, 240);
    applyRoadStroke(area, line(-60, 0, 60, 0, 0.7), "street");
    const heights = new Float32Array(area.grid.heights);
    const res = eraseRoad(area, 0, 0, 80);
    expect(Array.from(area.grid.heights)).toEqual(Array.from(heights));
    expect(res.diff?.heights).toBeUndefined();
    expect(res.diff?.paint).toBeDefined();
    expect(res.diff?.graph).toBeDefined();
    expect(area.graph.edges.length).toBe(0);
    const roadPixels = area.paint.data.filter((v) => (v & PAINT_ROAD_FLAG) !== 0).length;
    expect(roadPixels).toBe(0);
    applyStrokeDiff(area, res.diff as NonNullable<typeof res.diff>, "before");
    expect(area.graph.edges.length).toBe(1);
  });

  it("splits an edge on a partial erase and keeps untouched paint", () => {
    const area = makeArea(3, 240);
    applyRoadStroke(area, line(-60, 0, 60, 0, 0.7), "street");
    const res = eraseRoad(area, 0, 0, 10);
    expect(res.diff).toBeDefined();
    assertValid(area.graph);
    expect(area.graph.edges.length).toBe(2);
    const px = Math.floor((-40 - area.paint.originX) / 0.5);
    const pz = Math.floor((0.2 - area.paint.originZ) / 0.5);
    expect(area.paint.data[pz * area.paint.width + px] & PAINT_ROAD_FLAG).toBe(PAINT_ROAD_FLAG);
  });
});
