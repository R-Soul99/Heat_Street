import { describe, expect, it } from "vitest";
import {
  buildGateCourse,
  GATE_LANES,
  GATE_SPAWNS,
  gateClimbHeight,
  gateHillHeight,
} from "../src/core/terrain-gate-course";
import {
  evaluateGate,
  GATE_FACTORS,
  type GateLaneMetrics,
  highPassRms,
  maxTickDropRatio,
} from "../src/core/terrain-gate-metrics";
import { sampleTerrainHeight, terrainIndex } from "../src/core/terrain-grid";
import { isRoadAt, surfaceAt } from "../src/core/terrain-paint";

const course = buildGateCourse();

describe("gate course geometry", () => {
  it("has the specified grid extents east of feel-test", () => {
    const g = course.grid;
    expect(g.cellSizeM).toBe(3);
    expect(g.originX).toBe(700);
    expect(g.originZ).toBe(-519);
    expect(g.cols).toBe(200);
    expect(g.rows).toBe(346);
    expect(g.originX).toBeGreaterThan(670);
  });

  it("is deterministic", () => {
    const again = buildGateCourse();
    expect(again.grid.heights).toEqual(course.grid.heights);
    expect(again.paint.data).toEqual(course.paint.data);
  });

  it("exposes four lanes in loop order and matching GATE_LANES", () => {
    expect(course.lanes.map((l) => l.id)).toEqual(["hill", "bank", "climb", "return"]);
    expect(GATE_LANES.map((l) => l.id)).toEqual(["hill", "bank", "climb", "return"]);
  });

  it("closes the loop A -> B -> C -> D -> A", () => {
    const end = (id: string) => {
      const p = course.lanes.find((l) => l.id === id)?.points ?? [];
      return p[p.length - 1];
    };
    const start = (id: string) => course.lanes.find((l) => l.id === id)?.points[0];
    expect(end("hill")?.[2]).toBeCloseTo(400, 6);
    expect(end("climb")?.[2]).toBeCloseTo(-400, 6);
    expect(end("return")?.[0]).toBeCloseTo(820, 6);
    expect(start("return")?.[0]).toBeCloseTo(940, 6);
  });

  it("hill height formula: four 8 m hills, max grade 0.1257", () => {
    expect(gateHillHeight(-400)).toBeCloseTo(0, 9);
    expect(gateHillHeight(-300)).toBeCloseTo(8, 9);
    let maxGrade = 0;
    for (let z = -400; z < 400; z += 0.5) {
      maxGrade = Math.max(maxGrade, Math.abs(gateHillHeight(z + 0.5) - gateHillHeight(z)) / 0.5);
    }
    expect(maxGrade).toBeCloseTo(0.1257, 2);
  });

  it("climb height formula: 8% up to 24 m, flat, 8% down", () => {
    expect(gateClimbHeight(400)).toBe(0);
    expect(gateClimbHeight(100)).toBeCloseTo(24, 9);
    expect(gateClimbHeight(0)).toBe(24);
    expect(gateClimbHeight(-100)).toBeCloseTo(24, 9);
    expect(gateClimbHeight(-400)).toBeCloseTo(0, 9);
  });

  it("terrain equals the analytic lane height on every lane centreline", () => {
    // A grade break (z = +-100, +-400 on lanes A/B/C) cannot be reproduced exactly
    // by a 3 m grid whose vertices straddle it; points within 3 m of a break are
    // exempt (worst measured error there is 0.053 m).
    const nearBreak = (z: number): boolean =>
      [-400, -100, 100, 400].some((zb) => Math.abs(z - zb) < 3);
    for (const lane of course.lanes) {
      for (const [x, y, z] of lane.points) {
        if (nearBreak(z)) continue;
        expect(Math.abs(sampleTerrainHeight(course.grid, x, z) - y)).toBeLessThan(0.05);
      }
    }
  });

  it("road on lane C is level across its width", () => {
    for (let z = 360; z >= -390; z -= 7) {
      const centre = sampleTerrainHeight(course.grid, 940, z);
      for (const dx of [-4.5, -3, 3, 4.5]) {
        expect(Math.abs(sampleTerrainHeight(course.grid, 940 + dx, z) - centre)).toBeLessThan(0.05);
      }
    }
  });

  it("banked bend has crossfall with the inner edge lower", () => {
    // Arc apex (880, 460): centre is (880, 400), inner = smaller z.
    const inner = sampleTerrainHeight(course.grid, 880, 460 - 4);
    const outer = sampleTerrainHeight(course.grid, 880, 460 + 4);
    expect(outer).toBeGreaterThan(inner + 0.5);
  });

  it("bank ramps in over the straight before the arc", () => {
    const early =
      sampleTerrainHeight(course.grid, 820 - 4, 372) -
      sampleTerrainHeight(course.grid, 820 + 4, 372);
    const late =
      sampleTerrainHeight(course.grid, 820 - 4, 399) -
      sampleTerrainHeight(course.grid, 820 + 4, 399);
    expect(Math.abs(late)).toBeGreaterThan(Math.abs(early));
  });

  it("paints road tarmac within 5 m of a centreline and grass elsewhere", () => {
    for (const lane of course.lanes) {
      for (let i = 0; i < lane.points.length; i += 11) {
        const [x, , z] = lane.points[i];
        expect(isRoadAt(course.paint, x, z)).toBe(true);
        expect(surfaceAt(course.paint, x, z)).toBe("tarmac");
      }
    }
    expect(isRoadAt(course.paint, 1100, 0)).toBe(false);
    expect(surfaceAt(course.paint, 1100, 0)).toBe("grass");
    expect(isRoadAt(course.paint, 760, 0)).toBe(false);
  });

  it("no axis-neighbour cell pair outside the ridge exceeds 25 degrees", () => {
    const g = course.grid;
    const tan25 = Math.tan((25 * Math.PI) / 180);
    const inRidge = (row: number, col: number): boolean => {
      const x = g.originX + col * g.cellSizeM;
      const z = g.originZ + row * g.cellSizeM;
      return x <= 806 && z >= -126 && z <= -54;
    };
    let worst = 0;
    for (let c = 0; c <= g.cols; c++) {
      for (let r = 0; r <= g.rows; r++) {
        const h = g.heights[terrainIndex(g, r, c)];
        if (inRidge(r, c)) continue;
        if (c < g.cols && !inRidge(r, c + 1)) {
          worst = Math.max(worst, Math.abs(g.heights[terrainIndex(g, r, c + 1)] - h) / g.cellSizeM);
        }
        if (r < g.rows && !inRidge(r + 1, c)) {
          worst = Math.max(worst, Math.abs(g.heights[terrainIndex(g, r + 1, c)] - h) / g.cellSizeM);
        }
      }
    }
    expect(worst).toBeLessThan(tan25);
  });

  it("slope-cap ridge reaches the 35-degree face and is capped at 20 m", () => {
    const g = course.grid;
    let max = 0;
    for (let c = 0; c <= 33; c++) {
      for (let r = 0; r <= g.rows; r++) {
        max = Math.max(max, g.heights[terrainIndex(g, r, c)]);
      }
    }
    expect(max).toBeCloseTo(20, 3);
    // Face between x=785 and x=788 (inside the ridge z span, away from the z faces).
    const dh = sampleTerrainHeight(g, 785, -90) - sampleTerrainHeight(g, 788, -90);
    expect(Math.atan2(dh, 3) * (180 / Math.PI)).toBeCloseTo(35, 0);
  });

  it("exposes the spawns", () => {
    expect(GATE_SPAWNS.laneA).toEqual({ x: 820, z: -390, headingRad: Math.PI });
    expect(GATE_SPAWNS.laneC).toEqual({ x: 940, z: 390, headingRad: 0 });
    expect(GATE_SPAWNS.cap).toEqual({ x: 815, z: -90, headingRad: Math.PI / 2 });
  });
});

