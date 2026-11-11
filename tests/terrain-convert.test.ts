import { describe, expect, it } from "vitest";
import feelCollisionRaw from "../public/maps/feel-test.collision.json?raw";
import feelGraphRaw from "../public/maps/feel-test.map.json?raw";
import feelRoutesRaw from "../public/maps/feel-test.routes.json?raw";
import gridCollisionRaw from "../public/maps/grid-test.collision.json?raw";
import gridGraphRaw from "../public/maps/grid-test.map.json?raw";
import gridRoutesRaw from "../public/maps/grid-test.routes.json?raw";
import julietteCollisionRaw from "../public/maps/juliette-ga.collision.json?raw";
import julietteGraphRaw from "../public/maps/juliette-ga.map.json?raw";
import julietteRoutesRaw from "../public/maps/juliette-ga.routes.json?raw";
import { parseCourseData } from "../src/core/course";
import { crestsForArea } from "../src/core/crest-geometry";
import { sampleHeightfieldBilinear } from "../src/core/heightfield-sample";
import { NEUTRAL } from "../src/core/input-tape";
import { type MapCollision, parseMapCollision } from "../src/core/map-collision";
import { validateCourseRoutes } from "../src/core/navigation";
import { parseRoadGraph, type RoadGraph } from "../src/core/road-graph";
import { defaultSurfaceProfiles } from "../src/core/surface-tuning";
import {
  encodeTerrainBinary,
  loadTerrainArea,
  parseTerrainSidecar,
  serializeTerrainSidecar,
  type TerrainArea,
} from "../src/core/terrain-format";
import { sampleTerrainHeight } from "../src/core/terrain-grid";
import { decodePaintSurface, PAINT_ROAD_FLAG, paintIndexAt } from "../src/core/terrain-paint";
import { defaultTuning } from "../src/core/vehicle-tuning";
import { createMapScene } from "../src/physics/map-scene";
import { createTerrainScene } from "../src/physics/terrain-scene";
import { sampleVehicle } from "../src/physics/vehicle";
import { createWorld } from "../src/physics/world";
import {
  CONVERT_CONFIG,
  convertCompiledArea,
  convertHeights,
} from "../tools/map-compiler/terrain/convert";

interface Fixture {
  areaId: "feel-test" | "grid-test" | "juliette-ga";
  graph: RoadGraph;
  collision: MapCollision;
  routesRaw: string;
}

function fixture(
  areaId: Fixture["areaId"],
  graphRaw: string,
  collisionRaw: string,
  routesRaw: string,
): Fixture {
  const graph = parseRoadGraph(graphRaw, `${areaId}.map.json`);
  const collision = parseMapCollision(collisionRaw, areaId, `${areaId}.collision.json`);
  return { areaId, graph, collision, routesRaw };
}

const FEEL = fixture("feel-test", feelGraphRaw, feelCollisionRaw, feelRoutesRaw);
const GRID = fixture("grid-test", gridGraphRaw, gridCollisionRaw, gridRoutesRaw);
const JULIETTE = fixture("juliette-ga", julietteGraphRaw, julietteCollisionRaw, julietteRoutesRaw);

function input(f: Fixture) {
  return {
    areaId: f.areaId,
    graph: f.graph,
    collision: f.collision,
    crests: crestsForArea(f.areaId),
  };
}

const feelArea = convertCompiledArea(input(FEEL));
const gridArea = convertCompiledArea(input(GRID));

function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function middleSegmentMid(points: RoadGraph["edges"][number]["points"]) {
  const k = Math.floor((points.length - 1) / 2);
  const a = points[k];
  const b = points[k + 1];
  return { x: (a[0] + b[0]) / 2, y: (a[1] + b[1]) / 2, z: (a[2] + b[2]) / 2 };
}

