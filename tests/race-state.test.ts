import { describe, expect, it } from "vitest";
import type { Course, CourseCheckpoint } from "../src/core/course";
import { buildNavigationGraph } from "../src/core/navigation";
import type { RoadGraph } from "../src/core/road-graph";
import { createRaceState } from "../src/core/race-state";

const graph: RoadGraph = {
  schemaVersion: 1,
  areaId: "race-test",
  name: "race-test",
  source: { osmExtract: "", osmSnapshot: "", demSource: "", compilerVersion: "" },
  attribution: { osm: "", osmLicense: "", osmLicenseUrl: "", dem: "" },
  origin: { lat: 0, lon: 0, projection: "local-enu-metres" },
  bounds: { minX: 0, minZ: 0, maxX: 300, maxZ: 20 },
  nodes: [0, 1, 2, 3].map((id) => ({
    id,
    x: id * 100,
    y: 0,
    z: 0,
    junction: id === 0 || id === 3,
    osmNodeId: id,
  })),
  edges: [0, 1, 2].map((id) => ({
    id,
    from: id,
    to: id + 1,
    points: [
      [id * 100, 0, 0],
      [(id + 1) * 100, 0, 0],
    ] as [number, number, number][],
    lengthM: id === 1 ? 10 : 100,
    surface: "tarmac" as const,
    roadClass: "residential" as const,
    lanes: 2,
    widthM: 8,
    oneway: false,
    speedLimitKph: 50,
    bridge: false,
    tunnel: false,
    layer: 0,
    osmWayId: id,
  })),
};

function checkpoint(id: string, nodeId: number): CourseCheckpoint {
  return {
    id,
    nodeId,
    edgeId: Math.max(0, Math.min(2, nodeId - 1)),
    position: [nodeId * 100, 0, 0],
    sensor: { widthM: 20, depthM: 20, heightM: 10 },
  };
}

function course(mode: Course["mode"]): Course {
  return {
    id: `${mode}-test`,
    name: mode,
    mode,
    laps: mode === "circuit" ? 3 : 1,
    checkpoints: [checkpoint("a", 1), checkpoint("b", 2), checkpoint("c", 3)],
    start: { nodeId: 0, headingRad: 0 },
  };
}

describe("race state", () => {
  const navigation = buildNavigationGraph(graph);

  it("accepts P2P checkpoints in any order and chooses the lowest road-cost target", () => {
    const state = createRaceState(course("p2p"), navigation);
    expect(state.snapshot().currentTargetId).toBe("a");

    state.updateProgress(0, 0);
    expect(state.hitCheckpoint("c")).toBe(true);
    expect(state.snapshot().visitedIds).toEqual(["c"]);
    expect(state.snapshot().currentTargetId).toBe("a");
    expect(state.hitCheckpoint("c")).toBe(false);

    state.updateProgress(2, 0);
    expect(state.snapshot().currentTargetId).toBe("b");
    expect(state.hitCheckpoint("b")).toBe(true);
    expect(state.hitCheckpoint("a")).toBe(true);
    expect(state.snapshot().complete).toBe(true);
    expect(state.snapshot().currentTargetId).toBeNull();
  });

  it("accepts only the authored Circuit order and completes exactly three laps", () => {
    const state = createRaceState(course("circuit"), navigation);
    expect(state.hitCheckpoint("b")).toBe(false);

    for (let lap = 1; lap <= 3; lap++) {
      expect(state.hitCheckpoint("a")).toBe(true);
      expect(state.hitCheckpoint("b")).toBe(true);
      expect(state.hitCheckpoint("c")).toBe(true);
      expect(state.snapshot().lap).toBe(lap === 3 ? 3 : lap + 1);
      if (lap < 3) expect(state.snapshot().complete).toBe(false);
    }

    expect(state.snapshot().complete).toBe(true);
    expect(state.hitCheckpoint("a")).toBe(false);
  });

  it("tracks wrong-way hysteresis without flagging P2P route choices", () => {
    const circuit = createRaceState(course("circuit"), navigation);
    circuit.updateProgress(0, Math.PI);
    expect(circuit.snapshot().wrongWay).toBe(true);
    circuit.updateProgress(0, Math.PI * 0.6);
    expect(circuit.snapshot().wrongWay).toBe(false);

    const p2p = createRaceState(course("p2p"), navigation);
    p2p.updateProgress(0, Math.PI);
    expect(p2p.snapshot().wrongWay).toBe(false);
  });

  it("adds a flat respawn penalty and restart clears all progress", () => {
    const state = createRaceState(course("p2p"), navigation);
    state.hitCheckpoint("a");
    state.respawn();
    expect(state.snapshot().penaltySec).toBe(5);
    expect(state.snapshot().respawnAnchorId).toBe("a");
    state.restart();
    expect(state.snapshot()).toMatchObject({
      currentTargetId: "a",
      visitedIds: [],
      lap: 1,
      complete: false,
      penaltySec: 0,
      respawnAnchorId: null,
    });
  });
});