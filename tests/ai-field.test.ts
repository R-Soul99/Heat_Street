import { describe, expect, it } from "vitest";
// Real committed artifacts, read through Vite's `?raw` transform — mirrors
// tests/ai-lap.test.ts's own fixture-loading idiom (CIRC-02 SC1/SC2/SC4).
import collisionRaw from "../public/maps/juliette-ga.collision.json?raw";
import compiledRaw from "../public/maps/juliette-ga.map.json?raw";
import medalsRaw from "../public/maps/juliette-ga.medals.json?raw";
import routesRaw from "../public/maps/juliette-ga.routes.json?raw";
import { defaultAiDriverParams } from "../src/core/ai-driver";
import { detectCheckpointHit } from "../src/core/checkpoint-detection";
import { parseCourseData } from "../src/core/course";
import { headingFromRotation } from "../src/core/heading";
import { NEUTRAL } from "../src/core/input-tape";
import { parseMapCollision } from "../src/core/map-collision";
import { parseMedalReference } from "../src/core/medal-reference";
import { buildNavigationGraph, nearestRoadNode } from "../src/core/navigation";
import { createRaceState } from "../src/core/race-state";
import { buildGridPoses, buildRacingLine, silverLapTargetSec } from "../src/core/racing-line";
import { parseRoadGraph } from "../src/core/road-graph";
import { DT } from "../src/core/sim-clock";
import { defaultSurfaceProfiles } from "../src/core/surface-tuning";
import { defaultTuning } from "../src/core/vehicle-tuning";
import { createAiFleet } from "../src/physics/ai-fleet";
import { createMapScene } from "../src/physics/map-scene";
import { sampleVehicle } from "../src/physics/vehicle";
import { createWorld } from "../src/physics/world";

const graph = parseRoadGraph(compiledRaw, "public/maps/juliette-ga.map.json");
const collision = parseMapCollision(
  collisionRaw,
  graph.areaId,
  "public/maps/juliette-ga.collision.json",
);
const routes = parseCourseData(routesRaw, "public/maps/juliette-ga.routes.json", graph);
const course = routes.courses.find((candidate) => candidate.mode === "circuit");
if (course === undefined) {
  throw new Error("ai-field.test.ts: fixture routes.json has no circuit course");
}
const medalReference = parseMedalReference(
  medalsRaw,
  "public/maps/juliette-ga.medals.json",
  routes.areaId,
  routes.courses.map((candidate) => ({
    courseId: candidate.id,
    mode: candidate.mode,
    laps: candidate.laps,
    checkpointIds: candidate.checkpoints.map((checkpoint) => checkpoint.id),
  })),
);
const reference = medalReference.courses.find((candidate) => candidate.courseId === course.id);
if (reference === undefined) {
  throw new Error("ai-field.test.ts: no medal reference for the circuit course");
}

const navigation = buildNavigationGraph(graph);

/** Consecutive-tick low-speed tracker — the "no avoidance deadlock" guard. */
function makeStuckTracker(): {
  observe(tick: number, groundSpeedMs: number): void;
  maxRun: number;
} {
  let currentRun = 0;
  let maxRun = 0;
  return {
    observe(tick: number, groundSpeedMs: number): void {
      // The grid/launch phase (first 60 ticks, 1s) is allowed to be slow —
      // cars start at rest. Only count consecutive low-speed ticks once the
      // field should be under way.
      if (tick < 60) return;
      if (groundSpeedMs < 1) {
        currentRun++;
        if (currentRun > maxRun) maxRun = currentRun;
      } else {
        currentRun = 0;
      }
    },
    get maxRun(): number {
      return maxRun;
    },
  };
}

