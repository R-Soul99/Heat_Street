import { describe, expect, it } from "vitest";
import mapRaw from "../public/maps/playground.map.json?raw";
import routesRaw from "../public/maps/playground.routes.json?raw";
import stationsRaw from "../public/maps/playground.stations.json?raw";
import { parseCourseData } from "../src/core/course";
import {
  crestsForArea,
  PLAYGROUND_DEPTH_M,
  PLAYGROUND_RAMP_PAIRS,
  PLAYGROUND_WIDTH_M,
  rampLengthM,
} from "../src/core/crest-geometry";
import { isFlatTestArea } from "../src/core/ground-surface";
import { validateCourseRoutes } from "../src/core/navigation";
import { parseRoadGraph } from "../src/core/road-graph";
import { parseStations } from "../src/debug/test-stations";
import {
  OVALS,
  SURFACE_BLOCKS,
  SURFACE_STRIP_PITCH_M,
  SURFACE_STRIP_WIDTH_M,
  SURFACE_STRIP_X0,
  SURFACE_STRIP_X1,
  SURFACE_WAY_WIDTH_M,
  surfaceStripZ,
} from "../tools/map-compiler/synthetic/playground-layout";

const crests = crestsForArea("playground");
const domes = crests.filter((c) => c.ramp === undefined);
const ramps = crests.filter((c) => c.ramp !== undefined);

describe("playground crests", () => {
  it("is a flat test area with 20 domes and a take-off + landing ramp per jump", () => {
    expect(isFlatTestArea("playground")).toBe(true);
    expect(domes).toHaveLength(20);
    expect(ramps).toHaveLength(PLAYGROUND_RAMP_PAIRS.length * 2);
    expect(new Set(crests.map((c) => c.id)).size).toBe(crests.length);
  });

  it("domes never overlap and leave at least 4 m between rims", () => {
    for (let i = 0; i < domes.length; i++) {
      for (let j = i + 1; j < domes.length; j++) {
        const a = domes[i];
        const b = domes[j];
        const gap =
          Math.hypot(a.centerX - b.centerX, a.centerZ - b.centerZ) - a.radiusM - b.radiusM;
        expect(gap, `${a.id} vs ${b.id}`).toBeGreaterThanOrEqual(3.9);
      }
    }
  });

  it("ramp lips face each other across the authored gap", () => {
    for (const pair of PLAYGROUND_RAMP_PAIRS) {
      const takeoff = ramps.find((c) => c.id === `playground-ramp-${pair.id}-takeoff`);
      const landing = ramps.find((c) => c.id === `playground-ramp-${pair.id}-landing`);
      if (takeoff?.ramp === undefined || landing?.ramp === undefined) throw new Error(pair.id);
      const takeoffLength = rampLengthM(pair.heightM, takeoff.ramp);
      const landingLength = rampLengthM(pair.heightM, landing.ramp);
      expect(takeoff.ramp.headingRad).toBe(0);
      expect(landing.ramp.headingRad).toBeCloseTo(Math.PI, 9);
      const takeoffLip = takeoff.centerX + takeoffLength;
      const landingLip = landing.centerX - landingLength;
      expect(landingLip - takeoffLip).toBeCloseTo(pair.gapM, 0);
      expect(landing.centerZ).toBe(takeoff.centerZ);
    }
  });

  it("every feature sits inside the layout", () => {
    for (const c of crests) {
      const reach = c.ramp === undefined ? c.radiusM : rampLengthM(c.heightM, c.ramp);
      const x = c.centerX + PLAYGROUND_WIDTH_M / 2;
      const z = c.centerZ + PLAYGROUND_DEPTH_M / 2;
      const spanX = c.ramp === undefined ? reach : 0;
      expect(x - spanX).toBeGreaterThan(40);
      expect(z - (c.ramp === undefined ? reach : 0)).toBeGreaterThan(40);
      expect(x + reach).toBeLessThan(PLAYGROUND_WIDTH_M - 40);
    }
  });
});

describe("playground surface strips", () => {
  it("are five equal strips with one surface each, in the expected order", () => {
    expect(SURFACE_BLOCKS.map((b) => b.id)).toEqual([
      "grass",
      "sand",
      "mud",
      "gravel",
      "dirt-road",
    ]);
    expect(new Set(SURFACE_BLOCKS.map((b) => b.key)).size).toBe(SURFACE_BLOCKS.length);
  });

  it("sit inside the layout, clear of the ovals and of each other", () => {
    const half = SURFACE_STRIP_WIDTH_M / 2;
    const firstTop = surfaceStripZ(0) - half;
    const lastBottom = surfaceStripZ(SURFACE_BLOCKS.length - 1) + half;
    expect(SURFACE_STRIP_X1).toBeLessThan(PLAYGROUND_WIDTH_M - 40);
    expect(lastBottom).toBeLessThan(PLAYGROUND_DEPTH_M - 30 - 6 - 10);
    for (const o of OVALS) {
      expect(firstTop).toBeGreaterThan(o.top + 2 * o.radiusM + 10);
    }
    for (let i = 1; i < SURFACE_BLOCKS.length; i++) {
      const gap = surfaceStripZ(i) - half - (surfaceStripZ(i - 1) + half);
      expect(gap).toBeGreaterThanOrEqual(10);
      expect(surfaceStripZ(i) - surfaceStripZ(i - 1)).toBe(SURFACE_STRIP_PITCH_M);
    }
  });

  it("compile to two full-width road edges per surface in the shipped graph", () => {
    const graph = parseRoadGraph(mapRaw, "playground.map.json");
    // A width over 30 m silently becomes 3.5 m, so each strip is two 30 m ways.
    const wide = graph.edges.filter((e) => e.widthM === SURFACE_WAY_WIDTH_M);
    expect(wide.map((e) => e.surface).sort()).toEqual([
      "dirt_road",
      "dirt_road",
      "grass",
      "grass",
      "gravel",
      "gravel",
      "mud",
      "mud",
      "sand",
      "sand",
    ]);
    for (const e of wide) {
      const xs = e.points.map((p) => p[0] + PLAYGROUND_WIDTH_M / 2);
      expect(Math.min(...xs)).toBeCloseTo(SURFACE_STRIP_X0, 0);
      expect(Math.max(...xs)).toBeCloseTo(SURFACE_STRIP_X1, 0);
    }
  });
});

describe("playground shipped artifacts", () => {
  const graph = parseRoadGraph(mapRaw, "playground.map.json");
  it("has one connected, validated pair of courses", () => {
    const courses = parseCourseData(routesRaw, "playground.routes.json", graph);
    expect(validateCourseRoutes(courses, graph)).toEqual([]);
    expect(courses.courses.map((c) => c.mode).sort()).toEqual(["circuit", "p2p"]);
  });
  it("has a launch pad for the dome field, each gap jump, each oval and each surface strip", () => {
    const stations = parseStations(stationsRaw, "playground");
    expect(stations.map((s) => s.id)).toEqual([
      "dome-field",
      "gap-jump-small",
      "gap-jump-medium",
      "gap-jump-big",
      "oval-large",
      "oval-medium",
      "oval-small",
      "surface-grass",
      "surface-sand",
      "surface-mud",
      "surface-gravel",
      "surface-dirt-road",
    ]);
  });
});
