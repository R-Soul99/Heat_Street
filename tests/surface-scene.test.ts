import { describe, expect, it } from "vitest";
import { NEUTRAL } from "../src/core/input-tape";
import { defaultSurfaceProfiles } from "../src/core/surface-tuning";
import { SURFACE_TYPES, type SurfaceType } from "../src/core/surface-types";
import { defaultTuning } from "../src/core/vehicle-tuning";
import {
  createSurfaceScene,
  DENSE_BUILDINGS,
  SPARSE_BUILDINGS,
  SURFACE_SCENE_SPAWN,
  SURFACE_ZONE_ORDER,
  type SurfaceScene,
} from "../src/physics/surface-scene";
import { createWorld } from "../src/physics/world";

/**
 * The SC1 / D-01 proof: "a single straight drive from the spawn point
 * crosses all six surfaces in sequence, proven headlessly". This file also
 * mechanically checks D-06/D-07's building-cluster layout contract, since
 * `src/render/surface-view.ts` (plan 03-05 Task 2) has no import from this
 * scene and must be checked against these same numbers by a human reading
 * both files -- this test is the machine half of that cross-check.
 */

/** One zone's derived geometry + resolved surface, read back from the live
 * Rapier world rather than assumed -- see `zoneInfos` below. */
interface ZoneInfo {
  readonly handle: number;
  readonly z: number;
  readonly halfZ: number;
  readonly surface: SurfaceType;
}

/**
 * Every surface-zone body is FIXED and sits at a NEGATIVE translation.y
 * (the zone's own half-Y, translated downward so its top face is at y = 0).
 * Every building body is also fixed but sits at a POSITIVE translation.y
 * (its own half-Y, translated upward so its base is at y = 0). The chassis
 * is the only dynamic body. This is enough to separate zone colliders from
 * building/chassis colliders without any extra export from the scene.
 */
function zoneInfos(world: ReturnType<typeof createWorld>, scene: SurfaceScene): ZoneInfo[] {
  const infos: ZoneInfo[] = [];
  world.colliders.forEach((collider) => {
    const parent = collider.parent();
    if (!parent?.isFixed()) return;
    const t = parent.translation();
    if (t.y >= 0) return;
    const half = collider.halfExtents();
    if (!half) return;
    infos.push({
      handle: collider.handle,
      z: t.z,
      halfZ: half.z,
      surface: scene.surfaces.map.lookup(collider.handle),
    });
  });
  infos.sort((a, b) => b.z - a.z);
  return infos;
}

describe("createSurfaceScene: zone registration and geometry (D-01)", () => {
  it("registers each zone collider to the surface matching its position in SURFACE_ZONE_ORDER", () => {
    const world = createWorld();
    const scene = createSurfaceScene(world, defaultTuning(), defaultSurfaceProfiles());
    const zones = zoneInfos(world, scene);

    expect(zones.length).toBe(SURFACE_ZONE_ORDER.length);
    for (let i = 0; i < zones.length; i++) {
      expect(zones[i].surface).toBe(SURFACE_ZONE_ORDER[i]);
    }
  });

  it("registers every one of the six SURFACE_TYPES values exactly once", () => {
    const world = createWorld();
    const scene = createSurfaceScene(world, defaultTuning(), defaultSurfaceProfiles());
    const zones = zoneInfos(world, scene);

    const surfaces = zones.map((z) => z.surface);
    for (const surface of SURFACE_TYPES) {
      expect(surfaces.filter((s) => s === surface).length).toBe(1);
    }
  });

  it("tiles the Z axis with no gap and no overlap between adjacent zones", () => {
    const world = createWorld();
    const scene = createSurfaceScene(world, defaultTuning(), defaultSurfaceProfiles());
    const zones = zoneInfos(world, scene);

    for (let i = 0; i < zones.length - 1; i++) {
      const nearEdgeOfThis = zones[i].z - zones[i].halfZ;
      const farEdgeOfNext = zones[i + 1].z + zones[i + 1].halfZ;
      expect(nearEdgeOfThis).toBeCloseTo(farEdgeOfNext, 9);
    }
  });

  it("SURFACE_ZONE_ORDER starts with tarmac at the highest Z, the spawn end", () => {
    expect(SURFACE_ZONE_ORDER[0]).toBe("tarmac");

    const world = createWorld();
    const scene = createSurfaceScene(world, defaultTuning(), defaultSurfaceProfiles());
    const zones = zoneInfos(world, scene);

    const maxZ = Math.max(...zones.map((z) => z.z));
    const tarmacZone = zones.find((z) => z.z === maxZ);
    expect(tarmacZone?.surface).toBe("tarmac");
  });

  it("spawns on tarmac, at least 40m clear of the first zone boundary", () => {
    const world = createWorld();
    const scene = createSurfaceScene(world, defaultTuning(), defaultSurfaceProfiles());
    const zones = zoneInfos(world, scene);

    const spawnZone = zones.find(
      (z) => SURFACE_SCENE_SPAWN.z <= z.z + z.halfZ && SURFACE_SCENE_SPAWN.z >= z.z - z.halfZ,
    );
    expect(spawnZone?.surface).toBe("tarmac");

    const firstBoundaryZ = (zones[0].z - zones[0].halfZ + (zones[1].z + zones[1].halfZ)) / 2;
    expect(SURFACE_SCENE_SPAWN.z - firstBoundaryZ).toBeGreaterThanOrEqual(40);
  });
});

