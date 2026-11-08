/**
 * Hands out the non-blocker pursuer roles each tick. Whichever car is best placed
 * to hit the player's rear bumper becomes the rammer (the "tail"); every other
 * non-blocker becomes a pitter and works the rear quarters. Blockers are fixed by
 * slot and never change.
 *
 * The rammer keeps its job unless another car is clearly better placed, so the
 * role does not flicker between two cars that are about equally close.
 *
 * Pure: no clock, no randomness, no physics.
 */
import type { PursuerRole } from "./pursuer-driver";

export interface RoleCar {
  readonly x: number;
  readonly z: number;
  readonly blocker: boolean;
  /** "That bloke": fixed role, never rammer or pitter. */
  readonly bloke?: boolean;
}

export interface RolePlayer {
  readonly x: number;
  readonly z: number;
  /** Unit direction of travel. */
  readonly fx: number;
  readonly fz: number;
}

/** Where the rammer wants to be: this far behind the player's centre, m. */
const REAR_POINT_M = 3;
/** A car more than this far AHEAD of the player (along its travel) cannot be the rammer, m. */
const MAX_AHEAD_M = 3;
/** The current rammer keeps the job unless a rival is closer to the rear point by this factor... */
const KEEP_FACTOR = 1.3;
/** ...plus this many metres. */
const KEEP_SLACK_M = 2;

export interface RoleAssigner {
  assign(player: RolePlayer, cars: readonly RoleCar[]): PursuerRole[];
}

export function createRoleAssigner(): RoleAssigner {
  let rammer = -1;
  return {
    assign(player: RolePlayer, cars: readonly RoleCar[]): PursuerRole[] {
      const rearX = player.x - player.fx * REAR_POINT_M;
      const rearZ = player.z - player.fz * REAR_POINT_M;
      const cost = cars.map((c) => {
        if (c.blocker || c.bloke) return Number.POSITIVE_INFINITY;
        const along = (c.x - player.x) * player.fx + (c.z - player.z) * player.fz;
        if (along > MAX_AHEAD_M) return Number.POSITIVE_INFINITY;
        return Math.hypot(c.x - rearX, c.z - rearZ);
      });
      let best = -1;
      for (let i = 0; i < cars.length; i++) {
        if (
          cost[i] !== Number.POSITIVE_INFINITY &&
          (best < 0 || (cost[i] as number) < (cost[best] as number))
        ) {
          best = i;
        }
      }
      if (best < 0) {
        // Nobody is behind the player: first non-blocker rammer so someone still tails it.
        best = cars.findIndex((c) => !c.blocker && !c.bloke);
      }
      const keep =
        rammer >= 0 &&
        rammer < cars.length &&
        !(cars[rammer] as RoleCar).blocker &&
        !(cars[rammer] as RoleCar).bloke &&
        cost[rammer] !== Number.POSITIVE_INFINITY &&
        best >= 0 &&
        (cost[rammer] as number) <= (cost[best] as number) * KEEP_FACTOR + KEEP_SLACK_M;
      if (!keep) rammer = best;
      return cars.map((c, i) =>
        c.bloke ? "bloke" : c.blocker ? "blocker" : i === rammer ? "rammer" : "pitter",
      );
    },
  };
}
