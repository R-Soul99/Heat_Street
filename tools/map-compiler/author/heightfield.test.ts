import * as RAPIER from "@dimforge/rapier3d";
import { describe, expect, it } from "vitest";
import { MAP_COLLISION_VERSION, parseMapCollision } from "../../../src/core/map-collision.ts";
import type { RoadGraphBounds } from "../../../src/core/road-graph.ts";
import { makeProjector, type Projector } from "../graph/project.ts";
import type { ElevationSampler } from "../sources/dem.ts";
import {
  buildHeightfield,
  HEIGHTFIELD_RESOLUTION,
  HEIGHTFIELD_SINK_M,
  heightfieldHeightAt,
  heightfieldX,
  heightfieldZ,
} from "./heightfield.ts";

const projector: Projector = makeProjector({ lat: 33.1, lon: -83.8 });

const BOUNDS: RoadGraphBounds = { minX: -100, minZ: -50, maxX: 300, maxZ: 150 };

/** A plane tilted in both X and Z, so a row/col transposition bug is detectable — a symmetric sampler could not catch one. */
const TILTED_PLANE: ElevationSampler = {
  sample(lat: number, lon: number): number {
    // Convert back to local ENU via the SAME projector the test itself uses,
    // so this fixture's "truth" is expressed in the same coordinate space
    // buildHeightfield samples in.
    const { x, z } = projector.project(lat, lon);
    return 100 + x * 0.01 + z * 0.05;
  },
};

describe("buildHeightfield", () => {
  it("returns a grid of resolution + 1 samples per axis, plus the scale extents", () => {
    const grid = buildHeightfield(TILTED_PLANE, BOUNDS, projector, 4);
    expect(grid.rows).toBe(4);
    expect(grid.cols).toBe(4);
    expect(grid.heights.length).toBe(5 * 5);
    expect(grid.scaleX).toBeCloseTo(BOUNDS.maxX - BOUNDS.minX, 9);
    expect(grid.scaleZ).toBeCloseTo(BOUNDS.maxZ - BOUNDS.minZ, 9);
  });

  it("uses HEIGHTFIELD_RESOLUTION by default", () => {
    const grid = buildHeightfield(TILTED_PLANE, BOUNDS, projector);
    expect(grid.rows).toBe(HEIGHTFIELD_RESOLUTION);
    expect(grid.cols).toBe(HEIGHTFIELD_RESOLUTION);
    expect(grid.heights.length).toBe((HEIGHTFIELD_RESOLUTION + 1) ** 2);
  });

  it("matches the sampler's own values at every grid point within 1e-4, before the sink is re-added", () => {
    const resolution = 8;
    const grid = buildHeightfield(TILTED_PLANE, BOUNDS, projector, resolution);
    for (let row = 0; row <= resolution; row++) {
      const z = heightfieldZ(grid, row);
      for (let col = 0; col <= resolution; col++) {
        const x = heightfieldX(grid, col);
        const { lat, lon } = projector.unproject(x, z);
        const expected = TILTED_PLANE.sample(lat, lon);
        const stored = heightfieldHeightAt(grid, row, col);
        expect(Math.abs(stored + grid.sinkM - expected)).toBeLessThan(1e-4);
      }
    }
  });

  it("places grid cell (0,0) exactly at bounds' minimum corner and the last cell exactly at the maximum corner", () => {
    const resolution = 6;
    const grid = buildHeightfield(TILTED_PLANE, BOUNDS, projector, resolution);
    expect(heightfieldX(grid, 0)).toBeCloseTo(BOUNDS.minX, 9);
    expect(heightfieldZ(grid, 0)).toBeCloseTo(BOUNDS.minZ, 9);
    expect(heightfieldX(grid, resolution)).toBeCloseTo(BOUNDS.maxX, 9);
    expect(heightfieldZ(grid, resolution)).toBeCloseTo(BOUNDS.maxZ, 9);
  });

  it("applies the sink uniformly and records the offset as a named field", () => {
    const grid = buildHeightfield(TILTED_PLANE, BOUNDS, projector, 4);
    expect(grid.sinkM).toBe(HEIGHTFIELD_SINK_M);
    expect(HEIGHTFIELD_SINK_M).toBe(5.0);

    const { lat, lon } = projector.unproject(heightfieldX(grid, 0), heightfieldZ(grid, 0));
    const rawSample = TILTED_PLANE.sample(lat, lon);
    // Precision 4, not 6 — `heights` is a Float32Array (see this module's own
    // header comment on Rapier's storage requirement), and f32's ~7-digit
    // relative precision only guarantees ~4-5 decimal places of ABSOLUTE
    // precision for a value in the hundreds, matching the f32-vs-large-value
    // rounding note `tests/map-scene.test.ts` documents for the same reason.
    expect(heightfieldHeightAt(grid, 0, 0)).toBeCloseTo(rawSample - HEIGHTFIELD_SINK_M, 4);
  });

  it("is detected correctly by Rapier's own heightfield collider — a downward raycast at a known grid corner reads back the stored (sunk) height", () => {
    // End-to-end proof that this module's row/col -> Rapier storage-order
    // mapping (this file's own header comment) is correct, not just
    // internally self-consistent with heightfieldHeightAt's own formula.
    const resolution = 4;
    const grid = buildHeightfield(TILTED_PLANE, BOUNDS, projector, resolution);

    const world = new RAPIER.World({ x: 0, y: 0, z: 0 });
    const centerX = grid.originX + grid.scaleX / 2;
    const centerZ = grid.originZ + grid.scaleZ / 2;
    const body = world.createRigidBody(
      RAPIER.RigidBodyDesc.fixed().setTranslation(centerX, 0, centerZ),
    );
    world.createCollider(
      RAPIER.ColliderDesc.heightfield(grid.rows, grid.cols, grid.heights, {
        x: grid.scaleX,
        y: 1,
        z: grid.scaleZ,
      }),
      body,
    );
    world.step();

    // A point just inside the min-X, min-Z corner of the grid.
    const worldX = grid.originX + 0.01;
    const worldZ = grid.originZ + 0.01;
    const ray = new RAPIER.Ray({ x: worldX, y: 10000, z: worldZ }, { x: 0, y: -1, z: 0 });
    const hit = world.castRay(ray, 20000, true);
    expect(hit).not.toBeNull();
    if (hit === null) return;
    const hitY = ray.pointAt(hit.timeOfImpact).y;

    expect(hitY).toBeCloseTo(heightfieldHeightAt(grid, 0, 0), 0);
  });
});

