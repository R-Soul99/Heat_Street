import { describe, expect, it, vi } from "vitest";
import { createMedalTiming } from "../src/core/medal-timing";
import type { Stage } from "../src/core/stage";
import { createStageRun } from "../src/core/stage-run";
import { createStageCoordinator } from "../src/gameplay/stage-coordinator";

const stage: Stage = {
  id: "s1",
  name: "Dust Run",
  start: { x: 0, z: 0, headingRad: 0 },
  gates: [
    { id: "g1", x: 0, z: -20, headingRad: 0, widthM: 20 },
    { id: "g2", x: 0, z: -40, headingRad: 0, widthM: 20 },
  ],
  finish: { x: 0, z: -60, headingRad: 0, widthM: 20 },
  medals: { goldSec: 60, silverSec: 80, bronzeSec: 100, vehicle: "muscle" as never },
};

function setup(
  options: {
    medalsActive?: boolean;
    personalBest?: { bestTimeSec: number; medal: never; splitsSec: number[] };
  } = {},
) {
  const position = { x: 0, y: 0, z: 0 };
  const velocity = { x: 0, y: 0, z: -10 };
  const body = {
    translation: () => position,
    rotation: () => ({ x: 0, y: 0, z: 0, w: 1 }),
    linvel: () => velocity,
  };
  const scene = {
    vehicle: { body, telemetry: { groundSpeedMs: 10 } },
    resetVehicle: vi.fn(),
  };
  let simTime = 0;
  const run = createStageRun(stage);
  const timing = createMedalTiming({ referenceTimeSec: 0, medals: false });
  const stageView = { update: vi.fn() };
  const minimap = { update: vi.fn() };
  const navigationArrow = { update: vi.fn() };
  const raceHud = {
    update: vi.fn(),
    flashRestart: vi.fn(),
    showStageInfo: vi.fn(),
    flashStageSplit: vi.fn(),
  };
  const chime = { play: vi.fn() };
  const onCompleted = vi.fn();
  const onRestart = vi.fn();
  const onCarReset = vi.fn();
  const heightAt = () => 5;
  const coordinator = createStageCoordinator({
    stage,
    run,
    scene: scene as never,
    heightAt,
    stageView,
    minimap: minimap as never,
    navigationArrow: navigationArrow as never,
    raceHud,
    chime: chime as never,
    simTimeSec: () => simTime,
    timing,
    ...(options.personalBest === undefined ? {} : { personalBest: options.personalBest }),
    medalsActive: options.medalsActive ?? false,
    onCompleted,
    onRestart,
    onCarReset,
  });
  /** Move to z at sim time t and tick. */
  function step(z: number, t: number, x = 0) {
    position.z = z;
    position.x = x;
    simTime = t;
    coordinator.onTickEnd();
  }
  return {
    coordinator,
    run,
    timing,
    scene,
    stageView,
    minimap,
    navigationArrow,
    raceHud,
    chime,
    onCompleted,
    onRestart,
    onCarReset,
    step,
    setSim: (t: number) => (simTime = t),
  };
}

function driveAll(s: ReturnType<typeof setup>, t0 = 0) {
  s.step(-1, t0);
  s.step(-19, t0 + 1);
  s.step(-21, t0 + 2);
  s.step(-39, t0 + 3);
  s.step(-41, t0 + 4);
  s.step(-59, t0 + 5);
  s.step(-61, t0 + 6);
}

