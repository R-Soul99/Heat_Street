import { describe, expect, it, vi } from "vitest";
import type { Course } from "../src/core/course";
import type { InputFrame } from "../src/core/input-tape";
import { buildNavigationGraph } from "../src/core/navigation";
import {
  AI_PAINTS,
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
  const telemetry = [0, 1, 2].map(() => ({ forwardSpeedMs: 0, groundSpeedMs: 0, tiltDeg: 0 }));
  const debugLineIndex = [0, 0, 0];
  // Distinct per-car target coordinates so a debugSnapshot() test can tell
  // each AI's own `driver.debug()` read apart from the others'.
  const debugTargetX = [10, 20, 30];
  const debugTargetZ = [-10, -20, -30];
  const cars = [0, 1, 2].map((i) => ({
    vehicle: { body: bodies[i], telemetry: telemetry[i] },
    driver: {
      debug: () => ({
        lineIndex: debugLineIndex[i],
        targetX: debugTargetX[i],
        targetZ: debugTargetZ[i],
      }),
    },
  }));
  let shapeOutputs: InputFrame[] = [];
  const tick = vi.fn(
    (_tickIndex: number, shape?: (carIndex: number, base: InputFrame) => InputFrame) => {
      shapeOutputs = [0, 1, 2].map((i) => (shape ? shape(i, BASE_FRAME) : BASE_FRAME));
    },
  );
  const resetCar = vi.fn();
  // Defaults to BASE_FRAME's own throttle (0.7) so a real pursuit-driven
  // fleet's typical "commanded" throttle is the default in these tests too
  // — individual tests override this per-car to exercise the stuck check.
  const lastFrames: InputFrame[] = [BASE_FRAME, BASE_FRAME, BASE_FRAME];
  const lastFrame = vi.fn((carIndex: number): InputFrame => lastFrames[carIndex]);
  const avoidanceScales = [1, 1, 1];
  const avoidanceScale = vi.fn((carIndex: number): number => avoidanceScales[carIndex]);
  return {
    cars,
    tick,
    resetCar,
    bodies,
    telemetry,
    debugLineIndex,
    debugTargetX,
    debugTargetZ,
    lastFrame,
    avoidanceScale,
    avoidanceScales,
    setLastFrameThrottle(carIndex: number, throttle: number): void {
      lastFrames[carIndex] = Object.freeze({ ...lastFrames[carIndex], throttle });
    },
    get shapeOutputs(): readonly InputFrame[] {
      return shapeOutputs;
    },
  };
}

/** A synthetic `RacingLine`-shaped fixture — only `lapLengthM` and `points[i].arcM` are read by the coordinator; a large `lapLengthM` keeps the no-progress window (8s) well outside every test's own tick budget so it never interferes with the stuck-speed tests below. */
const line = { lapLengthM: 1_000_000, points: [{ arcM: 0 }] };

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
  const onCarReset = vi.fn();
  const coordinator = createCircuitRaceCoordinator({
    course,
    navigation,
    scene: scene as never,
    fleet: fleet as never,
    gridPoses,
    line: line as never,
    objectiveView: objectiveView as never,
    minimap: minimap as never,
    navigationArrow: navigationArrow as never,
    raceHud: raceHud as never,
    chime: chime as never,
    onCarReset,
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
    onCarReset,
  };
}