function sidecarGraph(area: Pick<TerrainArea, "areaId" | "graph"> & Partial<TerrainArea>) {
  const text = serializeTerrainSidecar({
    areaId: area.areaId,
    name: area.graph.name,
    groundSurface: area.groundSurface ?? "grass",
    legacyGlbBuildings: area.legacyGlbBuildings ?? false,
    nextEdgeId: Math.max(-1, ...area.graph.edges.map((e) => e.id)) + 1,
    graph: area.graph,
    objects: [],
    buildings: [],
  });
  return parseTerrainSidecar(text, area.areaId, `${area.areaId}.terrain.json`).graph;
}

describe("convertCompiledArea: feel-test", () => {
  it("is flat at exactly 0, tarmac ground, with the crests as objects", () => {
    expect(feelArea.grid.cellSizeM).toBe(3);
    expect(feelArea.paint.metresPerPixel).toBe(0.5);
    for (let i = 0; i < feelArea.grid.heights.length; i++) {
      if (!Object.is(feelArea.grid.heights[i], 0)) throw new Error(`vertex ${i} is not +0`);
    }
    for (let i = 0; i < feelArea.paint.data.length; i++) {
      const v = feelArea.paint.data[i];
      // Ground is tarmac; the 3 gravel road edges keep their own surface.
      if ((v & PAINT_ROAD_FLAG) === 0 && decodePaintSurface(v) !== "tarmac") {
        throw new Error(`off-road paint pixel ${i} is not tarmac`);
      }
    }
    expect(feelArea.groundSurface).toBe("tarmac");
    expect(feelArea.objects.length).toBe(7);
    expect(feelArea.objects.map((o) => o.crest)).toEqual([...crestsForArea("feel-test")]);
    expect(feelArea.legacyGlbBuildings).toBe(false);
    expect(feelArea.nextEdgeId).toBe(Math.max(...FEEL.graph.edges.map((e) => e.id)) + 1);
  });
});

describe("convertCompiledArea: graph identity and routes (D-06)", () => {
  it.each([
    ["feel-test", FEEL, feelArea],
    ["grid-test", GRID, gridArea],
  ])("%s: sidecar graph equals the compiled graph", (_id, f, area) => {
    expect(JSON.stringify(sidecarGraph(area))).toBe(JSON.stringify(f.graph));
    expect(area.graph).toBe(f.graph);
  });

  it("juliette-ga: sidecar graph equals the compiled graph", () => {
    const g = sidecarGraph({ areaId: "juliette-ga", graph: JULIETTE.graph });
    expect(JSON.stringify(g)).toBe(JSON.stringify(JULIETTE.graph));
  });

  it.each([
    ["feel-test", FEEL],
    ["grid-test", GRID],
    ["juliette-ga", JULIETTE],
  ])("%s: routes still validate against the converted graph", (id, f) => {
    const graph = sidecarGraph({ areaId: f.areaId, graph: f.graph });
    const routes = parseCourseData(f.routesRaw, `${id}.routes.json`, graph);
    expect(validateCourseRoutes(routes, graph)).toEqual([]);
  });
});