describe("createSurfaceScene: D-02, no ramp", () => {
  it("has no reference to a Phase 2 inclined-surface geometry constant", () => {
    // Structural proxy for D-02: this scene builds exactly six zone bodies
    // plus the building clusters plus the chassis -- nothing else. Ramp
    // geometry would add extra fixed bodies beyond the six zones and the 14
    // buildings.
    const world = createWorld();
    createSurfaceScene(world, defaultTuning(), defaultSurfaceProfiles());
    const fixedBodyCount = (() => {
      let n = 0;
      world.bodies.forEach((b) => {
        if (b.isFixed()) n++;
      });
      return n;
    })();
    expect(fixedBodyCount).toBe(
      SURFACE_ZONE_ORDER.length + SPARSE_BUILDINGS.length + DENSE_BUILDINGS.length,
    );
  });
});

describe("createSurfaceScene: SC1, the straight-drive proof", () => {
  it("a straight full-throttle drive from spawn crosses all six surfaces, in SURFACE_ZONE_ORDER, headlessly", () => {
    const world = createWorld();
    const scene = createSurfaceScene(world, defaultTuning(), defaultSurfaceProfiles());

    const frame = { steer: 0, throttle: 1, brake: 0, handbrake: false };
    const collapsed: SurfaceType[] = [];
    const maxTicks = 1800;
    // "up to 1800 ticks" (this plan's <behavior>): stop as soon as the
    // collapsed sequence has reached all six surfaces, rather than driving a
    // fixed 1800 ticks unconditionally -- past the mud zone's far edge the
    // world has no collider at all, and `SurfaceMap.lookup`'s documented
    // absent-handle fallback (src/physics/surface.ts) would otherwise append
    // a trailing, spurious "tarmac" default that has nothing to do with D-01's
    // six-surface crossing.
    for (let t = 0; t < maxTicks && collapsed.length < SURFACE_ZONE_ORDER.length; t++) {
      scene.preTick(t);
      scene.applyInput(frame);
      world.step();
      const surface = scene.vehicle.wheelSurfaces[0];
      if (collapsed.length === 0 || collapsed[collapsed.length - 1] !== surface) {
        collapsed.push(surface);
      }
    }

    expect(collapsed).toEqual(SURFACE_ZONE_ORDER);
  });
});

describe("createSurfaceScene: buildings (D-06/D-07)", () => {
  it("places at least 12 buildings in exactly two clusters, at least 40m apart (mean position)", () => {
    const total = SPARSE_BUILDINGS.length + DENSE_BUILDINGS.length;
    expect(total).toBeGreaterThanOrEqual(12);
    expect(SPARSE_BUILDINGS.length).toBeGreaterThan(0);
    expect(DENSE_BUILDINGS.length).toBeGreaterThan(0);

    const mean = (arr: readonly { x: number; z: number }[]) => ({
      x: arr.reduce((s, b) => s + b.x, 0) / arr.length,
      z: arr.reduce((s, b) => s + b.z, 0) / arr.length,
    });
    const sparseMean = mean(SPARSE_BUILDINGS);
    const denseMean = mean(DENSE_BUILDINGS);
    const dist = Math.hypot(sparseMean.x - denseMean.x, sparseMean.z - denseMean.z);
    expect(dist).toBeGreaterThanOrEqual(40);
  });

  it("the dense cluster's two rows leave an 8-14m drivable corridor between their inner faces", () => {
    const rowXs = [...new Set(DENSE_BUILDINGS.map((b) => b.x))].sort((a, b) => a - b);
    expect(rowXs.length).toBe(2);
    const [leftX, rightX] = rowXs;
    const leftHalfX = DENSE_BUILDINGS.find((b) => b.x === leftX)?.halfExtents.x ?? 0;
    const rightHalfX = DENSE_BUILDINGS.find((b) => b.x === rightX)?.halfExtents.x ?? 0;
    const gap = rightX - rightHalfX - (leftX + leftHalfX);
    expect(gap).toBeGreaterThanOrEqual(8);
    expect(gap).toBeLessThanOrEqual(14);
  });

  it("every building's top is at or above 20m -- taller than the helicopter rig's occlusion threshold", () => {
    // Sparse buildings (12x20x12) sit at the 20m floor by construction; dense
    // buildings (10x28x18) sit well above it. Both are per this plan's
    // <action> literal dimensions -- the SC6 occlusion playtest depends on
    // this floor never silently dropping below what the helicopter rig's
    // default high-speed altitude minus its follow distance requires.
    for (const b of [...SPARSE_BUILDINGS, ...DENSE_BUILDINGS]) {
      const top = b.halfExtents.y * 2;
      expect(top).toBeGreaterThanOrEqual(20);
    }
  });
});

describe("createSurfaceScene: structure", () => {
  it("bodies contains exactly one entry, the chassis", () => {
    const world = createWorld();
    const scene = createSurfaceScene(world, defaultTuning(), defaultSurfaceProfiles());
    expect(scene.bodies.length).toBe(1);
    expect(scene.bodies[0]).toBe(scene.vehicle.body);
  });

  it("dispose() does not throw and can be called once safely", () => {
    const world = createWorld();
    const scene = createSurfaceScene(world, defaultTuning(), defaultSurfaceProfiles());
    expect(() => scene.dispose()).not.toThrow();
  });

  it("the car rests on tarmac at spawn, matching vehicle-scene.ts's rest-state behaviour", () => {
    const world = createWorld();
    const scene = createSurfaceScene(world, defaultTuning(), defaultSurfaceProfiles());

    for (let t = 0; t < 90; t++) {
      scene.preTick(t);
      scene.applyInput(NEUTRAL);
      world.step();
    }

    for (let i = 0; i < 4; i++) {
      expect(scene.vehicle.controller.wheelIsInContact(i)).toBe(true);
      expect(scene.vehicle.wheelSurfaces[i]).toBe("tarmac");
    }
  });
});
