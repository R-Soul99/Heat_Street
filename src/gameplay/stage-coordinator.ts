import type { CheckpointChime } from "../audio/checkpoint-chime";
import { headingFromRotation } from "../core/heading";
import type {
  FrozenCompletion,
  Medal,
  MedalTiming,
  MedalTimingSnapshot,
} from "../core/medal-timing";
import type { RaceSnapshot } from "../core/race-state";
import type { Stage, StageHudModel } from "../core/stage";
import { classifyStageMedal } from "../core/stage";
import type { StageBestRecord } from "../core/stage-persistence";
import {
  FINISH_GATE_ID,
  type StageRun,
  type StageSplitTone,
  stageSplitLine,
} from "../core/stage-run";
import type { Minimap } from "../hud/minimap";
import type { NavigationArrow } from "../hud/navigation-arrow";
import type { RaceCommands } from "../input/race-commands";
import type { MapScene } from "../physics/map-scene";
import type { RaceCoordinator } from "./race-coordinator";

/** Implemented by RaceHud (plan 10-05). */
export interface StageHudPort {
  update(snapshot: RaceSnapshot, timing?: MedalTimingSnapshot): void;
  flashRestart(): void;
  showStageInfo(model: StageHudModel | null): void;
  flashStageSplit(text: string, tone: StageSplitTone): void;
}

/** Implemented by StageView (plan 10-05). */
export interface StageGatePort {
  update(nextGateIndex: number | null): void;
}

export interface StageCompletion {
  readonly completion: FrozenCompletion;
  readonly penaltySec: number;
  readonly medal: Medal;
  readonly splitsSec: readonly number[];
}

export interface StageCoordinatorDeps {
  readonly stage: Stage;
  readonly run: StageRun;
  readonly scene: MapScene;
  readonly heightAt: (x: number, z: number) => number;
  readonly stageView: StageGatePort;
  readonly minimap: Minimap;
  readonly navigationArrow: NavigationArrow;
  readonly raceHud: StageHudPort;
  readonly chime: CheckpointChime;
  readonly simTimeSec: () => number;
  readonly timing: MedalTiming;
  readonly personalBest?: StageBestRecord;
  readonly medalsActive: boolean;
  readonly onCompleted?: (result: StageCompletion) => void;
  readonly onRestart?: () => void;
  readonly onCarReset?: () => void;
}

const ARROW_LIFT_M = 2;