describe("convertCompiledArea: roads in paint and heights", () => {
  it.each([
    ["feel-test", FEEL, feelArea],
    ["grid-test", GRID, gridArea],
  ])(
    "%s: every edge midpoint reads its surface with the road flag and its height",
    (_id, f, area) => {
      for (const e of f.graph.edges) {
        const m = middleSegmentMid(e.points);
        const idx = paintIndexAt(area.paint, m.x, m.z);
        const v = area.paint.data[idx];
        expect(decodePaintSurface(v), `edge ${e.id} surface`).toBe(e.surface);
        expect(v & PAINT_ROAD_FLAG, `edge ${e.id} road flag`).toBe(PAINT_ROAD_FLAG);
        expect(Math.abs(sampleTerrainHeight(area.grid, m.x, m.z) - m.y)).toBeLessThanOrEqual(0.02);
      }
    },
  );

  it("grid-test off-road heights equal the legacy heightfield plus its sink", () => {
    const hf = GRID.collision.heightfield;
    if (hf === undefined) throw new Error("grid-test has no heightfield");
    const b = GRID.graph.bounds;
    const rand = lcg(7);
    const segs = GRID.graph.edges.flatMap((e) =>
      e.points.slice(1).map((p, i) => [e.points[i], p] as const),
    );
    const distToRoad = (x: number, z: number): number => {
      let best = Number.POSITIVE_INFINITY;
      for (const [p, q] of segs) {
        const dx = q[0] - p[0];
        const dz = q[2] - p[2];
        const len2 = dx * dx + dz * dz;
        const t =
          len2 > 0 ? Math.min(1, Math.max(0, ((x - p[0]) * dx + (z - p[2]) * dz) / len2)) : 0;
        best = Math.min(best, Math.hypot(x - (p[0] + dx * t), z - (p[2] + dz * t)));
      }
      return best;
    };
    let checked = 0;
    for (let tries = 0; checked < 100 && tries < 20000; tries++) {
      const x = b.minX + rand() * (b.maxX - b.minX);
      const z = b.minZ + rand() * (b.maxZ - b.minZ);
      if (distToRoad(x, z) <= 15) continue;
      checked++;
      const want = sampleHeightfieldBilinear(hf, x, z) + hf.sinkM;
      expect(Math.abs(sampleTerrainHeight(gridArea.grid, x, z) - want)).toBeLessThanOrEqual(0.01);
    }
    expect(checked).toBe(100);
  });
});

describe("convertCompiledArea: roadWidenM (04.3 D-11..D-14)", () => {
  it("configures +2 m on grid-test and juliette-ga and 0 on feel-test", () => {
    expect(CONVERT_CONFIG["feel-test"].roadWidenM).toBe(0);
    expect(CONVERT_CONFIG["grid-test"].roadWidenM).toBe(2);
    expect(CONVERT_CONFIG["juliette-ga"].roadWidenM).toBe(2);
  });

  const julietteArea = convertCompiledArea(input(JULIETTE));

  /** Smallest (distance to an edge centreline) - (that edge's widened half width). */
  function excess(f: Fixture, x: number, z: number): number {
    let best = Number.POSITIVE_INFINITY;
    for (const e of f.graph.edges) {
      const half = (e.widthM + 2) / 2;
      for (let k = 0; k + 1 < e.points.length; k++) {
        const p = e.points[k];
        const q = e.points[k + 1];
        const dx = q[0] - p[0];
        const dz = q[2] - p[2];
        const len2 = dx * dx + dz * dz;
        const t =
          len2 > 0 ? Math.min(1, Math.max(0, ((x - p[0]) * dx + (z - p[2]) * dz) / len2)) : 0;
        best = Math.min(best, Math.hypot(x - (p[0] + dx * t), z - (p[2] + dz * t)) - half);
      }
    }
    return best;
  }

  it.each([
    ["grid-test", GRID, gridArea],
    ["juliette-ga", JULIETTE, julietteArea],
  ])("%s: paint road flag follows (widthM + 2) / 2 around each centreline", (_id, f, area) => {
    const m = area.paint.metresPerPixel;
    let inside = 0;
    let outside = 0;
    for (const e of f.graph.edges) {
      const half = (e.widthM + 2) / 2;
      for (let k = 0; k + 1 < e.points.length; k++) {
        const a = e.points[k];
        const b = e.points[k + 1];
        const dx = b[0] - a[0];
        const dz = b[2] - a[2];
        const len = Math.hypot(dx, dz);
        if (len < 1) continue;
        const nx = -dz / len;
        const nz = dx / len;
        const cx = (a[0] + b[0]) / 2;
        const cz = (a[2] + b[2]) / 2;
        for (const s of [-1, 1]) {
          const near = half - m;
          const px = cx + nx * near * s;
          const pz = cz + nz * near * s;
          const idx = paintIndexAt(area.paint, px, pz);
          expect((area.paint.data[idx] & PAINT_ROAD_FLAG) !== 0, `edge ${e.id} inside`).toBe(true);
          inside++;
          const far = half + m;
          const qx = cx + nx * far * s;
          const qz = cz + nz * far * s;
          if (excess(f, qx, qz) > m) {
            const j = paintIndexAt(area.paint, qx, qz);
            expect(area.paint.data[j] & PAINT_ROAD_FLAG, `edge ${e.id} outside`).toBe(0);
            outside++;
          }
        }
      }
    }
    expect(inside).toBeGreaterThan(0);
    expect(outside).toBeGreaterThan(0);
  });

  it.each([
    ["grid-test", GRID, gridArea],
    ["juliette-ga", JULIETTE, julietteArea],
  ])("%s: no building collider box intersects a road-flagged paint pixel", (id, f, area) => {
    const m = area.paint.metresPerPixel;
    let minClearance = Number.POSITIVE_INFINITY;
    const hits: number[] = [];
    f.collision.buildings.forEach((bd, i) => {
      const cos = Math.cos(bd.rotationY);
      const sin = Math.sin(bd.rotationY);
      const hx = bd.halfExtents.x;
      const hz = bd.halfExtents.z;
      const r = Math.hypot(hx, hz);
      const minPx = Math.floor((bd.center.x - r - area.paint.originX) / m);
      const maxPx = Math.ceil((bd.center.x + r - area.paint.originX) / m);
      const minPz = Math.floor((bd.center.z - r - area.paint.originZ) / m);
      const maxPz = Math.ceil((bd.center.z + r - area.paint.originZ) / m);
      for (let pz = Math.max(0, minPz); pz <= Math.min(area.paint.height - 1, maxPz); pz++) {
        for (let px = Math.max(0, minPx); px <= Math.min(area.paint.width - 1, maxPx); px++) {
          if ((area.paint.data[pz * area.paint.width + px] & PAINT_ROAD_FLAG) === 0) continue;
          const x = area.paint.originX + (px + 0.5) * m - bd.center.x;
          const z = area.paint.originZ + (pz + 0.5) * m - bd.center.z;
          const lx = x * cos - z * sin;
          const lz = x * sin + z * cos;
          const gap = Math.max(Math.abs(lx) - hx, Math.abs(lz) - hz);
          minClearance = Math.min(minClearance, gap);
          if (gap < 0) hits.push(i);
        }
      }
    });
    console.log(`[roadWidenM] ${id} min building clearance to a road pixel: ${minClearance}`);
    expect([...new Set(hits)], `${id} buildings on road`).toEqual([]);
  });
});

