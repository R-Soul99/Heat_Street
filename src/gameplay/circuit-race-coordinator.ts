import type { CheckpointChime } from "../audio/checkpoint-chime";
import { detectCheckpointHit } from "../core/checkpoint-detection";
import type { Course } from "../core/course";
import { headingFromRotation } from "../core/heading";
import type { InputFrame } from "../core/input-tape";
import { type NavigationGraph, nearestRoadNode } from "../core/navigation";
import {
  AI_RACER_COUNT,
  COUNTDOWN_TICKS,
  type CountdownLabel,
  coastFrame,
  countdownState,
  HOLD_FRAME,
  PLAYER_GRID_SLOT,
  RACE_FIELD_SIZE,
} from "../core/race-start";
import { createRaceState, type RaceSnapshot, type RaceState } from "../core/race-state";
import { DT } from "../core/sim-clock";
import type { Minimap } from "../hud/minimap";
import type { NavigationArrow } from "../hud/navigation-arrow";
import type { RaceHud } from "../hud/race-hud";
import type { RaceCommands } from "../input/race-commands";
import type { AiFleet } from "../physics/ai-fleet";
import type { MapScene } from "../physics/map-scene";
import type { VehiclePose } from "../physics/vehicle";
import type { ObjectiveView } from "../render/objective-view";
import { poseForCheckpoint } from "./race-coordinator";

/**
 * N-racer (D-01: 4 total) orchestration for Circuit Race: a staggered-grid
 * 3-2-1-GO countdown (D-04), per-racer independent lap/checkpoint progress,
 * finished-AI coasting, full restart and player-only respawn (D-08) — a NEW
 * sibling to `race-coordinator.ts`, never a modification of it. Solo Time
 * Attack's own single-racer, start-on-first-movement flow (Phase 6 D-04) is
 * completely untouched (D-05): this file builds no `MedalTiming`, never calls
 * `saveMedalResult`, and is proven blind to the medal system by this plan's
 * own source-guard test (SC5).
 *
 * RACER INDEX TABLE (single source of truth):
 * | racer | who    | grid slot | fleet car | TransformCache / mesh index | paint         |
 * | 0     | AI     | 0 (pole)  | 0         | 1                            | AI_PAINTS[0]  |
 * | 1     | AI     | 1         | 1         | 2                            | AI_PAINTS[1]  |
 * | 2     | AI     | 2         | 2         | 3                            | AI_PAINTS[2]  |
 * | 3     | player | 3 (back)  | -         | 0                            | existing red  |
 *
 * AI wrong-way decision (07-RESEARCH.md Open Question 2, resolved here):
 * every racer's `RaceState` (including AI racers 0..2) computes its own
 * `snapshot().wrongWay` because `createRaceState` is shared code with the
 * player path — but this coordinator intentionally NEVER reads an AI racer's
 * `wrongWay` flag. `refresh()` below only ever reads the PLAYER's (racer 3)
 * snapshot for the HUD/minimap/navigation-arrow/debug-overlay consumers; no
 * short-circuit to `false` is applied, the value is simply never consulted
 * for racers 0..2.
 *
 * Layering: may import `src/core/`, `src/physics/` (types only), `src/hud/`,
 * `src/audio/` (types only) and `src/render/` (types only) — the same
 * import surface `race-coordinator.ts` already has.
 */

export interface CircuitRaceCoordinatorDeps {
  readonly course: Course;
  readonly navigation: NavigationGraph;
  readonly scene: Pick<MapScene, "vehicle" | "resetVehicle">;
  readonly fleet: Pick<AiFleet, "cars" | "tick" | "resetCar">;
  /** Length `RACE_FIELD_SIZE`. Slot `PLAYER_GRID_SLOT` is the player's grid pose; slots `0..AI_RACER_COUNT-1` are the AI grid poses, index-aligned with `fleet.cars`. */
  readonly gridPoses: readonly VehiclePose[];
  readonly objectiveView: ObjectiveView;
  readonly minimap: Minimap;
  readonly navigationArrow: NavigationArrow;
  readonly raceHud: RaceHud;
  readonly chime: CheckpointChime;
}

