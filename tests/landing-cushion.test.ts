import { describe, expect, it } from "vitest";
import collisionRaw from "../public/maps/playground.collision.json?raw";
import compiledRaw from "../public/maps/playground.map.json?raw";
import stationsRaw from "../public/maps/playground.stations.json?raw";
import { NEUTRAL } from "../src/core/input-tape";
import { parseMapCollision } from "../src/core/map-collision";
import { parseRoadGraph } from "../src/core/road-graph";
import { defaultSurfaceProfiles } from "../src/core/surface-tuning";
import { defaultTuning, type VehicleTuning } from "../src/core/vehicle-tuning";
import {
  LAUNCH_RIDE_HEIGHT_LIFT_M,
  launchVelocity,
  parseStations,
} from "../src/debug/test-stations";
import { createMapScene } from "../src/physics/map-scene";
import { sampleVehicle } from "../src/physics/vehicle";
import { createWorld } from "../src/physics/world";

const graph = parseRoadGraph(compiledRaw, "playground.map.json");
const collision = parseMapCollision(collisionRaw, graph.areaId, "playground.collision.json");
const stations = parseStations(stationsRaw, graph.areaId);
const G = 9.81;

interface Landing {
  readonly landed: boolean;
  /** Normal-ish sink speed at touchdown (world vy), m/s. */
  readonly touchdownVy: number;
  /** Largest upward vertical deceleration in the 40 ticks after touchdown, g. */
  readonly peakUpG: number;
  /** Largest horizontal speed loss per second in the 40 ticks after touchdown, g. */
  readonly peakHorizG: number;
  /** Lowest chassis height after touchdown, m. */
  readonly minY: number;
  /** Ticks in the 40 after touchdown with all four wheels at minimum suspension length. */
  readonly pinned: number;
}

/** Gap-jump launch from the pad with throttle held; measures the first real touchdown. */
function jump(id: string, padMph: number, mod?: (t: VehicleTuning) => void): Landing {
  const world = createWorld();
  const tuning = defaultTuning();
  mod?.(tuning);
  const scene = createMapScene(world, graph, collision, tuning, defaultSurfaceProfiles());
  const st = stations.find((s) => s.id === id);
  if (st === undefined) throw new Error(`no station ${id}`);
  scene.resetVehicle({
    x: st.x,
    y: scene.defaultSpawnPose.y + LAUNCH_RIDE_HEIGHT_LIFT_M,
    z: st.z,
    headingRad: st.headingRad,
  });
  scene.vehicle.body.setLinvel(launchVelocity(st.headingRad, padMph), true);
  let air = 0;
  let landed = -1;
  let touchdownVy = 0;
  let prevVy = 0;
  let prevV = 0;
  let peakUp = 0;
  let peakHoriz = 0;
  let minY = Number.POSITIVE_INFINITY;
  let pinned = 0;
  for (let t = 0; t < 6 * 60; t++) {
    scene.applyInput({ ...NEUTRAL, throttle: 1 });
    world.step();
    const s = sampleVehicle(scene.vehicle);
    const vel = scene.vehicle.body.linvel();
    if (s.contacts === 0) air++;
    else if (air > 18 && landed < 0) {
      landed = t;
      touchdownVy = vel.y;
    }
    if (landed >= 0 && t <= landed + 40) {
      peakUp = Math.max(peakUp, ((vel.y - prevVy) * 60) / G);
      peakHoriz = Math.max(peakHoriz, ((prevV - s.groundSpeedMs) * 60) / G);
      minY = Math.min(minY, s.position.y);
      if (
        [0, 1, 2, 3].every((w) => (scene.vehicle.controller.wheelSuspensionLength(w) ?? 1) <= 0.051)
      ) {
        pinned++;
      }
    }
    prevVy = vel.y;
    prevV = s.groundSpeedMs;
  }
  return { landed: landed >= 0, touchdownVy, peakUpG: peakUp, peakHorizG: peakHoriz, minY, pinned };
}

describe("landing cushion (playground gap jumps)", () => {
  // Baseline before the cushion and with chassis friction 0.15 (measured 2026-11-05):
  // medium jump at 70 / 85 mph pad: 43 / 66 g vertical, 5.3 / 8.9 g horizontal stop.
  const cases: readonly (readonly [string, number])[] = [
    ["gap-jump-small", 70],
    ["gap-jump-small", 85],
    ["gap-jump-medium", 70],
    ["gap-jump-medium", 85],
  ];

  for (const [id, mph] of cases) {
    it(`${id} at a ${mph} mph pad: no 25 g slam, horizontal stop under 2 g`, () => {
      const on = jump(id, mph);
      expect(on.landed).toBe(true);
      expect(on.peakUpG).toBeLessThan(24);
      expect(on.peakHorizG).toBeLessThan(2);
      // Old 0.4 m suspension: 14-16 ticks fully bottomed, chassis down to y 0.34-0.39.
      expect(on.pinned).toBeLessThan(3);
      expect(on.minY).toBeGreaterThan(0.44);
    });
  }

  it("the cushion is what removes the slam (off: well over 30 g on the medium jump)", () => {
    const off = jump("gap-jump-medium", 85, (t) => {
      t.assists.landingCushionG = 0;
    });
    expect(off.peakUpG).toBeGreaterThan(30);
  });

  it("does not touch ordinary driving: a gentle small-jump touchdown is unchanged", () => {
    const off = jump("gap-jump-small", 50, (t) => {
      t.assists.landingCushionG = 0;
    });
    const on = jump("gap-jump-small", 50);
    expect(Math.abs(on.peakUpG - off.peakUpG)).toBeLessThan(1);
  });
});