describe("stage coordinator ticks", () => {
  it("records gates and finish as ordered sectors", () => {
    const s = setup();
    driveAll(s);
    const sectors = s.timing.snapshot().sectors;
    expect(sectors.map((x) => x.checkpointId)).toEqual(["g1", "g2", "finish"]);
    expect(sectors.map((x) => x.ordinal)).toEqual([0, 1, 2]);
  });

  it("ignores a later gate crossed before the earlier one", () => {
    const s = setup();
    s.step(-25, 0);
    s.step(-39, 1);
    s.step(-41, 2);
    expect(s.timing.snapshot().sectors).toHaveLength(0);
  });

  it("publishes completion exactly once", () => {
    const s = setup();
    driveAll(s);
    s.step(-70, 8);
    s.step(-80, 9);
    expect(s.onCompleted).toHaveBeenCalledOnce();
    const result = s.onCompleted.mock.calls[0]?.[0];
    expect(result.splitsSec).toEqual(
      result.completion.sectors.map(
        (x: { cumulativeElapsedSec: number }) => x.cumulativeElapsedSec,
      ),
    );
    expect(result.splitsSec).toHaveLength(3);
    expect(result.penaltySec).toBe(0);
  });

  it("gives no medal when medals are inactive and gold when active and fast", () => {
    const off = setup({ medalsActive: false });
    driveAll(off);
    expect(off.onCompleted.mock.calls[0]?.[0].medal).toBe("none");
    const on = setup({ medalsActive: true });
    driveAll(on);
    expect(on.onCompleted.mock.calls[0]?.[0].medal).toBe("gold");
  });

  it("chimes and flashes a neutral split with no personal best", () => {
    const s = setup();
    s.step(-1, 0);
    s.step(-19, 1);
    s.step(-21, 2);
    expect(s.chime.play).toHaveBeenCalledOnce();
    expect(s.raceHud.flashStageSplit).toHaveBeenCalledOnce();
    expect(s.raceHud.flashStageSplit.mock.calls[0]?.[1]).toBe("neutral");
  });

  it("flashes a faster split against a slower personal best", () => {
    const s = setup({
      personalBest: { bestTimeSec: 30, medal: "none" as never, splitsSec: [10, 20] },
    });
    s.step(-1, 0);
    s.step(-19, 1);
    s.step(-21, 3);
    expect(s.raceHud.flashStageSplit.mock.calls[0]?.[1]).toBe("faster");
  });

  it("snapshot never reports wrong way and maps run state", () => {
    const s = setup();
    expect(s.coordinator.snapshot()).toMatchObject({
      mode: "stage",
      wrongWay: false,
      totalGates: 3,
      label: "Dust Run",
      currentTargetId: "g1",
      respawnAnchorId: null,
      visitedIds: [],
    });
    s.step(-1, 0);
    s.step(-19, 1);
    s.step(-21, 2);
    expect(s.coordinator.snapshot()).toMatchObject({
      currentTargetId: "g2",
      respawnAnchorId: "g1",
      visitedIds: ["g1"],
    });
    driveAllRest(s);
    expect(s.coordinator.snapshot().currentTargetId).toBeNull();
    expect(s.coordinator.snapshot().complete).toBe(true);
  });

  it("refreshes view, minimap and arrow", () => {
    const s = setup();
    s.step(-1, 0);
    s.step(-19, 1);
    s.step(-21, 2);
    expect(s.stageView.update).toHaveBeenLastCalledWith(1);
    const mm = s.minimap.update.mock.calls.at(-1)?.[0];
    expect(mm.remaining).toEqual([
      { x: 0, z: -40 },
      { x: 0, z: -60 },
    ]);
    expect(mm.target).toEqual({ x: 0, z: -40 });
    expect(s.navigationArrow.update.mock.calls.at(-1)?.[0].waypoint).toEqual([0, 7, -40]);
    driveAllRest(s);
    expect(s.stageView.update).toHaveBeenLastCalledWith(3);
    expect(s.navigationArrow.update.mock.calls.at(-1)?.[0].waypoint).toBeNull();
  });
});

function driveAllRest(s: ReturnType<typeof setup>) {
  s.step(-39, 3);
  s.step(-41, 4);
  s.step(-59, 5);
  s.step(-61, 6);
}

describe("stage coordinator commands", () => {
  it("restart resets run, timing and allows a second completion", () => {
    const s = setup();
    driveAll(s);
    s.coordinator.onCommands({ respawn: false, restart: true });
    expect(s.run.snapshot().nextGateIndex).toBe(0);
    expect(s.timing.snapshot().sectors).toHaveLength(0);
    expect(s.scene.resetVehicle).toHaveBeenCalledWith({ x: 0, y: 5.6, z: 0, headingRad: 0 });
    expect(s.raceHud.flashRestart).toHaveBeenCalledOnce();
    expect(s.onRestart).toHaveBeenCalledOnce();
    expect(s.onCarReset).toHaveBeenCalledOnce();
    driveAll(s, 100);
    expect(s.onCompleted).toHaveBeenCalledTimes(2);
  });

  it("respawn returns to the last gate with a 5 s penalty and no timing.respawn", () => {
    const s = setup();
    const respawnSpy = vi.spyOn(s.timing, "respawn");
    s.step(-1, 0);
    s.step(-19, 1);
    s.step(-21, 2);
    s.coordinator.onCommands({ respawn: true, restart: false });
    expect(s.scene.resetVehicle).toHaveBeenCalledWith({ x: 0, y: 5.6, z: -20, headingRad: 0 });
    expect(s.run.snapshot().penaltySec).toBe(5);
    expect(s.timing.snapshot().penaltySec).toBe(5);
    expect(respawnSpy).not.toHaveBeenCalled();
    expect(s.onCarReset).toHaveBeenCalledOnce();
  });

  it("two respawns give 10 s included in the completion time", () => {
    const s = setup();
    s.step(-1, 0);
    s.coordinator.onCommands({ respawn: true, restart: false });
    s.coordinator.onCommands({ respawn: true, restart: false });
    expect(s.run.snapshot().penaltySec).toBe(10);
    // run re-seeds after the teleport; drive the full course
    driveAll(s, 1);
    const result = s.onCompleted.mock.calls[0]?.[0];
    expect(result.penaltySec).toBe(10);
    expect(result.completion.effectiveTimeSec).toBeGreaterThanOrEqual(10);
  });

  it("restart wins over respawn", () => {
    const s = setup();
    s.coordinator.onCommands({ respawn: true, restart: true });
    expect(s.run.snapshot().penaltySec).toBe(0);
    expect(s.scene.resetVehicle).toHaveBeenCalledOnce();
  });

  it("does not register a crossing on the tick after a respawn teleport", () => {
    const s = setup();
    s.step(-1, 0);
    s.step(-19, 1);
    s.step(-21, 2); // g1 passed
    s.coordinator.onCommands({ respawn: true, restart: false });
    // body "teleports" to just past g2 plane from far behind: would cross if not re-seeded
    s.step(-41, 3);
    expect(s.run.snapshot().nextGateIndex).toBe(1);
  });
});
