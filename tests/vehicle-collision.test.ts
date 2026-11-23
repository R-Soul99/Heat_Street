import { describe, expect, it } from "vitest";
import { shippedTuning } from "../src/core/feel";
import { VEHICLE_CLASSES } from "../src/core/vehicle-class";
import { buildTelemetryScene } from "../src/physics/telemetry/run";
import { createVehicle, sampleVehicle } from "../src/physics/vehicle";
import { createWorld } from "../src/physics/world";

describe("monster vs AI muscle car", () => {
  it("does not launch a stationary AI car at 15 m/s", () => {
    const world = createWorld();
    try {
      buildTelemetryScene(world);
      const ai = createVehicle(world, shippedTuning("rwd"), { x: 0, y: 1, z: -30 }, 0);
      const spec = VEHICLE_CLASSES.monster;
      const tuning = shippedTuning("monster");
      const monster = createVehicle(
        world,
        tuning,
        { x: 0, y: spec.spawnClearanceM ?? 1, z: 0 },
        spec.frontDriveShare,
        { surfaceGripScale: spec.surfaceGripScale },
      );
      const aiTuning = shippedTuning("rwd");
      const idle = { steer: 0, throttle: 0, brake: 0, handbrake: false };

      let contactTick = -1;
      let contactSpeed = 0;
      let peakSpeed = 0;
      let peakVert = 0;
      let finite = true;
      for (let tick = 0; tick < 1800 && (contactTick < 0 || tick < contactTick + 180); tick++) {
        const m = sampleVehicle(monster);
        monster.tick(
          { steer: 0, throttle: m.forwardSpeedMs < 15 ? 1 : 0.15, brake: 0, handbrake: false },
          tuning,
        );
        ai.tick(idle, aiTuning);
        world.step();
        const a = ai.body.linvel();
        const speed = Math.hypot(a.x, a.y, a.z);
        if (![a.x, a.y, a.z, speed].every(Number.isFinite)) finite = false;
        if (contactTick < 0 && speed > 0.5) {
          contactTick = tick;
          contactSpeed = m.forwardSpeedMs; // pre-step speed: the impact speed
        }
        if (contactTick >= 0) {
          peakSpeed = Math.max(peakSpeed, speed);
          peakVert = Math.max(peakVert, Math.abs(a.y));
        }
      }
      console.info(
        `[collision] contact tick ${contactTick}, monster ${contactSpeed.toFixed(1)} m/s, AI peak speed ${peakSpeed.toFixed(1)} m/s, peak vertical ${peakVert.toFixed(2)} m/s`,
      );
      expect(finite).toBe(true);
      expect(contactTick).toBeGreaterThan(0);
      expect(peakSpeed).toBeLessThanOrEqual(1.3 * contactSpeed);
      expect(peakVert).toBeLessThanOrEqual(5);
    } finally {
      world.free();
    }
  });
});
