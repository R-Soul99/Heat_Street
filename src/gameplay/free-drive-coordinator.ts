import { headingFromRotation, yawFromTravelDirection } from "../core/heading";
import type { RaceSnapshot } from "../core/race-state";
import type { RaceCommands } from "../input/race-commands";
import type { MapScene } from "../physics/map-scene";
import type { VehiclePose } from "../physics/vehicle";
import type { RaceCoordinator } from "./race-coordinator";

/** Respawn height above the terrain surface, metres. */
const RESPAWN_CLEARANCE_M = 0.6;

export interface FreeDriveCoordinatorDeps {
  readonly scene: MapScene;
  readonly spawnPose: VehiclePose;
  readonly heightAt: (x: number, z: number) => number;
  readonly onCarReset: () => void;
}

const FREE_DRIVE_SNAPSHOT: RaceSnapshot = {
  mode: "p2p",
  currentTargetId: null,
  visitedIds: [],
  lap: 0,
  totalLaps: 0,
  complete: false,
  wrongWay: false,
  respawnAnchorId: null,
  penaltySec: 0,
};

/**
 * A RaceCoordinator with no course: no checkpoints, timing or saves. Restart
 * returns to the spawn pose; respawn stands the car upright where it is.
 */
export function createFreeDriveCoordinator(deps: FreeDriveCoordinatorDeps): RaceCoordinator {
  return {
    onTickEnd(): void {},
    onCommands(commands: RaceCommands): void {
      if (commands.restart) {
        deps.scene.resetVehicle(deps.spawnPose);
        deps.onCarReset();
        return;
      }
      if (commands.respawn) {
        const body = deps.scene.vehicle.body;
        const p = body.translation();
        const bearing = headingFromRotation(body.rotation());
        deps.scene.resetVehicle({
          x: p.x,
          y: deps.heightAt(p.x, p.z) + RESPAWN_CLEARANCE_M,
          z: p.z,
          headingRad: yawFromTravelDirection(Math.cos(bearing), Math.sin(bearing)),
        });
        deps.onCarReset();
      }
    },
    render(): void {},
    snapshot(): RaceSnapshot {
      return FREE_DRIVE_SNAPSHOT;
    },
  };
}
