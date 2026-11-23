import { describe, expect, it } from "vitest";
import fixtureRaw from "../../fixtures/road-graph.sample.json?raw";
import { parseRoadGraph } from "../../src/core/road-graph.ts";
import { isValidationMessage, validateRoutesPut, validateStagesPut } from "./vite-plugin.ts";

const EXTENT = { minX: -500, minZ: -500, maxX: 500, maxZ: 500 };
const graph = parseRoadGraph(fixtureRaw, "fixtures/road-graph.sample.json");

function stages(areaId: string, gateX = 10): string {
  return JSON.stringify({
    schemaVersion: 1,
    areaId,
    stages: [
      {
        id: "a",
        name: "Stage A",
        start: { x: 0, z: 0, headingRad: 1 },
        gates: [{ id: "g1", x: gateX, z: 10, headingRad: 0.5, widthM: 20 }],
        finish: { x: 30, z: 30, headingRad: 0.2, widthM: 25 },
      },
    ],
  });
}

function routes(areaId: string, nodeId = 0): string {
  return JSON.stringify({
    schemaVersion: 1,
    areaId,
    courses: [
      {
        id: "p2p-demo",
        name: "Demo",
        mode: "p2p",
        checkpoints: Array.from({ length: 2 }, (_, i) => ({
          id: `c${i + 1}`,
          nodeId: i === 0 ? nodeId : 1,
          edgeId: i,
          position: [i * 100, 0, 0],
          sensor: { widthM: 8, depthM: 12, heightM: 10 },
        })),
        start: { nodeId: 0, headingRad: 0 },
      },
    ],
  });
}

describe("validateStagesPut", () => {
  it("accepts a valid file and an empty list", () => {
    expect(() => validateStagesPut(stages("demo-hills"), "demo-hills", EXTENT)).not.toThrow();
    const empty = JSON.stringify({ schemaVersion: 1, areaId: "demo-hills", stages: [] });
    expect(() => validateStagesPut(empty, "demo-hills", EXTENT)).not.toThrow();
  });
  it("rejects an areaId mismatch", () => {
    expect(() => validateStagesPut(stages("other"), "demo-hills", EXTENT)).toThrow(
      /^parseStageData:.*areaId/,
    );
  });
  it("rejects a gate outside the extent", () => {
    expect(() => validateStagesPut(stages("demo-hills", 9999), "demo-hills", EXTENT)).toThrow(
      /^parseStageData:/,
    );
  });
});

describe("validateRoutesPut", () => {
  it("accepts a valid file and an empty list", () => {
    expect(() => validateRoutesPut(routes("sample-square"), "sample-square", graph)).not.toThrow();
    const empty = JSON.stringify({ schemaVersion: 1, areaId: "sample-square", courses: [] });
    expect(() => validateRoutesPut(empty, "sample-square", graph)).not.toThrow();
  });
  it("rejects an areaId mismatch", () => {
    expect(() => validateRoutesPut(routes("other"), "sample-square", graph)).toThrow(
      /^parseCourseData:/,
    );
  });
  it("rejects an unknown node", () => {
    expect(() => validateRoutesPut(routes("sample-square", 9999), "sample-square", graph)).toThrow(
      /^parseCourseData:/,
    );
  });
});

describe("isValidationMessage", () => {
  it("classifies known prefixes as validation errors", () => {
    for (const p of [
      "terrain-format:",
      "parseRoadGraph:",
      "terrain-save:",
      "parseStageData:",
      "parseCourseData:",
    ]) {
      expect(isValidationMessage(`${p} boom`)).toBe(true);
    }
    expect(isValidationMessage("EACCES: permission denied")).toBe(false);
  });
});
