import * as RAPIER from "@dimforge/rapier3d";
import { describe, expect, it } from "vitest";
import { shippedTuning } from "../src/core/feel";
import { createTerrainGrid, type TerrainGrid } from "../src/core/terrain-grid";
import { defaultTuning } from "../src/core/vehicle-tuning";
import { createSurfaceMap } from "../src/physics/surface";
import { gateCourseLanes, runGateLane } from "../src/physics/telemetry/terrain-gate";
import { buildTerrainCollider } from "../src/physics/terrain-scene";
import { createWheelRayPatch, PATCH_CELLS, patchWindow } from "../src/physics/wheel-ray-patch";
import { createWorld } from "../src/physics/world";

/**
 * Regression tests for the local trimesh wheel-ray patch (04.3-08). Root cause:
 * .planning/debug/wheel-ray-miss-slope-gate.md (parry heightfield ray cast
 * misses rays that start within a few f32 ulps of a cell line).
 */

const PAINT = { data: new Uint8Array(0) } as never;

function bumpyGrid(rows: number, cols: number): TerrainGrid {
  const grid = createTerrainGrid({ rows, cols, cellSizeM: 1.5, originX: 700, originZ: -519 });
  for (let c = 0; c <= cols; c++)
    for (let r = 0; r <= rows; r++)
      grid.heights[r + c * (rows + 1)] = 2 * Math.sin(c * 0.37) + 1.5 * Math.cos(r * 0.23);
  return grid;
}

function nextAfter(v: number, k: number): number {
  const f = new Float32Array([v]);
  const u = new Int32Array(f.buffer);
  u[0] += k * (v > 0 ? 1 : -1);
  return f[0];
}

describe("wheel-ray patch: flat-ground cell-line micro test", () => {
  it("every short downward ray near a cell line hits once the patch is up", () => {
    const rows = 200;
    const cols = 200;
    const grid = createTerrainGrid({ rows, cols, cellSizeM: 1.5, originX: 700, originZ: -519 });
    const world = createWorld();
    const hf = buildTerrainCollider(world, grid, PAINT, "grass").collider;
    const map = createSurfaceMap();
    const cx = 700 + 150;
    const cz = -519 + 150;
    const patch = createWheelRayPatch(world, [{ grid, map, groundSurface: "grass" }]);
    patch.update(cx, cz);
    world.step();

    let hfMisses = 0;
    let total = 0;
    let worldMisses = 0;
    const win = patchWindow(grid, cx, cz);
    for (let r = win.r0 + 6; r < win.r0 + win.rw - 6; r += 1) {
      const zb = Math.fround(-519 + 1.5 * r);
      for (const k of [0, 1, 2, 3, 4, 8, 16]) {
        for (const side of [-1, 1]) {
          const z = nextAfter(zb, side * k);
          for (const dz of [-0.02, 0, 0.02]) {
            const ray = new RAPIER.Ray({ x: cx + 0.3, y: 0.6, z }, { x: 0.03, y: -0.81, z: dz });
            total++;
            if (hf.castRay(ray, 1, true) < 0) hfMisses++;
            if (world.castRay(ray, 1, true) === null) worldMisses++;
          }
        }
      }
    }
    // The control (heightfield alone) is informational: it documents the
    // upstream bug and must not fail the build if upstream fixes it.
    console.log(`heightfield alone missed ${hfMisses}/${total}; with patch ${worldMisses}`);
    expect(total).toBeGreaterThan(500);
    expect(worldMisses).toBe(0);
    patch.dispose();
    world.free();
  });
});