describe("convertHeights: levelled roads read their graph height (D-06, D-16)", () => {
  it.each([
    ["grid-test", GRID],
    ["juliette-ga", JULIETTE],
  ])("%s: nodes, edge points and segment midpoints read y within 0.02 m", (_id, f) => {
    const grid = convertHeights(input(f));
    for (const n of f.graph.nodes) {
      expect(Math.abs(sampleTerrainHeight(grid, n.x, n.z) - n.y)).toBeLessThanOrEqual(0.02);
    }
    let worst = 0;
    for (const e of f.graph.edges) {
      for (let k = 0; k < e.points.length; k++) {
        const p = e.points[k];
        worst = Math.max(worst, Math.abs(sampleTerrainHeight(grid, p[0], p[2]) - p[1]));
        if (k + 1 < e.points.length) {
          const q = e.points[k + 1];
          const my = (p[1] + q[1]) / 2;
          worst = Math.max(
            worst,
            Math.abs(sampleTerrainHeight(grid, (p[0] + q[0]) / 2, (p[2] + q[2]) / 2) - my),
          );
        }
      }
    }
    expect(worst).toBeLessThanOrEqual(0.02);
  });

  it("juliette-ga uses 8 m cells and 0.5 m paint pixels", () => {
    expect(CONVERT_CONFIG["juliette-ga"].cellSizeM).toBe(8);
    expect(CONVERT_CONFIG["juliette-ga"].paintMetresPerPixel).toBe(0.5);
    expect(CONVERT_CONFIG["grid-test"].cellSizeM).toBe(3);
  });
});

