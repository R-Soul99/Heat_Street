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

  // Plan 04.2-15 (D-07): grid-test medals are now a designer reference run on the
  // migrated terrain map, NOT the synthetic average-speed formula. Re-running
  // tools/map-compiler/synthetic/author-grid-routes.ts would overwrite them with
  // formula values (see docs/terrain-migration.md), so this test validates the
  // committed file against the routes instead of re-deriving the formula.
  it("has a medal reference matching the routes", () => {
    const expectations = routes.courses.map((c) => ({
      courseId: c.id,
      mode: c.mode,
      laps: c.laps,
      checkpointIds: c.checkpoints.map((cp) => cp.id),
    }));
    const reference = parseMedalReference(
      read("medals"),
      "grid-test.medals.json",
      "grid-test",
      expectations,
    );
    expect(reference.handlingContentVersion).toBe("261104-liftwide");
    const totals = Object.fromEntries(reference.courses.map((c) => [c.courseId, c.totalTimeSec]));
    expect(totals).toEqual({ "grid-test-stagger-run": 120, "grid-test-block-loop": 281.467 });
  });
});