describe("wheel-ray patch: soundness", () => {
  it("matches the heightfield heights (same triangles) on a bumpy grid", () => {
    const grid = bumpyGrid(120, 120);
    const world = createWorld();
    buildTerrainCollider(world, grid, PAINT, "grass");
    // Patch alone in a second world so castRay sees only its trimesh.
    const w2 = createWorld();
    const patch = createWheelRayPatch(w2, [
      { grid, map: createSurfaceMap(), groundSurface: "grass" },
    ]);
    const cx = 700 + 90;
    const cz = -519 + 90;
    patch.update(cx, cz);
    w2.step();
    world.step();
    let worst = 0;
    let n = 0;
    for (let i = 0; i < 400; i++) {
      const x = cx - 20 + ((i * 7.31) % 40);
      const z = cz - 20 + ((i * 3.77) % 40);
      const ray = new RAPIER.Ray({ x, y: 20, z }, { x: 0, y: -1, z: 0 });
      const a = world.castRay(ray, 40, true);
      const b = w2.castRay(ray, 40, true);
      if (a === null || b === null) continue;
      worst = Math.max(worst, Math.abs(a.timeOfImpact - b.timeOfImpact));
      n++;
    }
    expect(n).toBeGreaterThan(300);
    expect(worst).toBeLessThan(1e-3);
    patch.dispose();
    world.free();
    w2.free();
  });

  it("creates no contacts: a ball falls straight through a patch-only world", () => {
    const grid = bumpyGrid(80, 80);
    const world = createWorld();
    const patch = createWheelRayPatch(world, [
      { grid, map: createSurfaceMap(), groundSurface: "grass" },
    ]);
    const cx = 700 + 60;
    const cz = -519 + 60;
    patch.update(cx, cz);
    const ball = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(cx, 10, cz));
    world.createCollider(RAPIER.ColliderDesc.ball(0.5), ball);
    for (let i = 0; i < 180; i++) world.step();
    expect(ball.translation().y).toBeLessThan(-5);
    patch.dispose();
    world.free();
  });

  it("registers its handles as the terrain surface and cleans up on re-centre and dispose", () => {
    const grid = bumpyGrid(400, 400);
    const world = createWorld();
    const terrain = buildTerrainCollider(world, grid, PAINT, "grass");
    const map = createSurfaceMap("tarmac");
    const patch = createWheelRayPatch(world, [
      { grid, paint: terrain.paint, map, groundSurface: "grass" },
    ]);
    const baseline = world.colliders.len();
    patch.update(700 + 100, -519 + 100);
    world.step();
    expect(patch.rebuilds).toBe(1);
    expect(world.colliders.len()).toBe(baseline + 1);
    expect(terrain.paint.aliasHandles?.size).toBe(1);
    const first = [...(terrain.paint.aliasHandles ?? [])][0];
    expect(map.lookup(first)).toBe("grass");

    // Small moves do nothing; a long drive re-centres, never leaking colliders.
    patch.update(700 + 102, -519 + 101);
    expect(patch.rebuilds).toBe(1);
    for (let x = 100; x < 560; x += 0.5) {
      patch.update(700 + x, -519 + 100);
      world.step();
    }
    expect(patch.rebuilds).toBeGreaterThan(5);
    expect(patch.rebuilds).toBeLessThan(40);
    expect(world.colliders.len()).toBeLessThanOrEqual(baseline + 2);
    expect((terrain.paint.aliasHandles?.size ?? 0) <= 2).toBe(true);
    expect(map.lookup(first)).toBe("tarmac");

    patch.dispose();
    expect(world.colliders.len()).toBe(baseline);
    expect(terrain.paint.aliasHandles?.size).toBe(0);
    world.free();
  });

  it("window geometry is clamped to the grid and bounded by PATCH_CELLS", () => {
    const small = createTerrainGrid({ rows: 10, cols: 12, cellSizeM: 1, originX: 0, originZ: 0 });
    expect(patchWindow(small, 6, 5)).toEqual({ c0: 0, r0: 0, cw: 12, rw: 10 });
    const big = bumpyGrid(300, 300);
    const w = patchWindow(big, 700 + 1, -519 + 1);
    expect(w.c0).toBe(0);
    expect(w.cw).toBe(PATCH_CELLS);
  });
});

describe("wheel-ray patch: gate-course sweep has no lost contact ticks", () => {
  const lanes = gateCourseLanes().filter((l) => ["hill", "bank", "climb"].includes(l.id));
  const perturbed = shippedTuning();
  perturbed.wheels.suspensionStiffness *= 1.0003;
  const variants: [string, () => ReturnType<typeof shippedTuning>][] = [
    ["shipped", shippedTuning],
    ["default", defaultTuning],
    ["shipped k*1.0003", () => perturbed],
  ];
  for (const [name, make] of variants) {
    it(`${name}: 0 lost ticks, 10-30 m/s, both directions, subdiv 1 and 2`, () => {
      const bad: string[] = [];
      for (const sub of [1, 2] as const)
        for (const speed of [10, 15, 20, 25, 30])
          for (const lane of lanes)
            for (const dir of [1, -1] as const) {
              const m = runGateLane(lane, speed, dir, make(), { colliderSubdiv: sub });
              if (m.contactLossTicks > 0)
                bad.push(`${lane.id}@${speed}/${dir} s${sub}: ${m.contactLossTicks}`);
            }
      expect(bad).toEqual([]);
    }, 120_000);
  }
});
