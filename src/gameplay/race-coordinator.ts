import type { CheckpointChime } from "../audio/checkpoint-chime";
import type { CheckpointDetectionResult } from "../core/checkpoint-detection";
import { detectCheckpointHit } from "../core/checkpoint-detection";
import type { Course, CourseCheckpoint } from "../core/course";
import { findRoadPath, type NavigationGraph, nearestRoadNode } from "../core/navigation";
import type { RaceSnapshot, RaceState } from "../core/race-state";
import type { Minimap } from "../hud/minimap";
import { type NavigationArrow, nextRoadWaypoint } from "../hud/navigation-arrow";
import type { RaceHud } from "../hud/race-hud";
import type { RaceCommands } from "../input/race-commands";
import type { MapScene } from "../physics/map-scene";
import type { ObjectiveView } from "../render/objective-view";

export interface RaceCoordinatorDeps {
  readonly course: Course;
  readonly navigation: NavigationGraph;
  readonly scene: MapScene;
  readonly state: RaceState;
  readonly objectiveView: ObjectiveView;
  readonly minimap: Minimap;
  readonly navigationArrow: NavigationArrow;
  readonly raceHud: RaceHud;
  readonly chime: CheckpointChime;
  readonly simTimeSec: () => number;
}

export interface RaceCoordinator {
  onTickEnd(): void;
  onCommands(commands: RaceCommands): void;
  render(): void;
  snapshot(): RaceSnapshot;
}

function headingFromRotation(rotation: { x: number; y: number; z: number; w: number }): number {
  const forwardX = 2 * (rotation.x * rotation.z + rotation.w * rotation.y);
  const forwardZ = 1 - 2 * (rotation.x * rotation.x + rotation.y * rotation.y);
  return Math.atan2(forwardX, -forwardZ);
}

function poseForCheckpoint(
  checkpoint: CourseCheckpoint,
  course: Course,
  navigation: NavigationGraph,
): { x: number; y: number; z: number; headingRad: number } {
  const checkpointIndex = course.checkpoints.findIndex((item) => item.id === checkpoint.id);
  const next = course.checkpoints[(checkpointIndex + 1) % course.checkpoints.length];
  const path = next === undefined ? [] : findRoadPath(navigation, checkpoint.nodeId, next.nodeId);
  const from = navigation.roadGraph.nodes.find((node) => node.id === path[0]);
  const to = navigation.roadGraph.nodes.find((node) => node.id === path[1]);
  const headingRad =
    from === undefined || to === undefined
      ? course.start.headingRad
      : Math.atan2(to.z - from.z, to.x - from.x);
  return {
    x: checkpoint.position[0],
    y: checkpoint.position[1] + 0.6,
    z: checkpoint.position[2],
    headingRad,
  };
}

export function createRaceCoordinator(deps: RaceCoordinatorDeps): RaceCoordinator {
  const inside = new Map<string, boolean>();
  let latest: RaceSnapshot = deps.state.snapshot();
  let currentWaypoint: readonly [number, number, number] | null = null;

  function refresh(): void {
    latest = deps.state.snapshot();
    const bodyPosition = deps.scene.vehicle.body.translation();
    const remaining = deps.course.checkpoints
      .filter((checkpoint) => !latest.visitedIds.includes(checkpoint.id))
      .map((checkpoint) => ({ x: checkpoint.position[0], z: checkpoint.position[2] }));
    const nodeId = nearestRoadNode(deps.navigation, [
      bodyPosition.x,
      bodyPosition.y,
      bodyPosition.z,
    ]);
    const target = deps.course.checkpoints.find(
      (checkpoint) => checkpoint.id === latest.currentTargetId,
    );
    currentWaypoint =
      target === undefined
        ? null
        : nextRoadWaypoint(
            findRoadPath(deps.navigation, nodeId, target.nodeId),
            deps.navigation.roadGraph,
          );
    deps.objectiveView.update(latest, deps.course.checkpoints);
    deps.minimap.update({
      player: { x: bodyPosition.x, z: bodyPosition.z },
      headingRad: headingFromRotation(deps.scene.vehicle.body.rotation()),
      remaining,
    });
    deps.navigationArrow.update({
      carHeadingRad: headingFromRotation(deps.scene.vehicle.body.rotation()),
      carPosition: [bodyPosition.x, bodyPosition.y, bodyPosition.z],
      waypoint: currentWaypoint,
    });
    deps.raceHud.update(latest);
  }

  function onTickEnd(): void {
    const bodyPosition = deps.scene.vehicle.body.translation();
    const headingRad = headingFromRotation(deps.scene.vehicle.body.rotation());
    const nodeId = nearestRoadNode(deps.navigation, [
      bodyPosition.x,
      bodyPosition.y,
      bodyPosition.z,
    ]);
    deps.state.updateProgress(nodeId, headingRad);
    for (const checkpoint of deps.course.checkpoints) {
      const detection: CheckpointDetectionResult = detectCheckpointHit(
        [bodyPosition.x, bodyPosition.y, bodyPosition.z],
        checkpoint,
        inside.get(checkpoint.id) ?? false,
      );
      inside.set(checkpoint.id, detection.inside);
      if (detection.hit && deps.state.hitCheckpoint(checkpoint.id)) deps.chime.play();
    }
    refresh();
  }

  function onCommands(commands: RaceCommands): void {
    if (commands.restart) {
      deps.state.restart();
      inside.clear();
      deps.scene.resetVehicle(deps.scene.defaultSpawnPose);
      deps.raceHud.flashRestart();
      refresh();
      return;
    }
    if (commands.respawn) {
      const anchorId = deps.state.snapshot().respawnAnchorId;
      const anchor = deps.course.checkpoints.find((checkpoint) => checkpoint.id === anchorId);
      deps.state.respawn();
      deps.scene.resetVehicle(
        anchor === undefined
          ? deps.scene.defaultSpawnPose
          : poseForCheckpoint(anchor, deps.course, deps.navigation),
      );
      inside.clear();
      refresh();
    }
  }

  refresh();
  return {
    onTickEnd,
    onCommands,
    render: refresh,
    snapshot(): RaceSnapshot {
      return latest;
    },
  };
}