describe("parseMapCollision: heightfield block (collisionVersion 2)", () => {
  const validHeightfieldRaw = {
    rows: 2,
    cols: 2,
    heights: [1, 2, 3, 4, 5, 6, 7, 8, 9],
    originX: -10,
    originZ: -10,
    scaleX: 20,
    scaleZ: 20,
    sinkM: 0.35,
  };

  it("accepts collisionVersion 2 with a heightfield block", () => {
    const raw = JSON.stringify({
      collisionVersion: 2,
      areaId: "juliette-ga",
      buildings: [],
      heightfield: validHeightfieldRaw,
    });
    const parsed = parseMapCollision(raw, "juliette-ga", "test-fixture");
    expect(parsed.collisionVersion).toBe(2);
    expect(MAP_COLLISION_VERSION).toBe(2);
    expect(parsed.heightfield).toBeDefined();
    expect(parsed.heightfield?.rows).toBe(2);
    expect(parsed.heightfield?.cols).toBe(2);
    // A plain array, not a Float32Array — JSON.stringify does not serialise a
    // Float32Array as a JSON array (see `MapCollisionHeightfield`'s doc
    // comment in `src/core/map-collision.ts`); the Rapier-required
    // `Float32Array` conversion happens once at collider construction in
    // `src/physics/map-scene.ts`, not in the parsed wire type.
    expect(Array.isArray(parsed.heightfield?.heights)).toBe(true);
    expect(parsed.heightfield?.heights).toEqual(validHeightfieldRaw.heights);
  });

  it("rejects a version-1 sidecar, naming both versions", () => {
    const raw = JSON.stringify({ collisionVersion: 1, areaId: "juliette-ga", buildings: [] });
    expect(() => parseMapCollision(raw, "juliette-ga", "test-fixture")).toThrowError(/1/);
    try {
      parseMapCollision(raw, "juliette-ga", "test-fixture");
      expect.fail("expected parseMapCollision to throw");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      expect(message).toContain("1");
      expect(message).toContain("2");
    }
  });

  it("throws when the heights array length does not equal (rows+1)*(cols+1), naming both the expected and actual lengths", () => {
    const raw = JSON.stringify({
      collisionVersion: 2,
      areaId: "juliette-ga",
      buildings: [],
      heightfield: { ...validHeightfieldRaw, heights: [1, 2, 3] },
    });
    expect(() => parseMapCollision(raw, "juliette-ga", "test-fixture")).toThrowError(/9.*3|3.*9/);
  });

  it("rejects a non-finite or out-of-range height value", () => {
    const rawNonFinite = JSON.stringify({
      collisionVersion: 2,
      areaId: "juliette-ga",
      buildings: [],
      heightfield: { ...validHeightfieldRaw, heights: [1, 2, 3, 4, 5, 6, 7, 8, Number.NaN] },
    });
    expect(() => parseMapCollision(rawNonFinite, "juliette-ga", "test-fixture")).toThrow();

    const rawOutOfRange = JSON.stringify({
      collisionVersion: 2,
      areaId: "juliette-ga",
      buildings: [],
      heightfield: { ...validHeightfieldRaw, heights: [1, 2, 3, 4, 5, 6, 7, 8, 12000] },
    });
    expect(() => parseMapCollision(rawOutOfRange, "juliette-ga", "test-fixture")).toThrow();
  });
});
