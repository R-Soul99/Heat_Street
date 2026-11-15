/**
 * Headless Circuit Race harness on the CURRENT terrain Juliette (07-07 pace
 * rework): loads public/maps/juliette-ga.terrain.{bin,json} + routes +
 * medals exactly as src/main.ts does for `?mode=circuit-race`, builds the
 * racing line, grid (seated on the heightfield), and an AI fleet driving the
 * shipped car, then steps the world at the fixed 60 Hz tick.
 *
 * No player input: the player car is parked on its grid slot (or moved out
 * of the way) so it never interferes. Used by tests/ai-lap-terrain.test.ts.
 */
import { readFileSync } from "node:fs";
import { type AiDriverParams, defaultAiDriverParams } from "../../src/core/ai-driver";
import { detectCheckpointHit } from "../../src/core/checkpoint-detection";
import { type Course, parseCourseData } from "../../src/core/course";
import { shippedTuning } from "../../src/core/feel";
import { headingFromRotation } from "../../src/core/heading";
import { NEUTRAL } from "../../src/core/input-tape";
import { type MedalReferenceCourse, parseMedalReference } from "../../src/core/medal-reference";
import {
  buildNavigationGraph,
  type NavigationGraph,
  nearestRoadNode,
} from "../../src/core/navigation";
import { createRaceState } from "../../src/core/race-state";
import {
  buildGridPoses,
  buildRacingLine,
  DEFAULT_RACING_LINE_PARAMS,
  type RacingLine,
  type RacingLineParams,
} from "../../src/core/racing-line";
import { DT } from "../../src/core/sim-clock";
import { defaultSurfaceProfiles } from "../../src/core/surface-tuning";
import { crestsFromObjects, physicsGridForArea } from "../../src/core/terrain-drive-setup";
import { loadTerrainArea } from "../../src/core/terrain-format";
import { sampleTerrainHeight } from "../../src/core/terrain-grid";
import { createAiFleet } from "../../src/physics/ai-fleet";
import { SPAWN_CLEARANCE_M } from "../../src/physics/map-scene";
import { createTerrainScene } from "../../src/physics/terrain-scene";
import { sampleVehicle } from "../../src/physics/vehicle";
import { createWorld } from "../../src/physics/world";

export interface TerrainRaceContext {
  readonly course: Course;
  readonly navigation: NavigationGraph;
  readonly reference: MedalReferenceCourse;
  readonly area: Awaited<ReturnType<typeof loadTerrainArea>>;
}

export async function loadTerrainJuliette(): Promise<TerrainRaceContext> {
  const bin = new Uint8Array(readFileSync("public/maps/juliette-ga.terrain.bin"));
  const json = readFileSync("public/maps/juliette-ga.terrain.json", "utf8");
  const area = await loadTerrainArea(bin, json, "juliette-ga", "juliette-ga.terrain");
  const routes = parseCourseData(
    readFileSync("public/maps/juliette-ga.routes.json", "utf8"),
    "public/maps/juliette-ga.routes.json",
    area.graph,
  );
  const course = routes.courses.find((candidate) => candidate.mode === "circuit");
  if (course === undefined) throw new Error("terrain-race-harness: no circuit course");
  const medals = parseMedalReference(
    readFileSync("public/maps/juliette-ga.medals.json", "utf8"),
    "public/maps/juliette-ga.medals.json",
    routes.areaId,
    routes.courses.map((candidate) => ({
      courseId: candidate.id,
      mode: candidate.mode,
      laps: candidate.laps,
      checkpointIds: candidate.checkpoints.map((checkpoint) => checkpoint.id),
    })),
  );
  const reference = medals.courses.find((candidate) => candidate.courseId === course.id);
  if (reference === undefined) throw new Error("terrain-race-harness: no circuit reference");
  return { course, navigation: buildNavigationGraph(area.graph), reference, area };
}

export interface RacerResult {
  /** Sim seconds from tick 0 at which each lap completed (index 0 = lap 1). */
  readonly lapDoneSec: number[];
  maxTiltDeg: number;
  straightSteerSum: number;
  straightSteerCount: number;
  /** Mean |steer change| per tick on straights — the "weave" signal. */
  straightSteerDeltaSum: number;
  maxLowSpeedRunTicks: number;
  sawHandbrake: boolean;
  sawThrottleAndBrake: boolean;
  /** Max lateral distance from the racing line point the driver tracks, metres. */
  maxOffLineM: number;
  /** Max distance beyond the carriageway edge (centreline distance minus half width), metres; 0 = never left the road. */
  maxOutsideRoadM: number;
  /** Where `maxOutsideRoadM` happened: racing-line arc, metres, and lap. */
  maxOutsideAtArcM: number;
}

export interface RunOptions {
  readonly cars: number;
  readonly laps: number;
  readonly lineParams?: Partial<RacingLineParams>;
  readonly driverParams?: Partial<AiDriverParams>;
  readonly maxSec: number;
  /** Optional per-tick probe (diagnostics only). */
  readonly onSample?: (carIndex: number, tick: number, info: TickInfo) => void;
}

export interface TickInfo {
  readonly arcM: number;
  readonly lap: number;
  /** Signed lateral offset from the road centreline, metres (+ = left of travel). */
  readonly lateralM: number;
  readonly halfWidthM: number;
  readonly speedMs: number;
  readonly steer: number;
  readonly throttle: number;
  readonly brake: number;
  readonly tiltDeg: number;
}

export interface RunResult {
  readonly line: RacingLine;
  readonly racers: RacerResult[];
}

