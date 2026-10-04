import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseCourseData } from "../src/core/course";
import { parseMedalReference } from "../src/core/medal-reference";
import { validateCourseRoutes } from "../src/core/navigation";
import { parseRoadGraph } from "../src/core/road-graph";

const read = (name: string) => readFileSync(`public/maps/grid-test.${name}.json`, "utf8");

describe("grid-test shipped artifacts", () => {
  const graph = parseRoadGraph(read("map"), "grid-test.map.json");
  const routes = parseCourseData(read("routes"), "grid-test.routes.json", graph);

  it("has valid routes", () => {
    expect(validateCourseRoutes(routes, graph)).toEqual([]);
  });

  it("has a medal reference matching the routes", () => {
    const expectations = routes.courses.map((c) => ({
      courseId: c.id,
      mode: c.mode,
      laps: c.laps,
      checkpointIds: c.checkpoints.map((cp) => cp.id),
    }));
    expect(() =>
      parseMedalReference(read("medals"), "grid-test.medals.json", "grid-test", expectations),
    ).not.toThrow();
  });
});