describe("gate metrics", () => {
  it("highPassRms is zero for constants and positive for a step", () => {
    expect(highPassRms([1, 1, 1, 1], 15)).toBe(0);
    expect(highPassRms([0, 0, 0, 0, 1, 1, 1, 1], 15)).toBeGreaterThan(0);
  });

  it("maxTickDropRatio matches the spec example", () => {
    expect(maxTickDropRatio([10, 9.9, 9.95], 10)).toBeCloseTo(0.01, 12);
    expect(maxTickDropRatio([1, 2, 3], 10)).toBe(0);
  });

  const base = (over: Partial<GateLaneMetrics>): GateLaneMetrics => ({
    laneId: "hill",
    speedMs: 15,
    direction: 1,
    colliderSubdiv: 1,
    verticalJitterMs: 0.1,
    suspensionJitterM: 0.01,
    contactLossTicks: 0,
    speedJitterMs: 0.1,
    maxTickDrop: 0.001,
    ticks: 100,
    ...over,
  });

  it("evaluateGate derives thresholds from the baseline with floors", () => {
    const flat = base({ laneId: "flat", verticalJitterMs: 0.1 });
    const ok = evaluateGate(
      [base({ verticalJitterMs: 0.1 * GATE_FACTORS.jitter - 1e-9 })],
      flat,
      [],
    );
    expect(ok.metrics.find((m) => m.metric === "verticalJitterMs")?.pass).toBe(true);
    const bad = evaluateGate([base({ verticalJitterMs: 0.2 })], flat, []);
    expect(bad.metrics.find((m) => m.metric === "verticalJitterMs")?.pass).toBe(false);
    expect(bad.pass).toBe(false);
  });

  it("evaluateGate fails on any contact loss and on flat regression drift", () => {
    const flat = base({ laneId: "flat" });
    expect(evaluateGate([base({ contactLossTicks: 1 })], flat, []).pass).toBe(false);
    expect(evaluateGate([base({})], flat, [{ id: "x", legacy: 100, terrain: 102 }]).pass).toBe(
      false,
    );
    expect(evaluateGate([base({})], flat, [{ id: "x", legacy: 100, terrain: 100.5 }]).pass).toBe(
      true,
    );
  });
});