export function runTerrainRace(ctx: TerrainRaceContext, options: RunOptions): RunResult {
  const tuning = shippedTuning("rwd");
  const surfaceProfiles = defaultSurfaceProfiles();
  const line = buildRacingLine(ctx.course, ctx.navigation, surfaceProfiles, {
    ...DEFAULT_RACING_LINE_PARAMS,
    ...options.lineParams,
  });
  const grid = physicsGridForArea(ctx.area);
  const poses = buildGridPoses(line, 4).map((pose) => ({
    ...pose,
    y: sampleTerrainHeight(grid, pose.x, pose.z) + SPAWN_CLEARANCE_M,
  }));

  const world = createWorld();
  try {
    const scene = createTerrainScene(
      world,
      {
        areaId: "juliette-ga",
        grid,
        paint: ctx.area.paint,
        graph: ctx.area.graph,
        buildings: ctx.area.buildings,
        crests: crestsFromObjects(ctx.area.objects),
        groundSurface: ctx.area.groundSurface,
      },
      tuning,
      surfaceProfiles,
    );
    scene.resetVehicle(poses[3]);
    const fleet = createAiFleet(
      world,
      tuning,
      scene.surfaces,
      line,
      poses.slice(0, options.cars),
      { ...defaultAiDriverParams(tuning), ...options.driverParams },
      {
        obstacleBodies: [scene.vehicle.body],
        wheelRayPatch: scene.createWheelRayPatch?.bind(scene),
      },
    );
    const races = fleet.cars.map(() => createRaceState(ctx.course, ctx.navigation));
    const insides = fleet.cars.map(() => new Map<string, boolean>());
    const results: RacerResult[] = fleet.cars.map(() => ({
      lapDoneSec: [],
      maxTiltDeg: 0,
      straightSteerSum: 0,
      straightSteerCount: 0,
      straightSteerDeltaSum: 0,
      maxLowSpeedRunTicks: 0,
      sawHandbrake: false,
      sawThrottleAndBrake: false,
      maxOffLineM: 0,
      maxOutsideRoadM: 0,
      maxOutsideAtArcM: 0,
    }));
    const lowRun = fleet.cars.map(() => 0);
    const lastSteer = fleet.cars.map(() => 0);

    const maxTicks = Math.ceil(options.maxSec / DT);
    for (let tick = 0; tick < maxTicks; tick++) {
      fleet.tick(tick, (i, base) =>
        races[i].snapshot().complete ? { ...base, throttle: 0 } : base,
      );
      scene.applyInput(NEUTRAL);
      world.step();
      let allDone = true;
      for (let i = 0; i < fleet.cars.length; i++) {
        const race = races[i];
        const result = results[i];
        if (race.snapshot().complete) continue;
        allDone = false;
        const sample = sampleVehicle(fleet.cars[i].vehicle);
        result.maxTiltDeg = Math.max(result.maxTiltDeg, sample.tiltDeg);
        const pos = sample.position;
        race.updateProgress(
          nearestRoadNode(ctx.navigation, [pos.x, pos.y, pos.z]),
          headingFromRotation(sample.rotation),
        );
        const lapBefore = race.snapshot().lap;
        for (const checkpoint of ctx.course.checkpoints) {
          const detection = detectCheckpointHit(
            [pos.x, pos.y, pos.z],
            checkpoint,
            insides[i].get(checkpoint.id) ?? false,
          );
          insides[i].set(checkpoint.id, detection.inside);
          if (detection.hit) race.hitCheckpoint(checkpoint.id);
        }
        const after = race.snapshot();
        if (after.lap > lapBefore || (after.complete && result.lapDoneSec.length < options.laps)) {
          result.lapDoneSec.push((tick + 1) * DT);
        }
        const frame = fleet.lastFrame(i);
        if (frame.handbrake) result.sawHandbrake = true;
        if (frame.throttle > 0 && frame.brake > 0) result.sawThrottleAndBrake = true;
        const debug = fleet.cars[i].driver.debug();
        const point = line.points[debug.lineIndex];
        if (point !== undefined) {
          result.maxOffLineM = Math.max(
            result.maxOffLineM,
            Math.hypot(point.x - pos.x, point.z - pos.z),
          );
          const outside =
            Math.hypot(point.centreX - pos.x, point.centreZ - pos.z) - point.halfWidthM;
          if (tick > 120 && outside > result.maxOutsideRoadM) {
            result.maxOutsideRoadM = outside;
            result.maxOutsideAtArcM = point.arcM;
          }
          if (point.curvature < 0.002 && tick > 120) {
            result.straightSteerSum += Math.abs(frame.steer);
            result.straightSteerDeltaSum += Math.abs(frame.steer - lastSteer[i]);
            result.straightSteerCount++;
          }
        }
        lastSteer[i] = frame.steer;
        if (options.onSample !== undefined && point !== undefined) {
          const next = line.points[(debug.lineIndex + 1) % line.points.length];
          const tx = next.centreX - point.centreX;
          const tz = next.centreZ - point.centreZ;
          const tl = Math.hypot(tx, tz) || 1;
          const lateralM = ((pos.x - point.centreX) * -tz + (pos.z - point.centreZ) * tx) / tl;
          options.onSample(i, tick, {
            arcM: point.arcM,
            lap: after.lap,
            lateralM,
            halfWidthM: point.halfWidthM,
            speedMs: sample.forwardSpeedMs,
            steer: frame.steer,
            throttle: frame.throttle,
            brake: frame.brake,
            tiltDeg: sample.tiltDeg,
          });
        }
        if (tick > 300 && sample.groundSpeedMs < 1) {
          lowRun[i]++;
          result.maxLowSpeedRunTicks = Math.max(result.maxLowSpeedRunTicks, lowRun[i]);
        } else {
          lowRun[i] = 0;
        }
      }
      if (allDone) break;
    }
    scene.dispose();
    fleet.dispose();
    return { line, racers: results };
  } finally {
    world.free();
  }
}