describe("convertCompiledArea: encode and load round trip (T-04.2-31)", () => {
  it.each([
    ["feel-test", feelArea, 0],
    ["grid-test", gridArea, 0.005],
  ])("%s: reloads through loadTerrainArea", async (id, area, tol) => {
    const bin = await encodeTerrainBinary(area, { paintEncoding: 1 });
    const loaded = await loadTerrainArea(bin, serializeTerrainSidecar(area), id, `${id}.terrain`);
    expect(loaded.grid.heights.length).toBe(area.grid.heights.length);
    let worst = 0;
    for (let i = 0; i < area.grid.heights.length; i++) {
      worst = Math.max(worst, Math.abs(loaded.grid.heights[i] - area.grid.heights[i]));
    }
    expect(worst).toBeLessThanOrEqual(tol + 1e-6);
    expect(Buffer.from(loaded.paint.data).equals(Buffer.from(area.paint.data))).toBe(true);
    expect(loaded.objects.length).toBe(area.objects.length);
  });
});

describe("feel-test legacy vs terrain drive (D-07)", () => {
  it("600 ticks of full throttle match within 1%", () => {
    const frame = { steer: 0, throttle: 1, brake: 0, handbrake: false };
    const run = (
      make: (w: ReturnType<typeof createWorld>) => ReturnType<typeof createMapScene>,
    ) => {
      const world = createWorld();
      try {
        const scene = make(world);
        for (let t = 0; t < 600; t++) {
          scene.preTick(t);
          scene.applyInput(t < 0 ? NEUTRAL : frame);
          world.step();
        }
        const s = sampleVehicle(scene.vehicle);
        return { x: s.position.x, z: s.position.z, speed: s.forwardSpeedMs };
      } finally {
        world.free();
      }
    };
    const legacy = run((w) =>
      createMapScene(w, FEEL.graph, FEEL.collision, defaultTuning(), defaultSurfaceProfiles()),
    );
    const terrain = run((w) =>
      createTerrainScene(
        w,
        {
          areaId: "feel-test",
          grid: feelArea.grid,
          paint: feelArea.paint,
          graph: feelArea.graph,
          buildings: feelArea.buildings,
          crests: crestsForArea("feel-test"),
          groundSurface: feelArea.groundSurface,
        },
        defaultTuning(),
        defaultSurfaceProfiles(),
      ),
    );
    expect(legacy.speed).toBeGreaterThan(5);
    const near = (a: number, b: number) =>
      Math.abs(a - b) <= 0.01 * Math.max(1, Math.abs(a), Math.abs(b));
    expect(near(terrain.x, legacy.x), `x ${terrain.x} vs ${legacy.x}`).toBe(true);
    expect(near(terrain.z, legacy.z), `z ${terrain.z} vs ${legacy.z}`).toBe(true);
    expect(near(terrain.speed, legacy.speed), `v ${terrain.speed} vs ${legacy.speed}`).toBe(true);
  });
});

describe("convertHeights: bounds override (07.1 authored maps)", () => {
  it("spans the given bounds instead of graph.bounds, and omitting it keeps graph.bounds", () => {
    const b = GRID.graph.bounds;
    const wide = { minX: b.minX - 40, minZ: b.minZ - 40, maxX: b.maxX + 40, maxZ: b.maxZ + 40 };
    const grid = convertHeights({ ...input(GRID), bounds: wide });
    expect(grid.originX).toBe(wide.minX);
    expect(grid.originZ).toBe(wide.minZ);
    expect(grid.originX + grid.cols * grid.cellSizeM).toBeGreaterThanOrEqual(wide.maxX);
    expect(grid.originZ + grid.rows * grid.cellSizeM).toBeGreaterThanOrEqual(wide.maxZ);
    const plain = convertHeights(input(GRID));
    expect(plain.originX).toBe(b.minX);
    expect(plain.originZ).toBe(b.minZ);
  });
});
