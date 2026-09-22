import { describe, expect, it } from "vitest";
// Real committed artifacts, read through Vite's `?raw` transform — the same
// idiom `tests/map-scene.test.ts`/`tests/route-validation.test.ts` use.
// Proving one AI car laps the REAL compiled Juliette circuit (not a synthetic
// fixture) headlessly is this task's whole point (CIRC-02 SC1/SC2/SC4).
import collisionRaw from "../public/maps/juliette-ga.collision.json?raw";
import compiledRaw from "../public/maps/juliette-ga.map.json?raw";
import medalsRaw from "../public/maps/juliette-ga.medals.json?raw";
import routesRaw from "../public/maps/juliette-ga.routes.json?raw";
import { headingFromRotation } from "../src/core/heading";
import { NEUTRAL } from "../src/core/input-tape";
import { parseMapCollision } from "../src/core/map-collision";
import { parseMedalReference } from "../src/core/medal-reference";
import { buildNavigationGraph, nearestRoadNode } from "../src/core/navigation";
// Task 2 output — does not exist until then. This import is what makes this
// whole file fail to resolve (RED) until Task 2/3 land.
import {
  buildGridPoses,
  buildRacingLine,
  silverLapTargetSec,
} from "../src/core/racing-line";
import { parseCourseData } from "../src/core/course";
import { createRaceState } from "../src/core/race-state";
import { parseRoadGraph } from "../src/core/road-graph";
import { DT } from "../src/core/sim-clock";
import { defaultSurfaceProfiles } from "../src/core/surface-tuning";
import { detectCheckpointHit } from "../src/core/checkpoint-detection";
import { defaultTuning } from "../src/core/vehicle-tuning";
// Task 3 output — does not exist until then. This import is what makes this
// whole file fail to resolve (RED) until Task 3 lands.
import { defaultAiDriverParams } from "../src/core/ai-driver";
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
  throw new Error("ai-lap.test.ts: fixture routes.json has no circuit course");
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
  throw new Error("ai-lap.test.ts: no medal reference for the circuit course");
}

const navigation = buildNavigationGraph(graph);

describe("ai-lap: one AI car completes lap 1 of juliette-three-lap-loop within the Silver band (CIRC-02 SC1/SC2/SC4)", () => {
  it(
    "reaches lap 2 (i.e. completes lap 1) at a lap time within +/-6% of Silver pace, never flips, and steers quietly on straights",
    () => {
      const tuning = defaultTuning();
      const surfaceProfiles = defaultSurfaceProfiles();
      const line = buildRacingLine(course, navigation, surfaceProfiles);
      const grid = buildGridPoses(line, 4);
      const target = silverLapTargetSec(reference);

      const world = createWorld();
      try {
        const scene = createMapScene(world, graph, collision, tuning, surfaceProfiles);
        // Park the player car behind the field so it never interferes with
        // the AI car's own lap — grid slot 3 is the back-most slot (D-03's
        // eventual player slot, reused here purely as an out-of-the-way park).
        scene.resetVehicle(grid[3]);

        const fleet = createAiFleet(
          world,
          tuning,
          scene.surfaces,
          line,
          [grid[0]],
          defaultAiDriverParams(tuning),
        );

        const raceState = createRaceState(course, navigation);
        const inside = new Map<string, boolean>();

        let lapTick: number | null = null;
        let maxTiltDeg = 0;
        let straightSteerSum = 0;
        let straightSteerCount = 0;
        let sawHandbrake = false;
        let sawThrottleAndBrake = false;

        const maxTicks = Math.ceil((1.5 * target) / DT);
        for (let tick = 0; tick < maxTicks; tick++) {
          fleet.tick(tick);
          scene.applyInput(NEUTRAL);
          world.step();

          const sample = sampleVehicle(fleet.cars[0].vehicle);
          maxTiltDeg = Math.max(maxTiltDeg, sample.tiltDeg);

          const nodeId = nearestRoadNode(navigation, [
            sample.position.x,
            sample.position.y,
            sample.position.z,
          ]);
          raceState.updateProgress(nodeId, headingFromRotation(sample.rotation));

          for (const checkpoint of course.checkpoints) {
            const detection = detectCheckpointHit(
              [sample.position.x, sample.position.y, sample.position.z],
              checkpoint,
              inside.get(checkpoint.id) ?? false,
            );
            inside.set(checkpoint.id, detection.inside);
            if (detection.hit) raceState.hitCheckpoint(checkpoint.id);
          }

          if (lapTick === null && raceState.snapshot().lap === 2) {
            lapTick = tick;
          }

          const frame = fleet.lastFrame(0);
          if (frame.handbrake) sawHandbrake = true;
          if (frame.throttle > 0 && frame.brake > 0) sawThrottleAndBrake = true;

          const debug = fleet.cars[0].driver.debug();
          const point = line.points[debug.lineIndex];
          if (point !== undefined && point.curvature < 0.002) {
            straightSteerSum += Math.abs(frame.steer);
            straightSteerCount++;
          }

          if (lapTick !== null) break;
        }

        expect(lapTick).not.toBeNull();
        if (lapTick === null) return;

        const lapTimeSec = lapTick * DT;
        // Printed so Task 3's calibration step can read the measured figure
        // directly from `npx vitest run tests/ai-lap.test.ts` output.
        // eslint-disable-next-line no-console
        console.info(
          `ai-lap.test.ts: measured one-lap time ${lapTimeSec.toFixed(2)}s, Silver target ${target.toFixed(2)}s`,
        );
        expect(Math.abs(lapTimeSec / target - 1)).toBeLessThanOrEqual(0.06);
        expect(maxTiltDeg).toBeLessThan(45);
        expect(sawHandbrake).toBe(false);
        expect(sawThrottleAndBrake).toBe(false);
        if (straightSteerCount > 0) {
          expect(straightSteerSum / straightSteerCount).toBeLessThan(0.12);
        }

        scene.dispose();
        fleet.dispose();
      } finally {
        world.free();
      }
    },
    120000,
  );
});
