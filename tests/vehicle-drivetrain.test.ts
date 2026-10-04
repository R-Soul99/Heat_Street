import * as RAPIER from "@dimforge/rapier3d";
import { describe, expect, it } from "vitest";
import { type InputFrame, NEUTRAL } from "../src/core/input-tape";
import { classDefaultTuning, VEHICLE_CLASSES } from "../src/core/vehicle-class";
import { defaultTuning, type VehicleTuning } from "../src/core/vehicle-tuning";
import { createVehicle } from "../src/physics/vehicle";
import { createWorld } from "../src/physics/world";

const SPAWN = { x: 0, y: 1, z: 0 };
const SHARES = [0, 1, 0.4] as const;

function buildScene(tuning: VehicleTuning, share?: number) {
  const world = createWorld();
  const ground = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(0, -0.5, 0));
  world.createCollider(RAPIER.ColliderDesc.cuboid(500, 0.5, 500), ground);
  const vehicle =
    share === undefined
      ? createVehicle(world, tuning, SPAWN)
      : createVehicle(world, tuning, SPAWN, share);
  return { world, vehicle };
}

function run(
  scene: ReturnType<typeof buildScene>,
  tuning: VehicleTuning,
  ticks: number,
  input: (i: number) => InputFrame,
) {
  for (let i = 0; i < ticks; i++) {
    scene.vehicle.tick(input(i), tuning);
    scene.world.step();
  }
}

function forwardSpeed(v: ReturnType<typeof buildScene>["vehicle"]): number {
  const q = v.body.rotation();
  const lv = v.body.linvel();
  // forward = local -Z rotated by q
  const fx = -2 * (q.x * q.z + q.w * q.y);
  const fy = -2 * (q.y * q.z - q.w * q.x);
  const fz = -(1 - 2 * (q.x * q.x + q.y * q.y));
  return lv.x * fx + lv.y * fy + lv.z * fz;
}

const full: InputFrame = { ...NEUTRAL, throttle: 1 };

describe("vehicle drivetrain", () => {
  it("explicit RWD share is bitwise identical to omitting the argument", () => {
    const t = defaultTuning();
    const a = buildScene(t);
    const b = buildScene(t, 0);
    const script = (i: number): InputFrame => ({
      steer: Math.sin(i / 20),
      throttle: i < 150 ? 1 : 0,
      brake: i >= 150 && i < 200 ? 1 : i >= 250 ? 0.6 : 0,
      handbrake: i >= 100 && i < 130,
    });
    run(a, t, 300, script);
    run(b, t, 300, script);
    const pa = a.vehicle.body.translation();
    const pb = b.vehicle.body.translation();
    const ra = a.vehicle.body.rotation();
    const rb = b.vehicle.body.rotation();
    const va = a.vehicle.body.linvel();
    const vb = b.vehicle.body.linvel();
    for (const k of ["x", "y", "z"] as const) {
      expect(pa[k]).toBe(pb[k]);
      expect(va[k]).toBe(vb[k]);
    }
    for (const k of ["x", "y", "z", "w"] as const) expect(ra[k]).toBe(rb[k]);
  });

  for (const share of SHARES) {
    const id = share === 0 ? "rwd" : share === 1 ? "fwd" : "awd";
    it(`share ${share} (${id}) accelerates, stays straight, brakes and reverses`, () => {
      expect(VEHICLE_CLASSES[id].frontDriveShare).toBe(share);
      const t = classDefaultTuning(id);

      const s = buildScene(t, share);
      run(s, t, 240, () => full);
      expect(forwardSpeed(s.vehicle)).toBeGreaterThan(10);
      expect(Math.abs(s.vehicle.body.angvel().y)).toBeLessThan(0.5);

      // Throttle held together with brake: engine force must be zeroed on all wheels.
      const braked = buildScene(t, share);
      run(braked, t, 240, () => full);
      const before = forwardSpeed(braked.vehicle);
      run(braked, t, 120, () => ({ ...NEUTRAL, throttle: 1, brake: 0.6 }));
      expect(forwardSpeed(braked.vehicle)).toBeLessThan(before - 5);

      const r = buildScene(t, share);
      run(r, t, 180, () => ({ ...NEUTRAL, brake: 1 }));
      expect(forwardSpeed(r.vehicle)).toBeLessThan(-1);
    });
  }

  it("rejects an out-of-range drive share", () => {
    const world = createWorld();
    const t = defaultTuning();
    expect(() => createVehicle(world, t, SPAWN, 1.5)).toThrow(RangeError);
    expect(() => createVehicle(world, t, SPAWN, Number.NaN)).toThrow(RangeError);
  });
});
