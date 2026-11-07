import * as RAPIER from "@dimforge/rapier3d";
import { describe, expect, it } from "vitest";
import { shippedTuning } from "../src/core/feel";
import { createPursuerDriver, defaultPursuerParams, flankSlot } from "../src/core/pursuer-driver";
import { defaultSurfaceProfiles } from "../src/core/surface-tuning";
import { createAiFleet } from "../src/physics/ai-fleet";
import { createSurfaceMap } from "../src/physics/surface";
import { createVehicle, sampleVehicle } from "../src/physics/vehicle";
import { createWorld } from "../src/physics/world";

/** Flat tarmac, a scripted "player" weaving at ~half throttle, and N pursuers starting at the given poses. */
function run(
  pursuerPoses: { x: number; z: number; headingRad: number }[],
  seconds: number,
  opts: { flank?: boolean; straight?: boolean } = {},
): { dists: number[]; upY: number[]; maxSpeedMs: number; lateral: number[]; along: number[] } {
  const world = createWorld();
  try {
    const t = shippedTuning();
    const ground = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(0, -1, 0));
    world.createCollider(RAPIER.ColliderDesc.cuboid(5000, 1, 5000), ground);
    const surfaces = { map: createSurfaceMap("tarmac"), profiles: defaultSurfaceProfiles() };
    const player = createVehicle(world, t, { x: 0, y: 1, z: 0 });
    const params = defaultPursuerParams(t);
    const drivers = pursuerPoses.map((_, i) =>
      createPursuerDriver(params, opts.flank ? flankSlot(i) : undefined),
    );
    const fleet = createAiFleet(
      world,
      t,
      surfaces,
      undefined,
      pursuerPoses.map((p) => ({ x: p.x, y: 1, z: p.z, headingRad: p.headingRad })),
      {} as never,
      { driverFactory: (i) => drivers[i] as never },
    );
    const idle = { steer: 0, throttle: 0, brake: 0, handbrake: false };
    for (let k = 0; k < 60; k++) {
      player.tick(idle, t, surfaces);
      fleet.tick(k);
      world.step();
    }
    let maxSpeedMs = 0;
    const ticks = Math.round(seconds * 60);
    for (let k = 0; k < ticks; k++) {
      const steer = opts.straight ? 0 : 0.35 * Math.sin(k / 70);
      player.tick(
        { steer, throttle: opts.straight ? 0.3 : 0.55, brake: 0, handbrake: false },
        t,
        surfaces,
      );
      const p = player.body.translation();
      const v = player.body.linvel();
      for (const d of drivers) d.setTarget({ x: p.x, z: p.z, vx: v.x, vz: v.z });
      fleet.tick(60 + k);
      world.step();
      for (const c of fleet.cars)
        maxSpeedMs = Math.max(maxSpeedMs, sampleVehicle(c.vehicle).groundSpeedMs);
    }
    const p = player.body.translation();
    const pv = player.body.linvel();
    console.log(
      "PDBG speeds player",
      Math.hypot(pv.x, pv.z).toFixed(1),
      "cars",
      fleet.cars.map((c) => sampleVehicle(c.vehicle).groundSpeedMs.toFixed(1)).join(" "),
      "maxSpeed",
      maxSpeedMs.toFixed(1),
    );
    const ps = Math.hypot(pv.x, pv.z) || 1;
    const fx = pv.x / ps;
    const fz = pv.z / ps;
    const rel = fleet.cars.map((c) => {
      const q = c.vehicle.body.translation();
      const dx = q.x - p.x;
      const dz = q.z - p.z;
      return { lateral: dx * -fz + dz * fx, along: dx * fx + dz * fz };
    });
    return {
      lateral: rel.map((r) => r.lateral),
      along: rel.map((r) => r.along),
      dists: fleet.cars.map((c) => {
        const q = c.vehicle.body.translation();
        return Math.hypot(q.x - p.x, q.z - p.z);
      }),
      upY: fleet.cars.map((c) => {
        const r = c.vehicle.body.rotation();
        return 1 - 2 * (r.x * r.x + r.z * r.z);
      }),
      maxSpeedMs,
    };
  } finally {
    world.free();
  }
}

describe("pursuer driver", () => {
  it("catches a weaving player from 60 m behind and stays upright", () => {
    // The player drives toward -Z; the pursuer starts 60 m behind it (+Z), facing the same way.
    const r = run([{ x: 0, z: 60, headingRad: 0 }], 30);
    expect(r.dists[0] as number).toBeLessThan(25);
    expect(r.upY[0] as number).toBeGreaterThan(0.7);
  });

  it("turns around when it starts facing away and still closes the gap", () => {
    const r = run([{ x: 0, z: 40, headingRad: Math.PI }], 30);
    expect(r.dists[0] as number).toBeLessThan(40);
    expect(r.upY[0] as number).toBeGreaterThan(0.7);
  });

  it("several pursuers all reach the player without anyone flipping", () => {
    const r = run(
      [
        { x: -8, z: 70, headingRad: 0 },
        { x: 8, z: 80, headingRad: 0 },
        { x: 0, z: 95, headingRad: 0 },
      ],
      35,
    );
    for (const d of r.dists) expect(d).toBeLessThan(40);
    for (const u of r.upY) expect(u).toBeGreaterThan(0.7);
  });

  it("flank slots spread a swarm across the road instead of queueing in one file", () => {
    const poses = Array.from({ length: 5 }, (_, i) => ({
      x: ((i % 4) - 1.5) * 6,
      z: 40 + 9 * Math.floor(i / 4),
      headingRad: 0,
    }));
    const r = run(poses, 30, { flank: true, straight: true });
    console.log(
      "PDBG dists",
      r.dists.map((d) => d.toFixed(0)).join(" "),
      "lat",
      r.lateral.map((d) => d.toFixed(0)).join(" "),
      "along",
      r.along.map((d) => d.toFixed(0)).join(" "),
    );
    for (const d of r.dists) expect(d).toBeLessThan(40);
    for (const u of r.upY) expect(u).toBeGreaterThan(0.7);
    // Someone is on each side of the player, a few metres out.
    expect(Math.min(...r.lateral)).toBeLessThan(-3);
    expect(Math.max(...r.lateral)).toBeGreaterThan(3);
    // Without slots the same five end up in one file (lateral spread stays small).
    const file = run(poses, 30, { flank: false, straight: true });
    console.log(
      "PDBG FILE dists",
      file.dists.map((d) => d.toFixed(0)).join(" "),
      "lat",
      file.lateral.map((d) => d.toFixed(0)).join(" "),
    );
    const spread = (a: number[]) => Math.max(...a) - Math.min(...a);
    expect(spread(r.lateral)).toBeGreaterThan(spread(file.lateral) + 3);
  });

  it("flankSlot is index-only and later rings sit wider and further back", () => {
    expect(flankSlot(0)).toEqual({ lateralM: 0, alongM: 0 });
    expect(flankSlot(3)).toEqual(flankSlot(3));
    expect(Math.abs(flankSlot(6).lateralM)).toBeGreaterThan(Math.abs(flankSlot(1).lateralM));
    expect(flankSlot(5).alongM).toBeLessThan(flankSlot(0).alongM);
  });
});
