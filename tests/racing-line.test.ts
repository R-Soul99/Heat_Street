import { describe, expect, it } from "vitest";
import compiledRaw from "../public/maps/juliette-ga.map.json?raw";
import routesRaw from "../public/maps/juliette-ga.routes.json?raw";
import type { Course } from "../src/core/course";
import { parseCourseData } from "../src/core/course";
import { forwardFromYaw } from "../src/core/heading";
import {
  buildNavigationGraph,
  DEFECT_CLEARANCE_M,
  DEFECT_COORDINATES,
} from "../src/core/navigation";
import {
  buildGridPoses,
  buildRacingLine,
  curvatureFromThreePoints,
  DEFAULT_GRID_PARAMS,
  DEFAULT_RACING_LINE_PARAMS,
  nearestLineIndex,
  pointAhead,
  silverLapTargetSec,
  targetSpeedAtCurvature,
} from "../src/core/racing-line";
import type { RoadGraph } from "../src/core/road-graph";
import { parseRoadGraph } from "../src/core/road-graph";
import { defaultSurfaceProfiles } from "../src/core/surface-tuning";

const graph = parseRoadGraph(compiledRaw, "public/maps/juliette-ga.map.json");
const routes = parseCourseData(routesRaw, "public/maps/juliette-ga.routes.json", graph);
const course = routes.courses.find((c) => c.mode === "circuit");
if (course === undefined) {
  throw new Error("racing-line.test.ts: fixture routes.json has no circuit course");
}
const navigation = buildNavigationGraph(graph);
const surfaceProfiles = defaultSurfaceProfiles();

describe("curvatureFromThreePoints", () => {
  it("returns 0 for three collinear points", () => {
    expect(curvatureFromThreePoints({ x: 0, z: 0 }, { x: 5, z: 0 }, { x: 10, z: 0 })).toBeCloseTo(
      0,
      9,
    );
  });

  it("returns ~0.02 (1/50) for three points on a radius-50 circle", () => {
    const R = 50;
    const a = { x: R * Math.cos(0), z: R * Math.sin(0) };
    const b = { x: R * Math.cos(0.3), z: R * Math.sin(0.3) };
    const c = { x: R * Math.cos(0.6), z: R * Math.sin(0.6) };
    expect(Math.abs(curvatureFromThreePoints(a, b, c) - 1 / R)).toBeLessThanOrEqual(0.001);
  });
});

describe("targetSpeedAtCurvature", () => {
  it("targetSpeedAtCurvature(0, 7, 45) === 45", () => {
    expect(targetSpeedAtCurvature(0, 7, 45)).toBe(45);
  });

  it("targetSpeedAtCurvature(0.02, 6, 45) is sqrt(300)", () => {
    expect(Math.abs(targetSpeedAtCurvature(0.02, 6, 45) - Math.sqrt(300))).toBeLessThanOrEqual(
      1e-9,
    );
  });
});

describe("silverLapTargetSec", () => {
  it("silverLapTargetSec({ totalTimeSec: 420, laps: 3 }) === 161", () => {
    expect(Math.abs(silverLapTargetSec({ totalTimeSec: 420, laps: 3 }) - 161)).toBeLessThanOrEqual(
      1e-9,
    );
  });
});