/** Drives `n` onTickBegin/onTickEnd pairs starting from `startTick`, returning the next unused tick index. */
function runTicks(
  coordinator: ReturnType<typeof createCircuitRaceCoordinator>,
  startTick: number,
  n: number,
): number {
  let tick = startTick;
  for (let i = 0; i < n; i++) {
    coordinator.onTickBegin(tick);
    coordinator.onTickEnd();
    tick++;
  }
  return tick;
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

describe("circuit race coordinator — AI stuck/flip recovery (SC3, D-13)", () => {
  it("snapshot().racers[i].stuck is the detector snapshot for AI and null for the player", () => {
    const { coordinator } = setup();
    const snap = coordinator.snapshot();
    for (let i = 0; i < AI_RACER_COUNT; i++) {
      expect(snap.racers[i].stuck).toEqual({
        phase: "racing",
        stuckSec: 0,
        flippedSec: 0,
        noProgressSec: 0,
        recoverSec: 0,
        deferSec: 0,
      });
    }
    expect(snap.racers[PLAYER_GRID_SLOT].stuck).toBeNull();
  });

  it("a stuck AI car begins a reverse drive-out after ~2.5s stuck", () => {
    const { coordinator, fleet } = setup();
    coordinator.onTickBegin(0);
    coordinator.onTickBegin(180);

    fleet.telemetry[0].groundSpeedMs = 0;
    fleet.telemetry[0].tiltDeg = 0;
    fleet.setLastFrameThrottle(0, 1);

    let tick = 181;
    let recovering = false;
    for (let i = 0; i < 200 && !recovering; i++) {
      tick = runTicks(coordinator, tick, 1);
      recovering = coordinator.snapshot().racers[0].stuck?.phase === "recovering";
    }
    expect(recovering).toBe(true);

    // One more onTickBegin to read the shape output derived from the
    // now-"recovering" detector snapshot.
    coordinator.onTickBegin(tick);
    expect(fleet.shapeOutputs[0]).toEqual({
      steer: -BASE_FRAME.steer,
      throttle: 0,
      brake: 1,
      handbrake: false,
    });
  });

  it("still stuck with the player far away: resets at the grid pose (no anchor yet), charges the 5s penalty, calls onCarReset once, then resumes racing", () => {
    const { coordinator, fleet, scene, onCarReset, gridPoses } = setup();
    coordinator.onTickBegin(0);
    coordinator.onTickBegin(180);

    // Every OTHER racer (player, fleet cars 1/2) starts near the origin in
    // this fixture — the same point as car 0's own no-anchor reset pose
    // (gridPoses[0]). Move them all clear so the 6m clearance check (tested
    // separately below) doesn't also block this test's reset.
    scene.vehicle.body.setPosition({ x: 1000, y: 0, z: 1000 });
    fleet.bodies[1].setPosition({ x: 1000, y: 0, z: 1000 });
    fleet.bodies[2].setPosition({ x: 1000, y: 0, z: 1000 });
    fleet.telemetry[0].groundSpeedMs = 0;
    fleet.telemetry[0].tiltDeg = 0;
    fleet.setLastFrameThrottle(0, 1);

    let tick = 181;
    let resetCalled = false;
    for (let i = 0; i < 400 && !resetCalled; i++) {
      tick = runTicks(coordinator, tick, 1);
      resetCalled = fleet.resetCar.mock.calls.length > 0;
    }
    expect(fleet.resetCar).toHaveBeenCalledTimes(1);
    expect(fleet.resetCar).toHaveBeenCalledWith(0, gridPoses[0]);
    expect(onCarReset).toHaveBeenCalledTimes(1);
    expect(onCarReset).toHaveBeenCalledWith(0);
    expect(coordinator.snapshot().racers[0].race.penaltySec).toBe(5);

    // Once the reset label time has passed, this racer is driving normally
    // again — shape is the unmodified pursuit frame, not a drive-out override.
    tick = runTicks(coordinator, tick, 65);
    coordinator.onTickBegin(tick);
    expect(fleet.shapeOutputs[0]).toEqual(BASE_FRAME);
  });

  it("defers the actual reset while the player is within 60m, without ever losing the pending request", () => {
    const { coordinator, fleet, scene, onCarReset } = setup();
    coordinator.onTickBegin(0);
    coordinator.onTickBegin(180);

    // 10m from car 0's own no-anchor reset pose (gridPoses[0], the origin):
    // inside the 60m camera-clearance defer radius but clear of the
    // separately-tested 6m reset-pose-occupied clearance check.
    scene.vehicle.body.setPosition({ x: 10, y: 0, z: 0 });
    fleet.bodies[1].setPosition({ x: 1000, y: 0, z: 1000 });
    fleet.bodies[2].setPosition({ x: 1000, y: 0, z: 1000 });
    fleet.telemetry[0].groundSpeedMs = 0;
    fleet.telemetry[0].tiltDeg = 0;
    fleet.setLastFrameThrottle(0, 1);

    // Past stuck (2.5s) + drive-out timeout (3.0s) = 5.5s (330 ticks) — still withheld.
    let tick = runTicks(coordinator, 181, 330);
    expect(fleet.resetCar).not.toHaveBeenCalled();

    // A further ~3.0s of deferral resolves it.
    let resetCalled = false;
    for (let i = 0; i < 200 && !resetCalled; i++) {
      tick = runTicks(coordinator, tick, 1);
      resetCalled = fleet.resetCar.mock.calls.length > 0;
    }
    expect(fleet.resetCar).toHaveBeenCalledTimes(1);
    expect(onCarReset).toHaveBeenCalledTimes(1);
  });

  it("postpones the reset while another racer sits within 6m of the reset pose, then completes once clear", () => {
    const { coordinator, fleet, scene } = setup();
    coordinator.onTickBegin(0);
    coordinator.onTickBegin(180);

    scene.vehicle.body.setPosition({ x: 1000, y: 0, z: 1000 });
    fleet.bodies[1].setPosition({ x: 0, y: 0, z: 0 }); // sits exactly on gridPoses[0], car 0's no-anchor reset pose
    fleet.bodies[2].setPosition({ x: 1000, y: 0, z: 1000 });
    fleet.telemetry[0].groundSpeedMs = 0;
    fleet.telemetry[0].tiltDeg = 0;
    fleet.setLastFrameThrottle(0, 1);

    let tick = runTicks(coordinator, 181, 400);
    expect(fleet.resetCar).not.toHaveBeenCalled();

    fleet.bodies[1].setPosition({ x: 500, y: 0, z: 500 });
    let resetCalled = false;
    for (let i = 0; i < 5 && !resetCalled; i++) {
      tick = runTicks(coordinator, tick, 1);
      resetCalled = fleet.resetCar.mock.calls.length > 0;
    }
    expect(fleet.resetCar).toHaveBeenCalledTimes(1);
  });

  it("detectors are not updated before GO", () => {
    const { coordinator, fleet } = setup();
    // No onTickBegin(180) — countdown never released.
    coordinator.onTickBegin(0);
    fleet.telemetry[0].groundSpeedMs = 0;
    fleet.telemetry[0].tiltDeg = 0;
    fleet.setLastFrameThrottle(0, 1);

    for (let i = 0; i < 200; i++) {
      coordinator.onTickBegin(0);
      coordinator.onTickEnd();
    }
    expect(coordinator.snapshot().racers[0].stuck).toEqual({
      phase: "racing",
      stuckSec: 0,
      flippedSec: 0,
      noProgressSec: 0,
      recoverSec: 0,
      deferSec: 0,
    });
  });

  it("detectors are not updated for a finished AI", () => {
    const { coordinator, fleet } = setup();
    coordinator.onTickBegin(0);
    coordinator.onTickBegin(180);
    let tick = 181;
    for (let i = 0; i < course.checkpoints.length; i++) {
      fleet.bodies[0].setPosition(checkpointXYZ(i));
      tick = runTicks(coordinator, tick, 1);
    }
    expect(coordinator.snapshot().racers[0].race.complete).toBe(true);
    const finishedStuck = coordinator.snapshot().racers[0].stuck;

    fleet.telemetry[0].groundSpeedMs = 0;
    fleet.telemetry[0].tiltDeg = 0;
    fleet.setLastFrameThrottle(0, 1);
    runTicks(coordinator, tick, 200);

    expect(coordinator.snapshot().racers[0].stuck).toEqual(finishedStuck);
  });

  it("restart command restarts every detector", () => {
    const { coordinator, fleet } = setup();
    coordinator.onTickBegin(0);
    coordinator.onTickBegin(180);
    fleet.telemetry[0].groundSpeedMs = 0;
    fleet.telemetry[0].tiltDeg = 0;
    fleet.setLastFrameThrottle(0, 1);
    runTicks(coordinator, 181, 60);
    expect(coordinator.snapshot().racers[0].stuck?.stuckSec).toBeGreaterThan(0);

    coordinator.onCommands({ restart: true, respawn: false });

    for (let i = 0; i < AI_RACER_COUNT; i++) {
      expect(coordinator.snapshot().racers[i].stuck).toEqual({
        phase: "racing",
        stuckSec: 0,
        flippedSec: 0,
        noProgressSec: 0,
        recoverSec: 0,
        deferSec: 0,
      });
    }
  });
});

describe("circuit race coordinator — debugSnapshot (D-15)", () => {
  it("returns one frozen record per AI racer with racerIndex, position, target, frame and color", () => {
    const { coordinator, fleet } = setup();
    fleet.bodies[0].setPosition({ x: 5, y: 0.5, z: -5 });

    const debug = coordinator.debugSnapshot();
    expect(debug).toHaveLength(AI_RACER_COUNT);
    expect(debug[0]).toEqual({
      racerIndex: 0,
      x: 5,
      y: 0.5,
      z: -5,
      targetX: fleet.debugTargetX[0],
      targetZ: fleet.debugTargetZ[0],
      frame: BASE_FRAME,
      state: "racing",
      stuckSec: 0,
      noProgressSec: 0,
      color: AI_PAINTS[0].css,
    });
    expect(Object.isFrozen(debug)).toBe(true);
    expect(Object.isFrozen(debug[0])).toBe(true);
    for (let i = 0; i < AI_RACER_COUNT; i++) {
      expect(debug[i].racerIndex).toBe(i);
      expect(debug[i].color).toBe(AI_PAINTS[i].css);
    }
  });

  it("reads state \"avoiding\" only when avoidanceScale < 1 (racing otherwise)", () => {
    const { coordinator, fleet } = setup();
    expect(coordinator.debugSnapshot()[1].state).toBe("racing");

    fleet.avoidanceScales[1] = 0.4;
    expect(coordinator.debugSnapshot()[1].state).toBe("avoiding");
  });

  it("reads state \"recovering\" while the detector is recovering, taking priority over avoidance", () => {
    const { coordinator, fleet } = setup();
    coordinator.onTickBegin(0);
    coordinator.onTickBegin(180);

    fleet.telemetry[0].groundSpeedMs = 0;
    fleet.telemetry[0].tiltDeg = 0;
    fleet.setLastFrameThrottle(0, 1);
    fleet.avoidanceScales[0] = 0.4;

    let tick = 181;
    let recovering = false;
    for (let i = 0; i < 200 && !recovering; i++) {
      tick = runTicks(coordinator, tick, 1);
      recovering = coordinator.debugSnapshot()[0].state === "recovering";
    }
    expect(recovering).toBe(true);
  });

  it("stuckSec/noProgressSec mirror the detector's own snapshot timers", () => {
    const { coordinator, fleet } = setup();
    coordinator.onTickBegin(0);
    coordinator.onTickBegin(180);

    fleet.telemetry[0].groundSpeedMs = 0;
    fleet.telemetry[0].tiltDeg = 0;
    fleet.setLastFrameThrottle(0, 1);
    runTicks(coordinator, 181, 60);

    const debug = coordinator.debugSnapshot();
    const stuck = coordinator.snapshot().racers[0].stuck;
    expect(debug[0].stuckSec).toBe(stuck?.stuckSec);
    expect(debug[0].noProgressSec).toBe(stuck?.noProgressSec);
    expect(debug[0].stuckSec).toBeGreaterThan(0);
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