export function createStageCoordinator(deps: StageCoordinatorDeps): RaceCoordinator {
  const { stage, run } = deps;
  const totalGates = stage.gates.length + 1;
  let latest: RaceSnapshot;
  let latestTiming: MedalTimingSnapshot = deps.timing.snapshot();
  let published: FrozenCompletion | null = null;

  function buildSnapshot(): RaceSnapshot {
    const s = run.snapshot();
    const visitedIds = stage.gates.slice(0, s.gatesPassed).map((g) => g.id);
    if (s.complete) visitedIds.push(FINISH_GATE_ID);
    return {
      mode: "stage",
      currentTargetId: s.targetId,
      visitedIds,
      lap: 1,
      totalLaps: 1,
      complete: s.complete,
      wrongWay: false,
      respawnAnchorId: s.lastPassed?.id ?? null,
      penaltySec: s.penaltySec,
      totalGates,
      label: stage.name,
    };
  }

  function refresh(): void {
    const s = run.snapshot();
    latest = buildSnapshot();
    const body = deps.scene.vehicle.body;
    const position = body.translation();
    const heading = headingFromRotation(body.rotation());
    const remaining = stage.gates.slice(s.nextGateIndex).map((g) => ({ x: g.x, z: g.z }));
    if (!s.complete) remaining.push({ x: stage.finish.x, z: stage.finish.z });
    const target =
      s.targetPosition === null ? null : { x: s.targetPosition.x, z: s.targetPosition.z };
    deps.stageView.update(s.complete ? totalGates : s.nextGateIndex);
    deps.minimap.update({
      player: { x: position.x, z: position.z },
      headingRad: heading,
      remaining,
      target,
    });
    deps.navigationArrow.update({
      carHeadingRad: heading,
      carPosition: [position.x, position.y, position.z],
      waypoint:
        target === null
          ? null
          : [target.x, deps.heightAt(target.x, target.z) + ARROW_LIFT_M, target.z],
    });
    deps.raceHud.update(latest, latestTiming);
  }

  function onTickEnd(): void {
    const body = deps.scene.vehicle.body;
    const position = body.translation();
    const velocity = body.linvel();
    const simTime = deps.simTimeSec();
    latestTiming = deps.timing.update({
      simTimeSec: simTime,
      speedMs: deps.scene.vehicle.telemetry.groundSpeedMs,
      penaltySec: run.snapshot().penaltySec,
    });
    const result = run.update({
      x: position.x,
      y: position.y,
      z: position.z,
      vx: velocity.x,
      vz: velocity.z,
    });
    if (result.passedGateId !== undefined) {
      latestTiming = deps.timing.recordCheckpoint(simTime, {
        checkpointId: result.passedGateId,
        fromCheckpointId: latestTiming.sectors.at(-1)?.checkpointId ?? null,
        lap: 1,
        ordinal: latestTiming.sectors.length,
      });
      deps.chime.play();
      const newest = latestTiming.sectors.at(-1);
      if (newest !== undefined) {
        const gateIndex = stage.gates.findIndex((g) => g.id === result.passedGateId);
        const label = result.passedGateId === FINISH_GATE_ID ? "FIN" : `G${gateIndex + 1}`;
        const line = stageSplitLine(
          label,
          newest.cumulativeElapsedSec,
          deps.personalBest?.splitsSec[newest.ordinal],
        );
        deps.raceHud.flashStageSplit(line.text, line.tone);
      }
    }
    if (result.finished === true) {
      deps.chime.play();
      latestTiming = deps.timing.recordCheckpoint(simTime, {
        checkpointId: FINISH_GATE_ID,
        fromCheckpointId: latestTiming.sectors.at(-1)?.checkpointId ?? null,
        lap: 1,
        ordinal: latestTiming.sectors.length,
      });
      const newest = latestTiming.sectors.at(-1);
      if (newest !== undefined) {
        const line = stageSplitLine(
          "FIN",
          newest.cumulativeElapsedSec,
          deps.personalBest?.splitsSec[newest.ordinal],
        );
        deps.raceHud.flashStageSplit(line.text, line.tone);
      }
      latestTiming = deps.timing.complete(simTime);
      if (latestTiming.completion !== null && published === null) {
        published = latestTiming.completion;
        const medal = deps.medalsActive
          ? classifyStageMedal(published.effectiveTimeSec, stage.medals)
          : "none";
        deps.onCompleted?.({
          completion: published,
          penaltySec: run.snapshot().penaltySec,
          medal,
          splitsSec: published.sectors.map((sector) => sector.cumulativeElapsedSec),
        });
      }
    }
    refresh();
  }

  function onCommands(commands: RaceCommands): void {
    if (commands.restart) {
      run.reset();
      latestTiming = deps.timing.restart();
      published = null;
      deps.scene.resetVehicle(run.startPose(deps.heightAt));
      deps.raceHud.flashRestart();
      deps.onRestart?.();
      deps.onCarReset?.();
      refresh();
      return;
    }
    if (commands.respawn) {
      run.respawn();
      // Penalty flows through the update call only; the separate respawn hook would double count.
      latestTiming = deps.timing.update({
        simTimeSec: deps.simTimeSec(),
        speedMs: deps.scene.vehicle.telemetry.groundSpeedMs,
        penaltySec: run.snapshot().penaltySec,
      });
      // Tall-class lift comes from main's scene.resetVehicle wrapper; none here.
      deps.scene.resetVehicle(run.respawnPose(deps.heightAt));
      deps.onCarReset?.();
      refresh();
    }
  }

  deps.raceHud.showStageInfo({
    name: stage.name,
    bestSec: deps.personalBest?.bestTimeSec ?? null,
    medals: deps.medalsActive ? (stage.medals ?? null) : null,
  });
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
