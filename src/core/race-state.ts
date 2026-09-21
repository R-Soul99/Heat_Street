import type { Course, CourseCheckpoint } from "./course";
import { findRoadPath, type NavigationGraph } from "./navigation";

/** A flat retry cost keeps recovery predictable without rewinding the sim clock. */
export const RESPAWN_PENALTY_SEC = 5;
export const WRONG_WAY_ENTER_RAD = (5 * Math.PI) / 6;
export const WRONG_WAY_EXIT_RAD = (2 * Math.PI) / 3;

export interface RaceSnapshot {
  readonly mode: Course["mode"];
  readonly currentTargetId: string | null;
  readonly visitedIds: readonly string[];
  readonly lap: number;
  readonly totalLaps: number;
  readonly complete: boolean;
  readonly wrongWay: boolean;
  readonly respawnAnchorId: string | null;
  readonly penaltySec: number;
}

export interface RaceState {
  snapshot(): RaceSnapshot;
  updateProgress(currentNodeId: number, headingRad: number): void;
  hitCheckpoint(checkpointId: string): boolean;
  effectiveTimeSec(simTimeSec: number): number;
  respawn(): void;
  restart(): void;
}

function angleDifference(a: number, b: number): number {
  let difference = Math.abs(a - b) % (Math.PI * 2);
  if (difference > Math.PI) difference = Math.PI * 2 - difference;
  return difference;
}

function pathCost(navigation: NavigationGraph, path: readonly number[]): number {
  let cost = 0;
  for (let index = 0; index < path.length - 1; index++) {
    const link = navigation.graph.getLink(path[index], path[index + 1]);
    if (link === undefined) return Number.POSITIVE_INFINITY;
    cost += link.data.weight;
  }
  return cost;
}

function headingToNext(
  navigation: NavigationGraph,
  currentNodeId: number,
  checkpoint: CourseCheckpoint,
): number | null {
  const path = findRoadPath(navigation, currentNodeId, checkpoint.nodeId);
  if (path.length < 2) return null;
  const from = navigation.roadGraph.nodes.find((node) => node.id === path[0]);
  const to = navigation.roadGraph.nodes.find((node) => node.id === path[1]);
  if (from === undefined || to === undefined) return null;
  return Math.atan2(to.z - from.z, to.x - from.x);
}

function immutableSnapshot(snapshot: RaceSnapshot): RaceSnapshot {
  return Object.freeze({ ...snapshot, visitedIds: Object.freeze([...snapshot.visitedIds]) });
}

export function createRaceState(course: Course, navigation: NavigationGraph): RaceState {
  let currentNodeId = course.start.nodeId;
  let currentTargetId: string | null = course.checkpoints[0]?.id ?? null;
  let visitedIds: string[] = [];
  let lap = 1;
  let complete = false;
  let wrongWay = false;
  let respawnAnchorId: string | null = null;
  let penaltySec = 0;
  let headingRad = course.start.headingRad;

  function checkpointById(checkpointId: string): CourseCheckpoint | undefined {
    return course.checkpoints.find((checkpoint) => checkpoint.id === checkpointId);
  }

  function selectP2PTarget(): void {
    if (complete) {
      currentTargetId = null;
      return;
    }
    let best: { id: string; cost: number; index: number } | undefined;
    course.checkpoints.forEach((checkpoint, index) => {
      if (visitedIds.includes(checkpoint.id)) return;
      const cost = pathCost(navigation, findRoadPath(navigation, currentNodeId, checkpoint.nodeId));
      if (best === undefined || cost < best.cost || (cost === best.cost && index < best.index)) {
        best = { id: checkpoint.id, cost, index };
      }
    });
    currentTargetId = best?.id ?? null;
  }

  function updateWrongWay(): void {
    if (course.mode !== "circuit" || complete) {
      wrongWay = false;
      return;
    }
    const nextCheckpoint =
      course.checkpoints[course.checkpoints.findIndex((item) => item.id === currentTargetId)];
    if (nextCheckpoint === undefined) {
      wrongWay = false;
      return;
    }
    const desiredHeading = headingToNext(navigation, currentNodeId, nextCheckpoint);
    if (desiredHeading === null) {
      wrongWay = false;
      return;
    }
    const difference = angleDifference(headingRad, desiredHeading);
    wrongWay = wrongWay ? difference >= WRONG_WAY_EXIT_RAD : difference >= WRONG_WAY_ENTER_RAD;
  }

  function snapshot(): RaceSnapshot {
    return immutableSnapshot({
      mode: course.mode,
      currentTargetId,
      visitedIds,
      lap,
      totalLaps: course.laps,
      complete,
      wrongWay,
      respawnAnchorId,
      penaltySec,
    });
  }

  function updateProgress(nextNodeId: number, nextHeadingRad: number): void {
    if (!Number.isInteger(nextNodeId) || !Number.isFinite(nextHeadingRad)) return;
    if (!navigation.graph.hasNode(nextNodeId)) return;
    currentNodeId = nextNodeId;
    headingRad = nextHeadingRad;
    if (course.mode === "p2p") selectP2PTarget();
    updateWrongWay();
  }

  function hitCheckpoint(checkpointId: string): boolean {
    if (complete) return false;
    const checkpoint = checkpointById(checkpointId);
    if (checkpoint === undefined) return false;
    if (course.mode === "circuit" && checkpoint.id !== currentTargetId) return false;
    if (visitedIds.includes(checkpointId)) return false;

    visitedIds = [...visitedIds, checkpointId];
    respawnAnchorId = checkpointId;
    if (course.mode === "p2p") {
      if (visitedIds.length === course.checkpoints.length) complete = true;
      selectP2PTarget();
    } else {
      const checkpointIndex = course.checkpoints.findIndex((item) => item.id === checkpointId);
      if (checkpointIndex === course.checkpoints.length - 1) {
        if (lap === course.laps) {
          complete = true;
          currentTargetId = null;
        } else {
          lap++;
          visitedIds = [];
          currentTargetId = course.checkpoints[0]?.id ?? null;
        }
      } else {
        currentTargetId = course.checkpoints[checkpointIndex + 1]?.id ?? null;
      }
      updateWrongWay();
    }
    return true;
  }

  function effectiveTimeSec(simTimeSec: number): number {
    if (!Number.isFinite(simTimeSec)) return penaltySec;
    return simTimeSec + penaltySec;
  }

  function respawn(): void {
    penaltySec += RESPAWN_PENALTY_SEC;
  }

  function restart(): void {
    currentNodeId = course.start.nodeId;
    currentTargetId = course.checkpoints[0]?.id ?? null;
    visitedIds = [];
    lap = 1;
    complete = false;
    wrongWay = false;
    respawnAnchorId = null;
    penaltySec = 0;
    headingRad = course.start.headingRad;
  }

  return { snapshot, updateProgress, hitCheckpoint, effectiveTimeSec, respawn, restart };
}