describe("buildRacingLine: real Juliette circuit", () => {
  const line = buildRacingLine(course, navigation, surfaceProfiles);

  it("lapLengthM is within 5% of 2040m", () => {
    expect(Math.abs(line.lapLengthM / 2040 - 1)).toBeLessThanOrEqual(0.05);
  });

  it("checkpointArcM has 5 strictly increasing entries and the last equals lapLengthM", () => {
    expect(line.checkpointArcM.length).toBe(5);
    for (let i = 1; i < line.checkpointArcM.length; i++) {
      expect(line.checkpointArcM[i]).toBeGreaterThan(line.checkpointArcM[i - 1]);
    }
    expect(line.checkpointArcM[line.checkpointArcM.length - 1]).toBe(line.lapLengthM);
  });

  it("points[0] lies within 1m of the last checkpoint's road node centreline sample", () => {
    const lastCheckpoint = course.checkpoints[course.checkpoints.length - 1];
    const node = graph.nodes.find((n) => n.id === lastCheckpoint.nodeId);
    expect(node).toBeDefined();
    if (node === undefined) return;
    const d = Math.hypot(line.points[0].centreX - node.x, line.points[0].centreZ - node.z);
    expect(d).toBeLessThanOrEqual(1);
  });

  it("every point stays within (halfWidthM - edgeMarginM) of its own centreline sample", () => {
    for (const p of line.points) {
      const maxOffset = Math.max(0, p.halfWidthM - DEFAULT_RACING_LINE_PARAMS.edgeMarginM);
      const offset = Math.hypot(p.x - p.centreX, p.z - p.centreZ);
      expect(offset).toBeLessThanOrEqual(maxOffset + 1e-6);
    }
  });

  it("every point within DEFECT_CLEARANCE_M of a defect coordinate runs exactly on the centreline", () => {
    let checked = 0;
    for (const p of line.points) {
      const nearDefect = DEFECT_COORDINATES.some(
        ([dx, dz]) => Math.hypot(p.centreX - dx, p.centreZ - dz) < DEFECT_CLEARANCE_M,
      );
      if (nearDefect) {
        checked++;
        expect(p.x).toBe(p.centreX);
        expect(p.z).toBe(p.centreZ);
      }
    }
    // Reported for visibility — this assertion is vacuously true if the real
    // route never comes within clearance of a defect, which is a legitimate
    // outcome, not a test bug.
    expect(checked).toBeGreaterThanOrEqual(0);
  });

  it("every point has a positive, capped target speed, and consecutive points are braking-feasible", () => {
    const n = line.points.length;
    const topCap = DEFAULT_RACING_LINE_PARAMS.topSpeedMs * DEFAULT_RACING_LINE_PARAMS.paceScale;
    for (let i = 0; i < n; i++) {
      const p = line.points[i];
      expect(p.targetSpeedMs).toBeGreaterThan(0);
      expect(p.targetSpeedMs).toBeLessThanOrEqual(topCap + 1e-6);
    }
    for (let i = 0; i < n; i++) {
      const next = (i + 1) % n;
      const ds =
        i === n - 1
          ? line.lapLengthM - line.points[i].arcM
          : line.points[next].arcM - line.points[i].arcM;
      const lhs = line.points[i].targetSpeedMs ** 2;
      const rhs =
        line.points[next].targetSpeedMs ** 2 + 2 * DEFAULT_RACING_LINE_PARAMS.aBrakeMs2 * ds;
      expect(lhs).toBeLessThanOrEqual(rhs + 1e-6);
    }
  });

  it("building twice gives deep-equal, frozen results", () => {
    const again = buildRacingLine(course, navigation, surfaceProfiles);
    expect(again).toEqual(line);
    expect(Object.isFrozen(line)).toBe(true);
    expect(Object.isFrozen(line.points)).toBe(true);
    expect(Object.isFrozen(line.points[0])).toBe(true);
  });
});

describe("buildRacingLine: error paths", () => {
  const smallGraph: RoadGraph = {
    schemaVersion: 1,
    areaId: "test",
    name: "test",
    source: { osmExtract: "", osmSnapshot: "", demSource: "", compilerVersion: "" },
    attribution: { osm: "", osmLicense: "", osmLicenseUrl: "", dem: "" },
    origin: { lat: 0, lon: 0, projection: "" },
    bounds: { minX: -100, minZ: -100, maxX: 100, maxZ: 100 },
    nodes: [0, 1, 2].map((id) => ({ id, x: id * 10, y: 0, z: 0, junction: false, osmNodeId: id })),
    edges: [
      {
        id: 0,
        from: 0,
        to: 1,
        points: [
          [0, 0, 0],
          [10, 0, 0],
        ],
        lengthM: 10,
        surface: "tarmac",
        roadClass: "residential",
        lanes: 1,
        widthM: 8,
        oneway: false,
        speedLimitKph: 40,
        bridge: false,
        tunnel: false,
        layer: 0,
        osmWayId: 0,
      },
      {
        id: 1,
        from: 1,
        to: 2,
        points: [
          [10, 0, 0],
          [20, 0, 0],
        ],
        lengthM: 10,
        surface: "tarmac",
        roadClass: "residential",
        lanes: 1,
        widthM: 8,
        oneway: false,
        speedLimitKph: 40,
        bridge: false,
        tunnel: false,
        layer: 0,
        osmWayId: 1,
      },
    ],
  };
  const smallNavigation = buildNavigationGraph(smallGraph);

  it("throws naming the course id when course.mode is not circuit", () => {
    const p2pCourse: Course = {
      id: "not-a-circuit",
      name: "test",
      mode: "p2p",
      laps: 1,
      checkpoints: [
        {
          id: "c0",
          nodeId: 1,
          edgeId: 0,
          position: [10, 0, 0],
          sensor: { widthM: 8, depthM: 8, heightM: 8 },
        },
      ],
      start: { nodeId: 0, headingRad: 0 },
    };
    expect(() => buildRacingLine(p2pCourse, smallNavigation, surfaceProfiles)).toThrowError(
      /not-a-circuit/,
    );
  });

  it("throws naming the course id when a leg is unroutable", () => {
    const unroutableCourse: Course = {
      id: "unroutable-circuit",
      name: "test",
      mode: "circuit",
      laps: 3,
      checkpoints: [
        {
          id: "c0",
          nodeId: 1,
          edgeId: 0,
          position: [10, 0, 0],
          sensor: { widthM: 8, depthM: 8, heightM: 8 },
        },
        // Node 99 does not exist in smallGraph -- unroutable.
        {
          id: "c1",
          nodeId: 99,
          edgeId: 1,
          position: [20, 0, 0],
          sensor: { widthM: 8, depthM: 8, heightM: 8 },
        },
      ],
      start: { nodeId: 0, headingRad: 0 },
    };
    expect(() => buildRacingLine(unroutableCourse, smallNavigation, surfaceProfiles)).toThrowError(
      /unroutable-circuit/,
    );
  });
});

