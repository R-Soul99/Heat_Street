import { describe, expect, it } from "vitest";
import { NEUTRAL } from "../src/core/input-tape";
import { createRaceCommandLatch } from "../src/input/race-commands";

describe("race command latch", () => {
  it("emits held respawn and restart keys once per edge", () => {
    const commands = createRaceCommandLatch();

    commands.press("respawn");
    commands.press("respawn");
    expect(commands.sampleForTick(0)).toEqual({ respawn: true, restart: false });
    expect(commands.sampleForTick(1)).toEqual({ respawn: false, restart: false });

    commands.release("respawn");
    commands.press("respawn");
    commands.press("restart");
    expect(commands.sampleForTick(2)).toEqual({ respawn: true, restart: true });
    expect(commands.sampleForTick(2)).toEqual({ respawn: true, restart: true });
    expect(NEUTRAL.throttle).toBe(0);
  });
});