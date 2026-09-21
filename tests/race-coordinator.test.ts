import { describe, expect, it, vi } from "vitest";
import type { Course } from "../src/core/course";
import { createMedalTiming } from "../src/core/medal-timing";
import { buildNavigationGraph } from "../src/core/navigation";
import { createRaceState } from "../src/core/race-state";
import type { RoadGraph } from "../src/core/road-graph";
import { createRaceCoordinator } from "../src/gameplay/race-coordinator";
import { navigationArrowRotation } from "../src/hud/navigation-arrow";

const graph: RoadGraph = {
  schemaVersion: 1,
  areaId: "test",
  name: "test",
  source: { osmExtract: "", osmSnapshot: "", demSource: "", compilerVersion: "" },
  attribution: { osm: "", osmLicense: "", osmLicenseUrl: "", dem: "" },
  origin: { lat: 0, lon: 0, projection: "" },
  bounds: { minX: -100, minZ: -100, maxX: 100, maxZ: 100 },
  nodes: [0, 1, 2, 3, 4].map((id) => ({
    id,
    x: id * 10,
    y: 0,
    z: 0,
    junction: false,
    osmNodeId: id,
  })),
  edges: [0, 1, 2, 3].map((id) => ({
    id,
    from: id,
    to: id + 1,
    points: [
      [id * 10, 0, 0],
      [(id + 1) * 10, 0, 0],
    ],
    lengthM: 10,
    surface: "tarmac" as const,
    roadClass: "residential",
    lanes: 1,
    widthM: 8,
    oneway: false,
    speedLimitKph: 40,
    bridge: false,
    tunnel: false,
    layer: 0,
    osmWayId: id,
  })),
};

const course: Course = {
  id: "p2p",
  name: "Test",
  mode: "p2p",
  laps: 1,
  start: { nodeId: 0, headingRad: 0 },
  checkpoints: [1, 2, 3, 4, 0].map((nodeId, index) => ({
    id: `c${index}`,
    nodeId,
    edgeId: Math.min(nodeId, 3),
    position: [nodeId * 10, 0, 0] as const,
    sensor: { widthM: 8, depthM: 8, heightM: 10 },
  })),
};

function setup() {
  const navigation = buildNavigationGraph(graph);
  const position = { x: 10, y: 0, z: 0 };
  const body = { translation: () => position, rotation: () => ({ x: 0, y: 0, z: 0, w: 1 }) };
  const state = createRaceState(course, navigation);
  const timing = createMedalTiming({ referenceTimeSec: 100 });
  let simTimeSec = 1;
  const scene = {
    vehicle: { body, telemetry: { groundSpeedMs: 1 } },
    defaultSpawnPose: { x: 0, y: 0, z: 0, headingRad: 0 },
    resetVehicle: vi.fn(),
  };
  const coordinator = createRaceCoordinator({
    course,
    navigation,
    state,
    scene: scene as never,
    objectiveView: { update: vi.fn() } as never,
    minimap: { update: vi.fn() } as never,
    navigationArrow: { update: vi.fn() } as never,
    raceHud: { update: vi.fn(), flashRestart: vi.fn() } as never,
    chime: { play: vi.fn() } as never,
    simTimeSec: () => simTimeSec,
    timing,
    reference: {
      courseId: "p2p",
      mode: "p2p",
      laps: 1,
      totalTimeSec: 100,
      thresholds: { ace: 90, gold: 100, silver: 115, bronze: 135 },
      splits: course.checkpoints.map((checkpoint, index) => ({
        checkpointId: checkpoint.id,
        lap: 1,
        authoredIndex: index,
        hitOrder: index,
        cumulativeTimeSec: (index + 1) * 20,
      })),
    },
  });
  return {
    coordinator,
    state,
    scene,
    position,
    timing,
    setSimTime: (value: number) => (simTimeSec = value),
  };
}

describe("race coordinator", () => {
  it("accepts a P2P checkpoint by post-step position and plays one chime", () => {
    const { coordinator, state, timing } = setup();
    coordinator.onTickEnd();
    expect(state.snapshot().visitedIds).toEqual(["c0"]);
    expect(state.snapshot().currentTargetId).toBe("c1");
    coordinator.onTickEnd();
    expect(timing.snapshot().sectors).toHaveLength(1);
  });

  it("routes restart before respawn and resets the presentation", () => {
    const { coordinator, scene, state } = setup();
    coordinator.onCommands({ respawn: true, restart: true });
    expect(scene.resetVehicle).toHaveBeenCalledOnce();
    expect(state.snapshot().penaltySec).toBe(0);
  });

  it("keeps respawn penalty in the active fixed-tick attempt", () => {
    const { coordinator, timing, state, setSimTime } = setup();
    coordinator.onTickEnd();
    setSimTime(2);
    coordinator.onCommands({ respawn: true, restart: false });

    expect(state.snapshot().penaltySec).toBe(5);
    expect(timing.snapshot()).toMatchObject({ phase: "active", penaltySec: 5 });
  });

  it("publishes one frozen completion and resets it on restart", () => {
    const { coordinator, timing, position, setSimTime } = setup();
    [10, 20, 30, 40, 0].forEach((x, index) => {
      position.x = x;
      setSimTime(index + 1);
      coordinator.onTickEnd();
    });

    const completed = timing.snapshot();
    expect(completed.phase).toBe("complete");
    expect(completed.completion?.sectors).toHaveLength(5);
    setSimTime(100);
    coordinator.onTickEnd();
    expect(timing.snapshot()).toEqual(completed);

    coordinator.onCommands({ respawn: false, restart: true });
    expect(timing.snapshot()).toMatchObject({ phase: "pre-drive", completion: null, sectors: [] });
  });
});

describe("navigation arrow bearing", () => {
  it("keeps a waypoint on the car's right at a right angle", () => {
    expect(navigationArrowRotation(0, [0, 0, 0], [0, 0, 10])).toBeCloseTo(Math.PI / 2);
  });
});
