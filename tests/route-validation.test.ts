import { describe, expect, it } from "vitest";
import mapRaw from "../public/maps/juliette-ga.map.json?raw";
import routesRaw from "../public/maps/juliette-ga.routes.json?raw";
import type { CourseData } from "../src/core/course";
import { parseCourseData } from "../src/core/course";
import { buildNavigationGraph, findRoadPath, validateCourseRoutes } from "../src/core/navigation";
import { parseRoadGraph } from "../src/core/road-graph";

describe("Juliette route artifact", () => {
  it("contains two reachable mixed-surface courses clear of known defects", () => {
    const graph = parseRoadGraph(mapRaw, "public/maps/juliette-ga.map.json");
    const routes = parseCourseData(routesRaw, "public/maps/juliette-ga.routes.json", graph);
    expect(validateCourseRoutes(routes, graph)).toEqual([]);
  });
});

const authoredGraph = parseRoadGraph(mapRaw, "public/maps/juliette-ga.map.json");
const sampleEdge = authoredGraph.edges[0];

function singleCheckpointRoutes(
  areaId: string,
  startNodeId: number,
  checkpointNodeId: number,
  edgeId: number,
  position: [number, number, number],
): CourseData {
  return {
    schemaVersion: 1,
    areaId,
    courses: [
      {
        id: "r",
        name: "r",
        mode: "p2p",
        laps: 1,
        start: { nodeId: startNodeId, headingRad: 0 },
        checkpoints: [
          {
            id: "r-finish",
            nodeId: checkpointNodeId,
            edgeId,
            position,
            sensor: { widthM: 1, depthM: 1, heightM: 1 },
          },
        ],
      },
    ],
  };
}

describe("validateCourseRoutes authored option", () => {
  const farX = Math.max(...sampleEdge.points.map((point) => point[0])) + 35;
  const farPos: [number, number, number] = [farX, 0, sampleEdge.points[0][2]];

  it("reports distance and sensor failures by default but not when authored", () => {
    const routes = singleCheckpointRoutes(
      "other-area",
      sampleEdge.from,
      sampleEdge.to,
      sampleEdge.id,
      farPos,
    );
    expect(validateCourseRoutes(routes, authoredGraph).join(" ")).toContain("not near edge");
    const authored = validateCourseRoutes(routes, authoredGraph, { authored: true }).join(" ");
    expect(authored).not.toContain("not near edge");
    expect(authored).not.toContain("sensor is too small");
  });

  it("still reports an unreachable checkpoint when authored", () => {
    const navigation = buildNavigationGraph(authoredGraph);
    let pair: [number, number] | null = null;
    for (const a of authoredGraph.nodes.slice(0, 60)) {
      for (const b of authoredGraph.nodes.slice(0, 60)) {
        if (pair === null && a.id !== b.id && findRoadPath(navigation, a.id, b.id).length === 0)
          pair = [a.id, b.id];
      }
    }
    if (pair === null) return;
    const routes = singleCheckpointRoutes("other-area", pair[0], pair[1], sampleEdge.id, farPos);
    const failures = validateCourseRoutes(routes, authoredGraph, { authored: true });
    expect(failures.join(" ")).toContain("no directed path");
  });

  it("checks defect coordinates only for juliette-ga", () => {
    const defectPos: [number, number, number] = [-633.25, 0, -134.43];
    const juliette = singleCheckpointRoutes(
      "juliette-ga",
      sampleEdge.from,
      sampleEdge.to,
      sampleEdge.id,
      defectPos,
    );
    const other = { ...juliette, areaId: "other-area" };
    expect(validateCourseRoutes(juliette, authoredGraph, { authored: true }).join(" ")).toContain(
      "defect coordinate",
    );
    expect(validateCourseRoutes(other, authoredGraph, { authored: true }).join(" ")).not.toContain(
      "defect coordinate",
    );
  });
});
