import { describe, expect, it, vi } from "vitest";
import { forwardFromYaw } from "../src/core/heading";
import { createFreeDriveCoordinator } from "../src/gameplay/free-drive-coordinator";
import type { MapScene } from "../src/physics/map-scene";
import type { VehiclePose } from "../src/physics/vehicle";

function setup() {
  const resetVehicle = vi.fn<(pose: VehiclePose) => void>();
  // Yaw rotation about +Y by `yaw` radians: quaternion (0, sin(h/2), 0, cos(h/2)).
  const yaw = 0.7;
  const scene = {
    vehicle: {
      body: {
        translation: () => ({ x: 12, y: 40, z: -8 }),
        rotation: () => ({ x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) }),
      },
    },
    resetVehicle,
  } as unknown as MapScene;
  const onCarReset = vi.fn();
  const spawnPose: VehiclePose = { x: 1, y: 2, z: 3, headingRad: 0.25 };
  const coordinator = createFreeDriveCoordinator({
    scene,
    spawnPose,
    heightAt: (x, z) => x + z,
    onCarReset,
  });
  return { coordinator, resetVehicle, onCarReset, spawnPose, yaw };
}

describe("createFreeDriveCoordinator", () => {
  it("restart resets to the spawn pose once", () => {
    const { coordinator, resetVehicle, onCarReset, spawnPose } = setup();
    coordinator.onCommands({ restart: true, respawn: false });
    expect(resetVehicle).toHaveBeenCalledTimes(1);
    expect(resetVehicle).toHaveBeenCalledWith(spawnPose);
    expect(onCarReset).toHaveBeenCalledTimes(1);
  });

  it("respawn resets upright at the current x/z on the terrain, keeping heading", () => {
    const { coordinator, resetVehicle, onCarReset, yaw } = setup();
    coordinator.onCommands({ restart: false, respawn: true });
    expect(resetVehicle).toHaveBeenCalledTimes(1);
    const pose = resetVehicle.mock.calls[0]?.[0] as VehiclePose;
    expect(pose.x).toBe(12);
    expect(pose.z).toBe(-8);
    expect(pose.y).toBeCloseTo(4 + 0.6, 9);
    const f = forwardFromYaw(pose.headingRad);
    const expected = forwardFromYaw(yaw);
    expect(f.x).toBeCloseTo(expected.x, 6);
    expect(f.z).toBeCloseTo(expected.z, 6);
    expect(onCarReset).toHaveBeenCalledTimes(1);
  });

  it("does nothing without a command", () => {
    const { coordinator, resetVehicle, onCarReset } = setup();
    coordinator.onCommands({ restart: false, respawn: false });
    expect(resetVehicle).not.toHaveBeenCalled();
    expect(onCarReset).not.toHaveBeenCalled();
  });

  it("reports an inert snapshot and tolerates tick/render", () => {
    const { coordinator } = setup();
    expect(() => {
      coordinator.onTickEnd();
      coordinator.render();
    }).not.toThrow();
    expect(coordinator.snapshot()).toEqual({
      mode: "p2p",
      currentTargetId: null,
      visitedIds: [],
      lap: 0,
      totalLaps: 0,
      complete: false,
      wrongWay: false,
      respawnAnchorId: null,
      penaltySec: 0,
    });
  });
});
