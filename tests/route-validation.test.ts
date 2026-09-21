import { describe, expect, it } from "vitest";
import mapRaw from "../public/maps/juliette-ga.map.json?raw";
import routesRaw from "../public/maps/juliette-ga.routes.json?raw";
import { parseCourseData } from "../src/core/course";
import { validateCourseRoutes } from "../src/core/navigation";
import { parseRoadGraph } from "../src/core/road-graph";

describe("Juliette route artifact", () => {
  it("contains two reachable mixed-surface courses clear of known defects", () => {
    const graph = parseRoadGraph(mapRaw, "public/maps/juliette-ga.map.json");
    const routes = parseCourseData(routesRaw, "public/maps/juliette-ga.routes.json", graph);
    expect(validateCourseRoutes(routes, graph)).toEqual([]);
  });
});