export interface RacerSnapshot {
  readonly racerIndex: number;
  readonly isPlayer: boolean;
  readonly race: RaceSnapshot;
  /** Sim-time seconds from GO to this racer's finish, or `null` before it finishes. Recorded once. */
  readonly finishElapsedSec: number | null;
}

export interface CircuitRaceSnapshot {
  readonly phase: "countdown" | "racing";
  readonly countdownLabel: CountdownLabel | null;
  /** Sim-time seconds since GO, 0 before GO. Derived from fixed ticks (D-04), never a wall clock. */
  readonly elapsedSec: number;
  /** Length `RACE_FIELD_SIZE`, index-aligned with the RACER INDEX TABLE above. */
  readonly racers: readonly RacerSnapshot[];
}

export interface CircuitRaceCoordinator {
  onTickBegin(tick: number): void;
  /** Returns `HOLD_FRAME` before GO, the argument unchanged after. */
  gatePlayerInput(frame: InputFrame): InputFrame;
  onTickEnd(): void;
  onCommands(commands: RaceCommands): void;
  render(): void;
  snapshot(): CircuitRaceSnapshot;
}

export function createCircuitRaceCoordinator(
  deps: CircuitRaceCoordinatorDeps,
): CircuitRaceCoordinator {
  const races: RaceState[] = Array.from({ length: RACE_FIELD_SIZE }, () =>
    createRaceState(deps.course, deps.navigation),
  );
  const insideMaps: Map<string, boolean>[] = Array.from(
    { length: RACE_FIELD_SIZE },
    () => new Map<string, boolean>(),
  );
  const finishElapsedSec: (number | null)[] = new Array(RACE_FIELD_SIZE).fill(null);

  let armedTick: number | null = null;
  let goTick: number | null = null;
  let currentTick = 0;

  /** Racer `PLAYER_GRID_SLOT` reads the scene's own vehicle body; racers `0..AI_RACER_COUNT-1` read the matching fleet car, position-for-position (RACER INDEX TABLE). */
  function racerBody(racerIndex: number): {
    translation(): { x: number; y: number; z: number };
    rotation(): { x: number; y: number; z: number; w: number };
  } {
    return racerIndex === PLAYER_GRID_SLOT
      ? deps.scene.vehicle.body
      : deps.fleet.cars[racerIndex].vehicle.body;
  }

  function currentCountdown(): {
    readonly label: CountdownLabel | null;
    readonly released: boolean;
  } {
    if (armedTick === null) return countdownState(0);
    return countdownState(currentTick - armedTick);
  }

  function computeElapsedSec(): number {
    if (goTick === null || currentTick < goTick) return 0;
    return (currentTick - goTick) * DT;
  }

  function refresh(): void {
    const playerSnapshot = races[PLAYER_GRID_SLOT].snapshot();
    const bodyPosition = deps.scene.vehicle.body.translation();
    const headingRad = headingFromRotation(deps.scene.vehicle.body.rotation());
    const remaining = deps.course.checkpoints
      .filter((checkpoint) => !playerSnapshot.visitedIds.includes(checkpoint.id))
      .map((checkpoint) => ({ x: checkpoint.position[0], z: checkpoint.position[2] }));
    const target = deps.course.checkpoints.find(
      (checkpoint) => checkpoint.id === playerSnapshot.currentTargetId,
    );
    const currentWaypoint: readonly [number, number, number] | null =
      target === undefined ? null : [target.position[0], target.position[1], target.position[2]];
    deps.objectiveView.update(playerSnapshot, deps.course.checkpoints);
    deps.minimap.update({
      player: { x: bodyPosition.x, z: bodyPosition.z },
      headingRad,
      remaining,
      target: currentWaypoint === null ? null : { x: currentWaypoint[0], z: currentWaypoint[2] },
    });
    deps.navigationArrow.update({
      carHeadingRad: headingRad,
      carPosition: [bodyPosition.x, bodyPosition.y, bodyPosition.z],
      waypoint: currentWaypoint,
    });
    deps.raceHud.update(playerSnapshot);
    deps.raceHud.showCountdown(currentCountdown().label);
  }

  function onTickBegin(tick: number): void {
    if (armedTick === null) armedTick = tick;
    const cd = countdownState(tick - armedTick);
    if (cd.released && goTick === null) goTick = armedTick + COUNTDOWN_TICKS;
    currentTick = tick;

    deps.fleet.tick(tick, (carIndex: number, base: InputFrame): InputFrame => {
      if (!cd.released) return HOLD_FRAME;
      if (races[carIndex].snapshot().complete) {
        const forwardSpeedMs = deps.fleet.cars[carIndex].vehicle.telemetry.forwardSpeedMs;
        return coastFrame(base, forwardSpeedMs);
      }
      return base;
    });
  }

  function gatePlayerInput(frame: InputFrame): InputFrame {
    return currentCountdown().released ? frame : HOLD_FRAME;
  }

  function onTickEnd(): void {
    for (let racerIndex = 0; racerIndex < RACE_FIELD_SIZE; racerIndex++) {
      const isPlayer = racerIndex === PLAYER_GRID_SLOT;
      const body = racerBody(racerIndex);
      const bodyPosition = body.translation();
      const headingRad = headingFromRotation(body.rotation());
      const nodeId = nearestRoadNode(deps.navigation, [
        bodyPosition.x,
        bodyPosition.y,
        bodyPosition.z,
      ]);
      const race = races[racerIndex];
      race.updateProgress(nodeId, headingRad);
      const insideMap = insideMaps[racerIndex];
      for (const checkpoint of deps.course.checkpoints) {
        const detection = detectCheckpointHit(
          [bodyPosition.x, bodyPosition.y, bodyPosition.z],
          checkpoint,
          insideMap.get(checkpoint.id) ?? false,
        );
        insideMap.set(checkpoint.id, detection.inside);
        if (detection.hit && race.hitCheckpoint(checkpoint.id)) {
          if (isPlayer) deps.chime.play();
          if (race.snapshot().complete && finishElapsedSec[racerIndex] === null) {
            finishElapsedSec[racerIndex] = computeElapsedSec();
          }
        }
      }
    }
    refresh();
  }

  function onCommands(commands: RaceCommands): void {
    if (commands.restart) {
      for (let racerIndex = 0; racerIndex < RACE_FIELD_SIZE; racerIndex++) {
        races[racerIndex].restart();
        insideMaps[racerIndex].clear();
        finishElapsedSec[racerIndex] = null;
      }
      deps.scene.resetVehicle(deps.gridPoses[PLAYER_GRID_SLOT]);
      for (let carIndex = 0; carIndex < AI_RACER_COUNT; carIndex++) {
        deps.fleet.resetCar(carIndex, deps.gridPoses[carIndex]);
      }
      armedTick = null;
      goTick = null;
      deps.raceHud.flashRestart();
      refresh();
      return;
    }
    if (commands.respawn) {
      const playerRace = races[PLAYER_GRID_SLOT];
      if (playerRace.snapshot().complete) return;
      const anchorId = playerRace.snapshot().respawnAnchorId;
      const anchor = deps.course.checkpoints.find((checkpoint) => checkpoint.id === anchorId);
      playerRace.respawn();
      const pose =
        anchor === undefined
          ? deps.gridPoses[PLAYER_GRID_SLOT]
          : poseForCheckpoint(anchor, deps.course, deps.navigation);
      deps.scene.resetVehicle(pose);
      insideMaps[PLAYER_GRID_SLOT].clear();
      refresh();
    }
  }

  function snapshot(): CircuitRaceSnapshot {
    const cd = currentCountdown();
    return Object.freeze({
      phase: cd.released ? "racing" : "countdown",
      countdownLabel: cd.label,
      elapsedSec: computeElapsedSec(),
      racers: Object.freeze(
        Array.from({ length: RACE_FIELD_SIZE }, (_, racerIndex) =>
          Object.freeze({
            racerIndex,
            isPlayer: racerIndex === PLAYER_GRID_SLOT,
            race: races[racerIndex].snapshot(),
            finishElapsedSec: finishElapsedSec[racerIndex],
          }),
        ),
      ),
    });
  }

  refresh();
  return { onTickBegin, gatePlayerInput, onTickEnd, onCommands, render: refresh, snapshot };
}