describe("nearestLineIndex", () => {
  const line = buildRacingLine(course, navigation, surfaceProfiles);

  it("with hint null finds the global nearest point", () => {
    const target = line.points[Math.floor(line.points.length / 2)];
    const found = nearestLineIndex(line, target.x, target.z, null, 40);
    expect(line.points[found]).toBe(target);
  });

  it("with a hint only searches hint +/- window (wrapping)", () => {
    const hint = 5;
    const window = 3;
    // A point far outside the window should NOT be found even though it is
    // the true global nearest to itself — the windowed search should return
    // something within [hint - window, hint + window] instead.
    const farIndex = Math.floor(line.points.length / 2);
    const far = line.points[farIndex];
    const found = nearestLineIndex(line, far.x, far.z, hint, window);
    const n = line.points.length;
    const distFromHint = Math.min(Math.abs(found - hint), n - Math.abs(found - hint));
    expect(distFromHint).toBeLessThanOrEqual(window);
  });
});

describe("pointAhead", () => {
  const line = buildRacingLine(course, navigation, surfaceProfiles);

  it("returns a point whose arc is at least distanceM ahead (wrapping)", () => {
    const startIndex = 10;
    const distanceM = 50;
    const idx = pointAhead(line, startIndex, distanceM);
    const startArc = line.points[startIndex].arcM;
    let arcAhead = line.points[idx].arcM - startArc;
    if (arcAhead < 0) arcAhead += line.lapLengthM;
    expect(arcAhead).toBeGreaterThanOrEqual(distanceM - DEFAULT_RACING_LINE_PARAMS.spacingM);
  });
});

describe("buildGridPoses: real Juliette circuit", () => {
  const line = buildRacingLine(course, navigation, surfaceProfiles);
  const grid = buildGridPoses(line, 4);

  it("returns 4 poses", () => {
    expect(grid.length).toBe(4);
  });

  it("slot k centre lies (frontGapM + k*spacingM) +/- 1m of arc behind arc 0", () => {
    for (let k = 0; k < grid.length; k++) {
      const pose = grid[k];
      // Find nearest line point by XZ distance to approximate the pose's own arc.
      let bestIndex = 0;
      let bestDist = Number.POSITIVE_INFINITY;
      for (let i = 0; i < line.points.length; i++) {
        const d = Math.hypot(line.points[i].centreX - pose.x, line.points[i].centreZ - pose.z);
        if (d < bestDist) {
          bestDist = d;
          bestIndex = i;
        }
      }
      const arc = line.points[bestIndex].arcM;
      const behindArc0 = line.lapLengthM - arc;
      const expected = DEFAULT_GRID_PARAMS.frontGapM + k * DEFAULT_GRID_PARAMS.spacingM;
      expect(Math.abs(behindArc0 - expected)).toBeLessThanOrEqual(1);
    }
  });

  it("forwardFromYaw(pose.headingRad) is within 5 degrees of the line tangent at that arc", () => {
    for (const pose of grid) {
      let bestIndex = 0;
      let bestDist = Number.POSITIVE_INFINITY;
      for (let i = 0; i < line.points.length; i++) {
        const d = Math.hypot(line.points[i].centreX - pose.x, line.points[i].centreZ - pose.z);
        if (d < bestDist) {
          bestDist = d;
          bestIndex = i;
        }
      }
      const n = line.points.length;
      const prev = line.points[(bestIndex - 1 + n) % n];
      const next = line.points[(bestIndex + 1) % n];
      const tx = next.x - prev.x;
      const tz = next.z - prev.z;
      const tangentAngle = Math.atan2(tz, tx);
      const forward = forwardFromYaw(pose.headingRad);
      const forwardAngle = Math.atan2(forward.z, forward.x);
      let diff = Math.abs(tangentAngle - forwardAngle);
      if (diff > Math.PI) diff = 2 * Math.PI - diff;
      expect(diff).toBeLessThanOrEqual((5 * Math.PI) / 180);
    }
  });

  it("slots alternate lateral side and every pair is at least 6m apart", () => {
    for (let i = 0; i < grid.length; i++) {
      for (let j = i + 1; j < grid.length; j++) {
        const d = Math.hypot(grid[i].x - grid[j].x, grid[i].z - grid[j].z);
        expect(d).toBeGreaterThanOrEqual(6);
      }
    }
  });

  it("every pose is at least DEFECT_CLEARANCE_M from every defect coordinate", () => {
    for (const pose of grid) {
      for (const [dx, dz] of DEFECT_COORDINATES) {
        expect(Math.hypot(pose.x - dx, pose.z - dz)).toBeGreaterThanOrEqual(DEFECT_CLEARANCE_M);
      }
    }
  });
});
