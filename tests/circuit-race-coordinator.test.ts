import { describe, expect, it, vi } from "vitest";
import type { Course } from "../src/core/course";
import type { InputFrame } from "../src/core/input-tape";
import { buildNavigationGraph } from "../src/core/navigation";
import {
  AI_RACER_COUNT,
  HOLD_FRAME,
  PLAYER_GRID_SLOT,
  RACE_FIELD_SIZE,
} from "../src/core/race-start";
import type { RoadGraph } from "../src/core/road-graph";
import { createCircuitRaceCoordinator } from "../src/gameplay/circuit-race-coordinator";
import circuitRaceCoordinatorSource from "../src/gameplay/circuit-race-coordinator.ts?raw";

// A closed 5-node loop (0 -> 1 -> 2 -> 3 -> 4 -> 0), matching the hand-built
// RoadGraph/Course fixture pattern from tests/race-coordinator.test.ts, but
// closed into a loop (edge 4 -> 0) and in circuit mode so a full lap (4
// checkpoints, laps 1) can complete.
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
  edges: [0, 1, 2, 3, 4].map((id) => ({
    id,
    from: id,
    to: (id + 1) % 5,
    points: [
      [id * 10, 0, 0],
      [((id + 1) % 5) * 10, 0, 0],
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
  id: "circuit-race-fixture",
  name: "Test Circuit",
  mode: "circuit",
  laps: 1,
  start: { nodeId: 0, headingRad: 0 },
  checkpoints: [1, 2, 3, 4].map((nodeId, index) => ({
    id: `c${index}`,
    nodeId,
    edgeId: nodeId - 1,
    position: [nodeId * 10, 0, 0] as const,
    sensor: { widthM: 8, depthM: 8, heightM: 10 },
  })),
};

/** `checkpoints[index].position` as a plain `{x,y,z}`, for moving a fake body there. */
function checkpointXYZ(index: number): { x: number; y: number; z: number } {
  const [x, y, z] = course.checkpoints[index].position;
  return { x, y, z };
}

const BASE_FRAME: InputFrame = Object.freeze({
  steer: 0.3,
  throttle: 0.7,
  brake: 0,
  handbrake: false,
});
const LIVE_FRAME: InputFrame = Object.freeze({
  steer: -0.5,
  throttle: 1,
  brake: 0,
  handbrake: true,
});

function makeBody(initial: { x: number; y: number; z: number }) {
  let position = { ...initial };
  const rotation = { x: 0, y: 0, z: 0, w: 1 };
  return {
    translation: () => position,
    rotation: () => rotation,
    setPosition(next: { x: number; y: number; z: number }): void {
      position = next;
    },
  };
}

function makeFleet() {
  const bodies = [0, 1, 2].map(() => makeBody({ x: 0, y: 0, z: 0 }));
  const telemetry = [0, 1, 2].map(() => ({ forwardSpeedMs: 0 }));
  const cars = [0, 1, 2].map((i) => ({
    vehicle: { body: bodies[i], telemetry: telemetry[i] },
  }));
  let shapeOutputs: InputFrame[] = [];
  const tick = vi.fn(
    (_tickIndex: number, shape?: (carIndex: number, base: InputFrame) => InputFrame) => {
      shapeOutputs = [0, 1, 2].map((i) => (shape ? shape(i, BASE_FRAME) : BASE_FRAME));
    },
  );
  const resetCar = vi.fn();
  return {
    cars,
    tick,
    resetCar,
    bodies,
    telemetry,
    get shapeOutputs(): readonly InputFrame[] {
      return shapeOutputs;
    },
  };
}

function setup() {
  const navigation = buildNavigationGraph(graph);
  const playerBody = makeBody({ x: -1, y: 0, z: -1 });
  const resetVehicle = vi.fn();
  const scene = { vehicle: { body: playerBody }, resetVehicle };
  const fleet = makeFleet();
  const gridPoses = [
    { x: 0, y: 0, z: 0, headingRad: 0 },
    { x: 1, y: 0, z: 0, headingRad: 0.1 },
    { x: 2, y: 0, z: 0, headingRad: 0.2 },
    { x: 3, y: 0, z: 0, headingRad: 0.3 },
  ];
  const objectiveView = { update: vi.fn() };
  const minimap = { update: vi.fn() };
  const navigationArrow = { update: vi.fn() };
  const raceHud = { update: vi.fn(), flashRestart: vi.fn(), showCountdown: vi.fn() };
  const chime = { play: vi.fn() };
  const coordinator = createCircuitRaceCoordinator({
    course,
    navigation,
    scene: scene as never,
    fleet: fleet as never,
    gridPoses,
    objectiveView: objectiveView as never,
    minimap: minimap as never,
    navigationArrow: navigationArrow as never,
    raceHud: raceHud as never,
    chime: chime as never,
  });
  return {
    coordinator,
    fleet,
    scene,
    playerBody,
    gridPoses,
    objectiveView,
    minimap,
    navigationArrow,
    raceHud,
    chime,
  };
}

describe("circuit race coordinator — countdown gate", () => {
  it("holds every car neutral and gates the player before release, with correct labels at 0/60/120", () => {
    const { coordinator, fleet } = setup();
    const expected: readonly [number, "3" | "2" | "1"][] = [
      [0, "3"],
      [59, "3"],
      [60, "2"],
      [119, "2"],
      [120, "1"],
      [179, "1"],
    ];
    for (const [tick, label] of expected) {
      coordinator.onTickBegin(tick);
      expect(fleet.shapeOutputs).toEqual([HOLD_FRAME, HOLD_FRAME, HOLD_FRAME]);
      expect(coordinator.gatePlayerInput(LIVE_FRAME)).toEqual(HOLD_FRAME);
      expect(coordinator.snapshot().phase).toBe("countdown");
      expect(coordinator.snapshot().countdownLabel).toBe(label);
    }
  });

  it("releases the field at GO: gate passes through unchanged, fleet gets the base frame, elapsed derives from sim ticks", () => {
    const { coordinator, fleet } = setup();
    coordinator.onTickBegin(0);
    coordinator.onTickBegin(180);
    expect(fleet.shapeOutputs).toEqual([BASE_FRAME, BASE_FRAME, BASE_FRAME]);
    expect(coordinator.gatePlayerInput(LIVE_FRAME)).toBe(LIVE_FRAME);
    expect(coordinator.snapshot().elapsedSec).toBeCloseTo(0, 9);

    coordinator.onTickBegin(240);
    expect(coordinator.snapshot().elapsedSec).toBeCloseTo(1.0, 9);
  });
});

describe("circuit race coordinator — per-racer checkpoint progress", () => {
  it("advances only the racer that reaches a checkpoint; the chime plays only for the player", () => {
    const { coordinator, fleet, scene, chime } = setup();
    coordinator.onTickBegin(0);
    coordinator.onTickBegin(180);

    fleet.bodies[0].setPosition(checkpointXYZ(0));
    coordinator.onTickEnd();

    const afterAiHit = coordinator.snapshot();
    expect(afterAiHit.racers[0].race.visitedIds).toEqual(["c0"]);
    expect(afterAiHit.racers[1].race.visitedIds).toEqual([]);
    expect(afterAiHit.racers[2].race.visitedIds).toEqual([]);
    expect(afterAiHit.racers[3].race.visitedIds).toEqual([]);
    expect(chime.play).not.toHaveBeenCalled();

    scene.vehicle.body.setPosition(checkpointXYZ(0));
    coordinator.onTickEnd();

    const afterPlayerHit = coordinator.snapshot();
    expect(afterPlayerHit.racers[3].race.visitedIds).toEqual(["c0"]);
    expect(chime.play).toHaveBeenCalledTimes(1);
  });

  it("records a racer's finish time exactly once, then coasts that racer's AI (throttle 0)", () => {
    const { coordinator, fleet } = setup();
    coordinator.onTickBegin(0);
    coordinator.onTickBegin(180);

    for (let i = 0; i < course.checkpoints.length; i++) {
      fleet.bodies[0].setPosition(checkpointXYZ(i));
      coordinator.onTickEnd();
    }

    const afterFinish = coordinator.snapshot();
    expect(afterFinish.racers[0].race.complete).toBe(true);
    expect(afterFinish.racers[0].finishElapsedSec).not.toBeNull();
    expect(afterFinish.racers[0].finishElapsedSec).toBe(afterFinish.elapsedSec);

    const recordedFinish = afterFinish.racers[0].finishElapsedSec;

    fleet.telemetry[0].forwardSpeedMs = 5;
    coordinator.onTickBegin(181);
    expect(fleet.shapeOutputs[0].throttle).toBe(0);

    coordinator.onTickBegin(300);
    coordinator.onTickEnd();
    expect(coordinator.snapshot().racers[0].finishElapsedSec).toBe(recordedFinish);
  });
});

describe("circuit race coordinator — restart and respawn", () => {
  it("restart resets every racer to the grid and reruns the countdown", () => {
    const { coordinator, fleet, scene, gridPoses } = setup();
    coordinator.onTickBegin(0);
    coordinator.onTickBegin(180);
    fleet.bodies[0].setPosition(checkpointXYZ(0));
    coordinator.onTickEnd();

    coordinator.onCommands({ restart: true, respawn: false });

    expect(scene.resetVehicle).toHaveBeenCalledWith(gridPoses[PLAYER_GRID_SLOT]);
    expect(fleet.resetCar).toHaveBeenCalledTimes(AI_RACER_COUNT);
    for (let i = 0; i < AI_RACER_COUNT; i++) {
      expect(fleet.resetCar).toHaveBeenNthCalledWith(i + 1, i, gridPoses[i]);
    }

    const snap = coordinator.snapshot();
    expect(snap.racers).toHaveLength(RACE_FIELD_SIZE);
    for (const racer of snap.racers) {
      expect(racer.race.lap).toBe(1);
      expect(racer.race.visitedIds).toEqual([]);
    }

    coordinator.onTickBegin(1000);
    expect(coordinator.snapshot().phase).toBe("countdown");
    expect(coordinator.snapshot().countdownLabel).toBe("3");
  });

  it("respawn resets only the player; AI keep racing untouched", () => {
    const { coordinator, fleet, scene } = setup();
    coordinator.onTickBegin(0);
    coordinator.onTickBegin(180);
    fleet.bodies[0].setPosition(checkpointXYZ(0));
    coordinator.onTickEnd();
    const aiRaceBefore = coordinator.snapshot().racers[0].race;

    coordinator.onCommands({ respawn: true, restart: false });

    expect(scene.resetVehicle).toHaveBeenCalledTimes(1);
    expect(fleet.resetCar).not.toHaveBeenCalled();

    const snap = coordinator.snapshot();
    expect(snap.racers[3].race.penaltySec).toBe(5);
    expect(snap.racers[0].race).toEqual(aiRaceBefore);
  });
});

describe("source guard: circuit-race-coordinator.ts never touches the medal system (SC5, D-05)", () => {
  const forbidden = ["medal-timing", "MedalTiming", "saveMedalResult", "medal-persistence"];

  function nonCommentLines(source: string): string[] {
    return source.split("\n").filter((line) => {
      const trimmed = line.trim();
      return !(trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*"));
    });
  }

  it("has no non-comment reference to medal-timing / MedalTiming / saveMedalResult / medal-persistence", () => {
    const lines = nonCommentLines(circuitRaceCoordinatorSource);
    for (const term of forbidden) {
      const hits = lines.filter((line) => line.includes(term));
      expect(hits).toEqual([]);
    }
  });
});
