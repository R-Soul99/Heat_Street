/** Discrete retry commands sampled at a fixed-tick boundary. */
export interface RaceCommands {
  readonly respawn: boolean;
  readonly restart: boolean;
}

export interface RaceCommandSource {
  /** Return each pending edge at most once, independent of render frequency. */
  sampleForTick(tick: number): RaceCommands;
}

export interface RaceCommandLatch extends RaceCommandSource {
  press(command: "respawn" | "restart"): void;
  release(command: "respawn" | "restart"): void;
}

const NONE: RaceCommands = Object.freeze({ respawn: false, restart: false });

/**
 * Keeps retry keys separate from continuous driving axes. Repeated keydown
 * events while a key is held do not enqueue another command.
 */
export function createRaceCommandLatch(): RaceCommandLatch {
  const held = new Set<"respawn" | "restart">();
  let pendingRespawn = false;
  let pendingRestart = false;
  let lastTick = -1;
  let cached = NONE;

  return {
    press(command): void {
      if (held.has(command)) return;
      held.add(command);
      if (command === "respawn") pendingRespawn = true;
      else pendingRestart = true;
    },

    release(command): void {
      held.delete(command);
    },

    sampleForTick(tick): RaceCommands {
      if (tick <= lastTick) return cached;
      lastTick = tick;
      cached =
        pendingRespawn || pendingRestart
          ? { respawn: pendingRespawn, restart: pendingRestart }
          : NONE;
      pendingRespawn = false;
      pendingRestart = false;
      return cached;
    },
  };
}