describe("ai-field: three AI cars launched together from the real grid all complete a lap headlessly (CIRC-02, D-10)", () => {
  it("all three AI reach lap 2, never flip, and avoidance never deadlocks or leaves bounds", () => {
    const tuning = defaultTuning();
    const surfaceProfiles = defaultSurfaceProfiles();
    const line = buildRacingLine(course, navigation, surfaceProfiles);
    const grid = buildGridPoses(line, 4);
    const target = silverLapTargetSec(reference);

    const world = createWorld();
    try {
      const scene = createMapScene(world, graph, collision, tuning, surfaceProfiles);
      // Player parked at the back-most grid slot (D-03), fed NEUTRAL input
      // every tick — present purely as a physical obstacle for avoidance,
      // never as a racer this test tracks.
      scene.resetVehicle(grid[3]);

      const fleet = createAiFleet(
        world,
        tuning,
        scene.surfaces,
        line,
        grid.slice(0, 3),
        defaultAiDriverParams(tuning),
        { obstacleBodies: [scene.vehicle.body] },
      );

      const carCount = fleet.cars.length;
      const raceStates = Array.from({ length: carCount }, () =>
        createRaceState(course, navigation),
      );
      const insideMaps = Array.from({ length: carCount }, () => new Map<string, boolean>());
      const lapTicks: (number | null)[] = new Array(carCount).fill(null);
      const maxTiltDeg: number[] = new Array(carCount).fill(0);
      const stuckTrackers = Array.from({ length: carCount }, () => makeStuckTracker());
      const avoidanceActiveTicks: number[] = new Array(carCount).fill(0);
      let sampledAvoidanceCount = 0;

      const maxTicks = Math.ceil((1.5 * target) / DT);
      for (let tick = 0; tick < maxTicks; tick++) {
        fleet.tick(tick);
        scene.applyInput(NEUTRAL);
        world.step();

        for (let i = 0; i < carCount; i++) {
          const sample = sampleVehicle(fleet.cars[i].vehicle);
          maxTiltDeg[i] = Math.max(maxTiltDeg[i], sample.tiltDeg);
          stuckTrackers[i].observe(tick, sample.groundSpeedMs);

          const scale = fleet.avoidanceScale(i);
          expect(scale).toBeGreaterThanOrEqual(0);
          expect(scale).toBeLessThanOrEqual(1);
          sampledAvoidanceCount++;
          if (scale < 1) avoidanceActiveTicks[i]++;

          const frame = fleet.lastFrame(i);
          expect(frame.handbrake).toBe(false);

          const nodeId = nearestRoadNode(navigation, [
            sample.position.x,
            sample.position.y,
            sample.position.z,
          ]);
          raceStates[i].updateProgress(nodeId, headingFromRotation(sample.rotation));

          for (const checkpoint of course.checkpoints) {
            const detection = detectCheckpointHit(
              [sample.position.x, sample.position.y, sample.position.z],
              checkpoint,
              insideMaps[i].get(checkpoint.id) ?? false,
            );
            insideMaps[i].set(checkpoint.id, detection.inside);
            if (detection.hit) raceStates[i].hitCheckpoint(checkpoint.id);
          }

          if (lapTicks[i] === null && raceStates[i].snapshot().lap === 2) {
            lapTicks[i] = tick;
          }
        }

        if (lapTicks.every((t) => t !== null)) break;
      }

      for (let i = 0; i < carCount; i++) {
        const lapTimeSec = lapTicks[i] === null ? null : (lapTicks[i] as number) * DT;
        // eslint-disable-next-line no-console
        console.info(
          `ai-field.test.ts: car ${i} lap time ${lapTimeSec === null ? "DID NOT FINISH" : lapTimeSec.toFixed(2)}s, avoidance-active ticks ${avoidanceActiveTicks[i]}`,
        );
      }

      for (let i = 0; i < carCount; i++) {
        expect(lapTicks[i]).not.toBeNull();
        expect(maxTiltDeg[i]).toBeLessThan(60);
        // 3 consecutive seconds at 60 ticks/sec.
        expect(stuckTrackers[i].maxRun).toBeLessThanOrEqual(180);
      }
      expect(sampledAvoidanceCount).toBeGreaterThan(0);

      scene.dispose();
      fleet.dispose();
    } finally {
      world.free();
    }
  }, 180000);
});
