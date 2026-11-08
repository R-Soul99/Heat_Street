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
  opts: {
    flank?: boolean;
    straight?: boolean;
    throttle?: number;
    cruiseMs?: number;
    noSlide?: boolean;
  } = {},
): {
  slideTicks: number[];
  dists: number[];
  minDists: number[];
  upY: number[];
  maxSpeedMs: number;
  lateral: number[];
  along: number[];
  blockTicks: number[];
} {
  const world = createWorld();
  try {
    const t = shippedTuning();
    const ground = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(0, -1, 0));
    world.createCollider(RAPIER.ColliderDesc.cuboid(5000, 1, 5000), ground);
    const surfaces = { map: createSurfaceMap("tarmac"), profiles: defaultSurfaceProfiles() };
    const player = createVehicle(world, t, { x: 0, y: 1, z: 0 });
    const baseParams = defaultPursuerParams(t);
    const params = opts.noSlide
      ? { ...baseParams, slideMinAlongM: Number.POSITIVE_INFINITY }
      : baseParams;
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
      {
        driverFactory: (i) => drivers[i] as never,
        speedEdge: (i) => (drivers[i] as { speedEdge(): number }).speedEdge(),
      },
    );
    const idle = { steer: 0, throttle: 0, brake: 0, handbrake: false };
    for (let k = 0; k < 60; k++) {
      player.tick(idle, t, surfaces);
      fleet.tick(k);
      world.step();
    }
    let maxSpeedMs = 0;
    const blockTicks = pursuerPoses.map(() => 0);
    const slideTicks = pursuerPoses.map(() => 0);
    const minDists = pursuerPoses.map(() => Number.POSITIVE_INFINITY);
    const ticks = Math.round(seconds * 60);
    for (let k = 0; k < ticks; k++) {
      const steer = opts.straight ? 0 : 0.35 * Math.sin(k / 70);
      const spd = Math.hypot(player.body.linvel().x, player.body.linvel().z);
      const cruise = opts.cruiseMs;
      const throttle =
        cruise === undefined
          ? (opts.throttle ?? (opts.straight ? 0.3 : 0.55))
          : Math.max(0, Math.min(1, 0.4 + (cruise - spd) * 0.3));
      player.tick(
        {
          steer,
          throttle,
          brake: cruise !== undefined && spd > cruise + 3 ? 0.5 : 0,
          handbrake: false,
        },
        t,
        surfaces,
      );
      const p = player.body.translation();
      const v = player.body.linvel();
      for (const d of drivers) {
        d.setTarget({ x: p.x, z: p.z, vx: v.x, vz: v.z });
      }
      fleet.tick(60 + k);
      world.step();
      {
        const ps = Math.hypot(v.x, v.z) || 1;
        const fx = v.x / ps;
        const fz = v.z / ps;
        fleet.cars.forEach((c, ci) => {
          const q = c.vehicle.body.translation();
          const dx = q.x - p.x;
          const dz = q.z - p.z;
          minDists[ci] = Math.min(minDists[ci] as number, Math.hypot(dx, dz));
          if (dx * fx + dz * fz > 2 && Math.abs(dx * -fz + dz * fx) < 5) {
            blockTicks[ci] = (blockTicks[ci] as number) + 1;
          }
        });
      }
      drivers.forEach((d, di) => {
        if (d.debug().frame.handbrake) slideTicks[di] = (slideTicks[di] as number) + 1;
      });
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
      slideTicks,
      minDists,
      blockTicks,
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
    // The tail rams, backs off, and comes in again, so it does not end the run on the player's bumper.
    expect(r.minDists[0] as number).toBeLessThan(7);
    expect(r.upY[0] as number).toBeGreaterThan(0.7);
  });

  it("turns around when it starts facing away and still closes the gap", () => {
    const r = run([{ x: 0, z: 40, headingRad: Math.PI }], 30);
    expect(r.minDists[0] as number).toBeLessThan(10);
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
    for (const d of r.minDists) expect(d).toBeLessThan(10);
    for (const u of r.upY) expect(u).toBeGreaterThan(0.7);
  });

  it("flank slots spread a swarm across the road instead of queueing in one file", () => {
    const poses = Array.from({ length: 5 }, (_, i) => ({
      x: ((i % 4) - 1.5) * 6,
      z: 40 + 9 * Math.floor(i / 4),
      headingRad: 0,
    }));
    // Slide off: this test is about station spread; blockers rejoining after a slide scatter the swarm.
    const r = run(poses, 30, { flank: true, straight: true, noSlide: true });
    console.log(
      "PDBG dists",
      r.dists.map((d) => d.toFixed(0)).join(" "),
      "lat",
      r.lateral.map((d) => d.toFixed(0)).join(" "),
      "along",
      r.along.map((d) => d.toFixed(0)).join(" "),
    );
    for (const d of r.dists) expect(d).toBeLessThan(60);
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

  it("blocker slots get in front of the player and into its lane, again and again", () => {
    const poses = Array.from({ length: 5 }, (_, i) => ({
      x: ((i % 4) - 1.5) * 6,
      z: 40 + 9 * Math.floor(i / 4),
      headingRad: 0,
    }));
    const r = run(poses, 30, { flank: true, straight: true });
    // Slots 3 and 4 are the blockers: each spends a good chunk of the run ahead of the player in its lane.
    // (Was 180 before blockers got a speed edge: they now get ahead sooner, slide, and are passed
    // sooner, so lane time per blocker is lower. Issue #18 follow-up: rolling block instead of a stop.)
    expect((r.blockTicks[3] as number) + (r.blockTicks[4] as number)).toBeGreaterThan(200);
    for (const i of [3, 4]) expect(r.blockTicks[i] as number).toBeGreaterThan(60);
    // The tail and flank cars never do.
    for (const i of [0, 1, 2]) expect(r.blockTicks[i] as number).toBeLessThan(60);
    for (const u of r.upY) expect(u).toBeGreaterThan(0.7);
  });

  it("blockers overtake a player cruising above the old 38 m/s cap and sit in its lane, no handbrake slide", () => {
    const poses = Array.from({ length: 5 }, (_, i) => ({
      x: ((i % 4) - 1.5) * 6,
      z: 40 + 9 * Math.floor(i / 4),
      headingRad: 0,
    }));
    const r = run(poses, 30, { flank: true, straight: true, cruiseMs: 40 });
    // Blockers 3 and 4: at least one gets ahead in the player's lane and stays there.
    expect((r.blockTicks[3] as number) + (r.blockTicks[4] as number)).toBeGreaterThan(100);
    // The handbrake slide-block is off (it cleared the lane instead of filling it).
    for (const t of r.slideTicks) expect(t).toBe(0);
    for (const u of r.upY) expect(u).toBeGreaterThan(0.7);
  });

  it("pursuers that fall behind a flat-out player borrow speed and rejoin it", () => {
    const poses = Array.from({ length: 5 }, (_, i) => ({
      x: ((i % 4) - 1.5) * 6,
      z: 40 + 9 * Math.floor(i / 4),
      headingRad: 0,
    }));
    const r = run(poses, 40, { flank: true, straight: true, throttle: 1, noSlide: true });
    // Before catch-up the 38 m/s tail and flankers sat 200+ m back by now.
    for (const i of [0, 1, 2]) expect(r.dists[i] as number).toBeLessThan(60);
    for (const u of r.upY) expect(u).toBeGreaterThan(0.7);
  });
});
